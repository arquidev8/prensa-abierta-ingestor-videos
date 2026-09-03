'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Film,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Clapperboard,
} from 'lucide-react';
import type { RenderState } from '@/hooks/useVideoRenderCache';

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
  // Override de la base de la composición desde el "Editor de video":
  //  - mediaKind 'image' → la pieza se arma solo con una imagen (con zoom), sin <video>.
  //  - mediaKind 'video' → clip de b-roll.
  // mediaUrl es la fuente concreta a usar (archivo importado, blob: o http:); si se
  // omite, se usa la fuente automática (clip de categoría / imagen destacada).
  mediaKind?: 'image' | 'video';
  mediaUrl?: string;
  // Plantilla de layout (ver .agents/formato-video-reel.md):
  //  - 'standard'   → bloque de titular pegado al borde inferior.
  //  - 'reels-safe' → bloque de titular elevado a la safe zone del grid 1:1,
  //    interlineado compacto y logo más separado del borde; los ~15% inferiores
  //    quedan libres para la UI de Instagram Reels.
  template?: 'standard' | 'reels-safe';
  // Estado del render REAL (Go Engine) para esta combinación de ajustes, vía
  // useVideoRenderCache. Cuando se pasa esta prop, el preview reproduce
  // directamente el .mp4 ya renderizado (idéntico al que se descarga) en vez del
  // clip crudo con overlay HTML — así preview y descarga son siempre la misma
  // pieza, incluyendo cualquier cambio hecho desde el "Editor de video".
  renderState?: RenderState;
  onRetryRender?: () => void;
}

