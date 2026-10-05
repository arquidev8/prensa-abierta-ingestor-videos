'use client';

import { useCallback, useRef, useState } from 'react';
import type { VideoDirection } from '@/lib/videoDirection';
import type { VideoStyle } from '@/lib/types';
import { fetchWithSession } from '@/lib/authClient';
import { notifyVideoUsageChanged } from '@/lib/videoUsage';

export type RenderStatus = 'idle' | 'rendering' | 'ready' | 'failed';

export interface RenderState {
  status: RenderStatus;
  url?: string;
  error?: string;
  voiceStatus?: string;
}

export interface RenderParams {
  newsId: string;
  headline: string;
  category: string;
  imageUrl?: string;
  // Cuerpo de la nota (HTML o texto): el Engine locuta categoría + titular + arranque de la nota.
  body?: string;
  // Base de la composición elegida en el "Editor de video".
  background: 'image' | 'video';
  template: 'standard' | 'reels-safe' | 'app-promo';
  // Archivos importados por el usuario (ya subidos a /api/media/upload).
  customImageUrl?: string;
  customClipUrl?: string;
  duration?: number;
  // Dirección de composición de la IA / Motor Autónomo (Capa 3). El modal ya
  // inicializa `background`/`template` desde acá; el resto (duración, queries de
  // Pexels) lo aplica /api/render-video.
  videoDirection?: VideoDirection;
  // Overrides granulares del "Editor de video" (tipografía, colores, posición,
  // logo, banner) sobre el layout de `template`. Ausente = layout por defecto,
  // el render sale idéntico al que había antes de esta feature.
  style?: VideoStyle;
  // Guion de locución personalizado editado por el usuario en el Editor de video.
  voiceText?: string;
}

const IDLE_STATE: RenderState = { status: 'idle' };

// La clave incluye TODOS los parámetros que afectan el .mp4 resultante: cualquier
// cambio en el "Editor de video" (imagen/video/plantilla importados) produce una
// clave distinta y dispara un render nuevo, sin reusar el resultado de otra
// combinación de ajustes.
function buildKey(p: RenderParams): string {
  const d = p.videoDirection;
  // Firma compacta de la parte de la dirección que /api/render-video usa y que NO
  // está ya cubierta por `background`/`template` (que el modal deriva de ella).
  const dirSig = d
    ? [d.duration_sec, d.image_query, (d.clip_queries || []).join(',')].join('|')
    : '';
  return [
    p.newsId,
    p.headline,
    p.category,
    p.background,
    p.template,
    p.customImageUrl || '',
    p.customClipUrl || '',
    dirSig,
    // Si cambia la nota (ej. "Redactar de nuevo") cambia la locución: firma corta del cuerpo.
    (p.body || '').length + ':' + (p.body || '').slice(0, 60),
    // Cualquier ajuste del Editor de estilo (tipografía, colores, posición, logo,
    // banner) produce una clave distinta: no reusa el .mp4 de otra combinación.
    p.style ? JSON.stringify(p.style) : '',
    // Si el usuario editó el guion de locución, produce una clave distinta
    p.voiceText || '',
  ].join('::');
}

/**
 * Cachea en memoria (por combinación de parámetros) el resultado de renderizar el
 * video real vía /api/render-video, para que el preview del modal y la descarga
 * sean exactamente la misma pieza generada por el Go Engine.
 */
export function useVideoRenderCache() {
  const statesRef = useRef<Map<string, RenderState>>(new Map());
  const activeFetchesRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const [, forceUpdate] = useState(0);

  const getState = useCallback((params: RenderParams | null): RenderState => {
    if (!params) return IDLE_STATE;
    return statesRef.current.get(buildKey(params)) || IDLE_STATE;
  }, []);

  const ensureRendered = useCallback(
    async (params: RenderParams | null, options?: { force?: boolean }): Promise<string | null> => {
      if (!params || !params.headline) return null;
      const key = buildKey(params);
      const existing = statesRef.current.get(key);

      if (!options?.force) {
        if (existing?.status === 'ready' && existing.url) {
          return existing.url;
        }
        if (activeFetchesRef.current.has(key)) {
          return await activeFetchesRef.current.get(key)!;
        }
      }

      // Si es forzado o clave nueva para esta noticia, limpiar cualquier render previo de esta noticia
      if (options?.force) {
        for (const k of Array.from(statesRef.current.keys())) {
          if (k.startsWith(params.newsId + '::')) {
            statesRef.current.delete(k);
          }
        }
      }

      statesRef.current.set(key, { status: 'rendering' });
      forceUpdate((n) => n + 1);

      setTimeout(notifyVideoUsageChanged, 3000);

      const fetchPromise = (async (): Promise<string | null> => {
        try {
          const res = await fetchWithSession('/api/render-video', {
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
              duration: params.duration,
              videoDirection: params.videoDirection,
              body: (params.body || '').slice(0, 2000),
              style: params.style,
              voiceText: params.voiceText,
            }),
            signal: AbortSignal.timeout(205_000),
          });
          const data = await res.json();
          if (res.ok && data.success && data.videoUrl) {
            statesRef.current.set(key, {
              status: 'ready',
              url: data.videoUrl,
              ...(typeof data.voiceStatus === 'string' ? { voiceStatus: data.voiceStatus } : {}),
            });
            return data.videoUrl as string;
          } else {
            statesRef.current.set(key, {
              status: 'failed',
              error: data.error || 'Error al generar video',
            });
            return null;
          }
        } catch (e: any) {
          const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
          statesRef.current.set(key, {
            status: 'failed',
            error: timedOut
              ? 'El render tardó demasiado y se canceló. Intenta de nuevo en unos segundos.'
              : 'Hubo un error al procesar el video.',
          });
          return null;
        } finally {
          activeFetchesRef.current.delete(key);
          forceUpdate((n) => n + 1);
          notifyVideoUsageChanged();
        }
      })();

      activeFetchesRef.current.set(key, fetchPromise);
      return await fetchPromise;
    },
    []
  );

  const forceRender = useCallback(
    async (params: RenderParams | null): Promise<string | null> => {
      return await ensureRendered(params, { force: true });
    },
    [ensureRendered]
  );

  return { getState, ensureRendered, forceRender };
}
