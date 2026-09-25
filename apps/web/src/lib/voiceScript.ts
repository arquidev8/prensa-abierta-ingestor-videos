// Guion de la locución del video: categoría + titular + el arranque de la nota, acotado
// al tiempo del video. El texto resultante viaja como `voice_text` al Go Engine, que lo
// convierte en voz con ElevenLabs y la mezcla al .mp4 (pkg/voice + pkg/video/voiceover.go).
//
// El límite lo pone la DURACIÓN del video, no el largo de la nota: una locución de 30
// palabras dura ~12s, así que a mayor duración entra más texto de la nota. El Engine
// vuelve a proteger el límite (acelera hasta x1.25 y recorta con fade), pero el guion ya
// llega dimensionado para que casi nunca haga falta.

import { lexicalSimilarity, stripHtmlToText } from './textDiff';

// Palabras por segundo de una locución en español a velocidad 1.0. Es una estimación:
// el Engine loguea la duración real del audio ([Voice] ... audio X.XXs), así que este
// valor se afina con datos reales. Si un guion se pasa, el Engine lo acelera hasta x1.25.
const WORDS_PER_SECOND = 2.7;
// Segundos que la locución NO puede ocupar: silencio inicial + cola final (ver
// voiceLeadInSec / voiceTailSec en el Engine) + margen de seguridad.
const RESERVED_SECONDS = 1.2;
// Con menos de esto de presupuesto no vale la pena hablar.
const MIN_WORDS = 6;
// Categorías que no aportan al oyente ("Noticias. …").
const GENERIC_CATEGORIES = new Set(['noticias', 'general', 'ahora', 'nacional', 'ultima hora']);

export interface VoiceScript {
  text: string;
  words: number;
  budgetWords: number;
  /** De dónde salió cada parte, para el log. */
  parts: { category: boolean; headlineTruncated: boolean; bodySentences: number };
}

export function voiceWordBudget(durationSec: number): number {
  return Math.max(0, Math.floor((durationSec - RESERVED_SECONDS) * WORDS_PER_SECOND));
}

const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;

function endWithPeriod(s: string): string {
  const t = s.trim().replace(/[\s,;:\-–—]+$/, '');
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

function truncateWords(s: string, max: number): string {
  return s.split(/\s+/).filter(Boolean).slice(0, max).join(' ');
}

function normalizeCategory(category: string): string {
  return category
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/** Primera cláusula (hasta una coma/punto y coma) que entra en `maxWords`, o ''. */
function firstClauseWithin(sentence: string, maxWords: number): string {
  const clause = sentence.split(/[,;:]\s+/)[0];
  return countWords(clause) >= MIN_WORDS && countWords(clause) <= maxWords ? clause : '';
}

/**
 * Devuelve null si no hay presupuesto ni para hablar (video muy corto) o no hay titular.
 * Nunca corta una frase a la mitad: la nota entra por oraciones completas (o, en su
 * defecto, por la primera cláusula); el titular solo se trunca si él solo ya excede el
 * presupuesto.
 */
export function buildVoiceScript(input: {
  category?: string;
  headline: string;
  body?: string;
  durationSec: number;
}): VoiceScript | null {
  const budget = voiceWordBudget(input.durationSec);
  const headline = (input.headline || '').replace(/\s+/g, ' ').trim();
  if (!headline || budget < MIN_WORDS) return null;

  let used = 0;
  const spoken: string[] = [];

  // 1. Categoría (solo si no es genérica y deja espacio para el titular).
  const cat = (input.category || '').trim();
  let hasCategory = false;
  if (cat && !GENERIC_CATEGORIES.has(normalizeCategory(cat)) && countWords(cat) <= 3) {
    const catWords = countWords(cat);
    if (budget - catWords >= MIN_WORDS) {
      spoken.push(endWithPeriod(cat));
      used += catWords;
      hasCategory = true;
    }
  }

  // 2. Titular (truncado por palabras solo si él solo ya no entra).
  const room = budget - used;
  const headlineWords = countWords(headline);
  const headlineTruncated = headlineWords > room;
  spoken.push(endWithPeriod(headlineTruncated ? truncateWords(headline, room) : headline));
  used += Math.min(headlineWords, room);

  // 3. Arranque de la nota, por oraciones completas mientras quepan.
  let bodySentences = 0;
  const bodyText = stripHtmlToText(input.body || '').replace(/\s+/g, ' ').trim();
  if (bodyText && used < budget) {
    const sentences = bodyText
      .split(/(?<=[.!?…])\s+/)
      .map((s) => s.trim())
      .filter((s) => countWords(s) >= 4);

    for (const sentence of sentences) {
      // Si la entradilla repite el titular, no se dice dos veces.
      if (bodySentences === 0 && lexicalSimilarity(headline, sentence) > 0.6) continue;

      const w = countWords(sentence);
      if (used + w <= budget) {
        spoken.push(endWithPeriod(sentence));
        used += w;
        bodySentences++;
        continue;
      }
      // La primera oración que no entra: se intenta su primera cláusula y se termina
      // (seguir con oraciones posteriores rompería el orden de la nota).
      if (bodySentences === 0) {
        const clause = firstClauseWithin(sentence, budget - used);
        if (clause) {
          spoken.push(endWithPeriod(clause));
          used += countWords(clause);
          bodySentences++;
        }
      }
      break;
    }
  }

  return {
    text: spoken.join(' '),
    words: used,
    budgetWords: budget,
    parts: { category: hasCategory, headlineTruncated, bodySentences },
  };
}
