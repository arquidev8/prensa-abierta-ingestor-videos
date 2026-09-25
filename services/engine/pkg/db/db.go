// Package db abre el pool de conexiones a PostgreSQL y aplica las migraciones de esquema
// embebidas en el binario (pkg/db/migrations), de modo que un deploy deja la base al día sin
// pasos manuales.
package db

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5" // registra el driver "pgx5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

const (
	// connectTimeout es cuánto espera Connect a que PostgreSQL acepte conexiones: en Docker el
	// Engine puede arrancar unos segundos antes que la base.
	connectTimeout = 30 * time.Second
	retryInterval  = time.Second
	maxConns       = 10
)

// Connect abre el pool y reintenta hasta connectTimeout mientras la base no responda. Nunca
// registra databaseURL en logs: lleva la contraseña.
func Connect(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL inválida: %w", err)
	}
	cfg.MaxConns = maxConns

	ctx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()

	var lastErr error
	for {
		pool, err := pgxpool.NewWithConfig(ctx, cfg)
		if err == nil {
			if err = pool.Ping(ctx); err == nil {
				return pool, nil
			}
			pool.Close()
		}
		lastErr = err

		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("PostgreSQL no respondió en %s: %w", connectTimeout, lastErr)
		case <-time.After(retryInterval):
			log.Printf("[DB] esperando a PostgreSQL... (%v)", lastErr)
		}
	}
}

// Migrate aplica las migraciones pendientes. golang-migrate toma un advisory lock de
// PostgreSQL, así que dos instancias del Engine arrancando a la vez no se pisan. Es idempotente:
// sin cambios pendientes no hace nada.
func Migrate(databaseURL string) error {
	src, err := iofs.New(migrationsFS, "migrations")
	if err != nil {
		return fmt.Errorf("leer migraciones embebidas: %w", err)
	}
	m, err := migrate.NewWithSourceInstance("iofs", src, toMigrateURL(databaseURL))
	if err != nil {
		return fmt.Errorf("preparar migraciones: %w", err)
	}
	defer func() {
		if srcErr, dbErr := m.Close(); srcErr != nil || dbErr != nil {
			log.Printf("[DB] error cerrando el migrador: source=%v db=%v", srcErr, dbErr)
		}
	}()

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("aplicar migraciones: %w", err)
	}
	version, dirty, err := m.Version()
	if err != nil {
		return fmt.Errorf("leer versión de esquema: %w", err)
	}
	log.Printf("[DB] esquema en la versión %d (dirty=%t)", version, dirty)
	return nil
}

// toMigrateURL adapta postgres:// / postgresql:// al esquema pgx5:// que registra el driver.
func toMigrateURL(databaseURL string) string {
	for _, prefix := range []string{"postgresql://", "postgres://"} {
		if strings.HasPrefix(databaseURL, prefix) {
			return "pgx5://" + strings.TrimPrefix(databaseURL, prefix)
		}
	}
	return databaseURL
}
