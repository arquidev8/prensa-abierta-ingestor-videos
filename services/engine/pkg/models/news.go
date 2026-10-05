package models

import (
	"net/url"
	"strings"
	"time"
)

// LinkKey identifica una nota de un medio por su link, ignorando query,
// fragmento, mayúsculas y "/" final. Sirve para no duplicar una nota cuando el
// medio le edita el titular (el hash titular+link cambia pero el link no).
// Devuelve "" si el link no sirve como identidad (vacío o solo el dominio).
func LinkKey(sourceID, link string) string {
	link = strings.TrimSpace(link)
	if link == "" {
		return ""
	}
	u, err := url.Parse(link)
	if err != nil || u.Host == "" {
		return ""
	}
	path := strings.TrimRight(strings.ToLower(u.Path), "/")
	if path == "" {
		return ""
	}
	return sourceID + "|" + strings.ToLower(u.Host) + path
}

// Source represents a Puerto Rico news outlet
type Source struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	BaseURL     string `json:"base_url"`
	RSSURL      string `json:"rss_url"`
	Category    string `json:"category"`
	Enabled     bool   `json:"enabled"`
	PollMinutes int    `json:"poll_minutes"`
	// LogoURL es el logo/favicon público del medio, usado por el frontend para
	// mostrar de qué diario viene cada noticia relacionada (ver RelatedSource).
	LogoURL string `json:"logo_url,omitempty"`
	// WordPressREST indica que el medio corre WordPress con la API REST abierta: la
	// imagen destacada de sus notas (ya en varios tamaños) se pide en UNA sola
	// petición por ciclo, en vez de leer la página de cada artículo (que algunos
	// medios, ej. La Perla del Sur, bloquean con un 403 al Engine).
	WordPressREST bool `json:"wordpress_rest,omitempty"`
}

// RelatedSource es OTRO medio (de los ya scrapeados) que publicó, a criterio del
// matcher léxico, la misma noticia que un RawNews dado. Se calcula y persiste al
// ingerir (ver pkg/matcher) — no es un cálculo en vivo en cada lectura.
type RelatedSource struct {
	SourceID      string    `json:"source_id"`
	SourceName    string    `json:"source_name"`
	SourceLogoURL string    `json:"source_logo_url,omitempty"`
	URL           string    `json:"url"`
	Title         string    `json:"title"`
	PublishedAt   time.Time `json:"published_at"`
	Similarity    float64   `json:"similarity"` // 0..1
}

// RawNews represents an ingested news item from a PR outlet
type RawNews struct {
	ID          string    `json:"id"`
	SourceID    string    `json:"source_id"`
	SourceName  string    `json:"source_name"`
	OriginalURL string    `json:"original_url"`
	Title       string    `json:"title"`
	Summary     string    `json:"summary"`
	Content     string    `json:"content"`
	Author      string    `json:"author,omitempty"`
	ImageURL    string    `json:"image_url,omitempty"`
	PublishedAt time.Time `json:"published_at"`
	IngestedAt  time.Time `json:"ingested_at"`
	Category    string    `json:"category,omitempty"`
	Status      string    `json:"status"` // "pending", "processing", "processed", "rejected"
	Hash        string    `json:"hash"`   // For deduplication
	// RelatedSources son otros medios (de los ya scrapeados) que publicaron la
	// misma noticia, según el matcher léxico. Opcional: las noticias ingeridas
	// antes de esta feature no lo traen hasta que corra el backfill.
	RelatedSources []RelatedSource `json:"related_sources,omitempty"`
}

// VideoDirection are the AI's (or autonomous engine's) COMPOSITION decisions for
// the 9:16 Reel, kept separate from the web copy. Generado y saneado en el front
// (apps/web/src/lib/videoDirection.ts); el Engine solo lo persiste y lo devuelve
// para que /api/render-video lo consuma. Todos los campos son opcionales: una
// noticia procesada antes de esta feature no lo trae.
type VideoDirection struct {
	Source        string   `json:"source,omitempty"` // "ai" | "autonomous"
	Headline      string   `json:"headline,omitempty"`
	Caption       string   `json:"caption,omitempty"`
	Template      string   `json:"template,omitempty"`     // "standard" | "reels-safe" | "app-promo"
	DurationSec   int      `json:"duration_sec,omitempty"` // 8-18
	LeadWith      string   `json:"lead_with,omitempty"`    // "image" | "video"
	Pace          string   `json:"pace,omitempty"`         // "urgente" | "neutral" | "reposado"
	ImageQuery    string   `json:"image_query,omitempty"`
	ClipQueries   []string `json:"clip_queries,omitempty"`
	HeadlineStyle string   `json:"headline_style,omitempty"` // "banner" | "lower_third" | "center"
}

