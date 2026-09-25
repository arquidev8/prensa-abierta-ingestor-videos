'use client';

import { useState } from 'react';
import { Newspaper } from 'lucide-react';
import type { RelatedSource } from '@/lib/types';

/**
 * Versión compacta de RelatedCoverageRow para la card del Feed (grid de 3
 * columnas, poco espacio): pila de mini-logos superpuestos + "+N" si sobran,
 * en vez de la fila de chips con nombre que usa el modal. No renderiza nada
 * si no hay coincidencias — misma razón que RelatedCoverageRow: en la mayoría
 * de las noticias hoy no hay ningún medio relacionado.
 */
export default function RelatedCoverageStack({
  sources,
  max = 3,
  className = '',
}: {
  sources: RelatedSource[] | undefined;
  max?: number;
  className?: string;
}) {
  if (!sources || sources.length === 0) return null;

  const sorted = [...sources].sort((a, b) => b.similarity - a.similarity);
  const shown = sorted.slice(0, max);
  const overflow = sorted.length - shown.length;

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <Newspaper className="h-3 w-3 text-slate-400 shrink-0" />
      <span className="text-[10.5px] font-bold text-slate-500 shrink-0">También en:</span>
      <div className="flex items-center -space-x-2">
        {shown.map((s) => (
          <StackAvatar key={s.source_id} source={s} />
        ))}
        {overflow > 0 && (
          <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-slate-200 text-[9px] font-black text-slate-600 ring-1 ring-slate-200">
            +{overflow}
          </span>
        )}
      </div>
    </div>
  );
}

function StackAvatar({ source }: { source: RelatedSource }) {
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <span
      title={source.source_name}
      className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-white ring-1 ring-slate-200"
    >
      {source.source_logo_url && !logoFailed ? (
        <img
          src={source.source_logo_url}
          alt={source.source_name}
          className="h-full w-full rounded-full object-contain"
          onError={() => setLogoFailed(true)}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-full bg-slate-200 text-[8px] font-black text-slate-500">
          {source.source_name.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}
