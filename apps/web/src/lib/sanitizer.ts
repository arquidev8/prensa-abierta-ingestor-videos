/**
 * Filtro de sanitización estricto para asegurar que ninguna redacción
 * contenga referencias a medios de la competencia o periodistas externos.
 * Toda la voz debe ser 100% de Prensa Abierta (prensaabierta.pr).
 */

const COMPETITOR_PATTERNS = [
  /\b(según|segun|de acuerdo con|reportó|informó|consignó|publicó|reseñó)\s+(el nuevo d[ií]a|primera hora|el vocero|noticel|metro puerto rico|metro pr|telenoticias|telemundo|wapa|univisi[oó]n|noticentro|el vocero de puerto rico)\b/gi,
  /\b(el nuevo d[ií]a|primera hora|el vocero|noticel|metro puerto rico|metro pr|telenoticias|telemundo pr|wapa tv|wapa deportes|univisi[oó]n pr)\b/gi,
  /\b(a preguntas de\s+[a-záéíóúñ\s]+de\s+(metro|el nuevo d[ií]a|primera hora|el vocero|noticel))\b/gi,
  /\b(según informó la periodista|según reportó el periodista|según supo)\s+[a-záéíóúñ\s]+,\s*de\s+[a-záéíóúñ\s]+/gi,
];

export function sanitizeBrandVoice(text: string): string {
  if (!text) return '';

  let sanitized = text;

  // Reemplazar patrones de atribución a terceros
  COMPETITOR_PATTERNS.forEach((pattern) => {
    sanitized = sanitized.replace(pattern, (match) => {
      // Si era "según informó El Nuevo Día" -> "según se informó" o "según reportes obtenidos por Prensa Abierta"
      if (match.toLowerCase().includes('según') || match.toLowerCase().includes('de acuerdo')) {
        return 'según fuentes consultadas por Prensa Abierta';
      }
      return 'Prensa Abierta';
    });
  });

  // Limpieza de espacios redundantes
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  return sanitized;
}
