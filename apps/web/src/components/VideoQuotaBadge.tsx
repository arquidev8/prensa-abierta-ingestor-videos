'use client';

import { Clapperboard } from 'lucide-react';
import { useVideoUsage } from '@/hooks/useVideoUsage';

/**
 * Contador del navbar para editores: cuántos videos les quedan hoy. No renderiza nada para otros
 * roles ni mientras no llega el dato del Engine.
 */
export default function VideoQuotaBadge() {
  const usage = useVideoUsage();
  if (!usage) return null;

  const unlimited = usage.remaining === null;
  const remaining = usage.remaining ?? 0;
  const exhausted = !unlimited && remaining === 0;
  const low = !unlimited && !exhausted && remaining / usage.limit <= 0.4;

  const tone = unlimited
    ? 'bg-slate-50 text-slate-600 border-slate-200'
    : exhausted
      ? 'bg-red-50 text-red-700 border-red-200'
      : low
        ? 'bg-amber-50 text-amber-800 border-amber-200'
        : 'bg-emerald-50 text-emerald-700 border-emerald-200';

  const title = unlimited
    ? `Hoy has generado ${usage.used} ${usage.used === 1 ? 'video' : 'videos'}. Tu cuenta no tiene límite diario.`
    : exhausted
      ? `Alcanzaste tu límite de ${usage.limit} ${usage.limit === 1 ? 'video' : 'videos'} por día. El contador se reinicia cada día.`
      : `Hoy has generado ${usage.used} de ${usage.limit} videos; te ${remaining === 1 ? 'queda' : 'quedan'} ${remaining}. El contador se reinicia cada día.`;

  return (
    <span
      title={title}
      aria-label={title}
      data-testid="video-quota"
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold whitespace-nowrap shrink-0 ${tone}`}
    >
      <Clapperboard className="w-3.5 h-3.5 shrink-0" />
      {unlimited ? (
        <span>Sin límite</span>
      ) : exhausted ? (
        <span>Límite alcanzado</span>
      ) : (
        <>
          <span className="hidden sm:inline">Quedan</span>
          <span>
            {remaining}/{usage.limit}
          </span>
          <span className="hidden lg:inline font-semibold opacity-80">hoy</span>
        </>
      )}
    </span>
  );
}
