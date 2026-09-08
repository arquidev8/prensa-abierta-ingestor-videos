import { NextRequest, NextResponse } from 'next/server';
import { resolveComposition } from '@/lib/contentLibrary';
import { searchPexelsVideos, searchPexelsPhotos } from '@/lib/pexels';
import { requestVideoRender, checkVideoJob } from '@/lib/engine';
import { sanitizeVideoDirection, VideoDirection } from '@/lib/videoDirection';

// Único pipeline de renderizado de video: el Go Engine (services/engine), con su
// worker pool de tamaño acotado. Antes existía una segunda implementación de FFmpeg
// en Node (lib/videoGenerator.ts) que: (a) duplicaba lógica de render ya resuelta en
// Go, (b) no tenía ningún timeout, por lo que un render colgado dejaba el botón de
// "Descargar" en estado de carga indefinidamente, y (c) elegía el clip de categoría
// por separado del preview (con selección aleatoria), por lo que preview y descarga
// casi nunca coincidían. Se eliminó esa duplicación: este endpoint ahora solo resuelve
// el clip (con el mismo `seed` que usa el preview) y delega el render real al Engine.

// El Go Engine acota cada render individual a 3 min (defaultRenderTimeout en
// pkg/video/engine.go), así que este polling debe cubrir esa misma ventana (+ un
// margen) para no devolver un 504 justo antes de que el worker termine.
const MAX_WAIT_MS = 190_000;
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
      videoDirection,
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
      // Capa 3: la "dirección de composición" generada por la IA / Motor Autónomo
      // (apps/web/src/lib/videoDirection.ts), leída del ProcessedNews. Influye en
      // duración, plantilla, base (imagen/video) y las queries de Pexels. Las
      // elecciones explícitas del "Editor de video" (background/template) siguen
      // teniendo prioridad — el front ya las inicializa desde esta dirección.
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
      videoDirection?: VideoDirection;
    };

    if (!headline) {
      return NextResponse.json({ error: 'El titular (headline) es requerido' }, { status: 400 });
    }

    // Se re-sanea aunque venga ya saneada de Capa 1: puede llegar de un registro
    // viejo (sin dirección) o manipulada. Con `videoDirection` ausente devuelve
    // una dirección por defecto derivada del contexto, así el resto del código
    // siempre trabaja con un objeto completo.
    const dir = sanitizeVideoDirection(videoDirection, {
      fallbackHeadline: headline,
      category: category || '',
      videoSearchTags: tags,
    });

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
    // `background` (elección explícita del modal) manda; si no vino, se usa el
    // `lead_with` de la dirección de video.
    const imageOnly = (background || dir.lead_with) === 'image';

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

    // Con un tema del banco identificado, la query curada del tema es la mejor;
    // sin tema, la `image_query` de la IA (un concepto visual concreto) gana a las
    // "palabras sueltas del titular" que arma resolveComposition.
    const photoQuery = comp.matchedTopic
      ? comp.imagePexelsQuery
      : dir.image_query || comp.imagePexelsQuery;

    const tryPexelsPhoto = async () => {
      if (leadImageUrl || !photoQuery) return;
      try {
        const pics = await searchPexelsPhotos(photoQuery);
        if (pics.length > 0) {
          leadImageUrl = pics[0];
          leadImageSource = `pexels (${photoQuery})`;
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
      // Sin tema del banco: la foto propia de la noticia es el mejor candidato
      // (es DE esa noticia). Solo si no hay, se va a Pexels con la `image_query`
      // de la IA — o, si no la hay, las palabras del titular.
      if (!leadImageUrl && imageUrl) {
        leadImageUrl = imageUrl;
        leadImageSource = 'destacada de la noticia';
      }
      await tryPexelsPhoto();
    }

    // ── Paso 3: VIDEO de la misma carpeta ──────────────────────────────────
    // El video importado por el usuario (Editor de video) tiene prioridad sobre
    // todo lo demás.
    let videoClipUrl: string | undefined = imageOnly
      ? undefined
      : customClipUrl
        ? abs(customClipUrl)
        : undefined;
    let videoSource = customClipUrl ? 'importado por el usuario' : '';

    // Cuándo las clip_queries de la IA (dirigidas al asunto real de la noticia)
    // le ganan al clip del banco: cuando ese clip NO es específico del tema —
    // sea porque la carpeta es el bucket de respaldo, porque no se detectó tema,
    // o porque el único clip disponible en la carpeta es el genérico (no hay un
    // `Sucesos-crimen.mp4`, solo `Sucesos 1.mp4`). Un clip del banco que SÍ es
    // del tema (curado y on-topic) sigue teniendo prioridad. Solo aplica a
    // direcciones de IA real (no al Motor Autónomo, cuyas queries son genéricas).
    const bankClipIsGeneric = !!comp.video && !comp.videoIsTopicMatch;
    const preferAiClips =
      !imageOnly &&
      !videoClipUrl &&
      dir.source === 'ai' &&
      dir.clip_queries.length > 0 &&
      (comp.matchedFolderIsFallback || !comp.matchedTopic || bankClipIsGeneric);

    // 1. Clip del banco (salvo que prefiramos las clip_queries de la IA).
    let bankClipDeferred = false;
    if (!imageOnly && !videoClipUrl && comp.video) {
      if (preferAiClips) {
        bankClipDeferred = true;
      } else {
        videoClipUrl = abs(comp.video.streamUrl);
        videoSource = `banco ${comp.videoIsTopicMatch ? 'tema' : 'genérico'} (${comp.video.fileName})`;
      }
    }

    // 2. Pexels: lista ordenada de queries. Cuando preferimos las de la IA van
    // primero (más específicas de la noticia), con la query curada del tema como
    // respaldo; en el flujo normal, primero la query del banco/tema y las de la
    // IA de refuerzo. Se prueba cada una hasta que Pexels devuelva algo.
    let aiClipQueryUsed = false;
    if (!imageOnly && !videoClipUrl) {
      const clipQueries = (
        preferAiClips
          ? [...dir.clip_queries, comp.topicPexelsQuery, comp.videoPexelsQuery]
          : comp.matchedTopic
            ? [comp.videoPexelsQuery, ...dir.clip_queries, comp.topicPexelsQuery]
            : [...dir.clip_queries, comp.videoPexelsQuery]
      ).filter((q, i, arr): q is string => !!q && arr.indexOf(q) === i);

      for (const q of clipQueries) {
        try {
          const pex = await searchPexelsVideos(q, category || 'general');
          if (pex.length > 0) {
            videoClipUrl = pex[0];
            videoSource = `pexels (${q})`;
            aiClipQueryUsed = dir.clip_queries.includes(q);
            break;
          }
        } catch (e) {
          console.warn('[render-video] Búsqueda de video en Pexels falló:', e);
        }
      }
    }

    // 3. El clip del banco que se difirió en el paso 1, si Pexels no dio nada.
    if (!imageOnly && !videoClipUrl && bankClipDeferred && comp.video) {
      videoClipUrl = abs(comp.video.streamUrl);
      videoSource = `banco ${comp.videoIsTopicMatch ? 'tema' : 'genérico'} (${comp.video.fileName})`;
    }

    // 4. Último recurso: el video genérico de la carpeta.
    if (!imageOnly && !videoClipUrl && comp.videoFallback) {
      videoClipUrl = abs(comp.videoFallback.streamUrl);
      videoSource = `banco genérico (${comp.videoFallback.fileName})`;
    }

    const clipUrls: string[] = videoClipUrl ? [videoClipUrl] : [];

    // `template` explícito del modal manda; si no vino, el de la dirección de video.
    const effectiveTemplate = template || dir.template;
    // `duration` explícito del modal manda; si no vino, el de la dirección (8-18,
    // ya acotado por sanitizeVideoDirection).
    const effectiveDuration = duration || dir.duration_sec;

    // ¿Ayudó la IA a componer? Se registra el origen de la dirección y si sus
    // clip_queries terminaron eligiendo el b-roll o las pisó un clip del banco.
    const aiClipsNote = aiClipQueryUsed
      ? 'clip_queries_IA=usadas'
      : dir.source === 'ai' && dir.clip_queries.length > 0 && videoSource.startsWith('banco')
        ? `clip_queries_IA=descartadas (ganó ${videoSource})`
        : 'clip_queries_IA=n/a';

    console.log(
      `[render-video] carpeta="${comp.matchedFolder}"${comp.matchedFolderIsFallback ? '(respaldo)' : ''} ` +
        `tema="${comp.matchedTopic || '-'}" dir=${dir.source || 'default'} ` +
        `imagen=${leadImageSource || 'ninguna'} video=${videoSource || 'ninguno'} ` +
        `plantilla=${effectiveTemplate} dur=${effectiveDuration}s base=${imageOnly ? 'imagen' : 'video'} ${aiClipsNote}`
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
      duration_sec: effectiveDuration,
      template:
        effectiveTemplate === 'reels-safe'
          ? 'reels-safe'
          : effectiveTemplate === 'app-promo'
            ? 'app-promo'
            : 'standard',
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
