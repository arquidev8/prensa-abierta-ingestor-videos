'use client';

import React, { useState, useEffect } from 'react';
import {
  Newspaper,
  Sparkles,
  Video,
  UploadCloud,
  CheckCircle2,
  Clock,
  ExternalLink,
  RefreshCw,
  Play,
  Layers,
  ChevronRight,
  ChevronLeft,
  Filter,
  Eye,
  AlertCircle,
  Edit3,
  BookOpen,
  Copy,
  Save,
  Check,
  Flame,
  Search,
  Calendar,
  Download
} from 'lucide-react';
import { RawNews, ProcessedNews } from '@/lib/types';
import VideoPlayerPreview from '@/components/VideoPlayerPreview';
import StructuredArticleReader from '@/components/StructuredArticleReader';
import { calculateViralTrendScore } from '@/lib/trends';

export default function FeedPage() {
  const [rawNews, setRawNews] = useState<RawNews[]>([]);
  const [processedNews, setProcessedNews] = useState<ProcessedNews[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<{ raw?: RawNews; processed?: ProcessedNews } | null>(null);
  const [autoPilot, setAutoPilot] = useState<boolean>(false);
  const [selectedModel, setSelectedModel] = useState<string>('glm-5.2');

  // Filters
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [filterTab, setFilterTab] = useState<'pending' | 'processed' | 'all'>('pending');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedDateRange, setSelectedDateRange] = useState<'all' | 'today' | '24h' | '3d'>('all');
  const [onlyTrending, setOnlyTrending] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 12;

  // Modal Article Reader / Editor State
  const [modalViewTab, setModalViewTab] = useState<'read' | 'edit'>('read');
  const [articleCompareTab, setArticleCompareTab] = useState<'ai' | 'original' | 'diff'>('ai');
  const [editedTitle, setEditedTitle] = useState<string>('');
  const [editedSubtitle, setEditedSubtitle] = useState<string>('');
  const [editedContent, setEditedContent] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationStep, setGenerationStep] = useState<string>('');
  const [isRenderingVideo, setIsRenderingVideo] = useState<boolean>(false);

  const handleDownloadRealVideo = async (
    title: string,
    category: string,
    imageUrl?: string,
    id?: string
  ) => {
    try {
      setIsRenderingVideo(true);
      const res = await fetch('/api/render-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newsId: id || `news_${Date.now()}`,
          headline: title,
          category: category || 'NOTICIAS',
          imageUrl: imageUrl,
          duration: 10,
        }),
      });
      const data = await res.json();
      if (data.success && data.videoUrl) {
        const link = document.createElement('a');
        link.href = data.videoUrl;
        link.download = `prensa-abierta-${title
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '-')
          .slice(0, 40)}.mp4`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        alert(data.error || 'Error al generar video');
      }
    } catch (e) {
      console.error('Error generando video para descarga:', e);
      alert('Hubo un error al procesar el video con FFmpeg');
    } finally {
      setIsRenderingVideo(false);
    }
  };

  const fetchNews = async () => {
    try {
      setLoading(true);
      const resRaw = await fetch('http://localhost:8085/api/news/raw', { cache: 'no-store' });
      if (resRaw.ok) {
        const data = await resRaw.json();
        setRawNews(data.items || []);
      }
      const resProc = await fetch('http://localhost:8085/api/news/processed', { cache: 'no-store' });
      if (resProc.ok) {
        const data = await resProc.json();
        setProcessedNews(data.items || []);
      }
    } catch (err) {
      console.error('Error cargando noticias:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews();
    const interval = setInterval(fetchNews, 20000);
    return () => clearInterval(interval);
  }, []);

  const handleManualPoll = async () => {
    try {
      await fetch('http://localhost:8085/api/news/poll', { method: 'POST' });
      setTimeout(fetchNews, 2000);
    } catch (e) {
      console.error(e);
    }
  };

  const openModal = (item: { raw?: RawNews; processed?: ProcessedNews }) => {
    setSelectedItem(item);
    setEditedTitle(item.processed?.title || item.raw?.title || '');
    setEditedSubtitle(item.processed?.subtitle || item.raw?.summary || '');
    setEditedContent(item.processed?.content_html || item.raw?.content || '');
    setModalViewTab('read');
    setArticleCompareTab('ai');
  };

  const handleRunPipeline = async (item: RawNews, autoPublishWP: boolean = false) => {
    try {
      setProcessingId(item.id);
      setIsGenerating(true);
      setGenerationStep(`Redactando con ${selectedModel.toUpperCase()} y preparando video...`);
      openModal({ raw: item });

      const res = await fetch('/api/process-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawNews: item,
          autoPublishWP: autoPublishWP || autoPilot,
          generateVideo: true,
          ollamaModel: selectedModel,
        }),
      });
      const data = await res.json();
      if (data.success && data.processed) {
        await fetchNews();
        openModal({ raw: item, processed: data.processed });
      } else {
        alert(data.error || 'No se pudo completar la redacción. Por favor intenta de nuevo.');
      }
    } catch (err) {
      console.error('Error ejecutando pipeline:', err);
      alert('Error de conexión al procesar con IA.');
    } finally {
      setIsGenerating(false);
      setProcessingId(null);
    }
  };

  // Filter Logic
  const filteredRawNews = rawNews.filter((item) => {
    // Source filter
    if (selectedSource !== 'all' && item.source_id !== selectedSource) return false;

    // Status filter
    if (filterTab === 'pending' && item.status === 'processed') return false;
    if (filterTab === 'processed' && item.status !== 'processed') return false;

    // Category filter
    if (selectedCategory !== 'all') {
      const cat = (item.category || '').toLowerCase();
      if (!cat.includes(selectedCategory.toLowerCase())) return false;
    }

    // Date filter
    if (selectedDateRange !== 'all' && item.published_at) {
      const pubDate = new Date(item.published_at).getTime();
      const now = Date.now();
      const hoursAgo = (now - pubDate) / (1000 * 60 * 60);

      if (selectedDateRange === 'today' && hoursAgo > 12) return false;
      if (selectedDateRange === '24h' && hoursAgo > 24) return false;
      if (selectedDateRange === '3d' && hoursAgo > 72) return false;
    }

    // Viral Trending Filter
    if (onlyTrending) {
      const trend = calculateViralTrendScore(item);
      if (!trend.isTrending) return false;
    }

    // Search query filter
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      const matchTitle = item.title?.toLowerCase().includes(q);
      const matchSummary = item.summary?.toLowerCase().includes(q);
      const matchContent = item.content?.toLowerCase().includes(q);
      if (!matchTitle && !matchSummary && !matchContent) return false;
    }

    return true;
  });

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredRawNews.length / itemsPerPage));
  const validCurrentPage = Math.min(currentPage, totalPages);
  const paginatedNews = filteredRawNews.slice(
    (validCurrentPage - 1) * itemsPerPage,
    validCurrentPage * itemsPerPage
  );

  // Reset to page 1 on filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedSource, filterTab, selectedCategory, selectedDateRange, onlyTrending, searchQuery]);

  const handleSaveChanges = async () => {
    if (!selectedItem?.processed) return;
    const updated: ProcessedNews = {
      ...selectedItem.processed,
      title: editedTitle,
      subtitle: editedSubtitle,
      content_html: editedContent,
    };
    try {
      await fetch('http://localhost:8085/api/news/processed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      setSelectedItem({ ...selectedItem, processed: updated });
      setModalViewTab('read');
      fetchNews();
    } catch (err) {
      console.error('Error guardando cambios:', err);
    }
  };

  const handleCopyContent = () => {
    const textToCopy = `${editedTitle}\n\n${editedSubtitle}\n\n${editedContent.replace(/<[^>]*>?/gm, '\n')}`;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Control Center (Designer Quality, Light & Brand Orange) */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 p-6 rounded-3xl bg-white border border-slate-200/90 shadow-sm relative overflow-hidden">
        {/* Subtle mesh & aura inside card */}
        <div className="absolute top-0 right-0 w-80 h-full bg-gradient-to-l from-orange-50/70 to-transparent pointer-events-none" />

        <div className="space-y-1 relative z-10">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full text-xs font-black bg-orange-100 text-[#FF5500] border border-orange-200 flex items-center gap-1.5 shadow-sm whitespace-nowrap w-fit">
              <Sparkles className="w-3.5 h-3.5 fill-[#FF5500]" />
              <span>SISTEMA EDITORIAL PUERTO RICO</span>
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
            Monitoreo, Redacción IA & Video Vertical
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 max-w-xl">
            Ingestión en tiempo real de <strong>El Nuevo Día, Primera Hora, El Vocero, NotiCel y Metro PR</strong> para producción autónoma.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 relative z-10">
          {/* Model Switcher */}
          <div className="flex items-center gap-2 bg-slate-50 px-3.5 py-2 rounded-2xl border border-slate-200 text-xs">
            <Sparkles className="w-4 h-4 text-[#FF5500]" />
            <span className="text-slate-600 font-bold">Modelo:</span>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-transparent text-slate-900 font-black focus:outline-none cursor-pointer"
            >
              <option value="glm-5.2">GLM 5.2 / GLM-4</option>
              <option value="minimax-m3">MiniMax M3</option>
              <option value="qwen2.5:72b">Qwen 2.5 72B</option>
            </select>
          </div>

          {/* Auto-Pilot Toggle */}
          <button
            onClick={() => setAutoPilot(!autoPilot)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-black border transition ${
              autoPilot
                ? 'bg-emerald-50 border-emerald-300 text-emerald-700 shadow-sm shadow-emerald-500/10'
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                autoPilot ? 'bg-emerald-500 animate-ping' : 'bg-slate-400'
              }`}
            />
            {autoPilot ? '100% AUTÓNOMO ACTIVO' : 'SUPERVISIÓN MANUAL'}
          </button>

          {/* Trigger Poll Button */}
          <button
            onClick={handleManualPoll}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-[#FF5500] to-[#FF7700] hover:from-[#E04B00] hover:to-[#FF6600] text-white text-xs font-bold shadow-md shadow-orange-500/20 transition active:scale-95"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Sondear Diarios</span>
          </button>
        </div>
      </div>

      {/* Advanced Filter Suite (Clean Light Mesh Aesthetics) */}
      <div className="p-5 rounded-3xl bg-white border border-slate-200/90 space-y-4 shadow-sm">
        {/* Row 1: Search + Viral Trending Toggle + Date Selector */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Real-Time Keyword Search Bar */}
          <div className="relative flex-1 min-w-[260px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar por titular, personaje, lugar (e.g. Bad Bunny, LUMA, Tribunal)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-10 pr-4 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#FF5500] focus:ring-2 focus:ring-orange-500/10 transition"
            />
          </div>

          {/* Trending PR Filter Toggle */}
          <button
            onClick={() => setOnlyTrending(!onlyTrending)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-black transition shadow-sm ${
              onlyTrending
                ? 'bg-gradient-to-r from-[#FF5500] to-amber-500 text-white shadow-orange-500/20'
                : 'bg-slate-50 border border-slate-200 text-slate-600 hover:text-[#FF5500] hover:border-orange-300'
            }`}
          >
            <Flame className="w-4 h-4 fill-current text-amber-300" />
            <span>🔥 Solo Tendencias / Lo Más Caliente</span>
          </button>

          {/* Date Filter */}
          <div className="flex items-center gap-1 bg-slate-50 p-1.5 rounded-2xl border border-slate-200 text-xs">
            <span className="text-slate-500 px-2 flex items-center gap-1 font-bold text-[11px]">
              <Calendar className="w-3.5 h-3.5 text-slate-400" /> Fecha:
            </span>
            {[
              { id: 'all', label: 'Todas' },
              { id: 'today', label: 'Hoy' },
              { id: '24h', label: '24h' },
              { id: '3d', label: '3 Días' },
            ].map((d) => (
              <button
                key={d.id}
                onClick={() => setSelectedDateRange(d.id as any)}
                className={`px-3 py-1 rounded-xl font-bold transition ${
                  selectedDateRange === d.id
                    ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Newspaper Source Filter + Status Tab */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
          {/* Source Filter */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <span className="text-xs font-bold text-slate-500 flex items-center gap-1.5 mr-1">
              <Filter className="w-3.5 h-3.5" /> Fuente:
            </span>
            {[
              { id: 'all', label: 'Todos los Diarios' },
              { id: 'el-nuevo-dia', label: 'El Nuevo Día' },
              { id: 'primera-hora', label: 'Primera Hora' },
              { id: 'el-vocero', label: 'El Vocero' },
              { id: 'noticel', label: 'NotiCel' },
              { id: 'metro-pr', label: 'Metro PR' },
            ].map((src) => (
              <button
                key={src.id}
                onClick={() => setSelectedSource(src.id)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                  selectedSource === src.id
                    ? 'bg-[#FF5500] text-white shadow-sm shadow-orange-500/20'
                    : 'bg-slate-50 text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200/80'
                }`}
              >
                {src.label}
              </button>
            ))}
          </div>

          {/* Pending vs Processed Filter */}
          <div className="flex items-center gap-1 bg-slate-50 p-1.5 rounded-2xl border border-slate-200 text-xs">
            <button
              onClick={() => setFilterTab('pending')}
              className={`px-3.5 py-1 rounded-xl font-bold transition ${
                filterTab === 'pending' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Pendientes ({rawNews.filter((n) => n.status !== 'processed').length})
            </button>
            <button
              onClick={() => setFilterTab('processed')}
              className={`px-3.5 py-1 rounded-xl font-bold transition ${
                filterTab === 'processed' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Procesadas ({processedNews.length})
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid: Feed Cards (Clean White Cards with Soft Elevation) */}
      {loading && rawNews.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-3">
          <RefreshCw className="w-8 h-8 animate-spin text-[#FF5500]" />
          <p className="text-sm font-medium">Sondeando medios de Puerto Rico...</p>
        </div>
      ) : paginatedNews.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-3xl border border-slate-200 space-y-3 shadow-sm">
          <Newspaper className="w-12 h-12 text-slate-300 mx-auto" />
          <p className="text-base font-bold text-slate-800">No hay noticias que coincidan con estos filtros</p>
          <p className="text-xs text-slate-500">Prueba cambiando la fuente o limpiando el término de búsqueda.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {paginatedNews.map((item) => {
            const isProcessing = processingId === item.id;
            const proc = processedNews.find((p) => p.raw_news_id === item.id);
            const trend = calculateViralTrendScore(item);

            return (
              <div
                key={item.id}
                className="group flex flex-col justify-between rounded-3xl bg-white border border-slate-200/90 hover:border-orange-300 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-xl transition-all duration-300 overflow-hidden"
              >
                <div>
                  {/* Card Header & Image */}
                  <div className="relative h-48 w-full bg-slate-100 overflow-hidden">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400">
                        <Newspaper className="w-12 h-12 stroke-[1.2]" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30 pointer-events-none" />

                    {/* Source Badge & Trending Pill */}
                    <div className="absolute top-3 left-3 flex flex-col gap-1.5">
                      <span className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-white/90 backdrop-blur text-slate-900 border border-white/40 shadow-sm w-fit">
                        {item.source_name}
                      </span>
                      {trend.isTrending && (
                        <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10.5px] font-black bg-gradient-to-r from-[#FF5500] to-amber-500 text-white shadow-md w-fit animate-pulse">
                          <Flame className="w-3.5 h-3.5 fill-yellow-300 text-yellow-300" />
                          <span>TENDENCIA ({trend.score}%)</span>
                        </span>
                      )}
                    </div>

                    {/* Status Pill */}
                    <div className="absolute top-3 right-3">
                      {proc ? (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-500 text-white shadow-md">
                          <CheckCircle2 className="w-3 h-3" /> Procesada
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-black/60 backdrop-blur text-amber-300 border border-amber-300/30">
                          <Clock className="w-3 h-3" /> Pendiente
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Card Content */}
                  <div className="p-5 space-y-2.5">
                    <h3 className="font-black text-base text-slate-900 line-clamp-2 leading-snug group-hover:text-[#FF5500] transition">
                      {item.title}
                    </h3>
                    <p className="text-xs text-slate-600 line-clamp-3 leading-relaxed">
                      {item.summary || item.content}
                    </p>
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="p-5 pt-0 border-t border-slate-100 mt-2 flex items-center justify-between gap-2">
                  <a
                    href={item.original_url}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2 rounded-xl text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition"
                    title="Ver en diario original"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>

                  <div className="flex items-center gap-2">
                    {proc ? (
                      <button
                        onClick={() => openModal({ raw: item, processed: proc })}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition"
                      >
                        <Eye className="w-3.5 h-3.5 text-blue-600" />
                        <span>Ver Pieza</span>
                      </button>
                    ) : (
                      <button
                        disabled={isProcessing}
                        onClick={() => handleRunPipeline(item)}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition shadow-md ${
                          isProcessing
                            ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                            : 'bg-gradient-to-r from-[#FF5500] to-[#FF7700] hover:from-[#E04B00] hover:to-[#FF6600] text-white shadow-orange-500/20 active:scale-95'
                        }`}
                      >
                        {isProcessing ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Procesando...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>Redactar & Video</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-3xl bg-white border border-slate-200 text-xs shadow-sm">
          <span className="text-slate-600 font-medium">
            Mostrando página <strong className="text-slate-900">{validCurrentPage}</strong> de{' '}
            <strong className="text-slate-900">{totalPages}</strong> ({filteredRawNews.length} noticias totales)
          </span>

          <div className="flex items-center gap-1.5">
            <button
              disabled={validCurrentPage === 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className={`flex items-center gap-1 px-3.5 py-1.5 rounded-xl font-bold transition ${
                validCurrentPage === 1
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
              }`}
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Anterior
            </button>

            {/* Page number buttons */}
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum = i + 1;
              if (totalPages > 5 && validCurrentPage > 3) {
                pageNum = validCurrentPage - 3 + i + 1;
                if (pageNum > totalPages) pageNum = totalPages - 4 + i;
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  className={`w-8 h-8 rounded-xl font-bold transition text-xs ${
                    validCurrentPage === pageNum
                      ? 'bg-[#FF5500] text-white shadow-md shadow-orange-500/30'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}

            <button
              disabled={validCurrentPage === totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className={`flex items-center gap-1 px-3.5 py-1.5 rounded-xl font-bold transition ${
                validCurrentPage === totalPages
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
              }`}
            >
              Siguiente <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Enhanced Proportional Modal (Clean Magazine Light Theme) */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 animate-fadeIn">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-6xl w-full h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            {/* Modal Top Bar */}
            <div className="px-6 py-3.5 border-b border-slate-200 flex items-center justify-between bg-white shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1 rounded-xl bg-orange-50 border border-orange-200 text-[#FF5500] text-xs font-black tracking-wider uppercase shadow-sm">
                  <img src="/logo.png" alt="Logo" className="w-4 h-4 rounded object-cover" />
                  <span>PRENSA ABIERTA</span>
                </div>
                <span className="text-xs text-slate-300 hidden sm:inline">•</span>
                <span className="text-xs font-bold text-slate-600 hidden sm:inline">
                  Centro de Redacción & Video 9:16
                </span>
              </div>

              <div className="flex items-center gap-2">
                {/* View Tabs */}
                <div className="flex items-center bg-slate-100 p-1 rounded-2xl border border-slate-200 text-xs">
                  <button
                    onClick={() => setModalViewTab('read')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition ${
                      modalViewTab === 'read'
                        ? 'bg-[#FF5500] text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Lectura</span>
                  </button>
                  <button
                    onClick={() => setModalViewTab('edit')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition ${
                      modalViewTab === 'edit'
                        ? 'bg-[#FF5500] text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Editar</span>
                  </button>
                </div>

                <button
                  onClick={() => setSelectedItem(null)}
                  className="p-2 text-slate-400 hover:text-slate-900 rounded-xl hover:bg-slate-100 transition font-bold text-xs ml-1"
                >
                  ✕ Cerrar
                </button>
              </div>
            </div>

            {/* Modal Body (2 Columns) */}
            <div className="p-6 overflow-hidden flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0 relative bg-slate-50/50">
              {/* Live AI Processing Overlay if Generating */}
              {isGenerating && (
                <div className="absolute inset-0 z-30 bg-white/95 backdrop-blur-md flex flex-col items-center justify-center p-6 space-y-4 text-center animate-fadeIn">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-[#FF5500] to-amber-400 flex items-center justify-center shadow-xl shadow-orange-500/30 animate-pulse">
                      <Sparkles className="w-8 h-8 text-white animate-spin" />
                    </div>
                  </div>
                  <div className="space-y-1 max-w-sm">
                    <h3 className="text-lg font-black text-slate-900">
                      Redactando Noticia & Generando Video
                    </h3>
                    <p className="text-xs text-slate-600 font-medium">
                      {generationStep || `El modelo de IA (${selectedModel}) está redactando el artículo para WordPress y preparando el Reel 9:16...`}
                    </p>
                  </div>
                  <div className="w-48 h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#FF5500] to-amber-400 w-full animate-pulse" />
                  </div>
                </div>
              )}

              {/* Left Column: Article Reader / Editor (Smooth Independent Scroll) */}
              <div className="lg:col-span-7 overflow-y-auto h-full pr-3 space-y-5">
                {modalViewTab === 'read' ? (
                  /* --- Magazine Reading Mode --- */
                  <div className="space-y-4">
                    {/* Header & Meta */}
                    <div className="space-y-2 bg-white p-5 rounded-3xl border border-slate-200/90 shadow-sm">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-orange-100 text-[#FF5500] border border-orange-200 uppercase tracking-wide">
                          {selectedItem.processed?.category || selectedItem.raw?.category || 'Noticias'}
                        </span>
                        <span className="text-xs text-slate-300">•</span>
                        <span className="text-xs text-slate-500 font-semibold">
                          Fuente: {selectedItem.raw?.source_name}
                        </span>
                      </div>

                      <h1 className="text-xl sm:text-2xl font-black text-slate-900 leading-tight tracking-tight">
                        {editedTitle || selectedItem.processed?.title || selectedItem.raw?.title}
                      </h1>

                      {(editedSubtitle || selectedItem.processed?.subtitle) && (
                        <div className="border-l-3 border-[#FF5500] pl-3.5 py-1 bg-orange-50/50 rounded-r-xl">
                          <p className="text-xs sm:text-sm font-semibold text-slate-700 leading-relaxed italic">
                            {editedSubtitle || selectedItem.processed?.subtitle}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Subtabs Selector: AI vs Original vs Comparativa */}
                    <div className="flex items-center gap-1.5 p-1.5 bg-white rounded-2xl border border-slate-200 text-xs w-fit shadow-sm">
                      <button
                        onClick={() => setArticleCompareTab('ai')}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-bold transition ${
                          articleCompareTab === 'ai'
                            ? 'bg-[#FF5500] text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>✨ Prensa Abierta (IA)</span>
                      </button>
                      <button
                        onClick={() => setArticleCompareTab('original')}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-bold transition ${
                          articleCompareTab === 'original'
                            ? 'bg-slate-800 text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <Newspaper className="w-3.5 h-3.5" />
                        <span>📰 Diario Original ({selectedItem.raw?.source_name || 'Fuente'})</span>
                      </button>
                      <button
                        onClick={() => setArticleCompareTab('diff')}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-bold transition ${
                          articleCompareTab === 'diff'
                            ? 'bg-amber-600 text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <Layers className="w-3.5 h-3.5" />
                        <span>⚖️ Comparativa & Diferencias</span>
                      </button>
                    </div>

                    {/* View 1: Redacción Prensa Abierta (IA) */}
                    {articleCompareTab === 'ai' && (
                      <div className="p-5 rounded-3xl bg-white border border-slate-200 space-y-4 shadow-sm">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                              <BookOpen className="w-4 h-4 text-[#FF5500]" />
                              {selectedItem.processed
                                ? 'Redacción Prensa Abierta (Lista para WordPress)'
                                : 'Texto Crudo (Pendiente de Procesar con IA)'}
                            </span>
                            {selectedItem.processed ? (
                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200">
                                ✓ 100% Original IA
                              </span>
                            ) : (
                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-200">
                                ⚠️ Pulsa Redactar con IA
                              </span>
                            )}
                          </div>

                          <button
                            onClick={handleCopyContent}
                            className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 transition px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200"
                          >
                            {copied ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                                <span className="text-emerald-700">Copiado</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copiar Texto</span>
                              </>
                            )}
                          </button>
                        </div>

                        {/* Formatted Article Body */}
                        <StructuredArticleReader
                          content={
                            editedContent ||
                            selectedItem.processed?.content_html ||
                            selectedItem.raw?.content ||
                            ''
                          }
                          isAIRewritten={Boolean(selectedItem.processed)}
                        />

                        {/* AI Trigger Button */}
                        {selectedItem.raw && (
                          <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                            <span className="text-xs text-slate-500">
                              {selectedItem.processed
                                ? '¿Quieres reescribir con otro enfoque editorial?'
                                : 'Genera la versión periodística propia para WordPress.'}
                            </span>
                            <button
                              disabled={processingId === selectedItem.raw.id}
                              onClick={async () => {
                                if (selectedItem.raw) {
                                  await handleRunPipeline(selectedItem.raw, false);
                                }
                              }}
                              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-[#FF5500] to-[#FF7700] hover:from-[#E04B00] hover:to-[#FF6600] text-white text-xs font-bold shadow-md shadow-orange-500/20 transition shrink-0 active:scale-95"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>
                                {processingId === selectedItem.raw.id
                                  ? 'Redactando con IA...'
                                  : 'Redactar Noticia Completa (Web)'}
                              </span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* View 2: Noticia Original del Diario */}
                    {articleCompareTab === 'original' && (
                      <div className="p-5 rounded-3xl bg-white border border-slate-200 space-y-4 shadow-sm">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                          <span className="text-xs font-black text-amber-700 uppercase tracking-wider flex items-center gap-1.5">
                            <Newspaper className="w-4 h-4 text-amber-600" />
                            Materia Prima Original: {selectedItem.raw?.source_name}
                          </span>
                          <a
                            href={selectedItem.raw?.original_url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 transition px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Ver en {selectedItem.raw?.source_name}</span>
                          </a>
                        </div>

                        <div className="space-y-1 pb-2 border-b border-slate-100">
                          <span className="text-[10px] text-slate-400 font-bold uppercase">Titular Original:</span>
                          <h3 className="text-sm font-bold text-slate-800">{selectedItem.raw?.title}</h3>
                        </div>

                        <StructuredArticleReader
                          content={selectedItem.raw?.content || selectedItem.raw?.summary || ''}
                          isAIRewritten={false}
                        />
                      </div>
                    )}

                    {/* View 3: Comparativa & Diferencias */}
                    {articleCompareTab === 'diff' && (
                      <div className="space-y-4">
                        {/* Legal & Editorial Audit Banner */}
                        <div className="p-5 rounded-3xl bg-gradient-to-r from-emerald-50 via-teal-50 to-white border border-emerald-200 space-y-3 shadow-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-black uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Auditoría Legal Anti-Plagio
                            </span>
                            <span className="px-3 py-1 rounded-full text-[10.5px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
                              ✓ 100% Reescritura Libre de Derechos
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-2.5 text-center pt-1 text-xs">
                            <div className="p-2.5 rounded-2xl bg-white border border-slate-200 shadow-sm">
                              <span className="text-slate-400 text-[10px] block font-semibold">Voz Editorial</span>
                              <strong className="text-slate-900 font-bold">Prensa Abierta</strong>
                            </div>
                            <div className="p-2.5 rounded-2xl bg-white border border-slate-200 shadow-sm">
                              <span className="text-slate-400 text-[10px] block font-semibold">Menciones Externas</span>
                              <strong className="text-emerald-700 font-bold">0 (Eliminadas)</strong>
                            </div>
                            <div className="p-2.5 rounded-2xl bg-white border border-slate-200 shadow-sm">
                              <span className="text-slate-400 text-[10px] block font-semibold">Hechos</span>
                              <strong className="text-orange-600 font-bold">Sintetizados</strong>
                            </div>
                          </div>
                        </div>

                        {/* Side-by-Side Columns */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Original Column */}
                          <div className="p-4 rounded-3xl bg-white border border-amber-200 space-y-3 shadow-sm flex flex-col justify-between">
                            <span className="text-xs font-bold text-amber-800 border-b border-slate-100 pb-2 flex items-center justify-between">
                              <span>📰 Materia Prima: {selectedItem.raw?.source_name}</span>
                              <span className="text-[10px] text-slate-400 font-mono">Texto Original</span>
                            </span>
                            <div className="max-h-96 overflow-y-auto pr-1 space-y-2 custom-scrollbar">
                              <h4 className="text-xs font-bold text-slate-800 pb-1 border-b border-slate-100">
                                {selectedItem.raw?.title}
                              </h4>
                              <StructuredArticleReader
                                content={selectedItem.raw?.content || selectedItem.raw?.summary || ''}
                                isAIRewritten={false}
                              />
                            </div>
                          </div>

                          {/* Prensa Abierta IA Column */}
                          <div className="p-4 rounded-3xl bg-white border border-orange-200 space-y-3 shadow-sm flex flex-col justify-between">
                            <span className="text-xs font-bold text-[#FF5500] border-b border-slate-100 pb-2 flex items-center justify-between">
                              <span>✨ Redacción Propia: Prensa Abierta</span>
                              <span className="text-[10px] text-emerald-700 font-mono font-bold">✓ 100% Reescrita</span>
                            </span>
                            <div className="max-h-96 overflow-y-auto pr-1 space-y-2 custom-scrollbar">
                              <h4 className="text-xs font-bold text-slate-900 pb-1 border-b border-slate-100">
                                {selectedItem.processed?.title || editedTitle || selectedItem.raw?.title}
                              </h4>
                              <StructuredArticleReader
                                content={
                                  editedContent ||
                                  selectedItem.processed?.content_html ||
                                  ''
                                }
                                isAIRewritten={true}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Tags */}
                    {selectedItem.processed?.tags && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-xs text-slate-500 font-bold mr-1">Etiquetas:</span>
                        {selectedItem.processed.tags.map((t, idx) => (
                          <span
                            key={idx}
                            className="px-3 py-1 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 shadow-sm"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  /* --- Fast Inline Editor Mode --- */
                  <div className="space-y-4 p-5 rounded-3xl bg-white border border-slate-200 shadow-sm">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <span className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                        <Edit3 className="w-4 h-4 text-[#FF5500]" /> Editor Rápido de Noticia
                      </span>
                      <span className="text-xs text-slate-500">Modifica el texto antes de inyectar en WordPress</span>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700">Titular de Prensa Abierta</label>
                      <input
                        type="text"
                        value={editedTitle}
                        onChange={(e) => setEditedTitle(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 font-bold focus:outline-none focus:border-[#FF5500]"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700">Bajada / Subtítulo</label>
                      <input
                        type="text"
                        value={editedSubtitle}
                        onChange={(e) => setEditedSubtitle(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs text-slate-800 focus:outline-none focus:border-[#FF5500]"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700">Cuerpo del Artículo (Párrafos)</label>
                      <textarea
                        rows={8}
                        value={editedContent}
                        onChange={(e) => setEditedContent(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs text-slate-800 font-mono leading-relaxed focus:outline-none focus:border-[#FF5500]"
                      />
                    </div>

                    <div className="flex justify-end pt-2">
                      <button
                        onClick={handleSaveChanges}
                        className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#FF5500] hover:bg-[#E04B00] text-white text-xs font-bold shadow-md shadow-orange-500/20 transition active:scale-95"
                      >
                        <Save className="w-4 h-4" />
                        <span>Guardar Cambios</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: 9:16 Vertical Video Preview (Clean White Container) */}
              <div className="lg:col-span-5 flex flex-col items-center justify-between p-5 rounded-3xl bg-white border border-slate-200 h-full overflow-hidden shadow-sm">
                <div className="w-full text-center shrink-0">
                  <span className="text-xs font-bold text-slate-800 flex items-center justify-center gap-1.5">
                    <Video className="w-4 h-4 text-[#FF5500]" /> Pieza de Video Vertical 9:16 (10-15s)
                  </span>
                </div>

                {/* Interactive 9:16 Video Player */}
                <div className="my-auto py-1 flex items-center justify-center">
                  <VideoPlayerPreview
                    title={editedTitle || selectedItem.processed?.title || selectedItem.raw?.title || 'Última Hora Puerto Rico'}
                    category={selectedItem.processed?.category || selectedItem.raw?.category || 'Noticias'}
                    imageFallback={selectedItem.processed?.featured_image_url || selectedItem.raw?.image_url}
                    duration={12}
                  />
                </div>

                <div className="w-full shrink-0 space-y-2 pt-2">
                  <button
                    disabled={isRenderingVideo}
                    onClick={() => {
                      const title = editedTitle || selectedItem.processed?.title || selectedItem.raw?.title || 'Noticia Puerto Rico';
                      const category = selectedItem.processed?.category || selectedItem.raw?.category || 'NOTICIAS';
                      const image = selectedItem.processed?.featured_image_url || selectedItem.raw?.image_url;
                      const id = selectedItem.processed?.id || selectedItem.raw?.id;
                      handleDownloadRealVideo(title, category, image, id);
                    }}
                    className={`w-full py-2.5 rounded-2xl text-white text-xs font-black shadow-md transition flex items-center justify-center gap-2 active:scale-95 ${
                      isRenderingVideo
                        ? 'bg-slate-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-[#FF5500] to-[#FF7700] hover:from-[#E04B00] hover:to-[#FF6600] shadow-orange-500/20'
                    }`}
                  >
                    {isRenderingVideo ? (
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

                  <button
                    onClick={() => {
                      if (selectedItem.raw) handleRunPipeline(selectedItem.raw, true);
                    }}
                    className="w-full py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black shadow-md shadow-emerald-600/20 transition flex items-center justify-center gap-2 active:scale-95"
                  >
                    <UploadCloud className="w-4 h-4" />
                    <span>Aprobar & Inyectar en WordPress</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
