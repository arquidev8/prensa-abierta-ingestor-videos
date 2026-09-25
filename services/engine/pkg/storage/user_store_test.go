package storage_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prensa-abierta/ingestor-engine/pkg/db"
	"github.com/prensa-abierta/ingestor-engine/pkg/models"
	"github.com/prensa-abierta/ingestor-engine/pkg/storage"
	"golang.org/x/crypto/bcrypt"
)

const testTZ = "America/Puerto_Rico"

// newTestStore abre la base de TEST_DATABASE_URL, aplica las migraciones y la deja vacía. Las pruebas
// de integración se omiten si la variable no está definida (así `go test ./...` no exige PostgreSQL).
func newTestStore(t *testing.T) (*storage.UserStore, *pgxpool.Pool) {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL no está definida: se omiten las pruebas con PostgreSQL")
	}
	ctx := context.Background()

	pool, err := db.Connect(ctx, url)
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := db.Migrate(url); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	if _, err := pool.Exec(ctx, `TRUNCATE users RESTART IDENTITY CASCADE`); err != nil {
		t.Fatalf("limpiar tablas: %v", err)
	}
	store, err := storage.NewUserStore(ctx, pool, testTZ)
	if err != nil {
		t.Fatalf("NewUserStore: %v", err)
	}
	return store, pool
}

func mustCreate(t *testing.T, store *storage.UserStore, email string, role models.Role) *models.User {
	t.Helper()
	u, err := store.CreateUser(context.Background(), "Persona "+email, email, "Password123", role)
	if err != nil {
		t.Fatalf("CreateUser(%s): %v", email, err)
	}
	return u
}

func TestMigrateIsIdempotent(t *testing.T) {
	newTestStore(t)
	if err := db.Migrate(os.Getenv("TEST_DATABASE_URL")); err != nil {
		t.Fatalf("segunda ejecución de Migrate: %v", err)
	}
}

func TestCreateUser(t *testing.T) {
	store, _ := newTestStore(t)
	ctx := context.Background()
	mustCreate(t, store, "ana@prensa.pr", models.RoleEditor)

	tests := []struct {
		name      string
		userName  string
		email     string
		password  string
		role      models.Role
		wantInput bool
	}{
		{"válido", "Luis", "luis@prensa.pr", "Password123", models.RoleAdmin, false},
		{"correo repetido con otras mayúsculas", "Ana 2", "ANA@Prensa.PR", "Password123", models.RoleEditor, true},
		{"rol inexistente", "Rol", "rol@prensa.pr", "Password123", models.Role("dios"), true},
		{"contraseña corta", "Corta", "corta@prensa.pr", "short", models.RoleEditor, true},
		{"sin nombre", "  ", "sinnombre@prensa.pr", "Password123", models.RoleEditor, true},
		{"sin correo", "Sin correo", " ", "Password123", models.RoleEditor, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			u, err := store.CreateUser(ctx, tt.userName, tt.email, tt.password, tt.role)
			var input storage.InputError
			if tt.wantInput {
				if !errors.As(err, &input) {
					t.Fatalf("esperaba InputError, obtuve %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("no esperaba error: %v", err)
			}
			if u.ID == "" || u.Role != tt.role || !u.Active || u.PasswordHash == "" {
				t.Errorf("usuario mal armado: %+v", u)
			}
		})
	}
}

func TestVerifyCredentials(t *testing.T) {
	store, _ := newTestStore(t)
	ctx := context.Background()
	mustCreate(t, store, "Ana@Prensa.pr", models.RoleEditor)
	inactive := mustCreate(t, store, "off@prensa.pr", models.RoleEditor)
	off := false
	if _, err := store.UpdateUser(ctx, inactive.ID, storage.UserUpdate{Active: &off}); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name     string
		email    string
		password string
		wantErr  error
	}{
		{"correcto", "Ana@Prensa.pr", "Password123", nil},
		{"correo sin distinguir mayúsculas", "ana@prensa.PR", "Password123", nil},
		{"contraseña incorrecta", "ana@prensa.pr", "otra-clave", storage.ErrInvalidCredentials},
		{"correo inexistente", "nadie@prensa.pr", "Password123", storage.ErrInvalidCredentials},
		{"cuenta inactiva", "off@prensa.pr", "Password123", storage.ErrUserInactive},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			u, err := store.VerifyCredentials(ctx, tt.email, tt.password)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("error = %v, esperaba %v", err, tt.wantErr)
			}
			if tt.wantErr == nil && u == nil {
				t.Fatal("esperaba el usuario")
			}
		})
	}
}

