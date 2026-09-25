package scraper

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/PuerkitoBio/goquery"
	"github.com/google/uuid"
	"github.com/mmcdole/gofeed"
	"github.com/prensa-abierta/ingestor-engine/pkg/models"
)

// OnNewNewsCallback is called when a new unique news item is extracted
type OnNewNewsCallback func(news *models.RawNews)

// Poller manages concurrent polling of Puerto Rico news sources
type Poller struct {
	sources    []models.Source
	feedParser *gofeed.Parser
	seenHashes map[string]bool
	seenLinks  map[string]bool // models.LinkKey: medio + link normalizado
	images     *ImageResolver
	// feedRetryDelays son las esperas entre reintentos ante un 429/503 (ver feedfetch.go).
	feedRetryDelays []time.Duration
	mu              sync.RWMutex
	onNewNews  OnNewNewsCallback
	stopChan   chan struct{}
	isRunning  bool
}

// NewPoller creates an instance of the Puerto Rico news poller
func NewPoller(sources []models.Source, callback OnNewNewsCallback) *Poller {
	fp := gofeed.NewParser()
	fp.Client = &http.Client{
		Timeout: 15 * time.Second,
	}

	return &Poller{
		sources:    sources,
		feedParser: fp,
		seenHashes: make(map[string]bool),
		seenLinks:  make(map[string]bool),
		images:     NewImageResolver(),
		feedRetryDelays: defaultFeedRetryDelays,
		onNewNews:  callback,
		stopChan:   make(chan struct{}),
	}
}

// Images expone el resolutor de imágenes (og:image) para que el arranque pueda
// completar las notas ya guardadas sin imagen.
func (p *Poller) Images() *ImageResolver {
	return p.images
}

// MarkSeenNews registra las notas ya guardadas (por hash y por medio+link).
// seenHashes vive solo en memoria, así que sin esto cada reinicio del Engine
// re-ingería todo lo que traen los feeds como noticias nuevas (con IDs nuevos):
// copias duplicadas en el Feed, y un pedido extra de og:image por cada nota sin
// imagen.
func (p *Poller) MarkSeenNews(items []*models.RawNews) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, n := range items {
		p.seenHashes[n.Hash] = true
		if key := models.LinkKey(n.SourceID, n.OriginalURL); key != "" {
			p.seenLinks[key] = true
		}
	}
}

// BackfillImages recupera la imagen de las notas ya guardadas sin ella (ingeridas
// desde `since`; cero = todas). Para los medios WordPress usa primero su API REST
// (una petición por medio para todas las notas pendientes, en tamaño reducido) y
// solo pide la página del artículo (og:image) si la nota no está ahí.
func (p *Poller) BackfillImages(store ImageBackfillStore, since time.Time) (attempted, recovered int) {
	var wpImages map[string]string
	var wpLoaded bool
	lookup := func(pageURL string) string {
		if !wpLoaded {
			wpLoaded = true
			wpImages = make(map[string]string)
			for _, s := range p.sources {
				if !s.WordPressREST {
					continue
				}
				images, err := p.images.WordPressFeaturedImages(s.BaseURL, wpBackfillPerPage)
				if err != nil {
					log.Printf("[Images] %s: la API REST de WordPress no respondió (%v)", s.Name, err)
					continue
				}
				for k, v := range images {
					wpImages[k] = v
				}
			}
		}
		return wpImages[models.LinkKey("", pageURL)]
	}
	return p.images.Backfill(store, since, lookup)
}

// StartImageRetryLoop reintenta cada `every` la imagen (og:image) de las notas
// ingeridas en las últimas `maxAge` que siguen sin ella: el pedido inicial pudo
// fallar por algo transitorio (un 429, un timeout). Se detiene con Stop().
func (p *Poller) StartImageRetryLoop(store ImageBackfillStore, every, maxAge time.Duration) {
	go func() {
		ticker := time.NewTicker(every)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				attempted, recovered := p.BackfillImages(store, time.Now().Add(-maxAge))
				if attempted > 0 {
					log.Printf("[Images] Reintento: %d de %d notas sin imagen recuperaron su imagen", recovered, attempted)
				}
			case <-p.stopChan:
				return
			}
		}
	}()
}

