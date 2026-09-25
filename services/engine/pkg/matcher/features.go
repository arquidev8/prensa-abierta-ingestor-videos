package matcher

import (
	"sort"
	"sync"

	"github.com/prensa-abierta/ingestor-engine/pkg/models"
)

const (
	fnvOffset = 14695981039346656037
	fnvPrime  = 1099511628211
	// Constante impar de mezcla para combinar los hashes de las palabras de un
	// trigrama de forma que dependa del orden ("a b c" != "c b a").
	mixPrime = 0x9E3779B97F4A7C15

	// Tope de notas con features en memoria; al superarlo se vacía la caché y se
	// vuelve a llenar solo con las que se sigan comparando (las de la ventana).
	maxCachedNotes = 20000
)

// noteFeatures son las palabras del titular y los trigramas del cuerpo de una
// nota, ya normalizados y convertidos a hashes únicos y ordenados. Comparar dos
// notas es intersectar dos listas ordenadas, sin volver a normalizar texto ni
// armar mapas de strings: antes cada par recalculaba todo, ~150-220 ms por nota
// nueva con 4.300 notas guardadas.
type noteFeatures struct {
	title []uint64
	body  []uint64
}

func hashWord(w string) uint64 {
	h := uint64(fnvOffset)
	for i := 0; i < len(w); i++ {
		h ^= uint64(w[i])
		h *= fnvPrime
	}
	return h
}

func sortedUnique(v []uint64) []uint64 {
	sort.Slice(v, func(i, j int) bool { return v[i] < v[j] })
	out := v[:0]
	for _, x := range v {
		if len(out) == 0 || x != out[len(out)-1] {
			out = append(out, x)
		}
	}
	return out
}

// shingleHashes devuelve el hash de cada grupo de n palabras consecutivas (o de
// todas las palabras juntas, como un único grupo, si hay menos de n).
func shingleHashes(words []string, n int) []uint64 {
	if len(words) == 0 {
		return nil
	}
	wh := make([]uint64, len(words))
	for i, w := range words {
		wh[i] = hashWord(w)
	}
	combine := func(group []uint64) uint64 {
		var h uint64
		for _, x := range group {
			h = h*mixPrime + x
		}
		return h
	}
	if len(words) < n {
		return []uint64{combine(wh)}
	}
	out := make([]uint64, 0, len(wh)-n+1)
	for i := 0; i+n <= len(wh); i++ {
		out = append(out, combine(wh[i:i+n]))
	}
	return out
}

func computeFeatures(title, body string) *noteFeatures {
	titleWords := normalizeWords(title)
	titleHashes := make([]uint64, len(titleWords))
	for i, w := range titleWords {
		titleHashes[i] = hashWord(w)
	}
	return &noteFeatures{
		title: sortedUnique(titleHashes),
		body:  sortedUnique(shingleHashes(normalizeWords(body), shingleSize)),
	}
}

// jaccardSorted devuelve 0..1: proporción de elementos compartidos entre dos
// listas ordenadas y sin repetidos. 0 si alguna está vacía.
func jaccardSorted(a, b []uint64) float64 {
	if len(a) == 0 || len(b) == 0 {
		return 0
	}
	i, j, intersection := 0, 0, 0
	for i < len(a) && j < len(b) {
		switch {
		case a[i] == b[j]:
			intersection++
			i++
			j++
		case a[i] < b[j]:
			i++
		default:
			j++
		}
	}
	return float64(intersection) / float64(len(a)+len(b)-intersection)
}

func scoreFeatures(a, b *noteFeatures) float64 {
	return titleWeight*jaccardSorted(a.title, b.title) + bodyWeight*jaccardSorted(a.body, b.body)
}

// Score combina similitud de título (conjunto de palabras) y de cuerpo
// (trigramas) en un único valor 0..1.
func Score(aTitle, aBody, bTitle, bBody string) float64 {
	return scoreFeatures(computeFeatures(aTitle, aBody), computeFeatures(bTitle, bBody))
}

// featureCache guarda las features de cada nota por ID (el titular y el cuerpo
// de una nota ya ingerida no cambian). Es seguro para uso concurrente: varios
// pollers y el backfill comparan a la vez.
type featureCache struct {
	mu   sync.RWMutex
	byID map[string]*noteFeatures
}

var cache = &featureCache{byID: make(map[string]*noteFeatures)}

func (c *featureCache) of(n *models.RawNews) *noteFeatures {
	c.mu.RLock()
	f, ok := c.byID[n.ID]
	c.mu.RUnlock()
	if ok {
		return f
	}

	f = computeFeatures(n.Title, bodyTextOf(n))

	c.mu.Lock()
	if len(c.byID) >= maxCachedNotes {
		c.byID = make(map[string]*noteFeatures)
	}
	c.byID[n.ID] = f
	c.mu.Unlock()
	return f
}
