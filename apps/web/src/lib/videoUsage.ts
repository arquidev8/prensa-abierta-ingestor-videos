import { engineRequest } from './authClient';

// Cuota diaria de videos del usuario, tal cual la calcula el Engine (models.User.EffectiveDailyVideoLimit
// + contador por día). El Engine es la única fuente de verdad: el front solo la muestra.

export interface VideoUsage {
  /** Límite diario efectivo; -1 = sin límite. */
  limit: number;
  used: number;
  /** Cuántos videos quedan hoy; null si no hay límite. */
  remaining: number | null;
}

const VIDEO_USAGE_EVENT = 'pa-video-usage-changed';

/** Avisa a la UI (el contador del navbar) que el uso de videos puede haber cambiado. */
export function notifyVideoUsageChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(VIDEO_USAGE_EVENT));
}

export function subscribeVideoUsage(callback: () => void): () => void {
  window.addEventListener(VIDEO_USAGE_EVENT, callback);
  return () => window.removeEventListener(VIDEO_USAGE_EVENT, callback);
}

/**
 * Pide el uso de hoy. El Engine cuenta el render apenas lo encola, pero el cliente solo se entera
 * cuando termina, así que quien dispara un render llama a esta función (vía notify) al empezar y
 * al terminar.
 */
export async function fetchVideoUsage(userId: string, token: string): Promise<VideoUsage | null> {
  const result = await engineRequest<{ limit: number; used_today: number }>(`/api/users/${userId}/video-usage`, { token });
  if (!result.ok) return null;
  const { limit, used_today: used } = result.data;
  return { limit, used, remaining: limit < 0 ? null : Math.max(limit - used, 0) };
}
