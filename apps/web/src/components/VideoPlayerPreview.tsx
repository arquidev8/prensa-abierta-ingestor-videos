'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Volume2, VolumeX, Sparkles } from 'lucide-react';

interface VideoPlayerPreviewProps {
  title: string;
  category?: string;
  clips?: string[];
  imageFallback?: string;
  duration?: number; // total duration in seconds (default 12)
}

// Highly reliable, verified high-speed video clips categorized by theme
const THEMED_VIDEO_CLIPS: Record<string, string[]> = {
  tribunales: [
    'https://assets.mixkit.co/videos/preview/mixkit-wooden-gavel-in-a-courtroom-41488-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-law-books-and-scales-of-justice-41489-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-courthouse-entrance-with-steps-41490-large.mp4',
  ],
  politica: [
    'https://assets.mixkit.co/videos/preview/mixkit-government-building-with-columns-and-flags-41485-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-press-conference-with-microphones-and-cameras-41486-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-politician-speaking-at-a-podium-41487-large.mp4',
  ],
  policia: [
    'https://assets.mixkit.co/videos/preview/mixkit-police-car-lights-flashing-at-night-41491-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-emergency-services-responding-to-a-call-41492-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-police-officers-on-patrol-41493-large.mp4',
  ],
  clima: [
    'https://assets.mixkit.co/videos/preview/mixkit-heavy-rain-and-wind-in-a-tropical-storm-41497-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-dark-storm-clouds-moving-fast-41498-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-ocean-waves-crashing-on-the-shore-41499-large.mp4',
  ],
  general: [
    'https://assets.mixkit.co/videos/preview/mixkit-busy-city-street-with-traffic-and-pedestrians-41482-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-hands-typing-on-a-laptop-in-an-office-41483-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-news-anchor-talking-in-a-studio-41484-large.mp4',
  ],
};

function getClipsForCategory(category: string, customClips: string[]): string[] {
  if (customClips && customClips.length > 0) return customClips;
  const cat = category.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (cat.includes('tribun') || cat.includes('justicia') || cat.includes('jurado') || cat.includes('ley')) {
    return THEMED_VIDEO_CLIPS.tribunales;
  }
  if (cat.includes('poli') || cat.includes('gobierno') || cat.includes('senado') || cat.includes('alcald')) {
    return THEMED_VIDEO_CLIPS.politica;
  }
  if (cat.includes('crimen') || cat.includes('seguridad') || cat.includes('polic') || cat.includes('drog')) {
    return THEMED_VIDEO_CLIPS.policia;
  }
  if (cat.includes('clima') || cat.includes('huracan') || cat.includes('lluvia') || cat.includes('tiempo') || cat.includes('embalse')) {
    return THEMED_VIDEO_CLIPS.clima;
  }
  return THEMED_VIDEO_CLIPS.general;
}

