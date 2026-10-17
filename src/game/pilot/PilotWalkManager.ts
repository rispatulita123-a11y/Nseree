/**
 * PilotWalkManager.ts
 * Manages the 3D Animated Pilot walking on the asphalt of Circuit 1 (Square Apex).
 * 
 * Capabilities:
 * 1. Checks and loads the user's custom animated GLB:
 *    - /models/mono_competicion_aurora_gp27_rig_caminata_v46_optimizado.glb
 *    - Direct File / Blob / object URL uploads via user file picker
 * 2. If the external GLB is missing or loading, seamlessly builds an ultra-detailed
 *    procedural 3D Pilot Model with:
 *    - Official F1 aerodynamic helmet with tinted reflective visor
 *    - Team-colored racing suit matching player's custom livery
 *    - Sponsor patches, racing gloves and track boots
 *    - Articulated procedural skeletal walk cycle (hips, legs, knees, ankles, arms, torso, head)
 * 3. 4 cinematic camera presets:
 *    - 'dynamic_front': Dynamic front tracking at eye level with car/grid in background
 *    - 'low_asphalt': Low track-level perspective highlighting boots, stride & asphalt reflections
 *    - 'profile_medium': Smooth lateral dolly tracking
 *    - 'orbit_360': Continuous fluid 360° orbital presentation
 * 4. Zero runtime allocations (scratch vectors) for rock-solid 60 / 120 FPS performance.
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

  // Procedural pilot fallback rig
  private proceduralRig: THREE.Group | null = null;
  private leftLegGroup: THREE.Group | null = null;
  private rightLegGroup: THREE.Group | null = null;
  private leftArmGroup: THREE.Group | null = null;
  private rightArmGroup: THREE.Group | null = null;
  private torsoGroup: THREE.Group | null = null;
  private headGroup: THREE.Group | null = null;
  private walkPhase: number = 0;

  // Walk physics & trajectory on Circuit 1 Main Straight
  // Circuit 1 starting grid: X = -18, Z = -128, Y = 0.45.
  // We start the pilot at X = -12.0, Z = -128.0, and walk along +X (towards Turn 1 at X = 118.0)
  private startPosition = new THREE.Vector3(-12.0, 0.02, -128.0);
  private currentPosition = new THREE.Vector3(-12.0, 0.02, -128.0);
  private walkSpeed: number = 1.28; // ~1.28 m/s realistic determined stride
  private totalDistanceWalked: number = 0;
  private headingAngle: number = Math.PI / 2; // Facing +X down the main straight

  // Camera choreography
  private currentCameraPreset: PilotCameraPreset = 'dynamic_front';
  private cameraElapsed: number = 0;
  private cameraFov: number = 48;

  // Scratch vectors to guarantee 0 GC allocations
  private readonly _vTarget = new THREE.Vector3();
  private readonly _vCamPos = new THREE.Vector3();
  private readonly _vForward = new THREE.Vector3();
  private readonly _vRight = new THREE.Vector3();

  // Callbacks
  public onFinished?: () => void;
  public onModelLoaded?: (name: string) => void;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'PilotWalkScene';
    this.rootGroup.visible = false;
    this.scene.add(this.rootGroup);

    // Try loading the default uploaded model in background
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
    // Clean up previous GLTF if any
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

    // Enable shadows
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          child.material.roughness = Math.max(0.2, child.material.roughness ?? 0.4);
          child.material.envMapIntensity = 1.2;
        }
      }
    });

    // Auto-scale to human height (~1.80m)
    const bbox = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const targetHeight = 1.80;
    if (size.y > 0.05) {
      const scale = targetHeight / size.y;
      model.scale.set(scale, scale, scale);
    }

    // Orient facing forward along +X
    model.rotation.y = this.headingAngle;

    // Setup animation mixer
    if (gltf.animations && gltf.animations.length > 0) {
      this.mixer = new THREE.AnimationMixer(model);
      // Prefer clip named walk/caminata or first clip
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
   * Builds an articulated high-fidelity procedural 3D pilot rig
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
      roughness: 0.55,
      metalness: 0.1,
    });
    const suitAccentMat = new THREE.MeshStandardMaterial({
      color: accentColorHex,
      roughness: 0.45,
      metalness: 0.2,
    });
    const darkSuitMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.6,
      metalness: 0.1,
    });
    const helmetMat = new THREE.MeshStandardMaterial({
      color: 0xf4f4f5,
      roughness: 0.15,
      metalness: 0.35,
    });
    const visorMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0a0f,
      roughness: 0.05,
      metalness: 0.9,
      transmission: 0.2,
      ior: 1.6,
      reflectivity: 0.95,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
    });
    const goldVisorMat = new THREE.MeshPhysicalMaterial({
      color: 0xf59e0b,
      roughness: 0.1,
      metalness: 0.85,
      clearcoat: 1.0,
    });
    const gloveMat = new THREE.MeshStandardMaterial({
      color: 0x27272a,
      roughness: 0.4,
    });
    const bootMat = new THREE.MeshStandardMaterial({
      color: 0x09090b,
      roughness: 0.7,
      metalness: 0.05,
    });

    // 1. Torso & Chest
    const torso = new THREE.Group();
    torso.position.y = 0.95;

    // Main chest
    const chestGeo = new THREE.BoxGeometry(0.42, 0.52, 0.24);
    const chestMesh = new THREE.Mesh(chestGeo, suitMat);
    chestMesh.position.y = 0.26;
    chestMesh.castShadow = true;
    torso.add(chestMesh);

    // Sponsor / Livery vertical stripe
    const stripeGeo = new THREE.BoxGeometry(0.12, 0.52, 0.245);
    const stripeMesh = new THREE.Mesh(stripeGeo, suitAccentMat);
    stripeMesh.position.y = 0.26;
    torso.add(stripeMesh);

    // Racing collar
    const collarGeo = new THREE.CylinderGeometry(0.14, 0.15, 0.08, 16);
    const collarMesh = new THREE.Mesh(collarGeo, darkSuitMat);
    collarMesh.position.y = 0.54;
    torso.add(collarMesh);

    // Driver Number Badge on chest
    const badgeGeo = new THREE.BoxGeometry(0.10, 0.10, 0.02);
    const badgeMesh = new THREE.Mesh(badgeGeo, suitAccentMat);
    badgeMesh.position.set(0.12, 0.36, 0.125);
    torso.add(badgeMesh);

    // 2. Head & Helmet
    const head = new THREE.Group();
    head.position.y = 0.58;

    // F1 Aerodynamic Helmet
    const helmetGeo = new THREE.SphereGeometry(0.165, 24, 20);
    helmetGeo.scale(0.95, 1.08, 1.15);
    const helmetMesh = new THREE.Mesh(helmetGeo, helmetMat);
    helmetMesh.position.y = 0.16;
    helmetMesh.castShadow = true;
    head.add(helmetMesh);

    // Chin Bar
    const chinGeo = new THREE.BoxGeometry(0.19, 0.13, 0.18);
    const chinMesh = new THREE.Mesh(chinGeo, helmetMat);
    chinMesh.position.set(0, 0.09, 0.11);
    chinMesh.castShadow = true;
    head.add(chinMesh);

    // Helmet Rear Aero Spoiler
    const spoilerGeo = new THREE.BoxGeometry(0.18, 0.04, 0.12);
    const spoilerMesh = new THREE.Mesh(spoilerGeo, suitAccentMat);
    spoilerMesh.position.set(0, 0.24, -0.12);
    spoilerMesh.rotation.x = 0.3;
    head.add(spoilerMesh);

    // High-Tech Reflective Visor
    const visorGeo = new THREE.CylinderGeometry(0.166, 0.166, 0.10, 24, 1, false, Math.PI * 0.72, Math.PI * 0.56);
    const visorMesh = new THREE.Mesh(visorGeo, goldVisorMat);
    visorMesh.position.set(0, 0.17, 0.04);
    visorMesh.rotation.y = Math.PI / 2;
    head.add(visorMesh);

    // Visor Tear-off side clips
    const clipGeo = new THREE.BoxGeometry(0.02, 0.04, 0.04);
    const clipLeft = new THREE.Mesh(clipGeo, darkSuitMat);
    clipLeft.position.set(-0.16, 0.17, 0.07);
    const clipRight = new THREE.Mesh(clipGeo, darkSuitMat);
    clipRight.position.set(0.16, 0.17, 0.07);
    head.add(clipLeft, clipRight);

    torso.add(head);

    // 3. Arms & Racing Gloves
    const createArm = (isLeft: boolean) => {
      const armGroup = new THREE.Group();
      const sign = isLeft ? -1 : 1;
      armGroup.position.set(sign * 0.26, 0.46, 0);

      // Shoulder pad
      const shoulderGeo = new THREE.SphereGeometry(0.08, 14, 12);
      const shoulderMesh = new THREE.Mesh(shoulderGeo, suitAccentMat);
      armGroup.add(shoulderMesh);

      // Upper arm
      const upperGeo = new THREE.CylinderGeometry(0.065, 0.055, 0.28, 12);
      const upperMesh = new THREE.Mesh(upperGeo, suitMat);
      upperMesh.position.y = -0.14;
      upperMesh.castShadow = true;
      armGroup.add(upperMesh);

      // Forearm & Glove
      const foreGeo = new THREE.CylinderGeometry(0.055, 0.048, 0.26, 12);
      const foreMesh = new THREE.Mesh(foreGeo, darkSuitMat);
      foreMesh.position.set(0, -0.38, 0.03);
      foreMesh.rotation.x = 0.2;
      foreMesh.castShadow = true;
      armGroup.add(foreMesh);

      // Glove Clenched/Natural Stride Hand
      const handGeo = new THREE.BoxGeometry(0.07, 0.09, 0.06);
      const handMesh = new THREE.Mesh(handGeo, gloveMat);
      handMesh.position.set(0, -0.52, 0.06);
      armGroup.add(handMesh);

      return armGroup;
    };

    const leftArm = createArm(true);
    const rightArm = createArm(false);
    torso.add(leftArm, rightArm);

    // 4. Pelvis & Articulated Legs
    const pelvis = new THREE.Group();
    pelvis.position.y = 0.95;

    const pelvisGeo = new THREE.BoxGeometry(0.36, 0.16, 0.22);
    const pelvisMesh = new THREE.Mesh(pelvisGeo, darkSuitMat);
    pelvisMesh.position.y = -0.08;
    pelvisMesh.castShadow = true;
    pelvis.add(pelvisMesh);

    const createLeg = (isLeft: boolean) => {
      const legGroup = new THREE.Group();
      const sign = isLeft ? -1 : 1;
      legGroup.position.set(sign * 0.13, -0.14, 0);

      // Thigh
      const thighGeo = new THREE.CylinderGeometry(0.08, 0.068, 0.40, 14);
      const thighMesh = new THREE.Mesh(thighGeo, suitMat);
      thighMesh.position.y = -0.20;
      thighMesh.castShadow = true;
      legGroup.add(thighMesh);

      // Knee pad
      const kneeGeo = new THREE.BoxGeometry(0.10, 0.08, 0.08);
      const kneeMesh = new THREE.Mesh(kneeGeo, darkSuitMat);
      kneeMesh.position.set(0, -0.40, 0.03);
      legGroup.add(kneeMesh);

      // Shin / Calf
      const shinGeo = new THREE.CylinderGeometry(0.068, 0.055, 0.38, 14);
      const shinMesh = new THREE.Mesh(shinGeo, suitMat);
      shinMesh.position.y = -0.58;
      shinMesh.castShadow = true;
      legGroup.add(shinMesh);

      // Track Boot
      const bootGeo = new THREE.BoxGeometry(0.09, 0.11, 0.22);
      const bootMesh = new THREE.Mesh(bootGeo, bootMat);
      bootMesh.position.set(0, -0.76, 0.04);
      bootMesh.castShadow = true;
      legGroup.add(bootMesh);

      // White/accent racing sole
      const soleGeo = new THREE.BoxGeometry(0.095, 0.02, 0.23);
      const soleMesh = new THREE.Mesh(soleGeo, suitAccentMat);
      soleMesh.position.set(0, -0.81, 0.04);
      legGroup.add(soleMesh);

      return legGroup;
    };

    const leftLeg = createLeg(true);
    const rightLeg = createLeg(false);
    pelvis.add(leftLeg, rightLeg);

    pilotGroup.add(torso, pelvis);

    // Save references for procedural walk animation loop
    this.torsoGroup = torso;
    this.headGroup = head;
    this.leftArmGroup = leftArm;
    this.rightArmGroup = rightArm;
    this.leftLegGroup = leftLeg;
    this.rightLegGroup = rightLeg;

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

    // Reset trajectory on Circuit 1 main straight
    // Start pilot at X = -12.0, Z = -128.0 (car is parked on pole at X = -18.0, Z = -128.0)
    this.currentPosition.copy(this.startPosition);
    this.rootGroup.position.copy(this.currentPosition);
    this.rootGroup.visible = true;

    // If custom GLTF is not loaded, build / refresh the procedural rig with player livery
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
   * Sets the camera choreography preset
   */
  public setCameraPreset(preset: PilotCameraPreset): void {
    this.currentCameraPreset = preset;
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
   * Updates pilot physics, walk cycle, and animation mixer every frame
   */
  public update(delta: number): void {
    if (!this.isActive) return;

    const dt = Math.min(delta, 0.1);
    if (!this.isPaused) {
      this.cameraElapsed += dt;

      // 1. Move forward down the track along +X (yaw = Math.PI / 2)
      const forwardStep = this.walkSpeed * dt;
      this.currentPosition.x += forwardStep;
      this.totalDistanceWalked += forwardStep;
      this.rootGroup.position.copy(this.currentPosition);

      // 2. Update GLTF AnimationMixer if available
      if (this.mixer) {
        this.mixer.update(dt);
      }

      // 3. Update Procedural Rig Walk Cycle if active
      if (this.proceduralRig && !this.isUsingCustomGltf) {
        this.updateProceduralWalk(dt);
      }
    }
  }

  /**
   * Procedural inverse-kinematic walk cycle calculation (60/120 FPS buttery smooth)
   */
  private updateProceduralWalk(dt: number): void {
    // 1 full stride cycle = ~0.88s (approx 110 steps/min)
    const strideCadence = 6.8; // rad/sec
    this.walkPhase += dt * strideCadence;

    const sinP = Math.sin(this.walkPhase);
    const cosP = Math.cos(this.walkPhase);
    const doubleSin = Math.sin(this.walkPhase * 2.0);

    // A. Legs: Opposite swing with natural knee bend
    if (this.leftLegGroup && this.rightLegGroup) {
      const legAmplitude = 0.52; // rad (~30 deg)
      this.leftLegGroup.rotation.x = sinP * legAmplitude;
      this.rightLegGroup.rotation.x = -sinP * legAmplitude;

      // Subtle knee flex when swinging forward
      const leftShin = this.leftLegGroup.children[2] as THREE.Mesh | undefined;
      const rightShin = this.rightLegGroup.children[2] as THREE.Mesh | undefined;
      if (leftShin) {
        leftShin.rotation.x = Math.max(0, -sinP * 0.45);
      }
      if (rightShin) {
        rightShin.rotation.x = Math.max(0, sinP * 0.45);
      }
    }

    // B. Arms: Natural counter-swing to balance stride
    if (this.leftArmGroup && this.rightArmGroup) {
      const armAmplitude = 0.42;
      this.leftArmGroup.rotation.x = -sinP * armAmplitude;
      this.rightArmGroup.rotation.x = sinP * armAmplitude;

      // Slight inward forearm cant
      this.leftArmGroup.rotation.z = 0.08 + Math.abs(sinP) * 0.04;
      this.rightArmGroup.rotation.z = -0.08 - Math.abs(sinP) * 0.04;
    }

    // C. Pelvis & Torso: Vertical bounce & slight lateral weight transfer
    if (this.torsoGroup) {
      // Pelvis drops slightly at mid-step
      this.torsoGroup.position.y = 0.95 + Math.abs(doubleSin) * 0.028;
      // Slight shoulder counter-rotation
      this.torsoGroup.rotation.y = -sinP * 0.06;
      // Lateral tilt
      this.torsoGroup.rotation.z = cosP * 0.025;
    }

    // D. Head: Gaze remains fixed forward on track horizon
    if (this.headGroup) {
      this.headGroup.rotation.y = sinP * 0.04;
      this.headGroup.rotation.z = -cosP * 0.02;
    }
  }

  /**
   * Updates camera choreography based on active preset
   */
  public updateCamera(camera: THREE.PerspectiveCamera, delta: number): void {
    if (!this.isActive) return;

    const px = this.currentPosition.x;
    const py = this.currentPosition.y + 1.25; // Eye level
    const pz = this.currentPosition.z;

    this._vTarget.set(px, py, pz);

    const t = this.cameraElapsed;

    switch (this.currentCameraPreset) {
      case 'dynamic_front': {
        // Camera floats in front of pilot at X + 4.2m, tracking backward with subtle breathing motion
        // Pilot walks towards +X, so camera at +X looks back towards -X
        const dist = 3.8;
        const breathY = Math.sin(t * 0.8) * 0.06;
        const driftZ = Math.cos(t * 0.5) * 0.25;

        this._vCamPos.set(px + dist, py + 0.15 + breathY, pz + driftZ);
        this.cameraFov = 44;
        break;
      }

      case 'low_asphalt': {
        // Dramatic low track-shaving angle (0.28m height) looking up at the pilot's boots and stride
        const dist = 3.2;
        this._vCamPos.set(px + dist, 0.28, pz - 0.65);
        this._vTarget.set(px, py - 0.4, pz);
        this.cameraFov = 54;
        break;
      }

      case 'profile_medium': {
        // Side dolly shot tracking the pilot alongside the guardrail
        const sideDist = 4.0;
        this._vCamPos.set(px + 0.5, py + 0.1, pz + sideDist);
        this.cameraFov = 42;
        break;
      }

      case 'orbit_360': {
        // Continuous smooth orbital sweep around the pilot
        const orbitRadius = 4.2;
        const orbitSpeed = 0.28; // rad/sec
        const angle = t * orbitSpeed;
        const ox = Math.cos(angle) * orbitRadius;
        const oz = Math.sin(angle) * orbitRadius;
        const oy = 1.35 + Math.sin(t * 0.4) * 0.3;

        this._vCamPos.set(px + ox, py + oy, pz + oz);
        this.cameraFov = 46;
        break;
      }
    }

    // Smooth camera damping to eliminate any micro-jitter
    const smoothFactor = Math.min(1.0, delta * 12.0);
    camera.position.lerp(this._vCamPos, smoothFactor);
    camera.lookAt(this._vTarget);

    if (Math.abs(camera.fov - this.cameraFov) > 0.1) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, this.cameraFov, smoothFactor);
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
