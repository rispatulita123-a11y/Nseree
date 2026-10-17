/**
 * PilotWalkManager.ts
 * High-Performance, Ultra-Fluid 3D Animated Pilot System on Circuit 1 (Square Apex).
 * 
 * Features & Architectural Optimizations:
 * 1. Audio-Locked Stride Synchronization:
 *    - Direct coupling between narrator audio playback timestamp and stride kinematics.
 *    - Eliminates temporal drift, micro-stutters, and frametime jitter.
 * 2. True Anatomical Joint Hierarchy (FK Chain):
 *    - Pelvis -> Hip Joint -> Thigh -> Knee Joint -> Shin -> Ankle Joint -> Boot & Sole.
 *    - Torso -> Shoulder Joint -> Upper Arm -> Elbow Joint -> Forearm -> Wrist Joint -> Glove.
 *    - Natural heel-to-toe foot roll, organic knee flexion, pelvis vertical bounce, and arm counter-swing.
 * 3. Zero-Jitter Dynamic Camera Tracking:
 *    - Synchronous position and target coordinate frames eliminate parallax judder.
 *    - 4 Broadcast presets: Dynamic Front, Low Asphalt Shaver, Lateral Medium Profile, Orbit 360°.
 * 4. Zero Runtime Allocations:
 *    - Reused scratch vectors and matrices to prevent Garbage Collector pauses.
 * 5. Supports direct custom GLB model loading via GLTFLoader.
 */

import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CustomLiverySettings } from '../career/CareerTypes';

export type PilotCameraPreset = 'dynamic_front' | 'low_asphalt' | 'profile_medium' | 'orbit_360';

export class PilotWalkManager {
  private scene: THREE.Scene;
  public isActive: boolean = false;
  public isPaused: boolean = false;

  // Root group in scene
  public rootGroup: THREE.Group;

  // GLTF loaded model and animation mixer
  private gltfModel: THREE.Group | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private walkAction: THREE.AnimationAction | null = null;
  private isUsingCustomGltf: boolean = false;

  // Procedural pilot hierarchical joint chains
  private proceduralRig: THREE.Group | null = null;
  private torsoGroup: THREE.Group | null = null;
  private headGroup: THREE.Group | null = null;
  private pelvisGroup: THREE.Group | null = null;

  // Leg joint chains (FK)
  private leftHipJoint: THREE.Group | null = null;
  private leftKneeJoint: THREE.Group | null = null;
  private leftAnkleJoint: THREE.Group | null = null;

  private rightHipJoint: THREE.Group | null = null;
  private rightKneeJoint: THREE.Group | null = null;
  private rightAnkleJoint: THREE.Group | null = null;

  // Arm joint chains (FK)
  private leftShoulderJoint: THREE.Group | null = null;
  private leftElbowJoint: THREE.Group | null = null;
  private rightShoulderJoint: THREE.Group | null = null;
  private rightElbowJoint: THREE.Group | null = null;

  // Kinematic parameters
  private walkPhase: number = 0;
  private readonly strideCadence: number = 7.4; // rad/sec (~71 strides/min natural assertive pace)
  private readonly walkSpeed: number = 1.32; // m/s forward translation speed
  private lastAudioTime: number = 0;
  private hasAudioTimeFeed: boolean = false;
  private virtualTime: number = 0;
  private targetAudioTime: number = 0;
  private isAudioSyncActive: boolean = false;

  // Walk physics & trajectory on Circuit 1 Main Straight
  // Circuit 1 starting grid: X = -18, Z = -128, Y = 0.45.
  // We start the pilot at X = -12.0, Z = -128.0, and walk along +X (towards Turn 1 at X = 118.0)
  private readonly startPosition = new THREE.Vector3(-12.0, 0.02, -128.0);
  private currentPosition = new THREE.Vector3(-12.0, 0.02, -128.0);
  private totalDistanceWalked: number = 0;
  private readonly headingAngle: number = Math.PI / 2; // Facing +X down the main straight

