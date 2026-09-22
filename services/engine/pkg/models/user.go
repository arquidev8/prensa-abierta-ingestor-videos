package models

import "time"

// Role es el rol de un usuario dentro del panel de administración.
type Role string

const (
	RoleSuperAdmin Role = "superadmin"
	RoleAdmin      Role = "admin"
	RoleEditor     Role = "editor"
)

// IsValid indica si el valor es uno de los 3 roles soportados.
func (r Role) IsValid() bool {
	switch r {
	case RoleSuperAdmin, RoleAdmin, RoleEditor:
		return true
	default:
		return false
	}
}

// DailyVideoLimitByRole define cuántos renders de video puede pedir por día
// un usuario de cada rol. -1 significa sin límite. Superadmin/admin no tienen
// tope; el límite real hoy solo aplica a editor. Cambiar el límite de todos
// los editores es un solo valor acá, no hay que tocar usuarios uno por uno.
var DailyVideoLimitByRole = map[Role]int{
	RoleSuperAdmin: -1,
	RoleAdmin:      -1,
	RoleEditor:     5,
}

// DailyVideoLimitForRole resuelve el límite diario de un rol. Un rol
// desconocido (dato corrupto/legacy) se trata como el más restrictivo
// (editor) en vez de sin límite, para no abrir una puerta trasera.
func DailyVideoLimitForRole(role Role) int {
	if limit, ok := DailyVideoLimitByRole[role]; ok {
		return limit
	}
	return DailyVideoLimitByRole[RoleEditor]
}

// User representa una cuenta del panel de administración. PasswordHash SÍ
// lleva tag JSON (lo necesita el store para persistirlo en users.json), pero
// ningún handler HTTP debe devolver un *User crudo: siempre llamar Public()
// antes de mandarlo en una respuesta, para no filtrar el hash por la API.
type User struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Email        string `json:"email"`
	PasswordHash string `json:"password_hash,omitempty"`
	Role         Role   `json:"role"`
	Active       bool   `json:"active"`
	// DailyVideoLimitOverride, si no es nil, pisa el límite del rol
	// (DailyVideoLimitByRole) solo para ESTE usuario (ej. "este editor tiene
	// 10, no 5"). nil = usa el default de su rol. Editable por admin/superadmin
	// vía PUT /api/users/:id, nunca por el propio usuario.
	DailyVideoLimitOverride *int      `json:"daily_video_limit_override,omitempty"`
	CreatedAt               time.Time `json:"created_at"`
	UpdatedAt               time.Time `json:"updated_at"`
}

// EffectiveDailyVideoLimit devuelve el límite diario de video que realmente
// aplica a este usuario: su override personal si tiene uno, si no el default
// de su rol.
func (u User) EffectiveDailyVideoLimit() int {
	if u.DailyVideoLimitOverride != nil {
		return *u.DailyVideoLimitOverride
	}
	return DailyVideoLimitForRole(u.Role)
}

// Public devuelve una copia del usuario sin PasswordHash, segura de exponer
// por la API.
func (u User) Public() User {
	u.PasswordHash = ""
	return u
}

// CanRegisterRole define la jerarquía de registro: superadmin puede dar de
// alta admin o editor; admin puede dar de alta admin o editor (un admin
// registrando a otro admin es un par, no una promoción propia — sigue sin
// poder asignarse el rol a sí mismo, eso se valida aparte); nadie puede
// registrar otro superadmin por esta vía (se siembra aparte, ver main.go).
func CanRegisterRole(callerRole, targetRole Role) bool {
	if targetRole != RoleAdmin && targetRole != RoleEditor {
		return false
	}
	switch callerRole {
	case RoleSuperAdmin, RoleAdmin:
		return true
	default:
		return false
	}
}

// CanManageUser define quién puede editar/eliminar los datos de OTRO usuario
// (no su propio perfil, eso se permite siempre y se valida aparte en el
// handler, incluida la restricción de nunca poder auto-editar/auto-eliminar
// vía esta ruta): superadmin administra admin y editor; admin administra
// admin (a sus pares) y editor. Ningún rol puede administrar a un superadmin
// salvo el propio superadmin.
func CanManageUser(callerRole, targetRole Role) bool {
	switch callerRole {
	case RoleSuperAdmin, RoleAdmin:
		return targetRole == RoleAdmin || targetRole == RoleEditor
	default:
		return false
	}
}

// RefreshToken es un token opaco de larga vida (ver refreshTokenTTL en
// pkg/storage/user_store.go, 5 días) que el cliente cambia por un access
// token (JWT, ver pkg/auth, vive 15 min) nuevo vía POST /api/auth/refresh.
// Vive solo en memoria (no se persiste a disco): reiniciar el servidor
// cierra todas las sesiones activas, lo cual es un default aceptable/
// deseable de seguridad para esta herramienta interna. Es de un solo uso:
// cada refresh lo invalida y emite uno nuevo con un string distinto
// (rotación), pero conserva el mismo ExpiresAt original — la sesión nunca
// dura más de refreshTokenTTL desde el login, sin importar cuántas veces se
// refresque el access token mientras tanto.
type RefreshToken struct {
	Token     string    `json:"token"`
	UserID    string    `json:"user_id"`
	ExpiresAt time.Time `json:"expires_at"`
}

// VideoUsage cuenta cuántos renders pidió un usuario en un día calendario
// dado (Date en formato "2006-01-02", huso horario del servidor). La clave
// de almacenamiento es UserID+Date, así que el contador se reinicia solo:
// no hace falta ningún job de reset a medianoche.
type VideoUsage struct {
	UserID string `json:"user_id"`
	Date   string `json:"date"`
	Count  int    `json:"count"`
}
