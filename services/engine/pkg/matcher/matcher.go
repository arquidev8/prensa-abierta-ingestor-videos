// Package matcher detecta, entre las noticias ya ingeridas de los 5 diarios de
// Puerto Rico configurados en pkg/scraper, cuáles cubren el mismo evento. Es un
// matching puramente léxico (sin IA ni servicios externos): compara titulares
// (Jaccard sobre palabras) y cuerpo (Jaccard sobre trigramas), acotado a una
// ventana de tiempo para no comparar contra todo el historial del store.
//
// Fase futura (no implementada acá): expandir a la web abierta para medios que
// no están en pkg/scraper, vía un proveedor de búsqueda externo.
package matcher

import (
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/prensa-abierta/ingestor-engine/pkg/models"
)

// Pesos de la combinación título+cuerpo. El título pesa más porque concentra
// las entidades/hechos clave de la noticia; el cuerpo desempata cuando dos
// medios usan titulares distintos para el mismo hecho.
const (
	titleWeight = 0.65
	bodyWeight  = 0.35
	shingleSize = 3
)

// Config son los parámetros ajustables del matcher, leídos de env vars en
// cmd/server/main.go para poder afinarlos con datos reales sin recompilar.
type Config struct {
	// Threshold es el score mínimo (0..1) para considerar dos noticias "la misma".
	Threshold float64
	// WindowHours acota la comparación a noticias publicadas dentro de esa
	// diferencia horaria (en cualquier dirección) — evita comparar contra todo
	// el historial y reduce falsos positivos de temas recurrentes en fechas lejanas.
	WindowHours int
	// MaxMatches trunca cuántas fuentes relacionadas se guardan por noticia.
	MaxMatches int
}

// DefaultConfig son los valores usados si las env vars correspondientes no
// están seteadas o son inválidas. El Threshold se calibró con pares de titulares
// sintéticos (ver matcher_scratch_test.go): una reescritura real de la MISMA
// noticia por otro medio típicamente combina ~0.15-0.20, mientras que dos
// noticias sobre el MISMO sujeto recurrente (ej. la gobernadora) pero eventos
// distintos combinan ~0.08-0.10 — 0.12 separa ambos casos con margen parejo,
// pero es solo un punto de partida: se espera afinarlo con datos reales vía
// RELATED_NEWS_SIMILARITY_THRESHOLD una vez corriendo contra los 5 feeds.
func DefaultConfig() Config {
	return Config{Threshold: 0.12, WindowHours: 48, MaxMatches: 6}
}

// Match es un candidato de pkg/storage que resultó "la misma noticia" que el
// RawNews evaluado. CandidateID es el RawNews.ID del otro lado del match,
// necesario para poder enlazar también en sentido inverso.
type Match struct {
	CandidateID string
	Related     models.RelatedSource
}

var accentReplacer = strings.NewReplacer(
	"á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u", "ñ", "n",
)

// stopwords son palabras funcionales en español, ya sin acentos (se filtran
// DESPUÉS de accentReplacer), que no aportan señal para distinguir noticias.
var stopwords = map[string]bool{
	"a": true, "al": true, "algo": true, "asi": true, "como": true, "con": true,
	"contra": true, "de": true, "del": true, "desde": true, "donde": true,
	"el": true, "ella": true, "ellos": true, "en": true, "entre": true, "es": true,
	"esta": true, "este": true, "esto": true, "fue": true, "ha": true, "hay": true,
	"la": true, "las": true, "lo": true, "los": true, "mas": true, "mi": true,
	"no": true, "nos": true, "o": true, "para": true, "pero": true, "por": true,
	"que": true, "se": true, "segun": true, "ser": true, "si": true, "sin": true,
	"sobre": true, "su": true, "sus": true, "tambien": true, "tras": true,
	"tu": true, "un": true, "una": true, "uno": true, "y": true, "ya": true,
}

// normalizeWords convierte texto libre en palabras normalizadas (minúsculas,
// sin acentos, sin puntuación) filtrando stopwords y tokens de un carácter.
func normalizeWords(text string) []string {
	lower := accentReplacer.Replace(strings.ToLower(text))
	fields := strings.FieldsFunc(lower, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})

	words := make([]string, 0, len(fields))
	for _, w := range fields {
		if len(w) <= 1 || stopwords[w] {
			continue
		}
		words = append(words, w)
	}
	return words
}

func bodyTextOf(n *models.RawNews) string {
	if n.Content != "" {
		return n.Content
	}
	return n.Summary
}

// RelatedSourceFor arma el RelatedSource que describe a `n` desde la
// perspectiva de OTRA noticia que hizo match con ella (score ya calculado) —
// usado para enlazar en sentido inverso al que encontró el match.
func RelatedSourceFor(n *models.RawNews, score float64, logoBySourceID map[string]string) models.RelatedSource {
	return models.RelatedSource{
		SourceID:      n.SourceID,
		SourceName:    n.SourceName,
		SourceLogoURL: logoBySourceID[n.SourceID],
		URL:           n.OriginalURL,
		Title:         n.Title,
		PublishedAt:   n.PublishedAt,
		Similarity:    score,
	}
}

// FindMatches busca, dentro de `pool`, noticias de OTRO medio que probablemente
// cubren el mismo evento que `candidate`, acotado por cfg.WindowHours y
// ordenado por similitud descendente, truncado a cfg.MaxMatches.
func FindMatches(candidate *models.RawNews, pool []*models.RawNews, cfg Config, logoBySourceID map[string]string) []Match {
	if candidate == nil {
		return nil
	}
	window := time.Duration(cfg.WindowHours) * time.Hour
	candidateFeatures := cache.of(candidate)

	matches := make([]Match, 0)
	for _, other := range pool {
		if other == nil || other.ID == candidate.ID || other.SourceID == candidate.SourceID {
			continue
		}
		diff := candidate.PublishedAt.Sub(other.PublishedAt)
		if diff < 0 {
			diff = -diff
		}
		if diff > window {
			continue
		}

		score := scoreFeatures(candidateFeatures, cache.of(other))
		if score < cfg.Threshold {
			continue
		}

		related := RelatedSourceFor(other, score, logoBySourceID)
		matches = append(matches, Match{CandidateID: other.ID, Related: related})
	}

	sort.Slice(matches, func(i, j int) bool {
		return matches[i].Related.Similarity > matches[j].Related.Similarity
	})
	if cfg.MaxMatches > 0 && len(matches) > cfg.MaxMatches {
		matches = matches[:cfg.MaxMatches]
	}
	return matches
}
