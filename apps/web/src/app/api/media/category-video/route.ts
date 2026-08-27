import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { getAssetsContenidoDir, resolveCategoryVideo } from '@/lib/contentLibrary';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const fileName = searchParams.get('file');

    let videoPath = '';

    if (category && fileName) {
      const contenidoDir = getAssetsContenidoDir();
      const candidatePath = path.join(contenidoDir, category, fileName);
      if (fs.existsSync(candidatePath)) {
        videoPath = candidatePath;
      }
    }

    if (!videoPath && category) {
      const resolved = resolveCategoryVideo(category);
      if (resolved && fs.existsSync(resolved.filePath)) {
        videoPath = resolved.filePath;
      }
    }

    if (!videoPath) {
      const fallback = resolveCategoryVideo('Ahora');
      if (fallback && fs.existsSync(fallback.filePath)) {
        videoPath = fallback.filePath;
      }
    }

    if (!videoPath || !fs.existsSync(videoPath)) {
      return new Response('Video no encontrado', { status: 404 });
    }

    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.get('range');

    const ext = path.extname(videoPath).toLowerCase();
    const contentType = ext === '.mov' ? 'video/quicktime' : 'video/mp4';

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (isNaN(start) || start < 0 || start >= fileSize) {
        return new Response('Requested Range Not Satisfiable', {
          status: 416,
          headers: {
            'Content-Range': `bytes */${fileSize}`,
          },
        });
      }

      if (isNaN(end) || end >= fileSize) {
        end = fileSize - 1;
      }

      const chunksize = end - start + 1;
      const fileStream = fs.createReadStream(videoPath, { start, end });
      const webStream = Readable.toWeb(fileStream);

      return new Response(webStream as any, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize.toString(),
          'Content-Type': contentType,
        },
      });
    } else {
      const fileStream = fs.createReadStream(videoPath);
      const webStream = Readable.toWeb(fileStream);

      return new Response(webStream as any, {
        status: 200,
        headers: {
          'Content-Length': fileSize.toString(),
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
        },
      });
    }
  } catch (error: any) {
    console.error('Error transmitiendo video de categoría:', error);
    return new Response('Error interno del servidor', { status: 500 });
  }
}
