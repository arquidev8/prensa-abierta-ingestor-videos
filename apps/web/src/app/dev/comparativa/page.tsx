'use client';

/**
 * Demo local del rediseño del modal de noticia del Feed, con foco en la pestaña
 * "Comparativa & Diferencias" (Sala de Cotejo).
 *
 * Ruta: /dev/comparativa  ·  NO forma parte del producto. Sirve para ver el modal
 * completo en conjunto y afinar la reorganización antes de portarla a page.tsx.
 *
 * Reorganización propuesta respecto al modal actual:
 *  · Las 3 vistas (Redacción / Comparativa / Video) pasan a ser pestañas
 *    principales de ancho completo, en vez de: subtabs apretados en una columna 7/12
 *    + un panel de video fijo que se come el 40% de la pantalla siempre.
 *  · Barra de acciones persistente abajo (Copiar · Descargar · Aprobar) visible
 *    en cualquier pestaña.
 *  · Resultado: la comparativa dispone del ancho completo del modal y el paralelo
 *    original↔propia por fin tiene espacio real.
 */

import React, { useEffect, useState } from 'react';
import {
  FlaskConical,
  BookOpen,
  Edit3,
  Scale,
  Clapperboard,
  Copy,
  Download,
  UploadCloud,
  ExternalLink,
  Newspaper,
  Save,
} from 'lucide-react';
import ArticleComparison, { LegalAuditBanner, ArticleBody } from '@/components/ArticleComparison';
import VideoPlayerPreview from '@/components/VideoPlayerPreview';

interface Sample {
  id: string;
  label: string;
  note: string;
  sourceName: string;
  sourceUrl: string;
  category: string;
  featuredImage: string;
  tags: string[];
  originalTitle: string;
  originalContent: string;
  rewrittenTitle: string;
  rewrittenSubtitle: string;
  rewrittenContent: string;
}

