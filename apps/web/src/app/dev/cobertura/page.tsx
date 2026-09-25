'use client';

/**
 * Demo local de "También lo publicaron" (RelatedCoverageRow) dentro de la
 * pestaña "Resumen de noticia" del modal del Feed, con datos de ejemplo
 * (dummyRelatedCoverage.ts) — el Engine real (pkg/matcher) todavía no se
 * probó contra los 5 feeds en vivo, así que esto sirve para decidir el diseño
 * antes de portarlo a apps/web/src/app/dashboard/page.tsx.
 *
 * Ruta: /dev/cobertura · NO forma parte del producto.
 *
 * Recrea el mismo chrome de modal que /dev/comparativa (barra superior,
 * pestañas, barra de acciones) pero acotado a la pestaña "Resumen de noticia",
 * que es donde se decidió montar el componente: justo debajo de la Auditoría
 * legal anti-plagio y antes del cuerpo de la nota.
 */

import { useEffect, useState } from 'react';
import {
  FlaskConical,
  BookOpen,
  Scale,
  Clapperboard,
  Copy,
  Download,
  UploadCloud,
  ExternalLink,
  Newspaper,
  Sparkles,
  Clock,
} from 'lucide-react';
import { LegalAuditBanner, ArticleBody } from '@/components/ArticleComparison';
import VideoPlayerPreview from '@/components/VideoPlayerPreview';
import RelatedCoverageRow from '@/components/RelatedCoverageRow';
import RelatedCoverageStack from '@/components/RelatedCoverageStack';
import {
  DUMMY_COVERAGE_CASES,
  DUMMY_COVERAGE_LABELS,
  type DummyCoverageCase,
} from '@/lib/dummyRelatedCoverage';

const CARD_SAMPLE = {
  sourceName: 'Metro Puerto Rico',
  title: 'Más humedad y aguaceros, pero seguirá el calor',
  summary:
    'El paso de una débil onda tropical aumentará la actividad de lluvia durante el fin de semana.',
  image:
    'https://images.unsplash.com/photo-1500674425229-f692875b0ab7?w=800&auto=format&fit=crop',
  originalUrl: 'https://www.metro.pr/pr/noticias/ejemplo-clima',
};

const SAMPLE = {
  category: 'Nacional',
  sourceName: 'El Nuevo Día',
  sourceUrl: 'https://www.elnuevodia.com',
  title: 'Gobernadora anuncia nuevas medidas de seguridad tras aumento de criminalidad',
  subtitle:
    'El plan incluye más patrullaje y cámaras de vigilancia en el área metropolitana de San Juan.',
  originalContent:
    'La gobernadora Jenniffer González anunció este jueves un plan de seguridad para atender el aumento de la criminalidad en el área metropolitana de San Juan, con más patrullaje y cámaras.',
  rewrittenContent: `<p>La gobernadora Jenniffer González presentó un nuevo plan de seguridad pública orientado a atender el repunte de incidentes violentos reportado en las últimas semanas en el área metropolitana de San Juan.</p><p>Entre las medidas anunciadas figuran el aumento de patrullaje preventivo en horarios nocturnos y la instalación de cámaras de vigilancia adicionales en puntos identificados como de mayor incidencia.</p><p>La mandataria indicó que el plan se implementará de forma escalonada durante las próximas semanas, en coordinación con los municipios afectados.</p>`,
  tags: ['seguridad', 'gobierno', 'san-juan'],
  featuredImage: 'https://images.unsplash.com/photo-1595854341625-f33ee10dbf94?w=1200',
};

const CASES: DummyCoverageCase[] = ['many', 'one', 'none'];

