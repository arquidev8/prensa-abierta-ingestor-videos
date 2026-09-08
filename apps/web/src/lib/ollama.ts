import { sanitizeBrandVoice } from './sanitizer';
import { generateAutonomousEditorial } from './rewriter';
import { sanitizeVideoSearchTags } from './pexels';
import { sanitizeVideoDirection, VideoDirection } from './videoDirection';

export interface EditorialRewriteResult {
  /** `ai` = lo redactó el modelo remoto; `autonomous` = el Motor Autónomo local. */
  source: 'ai' | 'autonomous';
  title: string;
  subtitle: string;
  content_html: string;
  category: string;
  tags: string[];
  video_search_tags: string[];
  suggested_image_concept: string;
  /** Decisiones de composición del Reel 9:16 (Capa 1: se genera y sanea aquí). */
  video_direction: VideoDirection;
}

export interface OllamaConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

// ── Serialización + reintentos de la API de IA ────────────────────────────────
// El plan de Ollama Cloud tiene un límite de concurrencia bajo: varias redacciones
// en paralelo (autopilot, o el usuario procesando en ráfaga) disparan
// `429 "too many concurrent requests"` y hoy eso cae directo al Motor Autónomo.
// Se encadenan de a una, con una pausa corta entre llamadas, y se reintenta con
// backoff ante 429/503 antes de rendirse.
let aiCallChain: Promise<unknown> = Promise.resolve();
const AI_CALL_SPACING_MS = 2000; // Ollama Pro: 1 request concurrente → espaciamos 2s entre llamadas

function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const result = aiCallChain.then(fn, fn);
  aiCallChain = result
    .catch(() => { })
    .then(() => new Promise((r) => setTimeout(r, AI_CALL_SPACING_MS)));
  return result;
}

