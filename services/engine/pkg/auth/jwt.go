// Package auth emite y valida los access tokens (JWT) del panel de administración.
// El refresh token (opaco, de vida larga) sigue viviendo en pkg/storage/user_store.go
// junto al resto del estado de usuarios; este paquete solo se ocupa del JWT.
package auth

import (
	"crypto/rand"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/prensa-abierta/ingestor-engine/pkg/models"
)

// AccessTokenTTL: cuánto dura el access token (JWT) antes de que el cliente deba
// cambiarlo por uno nuevo vía POST /api/auth/refresh (con el refresh token, que
// dura mucho más — ver refreshTokenTTL en user_store.go). Corto a propósito: si
// se filtra un access token, la ventana de uso indebido es de minutos, no de días.
const AccessTokenTTL = 15 * time.Minute

// claims son los datos propios que viajan en el JWT, además de los estándar
// (sub, iat, exp) de jwt.RegisteredClaims.
type claims struct {
	Role models.Role `json:"role"`
	jwt.RegisteredClaims
}

// Issuer firma y valida los access tokens con una clave HMAC compartida.
type Issuer struct {
	secret []byte
}

// NewIssuerFromEnv arma el emisor de JWT. Si JWT_SECRET no está configurada, genera
// una clave aleatoria de 32 bytes al arrancar — funciona igual, pero importa sobre
// todo si corren varias instancias del Engine a la vez: deben compartir la misma
// clave para que un access token emitido por una la valide la otra. (Nota: tanto el
// access como el refresh token viven solo en memoria — ver refreshTokenTTL en
// pkg/storage/user_store.go —, así que un reinicio del proceso de todos modos cierra
// todas las sesiones activas; fijar JWT_SECRET no cambia eso, solo la vuelve estable.)
func NewIssuerFromEnv() *Issuer {
	raw := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if raw == "" {
		buf := make([]byte, 32)
		if _, err := rand.Read(buf); err != nil {
			// crypto/rand fallando es un problema serio del sistema, no algo de lo
			// que el servidor deba intentar seguir operando con una clave débil.
			panic(fmt.Sprintf("[Auth] no se pudo generar JWT_SECRET aleatoria: %v", err))
		}
		log.Println("[Auth] ⚠️ JWT_SECRET no configurada: se generó una clave aleatoria para esta corrida. " +
			"Fijala si corrés más de una instancia del Engine a la vez, para que compartan la misma clave.")
		return &Issuer{secret: buf}
	}
	log.Println("[Auth] ✅ JWT_SECRET cargada del entorno (las sesiones sobreviven un reinicio del servidor).")
	return &Issuer{secret: []byte(raw)}
}

// IssueAccessToken firma un JWT para userID/role con vencimiento a AccessTokenTTL.
func (i *Issuer) IssueAccessToken(userID string, role models.Role) (token string, expiresAt time.Time, err error) {
	now := time.Now()
	expiresAt = now.Add(AccessTokenTTL)
	c := claims{
		Role: role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(i.secret)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("firmando access token: %w", err)
	}
	return signed, expiresAt, nil
}

// ParseAccessToken valida la firma y el vencimiento de un JWT y devuelve el ID del
// usuario (subject). El rol embebido NO se usa para autorizar — quien llama debe
// recargar el usuario real del store (ver requireAuth en cmd/server/main.go), así
// un rol cambiado o una cuenta desactivada DESPUÉS de emitido el token se respeta
// en la próxima request, sin esperar a que el JWT viejo expire.
func (i *Issuer) ParseAccessToken(tokenStr string) (userID string, err error) {
	parsed, err := jwt.ParseWithClaims(tokenStr, &claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("método de firma inesperado: %v", t.Header["alg"])
		}
		return i.secret, nil
	})
	if err != nil {
		return "", fmt.Errorf("access token inválido: %w", err)
	}
	c, ok := parsed.Claims.(*claims)
	if !ok || !parsed.Valid || c.Subject == "" {
		return "", fmt.Errorf("access token inválido")
	}
	return c.Subject, nil
}