const SAMPLES: Sample[] = [
  {
    id: 'luma',
    label: 'Apagón LUMA',
    note: 'Reescritura fuerte',
    sourceName: 'El Nuevo Día',
    sourceUrl: 'https://www.elnuevodia.com',
    category: 'Nacional',
    featuredImage:
      'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=1200&auto=format&fit=crop&q=80',
    tags: ['LUMA', 'apagón', 'Ponce', 'energía'],
    originalTitle:
      'LUMA Energy reporta sobre 340,000 abonados sin servicio tras falla en el sur',
    originalContent: `LUMA Energy informó este martes que unos 340,000 abonados se encontraban sin servicio eléctrico luego de una falla registrada en una línea de transmisión en el área de Ponce durante la madrugada.

Según un comunicado del consorcio, las cuadrillas fueron despachadas de inmediato y se esperaba restablecer el servicio a la mayoría de los clientes antes del mediodía. "Entendemos la frustración de nuestros clientes y trabajamos con urgencia", dijo el portavoz de LUMA, Carlos Rivera.

La empresa explicó que la falla se originó en una subestación clave para la distribución en la región sur y que un equipo de protección se activó de forma automática, dejando fuera de línea varios circuitos a la vez.

El Negociado de Energía de Puerto Rico indicó que solicitará un informe detallado sobre las causas del evento. La gobernadora Jenniffer González expresó en la red social X que había pedido explicaciones a la empresa.

Hospitales y centros de diálisis del área activaron sus plantas de emergencia y no reportaron interrupciones en los servicios a pacientes, según el Departamento de Salud.

Comerciantes del casco urbano de Ponce reportaron pérdidas por productos perecederos y pidieron una compensación. Varios colegios de la zona suspendieron las clases durante la mañana.

LUMA indicó que publicará un desglose por municipios a medida que avance la reconexión y recordó a los abonados que pueden reportar situaciones a través de su aplicación móvil.`,
    rewrittenTitle: 'Más de 340,000 clientes amanecen sin luz en el sur del país',
    rewrittenSubtitle:
      'Una línea de transmisión en la zona de Ponce dejó de operar de madrugada; el regulador energético pedirá un reporte técnico.',
    rewrittenContent: `Cerca de 340,000 hogares y negocios del sur de la isla pasaron la mañana del martes sin electricidad, luego de que una línea de transmisión en la zona de Ponce dejara de operar durante la madrugada.

La avería obligó a movilizar brigadas de reparación antes del amanecer. La expectativa preliminar apuntaba a devolver la energía a la mayor parte de los afectados alrededor del mediodía, aunque no se ofreció una hora firme.

El fallo se habría originado en una subestación que concentra buena parte de la distribución del sur: un mecanismo de protección se disparó solo y arrastró varios circuitos al mismo tiempo.

El regulador energético del país adelantó que exigirá un reporte técnico con las causas del corte. Desde el Ejecutivo también se reclamaron explicaciones formales a la operadora del sistema.

Los centros de salud y las unidades de diálisis de la región funcionaron con plantas de respaldo y mantuvieron la atención a pacientes sin interrupciones, de acuerdo con las autoridades sanitarias.

En el centro de Ponce, varios comercios describieron mercancía echada a perder y adelantaron que buscarán algún tipo de resarcimiento por las horas sin servicio. Algunas escuelas del área pausaron la jornada durante la mañana.

La operadora anticipó que divulgará un detalle por municipio conforme avance la reconexión y pidió canalizar los reclamos por sus vías de contacto habituales.`,
  },
  {
    id: 'tribunal',
    label: 'Vista judicial',
    note: 'Edición media',
    sourceName: 'El Vocero',
    sourceUrl: 'https://www.elvocero.com',
    category: 'Tribunales',
    featuredImage:
      'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=1200&auto=format&fit=crop&q=80',
    tags: ['tribunal', 'corrupción', 'San Juan'],
    originalTitle:
      'Tribunal pauta para el 15 de octubre la próxima vista del caso de corrupción municipal',
    originalContent: `El Tribunal de Primera Instancia en San Juan pautó para el 15 de octubre la próxima vista del caso de corrupción que involucra a un exalcalde de la región metropolitana.

La jueza Marisol Declet ordenó a la defensa entregar los documentos financieros solicitados por el Ministerio Público antes del 1 de octubre. El fiscal a cargo, Héctor Pagán, sostuvo que la evidencia es "contundente".

La defensa, representada por el licenciado Roberto Sánchez, adelantó que solicitará la desestimación de tres de los cargos por entender que no hay causa.`,
    rewrittenTitle:
      'Pautan para el 15 de octubre la próxima vista del caso de corrupción municipal',
    rewrittenSubtitle:
      'La defensa deberá entregar documentos financieros antes del 1 de octubre y anticipa que pedirá desestimar tres cargos.',
    rewrittenContent: `El Tribunal de Primera Instancia en San Juan pautó para el 15 de octubre la próxima vista del caso de corrupción que involucra a un exalcalde del área metropolitana.

La jueza ordenó a la defensa entregar los documentos financieros solicitados por el Ministerio Público antes del 1 de octubre. La fiscalía sostiene que la evidencia reunida es contundente.

La defensa adelantó que solicitará la desestimación de tres de los cargos, al entender que no existe causa para sostenerlos.`,
  },
  {
    id: 'badbunny',
    label: 'Residencia Bad Bunny',
    note: 'Riesgo: párrafos calcados',
    sourceName: 'Primera Hora',
    sourceUrl: 'https://www.primerahora.com',
    category: 'Farándula',
    featuredImage:
      'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=1200&auto=format&fit=crop&q=80',
    tags: ['Bad Bunny', 'Choliseo', 'conciertos'],
    originalTitle:
      'Bad Bunny anuncia 10 conciertos adicionales de su residencia en el Choliseo',
    originalContent: `Bad Bunny anunció este lunes 10 conciertos adicionales de su residencia en el Coliseo de Puerto Rico José Miguel Agrelot, ante la alta demanda de boletos.

Las nuevas fechas se suman a las 21 previamente confirmadas para el verano de 2025. La venta de boletos para el público general comenzará el viernes a las 10:00 de la mañana a través de Ticketera.

El artista indicó que las primeras funciones estarán reservadas exclusivamente para residentes de Puerto Rico. Se estima que la residencia completa atraiga a más de 400,000 personas y genere un impacto económico millonario para la isla.`,
    rewrittenTitle: 'El artista suma 10 conciertos más a su residencia en el Choliseo',
    rewrittenSubtitle:
      'Las nuevas fechas se añaden a las 21 ya confirmadas para el verano de 2025.',
    rewrittenContent: `Bad Bunny anunció este lunes 10 conciertos adicionales de su residencia en el Coliseo de Puerto Rico, ante la alta demanda de boletos.

Las nuevas fechas se suman a las 21 previamente confirmadas para el verano de 2025. La venta de boletos para el público general comenzará el viernes a las 10:00 de la mañana.

El artista indicó que las primeras funciones estarán reservadas exclusivamente para residentes de la isla. Se estima que la residencia completa atraiga a más de 400,000 personas y genere un impacto económico millonario.`,
  },
];

