import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getAssetsUploadsDir } from '@/lib/contentLibrary';

const ALLOWED_TYPES: Record<'image' | 'video', { mime: string[]; ext: string }> = {
  image: { mime: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], ext: '.jpg' },
  video: { mime: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'], ext: '.mp4' },
};

const MAX_SIZE_BYTES = 80 * 1024 * 1024; // 80MB

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    const kindRaw = form.get('kind');
    const kind: 'image' | 'video' = kindRaw === 'video' ? 'video' : 'image';

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Archivo requerido' }, { status: 400 });
    }
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: 'Archivo demasiado grande (máx. 80MB)' }, { status: 413 });
    }

    const allowed = ALLOWED_TYPES[kind];
    if (!allowed.mime.includes(file.type)) {
      return NextResponse.json(
        { error: `Tipo de archivo no permitido para ${kind === 'video' ? 'video' : 'imagen'}` },
        { status: 415 }
      );
    }

    // Nombre generado (UUID), nunca el del usuario: evita cualquier riesgo de
    // path traversal o colisión de archivos.
    const extFromName = path.extname(file.name).toLowerCase();
    const safeExt = /^\.[a-z0-9]{2,5}$/.test(extFromName) ? extFromName : allowed.ext;
    const fileName = `${crypto.randomUUID()}${safeExt}`;

    // Se guarda en assets/uploads (NO en public/): ver el comentario en
    // getAssetsUploadsDir() — public/ no sirve archivos escritos en runtime
    // dentro del build "standalone" de Next.js (404 permanente).
    const uploadDir = getAssetsUploadsDir();
    await mkdir(uploadDir, { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(uploadDir, fileName), buffer);

    return NextResponse.json({ success: true, url: `/api/media/uploads/${fileName}` });
  } catch (error: any) {
    console.error('Error subiendo archivo del Editor de video:', error);
    return NextResponse.json({ error: error?.message || 'No se pudo subir el archivo' }, { status: 500 });
  }
}
