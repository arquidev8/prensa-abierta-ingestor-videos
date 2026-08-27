import { RawNews } from './types';

// Palabras clave de alto impacto y viralidad en Puerto Rico
const HIGH_VIRAL_KEYWORDS: Record<string, number> = {
  // Figuras y Farándula
  'bad bunny': 98,
  'concierto': 85,
  'bithorn': 88,
  'maripily': 90,
  'anuel': 82,
  'daddy yankee': 85,
  'ohtani': 92,
  'edwin diaz': 88,
  'dodgers': 86,
  'mets': 80,
  'boxeo': 82,

  // Servicios Esenciales y Clima
  'luma': 96,
  'aaa': 94,
  'acueductos': 90,
  'embalses': 92,
  'agua': 85,
  'apagon': 95,
  'sin luz': 95,
  'onda tropical': 93,
  'huracan': 99,
  'tormenta': 94,
  'aviso de calor': 82,

  // Tribunales, Crimen y Política
  'asesinato': 88,
  'tribunal': 82,
  'jurado': 85,
  'fraude': 86,
  'autoexpreso': 90,
  'dtop': 88,
  'arresto': 84,
  'fbi': 94,
  'corrupcion': 92,
  'elecciones': 95,
  'gobernador': 88,
  'senado': 80,
  'fortaleza': 85,
};

export interface TrendAnalysis {
  score: number; // 0 a 100
  isTrending: boolean;
  reason?: string;
}

export function calculateViralTrendScore(news: RawNews): TrendAnalysis {
  const text = `${news.title} ${news.summary || ''} ${news.content || ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  let maxScore = 50; // Base score
  let matchedKeyword: string | null = null;

  for (const [kw, score] of Object.entries(HIGH_VIRAL_KEYWORDS)) {
    const cleanKw = kw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (text.includes(cleanKw)) {
      if (score > maxScore) {
        maxScore = score;
        matchedKeyword = kw.toUpperCase();
      }
    }
  }

  // Bonus por frescura temporal (noticias de las últimas horas)
  if (news.published_at) {
    const published = new Date(news.published_at).getTime();
    const now = Date.now();
    const hoursDiff = (now - published) / (1000 * 60 * 60);

    if (hoursDiff <= 3) {
      maxScore = Math.min(100, maxScore + 10);
    } else if (hoursDiff <= 12) {
      maxScore = Math.min(100, maxScore + 5);
    }
  }

  const isTrending = maxScore >= 80;

  return {
    score: maxScore,
    isTrending,
    reason: matchedKeyword ? `Tendencia por: ${matchedKeyword}` : 'Interés General',
  };
}
