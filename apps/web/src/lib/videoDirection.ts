import { sanitizeBrandVoice } from './sanitizer';
import { sanitizeVideoSearchQuery, sanitizeVideoSearchTags } from './pexels';

/**
 * "Dirección de video": las decisiones de COMPOSICIÓN que toma la IA (o el Motor
 * Autónomo) para el Reel 9:16, separadas de la redacción web. Se genera y sanea
 * en Capa 1, se persiste en ProcessedNews en Capa 2 y la consume /api/render-video
 * en Capa 3 para alimentar al Go Engine.
 */
export interface VideoDirection {
  /** Origen de la dirección: `ai` = modelo remoto, `autonomous` = motor heurístico
   *  local (rewriter.ts). Ausente = registro anterior a esta feature. */
  source?: 'ai' | 'autonomous';
  /** Titular corto pensado para el rótulo 9:16 (no el titular largo de WordPress). */
  headline: string;
  /** Copy de 1-2 oraciones para el pie de Reels / TikTok. */
  caption: string;
  /** Plantilla de layout del Go Engine (ver layoutFor() en pkg/video/engine.go). */
  template: 'standard' | 'reels-safe' | 'app-promo';
  /** Duración total del clip en segundos. */
  duration_sec: number;
  /** Qué pieza lidera la composición: la imagen fija o el b-roll de video. */
  lead_with: 'image' | 'video';
  /** Ritmo editorial → luego mapea a lead_image_sec / pista musical. */
  pace: 'urgente' | 'neutral' | 'reposado';
  /** Query para la FOTO líder en Pexels. Vacío = sin concepto propio: el caller
   *  usa la imagen destacada de la noticia o la query del titular. */
  image_query: string;
  /** Queries de b-roll en orden de prioridad (banco propio → Pexels). */
  clip_queries: string[];
  /** Estilo del rótulo del titular en pantalla. */
  headline_style: 'banner' | 'lower_third' | 'center';
}

const SOURCES: NonNullable<VideoDirection['source']>[] = ['ai', 'autonomous'];
const TEMPLATES: VideoDirection['template'][] = ['standard', 'reels-safe', 'app-promo'];
const PACES: VideoDirection['pace'][] = ['urgente', 'neutral', 'reposado'];
const LEADS: VideoDirection['lead_with'][] = ['image', 'video'];
const HEADLINE_STYLES: VideoDirection['headline_style'][] = ['banner', 'lower_third', 'center'];

const DURATION_MIN = 8;
const DURATION_MAX = 18;
const DURATION_DEFAULT = 12;

const HEADLINE_MAX = 90;
const CAPTION_MAX = 220;
const MAX_CLIP_QUERIES = 4;

export interface VideoDirectionContext {
  /** Titular de respaldo si la IA no entrega uno (normalmente el de WordPress). */
  fallbackHeadline: string;
  category?: string;
  /** Tags de búsqueda ya saneados, usados para rellenar clip_queries si faltan. */
  videoSearchTags?: string[];
}

function pickEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;
}

function clampDuration(value: unknown): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return DURATION_DEFAULT;
  return Math.min(DURATION_MAX, Math.max(DURATION_MIN, Math.round(n)));
}

function trimTo(text: unknown, max: number): string {
  const clean = sanitizeBrandVoice(String(text ?? ''));
  return clean.length > max ? clean.slice(0, max).trim() : clean;
}

/**
 * Normaliza la `video_direction` cruda de la IA a un objeto válido y seguro:
 * enums en whitelist, duración acotada, textos saneados con la voz de marca y
 * queries filtradas (sin "breaking news" & co.). Rellena los huecos con el
 * contexto de la noticia para que SIEMPRE devuelva una dirección utilizable.
 * `image_query` es la excepción: se deja vacío si nadie dio un concepto propio,
 * para que /api/render-video pueda preferir la imagen destacada de la noticia.
 */
export function sanitizeVideoDirection(
  raw: unknown,
  ctx: VideoDirectionContext
): VideoDirection {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const headline =
    trimTo(d.headline, HEADLINE_MAX) || trimTo(ctx.fallbackHeadline, HEADLINE_MAX);

  const rawClipQueries = Array.isArray(d.clip_queries) ? d.clip_queries : [];
  let clipQueries = rawClipQueries
    .map((q) => sanitizeVideoSearchQuery(String(q)))
    .filter((q, i, arr) => q.length > 0 && arr.indexOf(q) === i)
    .slice(0, MAX_CLIP_QUERIES);
  if (clipQueries.length === 0) {
    clipQueries = sanitizeVideoSearchTags(ctx.videoSearchTags || []).slice(0, MAX_CLIP_QUERIES);
  }

  const rawImageQuery = String(d.image_query ?? '').trim();
  const imageQuery = rawImageQuery ? sanitizeVideoSearchQuery(rawImageQuery) : '';

  const source =
    typeof d.source === 'string' && SOURCES.includes(d.source as 'ai' | 'autonomous')
      ? (d.source as 'ai' | 'autonomous')
      : undefined;

  return {
    ...(source ? { source } : {}),
    headline,
    caption: trimTo(d.caption, CAPTION_MAX),
    template: pickEnum(d.template, TEMPLATES, 'standard'),
    duration_sec: clampDuration(d.duration_sec),
    lead_with: pickEnum(d.lead_with, LEADS, 'video'),
    pace: pickEnum(d.pace, PACES, 'neutral'),
    image_query: imageQuery,
    clip_queries: clipQueries,
    headline_style: pickEnum(d.headline_style, HEADLINE_STYLES, 'banner'),
  };
}

/**
 * Dirección de video heurística para el Motor Autónomo (cuando no hay IA remota).
 * Deriva plantilla/ritmo de la categoría y reutiliza los tags de búsqueda ya
 * calculados por el motor. NO fija `image_query`: el motor no infiere un concepto
 * visual útil, así que /api/render-video usará la imagen destacada de la noticia.
 */
export function fallbackVideoDirection(ctx: VideoDirectionContext): VideoDirection {
  const category = (ctx.category || '').toLowerCase();
  const urgent = /tribunal|polic|seguridad|tiempo|clima|hurac|emergencia|suceso/.test(category);

  return sanitizeVideoDirection(
    {
      source: 'autonomous',
      headline: ctx.fallbackHeadline,
      caption: '',
      template: 'standard',
      duration_sec: urgent ? 10 : 12,
      lead_with: 'video',
      pace: urgent ? 'urgente' : 'neutral',
      image_query: '',
      clip_queries: ctx.videoSearchTags || [],
      headline_style: 'banner',
    },
    ctx
  );
}
