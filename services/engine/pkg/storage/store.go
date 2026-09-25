package storage

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/prensa-abierta/ingestor-engine/pkg/models"
)

// persistDebounceInterval es cada cuánto se revisa si hay cambios pendientes
// por escribir a disco. Las mutaciones no escriben en cada llamada: solo
// marcan el store como "dirty" y este loop en segundo plano hace el volcado
// real, evitando reescribir todo db.json en cada Save*.
const persistDebounceInterval = 3 * time.Second

// Store manages in-memory and persistent storage of news and media
type Store struct {
	mu            sync.RWMutex
	rawNews       map[string]*models.RawNews
	processedNews map[string]*models.ProcessedNews
	mediaItems    map[string]*models.MediaItem
	dataFilePath  string

	dirty  bool          // true si hay cambios en memoria sin persistir
	stopCh chan struct{} // señal de apagado para el loop de persistencia
	wg     sync.WaitGroup
}

// NewStore initializes the data store
func NewStore(dataDir string) *Store {
	_ = os.MkdirAll(dataDir, 0755)
	store := &Store{
		rawNews:       make(map[string]*models.RawNews),
		processedNews: make(map[string]*models.ProcessedNews),
		mediaItems:    make(map[string]*models.MediaItem),
		dataFilePath:  filepath.Join(dataDir, "db.json"),
		stopCh:        make(chan struct{}),
	}
	store.loadFromFile()

	store.wg.Add(1)
	go store.persistLoop()

	return store
}

func (s *Store) SaveRawNews(item *models.RawNews) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rawNews[item.ID] = item
	s.dirty = true
}

func (s *Store) GetAllRawNews() []*models.RawNews {
	s.mu.RLock()
	defer s.mu.RUnlock()
	list := make([]*models.RawNews, 0, len(s.rawNews))
	for _, item := range s.rawNews {
		list = append(list, item)
	}
	return list
}

func (s *Store) GetRawNews(id string) (*models.RawNews, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	item, ok := s.rawNews[id]
	return item, ok
}

// RawNewsMissingImage devuelve, por URL original de la nota, los IDs de los
// RawNews guardados sin imagen (varias copias de la misma nota comparten URL).
// Con `since` distinto de cero solo cuenta las ingeridas desde entonces.
func (s *Store) RawNewsMissingImage(since time.Time) map[string][]string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make(map[string][]string)
	for id, item := range s.rawNews {
		if item.ImageURL != "" || item.OriginalURL == "" {
			continue
		}
		if !since.IsZero() && item.IngestedAt.Before(since) {
			continue
		}
		out[item.OriginalURL] = append(out[item.OriginalURL], id)
	}
	return out
}

// GetAllRawNewsDeduped devuelve UNA noticia por medio+link (models.LinkKey), para
// el listado del Feed. No borra nada: las copias sobrantes (de reinicios viejos
// del Engine, o del mismo link con el titular editado) siguen guardadas y
// accesibles por ID. De cada grupo queda la mejor copia — primero la que ya
// tiene una pieza procesada (para que el Feed no pierda su "Ver Pieza"), luego
// la que tiene imagen, luego la más antigua — y además TODAS las que tengan
// pieza procesada.
func (s *Store) GetAllRawNewsDeduped() []*models.RawNews {
	s.mu.RLock()
	defer s.mu.RUnlock()

	referenced := make(map[string]bool, len(s.processedNews))
	for _, p := range s.processedNews {
		referenced[p.RawNewsID] = true
	}

	groups := make(map[string][]*models.RawNews, len(s.rawNews))
	for _, item := range s.rawNews {
		key := models.LinkKey(item.SourceID, item.OriginalURL)
		if key == "" {
			key = "hash|" + item.Hash // sin link utilizable: solo se colapsan copias exactas
		}
		groups[key] = append(groups[key], item)
	}

	out := make([]*models.RawNews, 0, len(groups))
	for _, group := range groups {
		if len(group) == 1 {
			out = append(out, group[0])
			continue
		}
		sort.Slice(group, func(i, j int) bool {
			a, b := group[i], group[j]
			if referenced[a.ID] != referenced[b.ID] {
				return referenced[a.ID]
			}
			if (a.ImageURL != "") != (b.ImageURL != "") {
				return a.ImageURL != ""
			}
			return a.IngestedAt.Before(b.IngestedAt)
		})
		out = append(out, group[0])
		for _, extra := range group[1:] {
			if referenced[extra.ID] {
				out = append(out, extra)
			}
		}
	}
	return out
}

// SetRawNewsImage asigna la imagen a un RawNews que todavía no tiene una, bajo
// el lock del store. Devuelve true si hubo un cambio.
func (s *Store) SetRawNewsImage(id, imageURL string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	item, ok := s.rawNews[id]
	if !ok || item.ImageURL != "" || imageURL == "" {
		return false
	}
	item.ImageURL = imageURL
	s.dirty = true
	return true
}

// MutateAllRawNews aplica fn a cada RawNews bajo el lock del store (misma razón
// que AppendRelatedSource: GetAllRawNews devuelve punteros al objeto interno).
// fn devuelve true si modificó el item. Devuelve cuántos se modificaron y, si
// hubo alguno, marca el store para persistir.
func (s *Store) MutateAllRawNews(fn func(*models.RawNews) bool) int {
	s.mu.Lock()
	defer s.mu.Unlock()

	changed := 0
	for _, item := range s.rawNews {
		if fn(item) {
			changed++
		}
	}
	if changed > 0 {
		s.dirty = true
	}
	return changed
}