// Start begins polling all PR sources concurrently using goroutines
func (p *Poller) Start() {
	p.mu.Lock()
	if p.isRunning {
		p.mu.Unlock()
		return
	}
	p.isRunning = true
	p.mu.Unlock()

	log.Printf("[Poller] Iniciando monitoreo concurrente de %d diarios de Puerto Rico...", len(p.sources))

	for _, source := range p.sources {
		if !source.Enabled {
			continue
		}
		go p.pollSourceLoop(source)
	}
}

// Stop terminates all polling goroutines
func (p *Poller) Stop() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.isRunning {
		return
	}
	close(p.stopChan)
	p.isRunning = false
	log.Println("[Poller] Monitoreo detenido.")
}

func (p *Poller) pollSourceLoop(src models.Source) {
	interval := time.Duration(src.PollMinutes) * time.Minute
	if interval < 1*time.Minute {
		interval = 2 * time.Minute
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Initial fetch
	p.fetchFeed(src)

	for {
		select {
		case <-ticker.C:
			p.fetchFeed(src)
		case <-p.stopChan:
			return
		}
	}
}

// FetchOnce triggers a manual fetch on all sources and returns ingested items
func (p *Poller) FetchAllNow() []*models.RawNews {
	var results []*models.RawNews
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, src := range p.sources {
		if !src.Enabled {
			continue
		}
		wg.Add(1)
		go func(s models.Source) {
			defer wg.Done()
			items := p.fetchFeed(s)
			mu.Lock()
			results = append(results, items...)
			mu.Unlock()
		}(src)
	}

	wg.Wait()
	return results
}

func (p *Poller) fetchFeed(src models.Source) []*models.RawNews {
	log.Printf("[Poller] Consultando feed: %s (%s)", src.Name, src.RSSURL)
	feed, err := p.fetchAndParse(src)
	if err != nil {
		log.Printf("[Poller ERROR] Error al parsear RSS de %s: %v", src.Name, err)
		return nil
	}

	var newItems []*models.RawNews
	var missingImages, recoveredImages, recoveredViaWP int
	var firstImageErr error
	var wpImages map[string]string // se pide una sola vez por ciclo, al primer ítem sin imagen
	var wpLoaded bool

	for _, item := range feed.Items {
		hash := computeHash(item.Title, item.Link)
		linkKey := models.LinkKey(src.ID, item.Link)

		// Se ignora si ya vimos este titular+link, o el mismo link del mismo medio con el
		// titular editado (el medio actualiza la nota y el hash cambia, pero no es otra nota).
		p.mu.Lock()
		if p.seenHashes[hash] || (linkKey != "" && p.seenLinks[linkKey]) {
			p.seenHashes[hash] = true
			p.mu.Unlock()
			continue
		}
		p.seenHashes[hash] = true
		if linkKey != "" {
			p.seenLinks[linkKey] = true
		}
		p.mu.Unlock()

		// Extract best image
		imageURL := ""
		if item.Image != nil && item.Image.URL != "" {
			imageURL = item.Image.URL
		} else if len(item.Enclosures) > 0 {
			for _, enc := range item.Enclosures {
				if strings.HasPrefix(enc.Type, "image/") {
					imageURL = enc.URL
					break
				}
			}
		}

		// El RSS de algunos medios no trae imagen (La Perla del Sur nunca; WAPA en ~70%
		// de las notas). Primero, si el medio corre WordPress, se toma de su API REST (una
		// sola petición por ciclo, ya en tamaño reducido); si no, el og:image de la página del
		// artículo. Solo corre para notas nuevas sin imagen, así que en régimen normal son pocas.
		if imageURL == "" && item.Link != "" {
			missingImages++
			if src.WordPressREST {
				if !wpLoaded {
					wpLoaded = true
					images, err := p.images.WordPressFeaturedImages(src.BaseURL, wpPollPerPage)
					if err != nil {
						log.Printf("[Images] %s: la API REST de WordPress no respondió (%v); se intenta og:image", src.Name, err)
					} else {
						wpImages = images
					}
				}
				if u := wpImages[models.LinkKey("", item.Link)]; u != "" {
					imageURL = u
					recoveredImages++
					recoveredViaWP++
				}
			}
			if imageURL == "" {
				img, err := p.images.Resolve(item.Link)
				if err != nil {
					if firstImageErr == nil {
						firstImageErr = err
					}
				} else if img != "" {
					imageURL = img
					recoveredImages++
				}
				time.Sleep(articleFetchGap)
			}
		}

		pubTime := time.Now()
		if item.PublishedParsed != nil {
			pubTime = *item.PublishedParsed
		}

		cleanContent := cleanHTMLText(item.Content)
		if cleanContent == "" {
			cleanContent = cleanHTMLText(item.Description)
		}

		author := ""
		if item.Author != nil {
			author = item.Author.Name
		} else if len(item.Authors) > 0 {
			author = item.Authors[0].Name
		}

		category := src.Category
		if len(item.Categories) > 0 {
			category = item.Categories[0]
		}

		raw := &models.RawNews{
			ID:          uuid.New().String(),
			SourceID:    src.ID,
			SourceName:  src.Name,
			OriginalURL: item.Link,
			Title:       strings.TrimSpace(item.Title),
			Summary:     CleanSummary(item.Description),
			Content:     cleanContent,
			Author:      author,
			ImageURL:    imageURL,
			PublishedAt: pubTime,
			IngestedAt:  time.Now(),
			Category:    category,
			Status:      "pending",
			Hash:        hash,
		}

		newItems = append(newItems, raw)

		if p.onNewNews != nil {
			p.onNewNews(raw)
		}
	}

	if len(newItems) > 0 {
		log.Printf("[Poller] ✅ Se detectaron %d noticias nuevas de %s", len(newItems), src.Name)
	}
	if missingImages > 0 {
		msg := fmt.Sprintf("[Images] %s: %d notas nuevas sin imagen en el RSS, %d recuperadas (%d por la API REST de WordPress, %d por og:image)",
			src.Name, missingImages, recoveredImages, recoveredViaWP, recoveredImages-recoveredViaWP)
		if firstImageErr != nil {
			msg += fmt.Sprintf(" — primer error: %v", firstImageErr)
		}
		log.Print(msg)
	}

	return newItems
}

func computeHash(title, link string) string {
	hasher := sha256.New()
	hasher.Write([]byte(fmt.Sprintf("%s|%s", strings.TrimSpace(title), strings.TrimSpace(link))))
	return hex.EncodeToString(hasher.Sum(nil))
}

func cleanHTMLText(rawHTML string) string {
	if rawHTML == "" {
		return ""
	}
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(rawHTML))
	if err != nil {
		return strings.TrimSpace(rawHTML)
	}
	// El texto de estos nodos (embeds, estilos) nunca es contenido de la nota.
	doc.Find("script, style, noscript, iframe").Remove()
	return strings.TrimSpace(doc.Text())
}

