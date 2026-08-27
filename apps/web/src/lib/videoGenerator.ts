import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';
import { resolveCategoryVideo } from './contentLibrary';

const execFileAsync = promisify(execFile);

// Determinar ruta de FFmpeg
function getFFmpegPath(): string {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  const localEngineBin = path.resolve(process.cwd(), '../../services/engine/bin/ffmpeg.exe');
  if (fs.existsSync(localEngineBin)) {
    return localEngineBin;
  }
  return 'ffmpeg';
}

// Ruta a fuentes de Windows para FFmpeg
const WIN_FONT_BOLD = '/Windows/Fonts/arialbd.ttf';

async function downloadImage(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    protocol
      .get(url, (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          return downloadImage(response.headers.location, destPath).then(resolve).catch(reject);
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      })
      .on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
  });
}

function sanitizeHeadlineForFFmpeg(text: string): string {
  if (!text) return 'NOTICIA DE ULTIMA HORA';
  let clean = text
    .replace(/:/g, ' -')
    .replace(/'/g, '’')
    .replace(/\\/g, '')
    .replace(/"/g, '')
    .replace(/%/g, ' por ciento')
    .replace(/[\r\n]+/g, ' ')
    .trim();

  // Partir en líneas de máximo 28 caracteres
  const words = clean.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  words.forEach((w) => {
    if ((currentLine + ' ' + w).trim().length > 28) {
      if (currentLine) lines.push(currentLine.trim());
      currentLine = w;
    } else {
      currentLine = currentLine ? `${currentLine} ${w}` : w;
    }
  });
  if (currentLine) lines.push(currentLine.trim());

  return lines.slice(0, 4).join('\n');
}

export async function generateBroadcastReelVideo(params: {
  newsId: string;
  headline: string;
  category?: string;
  tags?: string[];
  imageUrl?: string;
  duration?: number;
}): Promise<string> {
  const { newsId, headline, category = 'NOTICIAS', tags, imageUrl, duration = 12 } = params;

  const ffmpegExe = getFFmpegPath();
  const publicDir = path.resolve(process.cwd(), 'public');
  const outputDir = path.join(publicDir, 'generated_videos');
  const tempDir = path.join(publicDir, 'temp_render');

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const safeId = (newsId || `video_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
  const outputFilename = `reel_${safeId}.mp4`;
  const outputPath = path.join(outputDir, outputFilename);
  const publicVideoUrl = `/generated_videos/${outputFilename}`;
  const logoPath = path.join(publicDir, 'logo.png');

  // 1. Resolver el video de fondo de assets/contenido según la categoría
  const matchedCategoryVideo = resolveCategoryVideo(category, tags);
  const cleanHeadline = sanitizeHeadlineForFFmpeg(headline);
  const categoryHeader = `ULTIMA HORA  •  ${(matchedCategoryVideo?.matchedFolder || category || 'NOTICIAS').toUpperCase()}`;

  console.log(`[VideoGenerator] 🎬 Categoría solicitada: "${category}". Video de plantilla emparejado:`, matchedCategoryVideo?.filePath || 'Ninguno');

  // CASO A: Tenemos un video de categoría en assets/contenido
  if (matchedCategoryVideo && fs.existsSync(matchedCategoryVideo.filePath)) {
    try {
      console.log(`[VideoGenerator] Renderizando video con plantilla de categoría "${matchedCategoryVideo.matchedFolder}" (${matchedCategoryVideo.fileName})...`);

      const hasLogo = fs.existsSync(logoPath);
      let filterGraph: string;
      let inputArgs: string[];

      if (hasLogo) {
        filterGraph = [
          `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30[bg]`,
          `[bg]drawbox=y=ih-520:color=black@0.85:width=iw:height=520:t=fill[box1]`,
          `[box1]drawtext=fontfile='${WIN_FONT_BOLD}':text='${categoryHeader}':fontcolor=0xFFAA00:fontsize=36:x=70:y=h-440[box2]`,
          `[box2]drawtext=fontfile='${WIN_FONT_BOLD}':text='${cleanHeadline}':fontcolor=white:fontsize=46:x=70:y=h-370:line_spacing=18[vtext]`,
          `[1:v]scale=180:180[logo_scaled]`,
          `[vtext][logo_scaled]overlay=x=W-w-70:y=70[vfinal]`,
        ].join(';');

        inputArgs = [
          '-y',
          '-stream_loop', '-1',
          '-t', `${duration}`,
          '-i', matchedCategoryVideo.filePath,
          '-i', logoPath,
          '-filter_complex', filterGraph,
          '-map', '[vfinal]',
          '-map', '0:a?', // Preservar audio si existe en el clip
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-crf', '22',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-movflags', '+faststart',
          outputPath,
        ];
      } else {
        filterGraph = [
          `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30`,
          `drawbox=y=ih-520:color=black@0.85:width=iw:height=520:t=fill`,
          `drawtext=fontfile='${WIN_FONT_BOLD}':text='${categoryHeader}':fontcolor=0xFFAA00:fontsize=36:x=70:y=h-440`,
          `drawtext=fontfile='${WIN_FONT_BOLD}':text='${cleanHeadline}':fontcolor=white:fontsize=46:x=70:y=h-370:line_spacing=18`,
        ].join(',');

        inputArgs = [
          '-y',
          '-stream_loop', '-1',
          '-t', `${duration}`,
          '-i', matchedCategoryVideo.filePath,
          '-vf', filterGraph,
          '-map', '0:a?',
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-crf', '22',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-movflags', '+faststart',
          outputPath,
        ];
      }

      await execFileAsync(ffmpegExe, inputArgs);
      console.log(`[VideoGenerator ✅] Video con plantilla de categoría generado exitosamente: ${outputPath}`);
      return publicVideoUrl;
    } catch (err: any) {
      console.warn('[VideoGenerator Warning] Falló render con video de categoría, intentando fallback de imagen:', err?.stderr || err);
    }
  }

  // CASO B: Fallback a imagen con efecto Ken Burns si no hay video de categoría
  const tempImagePath = path.join(tempDir, `img_${safeId}.jpg`);
  const fallbackImage =
    'https://images.unsplash.com/photo-1504608524841-42fe6f032b4b?w=1200&auto=format&fit=crop&q=80';
  const targetImageUrl = imageUrl || fallbackImage;

  try {
    await downloadImage(targetImageUrl, tempImagePath);
  } catch (e) {
    console.warn('[VideoGenerator] Falló descarga remota de imagen:', e);
  }

  const inputImage = fs.existsSync(tempImagePath) ? tempImagePath : logoPath;

  const fallbackFilter = [
    `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.0012,1.20)':d=${duration * 30}:s=1080x1920:fps=30`,
    `drawbox=y=ih-520:color=black@0.85:width=iw:height=520:t=fill`,
    `drawtext=fontfile='${WIN_FONT_BOLD}':text='${categoryHeader}':fontcolor=0xFFAA00:fontsize=36:x=70:y=h-440`,
    `drawtext=fontfile='${WIN_FONT_BOLD}':text='${cleanHeadline}':fontcolor=white:fontsize=46:x=70:y=h-370:line_spacing=18`,
  ].join(',');

  try {
    await execFileAsync(ffmpegExe, [
      '-y',
      '-loop', '1',
      '-t', `${duration}`,
      '-i', inputImage,
      '-vf', fallbackFilter,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      outputPath,
    ]);
  } finally {
    if (fs.existsSync(tempImagePath)) fs.unlinkSync(tempImagePath);
  }

  return publicVideoUrl;
}
