'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { useSession } from '@/hooks/useSession';
import { DEFAULT_LANDING, getRouteAccess } from '@/lib/routeAccess';

/**
 * Guard de páginas: solo muestra el contenido si la ruta permite al usuario actual (ver
 * lib/routeAccess.ts). Sin sesión manda al login recordando a dónde iba (`?next=`); con sesión pero
 * sin permiso de rol, vuelve al panel con un aviso.
 *
 * Es una protección de la interfaz: la sesión vive en el navegador, así que no reemplaza la
 * autorización de los endpoints (Go Engine y rutas /api de Next).
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { session, hydrated } = useSession();

  // Si en esta pestaña hubo sesión y ahora no (cierre de sesión o vencimiento), el destino es el
  // login limpio: no tiene sentido recordar la página desde la que se salió.
  const hadSession = useRef(false);
  useEffect(() => {
    if (session) hadSession.current = true;
  }, [session]);

  const access = hydrated ? getRouteAccess(pathname, session?.user.role ?? null) : null;

  useEffect(() => {
    if (access === 'login') {
      router.replace(hadSession.current ? '/' : `/?next=${encodeURIComponent(pathname)}`);
    } else if (access === 'forbidden') {
      toast.error('No tienes permiso para acceder a esa sección.', { id: 'route-forbidden' });
      router.replace(DEFAULT_LANDING);
    }
  }, [access, pathname, router]);

  if (access !== 'allowed') return null;
  return <>{children}</>;
}
