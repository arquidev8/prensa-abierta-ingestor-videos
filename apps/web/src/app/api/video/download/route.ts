import { NextRequest, NextResponse } from 'next/server';

// El navegador no puede resolver el DNS interno de Docker (`http://engine:8080`),
const rawEngineUrl = process.env.ENGINE_INTERNAL_URL;
const rawConfigUrl =
  rawEngineUrl && !rawEngineUrl.includes('//engine:')
    ? rawEngineUrl
    : process.env.NEXT_PUBLIC_ENGINE_URL || 'http://127.0.0.1:8085';
// En Windows / local dev, usar 127.0.0.1 evita demoras de resolución IPv6 (::1) de Node.js
const ENGINE_URL = rawConfigUrl.replace('localhost', '127.0.0.1');

/**
 * Proxy de descarga y streaming same-origin para los videos servidos por el Go Engine.
 *
 * Soporta:
 * 1. Streaming inline con Byte Ranges (HTTP 206) para reproducción fluida en etiquetas <video>.
 * 2. Descarga directa con `Content-Disposition: attachment` cuando se descarga el archivo.
 */
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get('path');
  const filename = req.nextUrl.searchParams.get('filename') || 'prensa-abierta-video.mp4';
  const range = req.headers.get('range');
  const isInline =
    req.nextUrl.searchParams.get('inline') === '1' ||
    req.nextUrl.searchParams.get('preview') === '1' ||
    Boolean(range);

  // Solo se permite reexponer archivos bajo /videos/ del Engine, nunca una URL arbitraria
  if (!path || !/^\/videos\/[a-zA-Z0-9_.-]+$/.test(path)) {
    return NextResponse.json({ error: 'Ruta de video inválida' }, { status: 400 });
  }

  const upstreamHeaders: Record<string, string> = {};
  if (range) {
    upstreamHeaders['Range'] = range;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${ENGINE_URL}${path}`, {
      headers: upstreamHeaders,
    });
  } catch (err) {
    console.error('Error obteniendo video del Go Engine:', err);
    return NextResponse.json({ error: 'No se pudo conectar con el Motor Go (Engine)' }, { status: 502 });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json({ error: `El Engine respondió ${upstream.status} al pedir el video` }, { status: 502 });
  }

  const headers = new Headers();
  headers.set('Content-Type', upstream.headers.get('content-type') || 'video/mp4');
  headers.set('Accept-Ranges', 'bytes');

  if (isInline) {
    headers.set('Content-Disposition', 'inline');
  } else {
    headers.set('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
  }

  const contentLength = upstream.headers.get('content-length');
  if (contentLength) headers.set('Content-Length', contentLength);

  const contentRange = upstream.headers.get('content-range');
  if (contentRange) headers.set('Content-Range', contentRange);

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
