'use client';

/**
 * Sala de Cotejo — vista rediseñada de "Comparativa & Diferencias".
 *
 * Reemplaza las dos cajas de scroll independientes (que no dejaban comparar nada)
 * por tres modos sobre el MISMO texto alineado:
 *   · Paralelo  — párrafos del diario y de la redacción propia enfrentados fila a fila.
 *   · Redline   — marcado legal palabra por palabra (rojo = se quitó, verde = se añadió).
 *   · Resumen   — métricas reales + menciones externas retiradas + veredicto.
 *
 * Todo se calcula en el cliente a partir del texto real (ver lib/textDiff.ts).
 */

import React, { useMemo, useState } from 'react';
import {
  Scale,
  Columns2,
  FileDiff,
  ClipboardCheck,
  ShieldCheck,
  ShieldAlert,
  Clock,
} from 'lucide-react';
import {
  buildCompareSummary,
  wordDiff,
  splitParagraphs,
  KIND_META,
  KIND_ORDER,
  type RowKind,
  type AlignedRow,
} from '@/lib/textDiff';

/** Tipografía de párrafo compartida entre el cotejo y el cuerpo del artículo. */
const ARTICLE_PARA = 'text-[12.5px] leading-relaxed text-slate-700';

/**
 * Cuerpo del artículo redactado por la IA, completo y sin re-trocear, con la misma
 * tipografía que usan las columnas de la pestaña "Comparativa & Diferencias".
 * Reutilizable en el tab "Resumen de noticia".
 */
export function ArticleBody({
  content,
  className = '',
}: {
  content: string;
  className?: string;
}) {
  const paragraphs = useMemo(() => splitParagraphs(content), [content]);

  if (paragraphs.length === 0) {
    return <p className="text-sm italic text-slate-400">No hay contenido disponible.</p>;
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {paragraphs.map((p, i) => (
        <p key={i} className={ARTICLE_PARA}>
          {p}
        </p>
      ))}
    </div>
  );
}

interface ArticleComparisonProps {
  sourceName?: string;
  originalTitle?: string;
  originalContent: string;
  rewrittenTitle?: string;
  rewrittenContent: string;
  initialMode?: 'paralelo' | 'redline' | 'resumen';
}

type Mode = 'paralelo' | 'redline' | 'resumen';

const MODES: { id: Mode; label: string; icon: typeof Columns2 }[] = [
  { id: 'paralelo', label: 'Paralelo', icon: Columns2 },
  { id: 'redline', label: 'Redline', icon: FileDiff },
  { id: 'resumen', label: 'Resumen', icon: ClipboardCheck },
];

function verdict(similarity: number) {
  const pct = Math.round(similarity * 100);
  if (similarity < 0.15)
    return {
      pct,
      tone: 'emerald' as const,
      icon: ShieldCheck,
      title: 'Reescritura sólida',
      note: 'Casi ninguna frase larga se comparte con el diario original.',
    };
  if (similarity < 0.35)
    return {
      pct,
      tone: 'amber' as const,
      icon: ShieldCheck,
      title: 'Diferenciación aceptable',
      note: 'Quedan algunas expresiones en común; revisa los párrafos en ámbar.',
    };
  return {
    pct,
    tone: 'red' as const,
    icon: ShieldAlert,
    title: 'Revisar antes de publicar',
    note: 'Hay bloques de texto casi calcados. Reescribe los párrafos marcados en rojo.',
  };
}

