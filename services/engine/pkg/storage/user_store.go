package storage

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prensa-abierta/ingestor-engine/pkg/models"
	"golang.org/x/crypto/bcrypt"
)

// refreshTokenTTL es cuánto dura el refresh token (5 días) antes de exigir un login nuevo con
// email/password. El access token (JWT, ver pkg/auth) dura mucho menos (15 min) y se renueva con el
// refresh token sin pedir credenciales de nuevo — ver POST /api/auth/refresh. Los refresh tokens
// viven solo en memoria (ver models.RefreshToken): reiniciar el proceso cierra las sesiones.
const refreshTokenTTL = 5 * 24 * time.Hour

// Códigos de error de PostgreSQL que el store traduce a errores de entrada.
const (
	pgUniqueViolation     = "23505"
	pgForeignKeyViolation = "23503"
)

var (
	// ErrUserNotFound: el usuario no existe (o el id no tiene formato de id).
	ErrUserNotFound = errors.New("usuario no encontrado")
	// ErrInvalidCredentials: email inexistente o contraseña incorrecta. Es el mismo error para
	// ambos casos a propósito, para no revelar qué correos están registrados.
	ErrInvalidCredentials = errors.New("credenciales inválidas")
	// ErrUserInactive: las credenciales son correctas pero la cuenta está desactivada.
	ErrUserInactive = errors.New("usuario inactivo")
	// ErrInvalidRefreshToken: el refresh token no existe, ya se usó o venció.
	ErrInvalidRefreshToken = errors.New("refresh token inválido o expirado")
)

// InputError es un error de datos enviados por el cliente (validación, correo duplicado, rol
// inexistente). Su texto se muestra tal cual al usuario y el handler lo responde como 400; los
// demás errores (base caída, etc.) son fallas internas y se responden como 500.
type InputError string

func (e InputError) Error() string { return string(e) }

// UserStore guarda usuarios, roles y el contador diario de videos en PostgreSQL.
type UserStore struct {
	pool *pgxpool.Pool
	// usageTZ es la zona horaria (nombre IANA) que define cuándo empieza el "día" del contador de
	// videos; la evalúa PostgreSQL, que trae su propia base de zonas horarias.
	usageTZ string

	// refreshTokens vive solo en memoria (ver refreshTokenTTL).
	refreshMu     sync.Mutex
	refreshTokens map[string]*models.RefreshToken
}

// NewUserStore crea el store sobre un pool ya conectado y con las migraciones aplicadas. Falla si
// usageTZ no es una zona horaria que PostgreSQL reconozca.
func NewUserStore(ctx context.Context, pool *pgxpool.Pool, usageTZ string) (*UserStore, error) {
	var probe time.Time
	if err := pool.QueryRow(ctx, `SELECT now() AT TIME ZONE $1`, usageTZ).Scan(&probe); err != nil {
		return nil, fmt.Errorf("zona horaria %q inválida: %w", usageTZ, err)
	}
	return &UserStore{
		pool:          pool,
		usageTZ:       usageTZ,
		refreshTokens: make(map[string]*models.RefreshToken),
	}, nil
}

// El usuario siempre se lee con su rol para traer el límite diario por defecto.
const (
	userColumns = `u.id, u.name, u.email, u.password_hash, u.role, u.active,
		u.daily_video_limit_override, r.daily_video_limit, u.created_at, u.updated_at`
	userFrom = ` FROM users u JOIN roles r ON r.name = u.role`
	// userFromCTE es lo mismo pero leyendo el resultado de un INSERT/UPDATE ... RETURNING declarado como
	// CTE `u`: el SELECT final NO puede leer la tabla users, porque no ve las filas que escribió la CTE.
	userFromCTE = ` FROM u JOIN roles r ON r.name = u.role`
	// usageToday es la fecha de hoy en la zona horaria configurada; el parámetro %d es el de usageTZ.
	usageToday = `(now() AT TIME ZONE $%d)::date`
)

func scanUser(row pgx.Row) (*models.User, error) {
	var (
		u        models.User
		id       int64
		role     string
		override *int
	)
	if err := row.Scan(&id, &u.Name, &u.Email, &u.PasswordHash, &role, &u.Active,
		&override, &u.RoleDailyVideoLimit, &u.CreatedAt, &u.UpdatedAt); err != nil {
		return nil, err
	}
	u.ID = strconv.FormatInt(id, 10)
	u.Role = models.Role(role)
	u.DailyVideoLimitOverride = override
	return &u, nil
}

// parseID convierte el id de la API (string) al bigint de la base; un id que no es un entero
// positivo (p. ej. un "usr_..." viejo dentro de un token anterior a la migración) no existe.
func parseID(id string) (int64, bool) {
	n, err := strconv.ParseInt(id, 10, 64)
	return n, err == nil && n > 0
}

