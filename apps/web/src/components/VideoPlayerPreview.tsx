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
  Eye,
  Video,
} from 'lucide-react';
import type { RenderState } from '@/hooks/useVideoRenderCache';
import type { VideoStyle } from '@/lib/types';
import PhoneStudioLoader from './PhoneStudioLoader';

interface VideoPlayerPreviewProps {
  title: string;
  category?: string;
  clips?: string[];
  imageFallback?: string;
  duration?: number; // total duration in seconds (default 12)
  newsId?: string;
  mediaKind?: 'image' | 'video';
  mediaUrl?: string;
  template?: 'standard' | 'reels-safe' | 'app-promo';
  renderState?: RenderState;
  onRetryRender?: () => void;
  // Live Studio props:
  style?: VideoStyle | null;
  interactive?: boolean;
  isDirty?: boolean;
  width?: number;
  height?: number;
  // Generation / Pipeline props:
  isGenerating?: boolean;
  generationStep?: string;
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
  style,
  interactive = false,
  isDirty = false,
  width = 220,
  height,
  isGenerating = false,
  generationStep = '',
}: VideoPlayerPreviewProps) {
  const isReelsSafe = template === 'reels-safe';
  const isAppPromo = template === 'app-promo';

  const previewWidth = width || 220;
  const previewHeight = height || Math.round(previewWidth * (1920 / 1080));
  const s = previewWidth / 1080;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mp4VideoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [videoError, setVideoError] = useState<boolean>(false);
  const [isVideoLoaded, setIsVideoLoaded] = useState<boolean>(false);
  const [compImageError, setCompImageError] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'live' | 'mp4'>('live');

  // Si no es interactivo y hay renderState, se usa el modo clásico de render real.
  const classicRealRender = !interactive && Boolean(renderState);

  // URL del video de la categoría en assets/contenido.
  const categoryVideoUrl = `/api/media/category-video?category=${encodeURIComponent(category)}${
    newsId ? `&seed=${encodeURIComponent(newsId)}` : ''
  }${title ? `&q=${encodeURIComponent(title)}` : ''}`;

  const displayImage =
    imageFallback ||
    'https://images.unsplash.com/photo-1504608524841-42fe6f032b4b?w=800&auto=format&fit=crop&q=80';

  const shot0 = style?.custom_shots?.find((s) => s.slot_index === 0);
  const effectiveMediaKind = shot0 ? shot0.media_kind : mediaKind;
  const effectiveMediaUrl = shot0 ? shot0.url : mediaUrl;

  const forcedImage = effectiveMediaKind === 'image';
  const videoSrc = effectiveMediaKind === 'video' && effectiveMediaUrl ? effectiveMediaUrl : categoryVideoUrl;
  const imageSrc =
    effectiveMediaKind === 'image' && effectiveMediaUrl
      ? effectiveMediaUrl
      : compImageError
        ? displayImage
        : categoryVideoUrl;
  const showImage = forcedImage || videoError;

  // Recarga del b-roll en modo en vivo cuando cambian las props de medios
  useEffect(() => {
    if (classicRealRender) return;
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
  }, [category, newsId, effectiveMediaKind, effectiveMediaUrl, classicRealRender]);

  const isRenderingMp4 = renderState?.status === 'rendering';
  const isMp4Ready = renderState?.status === 'ready' && Boolean(renderState?.url);

  // Auto-activar MP4 con voz cuando el render está listo Y no hay cambios pendientes
  useEffect(() => {
    if (isMp4Ready && !isDirty) {
      setViewMode('mp4');
    }
  }, [isMp4Ready, renderState?.url, isDirty]);

  // Si el usuario edita sliders (estilo) o hay cambios pendientes, forzar 'live' para feedback 60 FPS
  const lastStyleRef = useRef<string>('');
  useEffect(() => {
    if (!interactive) return;
    if (isDirty) {
      setViewMode('live');
    }
    if (style) {
      const currentStyleStr = JSON.stringify(style);
      if (lastStyleRef.current && lastStyleRef.current !== currentStyleStr) {
        setViewMode('live');
      }
      lastStyleRef.current = currentStyleStr;
    }
  }, [interactive, style, isDirty]);

  // Recarga del mp4 cuando cambia la URL
  useEffect(() => {
    const targetRef = classicRealRender ? videoRef.current : mp4VideoRef.current;
    if (targetRef && renderState?.url) {
      targetRef.currentTime = 0;
      targetRef.load();
      if (isPlaying) {
        targetRef.play().catch(() => {});
      }
    }
  }, [classicRealRender, renderState?.url, isPlaying]);

  // Control de play/pause
  useEffect(() => {
    const activeRef =
      interactive && viewMode === 'mp4' && renderState?.url
        ? mp4VideoRef.current
        : videoRef.current;
    if (activeRef) {
      if (isPlaying) {
        activeRef.play().catch(() => {});
      } else {
        activeRef.pause();
      }
    }
  }, [isPlaying, viewMode, interactive, renderState?.url]);

  // Control de mute y sincronización de volumen
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
    if (mp4VideoRef.current) {
      mp4VideoRef.current.muted = isMuted;
      mp4VideoRef.current.volume = 1.0;
      if (!isMuted && isPlaying) {
        mp4VideoRef.current.play().catch(() => {});
      }
    }
  }, [isMuted, viewMode, isPlaying]);

  // Timer si solo se muestra imagen estática (zoom animado)
  useEffect(() => {
    if (classicRealRender || (interactive && viewMode === 'mp4')) return;
    if (showImage || !isVideoLoaded) {
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
  }, [isPlaying, duration, showImage, isVideoLoaded, classicRealRender, interactive, viewMode]);

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    setCurrentTime(e.currentTarget.currentTime);
  };

  const activeVideoEl =
    interactive && viewMode === 'mp4' && renderState?.url
      ? mp4VideoRef.current
      : videoRef.current;
  const currentDuration = activeVideoEl?.duration || duration;
  const progressPercent = Math.min((currentTime / currentDuration) * 100, 100);

  const togglePlay = () => setIsPlaying(!isPlaying);

  const handleRestart = () => {
    setCurrentTime(0);
    const activeRef =
      interactive && viewMode === 'mp4' && renderState?.url
        ? mp4VideoRef.current
        : videoRef.current;
    if (activeRef) {
      activeRef.currentTime = 0;
      activeRef.play().catch(() => {});
    }
    setIsPlaying(true);
  };

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
        onClick={() => {
          const nextMuted = !isMuted;
          setIsMuted(nextMuted);
          // Si el usuario activa el sonido y el MP4 ya está listo, pasar de inmediato a modo mp4
          if (!nextMuted && isMp4Ready) {
            setViewMode('mp4');
          }
          const activeRef =
            interactive && (viewMode === 'mp4' || (!nextMuted && isMp4Ready)) && renderState?.url
              ? mp4VideoRef.current
              : videoRef.current;
          if (activeRef) {
            activeRef.muted = nextMuted;
            if (!nextMuted) {
              activeRef.volume = 1.0;
              if (!isPlaying) setIsPlaying(true);
              activeRef.play().catch(() => {});
            }
          }
        }}
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

  // ── Modo Clásico No Interactivo (Autopilot, Comparativa, etc.) ──
  if (classicRealRender) {
    const status = renderState?.status || 'idle';
    return (
      <div className="flex flex-col items-center space-y-2.5 w-full">
        <div
          style={{ width: `${previewWidth}px`, height: `${previewHeight}px` }}
          className="relative rounded-2xl bg-black border-2 border-slate-800 shadow-2xl overflow-hidden flex items-center justify-center select-none shrink-0"
        >
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
          ) : (status === 'rendering' || isGenerating) ? (
            <PhoneStudioLoader
              isGenerating={isGenerating}
              generationStep={generationStep}
              renderState={renderState}
              headline={title}
              category={category}
            />
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

        {status === 'ready' && (
          <div className="flex flex-wrap items-center justify-center gap-2 px-3 text-center">
            {renderState?.voiceStatus === 'ok' && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
                <Volume2 className="h-3 w-3" /> {isMuted ? 'Voz ElevenLabs lista · activa el sonido' : 'Reproduciendo con voz ElevenLabs'}
              </span>
            )}
            {renderState?.voiceStatus === 'disabled' && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-center text-[10px] font-bold text-amber-700">
                Locución desactivada; revisa la configuración de ElevenLabs
              </span>
            )}
            {renderState?.voiceStatus?.startsWith('failed:') && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-center text-[10px] font-bold text-amber-700">
                Locución no disponible; consulta el log del motor
              </span>
            )}
          </div>
        )}

        {status === 'ready' && mediaControls}
      </div>
    );
  }

  // ── Modo Estudio Interactivo (o Clásico sin RenderState) ──
  // Cálculos de layout y escala proporcionales al lienzo de 1080x1920:
  const defaultHeadYOffset = isReelsSafe ? 740 : isAppPromo ? 454 : 370;
  const defaultLineSpacing = isReelsSafe ? 10 : 18;
  const defaultLogoY = isReelsSafe ? 190 : 92;
  const defaultFontSize = isReelsSafe ? 44 : 46;

  const effFontSize = (style?.headline_font_size ?? defaultFontSize) * s;
  const effFontFamily =
    style?.headline_font === 'league_spartan'
      ? 'var(--font-league-spartan), sans-serif'
      : 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const effFontColor = style?.headline_color || '#FFFFFF';
  const effLineSpacing = (style?.headline_line_spacing ?? defaultLineSpacing) * s;
  const effBoxColor = style?.box_color || '#000000';
  const effBoxOpacity = style?.box_opacity ?? 0.85;
  const effHeaderText =
    style?.header_text && style.header_text.trim()
      ? style.header_text.trim()
      : `ÚLTIMA HORA • ${category.toUpperCase()}`;
  const effHeaderColor = style?.header_color || '#FFAA00';
  const effShowLogo = style?.show_logo ?? true;
  const effLogoSize = (style?.logo_size ?? 240) * s;
  const effLogoY = (style?.logo_y ?? defaultLogoY) * s;
  const effShowPromo = style?.show_promo ?? isAppPromo;
  const effPromoWidth = (style?.promo_width ?? 560) * s;
  const effHeadlineText = (style?.headline_text && style.headline_text.trim()) || title;
  const effHeadlineAlign = style?.headline_align || 'left';

  // Offset inferior de la tarjeta de fondo (calibrado a 70px en lienzo de 1080p, idéntico al Engine)
  const effBoxBottom = isReelsSafe
    ? style?.headline_y !== undefined
      ? Math.max(10, Math.round((style.headline_y - 280) * s))
      : Math.round(360 * s)
    : Math.round(70 * s);

  // Convertir hex a rgba para el fondo del titular
  const hexClean = effBoxColor.replace('#', '');
  const rVal = parseInt(hexClean.substring(0, 2) || '0', 16);
  const gVal = parseInt(hexClean.substring(2, 4) || '0', 16);
  const bVal = parseInt(hexClean.substring(4, 6) || '0', 16);
  const boxBgColor = `rgba(${rVal}, ${gVal}, ${bVal}, ${effBoxOpacity})`;


  return (
    <div className="flex flex-col items-center space-y-2.5 w-full">
      {/* Switch de modo: En vivo (60fps) vs MP4 final con voz (cuando está listo) */}
      {interactive && isMp4Ready && (
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-[11px] font-bold">
          <button
            onClick={() => setViewMode('live')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg transition ${
              viewMode === 'live'
                ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Eye className="w-3 h-3 text-[#FF5500]" />
            <span>En vivo (60 FPS)</span>
          </button>
          <button
            onClick={() => setViewMode('mp4')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg transition ${
              viewMode === 'mp4'
                ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Video className="w-3 h-3 text-emerald-600" />
            <span>MP4 con voz</span>
          </button>
        </div>
      )}

      {/* 9:16 Phone Mockup */}
      <div
        style={{ width: `${previewWidth}px`, height: `${previewHeight}px` }}
        className="relative rounded-2xl bg-black border-2 border-slate-800 shadow-2xl overflow-hidden flex flex-col justify-between select-none group shrink-0"
      >
        {/* Overlay Studio Loader durante redacción IA o renderizado Go/FFmpeg */}
        {(isGenerating || renderState?.status === 'rendering') && (
          <PhoneStudioLoader
            isGenerating={isGenerating}
            generationStep={generationStep}
            renderState={renderState}
            headline={title}
            category={category}
          />
        )}

        {/* Caso A: Reproducir el MP4 real renderizado */}
        {interactive && viewMode === 'mp4' && isMp4Ready && renderState?.url ? (
          <video
            ref={mp4VideoRef}
            src={renderState.url}
            autoPlay
            loop
            muted={isMuted}
            playsInline
            onLoadedData={() => setIsVideoLoaded(true)}
            onTimeUpdate={handleTimeUpdate}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          /* Caso B: Reproducir En Vivo (b-roll + overlay HTML 60 FPS ultra rápido) */
          <>
            {/* Dynamic Visual Layer */}
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

            {/* Plantilla "reels-safe": guía visual de la zona reservada de Reels (15%) */}
            {isReelsSafe && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[15%] border-t border-dashed border-white/30 bg-gradient-to-t from-black/40 to-transparent">
                <span className="absolute left-1.5 top-1 text-[6.5px] font-black uppercase tracking-wider text-white/50">
                  Zona UI Reels
                </span>
              </div>
            )}

            {/* Top Stories Progress Bar & Category Pill */}
            <div className="relative z-20 p-2.5 space-y-1.5">
              <div className="w-full h-1 bg-white/25 rounded-full overflow-hidden backdrop-blur">
                <div
                  className="h-full bg-gradient-to-r from-[#FF5500] to-[#FFA040] transition-all duration-100 ease-linear rounded-full shadow-sm shadow-orange-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <div className="flex items-center justify-between pt-0.5">
                <span className="px-2 py-0.5 rounded-md text-[7.5px] font-black bg-black/70 backdrop-blur text-white border border-white/20 uppercase tracking-wider flex items-center gap-1">
                  <Film className="w-2.5 h-2.5 text-[#FF5500]" />
                  <span>{category}</span>
                </span>
              </div>
            </div>

            {/* Logo de Prensa Abierta (Top Right) */}
            {effShowLogo && (
              <div
                style={{
                  top: `${effLogoY}px`,
                  right: '12px',
                  width: `${effLogoSize}px`,
                  height: `${effLogoSize}px`,
                }}
                className="absolute z-20 rounded-xl overflow-hidden shadow-lg border border-white/40 bg-white/10 backdrop-blur-sm shrink-0 transition-all duration-75"
              >
                <img src="/logo.png" alt="Prensa Abierta" className="w-full h-full object-cover" />
              </div>
            )}

            {/* Lower-third con titular y caja de fondo editable en vivo */}
            <div
              style={{
                bottom: `${effBoxBottom}px`,
                left: `${Math.round(40 * s)}px`,
                right: `${Math.round(40 * s)}px`,
              }}
              className="absolute z-20"
            >
              <div
                style={{
                  backgroundColor: boxBgColor,
                  backdropFilter: 'blur(8px)',
                  padding: `${Math.round(32 * s)}px ${Math.round(34 * s)}px`,
                  borderColor: 'rgba(255, 85, 0, 0.45)',
                  borderRadius: `${Math.round(28 * s)}px`,
                }}
                className="border shadow-2xl transition-all duration-75 flex flex-col"
              >
                {/* Rótulo superior */}
                <div
                  style={{ marginBottom: `${Math.round(20 * s)}px` }}
                  className={`flex items-center gap-1.5 ${
                    effHeadlineAlign === 'center'
                      ? 'justify-center'
                      : effHeadlineAlign === 'right'
                        ? 'justify-end'
                        : 'justify-start'
                  }`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full animate-ping shrink-0"
                    style={{ backgroundColor: effHeaderColor }}
                  />
                  <span
                    style={{
                      color: effHeaderColor,
                      fontSize: `${Math.max(8, Math.round(34 * s))}px`,
                    }}
                    className="font-black tracking-wider uppercase truncate"
                  >
                    {effHeaderText}
                  </span>
                </div>

                {/* Headline con tipografía, tamaño, alineación y colores en tiempo real */}
                <h3
                  style={{
                    fontFamily: effFontFamily,
                    fontSize: `${effFontSize}px`,
                    color: effFontColor,
                    lineHeight: `${Math.round(effFontSize * 1.25 + effLineSpacing)}px`,
                    textAlign: effHeadlineAlign,
                  }}
                  className="font-black whitespace-pre-line break-words"
                >
                  {effHeadlineText}
                </h3>

                {/* Banner Descarga la App si está activo */}
                {effShowPromo && (
                  <div
                    style={{ marginTop: `${Math.round(32 * s)}px` }}
                    className="flex justify-center"
                  >
                    <img
                      src="/descargar-app-gratis.jpg"
                      alt="Descarga la App GRATIS"
                      style={{
                        width: `${effPromoWidth}px`,
                        borderRadius: `${Math.round(16 * s)}px`,
                      }}
                      className="shadow-md border border-white/20 object-contain"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Time Indicator fijado en la base de la pantalla */}
            <div className="absolute bottom-1 left-2 right-2 z-20 flex items-center justify-between text-[7.5px] text-slate-300 px-1 font-mono pointer-events-none">
              <span>Reel 9:16{isReelsSafe ? ' · safe' : ''}</span>
              <span>{currentTime.toFixed(1)}s / {currentDuration.toFixed(0)}s</span>
            </div>
          </>
        )}

        {/* Center Play/Pause Overlay */}
        <div
          onClick={togglePlay}
          className="absolute inset-0 z-30 flex items-center justify-center cursor-pointer"
        >
          {!isPlaying && (
            <div className="w-10 h-10 rounded-full bg-black/80 backdrop-blur border border-white/30 flex items-center justify-center text-white shadow-2xl">
              <Play className="w-4 h-4 fill-white ml-0.5" />
            </div>
          )}
        </div>
      </div>

      {/* Indicadores de estado de fondo (No bloqueantes) */}
      {interactive && isRenderingMp4 && (
        <div className="flex items-center gap-1.5 rounded-full bg-orange-50 border border-orange-200 px-3 py-1 text-[10.5px] font-bold text-orange-700 animate-pulse">
          <Loader2 className="w-3 h-3 animate-spin text-[#FF5500]" />
          <span>Renderizando MP4 con voz en segundo plano...</span>
        </div>
      )}

      {interactive && renderState?.status === 'failed' && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-1.5 text-[10.5px] font-bold text-red-700">
          <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
          <span className="truncate max-w-[200px]">{renderState.error || 'Falló el render'}</span>
          {onRetryRender && (
            <button
              onClick={onRetryRender}
              className="ml-auto flex items-center gap-1 text-[10px] underline hover:text-red-900"
            >
              <RefreshCw className="w-2.5 h-2.5" /> Reintentar
            </button>
          )}
        </div>
      )}

      {interactive && isMp4Ready && viewMode === 'mp4' && (
        <div className="flex flex-wrap items-center justify-center gap-2 px-3 text-center">
          {renderState?.voiceStatus === 'ok' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
              <Volume2 className="h-3 w-3" /> {isMuted ? 'Voz ElevenLabs lista · activa el sonido' : 'Reproduciendo con voz ElevenLabs'}
            </span>
          )}
          {renderState?.voiceStatus === 'disabled' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-center text-[10px] font-bold text-amber-700">
              Locución desactivada en ElevenLabs
            </span>
          )}
        </div>
      )}

      {/* Media Controls Bar */}
      {mediaControls}
    </div>
  );
}
