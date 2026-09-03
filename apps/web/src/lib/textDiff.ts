/**
 * Utilidades de cotejo editorial (texto original del diario vs. redacción propia de IA).
 *
 * Todo el cálculo ocurre en el cliente sobre el texto real de la noticia: no hay
 * métricas "de adorno" ni valores fijos. El objetivo es que un editor pueda auditar
 * de un vistazo QUÉ cambió la IA y si la reescritura es suficientemente distinta del
 * original antes de aprobar la pieza para WordPress.
 */

// ---------------------------------------------------------------------------
// Normalización de entrada
// ---------------------------------------------------------------------------

/** Convierte HTML (o texto plano) en texto limpio, preservando saltos de párrafo. */
export function stripHtmlToText(input: string): string {
  return (input || '')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Trocea texto limpio en párrafos no vacíos. */
export function splitParagraphs(text: string): string[] {
  return stripHtmlToText(text)
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

/** Palabras en minúscula, sin puntuación de borde (para métricas léxicas). */
export function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/[""«»']/g, '"')
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}"]+|[^\p{L}\p{N}"]+$/gu, ''))
    .filter((w) => w.length > 0);
}

export function countWords(text: string): number {
  return tokenize(text).length;
}

/** Minutos de lectura redondeados (≈200 ppm). */
export function readingMinutes(text: string): number {
  return Math.max(1, Math.round(countWords(text) / 200));
}

// ---------------------------------------------------------------------------
// Similitud léxica (Jaccard sobre shingles de 3 palabras)
// ---------------------------------------------------------------------------

function shingles(tokens: string[], size = 3): Set<string> {
  const set = new Set<string>();
  if (tokens.length < size) {
    if (tokens.length > 0) set.add(tokens.join(' '));
    return set;
  }
  for (let i = 0; i <= tokens.length - size; i++) {
    set.add(tokens.slice(i, i + size).join(' '));
  }
  return set;
}

/**
 * Devuelve 0..1: proporción de expresiones de 3 palabras compartidas entre ambos
 * textos. Un valor alto significa que la IA copió frases largas literalmente
 * (riesgo legal); un valor bajo significa reescritura real.
 */
export function lexicalSimilarity(a: string, b: string): number {
  const sa = shingles(tokenize(a));
  const sb = shingles(tokenize(b));
  if (sa.size === 0 && sb.size === 0) return 1;
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const s of sa) if (sb.has(s)) shared++;
  return shared / (sa.size + sb.size - shared);
}

// ---------------------------------------------------------------------------
// Diff palabra por palabra (LCS) — para la vista Redline
// ---------------------------------------------------------------------------

export type DiffOp = { type: 'equal' | 'add' | 'remove'; text: string };

/** Segmenta en palabras + espacios para poder reconstruir el texto tal cual. */
function splitWithSpaces(text: string): string[] {
  return (text.match(/\S+|\s+/g) || []).filter(Boolean);
}

export function wordDiff(before: string, after: string): DiffOp[] {
  const a = splitWithSpaces(before);
  const b = splitWithSpaces(after);
  const n = a.length;
  const m = b.length;

  // Tabla LCS
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  const push = (type: DiffOp['type'], text: string) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.text += text;
    else ops.push({ type, text });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('equal', a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('remove', a[i]);
      i++;
    } else {
      push('add', b[j]);
      j++;
    }
  }
  while (i < n) push('remove', a[i++]);
  while (j < m) push('add', b[j++]);
  return ops;
}

// ---------------------------------------------------------------------------
// Alineación de párrafos (Needleman–Wunsch sobre matriz de similitud)
// ---------------------------------------------------------------------------

export type RowKind = 'identico' | 'editado' | 'reescrito' | 'eliminado' | 'nuevo';

export interface AlignedRow {
  kind: RowKind;
  original?: string;
  rewritten?: string;
  /** Similitud léxica del par (solo cuando ambos lados existen). */
  similarity: number;
}