func pgErrorCode(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return ""
}

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

// CreateUser guarda un usuario nuevo con su contraseña hasheada (bcrypt). Los datos inválidos y el
// correo repetido (sin distinguir mayúsculas) devuelven un InputError.
func (us *UserStore) CreateUser(ctx context.Context, name, email, password string, role models.Role) (*models.User, error) {
	name, email = strings.TrimSpace(name), strings.TrimSpace(email)
	if !role.IsValid() {
		return nil, InputError(fmt.Sprintf("rol inválido: %q", role))
	}
	if name == "" || email == "" {
		return nil, InputError("name y email son obligatorios")
	}
	if len(password) < 8 {
		return nil, InputError("la contraseña debe tener al menos 8 caracteres")
	}
	hash, err := hashPassword(password)
	if err != nil {
		return nil, fmt.Errorf("generar el hash de la contraseña: %w", err)
	}

	row := us.pool.QueryRow(ctx, `
		WITH u AS (
			INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)
			RETURNING *
		) SELECT `+userColumns+userFromCTE, name, email, hash, string(role))
	user, err := scanUser(row)
	switch {
	case err == nil:
		return user, nil
	case pgErrorCode(err) == pgUniqueViolation:
		return nil, InputError(fmt.Sprintf("ya existe un usuario con el email %q", email))
	case pgErrorCode(err) == pgForeignKeyViolation:
		return nil, InputError(fmt.Sprintf("rol inválido: %q", role))
	default:
		return nil, fmt.Errorf("crear usuario: %w", err)
	}
}

// VerifyPassword compara una contraseña en texto plano contra el hash guardado del usuario.
func (us *UserStore) VerifyPassword(user *models.User, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) == nil
}

var (
	dummyHashOnce sync.Once
	dummyHash     []byte
)

// burnPasswordCheck gasta el mismo tiempo que una verificación real cuando el correo no existe,
// para que el login no revele por su duración qué correos están registrados.
func burnPasswordCheck(password string) {
	dummyHashOnce.Do(func() { dummyHash, _ = bcrypt.GenerateFromPassword([]byte("no-such-user"), bcrypt.DefaultCost) })
	_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(password))
}

// VerifyCredentials resuelve el login: busca el usuario por correo (sin distinguir mayúsculas) y
// valida la contraseña. Devuelve ErrInvalidCredentials o ErrUserInactive; cualquier otro error es
// una falla de la base.
func (us *UserStore) VerifyCredentials(ctx context.Context, email, password string) (*models.User, error) {
	row := us.pool.QueryRow(ctx, `SELECT `+userColumns+userFrom+` WHERE lower(u.email) = lower($1)`, strings.TrimSpace(email))
	user, err := scanUser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		burnPasswordCheck(password)
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, fmt.Errorf("buscar usuario por correo: %w", err)
	}
	if !us.VerifyPassword(user, password) {
		return nil, ErrInvalidCredentials
	}
	if !user.Active {
		return nil, ErrUserInactive
	}
	return user, nil
}

// newRefreshTokenString genera el string opaco del refresh token (32 bytes aleatorios en hex).
func newRefreshTokenString() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generar el refresh token: %w", err)
	}
	return hex.EncodeToString(buf), nil
}

// CreateRefreshToken emite un refresh token nuevo (refreshTokenTTL) para un usuario ya autenticado.
// El access token (JWT) lo emite pkg/auth por separado: este store solo guarda el lado opaco.
func (us *UserStore) CreateRefreshToken(userID string) (*models.RefreshToken, error) {
	tokenStr, err := newRefreshTokenString()
	if err != nil {
		return nil, err
	}
	rt := &models.RefreshToken{Token: tokenStr, UserID: userID, ExpiresAt: time.Now().Add(refreshTokenTTL)}
	us.refreshMu.Lock()
	us.refreshTokens[rt.Token] = rt
	us.refreshMu.Unlock()
	return rt, nil
}

// RotateRefreshToken cambia un refresh token válido por uno nuevo (de un solo uso: el viejo se
// invalida en el mismo paso) y devuelve el usuario dueño, recargado de la base para ver su
// Active/Role más recientes. La expiración ABSOLUTA se conserva: refrescar no extiende la sesión
// más allá de refreshTokenTTL desde el login.
func (us *UserStore) RotateRefreshToken(ctx context.Context, oldToken string) (*models.RefreshToken, *models.User, error) {
	us.refreshMu.Lock()
	old, ok := us.refreshTokens[oldToken]
	if ok {
		delete(us.refreshTokens, oldToken)
	}
	us.refreshMu.Unlock()
	if !ok || time.Now().After(old.ExpiresAt) {
		return nil, nil, ErrInvalidRefreshToken
	}

	user, err := us.GetUser(ctx, old.UserID)
	if err != nil {
		return nil, nil, fmt.Errorf("usuario del refresh token: %w", err)
	}
	newTokenStr, err := newRefreshTokenString()
	if err != nil {
		return nil, nil, err
	}
	rotated := &models.RefreshToken{Token: newTokenStr, UserID: old.UserID, ExpiresAt: old.ExpiresAt}
	us.refreshMu.Lock()
	us.refreshTokens[rotated.Token] = rotated
	us.refreshMu.Unlock()
	return rotated, user, nil
}

