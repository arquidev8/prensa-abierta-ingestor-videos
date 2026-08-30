package storage

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
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
