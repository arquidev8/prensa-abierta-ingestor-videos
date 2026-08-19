export interface WordPressConfig {
  baseUrl?: string;
  username?: string;
  applicationPassword?: string;
}

export interface PublishPostPayload {
  title: string;
  content: string;
  excerpt?: string;
  status?: 'publish' | 'draft' | 'future';
  categories?: number[];
  tags?: number[];
  featuredMediaId?: number;
}

export interface WordPressPostResponse {
  id: number;
  link: string;
  title: { rendered: string };
  status: string;
}

export async function publishToWordPress(
  payload: PublishPostPayload,
  config?: WordPressConfig
): Promise<WordPressPostResponse> {
  const isDryRun = process.env.WP_DRY_RUN !== 'false'; // Por defecto SIEMPRE en modo seguro de prueba

  if (isDryRun || !config?.applicationPassword && !process.env.WP_APPLICATION_PASSWORD) {
    console.log(`[WordPress Sandbox 🛡️] Modo de pruebas activo. Simulación de publicación para: "${payload.title}" (No se inyecta en producción)`);
    return {
      id: Math.floor(Math.random() * 10000) + 1000,
      link: `https://prensaabierta.pr/preview/simulado-${encodeURIComponent(payload.title.toLowerCase().replace(/ /g, '-').slice(0, 40))}`,
      title: { rendered: payload.title },
      status: 'sandbox_preview',
    };
  }

  const baseUrl = config?.baseUrl || process.env.WP_BASE_URL || 'https://prensaabierta.pr';
  const username = config?.username || process.env.WP_USERNAME || '';
  const appPassword = config?.applicationPassword || process.env.WP_APPLICATION_PASSWORD || '';

  const endpoint = `${baseUrl.replace(/\/$/, '')}/wp-json/wp/v2/posts`;
  const authHeader = 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64');

  const body: Record<string, any> = {
    title: payload.title,
    content: payload.content,
    status: payload.status || 'draft',
  };

  if (payload.excerpt) body.excerpt = payload.excerpt;
  if (payload.categories && payload.categories.length > 0) body.categories = payload.categories;
  if (payload.tags && payload.tags.length > 0) body.tags = payload.tags;
  if (payload.featuredMediaId) body.featured_media = payload.featuredMediaId;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`WordPress REST API error (${res.status}): ${err}`);
    }

    return await res.json();
  } catch (error) {
    console.error('Error publicando en WordPress:', error);
    return {
      id: 9999,
      link: `https://prensaabierta.pr/error`,
      title: { rendered: payload.title },
      status: 'error',
    };
  }
}