async function fetchIaWithRetry(
  endpoint: string,
  init: RequestInit,
  maxAttempts = 5,
  timeoutMs = 60_000
): Promise<Response> {
  let lastRes: Response | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Timeout por intento: una redacción larga tarda 15-25s; si a los 60s no
    // respondió, se aborta y se cae al Motor Autónomo en vez de colgar el pipeline.
    const res = await fetch(endpoint, { ...init, signal: AbortSignal.timeout(timeoutMs) });

    // Ollama Cloud a veces devuelve "too many concurrent requests" con status 200
    // en lugar de 429. Se clona la respuesta para leer el body sin consumirlo.
    if (res.status === 429 || res.status === 503) {
      lastRes = res;
    } else if (res.status === 200) {
      // Peek al body: si contiene el error de concurrencia, tratar como 429.
      const clone = res.clone();
      let bodyText = '';
      try { bodyText = await clone.text(); } catch { /* ignore */ }
      if (bodyText.includes('too many concurrent requests')) {
        console.warn(`[IA Client] Ollama: too many concurrent requests (intento ${attempt}/${maxAttempts})`);
        lastRes = res;
      } else {
        // Respuesta 200 válida: devolver una Response reconstruida con el body ya leído.
        return new Response(bodyText, { status: res.status, headers: res.headers });
      }
    } else {
      return res;
    }

    if (attempt < maxAttempts) {
      const backoff = 3000 * 2 ** (attempt - 1); // 3s, 6s, 12s, 24s — Ollama Pro necesita tiempo
      console.warn(
        `[IA Client] Rate limit en API IA; reintento ${attempt}/${maxAttempts - 1} en ${backoff}ms`
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  return lastRes as Response;
}

/**
 * `JSON.parse` tolerante con la salida de los modelos: quita el bloque de código
 * markdown (```json … ```), texto antes/después del objeto y comas colgantes.
 * GLM-5.2 en Ollama envuelve el JSON en un fence pese a `response_format`.
 */
function parseModelJson(raw: string): any {
  let s = (raw || '').trim();

  // ```json … ```  |  ``` … ```
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) s = fenced[1].trim();

  // Recorta cualquier texto suelto fuera del objeto principal.
  if (!s.startsWith('{')) {
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first !== -1 && last > first) s = s.slice(first, last + 1);
  }

  try {
    return JSON.parse(s);
  } catch {
    // Último intento: quita comas colgantes antes de } o ].
    return JSON.parse(s.replace(/,\s*([}\]])/g, '$1'));
  }
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
    'https://ollama.com/v1'; // Compatible con Ollama Cloud / SiliconFlow / OpenAI

  const apiKey =
    config?.apiKey ||
    process.env.OLLAMA_CLOUD_API_KEY;

  let model = config?.model || process.env.OLLAMA_MODEL || 'glm-5.2';

  // Alias heredados → tags reales de Ollama Cloud (https://ollama.com/search?c=cloud).
  // Los valores que ya manda la UI ('glm-5.2', 'minimax-m3', 'qwen2.5:72b') son tags
  // válidos de Ollama Cloud y pasan sin tocar; acá solo se mapean nombres viejos/cortos.
  if (model === 'glm-4' || model === 'glm') {
    model = 'glm-5.2';
  } else if (model === 'minimax') {
    model = 'minimax-m3';
  } else if (model === 'qwen' || model === 'qwen2.5:72b' || (model.toLowerCase().includes('qwen') && model.includes('/'))) {
    model = 'qwen3.5:397b';
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
   - VIDEO SEARCH TAGS: 3 a 5 palabras clave de búsqueda de video que describan ÚNICAMENTE elementos visuales neutros (paisajes, objetos, acciones, lugares de Puerto Rico). PROHIBIDO usar "breaking news", "news anchor", "news studio", "broadcast" o cualquier frase que traiga b-roll con gráficos de noticiero ajenos incrustados.

3. DIRECCIÓN DE VIDEO (cómo debe armarse la pieza 9:16):
   - TEMPLATE: "standard" (uso general), "reels-safe" (cuando el titular es largo o hay mucho texto en pantalla) o "app-promo" (solo si la noticia invita a descargar la app o es contenido de servicio/comunidad).
   - DURATION_SEC: entero entre 8 y 18 según la densidad de la noticia (breve = 8-10, con contexto = 12-15).
   - LEAD_WITH: "image" si el mejor recurso visual es una foto concreta (un mapa, un rostro, un lugar); "video" si conviene abrir con b-roll en movimiento.
   - PACE: "urgente" (sucesos, clima severo, tribunales), "neutral" (informativo general) o "reposado" (análisis, cultura, comunidad).
   - IMAGE_QUERY: 2-5 palabras en inglés para buscar la FOTO líder (elemento visual neutro y específico del tema).
   - CLIP_QUERIES: 2-4 búsquedas de b-roll en inglés, EN ORDEN DE PRIORIDAD, mismas reglas que VIDEO SEARCH TAGS.
   - HEADLINE_STYLE: "banner" (rótulo inferior sólido, por defecto), "lower_third" (franja baja discreta) o "center" (titular centrado, para frases muy cortas).

DEBES RESPONDER EXCLUSIVAMENTE CON EL OBJETO JSON CRUDO, SIN NADA MÁS: sin bloques de código markdown (nada de \`\`\` ni \`\`\`json), sin texto de introducción ni de cierre, sin comentarios. El primer carácter de tu respuesta debe ser "{" y el último "}". ESTRUCTURA EXACTA:
{
  "title": "Titular 100% original de Prensa Abierta",
  "subtitle": "Bajada informativa original",
  "content_html": "<p>Primer párrafo con el gancho periodístico y los hechos principales...</p><p>Segundo párrafo detallando el contexto, antecedentes y datos...</p><p>Tercer párrafo con declaraciones o explicaciones de las autoridades...</p><p>Cuarto párrafo detallando el impacto en los municipios o la población...</p><p>Quinto párrafo de desenlace y recomendaciones...</p>",
  "category": "El Tiempo",
  "tags": ["Puerto Rico", "Aviso de Calor", "Servicio Nacional de Meteorología"],
  "video_headline": "Titular de impacto para video",
  "video_caption": "Texto breve para el cintillo de Reels",
  "video_search_tags": ["puerto rico weather", "heat wave", "sun tropics"],
  "suggested_image_concept": "Mapa de calor o sol intenso sobre Puerto Rico",
  "video_direction": {
    "headline": "Titular corto para el rótulo 9:16",
    "caption": "Copy breve para redes",
    "template": "standard",
    "duration_sec": 12,
    "lead_with": "video",
    "pace": "urgente",
    "image_query": "heat map puerto rico",
    "clip_queries": ["tropical sun heat", "puerto rico coastline", "city street hot day"],
    "headline_style": "banner"
  }
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

    const requestInit: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    };

    // Serializado: una llamada a la vez, con reintento ante 429/503.
    const res = await runSerialized(() => {
      console.log(`[IA Client] Llamando a ${endpoint} con modelo: ${model}`);
      return fetchIaWithRetry(endpoint, requestInit);
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Error en API IA (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const contentStr = data.choices?.[0]?.message?.content || '{}';

    // Parse tolerante: los modelos suelen envolver el JSON en ```json … ```.
    const parsed = parseModelJson(contentStr);

    let formattedHtml = parsed.content_html || rawContent;
    if (!formattedHtml.includes('<p>')) {
      formattedHtml = formattedHtml
        .split('\n\n')
        .map((p: string) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
        .join('');
    }

    const category = parsed.category || 'Noticias';
    // Guardrail: sanea los tags aunque la IA ignore la instrucción del prompt
    const videoSearchTags = sanitizeVideoSearchTags(
      Array.isArray(parsed.video_search_tags) ? parsed.video_search_tags : ['puerto rico', 'ultimas noticias']
    );
    const suggestedImageConcept = parsed.suggested_image_concept || 'Noticia de Puerto Rico';

    // La IA puede mandar la dirección anidada en `video_direction` o suelta
    // (`video_headline` / `video_caption`); se acepta cualquiera y se sanea.
    const rawDirection: Record<string, unknown> = {
      source: 'ai',
      headline: parsed.video_headline,
      caption: parsed.video_caption,
      ...(parsed.video_direction && typeof parsed.video_direction === 'object'
        ? parsed.video_direction
        : {}),
    };
    // Si la IA no puso `image_query` en la dirección pero sí un concepto de
    // imagen, se usa como query de la foto líder.
    if (!rawDirection.image_query && parsed.suggested_image_concept) {
      rawDirection.image_query = parsed.suggested_image_concept;
    }

    return {
      source: 'ai',
      title: sanitizeBrandVoice(parsed.title || rawTitle),
      subtitle: sanitizeBrandVoice(parsed.subtitle || ''),
      content_html: sanitizeBrandVoice(formattedHtml),
      category,
      tags: Array.isArray(parsed.tags) ? parsed.tags : ['Puerto Rico', 'Noticias'],
      video_search_tags: videoSearchTags,
      suggested_image_concept: suggestedImageConcept,
      video_direction: sanitizeVideoDirection(rawDirection, {
        fallbackHeadline: sanitizeBrandVoice(parsed.title || rawTitle),
        category,
        videoSearchTags,
      }),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(
      `[IA] Falló la redacción remota (${msg}). Usando Motor Autónomo Editorial de Prensa Abierta.`
    );
    return generateAutonomousEditorial(rawTitle, rawContent, sourceName);
  }
}
