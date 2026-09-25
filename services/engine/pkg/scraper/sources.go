package scraper

import (
	"fmt"

	"github.com/prensa-abierta/ingestor-engine/pkg/models"
)

// faviconURL arma la URL pública del favicon/logo de un dominio vía el servicio
// de favicons de Google (sin descargar/alojar ninguna imagen ni requerir
// credenciales). El frontend la consume directo en un <img src="...">.
func faviconURL(domain string) string {
	return fmt.Sprintf("https://www.google.com/s2/favicons?sz=128&domain=%s", domain)
}

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
			LogoURL:     faviconURL("www.elnuevodia.com"),
		},
		{
			ID:          "primera-hora",
			Name:        "Primera Hora",
			BaseURL:     "https://www.primerahora.com",
			RSSURL:      "https://www.primerahora.com/arc/outboundfeeds/rss/?outputType=xml",
			Category:    "General",
			Enabled:     true,
			PollMinutes: 3,
			LogoURL:     faviconURL("www.primerahora.com"),
		},
		{
			ID:          "el-vocero",
			Name:        "El Vocero de Puerto Rico",
			BaseURL:     "https://www.elvocero.com",
			// Sin filtro de sección a propósito: `c=noticias*` no coincide con ninguna sección
			// (las reales son actualidad, gobierno, ley-y-orden...) y, además, una URL que casi
			// nadie más pide no está en el caché del CDN de TownNews y el servidor de origen la
			// limita con 429. Esta es la URL estándar de sus lectores de RSS: sale de caché.
			RSSURL:      "https://www.elvocero.com/search/?f=rss&t=article&l=50&s=start_time&sd=desc",
			Category:    "General",
			Enabled:     true,
			PollMinutes: 5,
			LogoURL:     faviconURL("www.elvocero.com"),
		},
		{
			ID:          "noticel",
			Name:        "NotiCel",
			BaseURL:     "https://www.noticel.com",
			// NotiCel corre WordPress, no Arc: la ruta /arc/outboundfeeds/… no existe y su
			// WordPress responde 200 con un feed sin notas, así que nunca se ingirió nada.
			RSSURL:      "https://www.noticel.com/feed/",
			Category:    "Investigación & Política",
			Enabled:     true,
			PollMinutes: 5,
			LogoURL:     faviconURL("www.noticel.com"),
			// Solo 2 de cada 10 notas traen imagen en el RSS; el resto sale de su API REST.
			WordPressREST: true,
		},
		{
			ID:          "metro-pr",
			Name:        "Metro Puerto Rico",
			BaseURL:     "https://www.metro.pr",
			RSSURL:      "https://www.metro.pr/arc/outboundfeeds/rss/?outputType=xml",
			Category:    "Nacional",
			Enabled:     true,
			PollMinutes: 5,
			LogoURL:     faviconURL("www.metro.pr"),
		},
		// Medios agregados el 2026-09-24. Todas las URLs de RSS se verificaron a
		// mano con curl (200 + <item> reales) antes de agregarlas. NewsPR (sitio
		// propio sin RSS) y TeleOnce/Univision (403 a bots) quedaron fuera.
		{
			ID:          "la-perla-del-sur",
			Name:        "La Perla del Sur",
			BaseURL:     "https://www.periodicolaperla.com",
			RSSURL:      "https://www.periodicolaperla.com/feed/",
			Category:    "General",
			Enabled:     true,
			PollMinutes: 10,
			LogoURL:     faviconURL("www.periodicolaperla.com"),
			// Sus páginas de artículo responden 403 al Engine; su API REST de WordPress no.
			WordPressREST: true,
		},
		{
			ID:          "telemundo-pr",
			Name:        "Telemundo PR",
			BaseURL:     "https://www.telemundopr.com",
			RSSURL:      "https://www.telemundopr.com/noticias/feed/",
			Category:    "General",
			Enabled:     true,
			PollMinutes: 5,
			LogoURL:     faviconURL("www.telemundopr.com"),
		},
		{
			ID:          "wapa",
			Name:        "WAPA",
			BaseURL:     "https://wapa.tv",
			RSSURL:      "https://wapa.tv/search/?f=rss&t=article&l=50&s=start_time&sd=desc",
			Category:    "General",
			Enabled:     true,
			PollMinutes: 5,
			LogoURL:     faviconURL("wapa.tv"),
		},
		{
			ID:          "radio-isla",
			Name:        "Radio Isla 1320",
			BaseURL:     "https://radioisla.tv",
			RSSURL:      "https://radioisla.tv/feed/",
			Category:    "General",
			Enabled:     true,
			PollMinutes: 10,
			LogoURL:     faviconURL("radioisla.tv"),
		},
		{
			ID:          "el-calce",
			Name:        "El Calce",
			BaseURL:     "https://www.elcalce.com",
			RSSURL:      "https://www.elcalce.com/arc/outboundfeeds/rss/?outputType=xml",
			Category:    "General",
			Enabled:     true,
			PollMinutes: 10,
			LogoURL:     faviconURL("www.elcalce.com"),
		},
	}
}