var (
	// Cierre de bloque o <br>: se les agrega un espacio para que al quitar las
	// etiquetas "</p><p>" no pegue la última palabra de un párrafo con la
	// primera del siguiente.
	blockBreakRe = regexp.MustCompile(`(?i)</(?:p|div|li|h[1-6]|blockquote)>|<br\s*/?>`)
	// Etiqueta HTML real (no un "a < b" suelto en texto plano).
	htmlTagRe = regexp.MustCompile(`</?[a-zA-Z][^>]*>`)
)

// CleanSummary convierte un resumen de RSS en texto plano de una sola línea.
// Algunos medios (ej. Telemundo PR) mandan en <description> el artículo completo
// como HTML (<p>, <div>, <a>...), y sin limpiarlo la card del Feed mostraba las
// etiquetas literales.
func CleanSummary(raw string) string {
	if raw == "" {
		return ""
	}
	spaced := blockBreakRe.ReplaceAllString(raw, "$0 ")
	return strings.Join(strings.Fields(cleanHTMLText(spaced)), " ")
}

// SanitizeRawNewsSummary limpia el Summary de un RawNews ya guardado si todavía
// trae HTML (registros ingeridos antes de que existiera CleanSummary). Es
// idempotente y no toca resúmenes que ya son texto plano. Devuelve true si lo
// modificó.
func SanitizeRawNewsSummary(n *models.RawNews) bool {
	if !htmlTagRe.MatchString(n.Summary) {
		return false
	}
	cleaned := CleanSummary(n.Summary)
	if cleaned == n.Summary {
		return false
	}
	n.Summary = cleaned
	return true
}
