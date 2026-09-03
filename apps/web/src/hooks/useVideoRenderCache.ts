'use client';

import { useCallback, useRef, useState } from 'react';

export type RenderStatus = 'idle' | 'rendering' | 'ready' | 'failed';

export interface RenderState {
  status: RenderStatus;
  url?: string;
  error?: string;
}

export interface RenderParams {
  newsId: string;
  headline: string;
  category: string;
  imageUrl?: string;
  // Base de la composición elegida en el "Editor de video".
  background: 'image' | 'video';
  template: 'standard' | 'reels-safe';
  // Archivos importados por el usuario (ya subidos a /api/media/upload).
  customImageUrl?: string;
  customClipUrl?: string;
  duration?: number;
}

const IDLE_STATE: RenderState = { status: 'idle' };

// La clave incluye TODOS los parámetros que afectan el .mp4 resultante: cualquier
// cambio en el "Editor de video" (imagen/video/plantilla importados) produce una
// clave distinta y dispara un render nuevo, sin reusar el resultado de otra
// combinación de ajustes.
function buildKey(p: RenderParams): string {
  return [
    p.newsId,
    p.headline,
    p.category,
    p.background,
    p.template,
    p.customImageUrl || '',
    p.customClipUrl || '',
  ].join('::');
}

/**
 * Cachea en memoria (por combinación de parámetros) el resultado de renderizar el
 * video real vía /api/render-video, para que el preview del modal y la descarga
 * sean exactamente la misma pieza generada por el Go Engine.
 */
export function useVideoRenderCache() {
  const statesRef = useRef<Map<string, RenderState>>(new Map());
  const [, forceUpdate] = useState(0);

  const getState = useCallback((params: RenderParams | null): RenderState => {
    if (!params) return IDLE_STATE;
    return statesRef.current.get(buildKey(params)) || IDLE_STATE;
  }, []);

  const ensureRendered = useCallback((params: RenderParams | null) => {
    if (!params || !params.headline) return;
    const key = buildKey(params);
    const existing = statesRef.current.get(key);
    if (existing && (existing.status === 'rendering' || existing.status === 'ready')) return;

    statesRef.current.set(key, { status: 'rendering' });
    forceUpdate((n) => n + 1);

    (async () => {
      try {
        const res = await fetch('/api/render-video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            newsId: params.newsId,
            headline: params.headline,
            category: params.category,
            imageUrl: params.imageUrl,
            background: params.background,
            template: params.template,
            customImageUrl: params.customImageUrl,
            customClipUrl: params.customClipUrl,
            duration: params.duration || 10,
          }),
          signal: AbortSignal.timeout(60_000),
        });
        const data = await res.json();
        if (res.ok && data.success && data.videoUrl) {
          statesRef.current.set(key, { status: 'ready', url: data.videoUrl });
        } else {
          statesRef.current.set(key, {
            status: 'failed',
            error: data.error || 'Error al generar video',
          });
        }
      } catch (e: any) {
        const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
        statesRef.current.set(key, {
          status: 'failed',
          error: timedOut
            ? 'El render tardó demasiado y se canceló. Intenta de nuevo en unos segundos.'
            : 'Hubo un error al procesar el video.',
        });
      } finally {
        forceUpdate((n) => n + 1);
      }
    })();
  }, []);

  return { getState, ensureRendered };
}