// ProcessedNews represents the AI-rewritten article for Prensa Abierta
type ProcessedNews struct {
	ID               string          `json:"id"`
	RawNewsID        string          `json:"raw_news_id"`
	Title            string          `json:"title"`
	Subtitle         string          `json:"subtitle"`
	ContentHTML      string          `json:"content_html"`
	Category         string          `json:"category"`
	Tags             []string        `json:"tags"`
	VideoSearchTags  []string        `json:"video_search_tags"`
	VideoDirection   *VideoDirection `json:"video_direction,omitempty"`
	FeaturedImageURL string          `json:"featured_image_url,omitempty"`
	WordPressPostID  int             `json:"wordpress_post_id,omitempty"`
	WordPressURL     string          `json:"wordpress_url,omitempty"`
	VideoStatus      string          `json:"video_status"` // "none", "rendering", "ready", "failed"
	VideoURL         string          `json:"video_url,omitempty"`
	// VideoStyle guarda los ajustes granulares del Editor de video (tipografía,
	// colores, posición, logo, banner) elegidos para ESTA noticia puntual, para
	// que sobrevivan a cerrar y reabrir el modal. nil = sin overrides (layout por
	// defecto de la plantilla, igual que antes de esta feature).
	VideoStyle  *VideoStyle `json:"video_style,omitempty"`
	CreatedAt   time.Time   `json:"created_at"`
	PublishedAt time.Time   `json:"published_at,omitempty"`
	Status      string      `json:"status"` // "draft", "published", "scheduled"
}

// VideoRenderRequest represents the payload to assemble a 10-15s vertical video
type VideoRenderRequest struct {
	NewsID   string   `json:"news_id"`
	Headline string   `json:"headline"`
	Category string   `json:"category"`
	ClipURLs []string `json:"clip_urls"` // 2-3 clip paths or URLs
	ImageURL string   `json:"image_url"` // fallback: imagen destacada de la noticia si no hay clip de video
	// LeadImageURL, si está presente, se renderiza como PRIMER segmento del video
	// (imagen fija con zoom corto) seguido de los clips de ClipURLs — composición
	// "imagen temática + video". Si ClipURLs viene vacío, se anima toda la duración.
	LeadImageURL string  `json:"lead_image_url"`
	LeadImageSec float64 `json:"lead_image_sec"` // duración del segmento de imagen (default ~40% de DurationSec, tope 5s)
	// true = si ClipURLs viene vacío, NO buscar un clip de plantilla por categoría;
	// ir directo a imagen (con zoom) o color. Lo usa el frontend cuando identificó
	// un tema específico sin video propio en el banco.
	NoCategoryFallback bool   `json:"no_category_fallback"`
	DurationSec        int    `json:"duration_sec"`   // usually 12-15s
	MusicTrack         string `json:"music_track"`    // optional preset or custom audio path
	Resolution         string `json:"resolution"`     // "1080x1920" (vertical 9:16)
	ShowLogo           bool   `json:"show_logo"`      // true to overlay Prensa Abierta logo
	HeadlineStyle      string `json:"headline_style"` // "lower_third", "banner", "center"
	// Template de composición: "" / "standard" = layout por defecto; "reels-safe" =
	// plantilla optimizada para Instagram Reels (bloque de titular elevado a la safe
	// zone del grid 1:1, logo más separado del borde, interlineado compacto); "app-promo" =
	// igual a "standard" pero con el bloque de rótulo+titular subido y el banner
	// "Descarga la App GRATIS" (assets/logos/descargar-app-gratis.jpg) quemado a
	// 16px justo debajo de la última línea del titular (posición dinámica, ver
	// computePromoY() en pkg/video/engine.go — varía según cuántas líneas ocupe).
	// Ver .agents/formato-video-reel.md y layoutFor() en pkg/video/engine.go.
	Template string `json:"template"`
	// VoiceText es el guion de la locución (categoría + titular + arranque de la nota),
	// ya acotado por el frontend al tiempo del video. Si viene y ELEVENLABS_API_KEY está
	// configurada, el Engine lo convierte en voz (ElevenLabs) y la mezcla al .mp4.
	// Vacío = video mudo. Ver pkg/voice y applyVoiceover() en pkg/video/voiceover.go.
	VoiceText string `json:"voice_text"`
	// Style son los overrides granulares del Editor de video (tipografía, colores,
	// posición, logo, banner) sobre el layout de Template. nil = sin overrides,
	// el render sale IDÉNTICO al que había antes de esta feature. Ver
	// applyStyleOverrides() en pkg/video/engine.go.
	Style *VideoStyle `json:"style,omitempty"`
	// Transition ("fade", "slide", "fadeblack", "cut"): efecto de transición entre tomas
	Transition string `json:"transition,omitempty"`
}

