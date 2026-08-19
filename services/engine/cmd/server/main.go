package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/prensa-abierta/ingestor-engine/pkg/models"
	"github.com/prensa-abierta/ingestor-engine/pkg/scraper"
	"github.com/prensa-abierta/ingestor-engine/pkg/storage"
	"github.com/prensa-abierta/ingestor-engine/pkg/video"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8085"
	}

	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "./data"
	}

	assetsDir := os.Getenv("ASSETS_DIR")
	if assetsDir == "" {
		assetsDir = "../../assets"
	}

	outputVideosDir := filepath.Join(dataDir, "videos")
	_ = os.MkdirAll(outputVideosDir, 0755)

	// Initialize Store
	store := storage.NewStore(dataDir)

	// Initialize Video Engine
	videoEngine := video.NewEngine(os.Getenv("FFMPEG_PATH"), assetsDir, outputVideosDir)
	if err := videoEngine.CheckFFmpegAvailability(); err != nil {
		log.Printf("[Warning] FFmpeg check: %v (los renders usarán generador interno o fallback)", err)
	} else {
		log.Println("[VideoEngine] ✅ FFmpeg detectado y listo para renderizado.")
	}

	// Initialize Scraper Poller for Puerto Rico
	sources := scraper.GetDefaultPRSources()
	poller := scraper.NewPoller(sources, func(news *models.RawNews) {
		store.SaveRawNews(news)
		log.Printf("[Ingestor PR] 📰 Nueva noticia guardada: [%s] %s", news.SourceName, news.Title)
	})

	// Start continuous background poller
	poller.Start()
	defer poller.Stop()

	// Initialize Fiber Web Server
	app := fiber.New(fiber.Config{
		AppName: "Prensa Abierta - Go Core Engine v1.0",
	})

	app.Use(recover.New())
	app.Use(logger.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowHeaders: "Origin, Content-Type, Accept, Authorization",
		AllowMethods: "GET, POST, PUT, DELETE, OPTIONS",
	}))

	// Serve generated MP4 videos and assets statically
	app.Static("/videos", outputVideosDir)
	app.Static("/assets", assetsDir)

	// Health Check
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status":    "healthy",
			"service":   "prensa-abierta-go-engine",
			"timestamp": time.Now().Format(time.RFC3339),
			"pr_sources": len(sources),
		})
	})

	// PR News Endpoints
	app.Get("/api/news/sources", func(c *fiber.Ctx) error {
		return c.JSON(sources)
	})

	app.Get("/api/news/raw", func(c *fiber.Ctx) error {
		items := store.GetAllRawNews()
		return c.JSON(fiber.Map{
			"total": len(items),
			"items": items,
		})
	})

	app.Get("/api/news/raw/:id", func(c *fiber.Ctx) error {
		id := c.Params("id")
		item, exists := store.GetRawNews(id)
		if !exists {
			return c.Status(404).JSON(fiber.Map{"error": "Noticia no encontrada"})
		}
		return c.JSON(item)
	})

	app.Post("/api/news/poll", func(c *fiber.Ctx) error {
		go func() {
			items := poller.FetchAllNow()
			for _, item := range items {
				store.SaveRawNews(item)
			}
		}()
		return c.JSON(fiber.Map{
			"message": "Sondeo de medios de Puerto Rico iniciado en segundo plano",
		})
	})

	// Processed News (AI Output) Endpoints
	app.Get("/api/news/processed", func(c *fiber.Ctx) error {
		items := store.GetAllProcessedNews()
		return c.JSON(fiber.Map{
			"total": len(items),
			"items": items,
		})
	})

	app.Post("/api/news/processed", func(c *fiber.Ctx) error {
		var item models.ProcessedNews
		if err := c.BodyParser(&item); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": err.Error()})
		}
		if item.CreatedAt.IsZero() {
			item.CreatedAt = time.Now()
		}
		store.SaveProcessedNews(&item)
		return c.Status(201).JSON(item)
	})

	// Video Engine Endpoints
	app.Post("/api/video/render", func(c *fiber.Ctx) error {
		var req models.VideoRenderRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": err.Error()})
		}

		job := videoEngine.CreateJob(req)

		// Run render asynchronously
		go func(jobID string) {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			_, _ = videoEngine.RenderVideo(ctx, jobID)
		}(job.ID)

		return c.Status(202).JSON(fiber.Map{
			"message": "Trabajo de renderizado de video encolado",
			"job_id":  job.ID,
			"job":     job,
		})
	})

	app.Get("/api/video/jobs/:id", func(c *fiber.Ctx) error {
		jobID := c.Params("id")
		job, exists := videoEngine.GetJob(jobID)
		if !exists {
			return c.Status(404).JSON(fiber.Map{"error": "Trabajo no encontrado"})
		}
		return c.JSON(job)
	})

	// Media Bank Endpoints
	app.Get("/api/media", func(c *fiber.Ctx) error {
		cat := c.Query("category")
		mType := c.Query("type")
		items := store.GetAllMediaItems(cat, mType)
		return c.JSON(fiber.Map{
			"total": len(items),
			"items": items,
		})
	})

	app.Post("/api/media", func(c *fiber.Ctx) error {
		var item models.MediaItem
		if err := c.BodyParser(&item); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": err.Error()})
		}
		if item.CreatedAt.IsZero() {
			item.CreatedAt = time.Now()
		}
		store.SaveMediaItem(&item)
		return c.Status(201).JSON(item)
	})

	addr := fmt.Sprintf(":%s", port)
	log.Printf("🚀 Prensa Abierta Go Core Engine corriendo en http://localhost%s", addr)
	if err := app.Listen(addr); err != nil {
		log.Fatalf("Error iniciando servidor Go: %v", err)
	}
}