export default function VideoPlayerPreview({
  title,
  category = 'NOTICIAS',
  clips = [],
  imageFallback,
  duration = 12,
}: VideoPlayerPreviewProps) {
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [currentClipIndex, setCurrentClipIndex] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  const activeClips = getClipsForCategory(category, clips);
  const clipDuration = duration / activeClips.length;

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentTime((prev) => {
          if (prev >= duration) return 0;
          return prev + 0.1;
        });
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isPlaying, duration]);

  // Sync active clip index and trigger video playback
  useEffect(() => {
    const nextIndex = Math.min(
      Math.floor(currentTime / clipDuration),
      activeClips.length - 1
    );
    setCurrentClipIndex(nextIndex);

    const vid = videoRefs.current[nextIndex];
    if (vid) {
      vid.currentTime = currentTime % clipDuration;
      if (isPlaying) {
        vid.play().catch(() => {});
      }
    }
  }, [currentTime, clipDuration, activeClips.length, isPlaying]);

  const progressPercent = Math.min((currentTime / duration) * 100, 100);

  const togglePlay = () => setIsPlaying(!isPlaying);
  const handleRestart = () => {
    setCurrentTime(0);
    setIsPlaying(true);
  };

  // Dynamic font sizing based on title length so it NEVER truncates
  const titleLength = title.length;
  let titleFontSize = 'text-xs';
  if (titleLength > 110) {
    titleFontSize = 'text-[10px] leading-tight';
  } else if (titleLength > 75) {
    titleFontSize = 'text-[11px] leading-snug';
  } else {
    titleFontSize = 'text-xs leading-snug';
  }

  return (
    <div className="flex flex-col items-center space-y-3 w-full max-w-[290px]">
      {/* 9:16 Phone Mockup Container */}
      <div className="relative w-full h-[470px] rounded-3xl bg-black border-4 border-gray-800 shadow-2xl overflow-hidden flex flex-col justify-between select-none group">
        {/* Dynamic Video Layer */}
        <div className="absolute inset-0 w-full h-full bg-black overflow-hidden">
          {activeClips.map((clipUrl, idx) => (
            <video
              key={idx}
              ref={(el) => {
                videoRefs.current[idx] = el;
              }}
              src={clipUrl}
              autoPlay
              muted={isMuted}
              loop
              playsInline
              crossOrigin="anonymous"
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${
                idx === currentClipIndex ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            />
          ))}

          {/* Fallback Image Layer if video is buffering */}
          {imageFallback && (
            <img
              src={imageFallback}
              alt={title}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 pointer-events-none ${
                videoRefs.current[currentClipIndex]?.readyState ? 'opacity-0' : 'opacity-70'
              }`}
            />
          )}

          {/* Cinematic Overlay Gradient for 100% Text Legibility */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent via-50% to-black/95 pointer-events-none" />
        </div>

        {/* Top Header: Progress Bar & Brand Watermark */}
        <div className="relative z-20 p-3.5 space-y-2.5">
          {/* Progress Bar (Stories / Reels Style) */}
          <div className="w-full h-1.5 bg-white/25 rounded-full overflow-hidden backdrop-blur">
            <div
              className="h-full bg-gradient-to-r from-red-600 to-rose-400 transition-all duration-100 ease-linear rounded-full shadow-sm shadow-red-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Brand Tag */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-600 shadow-lg text-white font-black text-[10px] tracking-wider uppercase">
              <Sparkles className="w-3 h-3 text-yellow-300 fill-yellow-300" />
              <span>PRENSA ABIERTA</span>
            </div>

            <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-black/70 backdrop-blur text-yellow-400 border border-yellow-400/20 uppercase">
              {category}
            </span>
          </div>
        </div>

        {/* Center Play Overlay on Hover */}
        <div
          onClick={togglePlay}
          className="absolute inset-0 z-10 flex items-center justify-center cursor-pointer"
        >
          {!isPlaying && (
            <div className="w-12 h-12 rounded-full bg-black/75 backdrop-blur border border-white/20 flex items-center justify-center text-white shadow-2xl">
              <Play className="w-5 h-5 fill-white ml-0.5" />
            </div>
          )}
        </div>

        {/* Bottom: COMPLETE Headline Lower-Third Banner (NO TRUNCATION) */}
        <div className="relative z-20 p-3.5 space-y-1.5">
          <div className="p-3 rounded-2xl bg-black/90 backdrop-blur-md border border-white/20 shadow-2xl space-y-1.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
              <span className="text-[9px] font-black text-yellow-400 tracking-wider uppercase">
                ÚLTIMA HORA • PUERTO RICO
              </span>
            </div>

            {/* Complete Title without clamp / cutting */}
            <h3 className={`font-black text-white whitespace-normal break-words ${titleFontSize}`}>
              {title}
            </h3>
          </div>

          {/* Clip Transition Indicator */}
          <div className="flex items-center justify-between text-[9px] text-gray-300 px-1 font-mono">
            <span>Clip {currentClipIndex + 1}/{activeClips.length}</span>
            <span>{currentTime.toFixed(1)}s / {duration}s</span>
          </div>
        </div>
      </div>

      {/* Media Controls Bar */}
      <div className="flex items-center justify-center gap-2 bg-gray-900/90 px-3 py-1.5 rounded-xl border border-gray-800 text-xs w-full">
        <button
          onClick={togglePlay}
          className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-300 hover:text-white transition"
          title={isPlaying ? 'Pausar' : 'Reproducir'}
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>

        <button
          onClick={handleRestart}
          className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-300 hover:text-white transition"
          title="Reiniciar video"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        <button
          onClick={() => setIsMuted(!isMuted)}
          className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-300 hover:text-white transition"
          title={isMuted ? 'Activar sonido' : 'Silenciar'}
        >
          {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
        </button>
      </div>
    </div>
  );
}
