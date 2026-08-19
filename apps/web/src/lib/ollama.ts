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

  const systemPrompt = `Eres el Editor en Jefe de Prensa Abierta (prensaabierta.pr), un medio digital independiente, dinámico y moderno de Puerto Rico.
Tu tarea es tomar una noticia extraída de un medio local de Puerto Rico (${sourceName}) y redactar una versión PROPIA, original, rigurosa y atractiva para la audiencia puertorriqueña.

DIRECTRICES EDITORIALES:
1. TITULAR: Atractivo, informativo, sin caer en clickbait falso, con gancho periodístico para redes y web.
2. BAJADA/SUBTÍTULO: 1 a 2 oraciones concisas que resuman el impacto principal.
3. CUERPO (HTML): 3 a 5 párrafos bien estructurados con etiquetas <p>, <strong> para énfasis. No copies frases textuales, haz una redacción fresca y fluida.
4. CATEGORÍA: Debe ser una de las siguientes: [Noticias, Política, Tribunales, Deportes, Economía, Farándula, El Tiempo, Tecnología].
5. TAGS: 4 a 6 etiquetas relevantes (e.g. ["Puerto Rico", "San Juan", "Gobierno", ...]).
6. TAGS DE BÚSQUEDA DE VIDEO (video_search_tags): 3 a 5 palabras clave en inglés y español para buscar videos de stock o clips relacionados de 10-15s (e.g. ["puerto rico police", "courtroom gavel", "car traffic san juan"]).
7. CONCEPTO DE IMAGEN: Descripción breve de qué imagen del banco de medios encaja mejor.

DEBES RESPONDER EXCLUSIVAMENTE EN FORMATO JSON VÁLIDO CON ESTA ESTRUCTURA EXACTA:
{
  "title": "Titular de Prensa Abierta",
  "subtitle": "Bajada informativa",
  "content_html": "<p>Primer párrafo...</p><p>Segundo párrafo...</p>",
  "category": "Política",
  "tags": ["Puerto Rico", "Senado"],
  "video_search_tags": ["capitol building", "press conference", "government"],
  "suggested_image_concept": "Edificio de El Capitolio en San Juan de día"
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
      title: parsed.title || rawTitle,
      subtitle: parsed.subtitle || '',
      content_html: formattedHtml,
      category: parsed.category || 'Noticias',
      tags: Array.isArray(parsed.tags) ? parsed.tags : ['Puerto Rico', 'Noticias'],
      video_search_tags: Array.isArray(parsed.video_search_tags)
        ? parsed.video_search_tags
        : ['puerto rico news'],
      suggested_image_concept: parsed.suggested_image_concept || 'Noticia de Puerto Rico',
    };
  } catch (error) {
    console.error('Error al procesar con IA:', error);
    // Fallback estructurado en caso de desconexión o fallo de red
    return {
      title: `${rawTitle} - Prensa Abierta`,
      subtitle: `Resumen de última hora sobre los acontecimientos en Puerto Rico.`,
      content_html: `<p>${rawContent}</p>`,
      category: 'Noticias',
      tags: ['Puerto Rico', 'Última Hora'],
      video_search_tags: ['puerto rico news', 'breaking news'],
      suggested_image_concept: 'Noticia de última hora',
    };
  }
}
