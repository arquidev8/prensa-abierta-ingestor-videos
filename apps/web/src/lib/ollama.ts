import { sanitizeBrandVoice } from './sanitizer';
import { generateAutonomousEditorial } from './rewriter';

export interface EditorialRewriteResult {
  title: string;
  subtitle: string;
  content_html: string;
  category: string;
  tags: string[];
  video_search_tags: string[];
  suggested_image_concept: string;
}

export interface OllamaConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export async function rewriteNewsWithOllamaCloud(
  rawTitle: string,
  rawContent: string,
  sourceName: string,
  config?: OllamaConfig
): Promise<EditorialRewriteResult> {
  const baseUrl =
    config?.baseUrl ||
    process.env.OLLAMA_CLOUD_BASE_URL ||
    'https://api.siliconflow.cn/v1'; // Compatible con Ollama Cloud / SiliconFlow / OpenAI

  const apiKey =
    config?.apiKey ||
    process.env.OLLAMA_CLOUD_API_KEY ||
    'c9885517759f4cce8642c322a5dd1c88.t2y6QnLerXa-kK-BcuvAUYFu';

  let model = config?.model || process.env.OLLAMA_MODEL || 'THUDM/glm-4-9b-chat';

  // Normalización de nombres de modelos para SiliconFlow / Ollama Cloud
  if (model === 'glm-5.2' || model === 'glm-4' || model === 'glm') {
    model = 'THUDM/glm-4-9b-chat';
  } else if (model === 'minimax-m3' || model === 'minimax') {
    model = 'minimax/MiniMax-Text-01';
  } else if (model.includes('qwen') && !model.includes('/')) {
    model = 'Qwen/Qwen2.5-72B-Instruct';
  }

  const systemPrompt = `Eres el Editor en Jefe de Prensa Abierta (prensaabierta.pr), medio digital líder en Puerto Rico.

⚠️ PROTOCOLO ESTRICTO DE PROTECCIÓN LEGAL Y DERECHOS DE AUTOR:
1. PROHIBICIÓN TOTAL DE PLAGIO Y COPIA TEXTUAL: Está TERMINANTEMENTE PROHIBIDO copiar oraciones textuales, frases idénticas, estructuras o giros lingüísticos del medio original (${sourceName}). La copia literal o el parafraseo cercano constituye una violación de derechos de autor y está penado por la ley.
2. REESCRITURA 100% ORIGINAL DESDE CERO: Tu labor periodística consiste en extraer ÚNICAMENTE los HECHOS CRUDOS (qué ocurrió, quiénes están involucrados, lugares de Puerto Rico, cifras, fechas y medidas oficiales) y REDACTAR UN ARTÍCULO COMPLETAMENTE NUEVO con la voz, estilo, vocabulario y estructura propia de Prensa Abierta.
3. AISLAMIENTO TOTAL DE MARCA: NUNCA menciones nombres de medios de la competencia (El Nuevo Día, Primera Hora, El Vocero, NotiCel, Metro PR, Telenoticias, Telemundo, WAPA, Univision, etc.) ni a periodistas o reporteros ajenos. El artículo debe leerse como una cobertura propia de Prensa Abierta.

ESTRUCTURA DE PUBLICACIÓN REQUERIDA:

1. RAMA WEB (Para publicar en WordPress - prensaabierta.pr):
   - TITULAR WEB: Titular nuevo, original y con gancho periodístico de Prensa Abierta.
   - SUBTÍTULO / BAJADA: 1 a 2 oraciones concisas que amplíen el ángulo principal.
   - CUERPO COMPLETO (HTML): Escribe un ARTÍCULO COMPLETO Y EXTENSO de 4 a 6 PÁRRAFOS bien desarrollados. Cada párrafo debe estar encerrado en su propia etiqueta <p> con interlineado fluido. Usa <strong> para resaltar datos, cifras y nombres clave. Desarrolla a fondo el contexto, antecedentes, impacto en la ciudadanía de Puerto Rico y próximos pasos.
   - CATEGORÍA: [Noticias, Política, Tribunales, Deportes, Economía, Farándula, El Tiempo, Tecnología].
   - TAGS: 5 a 8 etiquetas relevantes para WordPress (e.g. ["Puerto Rico", "Calor Extremo", "Meteorología"]).

2. RAMA REDES SOCIALES & VIDEO VERTICAL (Reels / TikTok / Shorts):
   - VIDEO HEADLINE: Titular de impacto visual de máximo 10-12 palabras para el rótulo del video 9:16.
   - VIDEO CAPTION: Resumen de 1-2 oraciones para el copy de redes sociales.
   - VIDEO SEARCH TAGS: 3 a 5 palabras clave de búsqueda de video.

DEBES RESPONDER EXCLUSIVAMENTE EN FORMATO JSON VÁLIDO CON ESTA ESTRUCTURA EXACTA:
{
  "title": "Titular 100% original de Prensa Abierta",
  "subtitle": "Bajada informativa original",
  "content_html": "<p>Primer párrafo con el gancho periodístico y los hechos principales...</p><p>Segundo párrafo detallando el contexto, antecedentes y datos...</p><p>Tercer párrafo con declaraciones o explicaciones de las autoridades...</p><p>Cuarto párrafo detallando el impacto en los municipios o la población...</p><p>Quinto párrafo de desenlace y recomendaciones...</p>",
  "category": "El Tiempo",
  "tags": ["Puerto Rico", "Aviso de Calor", "Servicio Nacional de Meteorología"],
  "video_headline": "Titular de impacto para video",
  "video_caption": "Texto breve para el cintillo de Reels",
  "video_search_tags": ["puerto rico weather", "heat wave", "sun tropics"],
  "suggested_image_concept": "Mapa de calor o sol intenso sobre Puerto Rico"
}`;

  const userPrompt = `NOTICIA ORIGINAL DE ${sourceName}:
TITULAR: ${rawTitle}
CONTENIDO:
${rawContent}

Genera la redacción editorial para Prensa Abierta en formato JSON.`;

  try {
    const endpoint = baseUrl.endsWith('/chat/completions')
      ? baseUrl
      : `${baseUrl.replace(/\/$/, '')}/chat/completions`;

    console.log(`[IA Client] Llamando a ${endpoint} con modelo: ${model}`);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Error en API IA (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const contentStr = data.choices?.[0]?.message?.content || '{}';

    // Parse JSON
    const parsed = JSON.parse(contentStr);

    let formattedHtml = parsed.content_html || rawContent;
    if (!formattedHtml.includes('<p>')) {
      formattedHtml = formattedHtml
        .split('\n\n')
        .map((p: string) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
        .join('');
    }

    return {
      title: sanitizeBrandVoice(parsed.title || rawTitle),
      subtitle: sanitizeBrandVoice(parsed.subtitle || ''),
      content_html: sanitizeBrandVoice(formattedHtml),
      category: parsed.category || 'Noticias',
      tags: Array.isArray(parsed.tags) ? parsed.tags : ['Puerto Rico', 'Noticias'],
      video_search_tags: Array.isArray(parsed.video_search_tags)
        ? parsed.video_search_tags
        : ['puerto rico news'],
      suggested_image_concept: parsed.suggested_image_concept || 'Noticia de Puerto Rico',
    };
  } catch (error) {
    console.warn('Conexión remota con IA no disponible o token inválido. Activando Motor Autónomo Editorial de Prensa Abierta...', error);
    return generateAutonomousEditorial(rawTitle, rawContent, sourceName);
  }
}
