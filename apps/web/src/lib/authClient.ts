// Cliente de auth/usuarios del Go Engine para componentes de CLIENTE. Guarda la sesión en
// localStorage y expone un fetch que adjunta el token y devuelve el mensaje de error real
// del Engine ({"error": "..."}).
//
// El login devuelve un PAR de tokens (ver POST /api/auth/login en el Engine):
//   - `token` (access, JWT): dura 15 min, es lo que se manda en cada request autenticado.
//   - `refresh_token` (opaco): dura 5 días, sirve solo para pedir un access token nuevo
//     (POST /api/auth/refresh) sin volver a pedir email/contraseña.
// La sesión "existe" en el navegador mientras el REFRESH token siga vivo (getSession()
// se guía por refresh_expires_at, no por expires_at del access token); el access token se
// renueva solo en segundo plano (ver ensureFreshSession/el intervalo al final de este
// archivo) para que la sesión se sienta persistente durante esos 5 días.

import { ENGINE_URL } from './engineClient';

export type UserRole = 'superadmin' | 'admin' | 'editor';

export interface EngineUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  daily_video_limit_override?: number;
  created_at: string;
  updated_at: string;
}

export interface AuthSession {
  /** Access token (JWT), dura 15 min — ver expires_at. */
  token: string;
  expires_at: string;
  /** Refresh token opaco, dura 5 días — ver refresh_expires_at. Cambia (rotación) cada vez que se usa. */
  refresh_token: string;
  refresh_expires_at: string;
  user: EngineUser;
}

// Solo incluye los campos que cambiaron, tal cual los espera PUT /api/users/:id.
export type UpdateUserPayload = Partial<{
  name: string;
  email: string;
  password: string;
  current_password: string;
  role: UserRole;
  active: boolean;
  daily_video_limit_override: number;
  clear_daily_video_limit_override: boolean;
}>;

export type EngineResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; offline: boolean; unauthorized: boolean };

const SESSION_KEY = 'pa_auth_session';

/**
 * Sesión guardada, si el REFRESH token (5 días) todavía no venció. No garantiza que el
 * ACCESS token (`session.token`, 15 min) esté vigente en este instante — para eso hay que
 * pasar por `ensureFreshSession()`/`authHeaderFresh()`, que lo renuevan si hace falta.
 */
export function getSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as AuthSession;
    // Un registro sin refresh_token es de un formato anterior a este cambio: se trata
    // como sesión vencida (obliga a loguearse de nuevo una sola vez).
    if (!session.token || !session.refresh_token || new Date(session.refresh_expires_at).getTime() <= Date.now()) {
      window.localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

// Evento propio: el evento nativo `storage` solo se dispara en OTRAS pestañas, así que para que
// el header y las páginas de la pestaña actual se enteren de un login/logout se emite este.
const SESSION_EVENT = 'pa-session-changed';

export function saveSession(session: AuthSession): void {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function clearSession(): void {
  // Revoca el refresh token en el Engine (best-effort, sin bloquear el logout local): si
  // alguien llegara a copiar ese valor del localStorage antes de este cierre, ya no le
  // serviría para renovar el acceso. El borrado de localStorage de abajo ocurre igual
  // aunque esta llamada falle o el Engine esté caído.
  const current = getSession();
  if (current?.refresh_token) {
    fetch(`${ENGINE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: current.refresh_token }),
    }).catch(() => {});
  }
  window.localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new Event(SESSION_EVENT));
}

/** Header `Authorization` de la sesión actual (vacío si no hay), sin renovarla. Para
 *  llamadas donde el token pueda estar vencido, preferir `authHeaderFresh()`. */
export function authHeader(): Record<string, string> {
  const session = getSession();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}

// ── Renovación del access token ──────────────────────────────────────────────────────
// El access token dura solo 15 min; sin esto, cualquier página abierta más tiempo que eso
// empezaría a recibir 401 del Engine. `refreshSession()` cambia el refresh token (5 días)
// por un access token nuevo y ROTA el refresh token (es de un solo uso del lado del
// Engine), guardando el par actualizado.

// Único vuelo en curso a la vez: si el scheduler de abajo, un 401 en `engineRequest` y
// otro componente piden refrescar casi al mismo tiempo, todos comparten la MISMA llamada
// en vez de disparar refresh en paralelo — como el refresh token es de un solo uso, dos
// llamadas simultáneas harían que la segunda perdiera la carrera y cerrara la sesión sola.
let refreshInFlight: Promise<AuthSession | null> | null = null;

async function performRefresh(): Promise<AuthSession | null> {
  const current = getSession();
  if (!current?.refresh_token) return null;
  try {
    const res = await fetch(`${ENGINE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: current.refresh_token }),
    });
    if (!res.ok) {
      // Refresh token vencido, revocado (logout en otra pestaña) o usuario desactivado:
      // no hay forma de recuperar la sesión sin loguearse de nuevo.
      clearSession();
      return null;
    }
    const data = (await res.json()) as AuthSession;
    saveSession(data);
    return data;
  } catch {
    // Fallo de red: no se limpia la sesión por un corte momentáneo — se reintentará en
    // el próximo ciclo del scheduler o la próxima vez que haga falta.
    return null;
  }
}

/** Renueva el access token vía el refresh token, colapsando llamadas concurrentes en una sola. */
export function refreshSession(): Promise<AuthSession | null> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

