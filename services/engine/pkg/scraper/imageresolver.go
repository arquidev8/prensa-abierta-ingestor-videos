package scraper

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
)

const (
	articlePageTimeout  = 10 * time.Second
	articlePageMaxBytes = 1 << 20 // las <meta> viven en el <head>: no hace falta leer más de 1 MB
	// Pausa entre pedidos de páginas de artículos: varios medios (ej. WAPA) responden 429 a ráfagas.
	articleFetchGap = 300 * time.Millisecond
	// Algunos medios (ej. La Perla del Sur) devuelven 403 a un User-Agent mínimo.
	browserUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

// imageMetaSelectors se prueban en orden; el primero con un valor válido gana.
var imageMetaSelectors = []struct{ selector, attr string }{
	{`meta[property="og:image:secure_url"]`, "content"},
	{`meta[property="og:image"]`, "content"},
	{`meta[name="twitter:image"]`, "content"},
	{`meta[name="twitter:image:src"]`, "content"},
	{`link[rel="image_src"]`, "href"},
}

// placeholderImageRe descarta imágenes que son el logo o un reemplazo genérico
// del sitio (algunos medios lo publican como og:image de notas sin foto): una
// card con el logo del diario de fondo es peor que una card sin imagen.
var placeholderImageRe = regexp.MustCompile(`(?i)(logo|placeholder|default[-_]|no[-_]?image|avatar)`)

// ImageResolver busca la imagen principal de una nota en su propia página, para
// los medios cuyo RSS no la incluye (La Perla del Sur nunca; WAPA en ~70% de
// las notas).
type ImageResolver struct {
	client *http.Client
}

func NewImageResolver() *ImageResolver {
	return &ImageResolver{client: &http.Client{Timeout: articlePageTimeout}}
}

// Resolve devuelve la URL absoluta de la imagen principal (og:image y
// alternativas) de la página del artículo, o "" si no tiene una utilizable.
func (r *ImageResolver) Resolve(pageURL string) (string, error) {
	req, err := http.NewRequest(http.MethodGet, pageURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", browserUserAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	req.Header.Set("Accept-Language", "es-PR,es;q=0.9")

	resp, err := r.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", httpStatusError(resp)
	}

	doc, err := goquery.NewDocumentFromReader(io.LimitReader(resp.Body, articlePageMaxBytes))
	if err != nil {
		return "", err
	}
	// resp.Request.URL es la URL final tras redirecciones: base correcta para rutas relativas.
	return extractImageFromDoc(doc, resp.Request.URL), nil
}

// httpStatusError arma el error de una respuesta no exitosa. Distingue el
// desafío anti-bot de Cloudflare ("Just a moment"), que se resuelve cambiando
// cómo se hace la petición (ej. la versión de Go con que se compila el Engine
// altera su huella TLS) y no reintentando.
func httpStatusError(resp *http.Response) error {
	if resp.Header.Get("cf-mitigated") == "challenge" {
		return fmt.Errorf("HTTP %d (desafío anti-bot de Cloudflare)", resp.StatusCode)
	}
	return fmt.Errorf("HTTP %d", resp.StatusCode)
}

func extractImageFromDoc(doc *goquery.Document, base *url.URL) string {
	for _, s := range imageMetaSelectors {
		raw, ok := doc.Find(s.selector).First().Attr(s.attr)
		if !ok {
			continue
		}
		if img := normalizeImageURL(raw, base); img != "" {
			return img
		}
	}
	return ""
}

func normalizeImageURL(raw string, base *url.URL) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	if base != nil {
		u = base.ResolveReference(u)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return ""
	}
	if placeholderImageRe.MatchString(path.Base(u.Path)) {
		return ""
	}
	return u.String()
}

// ImageBackfillStore es lo que Backfill necesita del almacenamiento
// (lo implementa *storage.Store; es una interfaz para no acoplar scraper a storage).
type ImageBackfillStore interface {
	// RawNewsMissingImage devuelve, por URL original de la nota, los IDs guardados sin imagen
	// e ingeridos desde `since` (since cero = sin límite de antigüedad).
	RawNewsMissingImage(since time.Time) map[string][]string
	SetRawNewsImage(id, imageURL string) bool
}

// Backfill recupera la imagen de las notas ya guardadas que quedaron sin ella.
// Pide cada página UNA sola vez aunque haya varias copias guardadas de la misma
// nota. Devuelve cuántas páginas se intentaron y en cuántas se halló imagen.
//
// `lookup` (opcional) intenta resolver la imagen sin pedir la página del artículo
// (ej. la API REST de WordPress); si devuelve "" se cae al og:image de la página.
func (r *ImageResolver) Backfill(store ImageBackfillStore, since time.Time, lookup func(pageURL string) string) (attempted, recovered int) {
	pending := store.RawNewsMissingImage(since)
	for pageURL, ids := range pending {
		attempted++

		img := ""
		if lookup != nil {
			img = lookup(pageURL)
		}
		if img == "" {
			var err error
			img, err = r.Resolve(pageURL)
			if err != nil {
				log.Printf("[Images] No se pudo leer %s: %v", pageURL, err)
			}
			time.Sleep(articleFetchGap)
		}

		if img != "" {
			recovered++
			for _, id := range ids {
				store.SetRawNewsImage(id, img)
			}
		}
	}
	return attempted, recovered
}
