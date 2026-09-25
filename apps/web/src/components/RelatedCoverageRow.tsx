'use client';

import { useState } from 'react';
import { Newspaper } from 'lucide-react';
import type { RelatedSource } from '@/lib/types';

/**
 * Tarjeta "También lo publicaron" para la pestaña Resumen de noticia del modal.
 * Muestra, como fila de chips con logo, los otros medios (de los 5 ya
 * scrapeados) que el matcher del Engine detectó cubriendo la misma noticia
 * (RawNews.related_sources). No renderiza nada si no hay coincidencias —
 * evita una tarjeta vacía en el caso (todavía mayoritario) de que nadie más
 * la haya publicado o el backfill aún no corrió.
 */
export default function RelatedCoverageRow({
  sources,
  className = '',
}: {
  sources: RelatedSource[] | undefined;
  className?: string;
}) {
  if (!sources || sources.length === 0) return null;

  const sorted = [...sources].sort((a, b) => b.similarity - a.similarity);

  return (
    <div className={`rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-3 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
          <Newspaper className="h-3.5 w-3.5 text-[#FF5500]" /> También lo publicaron
        </span>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[10.5px] font-black text-slate-500">
          {sorted.length} {sorted.length === 1 ? 'medio' : 'medios'}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {sorted.map((s) => (
          <SourceChip key={s.source_id} source={s} />
        ))}
      </div>
    </div>
  );
}

function SourceChip({ source }: { source: RelatedSource }) {
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer"
      title={source.title}
      className="group flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 py-1.5 pl-1.5 pr-3 transition hover:border-orange-300 hover:bg-orange-50"
    >
      {source.source_logo_url && !logoFailed ? (
        <img
          src={source.source_logo_url}
          alt=""
          className="h-5 w-5 rounded-full bg-white object-contain ring-1 ring-slate-200"
          onError={() => setLogoFailed(true)}
        />
      ) : (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[9px] font-black text-slate-500 ring-1 ring-slate-200">
          {source.source_name.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="text-xs font-bold text-slate-700 group-hover:text-[#FF5500]">
        {source.source_name}
      </span>
    </a>
  );
}
