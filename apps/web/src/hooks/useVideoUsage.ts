'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from '@/hooks/useSession';
import { fetchVideoUsage, subscribeVideoUsage, type VideoUsage } from '@/lib/videoUsage';

const REFRESH_INTERVAL_MS = 60_000;

/**
 * Cuota diaria de videos del usuario logueado, solo para el rol `editor` (admin y superadmin no
 * tienen tope). Se refresca al montar, cuando alguien avisa (notifyVideoUsageChanged), al volver a
 * la pestaña y cada minuto — esto último recoge también un cambio de límite hecho por un admin o el
 * reinicio diario del contador.
 */
export function useVideoUsage(): VideoUsage | null {
  const { session } = useSession();
  const userId = session?.user.id;
  const token = session?.token;
  const isEditor = session?.user.role === 'editor';

  const [usage, setUsage] = useState<VideoUsage | null>(null);

  const refresh = useCallback(async () => {
    if (!userId || !token) return;
    const next = await fetchVideoUsage(userId, token);
    if (next) setUsage(next);
  }, [userId, token]);

  useEffect(() => {
    if (!isEditor) {
      setUsage(null);
      return;
    }
    void refresh();

    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const unsubscribe = subscribeVideoUsage(() => void refresh());
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);

    return () => {
      unsubscribe();
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [isEditor, refresh]);

  return isEditor ? usage : null;
}
