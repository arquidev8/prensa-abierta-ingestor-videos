import type { EngineUser, UserRole } from './authClient';

export const ROLE_BADGE: Record<UserRole, { label: string; className: string }> = {
  superadmin: { label: 'Superadmin', className: 'bg-purple-50 text-purple-700 border-purple-200' },
  admin: { label: 'Administrador', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  editor: { label: 'Editor', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

export function describeVideoLimit(user: EngineUser): string {
  if (user.daily_video_limit_override !== undefined) {
    return user.daily_video_limit_override < 0 ? 'Sin límite' : `${user.daily_video_limit_override} / día (personalizado)`;
  }
  return user.role === 'editor' ? 'Por defecto del rol' : 'Sin límite';
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}
