'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import LoginCard from '@/components/LoginCard';
import { useSession } from '@/hooks/useSession';
import type { AuthSession } from '@/lib/authClient';
import { resolvePostLoginPath } from '@/lib/routeAccess';

export default function LoginPage() {
  const router = useRouter();
  const { session, hydrated } = useSession();

  // Con sesión activa "/" no tiene nada que mostrar: se va directo al panel.
  useEffect(() => {
    if (hydrated && session) router.replace(resolvePostLoginPath(session.user.role, window.location.search));
  }, [hydrated, session, router]);

  const handleLoggedIn = (s: AuthSession) => {
    toast.success(`Sesión iniciada como ${s.user.name}.`);
    router.replace(resolvePostLoginPath(s.user.role, window.location.search));
  };

  if (!hydrated || session) return null;

  return (
    <div className="min-h-[60vh] flex items-center justify-center py-6">
      <LoginCard onLoggedIn={handleLoggedIn} />
    </div>
  );
}
