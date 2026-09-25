package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"time"

	"github.com/prensa-abierta/ingestor-engine/pkg/models"
)

// legacyUser es un usuario tal como lo guardaba la versión anterior del Engine en users.json.
type legacyUser struct {
	Name                    string    `json:"name"`
	Email                   string    `json:"email"`
	PasswordHash            string    `json:"password_hash"`
	Role                    string    `json:"role"`
	Active                  bool      `json:"active"`
	DailyVideoLimitOverride *int      `json:"daily_video_limit_override"`
	CreatedAt               time.Time `json:"created_at"`
}

// ImportLegacyUsers copia a PostgreSQL los usuarios del users.json de la versión anterior, con sus
// contraseñas (hashes bcrypt) intactas, para que nadie pierda su cuenta al pasar a la base. Los ids
// cambian (ahora son bigint) y el contador de videos de esa jornada no se importa. Al terminar,
// renombra el archivo a <path>.migrated para que no se vuelva a importar.
//
// No hace nada si el archivo no existe. Está pensado para llamarse solo cuando la tabla users está
// vacía; aun así los correos ya existentes se omiten. Devuelve cuántos usuarios importó.
func (us *UserStore) ImportLegacyUsers(ctx context.Context, path string) (int, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("leer %s: %w", path, err)
	}

	var legacy struct {
		Users map[string]legacyUser `json:"users"`
	}
	if err := json.Unmarshal(raw, &legacy); err != nil {
		return 0, fmt.Errorf("interpretar %s: %w", path, err)
	}

	users := make([]legacyUser, 0, len(legacy.Users))
	for _, u := range legacy.Users {
		users = append(users, u)
	}
	sort.Slice(users, func(i, j int) bool { return users[i].CreatedAt.Before(users[j].CreatedAt) })

	tx, err := us.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("iniciar importación: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // tras un Commit exitoso es un no-op

	imported := 0
	for _, u := range users {
		if !models.Role(u.Role).IsValid() || u.Email == "" || u.PasswordHash == "" {
			continue // dato corrupto: se omite en vez de romper toda la importación
		}
		createdAt := u.CreatedAt
		if createdAt.IsZero() {
			createdAt = time.Now()
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO users (name, email, password_hash, role, active, daily_video_limit_override, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT ((lower(email))) DO NOTHING`,
			u.Name, u.Email, u.PasswordHash, u.Role, u.Active, u.DailyVideoLimitOverride, createdAt)
		if err != nil {
			return 0, fmt.Errorf("importar %s: %w", u.Email, err)
		}
		imported += int(tag.RowsAffected())
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("confirmar importación: %w", err)
	}

	if err := os.Rename(path, path+".migrated"); err != nil {
		return imported, fmt.Errorf("los usuarios se importaron pero no se pudo renombrar %s: %w", path, err)
	}
	return imported, nil
}