// RevokeRefreshToken invalida un refresh token (logout). Idempotente.
func (us *UserStore) RevokeRefreshToken(token string) {
	if token == "" {
		return
	}
	us.refreshMu.Lock()
	delete(us.refreshTokens, token)
	us.refreshMu.Unlock()
}

// GetUser devuelve el usuario o ErrUserNotFound.
func (us *UserStore) GetUser(ctx context.Context, id string) (*models.User, error) {
	n, ok := parseID(id)
	if !ok {
		return nil, ErrUserNotFound
	}
	user, err := scanUser(us.pool.QueryRow(ctx, `SELECT `+userColumns+userFrom+` WHERE u.id = $1`, n))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("leer usuario: %w", err)
	}
	return user, nil
}

// GetAllUsers devuelve todos los usuarios, del más antiguo al más nuevo.
func (us *UserStore) GetAllUsers(ctx context.Context) ([]*models.User, error) {
	rows, err := us.pool.Query(ctx, `SELECT `+userColumns+userFrom+` ORDER BY u.id`)
	if err != nil {
		return nil, fmt.Errorf("listar usuarios: %w", err)
	}
	defer rows.Close()

	var users []*models.User
	for rows.Next() {
		user, err := scanUser(rows)
		if err != nil {
			return nil, fmt.Errorf("leer fila de usuario: %w", err)
		}
		users = append(users, user)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("listar usuarios: %w", err)
	}
	return users, nil
}

// CountUsers devuelve cuántos usuarios hay (para decidir si hay que sembrar el superadmin).
func (us *UserStore) CountUsers(ctx context.Context) (int, error) {
	var n int
	if err := us.pool.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&n); err != nil {
		return 0, fmt.Errorf("contar usuarios: %w", err)
	}
	return n, nil
}

// UserUpdate son los cambios parciales a aplicar sobre un usuario: los punteros nil dejan el campo
// como estaba. Los permisos de QUIÉN puede tocar QUÉ campo se validan en el handler HTTP antes de
// llamar a UpdateUser: el store solo aplica los cambios ya autorizados.
type UserUpdate struct {
	Name     *string
	Email    *string
	Password *string
	Role     *models.Role
	Active   *bool
	// DailyVideoLimitOverride, si no es nil, reemplaza el override actual. ClearDailyVideoLimitOverride,
	// si es true, lo borra (vuelve al default del rol) y tiene prioridad sobre el anterior.
	DailyVideoLimitOverride      *int
	ClearDailyVideoLimitOverride bool
}

// UpdateUser aplica los cambios y devuelve el usuario actualizado. ErrUserNotFound si no existe;
// InputError si los datos son inválidos o el correo ya está en uso.
func (us *UserStore) UpdateUser(ctx context.Context, id string, upd UserUpdate) (*models.User, error) {
	n, ok := parseID(id)
	if !ok {
		return nil, ErrUserNotFound
	}

	sets := []string{"updated_at = now()"}
	var args []any
	set := func(column string, value any) {
		args = append(args, value)
		sets = append(sets, fmt.Sprintf("%s = $%d", column, len(args)))
	}

	if upd.Role != nil {
		if !upd.Role.IsValid() {
			return nil, InputError(fmt.Sprintf("rol inválido: %q", *upd.Role))
		}
		set("role", string(*upd.Role))
	}
	if upd.Name != nil {
		set("name", strings.TrimSpace(*upd.Name))
	}
	email := ""
	if upd.Email != nil {
		email = strings.TrimSpace(*upd.Email)
		set("email", email)
	}
	if upd.Active != nil {
		set("active", *upd.Active)
	}
	if upd.Password != nil {
		if len(*upd.Password) < 8 {
			return nil, InputError("la contraseña debe tener al menos 8 caracteres")
		}
		hash, err := hashPassword(*upd.Password)
		if err != nil {
			return nil, fmt.Errorf("generar el hash de la contraseña: %w", err)
		}
		set("password_hash", hash)
	}
	if upd.ClearDailyVideoLimitOverride {
		sets = append(sets, "daily_video_limit_override = NULL")
	} else if upd.DailyVideoLimitOverride != nil {
		set("daily_video_limit_override", *upd.DailyVideoLimitOverride)
	}

	args = append(args, n)
	query := fmt.Sprintf(`
		WITH u AS (
			UPDATE users SET %s WHERE id = $%d RETURNING *
		) SELECT `+userColumns+userFromCTE, strings.Join(sets, ", "), len(args))
	user, err := scanUser(us.pool.QueryRow(ctx, query, args...))
	switch {
	case err == nil:
		return user, nil
	case errors.Is(err, pgx.ErrNoRows):
		return nil, ErrUserNotFound
	case pgErrorCode(err) == pgUniqueViolation:
		return nil, InputError(fmt.Sprintf("ya existe un usuario con el email %q", email))
	case pgErrorCode(err) == pgForeignKeyViolation:
		return nil, InputError("rol inválido")
	default:
		return nil, fmt.Errorf("actualizar usuario: %w", err)
	}
}