func TestUpdateUser(t *testing.T) {
	store, _ := newTestStore(t)
	ctx := context.Background()
	a := mustCreate(t, store, "a@prensa.pr", models.RoleEditor)
	mustCreate(t, store, "b@prensa.pr", models.RoleEditor)

	str := func(s string) *string { return &s }
	num := func(n int) *int { return &n }
	role := func(r models.Role) *models.Role { return &r }

	t.Run("nombre y correo", func(t *testing.T) {
		u, err := store.UpdateUser(ctx, a.ID, storage.UserUpdate{Name: str("Nuevo"), Email: str("nuevo@prensa.pr")})
		if err != nil || u.Name != "Nuevo" || u.Email != "nuevo@prensa.pr" {
			t.Fatalf("u=%+v err=%v", u, err)
		}
		if !u.UpdatedAt.After(a.UpdatedAt) {
			t.Error("updated_at no avanzó")
		}
	})
	t.Run("correo ya usado por otro", func(t *testing.T) {
		_, err := store.UpdateUser(ctx, a.ID, storage.UserUpdate{Email: str("B@PRENSA.PR")})
		var input storage.InputError
		if !errors.As(err, &input) {
			t.Fatalf("esperaba InputError, obtuve %v", err)
		}
	})
	t.Run("rol y override de límite", func(t *testing.T) {
		u, err := store.UpdateUser(ctx, a.ID, storage.UserUpdate{Role: role(models.RoleAdmin), DailyVideoLimitOverride: num(9)})
		if err != nil || u.Role != models.RoleAdmin || u.DailyVideoLimitOverride == nil || *u.DailyVideoLimitOverride != 9 {
			t.Fatalf("u=%+v err=%v", u, err)
		}
		if got := u.EffectiveDailyVideoLimit(); got != 9 {
			t.Errorf("límite efectivo = %d, esperaba 9 (override)", got)
		}
		u, err = store.UpdateUser(ctx, a.ID, storage.UserUpdate{ClearDailyVideoLimitOverride: true})
		if err != nil || u.DailyVideoLimitOverride != nil {
			t.Fatalf("no se limpió el override: %+v err=%v", u, err)
		}
		if got := u.EffectiveDailyVideoLimit(); got != -1 {
			t.Errorf("límite efectivo = %d, esperaba -1 (rol admin)", got)
		}
	})
	t.Run("cambio de contraseña", func(t *testing.T) {
		if _, err := store.UpdateUser(ctx, a.ID, storage.UserUpdate{Password: str("NuevaClave456")}); err != nil {
			t.Fatal(err)
		}
		if _, err := store.VerifyCredentials(ctx, "nuevo@prensa.pr", "NuevaClave456"); err != nil {
			t.Errorf("la clave nueva no entra: %v", err)
		}
		if _, err := store.VerifyCredentials(ctx, "nuevo@prensa.pr", "Password123"); !errors.Is(err, storage.ErrInvalidCredentials) {
			t.Errorf("la clave vieja sigue entrando: %v", err)
		}
	})
	t.Run("entradas inválidas", func(t *testing.T) {
		for name, upd := range map[string]storage.UserUpdate{
			"rol inexistente":  {Role: role("dios")},
			"contraseña corta": {Password: str("corta")},
		} {
			var input storage.InputError
			if _, err := store.UpdateUser(ctx, a.ID, upd); !errors.As(err, &input) {
				t.Errorf("%s: esperaba InputError, obtuve %v", name, err)
			}
		}
	})
	t.Run("usuario inexistente o id inválido", func(t *testing.T) {
		for _, id := range []string{"99999", "usr_123", "", "-4", "abc"} {
			if _, err := store.UpdateUser(ctx, id, storage.UserUpdate{Name: str("x")}); !errors.Is(err, storage.ErrUserNotFound) {
				t.Errorf("id %q: esperaba ErrUserNotFound, obtuve %v", id, err)
			}
			if _, err := store.GetUser(ctx, id); !errors.Is(err, storage.ErrUserNotFound) {
				t.Errorf("GetUser(%q): esperaba ErrUserNotFound, obtuve %v", id, err)
			}
		}
	})
}