// Margen antes del vencimiento del access token (dura 15 min) en el que ya se lo considera
// "por vencer" y conviene renovarlo, en vez de esperar a que falle una request con él.
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 45_000;

function isAccessTokenExpiring(session: AuthSession): boolean {
  return new Date(session.expires_at).getTime() - Date.now() <= ACCESS_TOKEN_REFRESH_MARGIN_MS;
}

/** Sesión actual con el access token garantizado fresco (lo renueva si está por vencer o ya venció). */
export async function ensureFreshSession(): Promise<AuthSession | null> {
  const current = getSession();
  if (!current) return null;
  return isAccessTokenExpiring(current) ? refreshSession() : current;
}

/** Como `authHeader()`, pero renovando el access token antes si hace falta. Preferir esta
 *  variante para llamadas que puedan tardar o donde no haya un reintento automático (ver
 *  `engineRequest`, que ya reintenta solo ante un 401). */
export async function authHeaderFresh(): Promise<Record<string, string>> {
  const session = await ensureFreshSession();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}

// Reintento proactivo en segundo plano: cada 20s revisa si el access token está por vencer
// y lo renueva ANTES de que expire, para que la sesión se sienta persistente durante toda
// la vida del refresh token (5 días) sin que el usuario note ningún corte. A nivel de
// módulo (no dentro de un hook de React) a propósito: varios componentes usando
// `useSession()` a la vez no deben disparar N intervalos redundantes — corre uno solo por
// pestaña. Limitación conocida: con varias pestañas abiertas a la vez, cada una programa su
// propio refresh de forma independiente; como el refresh token es de un solo uso, si dos
// pestañas refrescan en el mismo instante una de las dos pierde la carrera (`getSession()`
// dentro de `performRefresh` reduce la ventana al releer localStorage justo antes de cada
// intento, pero no la elimina del todo).
if (typeof window !== 'undefined') {
  setInterval(() => {
    void ensureFreshSession();
  }, 20_000);
}

/** Avisa cuando la sesión cambia (esta pestaña u otra). Devuelve la función para desuscribirse. */
export function subscribeSession(callback: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === SESSION_KEY || e.key === null) callback();
  };
  window.addEventListener(SESSION_EVENT, callback);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(SESSION_EVENT, callback);
    window.removeEventListener('storage', onStorage);
  };
}

export async function engineRequest<T = unknown>(
  path: string,
  init: Omit<RequestInit, 'body'> & { token?: string; json?: unknown } = {}
): Promise<EngineResult<T>> {
  const { token, json, headers, ...rest } = init;
  const buildHeaders = (bearer?: string): Record<string, string> => {
    const h: Record<string, string> = { ...(headers as Record<string, string> | undefined) };
    if (bearer) h.Authorization = `Bearer ${bearer}`;
    if (json !== undefined) h['Content-Type'] = 'application/json';
    return h;
  };
  const doFetch = (bearer?: string) =>
    fetch(`${ENGINE_URL}${path}`, {
      ...rest,
      headers: buildHeaders(bearer),
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });

  try {
    let res = await doFetch(token);

    // El access token dura solo 15 min: si venció justo en pleno vuelo, se reintenta UNA
    // vez con uno fresco (vía refresh token) antes de darlo por error — transparente para
    // quien llamó. Si el refresh también falla (refresh token vencido/revocado), se sigue
    // con la respuesta 401 original tal cual.
    if (res.status === 401 && token) {
      const refreshed = await refreshSession();
      if (refreshed) res = await doFetch(refreshed.token);
    }

    if (!res.ok) {
      let message = `El Motor Go respondió con error ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch {
        // cuerpo no-JSON: se deja el mensaje genérico
      }
      return { ok: false, status: res.status, error: message, offline: false, unauthorized: res.status === 401 };
    }

    if (res.status === 204) return { ok: true, status: 204, data: undefined as T };
    return { ok: true, status: res.status, data: (await res.json()) as T };
  } catch (err) {
    console.error(`Error de conexión con el Motor Go (${path}):`, err);
    return {
      ok: false,
      status: 0,
      error: 'No se pudo conectar con el Motor Go (Engine). Verifica que el servicio esté corriendo.',
      offline: true,
      unauthorized: false,
    };
  }
}

export async function loginToEngine(email: string, password: string): Promise<EngineResult<AuthSession>> {
  const result = await engineRequest<AuthSession>('/api/auth/login', { method: 'POST', json: { email, password } });
  if (result.ok) saveSession(result.data);
  return result;
}

// Espejo de models.CanRegisterRole / models.CanManageUser del Engine: solo sirven para
// mostrar u ocultar acciones en la UI. La autoridad real es siempre el backend.
// Espeja models.CanRegisterRole del Engine (solo para mostrar/ocultar UI; la
// autoridad real es el Engine). superadmin y admin pueden registrar admin o
// editor — un admin registrando a otro admin es un par, no una autopromoción.
export function canRegisterRole(caller: UserRole, target: UserRole): boolean {
  if (target !== 'admin' && target !== 'editor') return false;
  return caller === 'superadmin' || caller === 'admin';
}

// Espeja models.CanManageUser del Engine. superadmin y admin administran
// (editan/eliminan) admin y editor; nadie administra a un superadmin salvo
// él mismo.
export function canManageUser(caller: UserRole, target: UserRole): boolean {
  if (caller === 'superadmin' || caller === 'admin') return target === 'admin' || target === 'editor';
  return false;
}
