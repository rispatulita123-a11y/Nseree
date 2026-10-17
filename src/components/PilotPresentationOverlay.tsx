/**
 * PilotPresentationOverlay.tsx
 * Ultra-immersive AAA Official FIA Pilot Presentation Screen for Apex GT.
 * 
 * Features:
 * - Plays high-fidelity voice narration audio (/audio/narrator_career_intro.mp3)
 * - Real-time Web Audio API soundwave & voice frequency visualizer
 * - Synchronized F1 TV broadcast subtitles with progressive phrase highlighting
 * - Interactive controls:
 *   * Play / Pause (synchronizes audio & 3D pilot walking stride)
 *   * Volume control & Mute toggle
 *   * Replay audio from start
 *   * Camera angles selector: Frontal Dinámico, Rasante Asfalto, Perfil Medio, Órbita 360°
 *   * Direct File Picker for custom 3D Pilot Model (.glb)
 *   * "Entrar a Parrilla de Salida / Comenzar Gran Premio" CTA button
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  FastForward,
  Camera,
  Upload,
  MessageSquare,
  Award,
  Zap,
  CheckCircle2,
  Sliders,
} from 'lucide-react';
import { CustomLiverySettings } from '../game/career/CareerTypes';
import { PilotCameraPreset } from '../game/pilot/PilotWalkManager';

export interface SubtitlePhrase {
  id: number;
  startSec: number;
  endSec: number;
  speaker: string;
  role: string;
  text: string;
  emphasis?: string;
}

export const PILOT_PRESENTATION_SUBTITLES: SubtitlePhrase[] = [
  {
    id: 1,
    startSec: 0.0,
    endSec: 4.8,
    speaker: 'PILOTO OFICIAL',
    role: 'APEX GT RACING TEAM',
    text: '«Hola, piloto. Bienvenido al asfalto sagrado de Apex GT.»',
    emphasis: 'Bienvenido a la competición pura',
  },
  {
    id: 2,
    startSec: 4.8,
    endSec: 12.2,
    speaker: 'PILOTO OFICIAL',
    role: 'APEX GT RACING TEAM',
    text: '«Si estás aquí hoy, no es para ver la carrera desde la grada... es para dejar tu nombre grabado con fuego en cada curva.»',
    emphasis: 'Marcando la diferencia en cada vértice',
  },
  {
    id: 3,
    startSec: 12.2,
    endSec: 20.4,
    speaker: 'PILOTO OFICIAL',
    role: 'APEX GT RACING TEAM',
    text: '«Siente el calor del asfalto bajo las botas y escucha los motores rugir a lo lejos. Esta pista no concede segundas oportunidades.»',
    emphasis: 'Adherencia límite y concentración absoluta',
  },
  {
    id: 4,
    startSec: 20.4,
    endSec: 30.2,
    speaker: 'PILOTO OFICIAL',
    role: 'APEX GT RACING TEAM',
    text: '«Cada frenada tardía es tu billete directo a la gloria... o una cita inevitable contra las barreras de protección.»',
    emphasis: 'Frenada al milímetro sin bloquear neumáticos',
  },
  {
    id: 5,
    startSec: 30.2,
    endSec: 41.5,
    speaker: 'PILOTO OFICIAL',
    role: 'APEX GT RACING TEAM',
    text: '«En este Modo Carrera no basta con pisar a fondo. Vas a tener que demostrar que sabes gestionar la degradación de tus neumáticos vuelta a vuelta.»',
    emphasis: 'Estrategia de compuestos y gestión térmica',
  },
  {
    id: 6,
    startSec: 41.5,
    endSec: 52.0,
    speaker: 'PILOTO OFICIAL',
    role: 'APEX GT RACING TEAM',
    text: '«Afinar tu trazada al milímetro, leer el ritmo del rival, proteger el vértice interior y lanzar el adelantamiento en el momento exacto.»',
    emphasis: 'Disciplina FIA y maestría en el cuerpo a cuerpo',
  },
  {
    id: 7,
    startSec: 52.0,
    endSec: 64.0,
    speaker: 'PILOTO OFICIAL',
    role: 'APEX GT RACING TEAM',
    text: '«Tu monoplaza ya te está esperando con los calentadores en la pole position. Los ingenieros tienen los reglajes a punto en boxes.»',
    emphasis: 'Monoplaza calibrado y listo en parrilla',
  },
  {
    id: 8,
    startSec: 64.0,
    endSec: 75.0,
    speaker: 'PILOTO OFICIAL',
    role: 'APEX GT RACING TEAM',
    text: '«Ahora te toca a ti decidir si has venido a rodar como uno más... o si has venido a coronarte campeón del mundo.»',
    emphasis: 'La gloria te espera en pista',
  },
  {
    id: 9,
    startSec: 75.0,
    endSec: 85.5,
    speaker: 'PILOTO OFICIAL',
    role: 'APEX GT RACING TEAM',
    text: '«Baja la visera, respira hondo y ajusta las marchas. ¡Nos vemos en la curva uno! A rodar.»',
    emphasis: '¡Semáforos listos para apagarse!',
  },
];

interface PilotPresentationOverlayProps {
  onFinish: () => void;
  onSetCameraPreset: (preset: PilotCameraPreset) => void;
  onSetPaused: (paused: boolean) => void;
  onLoadCustomModel?: (file: File) => Promise<boolean>;
  driverLivery?: CustomLiverySettings;
  circuitName?: string;
  roundNumber?: number;
  totalRounds?: number;
}

export const PilotPresentationOverlay: React.FC<PilotPresentationOverlayProps> = ({
  onFinish,
  onSetCameraPreset,
  onSetPaused,
  onLoadCustomModel,
  driverLivery,
  circuitName = 'Circuit 1 - Square Apex',
  roundNumber = 1,
  totalRounds = 5,
}) => {
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(85.08);
  const [volume, setVolume] = useState<number>(0.9);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [showSubtitles, setShowSubtitles] = useState<boolean>(true);
  const [activeCamera, setActiveCamera] = useState<PilotCameraPreset>('dynamic_front');
  const [customModelLoadedName, setCustomModelLoadedName] = useState<string | null>(null);
  const [waveAmplitudes, setWaveAmplitudes] = useState<number[]>([15, 25, 45, 60, 35, 75, 40, 20]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Initialize and play narrator voice audio
  useEffect(() => {
    const audio = new Audio('/audio/narrator_career_intro.mp3');
    audioRef.current = audio;
    audio.preload = 'auto';
    audio.volume = volume;

    const handleLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      onSetPaused(false);
      // Automatically transition to grid after voice finishes
      setTimeout(() => {
        onFinish();
      }, 1400);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    // Setup Web Audio Analyser for reactive soundwave visualization
    const setupAudioAnalyser = () => {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;

        const source = ctx.createMediaElementSource(audio);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.8;

        source.connect(analyser);
        analyser.connect(ctx.destination);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const updateWaveform = () => {
          if (analyserRef.current && isPlaying && !audio.paused) {
            analyserRef.current.getByteFrequencyData(dataArray);
            // Sample 8 frequency bands
            const bands: number[] = [];
            const step = Math.floor(dataArray.length / 8);
            for (let i = 0; i < 8; i++) {
              const val = dataArray[i * step] || 0;
              bands.push(Math.max(12, Math.min(100, (val / 255) * 100)));
            }
            setWaveAmplitudes(bands);
          } else {
            setWaveAmplitudes([12, 16, 20, 24, 20, 16, 14, 12]);
          }
          animFrameRef.current = requestAnimationFrame(updateWaveform);
        };
        animFrameRef.current = requestAnimationFrame(updateWaveform);
      } catch (e) {
        // Fallback for browsers with audio context restrictions
      }
    };

    // Auto-play audio safely
    audio.play().then(() => {
      setupAudioAnalyser();
    }).catch(() => {
      // Browser autoplay policy might require user click; will start on first user interaction
      setIsPlaying(false);
    });

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.pause();
      audio.src = '';
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  // Sync pause/resume state with 3D Pilot walking
  const handleTogglePlay = useCallback(() => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      onSetPaused(true);
    } else {
      audioRef.current.play().then(() => {
        setIsPlaying(true);
        onSetPaused(false);
      }).catch(() => {});
    }
  }, [isPlaying, onSetPaused]);

  // Replay audio from start
  const handleReplay = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    audioRef.current.play().then(() => {
      setIsPlaying(true);
      onSetPaused(false);
    }).catch(() => {});
  }, [onSetPaused]);

  // Toggle Mute
  const handleToggleMute = useCallback(() => {
    if (!audioRef.current) return;
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    audioRef.current.muted = nextMute;
  }, [isMuted]);

  // Change Volume
  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (audioRef.current) {
      audioRef.current.volume = val;
      if (val === 0) {
        setIsMuted(true);
        audioRef.current.muted = true;
      } else if (isMuted) {
        setIsMuted(false);
        audioRef.current.muted = false;
      }
    }
  }, [isMuted]);

  // Change Camera Preset
  const handleSelectCamera = useCallback((preset: PilotCameraPreset) => {
    setActiveCamera(preset);
    onSetCameraPreset(preset);
  }, [onSetCameraPreset]);

  // Custom GLB Model file upload handler
  const handleCustomFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onLoadCustomModel) return;

    const success = await onLoadCustomModel(file);
    if (success) {
      setCustomModelLoadedName(file.name);
    }
  };

  // Keyboard shortcuts: Space / Escape to skip to grid
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.code === 'Escape' || e.code === 'Enter') {
        e.preventDefault();
        onFinish();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleTogglePlay, onFinish]);

  // Identify active subtitle phrase
  const activeSubtitle = PILOT_PRESENTATION_SUBTITLES.find(
    (sub) => currentTime >= sub.startSec && currentTime < sub.endSec
  ) || PILOT_PRESENTATION_SUBTITLES[PILOT_PRESENTATION_SUBTITLES.length - 1];

  const teamColor = driverLivery?.primaryColor || '#c8102e';
  const driverName = driverLivery?.driverName || 'Piloto';
  const driverNumber = driverLivery?.driverNumber || '1';
  const teamName = driverLivery?.teamName || 'Escudería Apex';

  return (
    <div className="absolute inset-0 z-40 pointer-events-none flex flex-col justify-between overflow-hidden select-none font-sans">
      {/* Hidden file input for custom 3D Pilot GLB upload */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleCustomFileChange}
        accept=".glb,.gltf"
        className="hidden"
      />

      {/* Top Header Bar: Broadcast Info & Skip Action */}
      <div className="w-full bg-linear-to-b from-black/95 via-black/70 to-transparent pt-4 pb-10 px-6 sm:px-10 flex items-start justify-between">
        {/* Left: Driver & Circuit Broadcast Tag */}
        <div className="flex items-center gap-3.5">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center font-bold text-white text-lg shadow-lg border border-white/20"
            style={{ backgroundColor: teamColor }}
          >
            #{driverNumber}
          </div>
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400 font-['Chakra_Petch']">
              <span>PRESENTACIÓN EN PISTA</span>
              <span className="text-neutral-500">·</span>
              <span>{circuitName}</span>
              <span className="text-neutral-500">·</span>
              <span>RONDA {roundNumber}/{totalRounds}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white uppercase font-['Chakra_Petch'] flex items-center gap-2.5">
              <span>{driverName}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 font-mono font-medium border border-neutral-700">
                {teamName}
              </span>
            </h1>
          </div>
        </div>

        {/* Right: Actions (Custom Model, Mute, Skip) */}
        <div className="flex items-center gap-2.5 pointer-events-auto">
          {/* Custom GLB Loader button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-700/80 hover:border-amber-400/80 text-white text-xs font-semibold tracking-wide transition-all shadow-lg active:scale-95 cursor-pointer"
            title="Seleccionar archivo 3D de piloto (.glb)"
          >
            <Upload className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden md:inline text-neutral-200">
              {customModelLoadedName ? `Modelo: ${customModelLoadedName.slice(0, 14)}...` : 'Cargar GLB'}
            </span>
          </button>

          {/* Subtitles Toggle */}
          <button
            onClick={() => setShowSubtitles((prev) => !prev)}
            className={`p-2 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
              showSubtitles
                ? 'bg-neutral-800 text-amber-400 border-amber-400/60'
                : 'bg-neutral-900/80 text-neutral-400 border-neutral-700/80'
            }`}
            title="Activar/Desactivar Subtítulos"
          >
            <MessageSquare className="w-4 h-4" />
          </button>

          {/* Skip CTA */}
          <button
            onClick={onFinish}
            className="group flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold tracking-wider uppercase transition-all shadow-[0_0_15px_rgba(220,38,38,0.5)] active:scale-95 cursor-pointer"
            title="Ir a parrilla de salida"
          >
            <span>Entrar a Parrilla</span>
            <FastForward className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            <span className="hidden sm:inline text-[10px] text-red-200 px-1 py-0.2 bg-red-800 rounded font-mono">
              ESC
            </span>
          </button>
        </div>
      </div>

      {/* Middle Center: Subtle camera framing & floating soundwave visualizer */}
      <div className="relative flex-1 flex flex-col items-center justify-center pointer-events-none">
        {/* Real-time Voice Waveform Visualizer */}
        {isPlaying && (
          <div className="absolute top-6 flex items-end gap-1.5 px-4 py-2 rounded-full bg-black/60 border border-white/10 backdrop-blur-md shadow-2xl animate-in fade-in duration-300">
            <span className="text-[10px] font-mono text-amber-400 font-bold uppercase tracking-wider mr-1.5 flex items-center gap-1">
              <Zap className="w-3 h-3 text-amber-400 animate-pulse" />
              VOZ EN VIVO
            </span>
            {waveAmplitudes.map((amp, idx) => (
              <div
                key={idx}
                className="w-1 bg-amber-400 rounded-full transition-all duration-75"
                style={{
                  height: `${Math.max(4, amp * 0.28)}px`,
                  opacity: 0.6 + (amp / 100) * 0.4,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bottom Letterbox: Subtitles, Voice Audio Controls & Camera Angle Bar */}
      <div className="w-full bg-linear-to-t from-black/98 via-black/85 to-transparent pt-12 pb-6 px-6 sm:px-12 flex flex-col items-center">
        {/* Dynamic Subtitle Card (FIA Official Broadcast styling) */}
        {showSubtitles && (
          <div className="w-full max-w-4xl mb-4 pointer-events-auto">
            <div className="p-4 sm:p-5 rounded-2xl bg-neutral-900/90 border border-neutral-700/80 shadow-2xl backdrop-blur-xl transition-all">
              {/* Speaker Header */}
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-neutral-800">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full animate-ping"
                    style={{ backgroundColor: teamColor }}
                  />
                  <span className="text-xs font-bold tracking-wider text-white font-['Chakra_Petch'] uppercase">
                    {activeSubtitle.speaker}
                  </span>
                  <span className="text-[11px] text-neutral-400">· {activeSubtitle.role}</span>
                </div>
                {activeSubtitle.emphasis && (
                  <span className="text-[11px] font-semibold text-amber-400 uppercase tracking-wide font-mono hidden sm:inline">
                    {activeSubtitle.emphasis}
                  </span>
                )}
              </div>

              {/* Subtitle Dialogue Text */}
              <p className="text-base sm:text-lg font-medium text-neutral-100 leading-relaxed font-sans">
                {activeSubtitle.text}
              </p>
            </div>
          </div>
        )}

        {/* Audio Timeline & Interactive Controls Bar */}
        <div className="w-full max-w-4xl flex flex-col sm:flex-row items-center justify-between gap-4 pointer-events-auto bg-neutral-950/80 border border-neutral-800/90 rounded-2xl p-3 sm:px-5 backdrop-blur-md shadow-2xl">
          {/* Left: Audio Playback Controls */}
          <div className="flex items-center gap-3">
            {/* Play/Pause */}
            <button
              onClick={handleTogglePlay}
              className="w-9 h-9 rounded-xl bg-amber-400 hover:bg-amber-300 text-neutral-950 flex items-center justify-center font-bold transition-all active:scale-95 cursor-pointer shadow-lg"
              title={isPlaying ? 'Pausar locución y caminata' : 'Reanudar locución'}
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
            </button>

            {/* Replay */}
            <button
              onClick={handleReplay}
              className="p-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white border border-neutral-800 transition-all cursor-pointer"
              title="Reiniciar diálogo"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            {/* Mute Toggle */}
            <button
              onClick={handleToggleMute}
              className="p-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white border border-neutral-800 transition-all cursor-pointer"
              title={isMuted ? 'Activar sonido' : 'Silenciar'}
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-amber-400" />}
            </button>

            {/* Volume slider */}
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className="w-16 sm:w-20 accent-amber-400 cursor-pointer h-1.5 bg-neutral-800 rounded-lg"
              title="Volumen de voz"
            />

            {/* Time indicator */}
            <span className="text-xs font-mono text-neutral-400 ml-1">
              {Math.floor(currentTime / 60)}:
              {String(Math.floor(currentTime % 60)).padStart(2, '0')} /{' '}
              {Math.floor(duration / 60)}:{String(Math.floor(duration % 60)).padStart(2, '0')}
            </span>
          </div>

          {/* Right: Camera Angle Selector */}
          <div className="flex items-center gap-1.5 bg-neutral-900/90 p-1 rounded-xl border border-neutral-800">
            <span className="text-[10px] uppercase font-bold text-neutral-400 px-2 flex items-center gap-1 font-mono">
              <Camera className="w-3.5 h-3.5 text-neutral-400" />
              CÁMARA:
            </span>

            <button
              onClick={() => handleSelectCamera('dynamic_front')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                activeCamera === 'dynamic_front'
                  ? 'bg-amber-400 text-neutral-950 font-bold shadow'
                  : 'text-neutral-300 hover:text-white hover:bg-neutral-800'
              }`}
            >
              Frontal
            </button>

            <button
              onClick={() => handleSelectCamera('low_asphalt')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                activeCamera === 'low_asphalt'
                  ? 'bg-amber-400 text-neutral-950 font-bold shadow'
                  : 'text-neutral-300 hover:text-white hover:bg-neutral-800'
              }`}
            >
              Rasante
            </button>

            <button
              onClick={() => handleSelectCamera('profile_medium')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                activeCamera === 'profile_medium'
                  ? 'bg-amber-400 text-neutral-950 font-bold shadow'
                  : 'text-neutral-300 hover:text-white hover:bg-neutral-800'
              }`}
            >
              Lateral
            </button>

            <button
              onClick={() => handleSelectCamera('orbit_360')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                activeCamera === 'orbit_360'
                  ? 'bg-amber-400 text-neutral-950 font-bold shadow'
                  : 'text-neutral-300 hover:text-white hover:bg-neutral-800'
              }`}
            >
              360°
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
