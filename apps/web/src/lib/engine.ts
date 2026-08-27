import { RawNews, ProcessedNews, VideoJob, MediaItem } from './types';

// Este módulo solo corre en el servidor: usa ENGINE_INTERNAL_URL (sin prefijo NEXT_PUBLIC_)
// porque las variables NEXT_PUBLIC_* se incrustan en build-time en TODO el bundle,
// incluido el código de servidor, y por eso no sirven para un valor distinto en runtime.
const ENGINE_URL =
  process.env.ENGINE_INTERNAL_URL || process.env.NEXT_PUBLIC_ENGINE_URL || 'http://localhost:8085';

export async function fetchRawNews(): Promise<RawNews[]> {
  try {
    const res = await fetch(`${ENGINE_URL}/api/news/raw`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return data.items || [];
  } catch (err) {
    console.error('Error al consultar Go Engine (raw news):', err);
    return [];
  }
}

export async function fetchProcessedNews(): Promise<ProcessedNews[]> {
  try {
    const res = await fetch(`${ENGINE_URL}/api/news/processed`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return data.items || [];
  } catch (err) {
    console.error('Error al consultar Go Engine (processed news):', err);
    return [];
  }
}

export async function triggerManualPoll(): Promise<{ message: string }> {
  const res = await fetch(`${ENGINE_URL}/api/news/poll`, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`Go Engine respondió ${res.status} al iniciar el sondeo manual`);
  }
  return await res.json();
}

export async function saveProcessedNews(item: Partial<ProcessedNews>): Promise<ProcessedNews> {
  const res = await fetch(`${ENGINE_URL}/api/news/processed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  if (!res.ok) {
    throw new Error(`Go Engine respondió ${res.status} al guardar la noticia procesada`);
  }
  return await res.json();
}

export async function requestVideoRender(payload: {
  news_id: string;
  headline: string;
  category: string;
  clip_urls: string[];
  duration_sec?: number;
}): Promise<{ job_id: string; job: VideoJob }> {
  const res = await fetch(`${ENGINE_URL}/api/video/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Go Engine respondió ${res.status} al encolar el render de video`);
  }
  return await res.json();
}

export async function checkVideoJob(jobId: string): Promise<VideoJob> {
  const res = await fetch(`${ENGINE_URL}/api/video/jobs/${jobId}`);
  if (!res.ok) {
    throw new Error(`Go Engine respondió ${res.status} al consultar el trabajo de video`);
  }
  return await res.json();
}

export async function fetchMediaItems(category?: string, type?: string): Promise<MediaItem[]> {
  const params = new URLSearchParams();
  if (category) params.append('category', category);
  if (type) params.append('type', type);

  try {
    const res = await fetch(`${ENGINE_URL}/api/media?${params.toString()}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.items || [];
  } catch (err) {
    // No debe tumbar el pipeline: sin banco de medios se usa la imagen de la noticia original
    console.error('Error al consultar Go Engine (media items):', err);
    return [];
  }
}
