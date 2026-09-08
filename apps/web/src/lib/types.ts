import type { VideoDirection } from './videoDirection';

export type { VideoDirection };

export interface RawNews {
  id: string;
  source_id: string;
  source_name: string;
  original_url: string;
  title: string;
  summary: string;
  content: string;
  author?: string;
  image_url?: string;
  published_at: string;
  ingested_at: string;
  category?: string;
  status: 'pending' | 'processing' | 'processed' | 'rejected';
  hash: string;
}

export interface ProcessedNews {
  id: string;
  raw_news_id: string;
  title: string;
  subtitle: string;
  content_html: string;
  category: string;
  tags: string[];
  video_search_tags: string[];
  /** Decisiones de composición del Reel 9:16. Opcional: noticias procesadas
   *  antes de esta feature no lo traen (Capa 3 cae a los defaults). */
  video_direction?: VideoDirection;
  featured_image_url?: string;
  wordpress_post_id?: number;
  wordpress_url?: string;
  video_status: 'none' | 'rendering' | 'ready' | 'failed';
  video_url?: string;
  created_at: string;
  published_at?: string;
  status: 'draft' | 'published' | 'scheduled';
}

export interface VideoJob {
  id: string;
  request: {
    news_id: string;
    headline: string;
    category: string;
    clip_urls: string[];
    duration_sec: number;
    resolution: string;
    show_logo: boolean;
    headline_style: string;
  };
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  output_path?: string;
  output_url?: string;
  error?: string;
  created_at: string;
  completed_at?: string;
}

export interface MediaItem {
  id: string;
  type: 'image' | 'video';
  title: string;
  url: string;
  thumbnail?: string;
  category: string;
  tags: string[];
  duration_sec?: number;
  width: number;
  height: number;
  created_at: string;
}

export interface AIModelConfig {
  provider: 'ollama_cloud';
  baseUrl: string;
  apiKey: string;
  model: string; // e.g. 'qwen2.5:72b', 'glm-4', 'minimax', 'mistral-large'
  temperature: number;
}
