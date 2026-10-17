/**
 * PilotPresentationOverlay.tsx
 * Ultra-Clean Cinematic Presentation for Apex GT Career Mode.
 * 
 * Philosophy:
 * - 100% Clean cinematic viewport: No bulky cards, no telemetry widgets, no intrusive buttons.
 * - Ultra-subtle, non-intrusive floating camera switcher (minimal translucent pill in top-right).
 * - Simple, pure typography subtitles synchronized with narrator audio without flashy animations.
 * - Non-intrusive keyboard navigation:
 *   - ESC / Enter: Skip directly to starting grid
 *   - Space: Pause / Resume voice narration & pilot stride
 *   - 1 / 2 / 3 / 4 or C: Seamless camera angle change
 *   - F: Toggle fullscreen
 * - Silky smooth fade-in when entering and fade-out when finishing into the starting grid.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Camera } from 'lucide-react';
import { PilotCameraPreset } from '../game/pilot/PilotWalkManager';
import { CustomLiverySettings } from '../game/career/CareerTypes';

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
  },
  {
    id: 2,
    startSec: 4.8,
    endSec: 12.2,
    speaker: 'PILOTO OFICIAL',
    role: 'APEX GT RACING TEAM',
    text: '«Si estás aquí hoy, no es para ver la carrera desde la grada... es para dejar tu nombre grabado con fuego en cada curva.»',
  },
  {
    id: 3,
    startSec: 12.2,
    endSec: 20.4,
    speaker: 'PILOTO OFICIAL',
    role: 'APEX GT RACING TEAM',
    text: '«Siente el calor del asfalto bajo las botas y escucha los motores rugir a lo lejos. Esta pista no concede segundas oportunidades.»',
  },
  {
    id: 4,
    startSec: 20.4,
    endSec: 30.2,
    speaker: 'PILOTO OFICIAL',
    role: 'APEX GT RACING TEAM',
    text: '«Cada frenada tardía es tu billete directo a la gloria... o una cita inevitable contra las barreras de protección.»',
  },
  {
    id: 5,
    startSec: 30.2,
    endSec: 41.5,
    speaker: 'PILOTO OFICIAL',
    role: 'APEX GT RACING TEAM',
    text: '«En este Modo Carrera no basta con pisar a fondo. Vas a tener que demostrar que sabes gestionar la degradación de tus neumáticos vuelta a vuelta.»',
  },
  {
    id: 6,
    startSec: 41.5,
    endSec: 52.0,
    speaker: 'PILOTO OFICIAL',
    role: 'APEX GT RACING TEAM',
    text: '«Afinar tu trazada al milímetro, leer el ritmo del rival, proteger el vértice interior y lanzar el adelantamiento en el momento exacto.»',
  },
  {
    id: 7,
    startSec: 52.0,
    endSec: 64.0,
    speaker: 'PILOTO OFICIAL',
    role: 'APEX GT RACING TEAM',
    text: '«Tu monoplaza está listo en la pole, con los reglajes afinados al límite. Los mecánicos acaban de retirar los calentadores de neumáticos.»',
  },
  {
    id: 8,
    startSec: 64.0,
    endSec: 75.0,
    speaker: 'PILOTO OFICIAL',
    role: 'APEX GT RACING TEAM',
    text: '«Ajusta tu visor, siente los latidos de tu corazón y prepárate para los cinco semáforos rojos. ¡Vamos a por la victoria!»',
  },
  {
    id: 9,
    startSec: 75.0,
    endSec: 86.0,
    speaker: 'DIRECCIÓN DE CARRERA',
    role: 'SISTEMA FIA APEX',
    text: '«Pilotos a sus puestos. Procedimiento de salida inminente. ¡Mucha suerte!»',
  },
];

const CAMERA_PRESETS: { id: PilotCameraPreset; label: string; key: string }[] = [
  { id: 'dynamic_front', label: 'Frontal', key: '1' },
  { id: 'low_asphalt', label: 'Rasante', key: '2' },
  { id: 'profile_medium', label: 'Lateral', key: '3' },
  { id: 'orbit_360', label: '360°', key: '4' },
];

export interface PilotPresentationOverlayProps {
  onFinish: () => void;
  onSetCameraPreset: (preset: PilotCameraPreset) => void;
  onSetPaused: (paused: boolean) => void;
  onAudioTimeUpdate?: (timeSec: number) => void;
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
  onAudioTimeUpdate,
}) => {
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [activeCamera, setActiveCamera] = useState<PilotCameraPreset>('dynamic_front');
  const [activeSubtitle, setActiveSubtitle] = useState<SubtitlePhrase | null>(PILOT_PRESENTATION_SUBTITLES[0]);
  const [isFadeIn, setIsFadeIn] = useState<boolean>(false);
  const [isExiting, setIsExiting] = useState<boolean>(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeSubtitleIdRef = useRef<number>(1);
  const isExitingRef = useRef<boolean>(false);
  const onAudioTimeUpdateRef = useRef(onAudioTimeUpdate);
  onAudioTimeUpdateRef.current = onAudioTimeUpdate;
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  // Ultra-smooth exit handler with audio volume ramp-down
  const handleFinishCleanly = useCallback(() => {
    if (isExitingRef.current) return;
    isExitingRef.current = true;
    setIsExiting(true);

    const aud = audioRef.current;
    if (aud) {
      const initialVol = aud.volume;
      const startFade = performance.now();
      const fadeDuration = 600; // ms

      const fadeTimer = setInterval(() => {
        const elapsed = performance.now() - startFade;
        const progress = Math.min(1, elapsed / fadeDuration);
        try {
          aud.volume = Math.max(0, initialVol * (1 - progress));
        } catch {
          // Ignore
        }
        if (progress >= 1) {
          clearInterval(fadeTimer);
          try {
            aud.pause();
          } catch {
            // Ignore
          }
        }
      }, 40);
    }

    setTimeout(() => {
      onFinishRef.current();
    }, 650);
  }, []);

  // Soft fade-in on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsFadeIn(true);
    }, 60);
    return () => clearTimeout(timer);
  }, []);

  // Initialize and play narrator voice audio
  useEffect(() => {
    const audio = new Audio('/audio/narrator_career_intro.mp3');
    audioRef.current = audio;
    audio.preload = 'auto';
    audio.volume = 0.95;

    const handleTimeUpdate = () => {
      const cur = audio.currentTime;

      // 1. Send timestamp directly to PilotWalkManager for sample-accurate stride sync
      if (onAudioTimeUpdateRef.current) {
        onAudioTimeUpdateRef.current(cur);
      }

      // 2. Synchronize subtitle text only when phrase changes
      const foundSub = PILOT_PRESENTATION_SUBTITLES.find(
        (sub) => cur >= sub.startSec && cur < sub.endSec
      );

      if (foundSub) {
        if (foundSub.id !== activeSubtitleIdRef.current) {
          activeSubtitleIdRef.current = foundSub.id;
          setActiveSubtitle(foundSub);
        }
      } else if (cur >= 86.0) {
        if (activeSubtitleIdRef.current !== -1) {
          activeSubtitleIdRef.current = -1;
          setActiveSubtitle(null);
        }
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      onSetPaused(false);
      handleFinishCleanly();
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    audio.play().catch(() => {
      setIsPlaying(false);
    });

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.pause();
      audio.src = '';
    };
  }, [handleFinishCleanly, onSetPaused]);

  // Pause / Resume audio & 3D pilot walking
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

  // Camera selection handler
  const handleSelectCamera = useCallback((preset: PilotCameraPreset) => {
    setActiveCamera(preset);
    onSetCameraPreset(preset);
  }, [onSetCameraPreset]);

  // Keyboard navigation: Space (pause/play), ESC/Enter (finish), 1-4/C (camera), F (fullscreen)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.code === 'Escape' || e.code === 'Enter') {
        e.preventDefault();
        handleFinishCleanly();
      } else if (e.code === 'Digit1') {
        e.preventDefault();
        handleSelectCamera('dynamic_front');
      } else if (e.code === 'Digit2') {
        e.preventDefault();
        handleSelectCamera('low_asphalt');
      } else if (e.code === 'Digit3') {
        e.preventDefault();
        handleSelectCamera('profile_medium');
      } else if (e.code === 'Digit4') {
        e.preventDefault();
        handleSelectCamera('orbit_360');
      } else if (e.code === 'KeyC') {
        e.preventDefault();
        setActiveCamera((prev) => {
          const index = CAMERA_PRESETS.findIndex((p) => p.id === prev);
          const nextPreset = CAMERA_PRESETS[(index + 1) % CAMERA_PRESETS.length].id;
          onSetCameraPreset(nextPreset);
          return nextPreset;
        });
      } else if (e.code === 'KeyF') {
        e.preventDefault();
        try {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
          } else {
            document.exitFullscreen().catch(() => {});
          }
        } catch {
          // Ignored
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleFinishCleanly, handleSelectCamera, handleTogglePlay, onSetCameraPreset]);

  return (
    <div
      className={`absolute inset-0 z-40 pointer-events-none flex flex-col justify-between overflow-hidden select-none font-sans transition-opacity duration-700 ease-in-out ${
        isFadeIn && !isExiting ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* Top Bar: Only the Ultra-Subtle & Non-Intrusive Camera Selector */}
      <header className="w-full pt-4 sm:pt-6 px-6 sm:px-8 flex items-center justify-end">
        <nav
          aria-label="Selector de Cámara"
          className="pointer-events-auto flex items-center gap-1 p-1 rounded-full bg-black/35 hover:bg-black/60 backdrop-blur-md border border-white/10 hover:border-white/20 transition-all duration-300 opacity-60 hover:opacity-100 shadow-md"
        >
          <Camera className="w-3.5 h-3.5 text-neutral-400 ml-1.5 mr-0.5" />
          {CAMERA_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleSelectCamera(preset.id)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-mono tracking-wider transition-all cursor-pointer ${
                activeCamera === preset.id
                  ? 'bg-white/25 text-white font-bold border border-white/30 shadow-xs'
                  : 'text-neutral-400 hover:text-white hover:bg-white/10'
              }`}
              title={`Cámara ${preset.label} (Tecla ${preset.key})`}
            >
              {preset.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Center Cinematic Viewport: Completely Clean & Unobstructed */}
      <div className="flex-1" />

      {/* Bottom Area: Simple Non-Intrusive Subtitles & Faint Shortcut Indicator */}
      <footer className="w-full pb-8 sm:pb-12 px-6 flex flex-col items-center justify-end relative pointer-events-none">
        {/* Simple, Pure Subtitle Typography without Heavy Boxes or Distracting Animations */}
        {activeSubtitle && (
          <div className="max-w-3xl text-center px-4">
            <p
              key={activeSubtitle.id}
              className="text-base sm:text-lg md:text-xl font-normal text-white/95 leading-relaxed font-sans tracking-wide"
              style={{
                textShadow: '0 2px 4px rgba(0, 0, 0, 0.95), 0 1px 2px rgba(0, 0, 0, 0.9)',
              }}
            >
              {activeSubtitle.text}
            </p>
          </div>
        )}

        {/* Faint, Discreet ESC Shortcut Hint at Bottom-Left */}
        <div className="absolute bottom-4 left-6 text-[10px] font-mono text-neutral-500/50 uppercase tracking-widest">
          ESC · Parrilla de salida
        </div>
      </footer>
    </div>
  );
};
