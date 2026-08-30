import fs from 'fs';
import path from 'path';

export interface CategoryVideoInfo {
  category: string;
  matchedFolder: string;
  fileName: string;
  filePath: string;
  streamUrl: string;
}

export interface CategoryFolder {
  name: string;
  videoCount: number;
  videos: {
    fileName: string;
    filePath: string;
    streamUrl: string;
    size: number;
    extension: string;
  }[];
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

// Normaliza texto eliminando acentos y caracteres especiales para comparaciones
export function normalizeCategoryString(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// Diccionario de sinónimos y palabras clave para mapeo a las carpetas en assets/contenido
const CATEGORY_SYNONYMS: Record<string, string[]> = {
  Deportes: [
    'deporte',
    'deportes',
    'baloncesto',
    'beisbol',
    'bsn',
    'voleibol',
    'pelota',
    'futbol',
    'soccer',
    'olimpico',
    'boxeo',
    'atletismo',
    'mlb',
    'nba',
    'maraton',
    'atleta',
  ],
  Economía: [
    'economia',
    'finanzas',
    'negocios',
    'comercio',
    'hacienda',
    'dinero',
    'banco',
    'inflacion',
    'aranceles',
    'bolsa',
    'mercado',
    'turismo',
    'cripto',
    'banca',
    'presupuesto',
    'desempleo',
  ],
  Gobierno: [
    'gobierno',
    'politica',
    'senado',
    'camara',
    'fortaleza',
    'gobernador',
    'gobernadora',
    'alcalde',
    'alcaldia',
    'legislatura',
    'elecciones',
    'partido',
    'pnp',
    'ppd',
    'pip',
    'mvc',
    'congreso',
    'junta de control',
    'fema',
    'municipio',
  ],
  Sucesos: [
    'sucesos',
    'policia',
    'crimen',
    'seguridad',
    'tribunales',
    'justicia',
    'fiscalia',
    'arresto',
    'asesinato',
    'homicidio',
    'tiroteo',
    'accidente',
    'fuego',
    'bomberos',
    'robo',
    'drogas',
    'emergencia',
    'carreteras',
    'patrullaje',
  ],
  Ahora: [
    'ahora',
    'noticias',
    'general',
    'actualidad',
    'urgente',
    'ultima hora',
    'puerto rico',
    'san juan',
    'isla',
    'comunidad',
    'tiempo',
    'clima',
    'farandula',
    'cultura',
  ],
};

const VALID_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.mkv', '.avi'];

/**
 * Obtiene todas las categorías disponibles y sus videos en assets/contenido
 */
export function getAllCategoryFolders(): CategoryFolder[] {
  const contenidoDir = getAssetsContenidoDir();
  if (!fs.existsSync(contenidoDir)) {
    return [];
  }

  const entries = fs.readdirSync(contenidoDir, { withFileTypes: true });
  const folders: CategoryFolder[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const folderPath = path.join(contenidoDir, entry.name);
      const files = fs.readdirSync(folderPath);
      const videoFiles = files
        .filter((file) => {
          const ext = path.extname(file).toLowerCase();
          return VALID_VIDEO_EXTENSIONS.includes(ext);
        })
        .map((file) => {
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
        });

      folders.push({
        name: entry.name,
        videoCount: videoFiles.length,
        videos: videoFiles,
      });
    }
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

/**
 * Resuelve el mejor video de categoría para una noticia dada su categoría o tags.
 * Si se provee `seed` (ej. el id de la noticia), la selección dentro de la carpeta
 * es determinística en vez de aleatoria, para que distintas llamadas (preview,
 * descarga) con el mismo seed obtengan siempre el mismo archivo.
 */
export function resolveCategoryVideo(
  categoryName?: string,
  tags?: string[],
  seed?: string
): CategoryVideoInfo | null {
  const folders = getAllCategoryFolders();
  if (folders.length === 0) return null;

  const normalizedInput = normalizeCategoryString(categoryName || '');
  const normalizedTags = (tags || []).map((t) => normalizeCategoryString(t));
  const allTerms = [normalizedInput, ...normalizedTags].filter(Boolean);

  let targetFolder: CategoryFolder | undefined;

  // 1. Coincidencia directa por nombre de carpeta
  targetFolder = folders.find(
    (f) => normalizeCategoryString(f.name) === normalizedInput
  );

  // 2. Coincidencia por sinónimos de categoría
  if (!targetFolder) {
    for (const [folderKey, synonyms] of Object.entries(CATEGORY_SYNONYMS)) {
      const isMatched = allTerms.some((term) =>
        synonyms.some((syn) => term.includes(syn) || syn.includes(term))
      );

      if (isMatched) {
        targetFolder = folders.find(
          (f) => normalizeCategoryString(f.name) === normalizeCategoryString(folderKey)
        );
        if (targetFolder) break;
      }
    }
  }

  // 3. Fallback a carpeta "Ahora"
  if (!targetFolder) {
    targetFolder = folders.find(
      (f) => normalizeCategoryString(f.name) === 'ahora'
    );
  }

  // 4. Fallback a la primera carpeta con videos
  if (!targetFolder) {
    targetFolder = folders.find((f) => f.videos.length > 0) || folders[0];
  }

  if (!targetFolder || targetFolder.videos.length === 0) {
    return null;
  }

  // Si hay más de un video: con seed, selección determinística (mismo seed = mismo
  // archivo siempre); sin seed, aleatoria (comportamiento histórico) para dar variedad.
  const index = seed
    ? stableHash(seed) % targetFolder.videos.length
    : Math.floor(Math.random() * targetFolder.videos.length);
  const selectedVideo = targetFolder.videos[index];

  return {
    category: categoryName || targetFolder.name,
    matchedFolder: targetFolder.name,
    fileName: selectedVideo.fileName,
    filePath: selectedVideo.filePath,
    streamUrl: selectedVideo.streamUrl,
  };
}