// DeleteUser borra al usuario (y, en cascada, su contador de videos). Devuelve false si no existía.
func (us *UserStore) DeleteUser(ctx context.Context, id string) (bool, error) {
	n, ok := parseID(id)
	if !ok {
		return false, nil
	}
	tag, err := us.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, n)
	if err != nil {
		return false, fmt.Errorf("borrar usuario: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// VideoUsageToday devuelve cuántos videos lleva el usuario hoy (día en la zona horaria configurada).
func (us *UserStore) VideoUsageToday(ctx context.Context, userID string) (int, error) {
	n, ok := parseID(userID)
	if !ok {
		return 0, nil
	}
	var used int
	err := us.pool.QueryRow(ctx, fmt.Sprintf(
		`SELECT COALESCE((SELECT count FROM video_usage WHERE user_id = $1 AND usage_date = `+usageToday+`), 0)`, 2),
		n, us.usageTZ).Scan(&used)
	if err != nil {
		return 0, fmt.Errorf("leer uso diario de videos: %w", err)
	}
	return used, nil
}

// VideoQuota devuelve el límite diario efectivo del usuario (-1 = sin límite) y lo usado hoy.
func (us *UserStore) VideoQuota(ctx context.Context, user *models.User) (limit, used int, err error) {
	used, err = us.VideoUsageToday(ctx, user.ID)
	return user.EffectiveDailyVideoLimit(), used, err
}

// ReserveVideoUsage suma 1 al contador de hoy SOLO si el usuario no llegó a su límite, en una única
// sentencia atómica: dos pedidos simultáneos no pueden pasarse del tope. ok=false significa límite
// alcanzado; used es lo consumido tras la operación. Quien reserva debe llamar a ReleaseVideoUsage si
// el render finalmente no se encola.
func (us *UserStore) ReserveVideoUsage(ctx context.Context, user *models.User) (ok bool, limit, used int, err error) {
	n, valid := parseID(user.ID)
	if !valid {
		return false, 0, 0, ErrUserNotFound
	}
	limit = user.EffectiveDailyVideoLimit()

	if limit == 0 { // el upsert crearía la fila con 1: con tope 0 no se debe reservar nada
		used, err = us.VideoUsageToday(ctx, user.ID)
		return false, limit, used, err
	}

	// Sin tope (-1) se cuenta igual (para mostrar "hoy has generado N"), pero sin condición.
	cond := ""
	args := []any{n, us.usageTZ}
	if limit > 0 {
		cond = " WHERE video_usage.count < $3"
		args = append(args, limit)
	}
	err = us.pool.QueryRow(ctx, fmt.Sprintf(`
		INSERT INTO video_usage (user_id, usage_date, count) VALUES ($1, `+usageToday+`, 1)
		ON CONFLICT (user_id, usage_date) DO UPDATE SET count = video_usage.count + 1`+cond+`
		RETURNING count`, 2), args...).Scan(&used)
	if errors.Is(err, pgx.ErrNoRows) { // el WHERE del upsert no se cumplió: ya está en el límite
		used, err = us.VideoUsageToday(ctx, user.ID)
		return false, limit, used, err
	}
	if err != nil {
		return false, limit, 0, fmt.Errorf("reservar uso de video: %w", err)
	}
	return true, limit, used, nil
}

// ReleaseVideoUsage devuelve una reserva de ReserveVideoUsage (p. ej. si la cola de renders estaba
// llena y el video no se encoló).
func (us *UserStore) ReleaseVideoUsage(ctx context.Context, userID string) error {
	n, ok := parseID(userID)
	if !ok {
		return nil
	}
	_, err := us.pool.Exec(ctx, fmt.Sprintf(
		`UPDATE video_usage SET count = GREATEST(count - 1, 0) WHERE user_id = $1 AND usage_date = `+usageToday, 2),
		n, us.usageTZ)
	if err != nil {
		return fmt.Errorf("liberar uso de video: %w", err)
	}
	return nil
}
