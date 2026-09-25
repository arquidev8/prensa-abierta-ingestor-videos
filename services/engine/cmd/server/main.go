package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/prensa-abierta/ingestor-engine/pkg/auth"
	"github.com/prensa-abierta/ingestor-engine/pkg/db"
	"github.com/prensa-abierta/ingestor-engine/pkg/matcher"
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

	// Usuarios, roles y contador diario de videos viven en PostgreSQL. Las migraciones de esquema
	// (pkg/db/migrations) se aplican solas al arrancar, así que un deploy deja la base al día.
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		log.Fatal("[DB] Falta DATABASE_URL (ej. postgres://usuario:clave@host:5432/base?sslmode=disable): usuarios y roles se guardan en PostgreSQL")
	}
	usageTZ := strings.TrimSpace(os.Getenv("USAGE_TIMEZONE"))
	if usageTZ == "" {
		usageTZ = "America/Puerto_Rico" // el "día" del límite de videos cambia a medianoche de Puerto Rico
	}

	startupCtx, cancelStartup := context.WithTimeout(context.Background(), 2*time.Minute)
	pool, err := db.Connect(startupCtx, databaseURL)
	if err != nil {
		log.Fatalf("[DB] %v", err)
	}
	if err := db.Migrate(databaseURL); err != nil {
		log.Fatalf("[DB] %v", err)
	}
	userStore, err := storage.NewUserStore(startupCtx, pool, usageTZ)
	if err != nil {
		log.Fatalf("[DB] %v", err)
	}
	if err := seedInitialUsers(startupCtx, userStore, dataDir); err != nil {
		log.Fatalf("[UserStore] %v", err)
	}
	cancelStartup()

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

	sourceLogoByID := make(map[string]string, len(sources))
	for _, src := range sources {
		sourceLogoByID[src.ID] = src.LogoURL
	}

	// Matcher: detecta, entre estas mismas 5 fuentes, qué noticias cubren el
	// mismo evento (RawNews.RelatedSources). Umbral y ventana ajustables por env
	// sin recompilar, mientras se afina con datos reales.
	matcherCfg := matcher.DefaultConfig()
	if raw := os.Getenv("RELATED_NEWS_SIMILARITY_THRESHOLD"); raw != "" {
		if v, err := strconv.ParseFloat(raw, 64); err == nil && v > 0 && v <= 1 {
			matcherCfg.Threshold = v
		} else {
			log.Printf("[Warning] RELATED_NEWS_SIMILARITY_THRESHOLD inválido ('%s'), usando default %.2f", raw, matcherCfg.Threshold)
		}
	}
	if raw := os.Getenv("RELATED_NEWS_WINDOW_HOURS"); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			matcherCfg.WindowHours = v
		} else {
			log.Printf("[Warning] RELATED_NEWS_WINDOW_HOURS inválido ('%s'), usando default %d", raw, matcherCfg.WindowHours)
		}
	}

	// ingestRawNews es el único punto de entrada de una noticia cruda al store:
	// la guarda y de inmediato busca (y enlaza en ambos sentidos) coincidencias
	// con lo ya ingerido de las OTRAS fuentes. La usan tanto el poller continuo
	// como el sondeo manual (/api/news/poll), para que el matching nunca se
	// desalinee entre esos dos caminos.
	ingestRawNews := func(item *models.RawNews) {
		store.SaveRawNews(item)
		pool := store.GetAllRawNewsDeduped() // sin copias: no se compara ni se enlaza contra duplicados
		for _, m := range matcher.FindMatches(item, pool, matcherCfg, sourceLogoByID) {
			store.AppendRelatedSource(item.ID, m.Related, matcherCfg.MaxMatches)
			store.AppendRelatedSource(m.CandidateID, matcher.RelatedSourceFor(item, m.Related.Similarity, sourceLogoByID), matcherCfg.MaxMatches)
		}
	}

	// Migración única de datos ya guardados: algunos medios (ej. Telemundo PR) mandaban
	// el artículo completo como HTML en el resumen y quedó con etiquetas <p> literales.
	// Idempotente: solo toca resúmenes que todavía traen HTML.
	if n := store.MutateAllRawNews(scraper.SanitizeRawNewsSummary); n > 0 {
		log.Printf("[Store] %d resúmenes con HTML limpiados (texto plano)", n)
	}

	// Backfill único: enlaza entre sí lo que ya estaba en db.json antes de que
	// este matcher existiera. Corre una sola vez en segundo plano, no bloquea
	// el arranque del servidor.
	go matcher.BackfillAll(store, matcherCfg, sourceLogoByID)

	poller := scraper.NewPoller(sources, func(news *models.RawNews) {
		ingestRawNews(news)
		log.Printf("[Ingestor PR] 📰 Nueva noticia guardada: [%s] %s", news.SourceName, news.Title)
	})

	// Sembrar los hashes ya guardados: sin esto, cada reinicio re-ingería todo lo que traen
	// los feeds con IDs nuevos (63% de lo guardado eran copias) y repetía el pedido de
	// og:image de cada nota sin imagen.
	// También se siembra el link normalizado: así una nota que el medio re-publica con el
	// titular editado tampoco entra como noticia nueva.
	poller.MarkSeenNews(store.GetAllRawNews())

	// Completar en segundo plano las notas YA guardadas sin imagen (La Perla del Sur, WAPA):
	// como quedaron sembradas arriba, el poller no las vuelve a ingerir.
	go func() {
		attempted, recovered := poller.BackfillImages(store, time.Time{})
		if attempted > 0 {
			log.Printf("[Images] Backfill: %d de %d notas guardadas sin imagen recuperaron su imagen", recovered, attempted)
		}
	}()
	// Y reintentar cada 20 min las de las últimas 24 h que sigan sin imagen (un 429 o un
	// timeout en el pedido inicial no debe dejarlas sin foto para siempre).
	poller.StartImageRetryLoop(store, 20*time.Minute, 24*time.Hour)

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
		// Una noticia por medio+link: el store guarda copias viejas (de reinicios del Engine)
		// y versiones con el titular editado que no deben verse como cards repetidas.
		items := store.GetAllRawNewsDeduped()
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
				ingestRawNews(item)
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

	// internalError registra la falla real (una sola vez, acá) y responde un 500 genérico: el detalle
	// de la base no debe llegar al cliente.
	internalError := func(c *fiber.Ctx, err error) error {
		log.Printf("[API] %s %s: %v", c.Method(), c.Path(), err)
		return c.Status(500).JSON(fiber.Map{"error": "Error interno del servidor"})
	}

	// userError traduce los errores del UserStore: datos inválidos → 400, inexistente → 404, resto → 500.
	userError := func(c *fiber.Ctx, err error) error {
		var input storage.InputError
		switch {
		case errors.As(err, &input):
			return c.Status(400).JSON(fiber.Map{"error": input.Error()})
		case errors.Is(err, storage.ErrUserNotFound):
			return c.Status(404).JSON(fiber.Map{"error": "Usuario no encontrado"})
		default:
			return internalError(c, err)
		}
	}

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
		user, err := userStore.GetUser(c.UserContext(), userID)
		if errors.Is(err, storage.ErrUserNotFound) {
			return c.Status(401).JSON(fiber.Map{"error": "El usuario de este token ya no existe"})
		}
		if err != nil {
			return internalError(c, err)
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
		user, err := userStore.VerifyCredentials(c.UserContext(), body.Email, body.Password)
		if errors.Is(err, storage.ErrInvalidCredentials) || errors.Is(err, storage.ErrUserInactive) {
			return c.Status(401).JSON(fiber.Map{"error": err.Error()})
		}
		if err != nil {
			return internalError(c, err)
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
		rotated, user, err := userStore.RotateRefreshToken(c.UserContext(), body.RefreshToken)
		if errors.Is(err, storage.ErrInvalidRefreshToken) || errors.Is(err, storage.ErrUserNotFound) {
			return c.Status(401).JSON(fiber.Map{"error": "Sesión vencida, iniciá sesión de nuevo"})
		}
		if err != nil {
			return internalError(c, err)
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
		all, err := userStore.GetAllUsers(c.UserContext())
		if err != nil {
			return internalError(c, err)
		}
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
		user, err := userStore.CreateUser(c.UserContext(), body.Name, body.Email, body.Password, body.Role)
		if err != nil {
			return userError(c, err)
		}
		return c.Status(201).JSON(user.Public())
	})

	app.Get("/api/users/:id", func(c *fiber.Ctx) error {
		user, err := userStore.GetUser(c.UserContext(), c.Params("id"))
		if err != nil {
			return userError(c, err)
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
		target, err := userStore.GetUser(c.UserContext(), targetID)
		if err != nil {
			return userError(c, err)
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

		updated, err := userStore.UpdateUser(c.UserContext(), targetID, storage.UserUpdate{
			Name:                         body.Name,
			Email:                        body.Email,
			Password:                     body.Password,
			Role:                         body.Role,
			Active:                       body.Active,
			DailyVideoLimitOverride:      body.DailyVideoLimitOverride,
			ClearDailyVideoLimitOverride: body.ClearDailyVideoLimitOverride,
		})
		if err != nil {
			return userError(c, err)
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
		target, err := userStore.GetUser(c.UserContext(), targetID)
		if err != nil {
			return userError(c, err)
		}
		if caller.ID == target.ID {
			return c.Status(400).JSON(fiber.Map{"error": "No podés eliminar tu propia cuenta"})
		}
		if !models.CanManageUser(caller.Role, target.Role) {
			return c.Status(403).JSON(fiber.Map{"error": "No tenés permiso para eliminar este usuario"})
		}
		if _, err := userStore.DeleteUser(c.UserContext(), targetID); err != nil {
			return internalError(c, err)
		}
		return c.SendStatus(204)
	})

	app.Get("/api/users/:id/video-usage", func(c *fiber.Ctx) error {
		user, err := userStore.GetUser(c.UserContext(), c.Params("id"))
		if err != nil {
			return userError(c, err)
		}
		limit, used, err := userStore.VideoQuota(c.UserContext(), user)
		if err != nil {
			return internalError(c, err)
		}
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
		var req models.VideoRenderRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": err.Error()})
		}

		// La cuota se reserva de forma atómica en la base (dos pedidos simultáneos no pueden pasarse
		// del tope) y se devuelve si el render finalmente no se encola.
		allowed, limit, used, err := userStore.ReserveVideoUsage(c.UserContext(), user)
		if err != nil {
			return internalError(c, err)
		}
		if !allowed {
			return c.Status(429).JSON(fiber.Map{
				"error": fmt.Sprintf("Límite diario de %d videos alcanzado para el rol %s", limit, user.Role),
				"limit": limit,
				"used":  used,
			})
		}

		job := videoEngine.CreateJob(req)

		// Encolar el render para que lo procese el worker pool (limita cuántos
		// FFmpeg corren en paralelo). Si la cola está llena, se rechaza con 503
		// en vez de acumular trabajo ilimitado o tumbar el servidor.
		if err := videoEngine.Enqueue(job.ID); err != nil {
			if relErr := userStore.ReleaseVideoUsage(c.UserContext(), user.ID); relErr != nil {
				log.Printf("[API] no se pudo liberar la cuota de video de %s: %v", user.ID, relErr)
			}
			return c.Status(503).JSON(fiber.Map{
				"error":  err.Error(),
				"job_id": job.ID,
			})
		}

		return c.Status(202).JSON(fiber.Map{
			"message":     "Trabajo de renderizado de video encolado",
			"job_id":      job.ID,
			"job":         job,
			"video_usage": used,
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
	store.Close() // fuerza el flush final de cualquier cambio pendiente a disco
	pool.Close()  // cierra las conexiones a PostgreSQL
	log.Println("[Shutdown] Apagado completo.")
}

// seedInitialUsers deja la base lista para el primer arranque: si no hay usuarios, importa los del
// users.json de la versión anterior (si existe) y, si tampoco hay, siembra el superadmin inicial con
// SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD (sin contraseña se genera una y se imprime UNA vez
// en el log). Con usuarios ya cargados no hace nada.
func seedInitialUsers(ctx context.Context, userStore *storage.UserStore, dataDir string) error {
	count, err := userStore.CountUsers(ctx)
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	legacyPath := filepath.Join(dataDir, "users.json")
	imported, err := userStore.ImportLegacyUsers(ctx, legacyPath)
	if err != nil {
		return fmt.Errorf("importar el users.json anterior: %w", err)
	}
	if imported > 0 {
		log.Printf("[UserStore] Se importaron %d usuario(s) desde %s (el archivo quedó como users.json.migrated)", imported, legacyPath)
		return nil
	}

	seedEmail := os.Getenv("SEED_SUPERADMIN_EMAIL")
	if seedEmail == "" {
		seedEmail = "admin@prensaabierta.com"
	}
	seedPassword := os.Getenv("SEED_SUPERADMIN_PASSWORD")
	generated := seedPassword == ""
	if generated {
		seedPassword = randomPassword()
	}
	seedUser, err := userStore.CreateUser(ctx, "Superadmin", seedEmail, seedPassword, models.RoleSuperAdmin)
	if err != nil {
		return fmt.Errorf("sembrar el superadmin inicial: %w", err)
	}
	if generated {
		log.Printf("[UserStore] Superadmin inicial creado: email=%s password=%s (generada, cambiarla apenas se inicie sesión; login vía POST /api/auth/login)", seedUser.Email, seedPassword)
	} else {
		log.Printf("[UserStore] Superadmin inicial creado: email=%s (password de SEED_SUPERADMIN_PASSWORD; login vía POST /api/auth/login)", seedUser.Email)
	}
	return nil
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