// AppendRelatedSource agrega (o actualiza, si ya existía un match del mismo
// SourceID) una fuente relacionada al RawNews `id`, bajo el lock del store —
// GetAllRawNews devuelve punteros al mismo objeto que vive en el mapa interno,
// así que mutarlos directamente desde afuera (ej. el matcher) sería una carrera
// de datos; por eso la mutación vive acá, igual que el resto de los Save*.
// Trunca la lista a maxKeep, ordenada por similitud descendente. No-op si el
// RawNews no existe. Devuelve true si hubo un cambio real.
func (s *Store) AppendRelatedSource(id string, related models.RelatedSource, maxKeep int) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	item, ok := s.rawNews[id]
	if !ok {
		return false
	}

	replaced := false
	for i, existing := range item.RelatedSources {
		if existing.SourceID == related.SourceID {
			if existing.Similarity >= related.Similarity {
				return false // ya había un match igual o mejor de ese mismo medio
			}
			item.RelatedSources[i] = related
			replaced = true
			break
		}
	}
	if !replaced {
		item.RelatedSources = append(item.RelatedSources, related)
	}

	sort.Slice(item.RelatedSources, func(i, j int) bool {
		return item.RelatedSources[i].Similarity > item.RelatedSources[j].Similarity
	})
	if maxKeep > 0 && len(item.RelatedSources) > maxKeep {
		item.RelatedSources = item.RelatedSources[:maxKeep]
	}

	s.dirty = true
	return true
}

func (s *Store) SaveProcessedNews(item *models.ProcessedNews) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.processedNews[item.ID] = item
	if raw, ok := s.rawNews[item.RawNewsID]; ok {
		raw.Status = "processed"
	}
	s.dirty = true
}

func (s *Store) GetAllProcessedNews() []*models.ProcessedNews {
	s.mu.RLock()
	defer s.mu.RUnlock()
	list := make([]*models.ProcessedNews, 0, len(s.processedNews))
	for _, item := range s.processedNews {
		list = append(list, item)
	}
	return list
}

func (s *Store) SaveMediaItem(item *models.MediaItem) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.mediaItems[item.ID] = item
	s.dirty = true
}

func (s *Store) GetAllMediaItems(category, mediaType string) []*models.MediaItem {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var list []*models.MediaItem
	for _, item := range s.mediaItems {
		if category != "" && item.Category != category {
			continue
		}
		if mediaType != "" && item.Type != mediaType {
			continue
		}
		list = append(list, item)
	}
	return list
}

// persistLoop corre en su propia goroutine y hace el volcado a disco de
// forma periódica (debounced) en vez de en cada mutación, y una vez más al
// apagarse para no perder los últimos cambios pendientes.
func (s *Store) persistLoop() {
	defer s.wg.Done()

	ticker := time.NewTicker(persistDebounceInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.flushIfDirty()
		case <-s.stopCh:
			s.flushIfDirty()
			return
		}
	}
}

// flushIfDirty serializa el estado actual y lo escribe a disco solo si hubo
// cambios desde el último volcado. La serialización se hace bajo lock (rápida,
// solo memoria) pero la escritura atómica a disco (potencialmente lenta) se
// hace sin retener el lock, para no bloquear lecturas/escrituras concurrentes.
func (s *Store) flushIfDirty() {
	s.mu.Lock()
	if !s.dirty {
		s.mu.Unlock()
		return
	}
	s.dirty = false
	data := map[string]interface{}{
		"raw_news":       s.rawNews,
		"processed_news": s.processedNews,
		"media_items":    s.mediaItems,
	}
	bytes, err := json.MarshalIndent(data, "", "  ")
	s.mu.Unlock()

	if err != nil {
		log.Printf("[Store] Error serializando datos para persistencia: %v", err)
		return
	}
	if err := writeFileAtomic(s.dataFilePath, bytes); err != nil {
		log.Printf("[Store] Error escribiendo %s: %v", s.dataFilePath, err)
	}
}

// Close detiene el loop de persistencia en segundo plano y espera a que
// termine de escribir cualquier cambio pendiente antes de retornar. Debe
// llamarse una sola vez, típicamente durante el apagado ordenado del server.
func (s *Store) Close() {
	close(s.stopCh)
	s.wg.Wait()
}

// writeFileAtomic escribe data a un archivo temporal en el mismo directorio
// que path y luego lo renombra sobre path. os.Rename es atómico dentro del
// mismo volumen/filesystem, por lo que un corte de energía o crash a mitad
// de escritura nunca deja path con contenido parcial o corrupto.
func writeFileAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
		return err
	}
	return nil
}

func (s *Store) loadFromFile() {
	bytes, err := os.ReadFile(s.dataFilePath)
	if err != nil {
		return
	}
	var data struct {
		RawNews       map[string]*models.RawNews       `json:"raw_news"`
		ProcessedNews map[string]*models.ProcessedNews `json:"processed_news"`
		MediaItems    map[string]*models.MediaItem     `json:"media_items"`
	}
	if err := json.Unmarshal(bytes, &data); err == nil {
		if data.RawNews != nil {
			s.rawNews = data.RawNews
		}
		if data.ProcessedNews != nil {
			s.processedNews = data.ProcessedNews
		}
		if data.MediaItems != nil {
			s.mediaItems = data.MediaItems
		}
	}
}