const TONE = {
  emerald: { text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', fill: 'bg-emerald-500' },
  amber: { text: 'text-amber-800', bg: 'bg-amber-50', border: 'border-amber-200', fill: 'bg-amber-500' },
  red: { text: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', fill: 'bg-red-500' },
};

export default function ArticleComparison({
  sourceName = 'Diario original',
  originalTitle,
  originalContent,
  rewrittenTitle,
  rewrittenContent,
  initialMode = 'paralelo',
}: ArticleComparisonProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [focusKind, setFocusKind] = useState<RowKind | null>(null);

  const summary = useMemo(
    () => buildCompareSummary(originalContent, rewrittenContent),
    [originalContent, rewrittenContent]
  );

  const v = verdict(summary.similarity);
  const totalWeight = Math.max(
    1,
    KIND_ORDER.reduce((acc, k) => acc + summary.byKind[k], 0)
  );
  const wordDelta = summary.wordsRewritten - summary.wordsOriginal;

  const visibleRows = focusKind
    ? summary.rows.filter((r) => r.kind === focusKind)
    : summary.rows;

  return (
    <div className="space-y-4">
      {/* ---- Auditoría legal anti-plagio (mismo bloque que en el modal actual) ---- */}
      <LegalAuditBanner originalContent={originalContent} rewrittenContent={rewrittenContent} />

      {/* ---- Barra de cotejo + métricas de lectura ----------------------- */}
      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 sm:px-5 pt-4 text-[11px] text-slate-500">
          <span className="flex items-center gap-1 font-black uppercase tracking-[0.12em] text-slate-400">
            <Scale className="w-3 h-3" /> Cotejo
          </span>
          <span>
            <strong className="font-mono text-slate-800">
              {summary.wordsOriginal} → {summary.wordsRewritten}
            </strong>{' '}
            palabras ({wordDelta >= 0 ? '+' : ''}
            {wordDelta})
          </span>
          <span className="text-slate-300">·</span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" /> lectura{' '}
            <strong className="font-mono text-slate-800">{summary.minutesRewritten} min</strong>
          </span>
          <span className="hidden flex-1 sm:block" />
          <span className={`font-semibold ${TONE[v.tone].text}`}>{v.note}</span>
        </div>

        {/* ---- Barra de cotejo (firma visual) ---- */}
        <div className="px-4 sm:px-5 pt-3 pb-4">
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200">
            {KIND_ORDER.map((k) => {
              const w = (summary.byKind[k] / totalWeight) * 100;
              if (w < 0.5) return null;
              const active = !focusKind || focusKind === k;
              return (
                <button
                  key={k}
                  onClick={() => setFocusKind(focusKind === k ? null : k)}
                  title={`${KIND_META[k].label} · ${Math.round(w)}%`}
                  className="h-full transition-opacity hover:opacity-100"
                  style={{
                    width: `${w}%`,
                    backgroundColor: KIND_META[k].bar,
                    opacity: active ? 1 : 0.28,
                  }}
                />
              );
            })}
          </div>

          {/* Leyenda / filtro */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {KIND_ORDER.map((k) => {
              const pct = Math.round((summary.byKind[k] / totalWeight) * 100);
              if (pct <= 0) return null;
              const active = focusKind === k;
              return (
                <button
                  key={k}
                  onClick={() => setFocusKind(active ? null : k)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10.5px] font-bold transition ${
                    active
                      ? KIND_META[k].chip
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700'
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${KIND_META[k].dot}`} />
                  {KIND_META[k].short}
                  <span className="font-mono text-slate-400">{pct}%</span>
                </button>
              );
            })}
            {focusKind && (
              <button
                onClick={() => setFocusKind(null)}
                className="ml-1 rounded-lg px-2 py-1 text-[10.5px] font-bold text-[#FF5500] hover:bg-orange-50"
              >
                Ver todo
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ---- Selector de modo -------------------------------------------- */}
      <div className="flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm w-fit">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
              mode === m.id ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <m.icon className="w-3.5 h-3.5" />
            {m.label}
          </button>
        ))}
      </div>

      {/* ---- Contenido -------------------------------------------------- */}
      {mode === 'resumen' ? (
        <SummaryPanel summary={summary} sourceName={sourceName} verdictTone={v.tone} />
      ) : (
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          {/* Cabeceras de columna (solo Paralelo) */}
          {mode === 'paralelo' && (
            <div className="sticky top-0 z-10 grid grid-cols-[3px_1fr_1fr] items-center rounded-t-3xl border-b border-slate-200 bg-white/95 backdrop-blur">
              <div />
              <div className="border-r border-slate-100 px-3 py-2.5">
                <ColumnLabel tone="origen" title={sourceName} subtitle="Origen de la noticia" />
              </div>
              <div className="px-3 py-2.5">
                <ColumnLabel tone="propia" title="Prensa Abierta" subtitle="Redacción propia" />
              </div>
            </div>
          )}

          <div className="p-3 sm:p-4">
            {visibleRows.length === 0 ? (
              <p className="py-10 text-center text-xs text-slate-400">
                Ningún párrafo en esta categoría.
              </p>
            ) : mode === 'paralelo' ? (
              <div className="space-y-2.5">
                {(originalTitle || rewrittenTitle) && !focusKind && (
                  <ParallelRow
                    row={{
                      kind:
                        (originalTitle || '').trim().toLowerCase() ===
                        (rewrittenTitle || '').trim().toLowerCase()
                          ? 'identico'
                          : 'reescrito',
                      original: originalTitle,
                      rewritten: rewrittenTitle,
                      similarity: 0,
                    }}
                    isTitle
                  />
                )}
                {visibleRows.map((row, i) => (
                  <ParallelRow key={i} row={row} />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {visibleRows.map((row, i) => (
                  <RedlineBlock key={i} row={row} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-componentes                                                     */
/* ------------------------------------------------------------------ */

/**
 * Bloque "Auditoría legal anti-plagio" — mismo lenguaje visual que el modal actual
 * (banner con degradado + insignia + 3 tarjetas), pero con cifras reales: la insignia
 * refleja el veredicto y las tarjetas muestran menciones retiradas y similitud léxica
 * calculadas sobre el texto. Reutilizable en el tab "Resumen de noticia".
 */
export function LegalAuditBanner({
  originalContent,
  rewrittenContent,
  className = '',
}: {
  originalContent: string;
  rewrittenContent: string;
  className?: string;
}) {
  const summary = useMemo(
    () => buildCompareSummary(originalContent, rewrittenContent),
    [originalContent, rewrittenContent]
  );
  const v = verdict(summary.similarity);

  const gradient = {
    emerald: 'from-emerald-50 via-teal-50 to-white border-emerald-200',
    amber: 'from-amber-50 via-orange-50 to-white border-amber-200',
    red: 'from-red-50 via-rose-50 to-white border-red-200',
  }[v.tone];

  const badge = {
    emerald: { text: '✓ Reescritura libre de derechos', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
    amber: { text: 'Revisar expresiones en común', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
    red: { text: '⚠ Riesgo de plagio — revisar', cls: 'bg-red-100 text-red-800 border-red-300' },
  }[v.tone];

  return (
    <div className={`rounded-3xl border bg-gradient-to-r ${gradient} p-5 shadow-sm space-y-3 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
          <v.icon className={`h-4 w-4 ${TONE[v.tone].text}`} /> Auditoría legal anti-plagio
        </span>
        <span className={`rounded-full border px-3 py-1 text-[10.5px] font-black ${badge.cls}`}>
          {badge.text}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2.5 text-center">
        <AuditCard label="Voz editorial" value="Prensa Abierta" />
        <AuditCard
          label="Menciones retiradas"
          value={String(summary.removed.length)}
          valueClass={summary.removed.length > 0 ? 'text-emerald-700' : 'text-slate-500'}
        />
        <AuditCard
          label="Similitud léxica"
          value={`${v.pct}%`}
          valueClass={TONE[v.tone].text}
        />
      </div>
    </div>
  );
}

function AuditCard({
  label,
  value,
  valueClass = 'text-slate-900',
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm">
      <span className="block text-[10px] font-semibold text-slate-400">{label}</span>
      <strong className={`text-xs font-black ${valueClass}`}>{value}</strong>
    </div>
  );
}

function ColumnLabel({
  tone,
  title,
  subtitle,
  align = 'left',
}: {
  tone: 'origen' | 'propia';
  title?: string;
  subtitle: string;
  align?: 'left' | 'right';
}) {
  const dot = tone === 'origen' ? 'bg-stone-400' : 'bg-[#FF5500]';
  return (
    <div className={align === 'right' ? 'text-right' : ''}>
      <span
        className={`flex items-center gap-1.5 text-[11px] font-black text-slate-700 ${
          align === 'right' ? 'justify-end' : ''
        }`}
      >
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {title}
      </span>
      <span className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400">{subtitle}</span>
    </div>
  );
}

function ParallelRow({ row, isTitle = false }: { row: AlignedRow; isTitle?: boolean }) {
  const meta = KIND_META[row.kind];
  const base = isTitle ? 'text-sm font-black text-slate-900' : ARTICLE_PARA;

  // "% en común" solo aporta cuando el párrafo se editó parcialmente.
  const overlap =
    row.original && row.rewritten && (row.kind === 'editado' || row.kind === 'reescrito')
      ? `${Math.round(row.similarity * 100)}% en común`
      : null;

  return (
    <div
      className="overflow-hidden rounded-2xl border border-slate-200"
      style={{ borderLeft: `3px solid ${meta.bar}` }}
    >
      {/* Cabecera de la fila: tipo de cambio */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-slate-500">
          <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
          {isTitle ? 'Titular' : ''} {meta.short}
        </span>
        {overlap && (
          <span className="font-mono text-[10px] font-bold text-slate-600">{overlap}</span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2">
        {/* Origen */}
        <div className="border-b border-slate-100 bg-stone-50/50 p-3 sm:border-b-0 sm:border-r">
          {row.original ? (
            <p className={base}>{row.original}</p>
          ) : (
            <p className="text-[11px] italic text-slate-300">— sin equivalente en el original —</p>
          )}
        </div>
        {/* Propia */}
        <div className="bg-orange-50/20 p-3">
          {row.rewritten ? (
            <p className={base}>{row.rewritten}</p>
          ) : (
            <p className="text-[11px] italic text-slate-400">
              Descartado — no pasó a la redacción propia.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function RedlineBlock({ row }: { row: AlignedRow }) {
  const meta = KIND_META[row.kind];

  let ops;
  if (row.kind === 'eliminado') ops = [{ type: 'remove' as const, text: row.original || '' }];
  else if (row.kind === 'nuevo') ops = [{ type: 'add' as const, text: row.rewritten || '' }];
  else ops = wordDiff(row.original || '', row.rewritten || '');

  return (
    <div className="flex gap-2.5 rounded-2xl border border-slate-200 bg-white p-3">
      <div className="flex flex-col items-center gap-1 pt-0.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
        <span className="w-px flex-1 bg-slate-100" />
      </div>
      <p className={`${ARTICLE_PARA} leading-[1.7]`}>
        {ops.map((op, i) => {
          if (op.type === 'equal') return <span key={i}>{op.text}</span>;
          if (op.type === 'remove')
            return (
              <span
                key={i}
                className="rounded bg-red-50 px-0.5 text-red-500 line-through decoration-red-300"
              >
                {op.text}
              </span>
            );
          return (
            <span
              key={i}
              className="rounded bg-emerald-50 px-0.5 font-medium text-emerald-700 underline decoration-emerald-300 decoration-1 underline-offset-2"
            >
              {op.text}
            </span>
          );
        })}
      </p>
    </div>
  );
}

function SummaryPanel({
  summary,
  sourceName,
  verdictTone,
}: {
  summary: ReturnType<typeof buildCompareSummary>;
  sourceName: string;
  verdictTone: 'emerald' | 'amber' | 'red';
}) {
  const totalWeight = Math.max(
    1,
    KIND_ORDER.reduce((acc, k) => acc + summary.byKind[k], 0)
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Composición del texto */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
        <h4 className="text-xs font-black uppercase tracking-wider text-slate-700">
          De qué está hecha la redacción propia
        </h4>
        <div className="space-y-2.5">
          {KIND_ORDER.map((k) => {
            const pct = Math.round((summary.byKind[k] / totalWeight) * 100);
            return (
              <div key={k} className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5 font-bold text-slate-600">
                    <span className={`h-2 w-2 rounded-full ${KIND_META[k].dot}`} />
                    {KIND_META[k].label}
                  </span>
                  <span className="font-mono font-black text-slate-500">{pct}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, backgroundColor: KIND_META[k].bar }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Menciones externas retiradas */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-black uppercase tracking-wider text-slate-700">
            Menciones externas retiradas
          </h4>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${
              summary.removed.length > 0
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-slate-50 text-slate-500'
            }`}
          >
            {summary.removed.length}
          </span>
        </div>
        <p className="text-[11px] leading-snug text-slate-500">
          Nombres propios presentes en el texto de <strong>{sourceName}</strong> que ya no
          aparecen en la pieza de Prensa Abierta.
        </p>
        {summary.removed.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-400">
            No se detectaron nombres propios exclusivos del original.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {summary.removed.map((m) => (
              <span
                key={m.label}
                className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600"
              >
                <span className="line-through decoration-slate-400">{m.label}</span>
                {m.count > 1 && <span className="font-mono text-slate-400">×{m.count}</span>}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Nota legal */}
      <div
        className={`lg:col-span-2 rounded-3xl border p-4 text-[11px] leading-relaxed shadow-sm ${
          verdictTone === 'red'
            ? 'border-red-200 bg-red-50 text-red-700'
            : verdictTone === 'amber'
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
        }`}
      >
        <strong className="font-black">Cómo leer esta pantalla.</strong> La similitud léxica mide
        cuántas expresiones largas comparte la pieza con el diario original; por debajo de 15 % la
        reescritura se considera segura. Revisa los párrafos marcados en rojo (casi idénticos) y
        confirma que ninguna atribución de la lista superior sobrevivió antes de aprobar.
      </div>
    </div>
  );
}