func TestEffectiveLimitComesFromRolesTable(t *testing.T) {
	store, pool := newTestStore(t)
	ctx := context.Background()
	editor := mustCreate(t, store, "e@prensa.pr", models.RoleEditor)
	admin := mustCreate(t, store, "ad@prensa.pr", models.RoleAdmin)

	if got := editor.EffectiveDailyVideoLimit(); got != 5 {
		t.Errorf("editor = %d, esperaba 5", got)
	}
	if got := admin.EffectiveDailyVideoLimit(); got != -1 {
		t.Errorf("admin = %d, esperaba -1", got)
	}

	// Cambiar el límite del rol en la base se refleja sin redeploy.
	if _, err := pool.Exec(ctx, `UPDATE roles SET daily_video_limit = 2 WHERE name = 'editor'`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `UPDATE roles SET daily_video_limit = 5 WHERE name = 'editor'`) })
	reloaded, err := store.GetUser(ctx, editor.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got := reloaded.EffectiveDailyVideoLimit(); got != 2 {
		t.Errorf("tras UPDATE roles = %d, esperaba 2", got)
	}
}

// Un editor nace con el límite de su rol (roles.daily_video_limit = 5, sin override). Subirle el límite
// a 7 se guarda en users.daily_video_limit_override, sin tocar el default del rol ni a los demás editores.
func TestChangingUserLimitIsPersistedInDatabase(t *testing.T) {
	store, pool := newTestStore(t)
	ctx := context.Background()
	editor := mustCreate(t, store, "sube@prensa.pr", models.RoleEditor)
	other := mustCreate(t, store, "otro@prensa.pr", models.RoleEditor)

	readColumns := func(id string) (override *int, roleLimit int) {
		t.Helper()
		err := pool.QueryRow(ctx, `SELECT u.daily_video_limit_override, r.daily_video_limit
			FROM users u JOIN roles r ON r.name = u.role WHERE u.id = $1`, id).Scan(&override, &roleLimit)
		if err != nil {
			t.Fatal(err)
		}
		return override, roleLimit
	}

	if override, roleLimit := readColumns(editor.ID); override != nil || roleLimit != 5 {
		t.Fatalf("recién creado: override=%v roleLimit=%d, esperaba NULL y 5", override, roleLimit)
	}

	seven := 7
	if _, err := store.UpdateUser(ctx, editor.ID, storage.UserUpdate{DailyVideoLimitOverride: &seven}); err != nil {
		t.Fatal(err)
	}
	override, roleLimit := readColumns(editor.ID)
	if override == nil || *override != 7 {
		t.Errorf("users.daily_video_limit_override = %v, esperaba 7", override)
	}
	if roleLimit != 5 {
		t.Errorf("roles.daily_video_limit = %d: subirle el límite a un usuario no debe cambiar el del rol", roleLimit)
	}

	reloaded, err := store.GetUser(ctx, editor.ID) // releído de la base, no el objeto devuelto por el UPDATE
	if err != nil || reloaded.EffectiveDailyVideoLimit() != 7 {
		t.Errorf("límite efectivo releído = %v (err=%v), esperaba 7", reloaded.EffectiveDailyVideoLimit(), err)
	}
	otherReloaded, _ := store.GetUser(ctx, other.ID)
	if otherReloaded.EffectiveDailyVideoLimit() != 5 {
		t.Errorf("otro editor = %d, debía seguir en 5", otherReloaded.EffectiveDailyVideoLimit())
	}

	// El nuevo tope se aplica de verdad: caben 7 renders y el 8º se rechaza.
	for i := 1; i <= 7; i++ {
		if ok, _, used, err := store.ReserveVideoUsage(ctx, reloaded); err != nil || !ok || used != i {
			t.Fatalf("reserva %d: ok=%v used=%d err=%v", i, ok, used, err)
		}
	}
	if ok, limit, _, _ := store.ReserveVideoUsage(ctx, reloaded); ok || limit != 7 {
		t.Errorf("la 8ª debe rechazarse con límite 7: ok=%v limit=%d", ok, limit)
	}

	// Quitar el override vuelve a NULL y el usuario recupera el límite de su rol.
	if _, err := store.UpdateUser(ctx, editor.ID, storage.UserUpdate{ClearDailyVideoLimitOverride: true}); err != nil {
		t.Fatal(err)
	}
	if override, _ := readColumns(editor.ID); override != nil {
		t.Errorf("tras limpiar, override = %v, esperaba NULL", *override)
	}
}

