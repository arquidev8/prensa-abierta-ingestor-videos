import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { getAssetsUploadsDir } from '@/lib/contentLibrary';

export const dynamic = 'force-dynamic';

// Sirve los archivos importados por el usuario desde el "Editor de video"
// (assets/uploads, escritos por /api/media/upload) vía un route handler dinámico
// en vez de `public/`: el build "standalone" de Next.js (usado en el Dockerfile)
// resuelve el set de archivos estáticos de `public/` una sola vez al arrancar, así
// que un archivo agregado ahí en runtime nunca llega a ser servible (404
// permanente) — un route handler sí lee el disco en cada request.

const IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const VIDEO_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
};

// Nombres generados por /api/media/upload: `<uuid v4>.<ext>`. Se valida el
// patrón exacto antes de tocar el filesystem (nunca se confía en el nombre de
// la URL para construir una ruta sin validar — evita path traversal).
const SAFE_FILENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$/i;

export async function GET(req: NextRequest, context: { params: Promise<{ filename: string }> }) {
  try {
    const { filename } = await context.params;
    if (!SAFE_FILENAME.test(filename)) {
      return new Response('No encontrado', { status: 404 });
    }

    const filePath = path.join(getAssetsUploadsDir(), filename);
    if (!fs.existsSync(filePath)) {
      return new Response('No encontrado', { status: 404 });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const ext = path.extname(filename).toLowerCase();
    const contentType = IMAGE_TYPES[ext] || VIDEO_TYPES[ext] || 'application/octet-stream';
    const range = req.headers.get('range');

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (isNaN(start) || start < 0 || start >= fileSize) {
        return new Response('Requested Range Not Satisfiable', {
          status: 416,
          headers: { 'Content-Range': `bytes */${fileSize}` },
        });
      }
      if (isNaN(end) || end >= fileSize) {
        end = fileSize - 1;
      }

      const chunkSize = end - start + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });
      return new Response(Readable.toWeb(fileStream) as any, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize.toString(),
          'Content-Type': contentType,
        },
      });
    }

    const fileStream = fs.createReadStream(filePath);
    return new Response(Readable.toWeb(fileStream) as any, {
      status: 200,
      headers: {
        'Content-Length': fileSize.toString(),
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      },
    });
  } catch (error: any) {
    console.error('Error sirviendo archivo importado del Editor de video:', error);
    return new Response('Error interno del servidor', { status: 500 });
  }
}
