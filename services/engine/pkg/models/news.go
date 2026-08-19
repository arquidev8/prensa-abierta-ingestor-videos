package models

import "time"

// Source represents a Puerto Rico news outlet
type Source struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	BaseURL     string `json:"base_url"`
	RSSURL      string `json:"rss_url"`
	Category    string `json:"category"`
	Enabled     bool   `json:"enabled"`
	PollMinutes int    `json:"poll_minutes"`
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
}

// ProcessedNews represents the AI-rewritten article for Prensa Abierta
type ProcessedNews struct {
	ID               string    `json:"id"`
	RawNewsID        string    `json:"raw_news_id"`
	Title            string    `json:"title"`
	Subtitle         string    `json:"subtitle"`
	ContentHTML      string    `json:"content_html"`
	Category         string    `json:"category"`
	Tags             []string  `json:"tags"`
	VideoSearchTags  []string  `json:"video_search_tags"`
	FeaturedImageURL string    `json:"featured_image_url,omitempty"`
	WordPressPostID  int       `json:"wordpress_post_id,omitempty"`
	WordPressURL     string    `json:"wordpress_url,omitempty"`
	VideoStatus      string    `json:"video_status"` // "none", "rendering", "ready", "failed"
	VideoURL         string    `json:"video_url,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
	PublishedAt      time.Time `json:"published_at,omitempty"`
	Status           string    `json:"status"` // "draft", "published", "scheduled"
}

// VideoRenderRequest represents the payload to assemble a 10-15s vertical video
type VideoRenderRequest struct {
	NewsID        string   `json:"news_id"`
	Headline      string   `json:"headline"`
	Category      string   `json:"category"`
	ClipURLs      []string `json:"clip_urls"`     // 2-3 clip paths or URLs
	DurationSec   int      `json:"duration_sec"`  // usually 12-15s
	MusicTrack    string   `json:"music_track"`   // optional preset or custom audio path
	Resolution    string   `json:"resolution"`    // "1080x1920" (vertical 9:16)
	ShowLogo      bool     `json:"show_logo"`     // true to overlay Prensa Abierta logo
	HeadlineStyle string   `json:"headline_style"` // "lower_third", "banner", "center"
}

// VideoJob represents an asynchronous video rendering task
type VideoJob struct {
	ID          string              `json:"id"`
	Request     VideoRenderRequest  `json:"request"`
	Status      string              `json:"status"` // "queued", "processing", "completed", "failed"
	Progress    int                 `json:"progress"` // 0-100%
	OutputPath  string              `json:"output_path,omitempty"`
	OutputURL   string              `json:"output_url,omitempty"`
	Error       string              `json:"error,omitempty"`
	CreatedAt   time.Time           `json:"created_at"`
	CompletedAt *time.Time          `json:"completed_at,omitempty"`
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
