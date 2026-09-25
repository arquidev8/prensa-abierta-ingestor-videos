package scraper

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"

	"github.com/prensa-abierta/ingestor-engine/pkg/models"
)

const (
	// Ancho mínimo que se busca para la imagen de la card: ~2x el ancho real de la
	// card (~340 px) para que se vea nítida en pantallas retina, sin traer la
	// imagen original (que en La Perla del Sur pesa 3 veces más).
	wpTargetWidth = 600
	// Notas que se piden por petición: en el ciclo normal alcanzan las que trae el
	// RSS (10); el backfill de notas ya guardadas pide el máximo de la API (100).
	wpPollPerPage     = 20
	wpBackfillPerPage = 100
	wpMaxResponseSize = 8 << 20
)

// Tamaños estándar de WordPress (sin recorte), en orden de preferencia.
var wpStandardSizes = []string{"medium_large", "large"}

type wpSize struct {
	Width     int    `json:"width"`
	SourceURL string `json:"source_url"`
}

type wpMedia struct {
	SourceURL    string `json:"source_url"`
	MediaDetails struct {
		Width int               `json:"width"`
		Sizes map[string]wpSize `json:"sizes"`
	} `json:"media_details"`
}

type wpPost struct {
	Link     string `json:"link"`
	Embedded struct {
		Media []wpMedia `json:"wp:featuredmedia"`
	} `json:"_embedded"`
}

// pickWordPressImage elige, de las variantes que WordPress ya generó para la
// imagen destacada, la más liviana que todavía cubre wpTargetWidth; si ninguna
// llega a ese ancho, la más grande disponible. Prefiere los tamaños estándar
// (medium_large, large), que no recortan la imagen.
func pickWordPressImage(m wpMedia) string {
	for _, name := range wpStandardSizes {
		if s, ok := m.MediaDetails.Sizes[name]; ok && s.SourceURL != "" && s.Width >= wpTargetWidth {
			return s.SourceURL
		}
	}

	candidates := make([]wpSize, 0, len(m.MediaDetails.Sizes)+1)
	for _, s := range m.MediaDetails.Sizes {
		if s.SourceURL != "" && s.Width > 0 {
			candidates = append(candidates, s)
		}
	}
	if m.SourceURL != "" && m.MediaDetails.Width > 0 {
		candidates = append(candidates, wpSize{Width: m.MediaDetails.Width, SourceURL: m.SourceURL})
	}
	if len(candidates) == 0 {
		return m.SourceURL
	}
	// Orden estable (ancho, URL): el resultado no depende del orden de un map.
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].Width != candidates[j].Width {
			return candidates[i].Width < candidates[j].Width
		}
		return candidates[i].SourceURL < candidates[j].SourceURL
	})
	for _, c := range candidates {
		if c.Width >= wpTargetWidth {
			return c.SourceURL
		}
	}
	return candidates[len(candidates)-1].SourceURL
}

// WordPressFeaturedImages pide a la API REST de un WordPress las últimas `perPage`
// notas con su imagen destacada y devuelve, por link de la nota (models.LinkKey
// sin medio), la URL de la variante elegida por pickWordPressImage.
func (r *ImageResolver) WordPressFeaturedImages(baseURL string, perPage int) (map[string]string, error) {
	endpoint := fmt.Sprintf("%s/wp-json/wp/v2/posts?per_page=%d&_embed=wp:featuredmedia&_fields=link,featured_media,_embedded,_links",
		strings.TrimRight(baseURL, "/"), perPage)

	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", browserUserAgent)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Accept-Language", "es-PR,es;q=0.9")

	resp, err := r.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, httpStatusError(resp)
	}

	var posts []wpPost
	if err := json.NewDecoder(io.LimitReader(resp.Body, wpMaxResponseSize)).Decode(&posts); err != nil {
		return nil, fmt.Errorf("respuesta que no es JSON de WordPress: %w", err)
	}

	images := make(map[string]string, len(posts))
	for _, p := range posts {
		if len(p.Embedded.Media) == 0 {
			continue
		}
		key := models.LinkKey("", p.Link)
		if key == "" {
			continue
		}
		if u := pickWordPressImage(p.Embedded.Media[0]); u != "" {
			images[key] = u
		}
	}
	return images, nil
}
