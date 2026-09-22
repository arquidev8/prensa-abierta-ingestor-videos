package storage

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/prensa-abierta/ingestor-engine/pkg/models"
	"golang.org/x/crypto/bcrypt"
)

// refreshTokenTTL es cuánto dura el refresh token (5 días) antes de exigir un
// login nuevo con email/password. El access token (JWT, ver pkg/auth) dura
// mucho menos (15 min) y se renueva con el refresh token sin pedir credenciales
// de nuevo — ver POST /api/auth/refresh. Los refresh tokens viven solo en
// memoria (ver models.RefreshToken), así que también se pierden si el proceso
// se reinicia (misma sesión que exigía credenciales de nuevo antes de este
// cambio; es un default aceptado para esta herramienta interna).
const refreshTokenTTL = 5 * 24 * time.Hour

// UserStore persiste usuarios/roles y el contador de uso diario de video en
// un archivo separado (users.json), aislado de db.json (noticias/media), a
// pedido explícito: es una tabla nueva que primero se prueba en local antes
// de pensar en cómo convivirá con el resto de la data en producción.
type UserStore struct {
	mu           sync.RWMutex
	users        map[string]*models.User
	videoUsage   map[string]*models.VideoUsage // key: userID + "|" + date (YYYY-MM-DD)
	dataFilePath string

	// refreshMu protege refreshTokens por separado de mu: nunca se persisten a
	// disco, así que no participan del flush debounced ni de "dirty" —
	// separarlas evita que el tráfico de login/autenticación/refresh contienda
	// por el mismo lock que las mutaciones que sí se persisten.
	refreshMu     sync.Mutex
	refreshTokens map[string]*models.RefreshToken

	dirty  bool
	stopCh chan struct{}
	wg     sync.WaitGroup
}

// NewUserStore inicializa el store de usuarios, cargando users.json si existe
// y arrancando el mismo patrón de persistencia debounced/atómica que Store.
func NewUserStore(dataDir string) *UserStore {
	_ = os.MkdirAll(dataDir, 0755)
	us := &UserStore{
		users:         make(map[string]*models.User),
		videoUsage:    make(map[string]*models.VideoUsage),
		refreshTokens: make(map[string]*models.RefreshToken),
		dataFilePath:  filepath.Join(dataDir, "users.json"),
		stopCh:        make(chan struct{}),
	}
	us.loadFromFile()

	us.wg.Add(1)
	go us.persistLoop()

	return us
}

func usageKey(userID, date string) string {
	return userID + "|" + date
}

// CreateUser genera un ID nuevo y guarda el usuario con su contraseña
// hasheada (bcrypt). Devuelve error si el rol no es válido, si falta algún
// campo obligatorio, si la contraseña es demasiado corta, o si el email ya
// está en uso (case-insensitive-ish: se compara tal cual llega).
func (us *UserStore) CreateUser(name, email, password string, role models.Role) (*models.User, error) {
	if !role.IsValid() {
		return nil, fmt.Errorf("rol inválido: %q", role)
	}
	if name == "" || email == "" {
		return nil, fmt.Errorf("name y email son obligatorios")
	}
	if len(password) < 8 {
		return nil, fmt.Errorf("la contraseña debe tener al menos 8 caracteres")
	}
	hash, err := hashPassword(password)
	if err != nil {
		return nil, fmt.Errorf("no se pudo generar el hash de la contraseña: %w", err)
	}

	us.mu.Lock()
	defer us.mu.Unlock()

	for _, existing := range us.users {
		if existing.Email == email {
			return nil, fmt.Errorf("ya existe un usuario con el email %q", email)
		}
	}

	now := time.Now()
	user := &models.User{
		ID:           fmt.Sprintf("usr_%d", now.UnixNano()),
		Name:         name,
		Email:        email,
		PasswordHash: hash,
		Role:         role,
		Active:       true,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	us.users[user.ID] = user
	us.dirty = true
	return user, nil
}

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

// VerifyPassword compara una contraseña en texto plano contra el hash
// guardado del usuario.
func (us *UserStore) VerifyPassword(user *models.User, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) == nil
}

// VerifyCredentials resuelve el login: busca el usuario por email y valida
// la contraseña. Un email inexistente y una contraseña incorrecta devuelven
// exactamente el mismo error, para no filtrar por timing/mensaje si un email
// está o no registrado.
func (us *UserStore) VerifyCredentials(email, password string) (*models.User, error) {
	us.mu.RLock()
	var match *models.User
	for _, u := range us.users {
		if u.Email == email {
			match = u
			break
		}
	}
	us.mu.RUnlock()

	if match == nil || !us.VerifyPassword(match, password) {
		return nil, fmt.Errorf("credenciales inválidas")
	}
	if !match.Active {
		return nil, fmt.Errorf("usuario inactivo")
	}
	return match, nil
}