  // Camera choreography
  private currentCameraPreset: PilotCameraPreset = 'dynamic_front';
  private targetCameraPreset: PilotCameraPreset = 'dynamic_front';
  private cameraElapsed: number = 0;
  private cameraFov: number = 44;
  private presetTransitionAlpha: number = 1.0;

  // Scratch vectors to guarantee 0 GC allocations
  private readonly _vTarget = new THREE.Vector3();
  private readonly _vCamPos = new THREE.Vector3();
  private readonly _vPrevCamPos = new THREE.Vector3();
  private readonly _vSmoothCamPos = new THREE.Vector3();
  private readonly _vSmoothTarget = new THREE.Vector3();

  // Callbacks
  public onFinished?: () => void;
  public onModelLoaded?: (name: string) => void;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'PilotWalkScene';
    this.rootGroup.visible = false;
    this.scene.add(this.rootGroup);

    // Try loading default model if available
    this.tryLoadDefaultGlb();
  }

  /**
   * Attempts to load the uploaded GLB model
   */
  public async tryLoadDefaultGlb(): Promise<boolean> {
    const glbCandidates = [
      '/models/mono_competicion_aurora_gp27_rig_caminata_v46_optimizado.glb',
      '/mono_competicion_aurora_gp27_rig_caminata_v46_optimizado.glb',
      'mono_competicion_aurora_gp27_rig_caminata_v46_optimizado.glb',
    ];

    const loader = new GLTFLoader();

    for (const url of glbCandidates) {
      try {
        const gltf = await new Promise<GLTF>((resolve, reject) => {
          loader.load(url, resolve, undefined, reject);
        });

        if (gltf && gltf.scene) {
          this.applyLoadedGltf(gltf, 'mono_competicion_aurora_gp27_rig_caminata_v46_optimizado.glb');
          return true;
        }
      } catch {
        // Try next candidate
      }
    }

    return false;
  }

  /**
   * Allows hot-loading any custom GLB file selected by user via File picker
   */
  public async loadCustomGlbFile(file: File): Promise<boolean> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const loader = new GLTFLoader();
      loader.load(
        url,
        (gltf) => {
          this.applyLoadedGltf(gltf, file.name);
          URL.revokeObjectURL(url);
          resolve(true);
        },
        undefined,
        (err) => {
          console.warn('Could not load custom pilot GLB:', err);
          URL.revokeObjectURL(url);
          resolve(false);
        }
      );
    });
  }

  /**
   * Applies and configures a loaded GLTF pilot model
   */
  private applyLoadedGltf(gltf: GLTF, modelName: string): void {
    if (this.gltfModel) {
      this.rootGroup.remove(this.gltfModel);
      this.gltfModel.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material?.dispose();
          }
        }
      });
      this.gltfModel = null;
    }

    if (this.proceduralRig) {
      this.proceduralRig.visible = false;
    }

    const model = gltf.scene;
    this.gltfModel = model;
    this.isUsingCustomGltf = true;

    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          child.material.roughness = Math.max(0.25, child.material.roughness ?? 0.4);
          child.material.envMapIntensity = 1.3;
        }
      }
    });

    const bbox = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const targetHeight = 1.80;
    if (size.y > 0.05) {
      const scale = targetHeight / size.y;
      model.scale.set(scale, scale, scale);
    }

    model.rotation.y = this.headingAngle;

    if (gltf.animations && gltf.animations.length > 0) {
      this.mixer = new THREE.AnimationMixer(model);
      const walkClip =
        gltf.animations.find((c) =>
          c.name.toLowerCase().includes('walk') ||
          c.name.toLowerCase().includes('caminata') ||
          c.name.toLowerCase().includes('run')
        ) || gltf.animations[0];

      this.walkAction = this.mixer.clipAction(walkClip);
      this.walkAction.setLoop(THREE.LoopRepeat, Infinity);
      this.walkAction.play();
    }

    this.rootGroup.add(model);
    if (this.onModelLoaded) {
      this.onModelLoaded(modelName);
    }
  }

  /**
   * Builds an articulated high-fidelity procedural 3D pilot rig with true FK joint hierarchy.
   */
  private buildProceduralPilot(livery?: CustomLiverySettings): void {
    if (this.proceduralRig) {
      this.rootGroup.remove(this.proceduralRig);
      this.proceduralRig = null;
    }

    const teamColorHex = livery?.primaryColor ? parseInt(livery.primaryColor.replace('#', ''), 16) : 0xc8102e;
    const accentColorHex = livery?.accentColor ? parseInt(livery.accentColor.replace('#', ''), 16) : 0xffffff;

    const pilotGroup = new THREE.Group();
    pilotGroup.name = 'ProceduralPilot';

    // Materials
    const suitMat = new THREE.MeshStandardMaterial({
      color: teamColorHex,
      roughness: 0.52,
      metalness: 0.12,
    });
    const suitAccentMat = new THREE.MeshStandardMaterial({
      color: accentColorHex,
      roughness: 0.42,
      metalness: 0.22,
    });
    const darkSuitMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.65,
      metalness: 0.1,
    });
    const helmetMat = new THREE.MeshStandardMaterial({
      color: 0xf4f4f5,
      roughness: 0.12,
      metalness: 0.35,
    });
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0f,
      roughness: 0.04,
      metalness: 0.96,
      envMapIntensity: 2.2,
    });
    const bootMat = new THREE.MeshStandardMaterial({
      color: 0x111113,
      roughness: 0.7,
      metalness: 0.05,
    });
    const gloveMat = new THREE.MeshStandardMaterial({
      color: teamColorHex,
      roughness: 0.5,
      metalness: 0.15,
    });

    // 1. Torso Root
    const torso = new THREE.Group();
    torso.position.set(0, 0.96, 0);

    // Torso Chest & Abdomen
    const chestGeo = new THREE.BoxGeometry(0.38, 0.44, 0.24);
    const chestMesh = new THREE.Mesh(chestGeo, suitMat);
    chestMesh.position.y = 0.22;
    chestMesh.castShadow = true;
    torso.add(chestMesh);

    // Lateral Accent Strips
    const accentLGeo = new THREE.BoxGeometry(0.02, 0.42, 0.25);
    const accentLMesh = new THREE.Mesh(accentLGeo, suitAccentMat);
    accentLMesh.position.set(-0.19, 0.22, 0);
    accentLMesh.castShadow = true;
    torso.add(accentLMesh);

    const accentRGeo = new THREE.BoxGeometry(0.02, 0.42, 0.25);
    const accentRMesh = new THREE.Mesh(accentRGeo, suitAccentMat);
    accentRMesh.position.set(0.19, 0.22, 0);
    accentRMesh.castShadow = true;
    torso.add(accentRMesh);

    // Official Sponsor Chest Patch
    const patchGeo = new THREE.BoxGeometry(0.18, 0.09, 0.02);
    const patchMesh = new THREE.Mesh(patchGeo, darkSuitMat);
    patchMesh.position.set(0, 0.30, 0.125);
    torso.add(patchMesh);

    // Central Suit Zip Line
    const zipGeo = new THREE.BoxGeometry(0.025, 0.42, 0.015);
    const zipMesh = new THREE.Mesh(zipGeo, darkSuitMat);
    zipMesh.position.set(0, 0.22, 0.125);
    torso.add(zipMesh);

    // 2. Head & FIA Aerodynamic Helmet
    const head = new THREE.Group();
    head.position.set(0, 0.48, 0);

    // Neck / Balaclava
    const neckGeo = new THREE.CylinderGeometry(0.07, 0.08, 0.10, 16);
    const neckMesh = new THREE.Mesh(neckGeo, darkSuitMat);
    neckMesh.position.y = 0.04;
    head.add(neckMesh);

    // Helmet Shell
    const helmetGeo = new THREE.SphereGeometry(0.155, 24, 20);
    helmetGeo.scale(1.0, 1.15, 1.1);
    const helmetMesh = new THREE.Mesh(helmetGeo, helmetMat);
    helmetMesh.position.set(0, 0.20, -0.01);
    helmetMesh.castShadow = true;
    head.add(helmetMesh);

    // Tinted Visor
    const visorGeo = new THREE.CylinderGeometry(0.145, 0.145, 0.085, 20, 1, false, -Math.PI * 0.42, Math.PI * 0.84);
    const visorMesh = new THREE.Mesh(visorGeo, visorMat);
    visorMesh.position.set(0, 0.20, 0.035);
    visorMesh.rotation.x = 0.08;
    head.add(visorMesh);

    // Aerodynamic Rear Lip Spoiler
    const spoilerGeo = new THREE.BoxGeometry(0.16, 0.03, 0.06);
    const spoilerMesh = new THREE.Mesh(spoilerGeo, suitAccentMat);
    spoilerMesh.position.set(0, 0.16, -0.15);
    spoilerMesh.rotation.x = -0.3;
    head.add(spoilerMesh);

    torso.add(head);

    // 3. Articulated Arms (Hierarchical Shoulder -> Elbow -> Wrist)
    const createArmJointChain = (isLeft: boolean) => {
      const sign = isLeft ? -1 : 1;
      const shoulderJoint = new THREE.Group();
      shoulderJoint.position.set(sign * 0.24, 0.40, 0);

      // Shoulder pad
      const shoulderPadGeo = new THREE.SphereGeometry(0.075, 14, 12);
      const shoulderPadMesh = new THREE.Mesh(shoulderPadGeo, suitAccentMat);
      shoulderJoint.add(shoulderPadMesh);

      // Upper arm
      const upperArmGeo = new THREE.CylinderGeometry(0.055, 0.048, 0.26, 14);
      const upperArmMesh = new THREE.Mesh(upperArmGeo, suitMat);
      upperArmMesh.position.y = -0.13;
      upperArmMesh.castShadow = true;
      shoulderJoint.add(upperArmMesh);

      // Elbow joint
      const elbowJoint = new THREE.Group();
      elbowJoint.position.set(0, -0.26, 0);

      const elbowPadGeo = new THREE.BoxGeometry(0.07, 0.06, 0.07);
      const elbowPadMesh = new THREE.Mesh(elbowPadGeo, darkSuitMat);
      elbowPadMesh.position.set(0, 0, -0.02);
      elbowJoint.add(elbowPadMesh);

      // Forearm
      const forearmGeo = new THREE.CylinderGeometry(0.048, 0.042, 0.24, 14);
      const forearmMesh = new THREE.Mesh(forearmGeo, suitMat);
      forearmMesh.position.y = -0.12;
      forearmMesh.castShadow = true;
      elbowJoint.add(forearmMesh);

      // Wrist & Racing Glove
      const wristJoint = new THREE.Group();
      wristJoint.position.set(0, -0.24, 0);

      const handGeo = new THREE.BoxGeometry(0.065, 0.11, 0.075);
      const handMesh = new THREE.Mesh(handGeo, gloveMat);
      handMesh.position.set(0, -0.05, 0.01);
      handMesh.castShadow = true;
      wristJoint.add(handMesh);

      elbowJoint.add(wristJoint);
      shoulderJoint.add(elbowJoint);

      return { shoulderJoint, elbowJoint };
    };

    const leftArmData = createArmJointChain(true);
    const rightArmData = createArmJointChain(false);
    torso.add(leftArmData.shoulderJoint, rightArmData.shoulderJoint);

    this.leftShoulderJoint = leftArmData.shoulderJoint;
    this.leftElbowJoint = leftArmData.elbowJoint;
    this.rightShoulderJoint = rightArmData.shoulderJoint;
    this.rightElbowJoint = rightArmData.elbowJoint;

    // 4. Pelvis & Articulated Legs (Hierarchical Hip -> Knee -> Ankle)
    const pelvis = new THREE.Group();
    pelvis.position.set(0, 0.95, 0);

    const pelvisGeo = new THREE.BoxGeometry(0.36, 0.16, 0.22);
    const pelvisMesh = new THREE.Mesh(pelvisGeo, darkSuitMat);
    pelvisMesh.position.y = -0.08;
    pelvisMesh.castShadow = true;
    pelvis.add(pelvisMesh);

    const createLegJointChain = (isLeft: boolean) => {
      const sign = isLeft ? -1 : 1;
      const hipJoint = new THREE.Group();
      hipJoint.position.set(sign * 0.13, -0.12, 0);

      // Thigh
      const thighGeo = new THREE.CylinderGeometry(0.08, 0.066, 0.38, 14);
      const thighMesh = new THREE.Mesh(thighGeo, suitMat);
      thighMesh.position.y = -0.19;
      thighMesh.castShadow = true;
      hipJoint.add(thighMesh);

      // Knee Joint
      const kneeJoint = new THREE.Group();
      kneeJoint.position.set(0, -0.38, 0);

      const kneePadGeo = new THREE.BoxGeometry(0.09, 0.07, 0.08);
      const kneePadMesh = new THREE.Mesh(kneePadGeo, darkSuitMat);
      kneePadMesh.position.set(0, 0, 0.035);
      kneeJoint.add(kneePadMesh);

      // Shin / Calf
      const shinGeo = new THREE.CylinderGeometry(0.065, 0.052, 0.38, 14);
      const shinMesh = new THREE.Mesh(shinGeo, suitMat);
      shinMesh.position.y = -0.19;
      shinMesh.castShadow = true;
      kneeJoint.add(shinMesh);

      // Ankle Joint & Foot
      const ankleJoint = new THREE.Group();
      ankleJoint.position.set(0, -0.38, 0);

      // Racing Boot
      const bootGeo = new THREE.BoxGeometry(0.095, 0.11, 0.22);
      const bootMesh = new THREE.Mesh(bootGeo, bootMat);
      bootMesh.position.set(0, -0.05, 0.04);
      bootMesh.castShadow = true;
      ankleJoint.add(bootMesh);

      // Grip Sole
      const soleGeo = new THREE.BoxGeometry(0.098, 0.022, 0.23);
      const soleMesh = new THREE.Mesh(soleGeo, suitAccentMat);
      soleMesh.position.set(0, -0.10, 0.04);
      ankleJoint.add(soleMesh);

      kneeJoint.add(ankleJoint);
      hipJoint.add(kneeJoint);

      return { hipJoint, kneeJoint, ankleJoint };
    };

    const leftLegData = createLegJointChain(true);
    const rightLegData = createLegJointChain(false);
    pelvis.add(leftLegData.hipJoint, rightLegData.hipJoint);

    this.leftHipJoint = leftLegData.hipJoint;
    this.leftKneeJoint = leftLegData.kneeJoint;
    this.leftAnkleJoint = leftLegData.ankleJoint;

    this.rightHipJoint = rightLegData.hipJoint;
    this.rightKneeJoint = rightLegData.kneeJoint;
    this.rightAnkleJoint = rightLegData.ankleJoint;

    pilotGroup.add(torso, pelvis);

    this.torsoGroup = torso;
    this.headGroup = head;
    this.pelvisGroup = pelvis;

    pilotGroup.rotation.y = this.headingAngle;
    this.proceduralRig = pilotGroup;
    this.rootGroup.add(pilotGroup);
  }

  /**
   * Activates the Pilot Walk Presentation Scene
   */
  public activate(livery?: CustomLiverySettings, onFinished?: () => void): void {
    this.isActive = true;
    this.isPaused = false;
    this.onFinished = onFinished;
    this.cameraElapsed = 0;
    this.totalDistanceWalked = 0;
    this.walkPhase = 0;
    this.lastAudioTime = 0;
    this.hasAudioTimeFeed = false;
    this.virtualTime = 0;
    this.targetAudioTime = 0;
    this.isAudioSyncActive = false;
    this.presetTransitionAlpha = 1.0;

    // Reset trajectory on Circuit 1 main straight
    this.currentPosition.copy(this.startPosition);
    this.rootGroup.position.copy(this.currentPosition);
    this.rootGroup.visible = true;

    // Build/refresh procedural rig with player livery if no custom GLTF
    if (!this.isUsingCustomGltf) {
      this.buildProceduralPilot(livery);
    } else if (this.proceduralRig) {
      this.proceduralRig.visible = false;
    }

    if (this.walkAction) {
      this.walkAction.reset();
      this.walkAction.play();
    }
  }

  /**
   * Deactivates and cleanly hides the presentation scene
   */
  public deactivate(): void {
    this.isActive = false;
    this.rootGroup.visible = false;
    if (this.walkAction) {
      this.walkAction.stop();
    }
  }

  /**
   * Sets the camera choreography preset with smooth blend
   */
  public setCameraPreset(preset: PilotCameraPreset): void {
    if (this.currentCameraPreset !== preset) {
      this.targetCameraPreset = preset;
      this.currentCameraPreset = preset;
      this.presetTransitionAlpha = 0.0;
    }
  }

  /**
   * Toggles pause/resume of the pilot's stride
   */
  public setPaused(paused: boolean): void {
    this.isPaused = paused;
    if (this.walkAction) {
      this.walkAction.paused = paused;
    }
  }

  /**
   * Audio-time synchronization anchor:
   * Sets the reference audio playback timestamp to synchronize the walk cycle and camera timing
   * with the speech audio track without causing temporal frame drops or teleportation.
   */
  public setAudioTime(audioTimeSec: number): void {
    if (!this.isActive || this.isPaused) return;

    this.hasAudioTimeFeed = true;
    this.lastAudioTime = audioTimeSec;
    this.targetAudioTime = audioTimeSec;

    if (!this.isAudioSyncActive) {
      this.isAudioSyncActive = true;
      this.virtualTime = audioTimeSec;
      this.cameraElapsed = audioTimeSec;
    } else {
      // If there is a large disparity (e.g. user seeks or tab was suspended), resync virtual time directly
      const disparity = Math.abs(this.virtualTime - audioTimeSec);
      if (disparity > 0.5) {
        this.virtualTime = audioTimeSec;
        this.cameraElapsed = audioTimeSec;
      }
    }
  }

  /**
   * Continuous 60/120 FPS simulation update:
   * Advances the pilot's forward displacement, joint kinematics (FK), and camera time every frame.
   * Features adaptive phase-tracking: gently aligns virtual simulation time to the audio track
   * so there are zero frame-time hiccups, micro-stutters, or pose snapping.
   */
  public update(delta: number): void {
    if (!this.isActive || this.isPaused) return;

    // Safety clamp dt to avoid simulation jumps during tab defocus or spike
    const dt = Math.min(Math.max(delta, 0.001), 0.05);

    // 1. Advance virtual animation time with adaptive audio phase-locking
    if (this.isAudioSyncActive) {
      const timeError = this.targetAudioTime - this.virtualTime;
      // Soft drift compensation: smooth linear pull towards audio time
      if (Math.abs(timeError) > 0.015) {
        this.virtualTime += dt + timeError * Math.min(1.0, dt * 2.5);
      } else {
        this.virtualTime += dt;
      }
    } else {
      this.virtualTime += dt;
    }

    this.cameraElapsed = this.virtualTime;

    // 2. Continuous forward translation along Circuit 1 main straight (60/120 FPS)
    this.totalDistanceWalked = this.virtualTime * this.walkSpeed;
    this.currentPosition.x = this.startPosition.x + this.totalDistanceWalked;
    this.rootGroup.position.copy(this.currentPosition);

    // 3. Stride phase locked smoothly to continuous virtual time
    this.walkPhase = this.virtualTime * this.strideCadence;

    // 4. Update GLTF animation mixer if active
    if (this.mixer) {
      this.mixer.update(dt);
    }

    // 5. Update procedural rig anatomical joints at native display framerate
    if (this.proceduralRig && !this.isUsingCustomGltf) {
      this.updateProceduralKinematics(this.walkPhase);
    }
  }

  /**
   * Procedural Anatomical Kinematics (FK hierarchy)
   * Creates an authentic, fluid and weighty walking cycle.
   */
  private updateProceduralKinematics(phase: number): void {
    const sinP = Math.sin(phase);
    const cosP = Math.cos(phase);
    const doubleSin = Math.sin(phase * 2.0);

    // 1. Legs: Authentic Stride with Knee Flexion and Foot Roll
    // Note: Pilot faces +X (heading = Math.PI / 2). Forward swing moves foot in +Z local / -rotation.x
    const legAmplitude = 0.52; // rad (~30 deg)

    if (this.leftHipJoint && this.rightHipJoint && this.leftKneeJoint && this.rightKneeJoint && this.leftAnkleJoint && this.rightAnkleJoint) {
      // Hip Swing
      this.leftHipJoint.rotation.x = sinP * legAmplitude;
      this.rightHipJoint.rotation.x = -sinP * legAmplitude;

      // Knee Flexion: Only bends backwards (rotation.x > 0) during swing phase
      // Left leg swing phase: when sinP > 0 (swinging forward to land)
      const leftSwing = Math.max(0, sinP);
      this.leftKneeJoint.rotation.x = leftSwing * 0.88;

      // Right leg swing phase: when -sinP > 0
      const rightSwing = Math.max(0, -sinP);
      this.rightKneeJoint.rotation.x = rightSwing * 0.88;

      // Ankle / Foot Roll: Dorsiflexion when swinging, heel-to-toe plantarflexion on push-off
      this.leftAnkleJoint.rotation.x = -sinP * 0.28 + (leftSwing > 0.2 ? -0.15 : 0.05);
      this.rightAnkleJoint.rotation.x = sinP * 0.28 + (rightSwing > 0.2 ? -0.15 : 0.05);
    }

    // 2. Arms: Natural Counter-Balance Swing with Subtle Elbow Bend
    if (this.leftShoulderJoint && this.rightShoulderJoint && this.leftElbowJoint && this.rightElbowJoint) {
      const armAmplitude = 0.38;
      // Opposite to leg swing
      this.leftShoulderJoint.rotation.x = -sinP * armAmplitude;
      this.rightShoulderJoint.rotation.x = sinP * armAmplitude;

      // Arm subtle lateral cant away from torso
      this.leftShoulderJoint.rotation.z = 0.08;
      this.rightShoulderJoint.rotation.z = -0.08;

      // Elbow has natural baseline flexion plus dynamic flex on back-swing
      this.leftElbowJoint.rotation.x = 0.24 + Math.max(0, -sinP) * 0.35;
      this.rightElbowJoint.rotation.x = 0.24 + Math.max(0, sinP) * 0.35;
    }

    // 3. Pelvis & Torso: Vertical Bounce & Weight Shift
    if (this.pelvisGroup && this.torsoGroup) {
      // Pelvis drops slightly twice per stride (at mid-stance)
      const verticalBounce = 0.95 + Math.abs(doubleSin) * 0.032;
      this.pelvisGroup.position.y = verticalBounce;
      this.torsoGroup.position.y = verticalBounce + 0.01;

      // Subtle hip drop/tilt
      this.pelvisGroup.rotation.z = cosP * 0.03;
      this.torsoGroup.rotation.z = -cosP * 0.02;

      // Torso shoulder counter-rotation to balance hips
      this.torsoGroup.rotation.y = -sinP * 0.05;
    }

    // 4. Head: Stabilized Gaze on Track Horizon
    if (this.headGroup) {
      // Compensate for torso counter-rotation so head faces directly forward down the track
      this.headGroup.rotation.y = sinP * 0.04;
      this.headGroup.rotation.z = cosP * 0.015;
    }
  }

  /**
   * Updates camera choreography based on active preset with rock-solid zero-jitter tracking.
   */
  public updateCamera(camera: THREE.PerspectiveCamera, delta: number): void {
    if (!this.isActive) return;

    const px = this.currentPosition.x;
    const py = this.currentPosition.y + 1.25; // Pilot eye level
    const pz = this.currentPosition.z;

    const t = this.cameraElapsed;

    // Calculate steady camera target and position offsets
    let offsetX = 0;
    let offsetY = 0;
    let offsetZ = 0;
    let targetOffsetY = 0;
    let fov = 44;

    switch (this.currentCameraPreset) {
      case 'dynamic_front': {
        // Front tracking camera looking back towards pilot and starting grid
        // Smooth organic breathing offset
        const dist = 3.6;
        const breathY = Math.sin(t * 0.7) * 0.04;
        const driftZ = Math.cos(t * 0.4) * 0.18;

        offsetX = dist;
        offsetY = 0.12 + breathY;
        offsetZ = driftZ;
        targetOffsetY = 0; // eye level
        fov = 44;
        break;
      }

      case 'low_asphalt': {
        // Dramatic low track-shaving angle highlighting boots and asphalt reflections
        const dist = 3.0;
        offsetX = dist;
        offsetY = -0.92; // close to track surface (~0.33m)
        offsetZ = -0.65;
        targetOffsetY = -0.45; // look towards mid-stride
        fov = 52;
        break;
      }

      case 'profile_medium': {
        // Lateral medium dolly tracking along pit wall
        offsetX = 0.4;
        offsetY = 0.08;
        offsetZ = 3.8;
        targetOffsetY = -0.05;
        fov = 42;
        break;
      }

      case 'orbit_360': {
        // Continuous fluid 360 sweep around the pilot
        const orbitRadius = 3.8;
        const orbitSpeed = 0.24; // rad/sec
        const angle = t * orbitSpeed;

        offsetX = Math.cos(angle) * orbitRadius;
        offsetY = 0.15 + Math.sin(t * 0.35) * 0.2;
        offsetZ = Math.sin(angle) * orbitRadius;
        targetOffsetY = 0;
        fov = 46;
        break;
      }
    }

    // Desired world-space camera position & lookAt target
    this._vCamPos.set(px + offsetX, py + offsetY, pz + offsetZ);
    this._vTarget.set(px, py + targetOffsetY, pz);

    // If preset just switched, smoothly interpolate camera to new angle
    if (this.presetTransitionAlpha < 1.0) {
      this.presetTransitionAlpha = Math.min(1.0, this.presetTransitionAlpha + delta * 2.8);
      camera.position.lerp(this._vCamPos, 0.16);
      this._vSmoothTarget.lerp(this._vTarget, 0.16);
      camera.lookAt(this._vSmoothTarget);
    } else {
      // In steady tracking: camera is solidly locked to the pilot's forward translation
      // This completely eliminates frame delta jitter and lookAt parallax shear
      camera.position.copy(this._vCamPos);
      camera.lookAt(this._vTarget);
      this._vSmoothTarget.copy(this._vTarget);
    }

    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, fov, 0.1);
      camera.updateProjectionMatrix();
    }
  }

  /**
   * Clean memory disposal
   */
  public dispose(): void {
    this.deactivate();
    this.scene.remove(this.rootGroup);

    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }

    this.rootGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material?.dispose();
        }
      }
    });
  }
}
