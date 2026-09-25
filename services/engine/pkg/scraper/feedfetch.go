package scraper

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/mmcdole/gofeed"
	"github.com/prensa-abierta/ingestor-engine/pkg/models"
)

const (
	// Es el User-Agent que gofeed manda por defecto. No cambiarlo sin probar: hay medios
	// detrás de Cloudflare que tratan distinto a un User-Agent que dice ser un navegador
	// pero no lo es (ver la entrada del 2026-09-24 (11) de .agents/context.md).
	feedUserAgent = "Gofeed/1.0"
	// Tope a la espera que pide un Retry-After: un servidor que pida más se trata como
	// "no en este ciclo" y se deja para el siguiente sondeo.
	maxRetryAfter = 2 * time.Minute
)

// Esperas antes de cada reintento cuando el medio responde 429 o 503. Al ser cortas
// no bloquean de más al poller de esa fuente (cada una corre en su propia goroutine)
// y aprovechan que el CDN de estos medios cachea el feed unos minutos.
var defaultFeedRetryDelays = []time.Duration{15 * time.Second, 45 * time.Second}

// feedHTTPError es una respuesta HTTP no exitosa al pedir un feed.
type feedHTTPError struct {
	StatusCode int
	// RetryAfter es lo que pidió el servidor en el encabezado Retry-After (0 si no vino).
	RetryAfter time.Duration
}

func (e *feedHTTPError) Error() string {
	return fmt.Sprintf("HTTP %d %s", e.StatusCode, http.StatusText(e.StatusCode))
}

// retryableStatus dice si vale la pena reintentar: son los límites de tráfico
// (429) y la indisponibilidad temporal (503). Un 403 o 404 no se arregla esperando.
func retryableStatus(code int) bool {
	return code == http.StatusTooManyRequests || code == http.StatusServiceUnavailable
}

// parseRetryAfter entiende Retry-After en segundos o como fecha HTTP.
func parseRetryAfter(v string) time.Duration {
	if v == "" {
		return 0
	}
	if secs, err := strconv.Atoi(v); err == nil && secs > 0 {
		return time.Duration(secs) * time.Second
	}
	if t, err := http.ParseTime(v); err == nil {
		if d := time.Until(t); d > 0 {
			return d
		}
	}
	return 0
}

func (p *Poller) getFeedOnce(feedURL string) (*gofeed.Feed, error) {
	req, err := http.NewRequest(http.MethodGet, feedURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", feedUserAgent)
	req.Header.Set("Accept", "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8")

	resp, err := p.feedParser.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, &feedHTTPError{
			StatusCode: resp.StatusCode,
			RetryAfter: parseRetryAfter(resp.Header.Get("Retry-After")),
		}
	}
	return p.feedParser.Parse(resp.Body)
}

// fetchAndParse pide el feed de `src` y, si el medio responde con un límite de
// tráfico (429/503), espera y reintenta (respetando Retry-After si es razonable)
// antes de rendirse hasta el próximo ciclo de sondeo. Otros errores no se reintentan.
func (p *Poller) fetchAndParse(src models.Source) (*gofeed.Feed, error) {
	for attempt := 0; ; attempt++ {
		feed, err := p.getFeedOnce(src.RSSURL)
		if err == nil {
			return feed, nil
		}

		httpErr, isHTTP := err.(*feedHTTPError)
		if !isHTTP || !retryableStatus(httpErr.StatusCode) {
			return nil, err
		}
		if attempt >= len(p.feedRetryDelays) {
			return nil, fmt.Errorf("%w tras %d reintentos: el sitio limita las peticiones, se vuelve a intentar en el próximo ciclo", err, attempt)
		}

		wait := p.feedRetryDelays[attempt]
		if httpErr.RetryAfter > 0 && httpErr.RetryAfter <= maxRetryAfter {
			wait = httpErr.RetryAfter
		}
		log.Printf("[Poller] %s respondió %v; reintento %d de %d en %v", src.Name, err, attempt+1, len(p.feedRetryDelays), wait)

		timer := time.NewTimer(wait)
		select {
		case <-timer.C:
		case <-p.stopChan:
			timer.Stop()
			return nil, err
		}
	}
}