function classifyPair(sim: number): RowKind {
  // Umbrales calibrados para cotejo anti-plagio: un solapamiento de expresiones
  // de 3 palabras por encima de ~0.6 ya indica un párrafo prácticamente calcado.
  if (sim >= 0.6) return 'identico';
  if (sim >= 0.28) return 'editado';
  return 'reescrito';
}

const GAP_PENALTY = 0.28;

export function alignParagraphs(originalText: string, rewrittenText: string): AlignedRow[] {
  const orig = splitParagraphs(originalText);
  const rew = splitParagraphs(rewrittenText);
  const n = orig.length;
  const m = rew.length;

  if (n === 0) return rew.map((r) => ({ kind: 'nuevo' as RowKind, rewritten: r, similarity: 0 }));
  if (m === 0) return orig.map((o) => ({ kind: 'eliminado' as RowKind, original: o, similarity: 0 }));

  const sim: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: m }, (_, j) => lexicalSimilarity(orig[i], rew[j]))
  );

  const score: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) score[i][0] = score[i - 1][0] - GAP_PENALTY;
  for (let j = 1; j <= m; j++) score[0][j] = score[0][j - 1] - GAP_PENALTY;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      score[i][j] = Math.max(
        score[i - 1][j - 1] + sim[i - 1][j - 1],
        score[i - 1][j] - GAP_PENALTY,
        score[i][j - 1] - GAP_PENALTY
      );
    }
  }

  const rows: AlignedRow[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      score[i][j] === score[i - 1][j - 1] + sim[i - 1][j - 1]
    ) {
      const s = sim[i - 1][j - 1];
      rows.push({
        kind: classifyPair(s),
        original: orig[i - 1],
        rewritten: rew[j - 1],
        similarity: s,
      });
      i--;
      j--;
    } else if (i > 0 && score[i][j] === score[i - 1][j] - GAP_PENALTY) {
      rows.push({ kind: 'eliminado', original: orig[i - 1], similarity: 0 });
      i--;
    } else {
      rows.push({ kind: 'nuevo', rewritten: rew[j - 1], similarity: 0 });
      j--;
    }
  }
  return rows.reverse();
}

// ---------------------------------------------------------------------------
// Menciones externas retiradas (heurística de nombres propios)
// ---------------------------------------------------------------------------

const STOPWORD_CAPS = new Set([
  'El', 'La', 'Los', 'Las', 'Un', 'Una', 'Unos', 'Unas', 'De', 'Del', 'Al', 'En',
  'Y', 'O', 'Pero', 'Como', 'Para', 'Por', 'Con', 'Sin', 'Su', 'Sus', 'Este',
  'Esta', 'Estos', 'Estas', 'Ese', 'Esa', 'Eso', 'Aunque', 'Según', 'Mientras',
  'Cuando', 'Donde', 'También', 'Además', 'Sin embargo', 'No', 'Sí', 'Ya', 'Hoy',
  'Ayer', 'Mañana', 'Fue', 'Es', 'Son', 'Está', 'Están', 'Tras', 'Entre', 'Desde',
]);

/**
 * Extrae nombres propios candidatos: siglas en mayúsculas (LUMA) y secuencias de
 * palabras capitalizadas de 2+ tokens (Carlos Rivera, El Negociado de Energía de
 * Puerto Rico). Se descartan las palabras capitalizadas sueltas porque casi
 * siempre son un inicio de oración, no una entidad.
 */
function properNouns(text: string): Map<string, string> {
  const clean = stripHtmlToText(text);
  const found = new Map<string, string>();

  const acronym = /\b([A-ZÁÉÍÓÚÑ]{2,}(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,3})/g;
  const phrase =
    /\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+(?:de|del|la|las|los|y|e)\s+)?(?:\s*[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)(?:\s+(?:de|del|la|las|los|y|e)?\s*[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,5})/g;

  for (const re of [acronym, phrase]) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(clean)) !== null) {
      const p = match[1].trim().replace(/\s+/g, ' ');
      const words = p.split(' ');
      const isAcronym = /^[A-ZÁÉÍÓÚÑ]{2,}$/.test(words[0]);
      if (!isAcronym && words.length < 2) continue;
      if (STOPWORD_CAPS.has(words[0]) && words.length < 2) continue;
      if (p.length < 4) continue;
      found.set(p.toLowerCase(), p);
    }
  }
  return found;
}

