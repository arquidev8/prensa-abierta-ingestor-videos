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

// Fallback high-quality vertical and news clips (Puerto Rico, Capitol, Police, Press Room, Court)
const CURATED_NEWS_CLIPS: Record<string, string[]> = {
  general: [
    'https://assets.mixkit.co/videos/preview/mixkit-news-anchor-talking-in-a-studio-41484-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-busy-city-street-with-traffic-and-pedestrians-41482-large.mp4',
    'https://assets.mixkit.co/videos/preview/mixkit-hands-typing-on-a-laptop-in-an-office-41483-large.mp4',
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

export async function searchPexelsVideos(
  query: string,
  category: string = 'general',
  apiKey?: string
): Promise<string[]> {
  const key = apiKey || process.env.PEXELS_API_KEY;

  if (key) {
    try {
      const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(
        query
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
              const file =
                v.video_files.find((f: any) => f.height > f.width && f.quality === 'hd') ||
                v.video_files[0];
              return file ? file.link : null;
            })
            .filter(Boolean);

          if (clipUrls.length > 0) {
            console.log(`[Pexels API] Se encontraron ${clipUrls.length} clips para "${query}"`);
            return clipUrls;
          }
        }
      }
    } catch (e) {
      console.warn('[Pexels API] Error buscando videos:', e);
    }
  }

  // Fallback con clips temáticos
  const catKey = category.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
