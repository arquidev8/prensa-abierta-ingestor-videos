import { NextRequest, NextResponse } from 'next/server';
import { resolveComposition } from '@/lib/contentLibrary';
import { searchPexelsVideos, searchPexelsPhotos } from '@/lib/pexels';
import { requestVideoRender, checkVideoJob } from '@/lib/engine';

// Único pipeline de renderizado de video: el Go Engine (services/engine), con su
// worker pool de tamaño acotado. Antes existía una segunda implementación de FFmpeg
// en Node (lib/videoGenerator.ts) que: (a) duplicaba lógica de render ya resuelta en
// Go, (b) no tenía ningún timeout, por lo que un render colgado dejaba el botón de
// "Descargar" en estado de carga indefinidamente, y (c) elegía el clip de categoría
// por separado del preview (con selección aleatoria), por lo que preview y descarga
// casi nunca coincidían. Se eliminó esa duplicación: este endpoint ahora solo resuelve
// el clip (con el mismo `seed` que usa el preview) y delega el render real al Engine.

// 120s: el Go Engine acota cada render individual a 2 min (defaultRenderTimeout en
// pkg/video/engine.go), así que este polling debe cubrir esa misma ventana para no
// devolver un 504 justo antes de que el worker termine.
const MAX_WAIT_MS = 120_000;
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
    const {
      newsId,
      headline,
      category,
      tags,
      imageUrl,
      duration,
      background,
      template,
      customImageUrl,
      customClipUrl,
    } = body as {
      newsId?: string;
      headline?: string;
      category?: string;
      tags?: string[];
      imageUrl?: string;
      duration?: number;
      // 'image' => composición liderada por la imagen inicial, sin clip de b-roll
      // (elegido desde el "Editor de video" del modal). 'video' / undefined => flujo normal.
      background?: 'image' | 'video';
      // Plantilla de layout: 'reels-safe' aplica la guía .agents/formato-video-reel.md;
      // 'app-promo' es igual a 'standard' pero con el banner "Descarga la App GRATIS"
      // quemado debajo del titular (ver layoutFor() en el Go Engine).
      template?: 'standard' | 'reels-safe' | 'app-promo';
      // Archivos importados por el usuario en el "Editor de video" (ya subidos vía
      // /api/media/upload, rutas same-origin tipo /api/media/uploads/<archivo>).
      // Cuando están presentes, reemplazan la imagen/video que se resolvería
      // automáticamente.
      customImageUrl?: string;
      customClipUrl?: string;
    };

    if (!headline) {
      return NextResponse.json({ error: 'El titular (headline) es requerido' }, { status: 400 });
    }

    const effectiveNewsId = newsId || `news_${Date.now()}`;
    const origin = WEB_INTERNAL_URL || req.nextUrl.origin;
    // `streamUrl` ya es absoluta cuando el clip viene de Cloudinary (banco
    // migrado) — en ese caso el Go Engine la descarga directo del CDN, sin
    // pasar por `web`. Solo las rutas locales (`/api/media/...`) necesitan el
    // prefijo de origen interno.
    const abs = (streamUrl: string) => (/^https?:\/\//i.test(streamUrl) ? streamUrl : `${origin}${streamUrl}`);

    // Composición de b-roll siguiendo la ruta:
    //   1. categoría → carpeta en assets/contenido
    //   2. imagen referente en esa carpeta → si no hay, foto de Pexels → si no, imagen destacada
    //   3. video acorde en la MISMA carpeta (tema → genérico) → si no hay, clip de Pexels
    // `headline` determina el tema; `seed`=id de la noticia hace la elección
    // determinística para que preview y descarga coincidan.
    const comp = resolveComposition(category, tags, effectiveNewsId, headline);

    // Si el usuario eligió "Imagen" como base en el Editor de video, se omite por
    // completo el clip de b-roll: la pieza se arma solo con la imagen inicial.
    const imageOnly = background === 'image';

    // ── Paso 2: IMAGEN líder ────────────────────────────────────────────────
    // La imagen importada por el usuario (Editor de video) tiene prioridad sobre
    // la resuelta automáticamente por categoría/tema.
    let leadImageUrl: string | undefined = customImageUrl
      ? abs(customImageUrl)
      : comp.leadImage
        ? abs(comp.leadImage.streamUrl)
        : undefined;
    let leadImageSource = customImageUrl
      ? 'importada por el usuario'
      : comp.leadImage
        ? `banco (${comp.leadImage.fileName})`
        : '';

    const tryPexelsPhoto = async () => {
      if (leadImageUrl || !comp.imagePexelsQuery) return;
      try {
        const pics = await searchPexelsPhotos(comp.imagePexelsQuery);
        if (pics.length > 0) {
          leadImageUrl = pics[0];
          leadImageSource = 'pexels';
        }
      } catch (e) {
        console.warn('[render-video] Búsqueda de foto en Pexels falló:', e);
      }
    };

    // Con un tema identificado, la foto de Pexels del tema va ANTES que la imagen
    // destacada de la noticia: esa foto (un vocero, un edificio, la gobernadora…)
    // casi siempre es de otro asunto y no del tema real del titular. Y si Pexels
    // tampoco tiene nada, se prefiere NO poner imagen líder (el video temático
    // ocupa toda la pieza) antes que meter una foto de otro asunto.
    if (comp.matchedTopic) {
      await tryPexelsPhoto();
    } else {
      // Sin tema: la foto propia de la noticia es el mejor candidato; si no hay,
      // Pexels con las palabras del titular.
      if (imageUrl) {
        leadImageUrl = imageUrl;
        leadImageSource = 'destacada de la noticia';
      }
      await tryPexelsPhoto();
    }

    // ── Paso 3: VIDEO de la misma carpeta ──────────────────────────────────
    // El video importado por el usuario (Editor de video) tiene prioridad sobre
    // el resuelto automáticamente por categoría/tema.
    let videoClipUrl: string | undefined = imageOnly
      ? undefined
      : customClipUrl
        ? abs(customClipUrl)
        : comp.video
          ? abs(comp.video.streamUrl)
          : undefined;
    let videoSource = customClipUrl
      ? 'importado por el usuario'
      : videoClipUrl
        ? `banco (${comp.video!.fileName})`
        : '';
    if (!imageOnly && !videoClipUrl && comp.videoPexelsQuery) {
      try {
        const pex = await searchPexelsVideos(comp.videoPexelsQuery, category || 'general');
        if (pex.length > 0) {
          videoClipUrl = pex[0];
          videoSource = 'pexels';
        }
      } catch (e) {
        console.warn('[render-video] Búsqueda de video en Pexels falló:', e);
      }
    }
    // Último recurso: el video genérico de la carpeta (si Pexels no devolvió nada
    // para un tema sin clip propio — ej. Pexels no configurado).
    if (!imageOnly && !videoClipUrl && comp.videoFallback) {
      videoClipUrl = abs(comp.videoFallback.streamUrl);
      videoSource = `banco genérico (${comp.videoFallback.fileName})`;
    }

    const clipUrls: string[] = videoClipUrl ? [videoClipUrl] : [];

    console.log(
      `[render-video] carpeta="${comp.matchedFolder}" tema="${comp.matchedTopic || '-'}" ` +
        `imagen=${leadImageSource || 'ninguna'} video=${videoSource || 'ninguno'}`
    );

    const { job_id } = await requestVideoRender({
      news_id: effectiveNewsId,
      headline,
      category: category || 'NOTICIAS',
      clip_urls: clipUrls,
      lead_image_url: leadImageUrl,
      // Fallback del Engine cuando no hay ni imagen líder ni clip: usa la imagen
      // destacada de la noticia (con zoom) antes de caer al video de color.
      image_url: imageUrl,
      // Si hay un tema identificado —o el usuario forzó "Imagen" como base— el
      // Engine NO debe sustituir por un clip genérico de la categoría cuando
      // clip_urls viene vacío.
      no_category_fallback: !!comp.matchedTopic || imageOnly,
      duration_sec: duration || 12,
      template:
        template === 'reels-safe' ? 'reels-safe' : template === 'app-promo' ? 'app-promo' : 'standard',
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
