'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, LogOut, UserRound, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import ProfileModal from '@/components/ProfileModal';
import UserAvatar from '@/components/UserAvatar';
import { clearSession } from '@/lib/authClient';
import { canAccessRoute } from '@/lib/routeAccess';
import { useSession } from '@/hooks/useSession';
import { ROLE_BADGE } from '@/lib/userDisplay';

export default function UserMenu() {
  const router = useRouter();
  const { session, hydrated } = useSession();
  const [open, setOpen] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!hydrated) return <div className="w-8 h-8 shrink-0" aria-hidden />;

  if (!session) return null;
  const user = session.user;

  const badge = ROLE_BADGE[user.role];
  const canAdminUsers = canAccessRoute(user.role, '/dashboard/admin/users');

  const handleLogout = () => {
    setOpen(false);
    clearSession();
    toast.success('Sesión cerrada.');
    router.replace('/');
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-2 pl-1 pr-2 sm:pr-3 py-1 rounded-full border transition whitespace-nowrap ${
          open ? 'bg-slate-100 border-slate-300' : 'bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300'
        }`}
      >
        <UserAvatar name={user.name} />
        <span className="hidden sm:flex flex-col items-start leading-tight text-left">
          <span className="text-xs font-bold text-slate-900 max-w-[140px] truncate">{user.name}</span>
          <span className="text-[10px] font-semibold text-slate-500">{badge.label}</span>
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 rounded-2xl bg-white border border-slate-200 shadow-lg overflow-hidden z-50"
        >
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/70">
            <p className="text-sm font-black text-slate-900 truncate">{user.name}</p>
            <p className="text-xs text-slate-500 truncate">{user.email}</p>
          </div>

          <div className="p-1.5">
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setShowProfile(true);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-100 transition text-left"
            >
              <UserRound className="w-4 h-4 text-slate-400" />
              <span>Mi perfil</span>
            </button>

            {canAdminUsers && (
              <Link
                role="menuitem"
                href="/dashboard/admin/users"
                onClick={() => setOpen(false)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-100 transition"
              >
                <Users className="w-4 h-4 text-slate-400" />
                <span>Administrar usuarios</span>
              </Link>
            )}
          </div>

          <div className="p-1.5 border-t border-slate-100">
            <button
              role="menuitem"
              onClick={handleLogout}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-semibold text-red-600 hover:bg-red-50 transition text-left"
            >
              <LogOut className="w-4 h-4" />
              <span>Cerrar sesión</span>
            </button>
          </div>
        </div>
      )}

      {showProfile && <ProfileModal session={session} onClose={() => setShowProfile(false)} />}
    </div>
  );
}
