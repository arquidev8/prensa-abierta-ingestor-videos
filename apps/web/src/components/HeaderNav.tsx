'use client';

import Link from 'next/link';
import { Newspaper, Video, Settings, Flame, type LucideIcon } from 'lucide-react';
import UserMenu from '@/components/UserMenu';
import VideoQuotaBadge from '@/components/VideoQuotaBadge';
import { useSession } from '@/hooks/useSession';
import { canAccessRoute } from '@/lib/routeAccess';

const LINK_BASE =
  'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs sm:text-sm transition whitespace-nowrap shrink-0';
const LINK_PLAIN = `${LINK_BASE} font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100`;
const LINK_HIGHLIGHT = `${LINK_BASE} font-bold bg-orange-50 border border-orange-200 text-[#FF5500] hover:bg-[#FF5500] hover:text-white shadow-sm`;

// Cada link se muestra solo si el rol puede abrir esa ruta (ver lib/routeAccess.ts).
const NAV_LINKS: { href: string; label: string; icon: LucideIcon; className: string; iconClassName: string }[] = [
  { href: '/dashboard', label: 'Feed PR', icon: Newspaper, className: LINK_PLAIN, iconClassName: 'w-4 h-4 text-[#FF5500] shrink-0' },
  { href: '/autopilot', label: 'Piezas Listas', icon: Flame, className: LINK_HIGHLIGHT, iconClassName: 'w-4 h-4 fill-current shrink-0' },
  { href: '/media', label: 'Banco de Medios', icon: Video, className: LINK_PLAIN, iconClassName: 'w-4 h-4 text-amber-500 shrink-0' },
  { href: '/settings', label: 'Configuración', icon: Settings, className: LINK_PLAIN, iconClassName: 'w-4 h-4 text-slate-400 shrink-0' },
];

/**
 * Menú central + badges + menú de usuario del header. Sin sesión no renderiza nada, de modo que
 * en la pantalla de login el header muestra solo el logo de Prensa Abierta.
 * Devuelve un fragmento: <nav> y el bloque derecho quedan como hijos directos del header flex.
 */
export default function HeaderNav() {
  const { session, hydrated } = useSession();
  if (!hydrated || !session) return null;
  const role = session.user.role;

  return (
    <>
      {/* Center: Navigation Links (Clean Single-Line Tabs) */}
      <nav className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto no-scrollbar shrink-0 whitespace-nowrap">
        {NAV_LINKS.filter((link) => canAccessRoute(role, link.href)).map(({ href, label, icon: Icon, className, iconClassName }) => (
          <Link key={href} href={href} className={className}>
            <Icon className={iconClassName} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>

      {/* Right: Compact Status Badges + User Menu (Single Line) */}
      <div className="flex items-center gap-3 shrink-0 whitespace-nowrap">
        <div className="hidden md:flex items-center gap-2">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            Engine Activo
          </span>
          <span className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 border border-slate-200 whitespace-nowrap">
            Sandbox WP
          </span>
        </div>
        <VideoQuotaBadge />
        <UserMenu />
      </div>
    </>
  );
}
