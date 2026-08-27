import { NextRequest, NextResponse } from 'next/server';
import { rewriteNewsWithOllamaCloud } from '@/lib/ollama';
import { publishToWordPress } from '@/lib/wordpress';
import { saveProcessedNews, requestVideoRender, fetchMediaItems } from '@/lib/engine';
import { searchPexelsVideos } from '@/lib/pexels';
import { resolveCategoryVideo } from '@/lib/contentLibrary';
import { RawNews, ProcessedNews } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { rawNews, autoPublishWP, generateVideo, ollamaModel } = body as {
      rawNews: RawNews;
      autoPublishWP?: boolean;
      generateVideo?: boolean;
      ollamaModel?: string;
    };

    if (!rawNews || !rawNews.title) {
      return NextResponse.json({ error: 'Datos de noticia inválidos' }, { status: 400 });
    }

    console.log(`[Pipeline] 1. Redactando noticia con IA (${ollamaModel || 'GLM / MiniMax'}): "${rawNews.title}"`);

    // 1. Redacción IA con GLM / MiniMax / Qwen
    const editorial = await rewriteNewsWithOllamaCloud(
      rawNews.title,
      rawNews.content || rawNews.summary,
      rawNews.source_name,
      { model: ollamaModel }
    );

    console.log(`[Pipeline] 2. Redacción IA completada. Titular Prensa Abierta: "${editorial.title}"`);

    // 2. Buscar imagen del Banco de Medios por categoría
    const mediaList = await fetchMediaItems(editorial.category, 'image');
    let featuredImageUrl = rawNews.image_url || 'https://images.unsplash.com/photo-1586339949916-3e9457bef6d3?w=1200';
    if (mediaList && mediaList.length > 0) {
      featuredImageUrl = mediaList[0].url;
    }

    // 3. Inyección en WordPress (Modo Sandbox seguro)
    let wpPostId: number | undefined = undefined;
    let wpUrl: string | undefined = undefined;

    if (autoPublishWP) {
      console.log(`[Pipeline] 3. Inyectando en WordPress...`);
      const wpResult = await publishToWordPress({
        title: editorial.title,
        content: editorial.content_html,
        excerpt: editorial.subtitle,
        status: 'publish',
      });
      wpPostId = wpResult.id;
      wpUrl = wpResult.link;
    }

    // 4. Generación de video 10-15s en Go Engine con clips de Pexels / Banco de Medios
    let videoStatus: 'none' | 'rendering' | 'ready' | 'failed' = 'none';
    let videoJobId = '';

    if (generateVideo !== false) {
      // Aislado en su propio try/catch: un fallo aquí (Engine caído, sin clips, etc.)
      // no debe descartar la redacción ya generada ni la publicación en WordPress.
      try {
        // Prioridad 1: banco propio (assets/contenido), sin overlays ni gráficos de terceros
        const ownVideo = resolveCategoryVideo(editorial.category, editorial.video_search_tags);
        let stockClips: string[];

        if (ownVideo) {
          console.log(`[Pipeline] 4. Usando video del banco propio (categoría "${ownVideo.matchedFolder}"): ${ownVideo.fileName}`);
          stockClips = [`${req.nextUrl.origin}${ownVideo.streamUrl}`];
        } else {
          console.log(`[Pipeline] 4. Sin banco propio disponible. Buscando clips en Pexels para tags: ${editorial.video_search_tags.join(', ')}`);
          const query = editorial.video_search_tags.slice(0, 2).join(' ') || editorial.category;
          stockClips = await searchPexelsVideos(query, editorial.category);
        }

        const renderRes = await requestVideoRender({
          news_id: rawNews.id,
          headline: editorial.title,
          category: editorial.category,
          clip_urls: stockClips,
          duration_sec: 12,
        });

        videoJobId = renderRes.job_id;
        videoStatus = 'rendering';
        console.log(`[Pipeline] 🎬 Trabajo de video encolado en Go Engine: ${videoJobId} (${stockClips.length} clips)`);
      } catch (videoError: any) {
        console.error('[Pipeline] ⚠️ Falló la generación de video, se continúa sin video:', videoError);
        videoStatus = 'failed';
      }
    }

    // 5. Guardar Noticia Procesada en Go Engine
    const processedRecord: ProcessedNews = {
      id: rawNews.id,
      raw_news_id: rawNews.id,
      title: editorial.title,
      subtitle: editorial.subtitle,
      content_html: editorial.content_html,
      category: editorial.category,
      tags: editorial.tags,
      video_search_tags: editorial.video_search_tags,
      featured_image_url: featuredImageUrl,
      wordpress_post_id: wpPostId,
      wordpress_url: wpUrl,
      video_status: videoStatus,
      created_at: new Date().toISOString(),
      published_at: wpPostId ? new Date().toISOString() : undefined,
      status: wpPostId ? 'published' : 'draft',
    };

    try {
      await saveProcessedNews(processedRecord);
    } catch (saveError: any) {
      console.error('[Pipeline] ❌ Falló el guardado en Go Engine:', saveError);
      throw new Error(`No se pudo guardar la noticia en el Go Engine: ${saveError.message}`);
    }

    return NextResponse.json({
      success: true,
      processed: processedRecord,
      video_job_id: videoJobId,
      editorial,
    });
  } catch (error: any) {
    console.error('[Pipeline ERROR]:', error);
    return NextResponse.json({ error: error.message || 'Error en el pipeline editorial' }, { status: 500 });
  }
}
