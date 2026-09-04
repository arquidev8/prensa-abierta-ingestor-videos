import fs from 'fs';
import path from 'path';

export interface CategoryVideoInfo {
  category: string;
  matchedFolder: string;
  fileName: string;
  filePath: string;
  streamUrl: string;
}

export interface MediaFile {
  fileName: string;
  filePath: string;
  streamUrl: string;
  size: number;
  extension: string;
}

export interface CategoryFolder {
  name: string;
  videoCount: number;
  videos: MediaFile[];
  images: MediaFile[];
}

// Resuelve la ruta absoluta al directorio assets/contenido
export function getAssetsContenidoDir(): string {
  const possiblePaths = [
    path.resolve(process.cwd(), 'assets', 'contenido'),
    path.resolve(process.cwd(), '..', '..', 'assets', 'contenido'),
    path.resolve(process.cwd(), '..', 'assets', 'contenido'),
    path.resolve(process.cwd(), 'public', 'assets', 'contenido'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Fallback por defecto
  return path.resolve(process.cwd(), '../../assets/contenido');
}

// Resuelve la ruta absoluta a assets/uploads (archivos importados por el usuario
// desde el "Editor de video" — ver /api/media/upload). Es hermana de
// assets/contenido, en el mismo volumen `./assets` que comparten los contenedores
// `web` y `engine` (docker-compose.yml), así que sobreviven a que se recreen los
// contenedores y el Engine podría leerlos directo del disco si hiciera falta.
//
// A propósito NO se sirven desde `public/`: en el build "standalone" de Next.js
// (usado en el Dockerfile) el servidor resuelve el set de archivos estáticos de
// `public/` una sola vez al arrancar, así que un archivo escrito ahí en runtime
// (después de que el proceso ya inició) nunca se vuelve servible — 404 permanente
// hasta reconstruir la imagen. Por eso se sirven vía un route handler dinámico
// (`/api/media/uploads/[filename]`), que sí lee el disco en cada request.
export function getAssetsUploadsDir(): string {
  return path.join(path.dirname(getAssetsContenidoDir()), 'uploads');
}

// Normaliza texto eliminando acentos y caracteres especiales para comparaciones
export function normalizeCategoryString(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// Ruteo canónico categoría-de-noticia → carpeta de b-roll en `assets/contenido`.
//
// Existen varias taxonomías de categoría en el proyecto que NO coinciden entre sí
// ni con las carpetas: la cruda del feed ("General", "Nacional", "Investigación &
// Política"), la del reescritor autónomo (`rewriter.ts`: "Política", "Tribunales",
// "El Tiempo", "Noticias"…), la libre de la IA (`ollama.ts`) y la de
// `inferNewsCategory` ("Farándula", "Salud", "Educación"…). Este mapa lleva
// CUALQUIERA de ellas a una de las 8 carpetas reales.
//
// El orden importa: se evalúa de la más específica/inequívoca a la más genérica y
// gana la PRIMERA carpeta con algún keyword presente en la categoría (+ tags).
// Decisiones de producto (2026-09-01, confirmadas por el usuario):
//   - Sin carpeta propia: Farándula / El Tiempo / Salud / Educación / Cultura → `Local`.
//   - Tribunales / Justicia / Fiscalía → `Sucesos` (misma familia).
//   - Cualquier cosa que no matchee nada (incl. "Nacional" / "General" / "Otras") → `Ahora`.
const FOLDER_ROUTING: { folder: string; keywords: string[] }[] = [
  {
    folder: 'Deportes',
    keywords: [
      'deporte', 'deportiv', 'baloncesto', 'basket', 'bsn', 'balompie', 'futbol', 'soccer',
      'beisbol', 'pelota', 'mlb', 'nba', 'nfl', 'wnba', 'nhl', 'voleibol', 'volibol', 'tenis',
      'golf', 'boxeo', 'boxead', 'mma', 'ufc', 'atletismo', 'atleta', 'maraton', 'olimpic',
      'olimpiad', 'panamerican', 'centroamerican', 'campeonato', 'campeon', 'torneo',
      'seleccion nacional', 'equipo nacional', 'medalla', 'entrenador', 'playoff',
      'serie del caribe', 'serie mundial', 'copa mundial', 'mundial de', 'clasico mundial',
      'grandes ligas', 'doble a',
    ],
  },
  {
    folder: 'Sucesos',
    keywords: [
      'suceso', 'tribunal', 'justicia', 'fiscal', 'policia', 'policiac', 'crimen', 'criminal',
      'delito', 'arrest', 'detenid', 'asesinato', 'asesinad', 'homicidio', 'feminicidio',
      'masacre', 'tiroteo', 'balacera', 'balead', 'a tiros', 'a balazos', 'disparos',
      'apunalad', 'acuchillad', 'accidente', 'choque', 'atropell', 'incendio', 'bomberos',
      'robo', 'hurto', 'asalt', 'atraco', 'escalamiento', 'droga', 'narcotrafic', 'trasiego',
      'allanamiento', 'redada', 'carcel', 'confinado', 'convicto', 'sentenciad', 'condenad',
      'culpable', 'juicio', 'imputad', 'acusad', 'querella', 'desaparecid', 'secuestro',
      'violacion', 'agresion', 'maltrato', 'violencia domestica', 'violencia de genero',
      'emergencia', 'rescate', 'derrumbe', 'explosion', 'corte federal', 'corte de distrito',
      'gran jurado',
    ],
  },
  {
    folder: 'Economía',
    keywords: [
      'economia', 'economic', 'finanzas', 'financier', 'negocio', 'comercio', 'comercial',
      'empresa', 'empresari', 'mercado', 'bolsa de valores', 'wall street', 'nasdaq', 'banco',
      'banca', 'bancari', 'cooperativa', 'prestamo', 'hipoteca', 'inflacion', 'recesion',
      'costo de vida', 'canasta basica', 'deuda publica', 'bonos', 'presupuesto', 'hacienda',
      'ivu', 'iva', 'impuesto', 'contribucion', 'contribuyente', 'planilla', 'arancel',
      'tarifa', 'empleo', 'desemple', 'salario', 'nomina', 'despido', 'jubilacion', 'pension',
      'retiro', 'turismo', 'turista', 'hotel', 'crucero', 'inversion', 'inversionista', 'pyme',
      'comerciante', 'criptomoneda', 'bitcoin', 'combustible', 'gasolina', 'importacion',
      'exportacion',
    ],
  },
  {
    folder: 'Estados Unidos',
    keywords: [
      'estados unidos', 'ee. uu', 'ee.uu', 'eeuu', 'washington', 'casa blanca', 'white house',
      'capitolio federal', 'congreso de estados unidos', 'congreso federal', 'senado federal',
      'camara federal', 'corte suprema federal', 'supremo federal', 'gobierno federal',
      'administracion federal', 'reserva federal', 'donald trump', 'trump', 'joe biden',
      'kamala harris', 'departamento de estado', 'homeland security', 'servicio de inmigracion',
      'deportacion', 'frontera sur', 'nueva york', 'la florida', 'texas', 'california',
      'chicago', 'los angeles', 'republicanos', 'democratas',
    ],
  },
  {
    folder: 'Internacional',
    keywords: [
      'internacional', 'del mundo', 'a nivel mundial', 'extranjero', 'naciones unidas',
      'union europea', 'europa', 'america latina', 'latinoamerica', 'republica dominicana',
      'venezuela', 'cuba', 'haiti', 'mexico', 'colombia', 'brasil', 'argentina', 'espana',
      'china', 'rusia', 'ucrania', 'israel', 'palestina', 'gaza', 'medio oriente', 'guerra en',
      'conflicto en', 'cumbre de', 'vaticano', 'union africana', 'corte penal internacional',
      'la haya',
    ],
  },
  {
    folder: 'Gobierno',
    keywords: [
      'gobierno', 'gobernador', 'gobernadora', 'fortaleza', 'legislatura', 'legislador',
      'senado', 'senador', 'camara de representantes', 'representante', 'proyecto de ley',
      'resolucion', 'reforma', 'politic', 'partido', 'pnp', 'ppd', 'pip', 'mvc',
      'proyecto dignidad', 'primarias', 'elecciones', 'eleccion', 'electoral', 'plebiscito',
      'referendum', 'estatus', 'estadidad', 'independencia', 'junta de control', 'promesa',
      'alcalde', 'alcaldesa', 'alcaldia', 'municipio', 'municipal', 'asamblea municipal',
      'aee', 'prepa', 'aaa', 'acueductos', 'departamento de', 'negociado de', 'contralor',
      'etica gubernamental', 'corrupcion', 'fondos federales', 'fema', 'agencia publica',
    ],
  },
  {
    // Antes que "Local": hay carpeta propia de Música con b-roll (Bad Bunny,
    // clásica, concierto). Farándula/artistas/conciertos van aquí.
    folder: 'Musica',
    keywords: [
      'musica', 'musical', 'cancion', 'album', 'disco', 'sencillo', 'gira', 'concierto',
      'festival de musica', 'cantante', 'cantautor', 'interprete', 'banda de', 'orquesta',
      'reggaeton', 'regueton', 'trap latino', 'salsa', 'merengue', 'bomba y plena',
      'bad bunny', 'benito', 'rauw alejandro', 'daddy yankee', 'residente', 'bad-bunny',
      'grammy', 'billboard', 'premios lo nuestro', 'spotify', 'estreno musical',
      'musica clasica', 'sinfonica', 'farandul', 'artista urbano',
    ],
  },
  {
    // Antes que "Local": hay carpeta propia de Salud (medicina, enfermedades,
    // laboratorios, procedimientos, acupuntura).
    folder: 'Salud',
    keywords: [
      'salud', 'medico', 'medica', 'medicina', 'medicamento', 'farmac', 'hospital', 'clinica',
      'dispensario', 'sala de emergencia', 'paciente', 'enfermedad', 'enfermo', 'epidemia',
      'pandemia', 'brote', 'contagio', 'dengue', 'influenza', 'covid', 'virus', 'bacteria',
      'vacuna', 'inmuniz', 'cirugia', 'operaron', 'procedimiento medico', 'diagnostico',
      'tratamiento', 'terapia', 'acupuntura', 'laboratorio clinico', 'departamento de salud',
      'salud publica', 'plan medico', 'aseguradora de salud', 'cancer', 'diabetes', 'obesidad',
      'salud mental',
    ],
  },
  {
    folder: 'Local',
    keywords: [
      'local', 'comunidad', 'vecinos', 'vecindario', 'barrio', 'barriada', 'municipio de',
      'pueblo de', 'casco urbano', 'fiestas patronales', 'festival', 'carnaval', 'tradicion',
      'patrimonio', 'cultura', 'cultural', 'pelicula', 'cine', 'television', 'novela', 'premio',
      'celebridad', 'influencer', 'la gobernadora', 'jenniffer gonzalez', 'la fortaleza',
      'el tiempo', 'clima', 'pronostico del tiempo', 'lluvia', 'tormenta', 'huracan',
      'ola de calor', 'meteorolog', 'educacion', 'escuela', 'universidad', 'upr', 'estudiante',
      'maestro', 'matricula', 'san juan', 'bayamon', 'carolina', 'ponce', 'caguas', 'guaynabo',
      'mayaguez', 'arecibo', 'aguadilla', 'fajardo', 'humacao', 'trafico', 'peaje', 'tren urbano',
      'medio ambiente', 'reciclaje', 'playa',
    ],
  },
];

// Carpeta usada cuando ninguna regla de FOLDER_ROUTING matchea.
const FALLBACK_FOLDER = 'Ahora';

/**
 * Mapea una categoría de noticia (venga de la taxonomía que venga) + tags opcionales
 * + el titular opcional a UNA de las carpetas canónicas de `assets/contenido`. Nunca
 * devuelve vacío: si nada matchea, devuelve `FALLBACK_FOLDER`.
 *
 * El titular (`query`) participa en el paso 2 (keywords), NO en el paso 1 (nombre
 * exacto de carpeta): si la categoría ya es una carpeta canónica ("Deportes"), esa
 * categorización explícita manda y el titular no la puede overridear. Pero muchas
 * categorías crudas del feed son genéricas ("General", "Nacional", "Investigación &
 * Política"…) y no matchean ninguna carpeta ni keyword de categoría — antes, esas
 * caían siempre a `Ahora` sin mirar el titular, aunque dijera claramente "concierto
 * de Bad Bunny" o "el tribunal sentenció a…". Incluir el titular en el paso 2 deja
 * que esas noticias genéricas igual encuentren la carpeta correcta por contenido.
 */
export function resolveCategoryFolderName(categoryName?: string, tags?: string[], query?: string): string {
  const norm = normalizeCategoryString(categoryName || '');
  const haystack = [
    norm,
    ...(tags || []).map((t) => normalizeCategoryString(t)),
    normalizeCategoryString(query || ''),
  ]
    .filter(Boolean)
    .join(' ');

  // 1. Coincidencia directa con el nombre de una carpeta canónica (solo la categoría,
  //    nunca el titular: una categorización explícita no debe ser overrideada por
  //    una palabra suelta del titular).
  for (const { folder } of FOLDER_ROUTING) {
    if (norm === normalizeCategoryString(folder)) return folder;
  }
  if (norm === normalizeCategoryString(FALLBACK_FOLDER)) return FALLBACK_FOLDER;

  // 2. Coincidencia por keyword (categoría + tags + titular), en orden de prioridad.
  for (const { folder, keywords } of FOLDER_ROUTING) {
    if (keywords.some((kw) => haystack.includes(kw))) return folder;
  }

  // 3. Sin match → carpeta por defecto.
  return FALLBACK_FOLDER;
}

const VALID_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.mkv', '.avi'];
const VALID_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

/**
 * Obtiene todas las categorías disponibles y sus medios (videos e imágenes) en
 * assets/contenido.
 */
export function getAllCategoryFolders(): CategoryFolder[] {
  const contenidoDir = getAssetsContenidoDir();
  if (!fs.existsSync(contenidoDir)) {
    return [];
  }

  const entries = fs.readdirSync(contenidoDir, { withFileTypes: true });
  const folders: CategoryFolder[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const folderPath = path.join(contenidoDir, entry.name);
    const files = fs.readdirSync(folderPath);

    const toMediaFile = (file: string): MediaFile => {
      const filePath = path.join(folderPath, file);
      const stat = fs.statSync(filePath);
      return {
        fileName: file,
        filePath,
        streamUrl: `/api/media/category-video?category=${encodeURIComponent(
          entry.name
        )}&file=${encodeURIComponent(file)}`,
        size: stat.size,
        extension: path.extname(file).toLowerCase(),
      };
    };

    const videoFiles = files
      .filter((f) => VALID_VIDEO_EXTENSIONS.includes(path.extname(f).toLowerCase()))
      .map(toMediaFile);
    const imageFiles = files
      .filter((f) => VALID_IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase()))
      .map(toMediaFile);

    folders.push({
      name: entry.name,
      videoCount: videoFiles.length,
      videos: videoFiles,
      images: imageFiles,
    });
  }

  return folders;
}

// Hash simple y estable (no criptográfico) para elegir un índice determinístico
// a partir de un string. Se usa para que, dado el mismo `seed` (ej. el id de la
// noticia), siempre se elija el mismo clip de una carpeta con varios videos —
// evita que el preview (que llama a esta función) y la descarga (que la vuelve
// a llamar por separado) terminen mostrando dos clips distintos por puro azar.
function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMAS (sub-categoría) dentro de una carpeta.
//
// Los archivos de una carpeta pueden llevar un tema en el nombre, después del
// nombre de la carpeta: `Deportes-futbol.mp4`, `Sucesos-juicio.jpg`,
// `Internacional-reunion.jpg`, `Deportes-baseball-complemento.jpg`, `crimen.jpg`…
// Un archivo sin tema (`Deportes 2.mp4`, `Sucesos 3.mp4`) es genérico.
//
// Con estos temas, la composición del video busca ser coherente:
//   - Hay IMAGEN temática + VIDEO temático → composición = imagen (con zoom) + video.
//   - Hay IMAGEN temática pero NO video temático → el video se busca en Pexels
//     (`pexelsQuery`) para que la pareja imagen+video tenga sentido; si Pexels no
//     devuelve nada, se anima solo la imagen con zoom durante los ~10s.
//   - Hay VIDEO temático y NO imagen → solo el video.
//   - Ningún tema detectado → video genérico de la carpeta (comportamiento previo).
//
// `fileTokens` son las etiquetas de nombre de archivo que cuentan como este tema
// (por defecto `[token]`); sirve para GRUPOS: `contacto` cubre boxeo/mma/karate,
// `juicio` cubre juicio/justicia/tribunales, `ciclismo` cubre ciclismo/biker, etc.
interface TopicDef {
  token: string;
  fileTokens?: string[];
  keywords: string[];
  pexels: string;
}

const FOLDER_TOPICS: Record<string, TopicDef[]> = {
  Deportes: [
    {
      token: 'futbol',
      keywords: [
        'futbol', 'football', 'soccer', 'balompie', 'la liga', 'laliga', 'premier league',
        'champions league', 'liga de campeones', 'europa league', 'uefa', 'fifa', ' mls',
        'liga mx', 'bundesliga', 'ligue 1', 'copa mundial de futbol', 'mundial de futbol',
        'copa oro', 'concacaf', 'conmebol', 'copa libertadores', 'copa america', 'eurocopa',
        'real madrid', 'barcelona', ' barca', 'fc barcelona', 'atletico de madrid', 'atletico',
        'sevilla fc', 'manchester united', 'manchester city', 'liverpool fc', 'chelsea fc',
        'bayern munich', 'juventus', 'inter de milan', 'ac milan', 'paris saint', ' psg',
        'boca juniors', 'river plate', 'club america', 'lionel messi', 'cristiano ronaldo',
        'kylian mbappe', 'vinicius', 'neymar', 'seleccion de futbol', 'goleador', 'golazo',
        'goleada', 'gol de', 'autogol', 'tiro penal', 'tiro libre', 'delantero', 'mediocampista',
        'guardameta', 'arquero',
      ],
      pexels: 'soccer football match stadium',
    },
    {
      token: 'basket',
      keywords: [
        'baloncesto', 'basketball', 'basquetbol', 'basquet', 'canasto', 'canasta de tres', 'bsn',
        ' nba', ' wnba', ' fiba', 'euroliga', 'eurobasket', 'ncaa', 'march madness',
        'triple decisivo', 'doble-doble', 'triple-doble', 'seleccion de baloncesto',
      ],
      pexels: 'basketball game court arena',
    },
    {
      token: 'baseball',
      fileTokens: ['baseball', 'beisbol'],
      keywords: [
        'beisbol', 'pelota', ' mlb', 'grandes ligas', 'doble a', 'softbol', 'sofbol', 'jonron',
        'cuadrangular', 'toletero', 'lanzador', 'bateador', 'serie del caribe', 'liga de beisbol',
        'clasico mundial de beisbol', 'cangrejeros', 'criollos de caguas', 'indios de mayaguez',
      ],
      pexels: 'baseball game stadium bat',
    },
    {
      token: 'atletismo',
      keywords: [
        'atletismo', 'atleta ', 'pista y campo', 'maraton', 'corredor', 'velocista', 'sprint',
        'relevo', 'salto largo', 'salto alto', 'garrocha', 'jabalina', 'lanzamiento de bala',
        'decatlon', 'heptatlon', 'olimpiad', 'olimpic', 'juegos olimpicos', 'gimnasia', 'gimnast',
      ],
      pexels: 'track and field athletics running race',
    },
    {
      token: 'contacto',
      fileTokens: ['contacto', 'boxeo'],
      keywords: [
        'boxeo', 'boxead', 'pugil', ' mma', ' ufc', 'artes marciales', 'karate', 'taekwondo',
        'judo', 'lucha olimpica', 'lucha libre', 'jiu jitsu', 'jiujitsu', 'kickboxing',
        'muay thai', 'esgrima',
      ],
      pexels: 'boxing ring training fight',
    },
    {
      token: 'ciclismo',
      fileTokens: ['ciclismo', 'biker'],
      keywords: [
        'ciclismo', 'ciclista', 'biker', 'bicicleta', 'vuelta a', 'tour de francia',
        'giro de italia', 'contrarreloj', 'peloton', 'etapa de montana',
      ],
      pexels: 'cycling race road bike',
    },
    { token: 'tenis', keywords: ['tenis', 'wimbledon', 'us open', 'roland garros', 'abierto de australia'], pexels: 'tennis match court' },
    { token: 'voleibol', keywords: ['voleibol', 'volibol', 'volleyball'], pexels: 'volleyball game indoor' },
    { token: 'golf', keywords: ['golf', ' pga', ' lpga'], pexels: 'golf course swing green' },
    { token: 'natacion', keywords: ['natacion', 'nadador', 'clavados'], pexels: 'swimming pool competition' },
    { token: 'hipismo', keywords: ['hipismo', 'hipico', 'caballo de carrera'], pexels: 'horse racing track' },
  ],
  Sucesos: [
    {
      token: 'juicio',
      fileTokens: ['juicio', 'justicia', 'tribunales', 'tribunal'],
      keywords: [
        'juicio', 'tribunal', 'corte ', 'vista judicial', 'sentencia', 'sentenciad', 'condenad',
        'absuelto', 'absolucion', 'fiscal', 'fiscalia', 'jurado', 'gran jurado', 'magistrad',
        ' juez', 'jueza', 'apelacion', 'culpable', 'imputad', 'acusad', 'veredicto', 'litigio',
        'demanda', 'declaracion de culpabilidad', 'alegacion preacordada',
      ],
      pexels: 'courtroom trial judge gavel justice',
    },
    {
      token: 'accidentes',
      fileTokens: ['accidentes', 'accidente'],
      keywords: [
        'accidente', 'choque', 'colision', 'atropell', 'volcadura', 'carambola', 'estrellarse',
        'siniestro vial', 'accidente de transito', 'vuelco', 'guagua se accidento',
      ],
      pexels: 'car accident road crash emergency',
    },
    {
      token: 'crimen',
      keywords: [
        'crimen', 'asesinato', 'asesinad', 'homicidio', 'feminicidio', 'masacre', 'tiroteo',
        'balacera', 'baleado', 'baleada', 'apunalad', 'a tiros', 'a balazos', 'robo', 'hurto',
        'asalto', 'atraco', 'escalamiento', 'narcotrafic', 'trasiego', 'secuestro', 'droga',
      ],
      pexels: 'crime scene police tape night city',
    },
    {
      token: 'policia',
      fileTokens: ['policia'],
      keywords: [
        'policia', 'uniformado', 'patrulla', 'arresto', 'arrestad', 'detenid', 'allanamiento',
        'operativo', 'agente del negociado', 'comandancia', 'fuerza de choque', 'guardia nacional',
        'redada',
      ],
      pexels: 'police officers patrol car lights',
    },
  ],
  Internacional: [
    {
      token: 'organizacion',
      keywords: [
        'onu', 'naciones unidas', ' oea', ' otan', 'union europea', 'unesco', ' fmi',
        'banco mundial', ' oms', 'organismo internacional', 'consejo de seguridad',
        'asamblea general', 'corte penal internacional', 'la haya', 'union africana',
      ],
      pexels: 'united nations flags international organization',
    },
    {
      token: 'reunion',
      keywords: [
        'cumbre', 'reunion', 'encuentro', 'bilateral', 'delegacion', 'canciller', 'diplomatic',
        'negociacion', 'acuerdo', 'tratado', 'mesa de dialogo', ' foro', 'visita de estado',
        'gira internacional',
      ],
      pexels: 'diplomatic meeting summit conference table handshake',
    },
  ],
  'Economía': [
    {
      token: 'cryptos',
      fileTokens: ['cryptos', 'cripto', 'crypto'],
      keywords: [
        'cripto', 'criptomoneda', 'bitcoin', 'ethereum', 'blockchain', ' token', 'wallet',
        'exchange de', 'stablecoin', ' defi', 'minado de cripto', 'satoshi', 'web3',
      ],
      pexels: 'cryptocurrency bitcoin trading chart screen',
    },
  ],
  Musica: [
    {
      token: 'bad-bunny',
      fileTokens: ['bad', 'bunny', 'bad-bunny'],
      keywords: [
        'bad bunny', 'benito', 'conejo malo', 'reggaeton', 'regueton', 'trap latino',
        'artista urbano', 'musica urbana', 'rauw alejandro', 'daddy yankee', 'residente',
        'young miko', 'feid', 'perreo',
      ],
      pexels: 'reggaeton urban concert stage crowd',
    },
    {
      token: 'clasica',
      keywords: [
        'musica clasica', 'sinfonica', 'orquesta', 'filarmonica', 'concierto sinfonico',
        'director de orquesta', 'violin', 'piano de concierto', 'opera', 'conservatorio',
      ],
      pexels: 'classical orchestra symphony concert hall',
    },
    {
      token: 'concierto',
      keywords: [
        'concierto', 'gira', 'tour musical', 'show en vivo', 'presentacion musical', 'tarima',
        'festival de musica', 'coliseo', 'choliseo', 'entradas para el concierto',
      ],
      pexels: 'live music concert stage lights crowd',
    },
  ],
  Salud: [
    {
      token: 'medicina',
      fileTokens: ['medicina', 'medicinas'],
      keywords: [
        'medicamento', 'medicina', 'farmac', 'pastilla', 'receta medica', 'antibiotico',
        'tratamiento con', 'dosis', 'suministro de medicamentos', 'escasez de medicamentos',
      ],
      pexels: 'pharmacy medicine pills prescription',
    },
    {
      token: 'enfermedad',
      fileTokens: ['enfermedad', 'enfermedades'],
      keywords: [
        'enfermedad', 'enfermo', 'epidemia', 'pandemia', 'brote', 'contagio', 'dengue',
        'influenza', 'covid', 'virus', 'bacteria', 'cancer', 'diabetes', 'condicion cronica',
      ],
      pexels: 'hospital patient illness medical care',
    },
    {
      token: 'laboratorios',
      fileTokens: ['laboratorios', 'laboratorio'],
      keywords: [
        'laboratorio', 'analisis de sangre', 'prueba de laboratorio', 'muestra', 'reactivo',
        'resultado de la prueba', 'estudio clinico', 'investigacion medica',
      ],
      pexels: 'medical laboratory research microscope',
    },
    {
      token: 'procedimientos',
      fileTokens: ['procedimientos', 'procedimiento'],
      keywords: [
        'cirugia', 'operacion', 'operaron', 'procedimiento medico', 'quirofano', 'trasplante',
        'intervencion quirurgica', 'anestesia', 'sala de operaciones',
      ],
      pexels: 'surgery operating room medical procedure',
    },
    {
      token: 'acupuntura',
      keywords: [
        'acupuntura', 'medicina alternativa', 'medicina natural', 'terapia holistica',
        'quiropractico', 'bienestar', 'medicina tradicional china',
      ],
      pexels: 'acupuncture alternative medicine therapy',
    },
  ],
  Local: [
    {
      token: 'gobernadora',
      fileTokens: ['gobernadora', 'gobernador'],
      keywords: [
        'la gobernadora', 'el gobernador', 'jenniffer gonzalez', 'la fortaleza', 'primera mandataria',
        'orden ejecutiva', 'mensaje de presupuesto', 'la mansion ejecutiva',
      ],
      pexels: 'government official press conference podium',
    },
  ],
};

// Etiquetas de tema que trae un nombre de archivo, quitando el prefijo de la carpeta.
// `Sucesos-juicio.jpg` (carpeta "Sucesos") → ['juicio']; `crimen.jpg` → ['crimen'];
// `Deportes 2.mp4` → []; `Deportes-baseball-complemento.jpg` → ['baseball', 'complemento'].
function tokensFromFilename(folderName: string, fileName: string): string[] {
  const base = fileName.replace(/\.[^.]+$/, '');
  const folderNorm = normalizeCategoryString(folderName);
  let rest = normalizeCategoryString(base);
  if (folderNorm && rest.startsWith(folderNorm)) {
    rest = rest.slice(folderNorm.length);
  }
  const NOISE = new Set(['complemento', 'video', 'clip', 'foto', 'imagen', 'final', 'nuevo', 'nueva']);
  return rest
    .split(/[-\s_]+/)
    .map((t) => t.trim())
    .filter((t) => t && !/^\d+$/.test(t) && !NOISE.has(t));
}

// Detecta el tema (TopicDef) mencionado en `text` para la carpeta dada, o null.
function detectTopic(folderName: string, text: string): TopicDef | null {
  const topics =
    FOLDER_TOPICS[folderName] ||
    FOLDER_TOPICS[Object.keys(FOLDER_TOPICS).find((k) => normalizeCategoryString(k) === normalizeCategoryString(folderName)) || ''];
  if (!topics) return null;
  const padded = ` ${normalizeCategoryString(text)} `;
  for (const topic of topics) {
    if (topic.keywords.some((kw) => padded.includes(kw))) return topic;
  }
  return null;
}

function fileMatchesTopic(folderName: string, fileName: string, topic: TopicDef): boolean {
  const want = (topic.fileTokens || [topic.token]).map((t) => normalizeCategoryString(t));
  const have = tokensFromFilename(folderName, fileName);
  return have.some((t) => want.includes(t));
}

function pickSeeded<T>(arr: T[], seed?: string): T | undefined {
  if (arr.length === 0) return undefined;
  const i = seed ? stableHash(seed) % arr.length : Math.floor(Math.random() * arr.length);
  return arr[i];
}

export interface CompositionResolution {
  matchedFolder: string;
  matchedTopic?: string;
  // Paso 2 — IMAGEN líder (primer segmento, con zoom): archivo del banco.
  leadImage: CategoryVideoInfo | null;
  // Si no hay imagen en el banco: el caller debe buscar una FOTO en Pexels con
  // este query (paso 2: "si no, se buscará una de pexel para usar").
  imagePexelsQuery?: string;
  // Paso 3 — VIDEO (segundo segmento): archivo de la MISMA carpeta.
  video: CategoryVideoInfo | null;
  // Si la carpeta no tiene ningún video (raro): buscar un clip en Pexels.
  videoPexelsQuery?: string;
}

/**
 * Resuelve la composición de b-roll para una noticia, siguiendo la ruta:
 *   1. categoría de la noticia (+ `query`/titular, si la categoría no matchea
 *      ninguna carpeta/keyword por sí sola) → carpeta en `assets/contenido`.
 *   2. imagen referente en esa carpeta (tema, detectado por `query`) → si no hay,
 *      `imagePexelsQuery`.
 *   3. video de la MISMA carpeta acorde con la noticia (tema → genérico de la carpeta).
 * `query` (titular) determina tanto la carpeta (paso 1, como red de seguridad) como
 * el tema dentro de ella (pasos 2-3). Con `seed` (id de la noticia) la elección
 * dentro de la carpeta es determinística (preview == descarga).
 */
export function resolveComposition(
  categoryName?: string,
  tags?: string[],
  seed?: string,
  query?: string
): CompositionResolution {
  const empty: CompositionResolution = { matchedFolder: '', leadImage: null, video: null };
  const folders = getAllCategoryFolders();
  if (folders.length === 0) return empty;

  const hasAssets = (f: CategoryFolder) => f.videos.length > 0 || f.images.length > 0;
  const byName = (name: string) =>
    folders.find((f) => normalizeCategoryString(f.name) === normalizeCategoryString(name));

  // Paso 1: categoría (+ titular, si la categoría es genérica) → carpeta.
  const targetName = resolveCategoryFolderName(categoryName, tags, query);
  const folder =
    (byName(targetName) && hasAssets(byName(targetName)!) ? byName(targetName) : undefined) ||
    (byName(FALLBACK_FOLDER) && hasAssets(byName(FALLBACK_FOLDER)!) ? byName(FALLBACK_FOLDER) : undefined) ||
    folders.find(hasAssets);

  if (!folder) return empty;

  const toInfo = (f: MediaFile): CategoryVideoInfo => ({
    category: categoryName || folder.name,
    matchedFolder: folder.name,
    fileName: f.fileName,
    filePath: f.filePath,
    streamUrl: f.streamUrl,
  });

  const haystack = [query || '', categoryName || '', ...(tags || [])].join(' ');
  const topic = detectTopic(folder.name, haystack);
  const pexelsHint = topic ? topic.pexels : normalizeCategoryString(categoryName || folder.name);

  // Paso 2: IMAGEN referente en la carpeta.
  //   - Con tema: solo imágenes de ESE tema (no de otro).
  //   - Sin tema: cualquier imagen de la carpeta sirve como referente de la categoría.
  const imgFile = topic
    ? pickSeeded(folder.images.filter((f) => fileMatchesTopic(folder.name, f.fileName, topic)), seed)
    : pickSeeded(folder.images, seed);

  // Paso 3: VIDEO acorde en la MISMA carpeta.
  //   - Con tema: video de ese tema → si no hay, un genérico de la carpeta.
  //   - Sin tema: un genérico de la carpeta.
  let vidFile = topic
    ? pickSeeded(folder.videos.filter((f) => fileMatchesTopic(folder.name, f.fileName, topic)), seed)
    : undefined;
  if (!vidFile) {
    const generic = folder.videos.filter((f) => tokensFromFilename(folder.name, f.fileName).length === 0);
    vidFile = pickSeeded(generic.length ? generic : folder.videos, seed);
  }

  return {
    matchedFolder: folder.name,
    matchedTopic: topic?.token,
    leadImage: imgFile ? toInfo(imgFile) : null,
    // Pexels para la imagen SOLO si hay un tema identificado sin imagen propia
    // (sin tema no hay "imagen referente" que buscar → el caller usa la destacada).
    imagePexelsQuery: !imgFile && topic ? pexelsHint : undefined,
    video: vidFile ? toInfo(vidFile) : null,
    videoPexelsQuery: vidFile ? undefined : pexelsHint,
  };
}

export interface CategoryClipResolution {
  video: CategoryVideoInfo | null;
  // true = hay un tema/imagen específicos pero no un video local → el caller
  // (preview) debería caer a su imagen en vez de un clip genérico.
  preferImageFallback: boolean;
}

/**
 * Compat para el preview / `media/category-video`: devuelve solo el clip de video
 * (o null). Deriva de `resolveComposition`.
 */
export function resolveCategoryClip(
  categoryName?: string,
  tags?: string[],
  seed?: string,
  query?: string
): CategoryClipResolution {
  const c = resolveComposition(categoryName, tags, seed, query);
  if (c.video) return { video: c.video, preferImageFallback: false };
  return {
    video: null,
    preferImageFallback: !!(c.leadImage || c.matchedTopic || c.imagePexelsQuery || c.videoPexelsQuery),
  };
}

/**
 * Compat: devuelve solo el clip de video (o null).
 */
export function resolveCategoryVideo(
  categoryName?: string,
  tags?: string[],
  seed?: string,
  query?: string
): CategoryVideoInfo | null {
  return resolveCategoryClip(categoryName, tags, seed, query).video;
}
