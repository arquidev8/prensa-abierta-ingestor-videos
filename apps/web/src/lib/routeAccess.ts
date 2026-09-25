import type { UserRole } from './authClient';

// Matriz de acceso a las páginas del frontend. Para cambiar quién ve qué basta editar este archivo:
// lo consumen el guard de rutas (AuthGate), el menú del header y el menú de usuario.

const ALL_ROLES: UserRole[] = ['superadmin', 'admin', 'editor'];
const ADMIN_ROLES: UserRole[] = ['superadmin', 'admin'];

/** Páginas que se ven sin sesión. */
const PUBLIC_ROUTES = ['/'];

/**
 * Reglas por prefijo de ruta; gana la más específica (prefijo más largo). Toda ruta que no esté
 * listada exige únicamente haber iniciado sesión (cualquier rol).
 */
const ROUTE_RULES: { prefix: string; roles: UserRole[] }[] = [
  { prefix: '/dashboard', roles: ALL_ROLES },
  { prefix: '/dashboard/admin', roles: ADMIN_ROLES },
  { prefix: '/autopilot', roles: ALL_ROLES },
  { prefix: '/media', roles: ALL_ROLES },
  { prefix: '/settings', roles: ADMIN_ROLES },
  { prefix: '/dev', roles: ['superadmin'] },
];

export const DEFAULT_LANDING = '/dashboard';

export type RouteAccess = 'allowed' | 'login' | 'forbidden';

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** 'login' = falta iniciar sesión; 'forbidden' = hay sesión pero el rol no tiene acceso. */
export function getRouteAccess(pathname: string, role: UserRole | null): RouteAccess {
  if (PUBLIC_ROUTES.includes(pathname)) return 'allowed';
  if (!role) return 'login';

  const rule = ROUTE_RULES.filter((r) => matchesPrefix(pathname, r.prefix)).sort(
    (a, b) => b.prefix.length - a.prefix.length
  )[0];
  const allowedRoles = rule?.roles ?? ALL_ROLES;
  return allowedRoles.includes(role) ? 'allowed' : 'forbidden';
}

export function canAccessRoute(role: UserRole, pathname: string): boolean {
  return getRouteAccess(pathname, role) === 'allowed';
}

/**
 * Destino tras iniciar sesión: la ruta pedida en `?next=` si es interna y el rol puede verla; si
 * no, el panel. Se descartan URLs externas o protocolo-relativas (`//evil.com`) para no dejar un
 * redirect abierto.
 */
export function resolvePostLoginPath(role: UserRole, search: string): string {
  const next = new URLSearchParams(search).get('next');
  const isInternal = !!next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\');
  if (isInternal && canAccessRoute(role, next.split('?')[0].split('#')[0])) return next;
  return DEFAULT_LANDING;
}