// VideoStyle son los ajustes granulares del titular/logo/banner que el usuario
// puede editar en el Editor de video ANTES de descargar el .mp4, por encima del
// layout por defecto de Template (ver layoutFor() en pkg/video/engine.go). Todos
// los campos son opcionales ("" / 0 / nil = no tocar ese valor, se mantiene el
// default de la plantilla) para que un VideoRenderRequest sin Style, o con un
// Style parcial, rinda EXACTAMENTE igual que antes de esta feature.
// Los valores numéricos se validan/clampan server-side en sanitizeStyle() antes
// de construir cualquier filtro de FFmpeg (ver pkg/video/engine.go).
type VideoStyle struct {
	// Titular
	HeadlineFont        string  `json:"headline_font,omitempty"`         // "league_spartan" | "classic"
	HeadlineFontSize    int     `json:"headline_font_size,omitempty"`    // clamp 24-72
	HeadlineColor       string  `json:"headline_color,omitempty"`        // hex "#RRGGBB"
	HeadlineX           int     `json:"headline_x,omitempty"`
	HeadlineY           int     `json:"headline_y,omitempty"` // distancia desde el borde inferior del lienzo
	HeadlineLineSpacing int     `json:"headline_line_spacing,omitempty"`
	HeadlineAlign       string  `json:"headline_align,omitempty"` // "left" | "center" | "right"
	HeadlineText        string  `json:"headline_text,omitempty"`  // titular editado con saltos de línea manuales opcionales

	// Caja/fondo detrás del titular
	BoxColor   string  `json:"box_color,omitempty"` // hex
	BoxOpacity float64 `json:"box_opacity,omitempty"` // clamp 0-1
	BoxHeight  int     `json:"box_height,omitempty"`

	// Rótulo "ULTIMA HORA • CATEGORÍA"
	HeaderText  string `json:"header_text,omitempty"`
	HeaderColor string `json:"header_color,omitempty"` // hex

	// Logo Prensa Abierta
	ShowLogo *bool `json:"show_logo,omitempty"`
	LogoSize int   `json:"logo_size,omitempty"`
	LogoX    int   `json:"logo_x,omitempty"`
	LogoY    int   `json:"logo_y,omitempty"`

	// Banner "Descarga la App GRATIS"
	ShowPromo  *bool `json:"show_promo,omitempty"`
	PromoWidth int   `json:"promo_width,omitempty"`

	// Dinamismo & Transiciones
	Transition  string       `json:"transition,omitempty"`   // "fade", "slide", "fadeblack", "cut"
	ShotCount   int          `json:"shot_count,omitempty"`   // 2, 3, 4
	CustomShots []CustomShot `json:"custom_shots,omitempty"` // Tomas individuales personalizadas
}

// CustomShot representa un clip o imagen configurado para una toma concreta del Reel
type CustomShot struct {
	SlotIndex int    `json:"slot_index"` // 0, 1, 2, 3
	MediaKind string `json:"media_kind"` // "image" | "video"
	URL       string `json:"url"`
	Name      string `json:"name,omitempty"`
}

// VideoStylePreset es un VideoStyle guardado con nombre para reutilizar en
// cualquier noticia (opcional: el usuario decide explícitamente "Guardar como
// preset"/"Aplicar preset" desde el Editor de video; nunca se auto-aplica).
type VideoStylePreset struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Style     VideoStyle `json:"style"`
	CreatedAt time.Time  `json:"created_at"`
}

// VideoJob represents an asynchronous video rendering task
type VideoJob struct {
	ID         string             `json:"id"`
	Request    VideoRenderRequest `json:"request"`
	Status     string             `json:"status"`   // "queued", "processing", "completed", "failed"
	Progress   int                `json:"progress"` // 0-100%
	OutputPath string             `json:"output_path,omitempty"`
	OutputURL  string             `json:"output_url,omitempty"`
	Error      string             `json:"error,omitempty"`
	// VoiceStatus: "" (sin locución pedida), "ok", "disabled" (sin API key) o "failed: <motivo>".
	// Un fallo de voz NO falla el render: el video se entrega mudo.
	VoiceStatus string     `json:"voice_status,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
}

// MediaItem represents an image or stock video clip in the media bank
type MediaItem struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"` // "image" or "video"
	Title       string    `json:"title"`
	URL         string    `json:"url"`
	Thumbnail   string    `json:"thumbnail,omitempty"`
	Category    string    `json:"category"`
	Tags        []string  `json:"tags"`
	DurationSec float64   `json:"duration_sec,omitempty"` // For video clips
	Width       int       `json:"width"`
	Height      int       `json:"height"`
	CreatedAt   time.Time `json:"created_at"`
}
