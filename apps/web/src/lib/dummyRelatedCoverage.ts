import type { RelatedSource } from './types';

/**
 * Datos de ejemplo para /dev/cobertura — simula lo que RawNews.related_sources
 * devolverá una vez que el matcher del Engine (services/engine/pkg/matcher)
 * corra contra datos reales. Los logos usan el mismo servicio de favicons que
 * el backend (Google s2/favicons), así el demo se ve igual que en producción.
 */

function favicon(domain: string): string {
  return `https://www.google.com/s2/favicons?sz=128&domain=${domain}`;
}

const SOURCES: Record<string, RelatedSource> = {
  elNuevoDia: {
    source_id: 'el-nuevo-dia',
    source_name: 'El Nuevo Día',
    source_logo_url: favicon('www.elnuevodia.com'),
    url: 'https://www.elnuevodia.com/noticias/seguridad/nota/ejemplo-1',
    title: 'Gobernadora anuncia nuevas medidas de seguridad tras aumento de criminalidad',
    published_at: '2026-09-24T14:05:00Z',
    similarity: 0.42,
  },
  primeraHora: {
    source_id: 'primera-hora',
    source_name: 'Primera Hora',
    source_logo_url: favicon('www.primerahora.com'),
    url: 'https://www.primerahora.com/noticias/puerto-rico/nota/ejemplo-2',
    title: 'Jenniffer González presenta plan de seguridad para combatir el crimen',
    published_at: '2026-09-24T14:12:00Z',
    similarity: 0.31,
  },
  metroPr: {
    source_id: 'metro-pr',
    source_name: 'Metro Puerto Rico',
    source_logo_url: favicon('www.metro.pr'),
    url: 'https://www.metro.pr/pr/noticias/ejemplo-3',
    title: 'Gobierno refuerza patrullaje en San Juan tras ola de crímenes',
    published_at: '2026-09-24T15:40:00Z',
    similarity: 0.19,
  },
  noticel: {
    source_id: 'noticel',
    source_name: 'NotiCel',
    source_logo_url: favicon('www.noticel.com'),
    url: 'https://www.noticel.com/gobierno/ejemplo-4',
    title: 'Ejecutivo anuncia cámaras y más agentes para el área metro',
    published_at: '2026-09-24T16:02:00Z',
    similarity: 0.15,
  },
};

export type DummyCoverageCase = 'many' | 'one' | 'none';

export const DUMMY_COVERAGE_CASES: Record<DummyCoverageCase, RelatedSource[]> = {
  many: [SOURCES.elNuevoDia, SOURCES.primeraHora, SOURCES.metroPr, SOURCES.noticel],
  one: [SOURCES.primeraHora],
  none: [],
};

export const DUMMY_COVERAGE_LABELS: Record<DummyCoverageCase, string> = {
  many: 'Varios medios (4)',
  one: 'Un solo medio',
  none: 'Sin coincidencias',
};
