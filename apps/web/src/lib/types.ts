import type { VideoDirection } from './videoDirection';

export type { VideoDirection };

/** Otro medio (de los ya scrapeados) que publicó, según el matcher léxico del
 * Engine, la misma noticia que un RawNews dado. Ver related_sources abajo. */
export interface RelatedSource {
  source_id: string;
  source_name: string;
  source_logo_url?: string;
  url: string;
  title: string;
  published_at: string;
  similarity: number; // 0..1
}

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
  /** Otros medios que publicaron la misma noticia. Ausente en noticias
   * ingeridas antes de esta feature hasta que corra el backfill del Engine. */
  related_sources?: RelatedSource[];
}

/** Un diario/medio configurado en el scraper del Engine (pkg/scraper/sources.go). */
export interface NewsSource {
  id: string;
  name: string;
  base_url: string;
  rss_url: string;
  category: string;
  enabled: boolean;
  poll_minutes: number;
  logo_url?: string;
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
  /** Ajustes granulares del "Editor de video" (tipografía, colores, posición,
   *  logo, banner) elegidos para ESTA noticia. Ausente = layout por defecto de
   *  la plantilla (ver VideoStyle abajo, mismos campos que en el Go Engine). */
  video_style?: VideoStyle;
  created_at: string;
  published_at?: string;
  status: 'draft' | 'published' | 'scheduled';
}

/** Overrides granulares del titular/caja/rótulo/logo/banner sobre el layout por
 *  defecto de una plantilla (ver layoutFor()/applyStyleOverrides() en el Go
 *  Engine, pkg/video/engine.go). Todos los campos son opcionales: "" / 0 /
 *  undefined = no tocar ese valor, se mantiene el default de la plantilla. */
export interface VideoStyle {
  headline_font?: 'league_spartan' | 'classic' | '';
  headline_font_size?: number; // 24-72
  headline_color?: string; // hex "#RRGGBB"
  headline_x?: number;
  headline_y?: number; // distancia desde el borde inferior del lienzo
  headline_line_spacing?: number;
  headline_align?: 'left' | 'center' | 'right';
  headline_text?: string; // titular editado con saltos de línea manuales opcionales

  box_color?: string; // hex
  box_opacity?: number; // 0-1
  box_height?: number;

  header_text?: string;
  header_color?: string; // hex

  show_logo?: boolean;
  logo_size?: number;
  logo_x?: number;
  logo_y?: number;

  show_promo?: boolean;
  promo_width?: number;

  // Dinamismo & Transiciones
  transition?: 'fade' | 'slide' | 'fadeblack' | 'cut';
  shot_count?: number; // 2, 3 o 4 tomas

  // Storyboard & Tomas individuales personalizadas por el usuario
  custom_shots?: CustomShot[];
}

export interface CustomShot {
  slot_index: number; // 0, 1, 2, 3
  media_kind: 'image' | 'video';
  url: string;
  name?: string;
  thumbnail?: string;
}

/** Un VideoStyle guardado con nombre para reutilizar en cualquier noticia
 *  (opcional: el usuario decide explícitamente "Guardar como preset"/"Aplicar
 *  preset" desde el Editor de video; nunca se auto-aplica). */
export interface VideoStylePreset {
  id: string;
  name: string;
  style: VideoStyle;
  created_at: string;
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
  /** Estado de la locución: 'ok', 'disabled' (sin API key), 'failed: …' o vacío (no se pidió). */
  voice_status?: string;
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
