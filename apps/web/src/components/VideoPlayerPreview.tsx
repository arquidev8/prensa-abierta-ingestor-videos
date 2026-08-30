'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Volume2, VolumeX, Film } from 'lucide-react';

interface VideoPlayerPreviewProps {
  title: string;
  category?: string;
  clips?: string[];
  imageFallback?: string;
  duration?: number; // total duration in seconds (default 12)
  // Id de la noticia: hace determinística la elección del clip de categoría
  // (vía `seed` en /api/media/category-video) para que este preview muestre
  // exactamente el mismo b-roll que después se usa al descargar el video real.
  newsId?: string;
}

export default function VideoPlayerPreview({
  title,
  category = 'NOTICIAS',
  clips = [],
  imageFallback,
  duration = 12,
  newsId,
}: VideoPlayerPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [videoError, setVideoError] = useState<boolean>(false);
  const [isVideoLoaded, setIsVideoLoaded] = useState<boolean>(false);

  // URL del video de la categoría en assets/contenido. Se incluye `seed` (id de
  // la noticia) para que la selección del clip sea determinística y coincida
  // con la que usará la descarga real del video (ver contentLibrary.ts).
  const categoryVideoUrl = `/api/media/category-video?category=${encodeURIComponent(category)}${
    newsId ? `&seed=${encodeURIComponent(newsId)}` : ''
  }`;

  // Imagen fallback
  const displayImage =
    imageFallback ||
    'https://images.unsplash.com/photo-1504608524841-42fe6f032b4b?w=800&auto=format&fit=crop&q=80';

  // Sincronizar video cuando cambia la categoría o la noticia (cambia el seed → clip)
  useEffect(() => {
    setVideoError(false);
    setIsVideoLoaded(false);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.load();
      if (isPlaying) {
        videoRef.current.play().catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, newsId]);

  // Manejador de reproducción con HTML5 Video
  useEffect(() => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.play().catch(() => {});
      } else {
        videoRef.current.pause();
      }
    }
  }, [isPlaying]);

  // Manejador de mute
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

  // Timer de fallback en caso de que solo se muestre imagen estática
  useEffect(() => {
    if (videoError || !isVideoLoaded) {
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
    }
  }, [isPlaying, duration, videoError, isVideoLoaded]);

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const currentDuration = videoRef.current?.duration || duration;
  const progressPercent = Math.min((currentTime / currentDuration) * 100, 100);

  const togglePlay = () => {
    setIsPlaying(!isPlaying);
  };

  const handleRestart = () => {
    setCurrentTime(0);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }
    setIsPlaying(true);
  };

  // Ajuste tipográfico según el largo del titular
  const titleLength = title.length;
  let titleFontSize = 'text-[11px] leading-snug';
  if (titleLength > 90) {
    titleFontSize = 'text-[9.5px] leading-tight';
  } else if (titleLength > 60) {
    titleFontSize = 'text-[10px] leading-snug';
  }

  // Zoom / Pan factor si se usa fallback de imagen
  const zoomScale = 1.05 + Math.sin((currentTime / duration) * Math.PI) * 0.08;

  return (
    <div className="flex flex-col items-center space-y-2.5 w-full">
      {/* 9:16 Phone Mockup (185x325px - Perfectamente Proporcionado) */}
      <div className="relative w-[185px] h-[325px] rounded-2xl bg-black border-2 border-slate-800 shadow-2xl overflow-hidden flex flex-col justify-between select-none group shrink-0">
        {/* Dynamic Visual Layer: Video de categoría de fondo */}
        <div className="absolute inset-0 w-full h-full bg-black overflow-hidden">
          {!videoError ? (
            <video
              ref={videoRef}
              src={categoryVideoUrl}
              autoPlay
              loop
              muted={isMuted}
              playsInline
              onLoadedData={() => setIsVideoLoaded(true)}
              onError={() => setVideoError(true)}
              onTimeUpdate={handleTimeUpdate}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <img
              src={displayImage}
              alt={title}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 ease-out"
              style={{
                transform: `scale(${zoomScale})`,
              }}
            />
          )}

          {/* Broadcast Lighting & Overlay Effects */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-transparent via-40% to-black/95 pointer-events-none" />

          {/* Ambient News Pulse Flare in Brand Orange */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-orange-600/25 rounded-full blur-2xl pointer-events-none animate-pulse" />
        </div>

        {/* Top Header: Stories Progress Bar + LOGO ARRIBA A LA DERECHA */}
        <div className="relative z-20 p-2.5 space-y-1.5">
          {/* Progress Bar (Stories / Reels Style in Brand Orange) */}
          <div className="w-full h-1 bg-white/25 rounded-full overflow-hidden backdrop-blur">
            <div
              className="h-full bg-gradient-to-r from-[#FF5500] to-[#FFA040] transition-all duration-100 ease-linear rounded-full shadow-sm shadow-orange-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Top Bar: Category Pill on Left, Prensa Abierta LOGO ON TOP-RIGHT */}
          <div className="flex items-center justify-between pt-0.5">
            <span className="px-2 py-0.5 rounded-md text-[7.5px] font-black bg-black/70 backdrop-blur text-white border border-white/20 uppercase tracking-wider flex items-center gap-1">
              <Film className="w-2.5 h-2.5 text-[#FF5500]" />
              <span>{category}</span>
            </span>

            {/* Logo de Prensa Abierta Arriba a la Derecha (Tamaño equilibrado 34x34px) */}
            <div className="w-8 h-8 rounded-xl overflow-hidden shadow-lg border border-white/40 bg-white/10 backdrop-blur-sm shrink-0">
              <img src="/logo.png" alt="Prensa Abierta" className="w-full h-full object-cover" />
            </div>
          </div>
        </div>

        {/* Center Play/Pause Overlay */}
        <div
          onClick={togglePlay}
          className="absolute inset-0 z-10 flex items-center justify-center cursor-pointer"
        >
          {!isPlaying && (
            <div className="w-10 h-10 rounded-full bg-black/80 backdrop-blur border border-white/30 flex items-center justify-center text-white shadow-2xl">
              <Play className="w-4 h-4 fill-white ml-0.5" />
            </div>
          )}
        </div>

        {/* Bottom: Complete Headline Lower-Third Banner exactamente como se especificó */}
        <div className="relative z-20 p-2 space-y-1">
          <div className="p-2.5 rounded-xl bg-black/90 backdrop-blur-md border border-orange-500/30 shadow-2xl space-y-1">
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#FF5500] animate-ping" />
              <span className="text-[8px] font-black text-[#FFA040] tracking-wider uppercase">
                ÚLTIMA HORA • {category.toUpperCase()}
              </span>
            </div>

            {/* Headline */}
            <h3 className={`font-black text-white whitespace-normal break-words leading-tight ${titleFontSize}`}>
              {title}
            </h3>
          </div>

          {/* Time Indicator */}
          <div className="flex items-center justify-between text-[7.5px] text-slate-300 px-0.5 font-mono">
            <span>Reel 9:16</span>
            <span>{currentTime.toFixed(1)}s / {currentDuration.toFixed(0)}s</span>
          </div>
        </div>
      </div>

      {/* Media Controls Bar */}
      <div className="flex items-center justify-center gap-3 bg-white px-3 py-1.5 rounded-xl border border-slate-200 text-xs w-[185px] shadow-sm shrink-0">
        <button
          onClick={togglePlay}
          className="p-1 rounded hover:bg-slate-100 text-slate-700 hover:text-slate-900 transition"
          title={isPlaying ? 'Pausar' : 'Reproducir'}
        >
          {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>

        <button
          onClick={handleRestart}
          className="p-1 rounded hover:bg-slate-100 text-slate-700 hover:text-slate-900 transition"
          title="Reiniciar video"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => setIsMuted(!isMuted)}
          className="p-1 rounded hover:bg-slate-100 text-slate-700 hover:text-slate-900 transition"
          title={isMuted ? 'Activar sonido' : 'Silenciar'}
        >
          {isMuted ? <VolumeX className="w-3.5 h-3.5 text-[#FF5500]" /> : <Volume2 className="w-3.5 h-3.5 text-emerald-600" />}
        </button>
      </div>
    </div>
  );
}