// newRefreshTokenString genera el string opaco del refresh token (32 bytes
// aleatorios en hex), mismo patrón que ya usaban las sesiones antes de JWT.
func newRefreshTokenString() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("no se pudo generar el refresh token: %w", err)
	}
	return hex.EncodeToString(buf), nil
}

// CreateRefreshToken emite un refresh token nuevo (refreshTokenTTL, 5 días) para
// el usuario ya autenticado por VerifyCredentials. El access token (JWT) de cada
// login/refresh lo emite pkg/auth por separado — este store solo guarda el lado
// opaco y de larga vida.
func (us *UserStore) CreateRefreshToken(userID string) (*models.RefreshToken, error) {
	tokenStr, err := newRefreshTokenString()
	if err != nil {
		return nil, err
	}
	rt := &models.RefreshToken{
		Token:     tokenStr,
		UserID:    userID,
		ExpiresAt: time.Now().Add(refreshTokenTTL),
	}
	us.refreshMu.Lock()
	us.refreshTokens[rt.Token] = rt
	us.refreshMu.Unlock()
	return rt, nil
}

// RotateRefreshToken cambia un refresh token válido por uno nuevo (de un solo
// uso: el viejo se invalida en el mismo paso) y devuelve el usuario dueño, ya
// recargado del store (para que el caller vea su Active/Role más recientes, no
// los que tenía al momento del login). La expiración ABSOLUTA se conserva del
// token original — refrescar no extiende la sesión más allá de los 5 días desde
// el login, aunque el usuario esté usando la app activamente todo ese tiempo.
func (us *UserStore) RotateRefreshToken(oldToken string) (*models.RefreshToken, *models.User, error) {
	us.refreshMu.Lock()
	old, ok := us.refreshTokens[oldToken]
	if ok {
		delete(us.refreshTokens, oldToken) // de un solo uso: se invalida se use o no la rotación
	}
	expired := ok && time.Now().After(old.ExpiresAt)
	us.refreshMu.Unlock()

	if !ok || expired {
		return nil, nil, fmt.Errorf("refresh token inválido o expirado")
	}

	user, exists := us.GetUser(old.UserID)
	if !exists {
		return nil, nil, fmt.Errorf("el usuario del refresh token ya no existe")
	}

	newTokenStr, err := newRefreshTokenString()
	if err != nil {
		return nil, nil, err
	}
	rotated := &models.RefreshToken{
		Token:     newTokenStr,
		UserID:    old.UserID,
		ExpiresAt: old.ExpiresAt, // absoluto: no se reinicia el conteo de 5 días
	}
	us.refreshMu.Lock()
	us.refreshTokens[rotated.Token] = rotated
	us.refreshMu.Unlock()

	return rotated, user, nil
}

// RevokeRefreshToken invalida un refresh token (usado en logout). Idempotente:
// no es error llamarlo con un token que ya no existe o nunca existió.
func (us *UserStore) RevokeRefreshToken(token string) {
	if token == "" {
		return
	}
	us.refreshMu.Lock()
	delete(us.refreshTokens, token)
	us.refreshMu.Unlock()
}

func (us *UserStore) GetUser(id string) (*models.User, bool) {
	us.mu.RLock()
	defer us.mu.RUnlock()
	user, ok := us.users[id]
	return user, ok
}

func (us *UserStore) GetAllUsers() []*models.User {
	us.mu.RLock()
	defer us.mu.RUnlock()
	list := make([]*models.User, 0, len(us.users))
	for _, u := range us.users {
		list = append(list, u)
	}
	return list
}

// UserUpdate son los cambios parciales a aplicar sobre un usuario: los
// punteros nil dejan el campo como estaba. Los permisos de QUIÉN puede tocar
// QUÉ campo (self vs. admin vs. superadmin, confirmación de contraseña
// actual, etc.) se validan en el handler HTTP antes de llamar a UpdateUser —
// el store solo aplica los cambios ya autorizados.
type UserUpdate struct {
	Name     *string
	Email    *string
	Password *string
	Role     *models.Role
	Active   *bool
	// DailyVideoLimitOverride, si no es nil, reemplaza el override actual.
	// ClearDailyVideoLimitOverride, si es true, lo borra (vuelve al default
	// del rol) — tiene prioridad sobre DailyVideoLimitOverride si ambos vienen.
	DailyVideoLimitOverride      *int
	ClearDailyVideoLimitOverride bool
}

