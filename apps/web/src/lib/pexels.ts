export interface StockVideoClip {
  id: string | number;
  url: string;
  thumbnail: string;
  duration: number;
  width: number;
  height: number;
}

export interface StockImage {
  id: string | number;
  url: string;
  alt: string;
}

// Fallback high-quality vertical clips (Puerto Rico, Capitol, Police, Press Room, Court)
// Nota: se evitan clips con gráficos de noticiero incrustados (ej. "BREAKING NEWS" en inglés)
const CURATED_NEWS_CLIPS: Record<string, string[]> = {
  general: [
    'https://assets.mixkit.co/videos/preview/mixkit-busy-city-street-with-traffic-and-pedestrians-41482-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-hands-typing-on-a-laptop-in-an-office-41483-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-drone-view-of-a-tropical-coastline-41500-large.mp4',
  ],
  politica: [
    'https://assets.mixkit.co/videos/preview/mixkit-government-building-with-columns-and-flags-41485-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-press-conference-with-microphones-and-cameras-41486-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-politician-speaking-at-a-podium-41487-large.mp4',
  ],
  tribunales: [
    'https://assets.mixkit.co/videos/preview/mixkit-wooden-gavel-in-a-courtroom-41488-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-law-books-and-scales-of-justice-41489-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-courthouse-entrance-with-steps-41490-large.mp4',
  ],
  policia: [
    'https://assets.mixkit.co/videos/preview/mixkit-police-car-lights-flashing-at-night-41491-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-emergency-services-responding-to-a-call-41492-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-police-officers-on-patrol-41493-large.mp4',
  ],
  deportes: [
    'https://assets.mixkit.co/videos/preview/mixkit-basketball-game-in-an-arena-41494-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-stadium-lights-and-crowd-cheering-41495-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-athletes-training-on-a-field-41496-large.mp4',
  ],
  clima: [
    'https://assets.mixkit.co/videos/preview/mixkit-heavy-rain-and-wind-in-a-tropical-storm-41497-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-dark-storm-clouds-moving-fast-41498-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-ocean-waves-crashing-on-the-shore-41499-large.mp4',
  ],
};

// Frases prohibidas: evitan traer b-roll con gráficos de noticiero ajenos incrustados (ej. "BREAKING NEWS")
const BLOCKED_VIDEO_SEARCH_TERMS = [
  'breaking news',
  'breaking',
  'news anchor',
  'news studio',
  'newsroom',
  'anchor',
  'studio',
  'broadcast',
];

export function sanitizeVideoSearchQuery(query: string): string {
  let safe = query || '';
  BLOCKED_VIDEO_SEARCH_TERMS.forEach((term) => {
    safe = safe.replace(new RegExp(term, 'gi'), '');
  });
  safe = safe.replace(/\s+/g, ' ').trim();
  return safe || 'puerto rico ultimas noticias';
}

export function sanitizeVideoSearchTags(tags: string[]): string[] {
  const cleaned = (tags || [])
    .map((tag) => sanitizeVideoSearchQuery(tag))
    .filter((tag) => tag.length > 0);
  return cleaned.length > 0 ? cleaned : ['puerto rico', 'ultimas noticias'];
}

/**
 * Busca clips de video verticales en Pexels para `query`. Se usa en el pipeline de
 * composición cuando falta en el banco propio el video (o la imagen) coherente con
 * el tema de la noticia: la parte que falte se trae de Pexels para que la
 * composición imagen+video tenga sentido.
 *
 * Con `PEXELS_API_KEY` consulta la API real. Sin key (o si la API falla) cae a un
 * set de clips "curados" por categoría.
 */
export async function searchPexelsVideos(
  query: string,
  category: string = 'general',
  apiKey?: string
): Promise<string[]> {
  const key = apiKey || process.env.PEXELS_API_KEY;
  const safeQuery = sanitizeVideoSearchQuery(query);

  if (key) {
    try {
      const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(
        safeQuery
      )}&orientation=portrait&size=medium&per_page=3`;

      const res = await fetch(url, {
        headers: {
          Authorization: key,
        },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.videos && data.videos.length > 0) {
          const clipUrls = data.videos
            .map((v: any) => {
              // El clip lo baja el Go Engine y lo recorta a 1080x1920. Se elige el
              // archivo VERTICAL más chico que aún sirva para esa resolución
              // (height >= 1080): un HD/UHD gigante multiplica la descarga y el
              // transcode y agotaba el timeout de render.
              const portrait = (v.video_files || [])
                .filter((f: any) => f.width && f.height && f.height > f.width)
                .sort((a: any, b: any) => a.height - b.height);
              const file =
                portrait.find((f: any) => f.height >= 1080) ||
                portrait[portrait.length - 1] ||
                v.video_files[0];
              return file ? file.link : null;
            })
            .filter(Boolean);

          if (clipUrls.length > 0) {
            console.log(`[Pexels API] Se encontraron ${clipUrls.length} clips para "${safeQuery}"`);
            return clipUrls;
          }
        }
      }
    } catch (e) {
      console.warn('[Pexels API] Error buscando videos:', e);
    }
  }

  // Fallback con clips temáticos
  const catKey = category.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (catKey.includes('poli') || catKey.includes('gobierno') || catKey.includes('senado')) {
    return CURATED_NEWS_CLIPS.politica;
  }
  if (catKey.includes('tribun') || catKey.includes('justicia') || catKey.includes('ley')) {
    return CURATED_NEWS_CLIPS.tribunales;
  }
  if (catKey.includes('seguridad') || catKey.includes('crimen') || catKey.includes('polic')) {
    return CURATED_NEWS_CLIPS.policia;
  }
  if (catKey.includes('depor') || catKey.includes('baloncesto') || catKey.includes('beisbol')) {
    return CURATED_NEWS_CLIPS.deportes;
  }
  if (catKey.includes('clima') || catKey.includes('huracan') || catKey.includes('tiempo')) {
    return CURATED_NEWS_CLIPS.clima;
  }

  return CURATED_NEWS_CLIPS.general;
}

/**
 * Busca FOTOS verticales en Pexels para `query`. Se usa como imagen líder de la
 * composición cuando la carpeta de la categoría no tiene una imagen referente.
 * Sin `PEXELS_API_KEY` devuelve `[]` (el caller cae a la imagen destacada de la
 * noticia). No hay set "curado" de fotos.
 */
export async function searchPexelsPhotos(query: string, apiKey?: string): Promise<string[]> {
  const key = apiKey || process.env.PEXELS_API_KEY;
  if (!key) return [];
  const safeQuery = sanitizeVideoSearchQuery(query);

  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(
      safeQuery
    )}&orientation=portrait&size=medium&per_page=3`;
    const res = await fetch(url, { headers: { Authorization: key } });
    if (res.ok) {
      const data = await res.json();
      const urls: string[] = (data.photos || [])
        .map((p: any) => p?.src?.large2x || p?.src?.large || p?.src?.original || null)
        .filter(Boolean);
      if (urls.length > 0) {
        console.log(`[Pexels API] ${urls.length} fotos para "${safeQuery}"`);
        return urls;
      }
    } else {
      console.warn(`[Pexels API] fotos respondió ${res.status} para "${safeQuery}"`);
    }
  } catch (e) {
    console.warn('[Pexels API] Error buscando fotos:', e);
  }
  return [];
}
