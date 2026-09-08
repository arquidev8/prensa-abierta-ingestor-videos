import { NextRequest, NextResponse } from 'next/server';
import { rewriteNewsWithOllamaCloud } from '@/lib/ollama';
import { publishToWordPress } from '@/lib/wordpress';
import { saveProcessedNews, fetchMediaItems } from '@/lib/engine';
import { RawNews, ProcessedNews } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { rawNews, autoPublishWP, ollamaModel } = body as {
      rawNews: RawNews;
      autoPublishWP?: boolean;
      ollamaModel?: string;
    };

    if (!rawNews || !rawNews.title) {
      return NextResponse.json({ error: 'Datos de noticia inválidos' }, { status: 400 });
    }

    const modelLabel = ollamaModel || process.env.OLLAMA_MODEL || 'glm-5.2';
    console.log(`[Pipeline] 1. Redactando noticia (modelo IA: ${modelLabel}): "${rawNews.title}"`);

    // 1. Redacción: IA remota; si falla, Motor Autónomo local (ver lib/ollama.ts).
    const editorial = await rewriteNewsWithOllamaCloud(
      rawNews.title,
      rawNews.content || rawNews.summary,
      rawNews.source_name,
      { model: ollamaModel }
    );

    const redactor = editorial.source === 'ai' ? `IA (${modelLabel})` : 'Motor Autónomo';
    console.log(`[Pipeline] 2. Redacción completada por ${redactor}. Titular: "${editorial.title}"`);
    const vd = editorial.video_direction;
    console.log(
      `[Pipeline]    Dirección de video [${vd.source || 'default'}]: ` +
        `plantilla=${vd.template} dur=${vd.duration_sec}s base=${vd.lead_with} ritmo=${vd.pace} ` +
        `image_query=${vd.image_query || '(ninguna → imagen de la noticia)'} ` +
        `clip_queries=[${vd.clip_queries.join(' | ')}]`
    );

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

    // 4. El video YA NO se renderiza automáticamente aquí. Antes este paso encolaba
    // un render "fantasma" en el Go Engine apenas se procesaba la noticia (con
    // `generateVideo: true`), sin que ninguna parte de la UI consumiera su resultado
    // (video_job_id/video_status se guardaban pero nada hacía polling ni lo mostraba).
    // Eso producía un render real e independiente del que después dispara el botón
    // "Descargar Video (.mp4)" (/api/render-video), con selección de clip aleatoria
    // (sin seed) en vez de determinística — dos pipelines corriendo a ciegas para la
    // misma noticia, con resultados que no coincidían entre sí. Ahora el único render
    // por noticia es el explícito del botón de descarga.
    const videoStatus: 'none' | 'rendering' | 'ready' | 'failed' = 'none';

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
      // Capa 2: se persiste la dirección de composición generada/saneada en Capa 1.
      // Todavía nadie la consume para renderizar (eso es Capa 3).
      video_direction: editorial.video_direction,
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
      editorial,
    });
  } catch (error: any) {
    console.error('[Pipeline ERROR]:', error);
    return NextResponse.json({ error: error.message || 'Error en el pipeline editorial' }, { status: 500 });
  }
}