export default function VideoPlayerPreview({
  title,
  category = 'NOTICIAS',
  clips = [],
  imageFallback,
  duration = 12,
  newsId,
  mediaKind,
  mediaUrl,
  template = 'standard',
  renderState,
  onRetryRender,
}: VideoPlayerPreviewProps) {
  const reelsSafe = template === 'reels-safe';
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [videoError, setVideoError] = useState<boolean>(false);
  const [isVideoLoaded, setIsVideoLoaded] = useState<boolean>(false);
  // El endpoint de categoría puede servir la IMAGEN temática de la composición
  // (tema sin clip local). Si esa imagen tampoco carga, se cae a la destacada.
  const [compImageError, setCompImageError] = useState<boolean>(false);

  const usingRealRender = Boolean(renderState);

  // URL del video de la categoría en assets/contenido. Se incluye `seed` (id de
  // la noticia) para que la selección del clip sea determinística y coincida
  // con la que usará la descarga real del video (ver contentLibrary.ts).
  const categoryVideoUrl = `/api/media/category-video?category=${encodeURIComponent(category)}${
    newsId ? `&seed=${encodeURIComponent(newsId)}` : ''
  }${title ? `&q=${encodeURIComponent(title)}` : ''}`;

  // Imagen fallback
  const displayImage =
    imageFallback ||
    'https://images.unsplash.com/photo-1504608524841-42fe6f032b4b?w=800&auto=format&fit=crop&q=80';

  // Fuente efectiva según el override del "Editor de video".
  const forcedImage = mediaKind === 'image';
  const videoSrc = mediaKind === 'video' && mediaUrl ? mediaUrl : categoryVideoUrl;
  // Imagen a mostrar cuando no hay video reproducible:
  //  1. archivo importado (mediaKind 'image' + mediaUrl), si existe;
  //  2. la imagen de la composición que sirve /api/media/category-video
  //     (imagen temática del banco para el tema de la noticia);
  //  3. imagen destacada de la noticia / genérica, si (2) tampoco carga.
  const imageSrc =
    mediaKind === 'image' && mediaUrl
      ? mediaUrl
      : compImageError
        ? displayImage
        : categoryVideoUrl;
  const showImage = forcedImage || videoError;

  // Sincronizar video cuando cambia la categoría, la noticia (seed → clip) o la
  // fuente elegida en el Editor de video. No aplica en modo de render real (ese
  // video se recarga solo cuando cambia `renderState.url`, ver el efecto de abajo).
  useEffect(() => {
    if (usingRealRender) return;
    setVideoError(false);
    setIsVideoLoaded(false);
    setCompImageError(false);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.load();
      if (isPlaying) {
        videoRef.current.play().catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, newsId, mediaKind, mediaUrl, usingRealRender]);

  // Recargar el <video> cuando cambia la URL del .mp4 ya renderizado.
  useEffect(() => {
    if (!usingRealRender) return;
    setIsVideoLoaded(false);
    if (videoRef.current && renderState?.url) {
      videoRef.current.currentTime = 0;
      videoRef.current.load();
      if (isPlaying) {
        videoRef.current.play().catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usingRealRender, renderState?.url]);

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
    if (usingRealRender) return;
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
  }, [isPlaying, duration, videoError, isVideoLoaded, usingRealRender]);

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

  // Zoom / Pan factor si se usa fallback de imagen (solo modo clip crudo)
  const zoomScale = 1.05 + Math.sin((currentTime / duration) * Math.PI) * 0.08;

  const mediaControls = (
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
        {isMuted ? (
          <VolumeX className="w-3.5 h-3.5 text-[#FF5500]" />
        ) : (
          <Volume2 className="w-3.5 h-3.5 text-emerald-600" />
        )}
      </button>
    </div>
  );

  // ── Modo "render real": el preview reproduce el mismo .mp4 (overlay ya
  // quemado por el Go Engine) que se descarga — sin mockup HTML duplicado. ──
  if (usingRealRender) {
    const status = renderState?.status || 'idle';

    return (
      <div className="flex flex-col items-center space-y-2.5 w-full">
        <div className="relative w-[185px] h-[325px] rounded-2xl bg-black border-2 border-slate-800 shadow-2xl overflow-hidden flex items-center justify-center select-none shrink-0">
          {status === 'ready' && renderState?.url ? (
            <video
              ref={videoRef}
              src={renderState.url}
              autoPlay
              loop
              muted={isMuted}
              playsInline
              onLoadedData={() => setIsVideoLoaded(true)}
              onTimeUpdate={handleTimeUpdate}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : status === 'rendering' ? (
            <div className="flex flex-col items-center gap-2.5 text-center px-4">
              <Loader2 className="w-7 h-7 text-[#FF5500] animate-spin" />
              <p className="text-[11px] font-bold text-white">Generando video...</p>
              <p className="text-[9.5px] text-slate-400">
                Renderizando con el Go Engine (overlay, logo y titular reales)
              </p>
            </div>
          ) : status === 'failed' ? (
            <div className="flex flex-col items-center gap-2.5 text-center px-4">
              <AlertTriangle className="w-7 h-7 text-red-400" />
              <p className="text-[11px] font-bold text-white">No se pudo generar el video</p>
              {renderState?.error && (
                <p className="text-[9.5px] text-slate-400 line-clamp-3">{renderState.error}</p>
              )}
              {onRetryRender && (
                <button
                  onClick={onRetryRender}
                  className="flex items-center gap-1.5 rounded-lg bg-white/10 border border-white/20 px-2.5 py-1.5 text-[10.5px] font-bold text-white hover:bg-white/20 transition"
                >
                  <RefreshCw className="w-3 h-3" /> Reintentar
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2.5 text-center px-4">
              <Clapperboard className="w-7 h-7 text-slate-500" />
              <p className="text-[11px] font-bold text-slate-300">Sin video generado todavía</p>
            </div>
          )}

          {/* Center Play/Pause Overlay (solo cuando el video real ya está listo) */}
          {status === 'ready' && (
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
          )}
        </div>

        {status === 'ready' && mediaControls}
      </div>
    );
  }

  // ── Modo clásico: clip crudo + overlay HTML (usado cuando no se pasa
  // `renderState`, ej. en la vista de lista del Hub Autónomo). ──

  // Ajuste tipográfico según el largo del titular
  const titleLength = title.length;
  let titleFontSize = 'text-[11px] leading-snug';
  if (titleLength > 90) {
    titleFontSize = 'text-[9.5px] leading-tight';
  } else if (titleLength > 60) {
    titleFontSize = 'text-[10px] leading-snug';
  }

  return (
    <div className="flex flex-col items-center space-y-2.5 w-full">
      {/* 9:16 Phone Mockup (185x325px - Perfectamente Proporcionado) */}
      <div className="relative w-[185px] h-[325px] rounded-2xl bg-black border-2 border-slate-800 shadow-2xl overflow-hidden flex flex-col justify-between select-none group shrink-0">
        {/* Dynamic Visual Layer: Video de categoría de fondo */}
        <div className="absolute inset-0 w-full h-full bg-black overflow-hidden">
          {!showImage ? (
            <video
              ref={videoRef}
              src={videoSrc}
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
              src={imageSrc}
              alt={title}
              onError={() => {
                // Si falló la imagen de la composición, caer a la destacada / genérica.
                if (imageSrc === categoryVideoUrl) setCompImageError(true);
              }}
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

        {/* Plantilla "reels-safe": guía de la zona reservada para la UI de Reels
            (últimos ~15%) — solo visual en el preview, no se quema en el video. */}
        {reelsSafe && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[15%] border-t border-dashed border-white/30 bg-gradient-to-t from-black/40 to-transparent">
            <span className="absolute left-1.5 top-1 text-[6px] font-black uppercase tracking-wider text-white/50">
              Zona UI Reels
            </span>
          </div>
        )}

        {/* Top Header: Stories Progress Bar + LOGO ARRIBA A LA DERECHA */}
        <div className={`relative z-20 p-2.5 space-y-1.5 ${reelsSafe ? 'pt-3' : ''}`}>
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

            {/* Logo de Prensa Abierta Arriba a la Derecha (mismo peso visual ~22% del ancho que el render real del Engine) */}
            <div className="w-10 h-10 rounded-xl overflow-hidden shadow-lg border border-white/40 bg-white/10 backdrop-blur-sm shrink-0">
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

        {/* Bottom: Lower-third con titular. En "reels-safe" el bloque sube ~46px
            (≈270px sobre 1920) para quedar dentro de la safe zone del grid 1:1. */}
        <div className={`relative z-20 p-2 space-y-1 ${reelsSafe ? 'mb-[46px]' : ''}`}>
          <div className="p-2.5 rounded-xl bg-black/90 backdrop-blur-md border border-orange-500/30 shadow-2xl space-y-1">
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#FF5500] animate-ping" />
              <span className="text-[8px] font-black text-[#FFA040] tracking-wider uppercase">
                ÚLTIMA HORA • {category.toUpperCase()}
              </span>
            </div>

            {/* Headline */}
            <h3
              className={`font-black text-white whitespace-normal break-words ${
                reelsSafe ? 'leading-[1.08]' : 'leading-tight'
              } ${titleFontSize}`}
            >
              {title}
            </h3>
          </div>

          {/* Time Indicator */}
          <div className="flex items-center justify-between text-[7.5px] text-slate-300 px-0.5 font-mono">
            <span>Reel 9:16{reelsSafe ? ' · safe' : ''}</span>
            <span>{currentTime.toFixed(1)}s / {currentDuration.toFixed(0)}s</span>
          </div>
        </div>
      </div>

      {/* Media Controls Bar */}
      {mediaControls}
    </div>
  );
}
