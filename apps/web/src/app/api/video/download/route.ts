import { NextRequest, NextResponse } from 'next/server';

// El navegador no puede resolver el DNS interno de Docker (`http://engine:8080`),
// así que esta ruta corre en el servidor de Next.js y usa la URL interna del Engine.
const ENGINE_URL =
  process.env.ENGINE_INTERNAL_URL || process.env.NEXT_PUBLIC_ENGINE_URL || 'http://localhost:8085';

/**
 * Proxy de descarga same-origin para los videos servidos por el Go Engine.
 *
 * Por qué existe: el atributo `download` de un <a> se IGNORA en URLs cross-origin
 * a menos que la respuesta traiga `Content-Disposition: attachment` — el Go Engine
 * sirve los videos con `app.Static()` (sin ese header), así que un link directo a
 * `http://<engine-host>/videos/xxx.mp4` terminaba abriendo el video inline (o
 * navegando fuera de la app) en vez de descargarlo. Esta ruta reexpone el archivo
 * desde el mismo origen que la UI, con `Content-Disposition` explícito.
 */
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get('path');
  const filename = req.nextUrl.searchParams.get('filename') || 'prensa-abierta-video.mp4';

  // Solo se permite reexponer archivos bajo /videos/ del Engine, nunca una URL arbitraria
  if (!path || !/^\/videos\/[a-zA-Z0-9_.-]+$/.test(path)) {
    return NextResponse.json({ error: 'Ruta de video inválida' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${ENGINE_URL}${path}`);
  } catch (err) {
    console.error('Error obteniendo video del Go Engine para descarga:', err);
    return NextResponse.json({ error: 'No se pudo conectar con el Motor Go (Engine)' }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `El Engine respondió ${upstream.status} al pedir el video` }, { status: 502 });
  }

  const headers = new Headers();
  headers.set('Content-Type', upstream.headers.get('content-type') || 'video/mp4');
  headers.set('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
  const contentLength = upstream.headers.get('content-length');
  if (contentLength) headers.set('Content-Length', contentLength);

  return new NextResponse(upstream.body, { status: 200, headers });
}
