import { NextRequest, NextResponse } from 'next/server';
import { resolveCategoryVideo } from '@/lib/contentLibrary';
import { requestVideoRender, checkVideoJob } from '@/lib/engine';

// Único pipeline de renderizado de video: el Go Engine (services/engine), con su
// worker pool de tamaño acotado. Antes existía una segunda implementación de FFmpeg
// en Node (lib/videoGenerator.ts) que: (a) duplicaba lógica de render ya resuelta en
// Go, (b) no tenía ningún timeout, por lo que un render colgado dejaba el botón de
// "Descargar" en estado de carga indefinidamente, y (c) elegía el clip de categoría
// por separado del preview (con selección aleatoria), por lo que preview y descarga
// casi nunca coincidían. Se eliminó esa duplicación: este endpoint ahora solo resuelve
// el clip (con el mismo `seed` que usa el preview) y delega el render real al Engine.

const MAX_WAIT_MS = 50_000;
const POLL_INTERVAL_MS = 1_500;

// El clip que se pasa como `clip_urls` al Go Engine lo descarga el CONTENEDOR del
// Engine, no el navegador ni el proceso de Next.js — por lo tanto no puede ser
// `req.nextUrl.origin` (esa es la URL vista por quien hizo la petición HTTP a este
// endpoint, típicamente `http://localhost:3000` visto desde el navegador). Dentro de
// Docker, el Engine debe alcanzar a `web` por su nombre de servicio DNS interno.
const WEB_INTERNAL_URL = process.env.WEB_INTERNAL_URL;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { newsId, headline, category, tags, imageUrl, duration } = body as {
      newsId?: string;
      headline?: string;
      category?: string;
      tags?: string[];
      imageUrl?: string;
      duration?: number;
    };

    if (!headline) {
      return NextResponse.json({ error: 'El titular (headline) es requerido' }, { status: 400 });
    }

    const effectiveNewsId = newsId || `news_${Date.now()}`;

    // Mismo `seed` (id de la noticia) que usa VideoPlayerPreview al pedir el clip
    // de categoría, para que la descarga use exactamente el mismo b-roll que ya
    // se le mostró al editor en el preview.
    const resolved = resolveCategoryVideo(category, tags, effectiveNewsId);

    // Si no hay ningún clip propio para esta categoría (assets/contenido vacío o
    // sin coincidencias), NO cortamos con error: se le pasa `clip_urls` vacío al
    // Go Engine para que use su propio fallback interno (un video de color con el
    // titular quemado — ver `renderFallbackColorVideo` en services/engine/pkg/video/engine.go).
    // Así la descarga SIEMPRE produce un archivo en vez de fallar, igual que el
    // preview siempre muestra algo (clip real o imagen) en vez de romperse.
    const clipUrls: string[] = [];
    if (resolved) {
      clipUrls.push(`${WEB_INTERNAL_URL || req.nextUrl.origin}${resolved.streamUrl}`);
    } else {
      console.warn(
        `[render-video] Sin clip propio para la categoría "${category}" — el Go Engine usará su fallback de color con el titular quemado.`
      );
    }

    const { job_id } = await requestVideoRender({
      news_id: effectiveNewsId,
      headline,
      category: category || 'NOTICIAS',
      clip_urls: clipUrls,
      // Fallback para cuando no hay clip propio: el Go Engine usa la imagen
      // destacada de la noticia (Ken Burns) antes de caer al video de color.
      image_url: imageUrl,
      duration_sec: duration || 12,
    });

    // El Engine renderiza de forma asíncrona (worker pool); hacemos polling acotado
    // en vez de esperar indefinidamente, así el fetch del cliente SIEMPRE resuelve
    // (éxito, error o timeout explícito) y el botón nunca queda "generando" para siempre.
    const startedAt = Date.now();
    while (Date.now() - startedAt < MAX_WAIT_MS) {
      const job = await checkVideoJob(job_id);

      if (job.status === 'completed' && job.output_url) {
        // Se devuelve una URL same-origin (proxy /api/video/download) en vez del link
        // directo al Engine: el atributo `download` de un <a> se ignora en URLs
        // cross-origin salvo que el servidor mande `Content-Disposition: attachment`,
        // cosa que el Go Engine no hace (sirve los videos con `app.Static`).
        const safeFilename = `prensa-abierta-${headline
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z0-9]/g, '-')
          .slice(0, 40)}.mp4`;
        return NextResponse.json({
          success: true,
          videoUrl: `/api/video/download?path=${encodeURIComponent(job.output_url)}&filename=${encodeURIComponent(
            safeFilename
          )}`,
        });
      }

      if (job.status === 'failed') {
        return NextResponse.json(
          { error: job.error || 'El Go Engine no pudo renderizar el video' },
          { status: 502 }
        );
      }

      await sleep(POLL_INTERVAL_MS);
    }

    return NextResponse.json(
      {
        error:
          'Tiempo de espera agotado renderizando el video. El Engine puede estar saturado; intenta de nuevo en unos segundos.',
        job_id,
      },
      { status: 504 }
    );
  } catch (error: any) {
    console.error('Error generando video real (Go Engine):', error);
    return NextResponse.json(
      { error: error?.message || 'Error al generar video' },
      { status: 500 }
    );
  }
}
