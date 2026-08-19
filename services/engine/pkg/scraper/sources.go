package scraper

import "github.com/prensa-abierta/ingestor-engine/pkg/models"

// GetDefaultPRSources returns the configured Puerto Rico major news outlets
func GetDefaultPRSources() []models.Source {
	return []models.Source{
		{
			ID:          "el-nuevo-dia",
			Name:        "El Nuevo Día",
			BaseURL:     "https://www.elnuevodia.com",
			RSSURL:      "https://www.elnuevodia.com/arc/outboundfeeds/rss/?outputType=xml",
			Category:    "General",
			Enabled:     true,
			PollMinutes: 3,
		},
		{
			ID:          "primera-hora",
			Name:        "Primera Hora",
			BaseURL:     "https://www.primerahora.com",
			RSSURL:      "https://www.primerahora.com/arc/outboundfeeds/rss/?outputType=xml",
			Category:    "General",
			Enabled:     true,
			PollMinutes: 3,
		},
		{
			ID:          "el-vocero",
			Name:        "El Vocero de Puerto Rico",
			BaseURL:     "https://www.elvocero.com",
			RSSURL:      "https://www.elvocero.com/search/?f=rss&t=article&c=noticias*&l=50&s=start_time&sd=desc",
			Category:    "General",
			Enabled:     true,
			PollMinutes: 5,
		},
		{
			ID:          "noticel",
			Name:        "NotiCel",
			BaseURL:     "https://www.noticel.com",
			RSSURL:      "https://www.noticel.com/arc/outboundfeeds/rss/?outputType=xml",
			Category:    "Investigación & Política",
			Enabled:     true,
			PollMinutes: 5,
		},
		{
			ID:          "metro-pr",
			Name:        "Metro Puerto Rico",
			BaseURL:     "https://www.metro.pr",
			RSSURL:      "https://www.metro.pr/arc/outboundfeeds/rss/?outputType=xml",
			Category:    "Nacional",
			Enabled:     true,
			PollMinutes: 5,
		},
	}
}
