import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import {
  getAllCategoryFolders,
  resolveCategoryVideo,
  resolveComposition,
  MediaFile,
} from '@/lib/contentLibrary';

export const dynamic = 'force-dynamic';

// Sirve un archivo ya resuelto: si viene de Cloudinary (`isRemote`), redirige
// a su URL pública (el navegador lo reproduce directo desde el CDN); si es
// local, se transmite desde disco como antes (con soporte de `Range`).
function serveResolvedMedia(req: NextRequest, media: { streamUrl: string; filePath: string; isRemote: boolean }) {
  if (media.isRemote) {
    return NextResponse.redirect(media.streamUrl, 302);
  }

  if (!media.filePath || !fs.existsSync(media.filePath)) {
    return new Response('Video no encontrado', { status: 404 });
  }

  const stat = fs.statSync(media.filePath);
  const fileSize = stat.size;
  const range = req.headers.get('range');

  const ext = path.extname(media.filePath).toLowerCase();
  const IMG_TYPES: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  const contentType = IMG_TYPES[ext] || (ext === '.mov' ? 'video/quicktime' : 'video/mp4');

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

    const chunksize = end - start + 1;
    const fileStream = fs.createReadStream(media.filePath, { start, end });
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
  }

  const fileStream = fs.createReadStream(media.filePath);
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

// Busca un archivo puntual (category+file) entre las fuentes ya resueltas por
// `getAllCategoryFolders()` (Cloudinary o disco local, lo que esté activo).
function findMediaFile(category: string, fileName: string): MediaFile | null {
  const folder = getAllCategoryFolders().find(
    (f) => f.name.toLowerCase() === category.toLowerCase()
  );
  if (!folder) return null;
  const all = [...folder.videos, ...folder.images];
  return all.find((f) => f.fileName === fileName) || null;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const fileName = searchParams.get('file');
    // `seed` (típicamente el id de la noticia) hace determinística la selección
    // dentro de una carpeta con varios clips, para que este preview y la descarga
    // del mismo item usen el mismo b-roll en vez de uno al azar cada uno.
    const seed = searchParams.get('seed') || undefined;
    // `q` (el titular) afina la elección dentro de "Deportes" por deporte específico.
    const q = searchParams.get('q') || undefined;

    if (category && fileName) {
      const match = findMediaFile(category, fileName);
      if (match) {
        return serveResolvedMedia(req, match);
      }
    }

    if (category) {
      const comp = resolveComposition(category, undefined, seed, q);
      if (comp.video) {
        return serveResolvedMedia(req, comp.video);
      }
      if (comp.leadImage) {
        // Tema identificado con imagen temática pero sin clip de video: se sirve
        // ESA imagen (no un 404) para que el preview muestre la misma base que
        // usará la descarga real (`lead_image_url` en /api/render-video).
        return serveResolvedMedia(req, comp.leadImage);
      }
      if (comp.matchedTopic || comp.imagePexelsQuery || comp.videoPexelsQuery) {
        // Tema identificado, sin imagen ni video local: la composición real se
        // arma con Pexels / imagen destacada al descargar; el preview cae a su
        // propio fallback de imagen.
        return new Response('Sin medio local para este tema; usar imagen', { status: 404 });
      }
    }

    const fallback = resolveCategoryVideo('Ahora');
    if (fallback) {
      return serveResolvedMedia(req, fallback);
    }

    return new Response('Video no encontrado', { status: 404 });
  } catch (error: any) {
    console.error('Error transmitiendo video de categoría:', error);
    return new Response('Error interno del servidor', { status: 500 });
  }
}
