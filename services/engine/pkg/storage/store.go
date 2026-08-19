package storage

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"github.com/prensa-abierta/ingestor-engine/pkg/models"
)

// Store manages in-memory and persistent storage of news and media
type Store struct {
	mu             sync.RWMutex
	rawNews        map[string]*models.RawNews
	processedNews  map[string]*models.ProcessedNews
	mediaItems     map[string]*models.MediaItem
	dataFilePath   string
}

// NewStore initializes the data store
func NewStore(dataDir string) *Store {
	_ = os.MkdirAll(dataDir, 0755)
	store := &Store{
		rawNews:       make(map[string]*models.RawNews),
		processedNews: make(map[string]*models.ProcessedNews),
		mediaItems:    make(map[string]*models.MediaItem),
		dataFilePath:  filepath.Join(dataDir, "db.json"),
	}
	store.loadFromFile()
	return store
}

func (s *Store) SaveRawNews(item *models.RawNews) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rawNews[item.ID] = item
	s.persist()
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
	s.persist()
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
	s.persist()
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

func (s *Store) persist() {
	data := map[string]interface{}{
		"raw_news":       s.rawNews,
		"processed_news": s.processedNews,
		"media_items":    s.mediaItems,
	}
	bytes, err := json.MarshalIndent(data, "", "  ")
	if err == nil {
		_ = os.WriteFile(s.dataFilePath, bytes, 0644)
	}
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
