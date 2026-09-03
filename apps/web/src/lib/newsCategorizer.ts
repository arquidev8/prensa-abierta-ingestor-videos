// Clasificación de noticias por palabras clave, a partir del título/resumen.
//
// Por qué existe: los feeds RSS de los medios de Puerto Rico (todos "outboundfeeds"
// de Arc Publishing, ver services/engine/pkg/scraper/sources.go) casi nunca traen
// una categoría por artículo — el scraper (poller.go) cae siempre al valor
// genérico fijo por medio (`src.Category`: "General", "Nacional", "Investigación
// & Política"), así que agrupar por `RawNews.category` tal cual da como máximo un
// puñado de valores, uno por medio, no por tema real de la noticia.
//
// Esta función infiere una categoría más específica (Deportes, Farándula, El
// Tiempo, etc.) analizando el título y el resumen con un diccionario de palabras
// clave — el mismo enfoque que ya usa `contentLibrary.ts` para elegir b-roll de
// video, pero con una taxonomía propia pensada para categorizar noticias, no
// para elegir clips.
//
// Nota: NO se importa `contentLibrary.ts` (aunque tiene una función equivalente)
// porque ese módulo usa `fs`/`path` para leer `assets/contenido` en el servidor;
// importarlo desde este archivo (usado en page.tsx, un Client Component) rompe el
// build al intentar incluir `fs` en el bundle del navegador. Se duplica la
// normalización, que es solo un par de líneas de string puro.
function normalizeCategoryString(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

interface NewsCategoryDefinition {
  label: string;
  keywords: string[];
}

// El orden importa: se evalúa en este orden y se devuelve la PRIMERA que matchee,
// de más específica/inequívoca a más genérica (ej. un choque con lesionados debe
// caer en "Sucesos" antes que confundirse con "El Tiempo" si de paso menciona lluvia).
const NEWS_CATEGORIES: NewsCategoryDefinition[] = [
  {
    label: 'Sucesos',
    keywords: [
      'policia', 'crimen', 'seguridad publica', 'tribunal', 'tribunales', 'justicia',
      'fiscalia', 'arresto', 'arrestado', 'asesinato', 'homicidio', 'tiroteo',
      'accidente', 'incendio', 'bomberos', 'robo', 'hurto', 'asalto', 'asaltante',
      'atraco', 'droga', 'drogas', 'emergencia', 'allanamiento', 'preso', 'carcel',
      'convicto', 'sentencia', 'juicio', 'denuncia', 'balacera', 'secuestro',
      'violacion', 'agresion', 'bala', 'balazo', 'herido de', 'heridos', 'disparo',
      'disparos', 'baleado', 'baleada', 'apunalado', 'apunalada',
    ],
  },
  {
    label: 'Deportes',
    keywords: [
      'deporte', 'deportes', 'baloncesto', 'beisbol', 'bsn', 'voleibol', 'pelota',
      'futbol', 'soccer', 'olimpico', 'boxeo', 'atletismo', 'mlb', 'nba', 'nfl',
      'wnba', 'maraton', 'atleta', 'campeonato', 'seleccion nacional', 'entrenador',
      'liga de', 'juegos centroamericanos', 'medalla de oro',
    ],
  },
  {
    label: 'Farándula',
    keywords: [
      'farandula', 'artista', 'cantante', 'actor', 'actriz', 'concierto',
      'pelicula', 'estreno', 'serie de tv', 'musica', 'celebridad', 'bad bunny',
      'regueton', 'reggaeton', 'telenovela', 'premios', 'grammy', 'billboard',
      'famoso', 'famosa', 'entretenimiento', 'reality show', 'influencer',
    ],
  },
  {
    label: 'El Tiempo',
    keywords: [
      'huracan', 'tormenta tropical', 'tormenta', 'lluvia', 'meteorologico',
      'aviso de', 'vaguada', 'pronostico del tiempo', 'ciclon', 'depresion tropical',
      'servicio nacional de meteorologia', 'ola de calor', 'frente frio', 'onda tropical',
    ],
  },
  {
    label: 'Salud',
    keywords: [
      'salud publica', 'hospital', 'medico', 'covid', 'vacuna', 'enfermedad',
      'paciente', 'departamento de salud', 'dengue', 'brote', 'epidemia',
      'clinica', 'cirugia',
    ],
  },
  {
    label: 'Educación',
    keywords: [
      'educacion', 'escuela', 'universidad', 'estudiante', ' upr ', 'upr,', 'upr.',
      'maestro', 'maestros', 'departamento de educacion', 'matricula', 'semestre',
      'huelga de maestros', 'huelga estudiantil',
    ],
  },
  {
    label: 'Economía',
    keywords: [
      'economia', 'finanzas', 'negocio', 'negocios', 'comercio', 'hacienda',
      'dinero', 'banco', 'inflacion', 'arancel', 'aranceles', 'bolsa', 'mercado',
      'turismo', 'cripto', 'banca', 'presupuesto', 'desempleo', 'impuesto',
      'impuestos',
    ],
  },
  {
    // Antes que "Gobierno": una noticia de política federal de EE.UU. debe caer
    // aquí y no confundirse con la política local por la palabra "congreso"/"senado".
    label: 'Estados Unidos',
    keywords: [
      'estados unidos', 'ee. uu', 'ee.uu', 'eeuu', 'washington', 'casa blanca',
      'donald trump', 'presidente trump', 'joe biden', 'kamala harris',
      'congreso de estados unidos', 'senado federal', 'camara federal',
      'corte suprema federal', 'supremo federal', 'gobierno federal', 'reserva federal',
      'homeland security', 'servicio de inmigracion', 'deportacion', 'deportaciones',
      'frontera sur', 'nueva york', 'la florida', 'departamento de estado',
    ],
  },
  {
    label: 'Internacional',
    keywords: [
      'internacional', 'del mundo', 'a nivel mundial', 'extranjero', 'naciones unidas',
      'union europea', 'america latina', 'latinoamerica', 'republica dominicana',
      'venezuela', 'cuba', 'haiti', 'ucrania', 'israel', 'palestina', 'gaza',
      'medio oriente', 'guerra en', 'conflicto en', 'cumbre de', 'vaticano',
      'corte penal internacional', 'la haya',
    ],
  },
  {
    label: 'Gobierno',
    keywords: [
      'gobierno', 'politica', 'senado', 'camara de representantes', 'fortaleza',
      'gobernador', 'gobernadora', 'alcalde', 'alcaldesa', 'alcaldia', 'legislatura',
      'eleccion', 'elecciones', 'partido nuevo progresista', 'pnp', 'ppd', 'pip',
      'mvc', 'congreso', 'junta de control', 'fema', 'municipio',
    ],
  },
  {
    // Última (más genérica): noticia de barrio/pueblo/cultura de PR que no encajó
    // en ninguna categoría temática anterior.
    label: 'Local',
    keywords: [
      'comunidad', 'los vecinos', 'vecindario', 'barriada', 'residentes de',
      'municipio de', 'pueblo de', 'casco urbano', 'fiestas patronales', 'festival',
      'carnaval', 'tradicion', 'patrimonio', 'cultura popular', 'centro cultural',
      'san juan', 'bayamon', 'carolina', 'ponce', 'caguas', 'guaynabo', 'mayaguez',
      'arecibo', 'aguadilla', 'fajardo', 'humacao', 'cayey', 'manati', 'vega baja',
      'dorado', 'toa baja', 'toa alta', 'catano', 'trujillo alto', 'canovanas',
      'loiza', 'rio grande', 'juncos', 'gurabo', 'yauco', 'guayama', 'utuado',
      'cabo rojo', 'rincon', 'isabela', 'barceloneta', 'orocovis', 'aibonito',
      'barranquitas', 'carretera pr', 'tapon', 'peaje', 'autoexpreso', 'tren urbano',
      'reciclaje', 'vertedero', 'fiesta de pueblo',
    ],
  },
];

function findMatch(haystack: string): string | null {
  for (const { label, keywords } of NEWS_CATEGORIES) {
    if (keywords.some((kw) => haystack.includes(normalizeCategoryString(kw)))) {
      return label;
    }
  }
  return null;
}

/**
 * Infiere una categoría de noticia a partir de palabras clave en el título y,
 * como respaldo, el resumen. Si no matchea ninguna, cae al `fallback`
 * (típicamente el `category` crudo que ya trae la noticia, ej.
 * "General"/"Nacional") o a "Otras".
 *
 * Se prueba primero SOLO con el título: es la señal más confiable (de qué
 * trata realmente la noticia). El resumen se usa solo si el título no matcheó
 * nada — probado en la práctica, escanear el resumen completo desde el
 * arranque trae ruido (menciona entidades de contexto ajenas al tema real,
 * ej. un artículo de economía que de paso cita al Senado terminaba
 * clasificado como "Gobierno").
 */
export function inferNewsCategory(
  title?: string,
  summary?: string,
  fallback?: string
): string {
  const titleMatch = findMatch(normalizeCategoryString(title || ''));
  if (titleMatch) return titleMatch;

  const combinedMatch = findMatch(normalizeCategoryString(`${title || ''} ${summary || ''}`));
  if (combinedMatch) return combinedMatch;

  return fallback && fallback.trim() !== '' ? fallback : 'Otras';
}
