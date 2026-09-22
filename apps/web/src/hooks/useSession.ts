'use client';

import { useEffect, useState } from 'react';
import { getSession, subscribeSession, type AuthSession } from '@/lib/authClient';

/**
 * Sesión actual (localStorage) reactiva a login/logout. `hydrated` es false en el primer
 * render para que servidor y cliente pinten lo mismo; recién después se conoce la sesión.
 *
 * El access token (`session.token`, dura 15 min) se renueva solo en segundo plano — ver el
 * intervalo en lib/authClient.ts — así que este hook NO cierra la sesión cuando ese token
 * vence; se guía por `refresh_expires_at` (5 días), el vencimiento real de la sesión, para
 * cerrarla sola en el instante en que ya no hay forma de renovarla sin loguearse de nuevo.
 */
export function useSession(): { session: AuthSession | null; hydrated: boolean } {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const sync = () => setSession(getSession());
    sync();
    setHydrated(true);
    return subscribeSession(sync);
  }, []);

  useEffect(() => {
    if (!session) return;
    // getSession() descarta y limpia la sesión vencida, así que basta releerla al vencimiento.
    const msLeft = Math.min(new Date(session.refresh_expires_at).getTime() - Date.now(), 2 ** 31 - 1);
    const timer = setTimeout(() => setSession(getSession()), Math.max(msLeft, 0) + 50);
    return () => clearTimeout(timer);
  }, [session]);

  return { session, hydrated };
}
