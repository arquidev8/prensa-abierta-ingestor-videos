package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/prensa-abierta/ingestor-engine/pkg/auth"
	"github.com/prensa-abierta/ingestor-engine/pkg/models"
	"github.com/prensa-abierta/ingestor-engine/pkg/scraper"
	"github.com/prensa-abierta/ingestor-engine/pkg/storage"
	"github.com/prensa-abierta/ingestor-engine/pkg/video"
	"github.com/prensa-abierta/ingestor-engine/pkg/voice"
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

	// Initialize User Store (usuarios/roles + límite diario de video, archivo
	// separado users.json). Si no hay ningún usuario todavía (primer arranque),
	// se siembra un superadmin para no quedar sin forma de administrar el panel.
	userStore := storage.NewUserStore(dataDir)
	if len(userStore.GetAllUsers()) == 0 {
		seedEmail := os.Getenv("SEED_SUPERADMIN_EMAIL")
		if seedEmail == "" {
			seedEmail = "admin@prensaabierta.com"
		}
		seedPassword := os.Getenv("SEED_SUPERADMIN_PASSWORD")
		generated := seedPassword == ""
		if generated {
			seedPassword = randomPassword()
		}
		seedUser, err := userStore.CreateUser("Superadmin", seedEmail, seedPassword, models.RoleSuperAdmin)
		if err != nil {
			log.Printf("[UserStore] No se pudo sembrar el superadmin inicial: %v", err)
		} else if generated {
			log.Printf("[UserStore] Superadmin inicial creado: email=%s password=%s (generada, cambiarla apenas se inicie sesión; login vía POST /api/auth/login)", seedUser.Email, seedPassword)
		} else {
			log.Printf("[UserStore] Superadmin inicial creado: email=%s (password de SEED_SUPERADMIN_PASSWORD; login vía POST /api/auth/login)", seedUser.Email)
		}
	}

	// Emisor de access tokens (JWT, 15 min) usado por login/refresh/requireAuth
	// más abajo. El refresh token (opaco, 5 días) sigue viviendo en userStore.
	jwtIssuer := auth.NewIssuerFromEnv()

	// Initialize Video Engine
	videoWorkers := 2
	if raw := os.Getenv("VIDEO_RENDER_WORKERS"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			videoWorkers = n
		} else {
			log.Printf("[Warning] VIDEO_RENDER_WORKERS inválido ('%s'), usando default %d", raw, videoWorkers)
		}
	}

	// URLs opcionales del logo/banner en Cloudinary (banco de medios migrado);
	// vacías = se sigue usando el archivo local bajo assetsDir/logos como antes.
	logoURL := os.Getenv("LOGO_URL")
	promoImageURL := os.Getenv("PROMO_IMAGE_URL")

	videoEngine := video.NewEngine(os.Getenv("FFMPEG_PATH"), assetsDir, outputVideosDir, videoWorkers, logoURL, promoImageURL)
	if err := videoEngine.CheckFFmpegAvailability(); err != nil {
		log.Printf("[Warning] FFmpeg check: %v (los renders usarán generador interno o fallback)", err)
	} else {
		log.Println("[VideoEngine] ✅ FFmpeg detectado y listo para renderizado.")
	}

	// Locución (ElevenLabs): sin ELEVENLABS_API_KEY queda desactivada y los videos salen mudos.
	// El audio sintetizado se cachea en disco para no pagar dos veces el mismo texto.
	voiceCacheDir := filepath.Join(dataDir, "voice_cache")
	voiceClient := voice.NewClientFromEnv(voiceCacheDir)
	videoEngine.SetVoice(voiceClient)
	if voiceClient == nil {
		log.Println("[Voice] Locución DESACTIVADA (los jobs con voice_text quedarán con voice_status=disabled)")
	} else {
		log.Printf("[Voice] Locución ACTIVA (caché de audio en %s)", voiceCacheDir)
	}

	// Start the bounded worker pool that processes queued render jobs
	videoEngine.StartWorkers()

	// Initialize Scraper Poller for Puerto Rico
	sources := scraper.GetDefaultPRSources()
	poller := scraper.NewPoller(sources, func(news *models.RawNews) {
		store.SaveRawNews(news)
		log.Printf("[Ingestor PR] 📰 Nueva noticia guardada: [%s] %s", news.SourceName, news.Title)
	})

	// Start continuous background poller (detenido explícitamente en el shutdown ordenado más abajo)
	poller.Start()

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
			"status":     "healthy",
			"service":    "prensa-abierta-go-engine",
			"timestamp":  time.Now().Format(time.RFC3339),
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

	// requireAuth resuelve "Authorization: Bearer <access token JWT>" a un
	// usuario y lo deja en c.Locals("authUser") para que el handler no tenga
	// que repetir el parseo. El JWT solo prueba QUIÉN es (subject) — el rol y
	// el estado activo SIEMPRE se leen frescos del store en cada request (no
	// del propio token), así un cambio de rol o una desactivación se respetan
	// de inmediato sin esperar a que ese access token expire (máximo 15 min,
	// pkg/auth.AccessTokenTTL). 401 si falta, está mal formado, vencido, o el
	// usuario ya no existe/está inactivo.
	requireAuth := func(c *fiber.Ctx) error {
		authHeader := c.Get("Authorization")
		const prefix = "Bearer "
		if len(authHeader) <= len(prefix) || authHeader[:len(prefix)] != prefix {
			return c.Status(401).JSON(fiber.Map{"error": "Falta el header Authorization: Bearer <token>"})
		}
		token := authHeader[len(prefix):]
		userID, err := jwtIssuer.ParseAccessToken(token)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"error": "Token inválido o expirado"})
		}
		user, ok := userStore.GetUser(userID)
		if !ok {
			return c.Status(401).JSON(fiber.Map{"error": "El usuario de este token ya no existe"})
		}
		if !user.Active {
			return c.Status(401).JSON(fiber.Map{"error": "Usuario inactivo"})
		}
		c.Locals("authUser", user)
		return c.Next()
	}

	// issueTokenPair arma la respuesta compartida de login/refresh: un access
	// token (JWT, AccessTokenTTL ≈ 15 min) + un refresh token nuevo (opaco,
	// refreshTokenTTL = 5 días). Ambos viajan siempre juntos para que el
	// cliente pueda seguir renovando el access token sin pedir credenciales de
	// nuevo hasta que el refresh token expire.
	issueTokenPair := func(user *models.User) (fiber.Map, error) {
		accessToken, accessExp, err := jwtIssuer.IssueAccessToken(user.ID, user.Role)
		if err != nil {
			return nil, err
		}
		refresh, err := userStore.CreateRefreshToken(user.ID)
		if err != nil {
			return nil, err
		}
		return fiber.Map{
			"token":              accessToken,
			"expires_at":         accessExp,
			"refresh_token":      refresh.Token,
			"refresh_expires_at": refresh.ExpiresAt,
			"user":               user.Public(),
		}, nil
	}

	// Auth Endpoints
	app.Post("/api/auth/login", func(c *fiber.Ctx) error {
		var body struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": err.Error()})
		}
		user, err := userStore.VerifyCredentials(body.Email, body.Password)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"error": err.Error()})
		}
		pair, err := issueTokenPair(user)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(pair)
	})

	// Refresca la sesión: cambia un refresh token válido por un access token
	// nuevo (y un refresh token rotado, de un solo uso — ver RotateRefreshToken).
	// No requiere requireAuth: el access token puede llevar rato vencido
	// (justamente para eso existe esta ruta) y lo único que hace falta es el
	// refresh token del body.
	app.Post("/api/auth/refresh", func(c *fiber.Ctx) error {
		var body struct {
			RefreshToken string `json:"refresh_token"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": err.Error()})
		}
		rotated, user, err := userStore.RotateRefreshToken(body.RefreshToken)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"error": "Sesión vencida, iniciá sesión de nuevo"})
		}
		if !user.Active {
			// El refresh token ya se invalidó (RotateRefreshToken es de un solo uso),
			// así que una cuenta desactivada queda cortada sin ningún paso extra.
			return c.Status(403).JSON(fiber.Map{"error": "Usuario inactivo"})
		}
		accessToken, accessExp, err := jwtIssuer.IssueAccessToken(user.ID, user.Role)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{
			"token":              accessToken,
			"expires_at":         accessExp,
			"refresh_token":      rotated.Token,
			"refresh_expires_at": rotated.ExpiresAt,
			"user":               user.Public(),
		})
	})

	// Cierra la sesión: revoca el refresh token para que, si alguien llegara a
	// copiarlo antes del logout, ya no sirva para renovar el acceso. Sin
	// requireAuth (el access token puede ya estar vencido) y siempre 204,
	// exista o no ese token, para no filtrar si era válido.
	app.Post("/api/auth/logout", func(c *fiber.Ctx) error {
		var body struct {
			RefreshToken string `json:"refresh_token"`
		}
		_ = c.BodyParser(&body)
		userStore.RevokeRefreshToken(body.RefreshToken)
		return c.SendStatus(204)
	})

	// User & Role Endpoints
	app.Get("/api/users", func(c *fiber.Ctx) error {
		all := userStore.GetAllUsers()
		items := make([]models.User, 0, len(all))
		for _, u := range all {
			items = append(items, u.Public())
		}
		return c.JSON(fiber.Map{"items": items})
	})

	// Registro: requiere sesión de admin/superadmin. El rol del nuevo usuario
	// solo puede ser "admin" o "editor" (nunca "superadmin" por esta vía) y
	// respeta la jerarquía: superadmin y admin pueden registrar admin o editor
	// (ver models.CanRegisterRole).
	app.Post("/api/users", requireAuth, func(c *fiber.Ctx) error {
		caller := c.Locals("authUser").(*models.User)

		var body struct {
			Name     string      `json:"name"`
			Email    string      `json:"email"`
			Password string      `json:"password"`
			Role     models.Role `json:"role"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": err.Error()})
		}
		if !models.CanRegisterRole(caller.Role, body.Role) {
			return c.Status(403).JSON(fiber.Map{"error": fmt.Sprintf("El rol %s no puede registrar usuarios con rol %s", caller.Role, body.Role)})
		}
		user, err := userStore.CreateUser(body.Name, body.Email, body.Password, body.Role)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": err.Error()})
		}
		return c.Status(201).JSON(user.Public())
	})

	app.Get("/api/users/:id", func(c *fiber.Ctx) error {
		user, ok := userStore.GetUser(c.Params("id"))
		if !ok {
			return c.Status(404).JSON(fiber.Map{"error": "Usuario no encontrado"})
		}
		return c.JSON(user.Public())
	})

	// Edición: requiere sesión. Permitido si es auto-edición (name/email/
	// password propios, con current_password obligatoria para tocar la
	// contraseña) o si el caller administra al target según la jerarquía
	// (models.CanManageUser) — en ese caso puede además tocar role/active,
	// sin necesitar la contraseña del target.
	app.Put("/api/users/:id", requireAuth, func(c *fiber.Ctx) error {
		caller := c.Locals("authUser").(*models.User)
		targetID := c.Params("id")
		target, ok := userStore.GetUser(targetID)
		if !ok {
			return c.Status(404).JSON(fiber.Map{"error": "Usuario no encontrado"})
		}

		isSelf := caller.ID == target.ID
		canManage := models.CanManageUser(caller.Role, target.Role)
		if !isSelf && !canManage {
			return c.Status(403).JSON(fiber.Map{"error": "No tenés permiso para editar este usuario"})
		}

		var body struct {
			Name            *string      `json:"name"`
			Email           *string      `json:"email"`
			Password        *string      `json:"password"`
			CurrentPassword *string      `json:"current_password"`
			Role            *models.Role `json:"role"`
			Active          *bool        `json:"active"`
			// DailyVideoLimitOverride pisa el límite de video de ESTE usuario en
			// particular (ej. "este editor tiene 10, no 5"); ClearDailyVideoLimitOverride
			// en true lo borra y vuelve a usar el default del rol. Ambos son cambios
			// administrativos: mismas reglas que role/active (nunca sobre uno mismo,
			// solo quien administra al target).
			DailyVideoLimitOverride      *int `json:"daily_video_limit_override"`
			ClearDailyVideoLimitOverride bool `json:"clear_daily_video_limit_override"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": err.Error()})
		}

		wantsAdminChange := body.Role != nil || body.Active != nil || body.DailyVideoLimitOverride != nil || body.ClearDailyVideoLimitOverride

		// role/active/límite de video son cambios administrativos: nunca sobre
		// uno mismo (evita auto-promoción/auto-desactivación/auto-subirse el
		// límite) y solo si el caller administra al target.
		if wantsAdminChange {
			if isSelf {
				return c.Status(400).JSON(fiber.Map{"error": "No podés cambiar tu propio rol, estado activo o límite de video"})
			}
			if !canManage {
				return c.Status(403).JSON(fiber.Map{"error": "No tenés permiso para cambiar rol/estado/límite de este usuario"})
			}
			if body.Role != nil && !models.CanRegisterRole(caller.Role, *body.Role) {
				return c.Status(403).JSON(fiber.Map{"error": fmt.Sprintf("El rol %s no puede asignar el rol %s", caller.Role, *body.Role)})
			}
			if body.DailyVideoLimitOverride != nil && *body.DailyVideoLimitOverride < -1 {
				return c.Status(400).JSON(fiber.Map{"error": "daily_video_limit_override debe ser -1 (sin límite) o un número >= 0"})
			}
		}

		// Auto-edición de campos sensibles (email o password) exige reconfirmar
		// la contraseña actual — cambiar el email es también un vector de
		// recuperación de cuenta, no solo la contraseña. Un admin/superadmin
		// editando a OTRO usuario no necesita la contraseña del target.
		if isSelf && (body.Email != nil || body.Password != nil) {
			if body.CurrentPassword == nil || !userStore.VerifyPassword(target, *body.CurrentPassword) {
				return c.Status(401).JSON(fiber.Map{"error": "La contraseña actual no es correcta"})
			}
		}

		updated, err := userStore.UpdateUser(targetID, storage.UserUpdate{
			Name:                         body.Name,
			Email:                        body.Email,
			Password:                     body.Password,
			Role:                         body.Role,
			Active:                       body.Active,
			DailyVideoLimitOverride:      body.DailyVideoLimitOverride,
			ClearDailyVideoLimitOverride: body.ClearDailyVideoLimitOverride,
		})
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(updated.Public())
	})

	// Borrado: requiere sesión y sigue la misma jerarquía que la edición
	// (models.CanManageUser: superadmin y admin administran admin/editor,
	// nunca a un superadmin) — nunca sobre uno mismo, para no dejar el
	// sistema sin ningún usuario que pueda administrarlo.
	app.Delete("/api/users/:id", requireAuth, func(c *fiber.Ctx) error {
		caller := c.Locals("authUser").(*models.User)
		targetID := c.Params("id")
		target, ok := userStore.GetUser(targetID)
		if !ok {
			return c.Status(404).JSON(fiber.Map{"error": "Usuario no encontrado"})
		}
		if caller.ID == target.ID {
			return c.Status(400).JSON(fiber.Map{"error": "No podés eliminar tu propia cuenta"})
		}
		if !models.CanManageUser(caller.Role, target.Role) {
			return c.Status(403).JSON(fiber.Map{"error": "No tenés permiso para eliminar este usuario"})
		}
		userStore.DeleteUser(targetID)
		return c.SendStatus(204)
	})

	app.Get("/api/users/:id/video-usage", func(c *fiber.Ctx) error {
		user, ok := userStore.GetUser(c.Params("id"))
		if !ok {
			return c.Status(404).JSON(fiber.Map{"error": "Usuario no encontrado"})
		}
		_, limit, used := userStore.CanGenerateVideo(user)
		return c.JSON(fiber.Map{"user_id": user.ID, "role": user.Role, "limit": limit, "used_today": used})
	})

	// Video Engine Endpoints
	//
	// El caller debe autenticarse con "Authorization: Bearer <token>" (sesión
	// real emitida por /api/auth/login) para poder aplicar el límite diario de
	// renders por rol (hoy solo restringe a "editor"). Reemplaza al header
	// X-User-Id sin verificar que se usaba antes de que existiera login real:
	// ahora el caller no puede simplemente declarar quién es, tiene que probarlo
	// con una sesión válida.
	app.Post("/api/video/render", requireAuth, func(c *fiber.Ctx) error {
		user := c.Locals("authUser").(*models.User)
		if !user.Active {
			return c.Status(403).JSON(fiber.Map{"error": "Usuario inactivo"})
		}
		allowed, limit, used := userStore.CanGenerateVideo(user)
		if !allowed {
			return c.Status(429).JSON(fiber.Map{
				"error": fmt.Sprintf("Límite diario de %d videos alcanzado para el rol %s", limit, user.Role),
				"limit": limit,
				"used":  used,
			})
		}

		var req models.VideoRenderRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": err.Error()})
		}

		job := videoEngine.CreateJob(req)

		// Encolar el render para que lo procese el worker pool (limita cuántos
		// FFmpeg corren en paralelo). Si la cola está llena, se rechaza con 503
		// en vez de acumular trabajo ilimitado o tumbar el servidor.
		if err := videoEngine.Enqueue(job.ID); err != nil {
			return c.Status(503).JSON(fiber.Map{
				"error":  err.Error(),
				"job_id": job.ID,
			})
		}

		// Solo se cuenta contra el límite diario un render que efectivamente
		// se encoló (no un 503 por cola llena ni un 400 de validación previo).
		newUsage := userStore.IncrementVideoUsage(user.ID)

		return c.Status(202).JSON(fiber.Map{
			"message":     "Trabajo de renderizado de video encolado",
			"job_id":      job.ID,
			"job":         job,
			"video_usage": newUsage,
			"video_limit": limit,
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

	// Corre el servidor en una goroutine para poder escuchar señales de
	// apagado (Ctrl+C / docker stop) y hacer un shutdown ordenado: dejar de
	// aceptar conexiones y, sobre todo, forzar el flush final del store
	// (persistencia asíncrona) para no perder cambios en memoria pendientes.
	go func() {
		log.Printf("🚀 Prensa Abierta Go Core Engine corriendo en http://localhost%s", addr)
		if err := app.Listen(addr); err != nil {
			log.Fatalf("Error iniciando servidor Go: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit

	log.Println("[Shutdown] Señal recibida, cerrando servidor de forma ordenada...")
	if err := app.Shutdown(); err != nil {
		log.Printf("[Shutdown] Error al cerrar Fiber: %v", err)
	}

	poller.Stop()
	store.Close()     // fuerza el flush final de cualquier cambio pendiente a disco
	userStore.Close() // idem para users.json
	log.Println("[Shutdown] Apagado completo.")
}

// randomPassword genera una contraseña aleatoria legible (16 hex chars) para
// el superadmin sembrado al primer arranque, cuando no se configuró
// SEED_SUPERADMIN_PASSWORD explícitamente. Se loguea una sola vez para que
// el operador pueda entrar y cambiarla.
func randomPassword() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// Extremadamente improbable (fuente de entropía del SO caída); mejor
		// una contraseña previsible que un panic al arrancar el servidor.
		return "cambiar-esta-clave"
	}
	return hex.EncodeToString(b)
}