type Tab = 'resumen' | 'cotejo';

const TABS: { id: Tab; label: string; icon: typeof BookOpen }[] = [
  { id: 'resumen', label: 'Resumen de noticia', icon: BookOpen },
  { id: 'cotejo', label: 'Comparativa & Diferencias', icon: Scale },
  // Tab de video oculto por el momento — restaurar con { id: 'video', label: 'Video 9:16', icon: Clapperboard }
  // y el bloque `tab === 'video'` del cuerpo.
];

export default function ComparativaDemoPage() {
  const [sampleId, setSampleId] = useState(SAMPLES[0].id);
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>('cotejo');
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<'paralelo' | 'redline' | 'resumen'>('paralelo');
  const sample = SAMPLES.find((s) => s.id === sampleId)!;

  // Estado inicial desde la URL (?tab= / ?case=) — solo en cliente, tras montar,
  // para no romper la hidratación del SSR.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const c = p.get('case');
    const t = p.get('tab');
    const md = p.get('mode');
    if (c && SAMPLES.some((s) => s.id === c)) setSampleId(c);
    if (t === 'resumen' || t === 'cotejo') setTab(t);
    if (md === 'paralelo' || md === 'redline' || md === 'resumen') setMode(md);
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3">
        <FlaskConical className="w-4 h-4 text-[#FF5500] shrink-0" />
        <p className="text-xs text-slate-600 flex-1 min-w-[240px]">
          <strong className="font-black text-slate-900">Demo local</strong> — modal de noticia
          reorganizado. Cambia de caso para ver los distintos veredictos del cotejo.
        </p>
        <button
          onClick={() => setOpen(true)}
          className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700"
        >
          Abrir modal
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {SAMPLES.map((s) => (
          <button
            key={s.id}
            onClick={() => setSampleId(s.id)}
            className={`rounded-xl border px-3.5 py-2 text-left transition ${
              s.id === sampleId
                ? 'border-[#FF5500] bg-orange-50 shadow-sm'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <span className="block text-xs font-black text-slate-900">{s.label}</span>
            <span className="block text-[10px] text-slate-500">{s.note}</span>
          </button>
        ))}
      </div>

      {!open && (
        <p className="text-xs text-slate-400">Modal cerrado. Pulsa “Abrir modal”.</p>
      )}

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
                  {sample.category} · Fuente: {sample.sourceName}
                </span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-xl px-2 py-1.5 text-xs font-bold text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
              >
                ✕ Cerrar
              </button>
            </div>

            {/* ---- Pestañas principales (ancho completo) ----------------------- */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-3 sm:px-5">
              <div className="flex items-center gap-1">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-3 text-xs font-bold transition ${
                      tab === t.id
                        ? 'border-[#FF5500] text-[#FF5500]'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <t.icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t.label}</span>
                  </button>
                ))}
              </div>
              {tab === 'resumen' && (
                <button
                  onClick={() => setEditing((e) => !e)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition ${
                    editing
                      ? 'border-[#FF5500] bg-orange-50 text-[#FF5500]'
                      : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  {editing ? 'Volver a lectura' : 'Editar'}
                </button>
              )}
            </div>

            {/* ---- Cuerpo ----------------------------------------------------- */}
            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/50 custom-scrollbar">
              {tab === 'resumen' && (
                <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
                  {/* 1 · Título */}
                  <div className="space-y-2.5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-orange-200 bg-orange-100 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wide text-[#FF5500]">
                        {sample.category}
                      </span>
                      <a
                        href={sample.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"
                      >
                        <ExternalLink className="h-3 w-3" /> {sample.sourceName}
                      </a>
                    </div>
                    <h1 className="text-xl font-black leading-tight tracking-tight text-slate-900 sm:text-2xl">
                      {sample.rewrittenTitle}
                    </h1>
                    <div className="rounded-r-xl border-l-4 border-[#FF5500] bg-orange-50/50 py-1 pl-3.5">
                      <p className="text-xs font-semibold italic leading-relaxed text-slate-700 sm:text-sm">
                        {sample.rewrittenSubtitle}
                      </p>
                    </div>
                  </div>

                  {/* 2 · Preview del video */}
                  {!editing && (
                    <div className="flex flex-col items-center gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
                        <Clapperboard className="h-3.5 w-3.5 text-[#FF5500]" /> Video Reel 9:16
                      </span>
                      <VideoPlayerPreview
                        title={sample.rewrittenTitle}
                        category={sample.category}
                        imageFallback={sample.featuredImage}
                        duration={12}
                        newsId={sample.id}
                      />
                    </div>
                  )}

                  {/* 3 · Auditoría legal anti-plagio */}
                  {!editing && (
                    <LegalAuditBanner
                      originalContent={sample.originalContent}
                      rewrittenContent={sample.rewrittenContent}
                    />
                  )}

                  {/* 4 · Nota completa redactada por la IA + etiquetas al final */}
                  {editing ? (
                    <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <span className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                        <Edit3 className="h-4 w-4 text-[#FF5500]" /> Editor rápido
                      </span>
                      <input
                        defaultValue={sample.rewrittenTitle}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-900 focus:border-[#FF5500] focus:outline-none"
                      />
                      <textarea
                        rows={10}
                        defaultValue={sample.rewrittenContent}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3.5 font-mono text-xs leading-relaxed text-slate-800 focus:border-[#FF5500] focus:outline-none"
                      />
                      <div className="flex justify-end">
                        <button className="flex items-center gap-2 rounded-xl bg-[#FF5500] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#E04B00]">
                          <Save className="h-4 w-4" /> Guardar cambios
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <span className="mb-3 flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
                        <BookOpen className="h-3.5 w-3.5 text-[#FF5500]" /> Nota completa (redacción IA)
                      </span>
                      <ArticleBody content={sample.rewrittenContent} />
                      <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-4">
                        <span className="mr-1 text-xs font-bold text-slate-500">Etiquetas:</span>
                        {sample.tags.map((t) => (
                          <span
                            key={t}
                            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-700"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {tab === 'cotejo' && (
                <div className="px-4 py-5 sm:px-6">
                  <ArticleComparison
                    key={`${sample.id}-${mode}`}
                    initialMode={mode}
                    sourceName={sample.sourceName}
                    originalTitle={sample.originalTitle}
                    originalContent={sample.originalContent}
                    rewrittenTitle={sample.rewrittenTitle}
                    rewrittenContent={sample.rewrittenContent}
                  />
                </div>
              )}
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