func (us *UserStore) UpdateUser(id string, upd UserUpdate) (*models.User, error) {
	var newHash string
	if upd.Password != nil {
		if len(*upd.Password) < 8 {
			return nil, fmt.Errorf("la contraseña debe tener al menos 8 caracteres")
		}
		hash, err := hashPassword(*upd.Password)
		if err != nil {
			return nil, fmt.Errorf("no se pudo generar el hash de la contraseña: %w", err)
		}
		newHash = hash
	}

	us.mu.Lock()
	defer us.mu.Unlock()

	user, ok := us.users[id]
	if !ok {
		return nil, fmt.Errorf("usuario %q no encontrado", id)
	}
	if upd.Role != nil {
		if !upd.Role.IsValid() {
			return nil, fmt.Errorf("rol inválido: %q", *upd.Role)
		}
		user.Role = *upd.Role
	}
	if upd.Name != nil {
		user.Name = *upd.Name
	}
	if upd.Email != nil {
		for otherID, existing := range us.users {
			if otherID != id && existing.Email == *upd.Email {
				return nil, fmt.Errorf("ya existe un usuario con el email %q", *upd.Email)
			}
		}
		user.Email = *upd.Email
	}
	if upd.Active != nil {
		user.Active = *upd.Active
	}
	if newHash != "" {
		user.PasswordHash = newHash
	}
	if upd.ClearDailyVideoLimitOverride {
		user.DailyVideoLimitOverride = nil
	} else if upd.DailyVideoLimitOverride != nil {
		user.DailyVideoLimitOverride = upd.DailyVideoLimitOverride
	}
	user.UpdatedAt = time.Now()
	us.dirty = true
	return user, nil
}

func (us *UserStore) DeleteUser(id string) bool {
	us.mu.Lock()
	defer us.mu.Unlock()
	if _, ok := us.users[id]; !ok {
		return false
	}
	delete(us.users, id)
	us.dirty = true
	return true
}

// VideoUsageToday devuelve cuánto lleva usado hoy un usuario.
func (us *UserStore) VideoUsageToday(userID string) int {
	us.mu.RLock()
	defer us.mu.RUnlock()
	today := time.Now().Format("2006-01-02")
	if usage, ok := us.videoUsage[usageKey(userID, today)]; ok {
		return usage.Count
	}
	return 0
}

// CanGenerateVideo evalúa el límite diario efectivo del usuario (su override
// personal si tiene uno, si no el del rol) contra su uso de hoy. limit=-1
// significa sin límite.
func (us *UserStore) CanGenerateVideo(user *models.User) (allowed bool, limit int, used int) {
	limit = user.EffectiveDailyVideoLimit()
	used = us.VideoUsageToday(user.ID)
	if limit < 0 {
		return true, limit, used
	}
	return used < limit, limit, used
}

// IncrementVideoUsage suma 1 al contador de hoy para el usuario y devuelve
// el nuevo total. Debe llamarse solo tras confirmar CanGenerateVideo y
// encolar el render, para no contar intentos rechazados.
func (us *UserStore) IncrementVideoUsage(userID string) int {
	us.mu.Lock()
	defer us.mu.Unlock()
	today := time.Now().Format("2006-01-02")
	key := usageKey(userID, today)
	usage, ok := us.videoUsage[key]
	if !ok {
		usage = &models.VideoUsage{UserID: userID, Date: today}
		us.videoUsage[key] = usage
	}
	usage.Count++
	us.dirty = true
	return usage.Count
}

func (us *UserStore) persistLoop() {
	defer us.wg.Done()
	ticker := time.NewTicker(persistDebounceInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			us.flushIfDirty()
		case <-us.stopCh:
			us.flushIfDirty()
			return
		}
	}
}

func (us *UserStore) flushIfDirty() {
	us.mu.Lock()
	if !us.dirty {
		us.mu.Unlock()
		return
	}
	us.dirty = false
	data := map[string]interface{}{
		"users":       us.users,
		"video_usage": us.videoUsage,
	}
	bytes, err := json.MarshalIndent(data, "", "  ")
	us.mu.Unlock()

	if err != nil {
		log.Printf("[UserStore] Error serializando datos para persistencia: %v", err)
		return
	}
	if err := writeFileAtomic(us.dataFilePath, bytes); err != nil {
		log.Printf("[UserStore] Error escribiendo %s: %v", us.dataFilePath, err)
	}
}

// Close detiene el loop de persistencia y espera el flush final. Debe
// llamarse durante el apagado ordenado del server, igual que Store.Close().
func (us *UserStore) Close() {
	close(us.stopCh)
	us.wg.Wait()
}

func (us *UserStore) loadFromFile() {
	bytes, err := os.ReadFile(us.dataFilePath)
	if err != nil {
		return
	}
	var data struct {
		Users      map[string]*models.User       `json:"users"`
		VideoUsage map[string]*models.VideoUsage `json:"video_usage"`
	}
	if err := json.Unmarshal(bytes, &data); err == nil {
		if data.Users != nil {
			us.users = data.Users
		}
		if data.VideoUsage != nil {
			us.videoUsage = data.VideoUsage
		}
	}
}
