'use client';

import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Video,
  Download,
  UploadCloud,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  Flame,
  Filter,
  BookOpen,
  Calendar,
  Layers,
  Copy,
  Check
} from 'lucide-react';
import { ProcessedNews } from '@/lib/types';
import VideoPlayerPreview from '@/components/VideoPlayerPreview';
import StructuredArticleReader from '@/components/StructuredArticleReader';
import EngineOfflineBanner from '@/components/EngineOfflineBanner';
import { fetchFromEngine } from '@/lib/engineClient';
import { inferNewsCategory } from '@/lib/newsCategorizer';

// Categoría para el pipeline de video: se infiere del título/cuerpo (igual que en
// el Feed) en vez de usar `item.category` tal cual, para que el b-roll matchee el
// tema real de la noticia — ver el ruteo categoría→carpeta en lib/contentLibrary.ts.
function videoCategoryFor(item: ProcessedNews): string {
  return inferNewsCategory(
    item.title,
    item.subtitle || (item.content_html || '').replace(/<[^>]+>/g, ' '),
    item.category
  );
}

export default function AutopilotHubPage() {
  const [processedList, setProcessedList] = useState<ProcessedNews[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchProcessedNews = async () => {
    setLoading(true);

    const result = await fetchFromEngine<{ items: ProcessedNews[] }>('/api/news/processed');
    if (result.ok) {
      setProcessedList(Array.isArray(result.data.items) ? result.data.items : []);
      setEngineError(null);
    } else {
      setProcessedList([]);
      // Solo marcamos el banner cuando el Engine es inalcanzable, no ante un
      // simple error HTTP puntual (esos ya quedan logueados en consola).
      setEngineError(result.offline ? result.error : null);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchProcessedNews();
  }, []);

  // Filter list
  const filteredList = processedList.filter((item) => {
    if (selectedCategory !== 'all' && item.category?.toLowerCase() !== selectedCategory.toLowerCase()) {
      return false;
    }
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      const matchTitle = item.title?.toLowerCase().includes(q);
      const matchContent = item.content_html?.toLowerCase().includes(q);
      if (!matchTitle && !matchContent) return false;
    }
    return true;
  });

  const handleCopyText = (item: ProcessedNews) => {
    const text = `${item.title}\n\n${item.subtitle || ''}\n\n${(item.content_html || '').replace(/<[^>]*>?/gm, '\n')}`;
    navigator.clipboard.writeText(text);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const [renderingId, setRenderingId] = useState<string | null>(null);

  const handleDownloadRealVideo = async (item: ProcessedNews) => {
    try {
      setRenderingId(item.id);
      // Timeout defensivo del lado del cliente: el servidor ya acota su propia espera
      // (~120s) al pollear el job del Go Engine, pero este límite adicional garantiza
      // que el botón nunca quede "generando" para siempre ante un fallo de red, un
      // proxy colgado, etc. — antes no existía ningún timeout en esta llamada.
      const res = await fetch('/api/render-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newsId: item.id || `news_${Date.now()}`,
          headline: item.title,
          category: videoCategoryFor(item),
          imageUrl: item.featured_image_url,
          duration: 10,
        }),
        signal: AbortSignal.timeout(130_000),
      });
      const data = await res.json();
      if (data.success && data.videoUrl) {
        const link = document.createElement('a');
        link.href = data.videoUrl;
        link.download = `prensa-abierta-${item.title
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '-')
          .slice(0, 40)}.mp4`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        alert(data.error || 'Error al generar video');
      }
    } catch (e: any) {
      console.error('Error generando video para descarga:', e);
      const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      alert(
        timedOut
          ? 'El render tardó demasiado y se canceló. Intenta de nuevo en unos segundos.'
          : 'Hubo un error al procesar el video.'
      );
    } finally {
      setRenderingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner (Clean Light with Brand Orange Accents) */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 p-6 rounded-3xl bg-white border border-slate-200 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-full bg-gradient-to-l from-orange-50 to-transparent pointer-events-none" />

        <div className="space-y-1 relative z-10">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-orange-100 text-[#FF5500] font-black text-xs tracking-wider uppercase flex items-center gap-1.5 shadow-sm border border-orange-200">
              <Flame className="w-3.5 h-3.5 fill-[#FF5500] text-[#FF5500]" />
              <span>HUB AUTÓNOMO • PIEZAS LISTAS</span>
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            Contenido Generado para Web y Redes Sociales
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 max-w-xl">
            Repositorio central donde se reúnen los artículos web completos y los videos verticales 9:16 listos para publicar y descargar.
          </p>
        </div>

        {/* Quick Stats */}
        <div className="flex items-center gap-3 relative z-10">
          <div className="px-5 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-center">
            <span className="text-2xl font-black text-[#FF5500] block">{processedList.length}</span>
            <span className="text-[10px] text-slate-500 uppercase font-bold">Piezas Listas</span>
          </div>

          <button
            onClick={fetchProcessedNews}
            className="p-3.5 rounded-2xl bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 transition border border-slate-200 shadow-sm"
            title="Actualizar lista"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Estado explícito cuando el Go Engine no responde (evita confundirlo con "sin piezas") */}
      {engineError && (
        <EngineOfflineBanner message={engineError} onRetry={fetchProcessedNews} retrying={loading} />
      )}

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-3xl border border-slate-200 shadow-sm">
        {/* Search */}
        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
          <input
            type="text"
            placeholder="Buscar por titular, personaje o tema..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#FF5500]"
          />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <span className="text-xs font-bold text-slate-500 flex items-center gap-1 mr-1">
            <Filter className="w-3.5 h-3.5" /> Categoría:
          </span>
          {['all', 'Noticias', 'Política', 'Tribunales', 'Deportes', 'El Tiempo', 'Farándula'].map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                selectedCategory === cat
                  ? 'bg-[#FF5500] text-white shadow-sm shadow-orange-500/20'
                  : 'bg-slate-50 text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              {cat === 'all' ? 'Todas' : cat}
            </button>
          ))}
        </div>
      </div>

      {/* Content Grid: Side-by-Side Article + Video */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-3">
          <RefreshCw className="w-8 h-8 animate-spin text-[#FF5500]" />
          <p className="text-sm font-medium">Cargando piezas listas para publicación...</p>
        </div>
      ) : filteredList.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-3xl border border-slate-200 space-y-3 shadow-sm">
          <Flame className="w-12 h-12 text-slate-300 mx-auto" />
          <p className="text-lg font-bold text-slate-800">No hay piezas procesadas en este filtro</p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Ve al Feed PR y pulsa "Redactar & Video" en cualquier noticia para generar el artículo web y el Reel 9:16.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {filteredList.map((item) => (
            <div
              key={item.id}
              className="p-6 rounded-3xl bg-white border border-slate-200 hover:border-orange-300 shadow-sm hover:shadow-xl transition duration-300 grid grid-cols-1 lg:grid-cols-12 gap-8"
            >
              {/* Left Column: Full Web Article for WordPress */}
              <div className="lg:col-span-8 flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  {/* Category & Origin */}
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-0.5 rounded-full text-[11px] font-black bg-orange-100 text-[#FF5500] border border-orange-200 uppercase tracking-wide">
                      {item.category || 'Noticias'}
                    </span>
                    <span className="text-xs text-slate-300">•</span>
                    <span className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Redactado por IA (Prensa Abierta)
                    </span>
                  </div>

                  {/* Headline */}
                  <h2 className="text-xl sm:text-2xl font-black text-slate-900 leading-tight tracking-tight">
                    {item.title}
                  </h2>

                  {/* Subtitle / Bajada */}
                  {item.subtitle && (
                    <div className="border-l-3 border-[#FF5500] pl-3.5 py-1 bg-orange-50/50 rounded-r-xl">
                      <p className="text-xs sm:text-sm font-semibold text-slate-700 italic">
                        {item.subtitle}
                      </p>
                    </div>
                  )}

                  {/* Formatted Article Body */}
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 max-h-64 overflow-y-auto space-y-3 text-xs sm:text-sm text-slate-800 leading-relaxed custom-scrollbar">
                    <StructuredArticleReader
                      content={item.content_html || ''}
                      isAIRewritten={true}
                    />
                  </div>

                  {/* Tags */}
                  {item.tags && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-xs text-slate-500 font-bold mr-1">Etiquetas WP:</span>
                      {item.tags.map((t, idx) => (
                        <span
                          key={idx}
                          className="px-2.5 py-0.5 rounded-lg bg-slate-100 border border-slate-200 text-xs font-medium text-slate-700"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Web Article Actions */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-100">
                  <button
                    onClick={() => handleCopyText(item)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-xs font-bold text-slate-800 transition"
                  >
                    {copiedId === item.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-700">¡Texto Copiado!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copiar Artículo Web</span>
                      </>
                    )}
                  </button>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200 font-bold">
                      ✓ WP Sandbox Listo
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Column: 9:16 Video Player & Social Media Download */}
              <div className="lg:col-span-4 flex flex-col items-center justify-between p-5 rounded-3xl bg-slate-50 border border-slate-200 space-y-4">
                <div className="w-full text-center">
                  <span className="text-xs font-bold text-slate-800 flex items-center justify-center gap-1.5">
                    <Video className="w-4 h-4 text-[#FF5500]" /> Video Reel 9:16 (Redes Sociales)
                  </span>
                </div>

                {/* 9:16 Video Player */}
                <VideoPlayerPreview
                  title={item.title}
                  category={videoCategoryFor(item)}
                  imageFallback={item.featured_image_url}
                  duration={12}
                  newsId={item.id}
                />

                {/* Video Actions */}
                <div className="w-full space-y-2">
                  <button
                    disabled={renderingId === item.id}
                    onClick={() => handleDownloadRealVideo(item)}
                    className={`w-full py-3 rounded-2xl text-white text-xs font-black shadow-md transition flex items-center justify-center gap-2 active:scale-95 ${
                      renderingId === item.id
                        ? 'bg-slate-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-[#FF5500] to-[#FF7700] hover:from-[#E04B00] hover:to-[#FF6600] shadow-orange-500/20'
                    }`}
                  >
                    {renderingId === item.id ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Generando Video 9:16 con FFmpeg...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        <span>Descargar Video (.mp4)</span>
                      </>
                    )}
                  </button>

                  <p className="text-[10px] text-center text-slate-400">
                    Listo para Instagram Reels, TikTok y YouTube Shorts
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