func TestDeleteUserCascadesUsage(t *testing.T) {
	store, pool := newTestStore(t)
	ctx := context.Background()
	u := mustCreate(t, store, "del@prensa.pr", models.RoleEditor)
	if ok, _, _, err := store.ReserveVideoUsage(ctx, u); err != nil || !ok {
		t.Fatalf("reserve: ok=%v err=%v", ok, err)
	}

	deleted, err := store.DeleteUser(ctx, u.ID)
	if err != nil || !deleted {
		t.Fatalf("DeleteUser: deleted=%v err=%v", deleted, err)
	}
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM video_usage`).Scan(&rows); err != nil || rows != 0 {
		t.Errorf("video_usage quedó con %d filas (err=%v)", rows, err)
	}
	if deleted, _ := store.DeleteUser(ctx, u.ID); deleted {
		t.Error("borrar dos veces debería devolver false")
	}
}

func TestReserveVideoUsage(t *testing.T) {
	store, _ := newTestStore(t)
	ctx := context.Background()
	three := 3
	zero := 0

	t.Run("respeta el límite y Release devuelve la cuota", func(t *testing.T) {
		u := mustCreate(t, store, "lim@prensa.pr", models.RoleEditor)
		u.DailyVideoLimitOverride = &three
		for i := 1; i <= 3; i++ {
			ok, limit, used, err := store.ReserveVideoUsage(ctx, u)
			if err != nil || !ok || limit != 3 || used != i {
				t.Fatalf("reserva %d: ok=%v limit=%d used=%d err=%v", i, ok, limit, used, err)
			}
		}
		ok, _, used, err := store.ReserveVideoUsage(ctx, u)
		if err != nil || ok || used != 3 {
			t.Fatalf("la 4ª debe rechazarse: ok=%v used=%d err=%v", ok, used, err)
		}
		if err := store.ReleaseVideoUsage(ctx, u.ID); err != nil {
			t.Fatal(err)
		}
		if ok, _, used, _ := store.ReserveVideoUsage(ctx, u); !ok || used != 3 {
			t.Errorf("tras Release debe volver a caber: ok=%v used=%d", ok, used)
		}
	})
	t.Run("límite 0 no reserva nada", func(t *testing.T) {
		u := mustCreate(t, store, "cero@prensa.pr", models.RoleEditor)
		u.DailyVideoLimitOverride = &zero
		ok, _, used, err := store.ReserveVideoUsage(ctx, u)
		if err != nil || ok || used != 0 {
			t.Fatalf("ok=%v used=%d err=%v", ok, used, err)
		}
	})
	t.Run("sin límite igual cuenta", func(t *testing.T) {
		u := mustCreate(t, store, "libre@prensa.pr", models.RoleAdmin)
		for i := 1; i <= 8; i++ {
			ok, limit, used, err := store.ReserveVideoUsage(ctx, u)
			if err != nil || !ok || limit != -1 || used != i {
				t.Fatalf("reserva %d: ok=%v limit=%d used=%d err=%v", i, ok, limit, used, err)
			}
		}
		if used, _ := store.VideoUsageToday(ctx, u.ID); used != 8 {
			t.Errorf("VideoUsageToday = %d, esperaba 8", used)
		}
	})
	t.Run("pedidos simultáneos no pasan el tope", func(t *testing.T) {
		u := mustCreate(t, store, "conc@prensa.pr", models.RoleEditor)
		five := 5
		u.DailyVideoLimitOverride = &five

		var allowed atomic.Int32
		var wg sync.WaitGroup
		for i := 0; i < 40; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if ok, _, _, err := store.ReserveVideoUsage(ctx, u); err == nil && ok {
					allowed.Add(1)
				}
			}()
		}
		wg.Wait()
		if got := allowed.Load(); got != 5 {
			t.Errorf("se permitieron %d reservas con tope 5", got)
		}
		if used, _ := store.VideoUsageToday(ctx, u.ID); used != 5 {
			t.Errorf("contador = %d, esperaba 5", used)
		}
	})
}

// El "día" del contador lo define la zona horaria configurada, no la de la base ni la del servidor.
func TestUsageDayFollowsConfiguredTimezone(t *testing.T) {
	_, pool := newTestStore(t)
	ctx := context.Background()

	for _, tz := range []string{"Pacific/Kiritimati", "Pacific/Pago_Pago"} { // UTC+14 y UTC-11
		t.Run(tz, func(t *testing.T) {
			store, err := storage.NewUserStore(ctx, pool, tz)
			if err != nil {
				t.Fatal(err)
			}
			u := mustCreate(t, store, "tz-"+tz[len(tz)-4:]+"@prensa.pr", models.RoleEditor)
			if ok, _, _, err := store.ReserveVideoUsage(ctx, u); err != nil || !ok {
				t.Fatalf("reserve: ok=%v err=%v", ok, err)
			}
			var stored, want time.Time
			if err := pool.QueryRow(ctx, `SELECT usage_date FROM video_usage WHERE user_id = $1`, u.ID).Scan(&stored); err != nil {
				t.Fatal(err)
			}
			if err := pool.QueryRow(ctx, `SELECT (now() AT TIME ZONE $1)::date`, tz).Scan(&want); err != nil {
				t.Fatal(err)
			}
			if !stored.Equal(want) {
				t.Errorf("usage_date = %s, esperaba %s", stored.Format("2006-01-02"), want.Format("2006-01-02"))
			}
			if used, _ := store.VideoUsageToday(ctx, u.ID); used != 1 {
				t.Errorf("VideoUsageToday = %d, esperaba 1", used)
			}
		})
	}

	if _, err := storage.NewUserStore(ctx, pool, "Marte/Olympus_Mons"); err == nil {
		t.Error("una zona horaria inexistente debe rechazarse al crear el store")
	}
}

func TestRefreshTokenRotation(t *testing.T) {
	store, _ := newTestStore(t)
	ctx := context.Background()
	u := mustCreate(t, store, "rt@prensa.pr", models.RoleEditor)

	first, err := store.CreateRefreshToken(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	second, got, err := store.RotateRefreshToken(ctx, first.Token)
	if err != nil || got.ID != u.ID {
		t.Fatalf("rotar: user=%v err=%v", got, err)
	}
	if second.Token == first.Token || !second.ExpiresAt.Equal(first.ExpiresAt) {
		t.Error("el token rotado debe ser otro y conservar la expiración absoluta")
	}
	if _, _, err := store.RotateRefreshToken(ctx, first.Token); !errors.Is(err, storage.ErrInvalidRefreshToken) {
		t.Errorf("el token viejo debe ser de un solo uso, err=%v", err)
	}

	store.RevokeRefreshToken(second.Token)
	if _, _, err := store.RotateRefreshToken(ctx, second.Token); !errors.Is(err, storage.ErrInvalidRefreshToken) {
		t.Errorf("un token revocado no debe rotar, err=%v", err)
	}

	// El dueño borrado deja el refresh token inservible.
	third, _ := store.CreateRefreshToken(u.ID)
	if _, err := store.DeleteUser(ctx, u.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.RotateRefreshToken(ctx, third.Token); !errors.Is(err, storage.ErrUserNotFound) {
		t.Errorf("esperaba ErrUserNotFound, obtuve %v", err)
	}
}

func TestImportLegacyUsers(t *testing.T) {
	store, _ := newTestStore(t)
	ctx := context.Background()
	dir := t.TempDir()
	path := filepath.Join(dir, "users.json")

	hash, err := bcrypt.GenerateFromPassword([]byte("ClaveVieja123"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	override := 12
	legacy := map[string]any{
		"users": map[string]any{
			"usr_1": map[string]any{"name": "Super", "email": "Super@Prensa.pr", "password_hash": string(hash), "role": "superadmin", "active": true, "created_at": "2026-01-01T10:00:00Z"},
			"usr_2": map[string]any{"name": "Ed", "email": "ed@prensa.pr", "password_hash": string(hash), "role": "editor", "active": false, "daily_video_limit_override": override, "created_at": "2026-02-01T10:00:00Z"},
			"usr_3": map[string]any{"name": "Roto", "email": "roto@prensa.pr", "password_hash": string(hash), "role": "rol-que-no-existe", "active": true},
		},
		"video_usage": map[string]any{"usr_1|2026-01-01": map[string]any{"user_id": "usr_1", "count": 3}},
	}
	raw, _ := json.Marshal(legacy)
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatal(err)
	}

	n, err := store.ImportLegacyUsers(ctx, path)
	if err != nil || n != 2 {
		t.Fatalf("importó %d (err=%v), esperaba 2 (el de rol inválido se omite)", n, err)
	}
	if _, err := os.Stat(path + ".migrated"); err != nil {
		t.Errorf("el archivo debe quedar como .migrated: %v", err)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("el archivo original no debe seguir en su lugar: %v", err)
	}

	// La contraseña vieja sigue funcionando (el hash se conserva) y el rol/override llegaron.
	u, err := store.VerifyCredentials(ctx, "super@prensa.pr", "ClaveVieja123")
	if err != nil || u.Role != models.RoleSuperAdmin {
		t.Fatalf("login del superadmin importado: u=%v err=%v", u, err)
	}
	if _, err := store.VerifyCredentials(ctx, "ed@prensa.pr", "ClaveVieja123"); !errors.Is(err, storage.ErrUserInactive) {
		t.Errorf("el editor importado quedó inactivo, err=%v", err)
	}
	all, _ := store.GetAllUsers(ctx)
	for _, x := range all {
		if x.Email == "ed@prensa.pr" && (x.DailyVideoLimitOverride == nil || *x.DailyVideoLimitOverride != 12) {
			t.Errorf("override no importado: %+v", x)
		}
	}

	// Sin archivo no hace nada.
	if n, err := store.ImportLegacyUsers(ctx, path); err != nil || n != 0 {
		t.Errorf("sin archivo: n=%d err=%v", n, err)
	}
}