export interface RemovedMention {
  label: string;
  /** Nº de veces que aparecía en el texto original. */
  count: number;
}

/**
 * Nombres propios (fuentes citadas, medios, voceros, etc.) presentes en el texto
 * original que YA NO aparecen en la redacción propia. Es la evidencia principal de
 * que la pieza no arrastra atribuciones ni menciones ajenas.
 */
export function removedMentions(originalText: string, rewrittenText: string): RemovedMention[] {
  const inOriginal = properNouns(originalText);
  const rewrittenLc = stripHtmlToText(rewrittenText).toLowerCase();
  const origLc = stripHtmlToText(originalText).toLowerCase();

  const out: RemovedMention[] = [];
  for (const [key, label] of inOriginal) {
    if (rewrittenLc.includes(key)) continue;
    const count = origLc.split(key).length - 1;
    if (count > 0) out.push({ label, count });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 12);
}

// ---------------------------------------------------------------------------
// Resumen agregado para la "barra de cotejo"
// ---------------------------------------------------------------------------

export interface CompareSummary {
  similarity: number; // 0..1 global
  wordsOriginal: number;
  wordsRewritten: number;
  minutesOriginal: number;
  minutesRewritten: number;
  rows: AlignedRow[];
  byKind: Record<RowKind, number>; // peso en palabras
  removed: RemovedMention[];
}

const KIND_ORDER: RowKind[] = ['identico', 'editado', 'reescrito', 'nuevo', 'eliminado'];

export function buildCompareSummary(
  originalText: string,
  rewrittenText: string
): CompareSummary {
  const rows = alignParagraphs(originalText, rewrittenText);
  const byKind: Record<RowKind, number> = {
    identico: 0,
    editado: 0,
    reescrito: 0,
    eliminado: 0,
    nuevo: 0,
  };
  for (const row of rows) {
    const weight = countWords(row.rewritten ?? row.original ?? '');
    byKind[row.kind] += weight;
  }

  return {
    similarity: lexicalSimilarity(originalText, rewrittenText),
    wordsOriginal: countWords(stripHtmlToText(originalText)),
    wordsRewritten: countWords(stripHtmlToText(rewrittenText)),
    minutesOriginal: readingMinutes(originalText),
    minutesRewritten: readingMinutes(rewrittenText),
    rows,
    byKind,
    removed: removedMentions(originalText, rewrittenText),
  };
}

export const KIND_META: Record<
  RowKind,
  { label: string; short: string; bar: string; dot: string; chip: string }
> = {
  identico: {
    label: 'Casi idéntico al original',
    short: 'Idéntico',
    bar: '#dc2626',
    dot: 'bg-red-500',
    chip: 'bg-red-50 text-red-700 border-red-200',
  },
  editado: {
    label: 'Editado (mismo orden de ideas)',
    short: 'Editado',
    bar: '#f59e0b',
    dot: 'bg-amber-500',
    chip: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  reescrito: {
    label: 'Reescrito por completo',
    short: 'Reescrito',
    bar: '#16a34a',
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  nuevo: {
    label: 'Redacción nueva (sin equivalente)',
    short: 'Nuevo',
    bar: '#0ea5e9',
    dot: 'bg-sky-500',
    chip: 'bg-sky-50 text-sky-700 border-sky-200',
  },
  eliminado: {
    label: 'Presente solo en el original',
    short: 'Descartado',
    bar: '#94a3b8',
    dot: 'bg-slate-400',
    chip: 'bg-slate-100 text-slate-600 border-slate-300',
  },
};

export { KIND_ORDER };