export default function CoberturaDemoPage() {
  const [open, setOpen] = useState(true);
  const [caseId, setCaseId] = useState<DummyCoverageCase>('many');

  // Estado inicial desde la URL (?case=) — solo en cliente, tras montar.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const c = p.get('case');
    if (c === 'many' || c === 'one' || c === 'none') setCaseId(c);
  }, []);

  const sources = DUMMY_COVERAGE_CASES[caseId];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3">
        <FlaskConical className="w-4 h-4 text-[#FF5500] shrink-0" />
        <p className="text-xs text-slate-600 flex-1 min-w-[240px]">
          <strong className="font-black text-slate-900">Demo local</strong> — componente
          &quot;También lo publicaron&quot; con datos de ejemplo. Cambia de caso para ver la
          tarjeta con varias coincidencias, una sola, o ninguna (no se renderiza).
        </p>
        <button
          onClick={() => setOpen(true)}
          className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700"
        >
          Abrir modal
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {CASES.map((c) => (
          <button
            key={c}
            onClick={() => setCaseId(c)}
            className={`rounded-xl border px-3.5 py-2 text-left transition ${
              c === caseId
                ? 'border-[#FF5500] bg-orange-50 shadow-sm'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <span className="block text-xs font-black text-slate-900">
              {DUMMY_COVERAGE_LABELS[c]}
            </span>
          </button>
        ))}
      </div>

      {/* ---- Cards del Feed (grid, mismo markup que dashboard/page.tsx) ------- */}
      <div className="space-y-2">
        <p className="text-xs font-bold text-slate-500">
          Mismo componente, versión compacta para la card del grid (RelatedCoverageStack):
        </p>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {CASES.map((c) => (
            <div
              key={c}
              className="group flex flex-col justify-between overflow-hidden rounded-3xl border border-slate-200/90 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.03)] transition-all duration-300 hover:border-orange-300 hover:shadow-xl"
            >
              <div>
                <div className="relative h-48 w-full overflow-hidden bg-slate-100">
                  <img
                    src={CARD_SAMPLE.image}
                    alt={CARD_SAMPLE.title}
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30" />
                  <div className="absolute left-3 top-3 flex flex-col gap-1.5">
                    <span className="w-fit rounded-lg border border-white/40 bg-white/90 px-2.5 py-1 text-[11px] font-black text-slate-900 shadow-sm backdrop-blur">
                      {CARD_SAMPLE.sourceName}
                    </span>
                  </div>
                  <div className="absolute right-3 top-3">
                    <span className="flex items-center gap-1 rounded-lg border border-amber-300/30 bg-black/60 px-2.5 py-1 text-[11px] font-bold text-amber-300 backdrop-blur">
                      <Clock className="h-3 w-3" /> Pendiente
                    </span>
                  </div>
                </div>
                <div className="space-y-2.5 p-5">
                  <h3 className="line-clamp-2 text-base font-black leading-snug text-slate-900 transition group-hover:text-[#FF5500]">
                    {CARD_SAMPLE.title}
                  </h3>
                  <p className="line-clamp-3 text-xs leading-relaxed text-slate-600">
                    {CARD_SAMPLE.summary}
                  </p>
                  <RelatedCoverageStack sources={DUMMY_COVERAGE_CASES[c]} />
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 p-5">
                <a
                  href={CARD_SAMPLE.originalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-800"
                  title="Ver en diario original"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
                <button className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#FF5500] to-[#FF7700] px-4 py-2 text-xs font-black text-white shadow-md shadow-orange-500/20 transition hover:from-[#E04B00] hover:to-[#FF6600] active:scale-95">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Redactar & Video</span>
                </button>
              </div>
              <p className="border-t border-dashed border-slate-100 px-5 pb-3 pt-2 text-[10px] text-slate-400">
                {DUMMY_COVERAGE_LABELS[c]}
              </p>
            </div>
          ))}
        </div>
      </div>

      {!open && <p className="text-xs text-slate-400">Modal cerrado. Pulsa “Abrir modal”.</p>}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-2 backdrop-blur-md sm:p-4">
          <div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            {/* ---- Barra superior ------------------------------------------------ */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex items-center gap-1.5 rounded-xl border border-orange-200 bg-orange-50 px-2.5 py-1 text-[11px] font-black uppercase tracking-wider text-[#FF5500]">
                  <img src="/logo.png" alt="" className="h-4 w-4 rounded object-cover" />
                  Prensa Abierta
                </span>
                <span className="hidden truncate text-xs font-bold text-slate-500 sm:block">
                  {SAMPLE.category} · Fuente: {SAMPLE.sourceName}
                </span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-xl px-2 py-1.5 text-xs font-bold text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
              >
                ✕ Cerrar
              </button>
            </div>

            {/* ---- Pestañas principales (solo "Resumen" está viva en este demo) -- */}
            <div className="flex shrink-0 items-center gap-1 border-b border-slate-200 bg-slate-50/70 px-3 sm:px-5">
              <span className="-mb-px flex items-center gap-1.5 border-b-2 border-[#FF5500] px-3 py-3 text-xs font-bold text-[#FF5500]">
                <BookOpen className="h-3.5 w-3.5" />
                <span>Resumen de noticia</span>
              </span>
              <span className="-mb-px flex items-center gap-1.5 border-b-2 border-transparent px-3 py-3 text-xs font-bold text-slate-300">
                <Scale className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Comparativa & Diferencias</span>
              </span>
              <span className="-mb-px flex items-center gap-1.5 border-b-2 border-transparent px-3 py-3 text-xs font-bold text-slate-300">
                <Clapperboard className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Editor de video</span>
              </span>
            </div>

            {/* ---- Cuerpo (scroll único) --------------------------------------- */}
            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/50 custom-scrollbar">
              <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
                {/* 1 · Título */}
                <div className="space-y-2.5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-orange-200 bg-orange-100 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wide text-[#FF5500]">
                      {SAMPLE.category}
                    </span>
                    <a
                      href={SAMPLE.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"
                    >
                      <ExternalLink className="h-3 w-3" /> {SAMPLE.sourceName}
                    </a>
                  </div>
                  <h1 className="text-xl font-black leading-tight tracking-tight text-slate-900 sm:text-2xl">
                    {SAMPLE.title}
                  </h1>
                  <div className="rounded-r-xl border-l-4 border-[#FF5500] bg-orange-50/50 py-1 pl-3.5">
                    <p className="text-xs font-semibold italic leading-relaxed text-slate-700 sm:text-sm">
                      {SAMPLE.subtitle}
                    </p>
                  </div>
                </div>

                {/* 2 · Preview del video */}
                <div className="flex flex-col items-center gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
                    <Clapperboard className="h-3.5 w-3.5 text-[#FF5500]" /> Video Reel 9:16
                  </span>
                  <VideoPlayerPreview
                    title={SAMPLE.title}
                    category={SAMPLE.category}
                    imageFallback={SAMPLE.featuredImage}
                    duration={12}
                    newsId="dev-cobertura-sample"
                  />
                </div>

                {/* 3 · Auditoría legal anti-plagio */}
                <LegalAuditBanner
                  originalContent={SAMPLE.originalContent}
                  rewrittenContent={SAMPLE.rewrittenContent}
                />

                {/* 3.5 · También lo publicaron — lo nuevo de este demo */}
                <RelatedCoverageRow sources={sources} />

                {/* 4 · Nota completa */}
                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <span className="mb-3 flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
                    <BookOpen className="h-3.5 w-3.5 text-[#FF5500]" /> Nota completa (redacción IA)
                  </span>
                  <ArticleBody content={SAMPLE.rewrittenContent} />
                  <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-4">
                    <span className="mr-1 text-xs font-bold text-slate-500">Etiquetas:</span>
                    {SAMPLE.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-700"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ---- Barra de acciones persistente ----------------------------- */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:px-5">
              <button className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-200">
                <Copy className="h-3.5 w-3.5" /> Copiar artículo
              </button>
              <div className="flex items-center gap-2">
                <button className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#FF5500] to-[#FF7700] px-4 py-2 text-xs font-black text-white shadow-md shadow-orange-500/20 hover:from-[#E04B00] hover:to-[#FF6600]">
                  <Download className="h-3.5 w-3.5" /> Descargar Video (.mp4)
                </button>
                <button className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white shadow-md shadow-emerald-600/20 hover:bg-emerald-500">
                  <UploadCloud className="h-3.5 w-3.5" /> Aprobar & Inyectar en WordPress
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* placeholder para que la página tenga altura cuando el modal está cerrado */}
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Newspaper className="h-4 w-4" /> Feed PR (fondo simulado)
      </div>
    </div>
  );
}
