package scraper

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
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
	mu         sync.RWMutex
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
		onNewNews:  callback,
		stopChan:   make(chan struct{}),
	}
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
	feed, err := p.feedParser.ParseURL(src.RSSURL)
	if err != nil {
		log.Printf("[Poller ERROR] Error al parsear RSS de %s: %v", src.Name, err)
		return nil
	}

	var newItems []*models.RawNews

	for _, item := range feed.Items {
		hash := computeHash(item.Title, item.Link)

		p.mu.Lock()
		if p.seenHashes[hash] {
			p.mu.Unlock()
			continue
		}
		p.seenHashes[hash] = true
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
			Summary:     strings.TrimSpace(item.Description),
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
	return strings.TrimSpace(doc.Text())
}
