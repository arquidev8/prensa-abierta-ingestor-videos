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
  Filter,
  Eye,
  AlertCircle,
  Edit3,
  BookOpen,
  Copy,
  Save,
  Check
} from 'lucide-react';
import { RawNews, ProcessedNews } from '@/lib/types';
import VideoPlayerPreview from '@/components/VideoPlayerPreview';

export default function FeedPage() {
  const [rawNews, setRawNews] = useState<RawNews[]>([]);
  const [processedNews, setProcessedNews] = useState<ProcessedNews[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<{ raw?: RawNews; processed?: ProcessedNews } | null>(null);
  const [autoPilot, setAutoPilot] = useState<boolean>(false);
  const [filterTab, setFilterTab] = useState<'pending' | 'processed' | 'all'>('pending');
  const [selectedModel, setSelectedModel] = useState<string>('glm-5.2');

  // Modal Article Reader / Editor State
  const [modalViewTab, setModalViewTab] = useState<'read' | 'edit'>('read');
  const [editedTitle, setEditedTitle] = useState<string>('');
  const [editedSubtitle, setEditedSubtitle] = useState<string>('');
  const [editedContent, setEditedContent] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

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
    const interval = setInterval(fetchNews, 15000); // Polling every 15s
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

  const handleRunPipeline = async (item: RawNews, autoPublishWP: boolean = false) => {
    try {
      setProcessingId(item.id);
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
      if (data.success) {
        await fetchNews();
        setSelectedItem({ raw: item, processed: data.processed });
      }
    } catch (err) {
      console.error('Error ejecutando pipeline:', err);
    } finally {
      setProcessingId(null);
    }
  };

  const filteredRawNews = rawNews.filter((item) => {
    if (selectedSource !== 'all' && item.source_id !== selectedSource) return false;
    if (filterTab === 'pending' && item.status === 'processed') return false;
    if (filterTab === 'processed' && item.status !== 'processed') return false;
    return true;
  });

  const openModal = (item: { raw?: RawNews; processed?: ProcessedNews }) => {
    setSelectedItem(item);
    setEditedTitle(item.processed?.title || item.raw?.title || '');
    setEditedSubtitle(item.processed?.subtitle || item.raw?.summary || '');
    setEditedContent(item.processed?.content_html || item.raw?.content || '');
    setModalViewTab('read');
  };

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
      {/* Top Banner & Stats */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-gray-900 via-[#131b2e] to-gray-900 border border-gray-800 shadow-xl">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
            <span>Centro de Control Editorial Puerto Rico</span>
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Monitoreo continuo de El Nuevo Día, Primera Hora, El Vocero, NotiCel y Metro PR.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Model Switcher */}
          <div className="flex items-center gap-1.5 bg-gray-950/80 px-3 py-1.5 rounded-xl border border-gray-700/80 text-xs">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-gray-400 font-semibold">Modelo:</span>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-transparent text-white font-bold focus:outline-none cursor-pointer"
            >
              <option value="glm-5.2" className="bg-gray-900 text-white">GLM 5.2 / GLM-4</option>
              <option value="minimax-m3" className="bg-gray-900 text-white">MiniMax M3</option>
              <option value="qwen2.5:72b" className="bg-gray-900 text-white">Qwen 2.5 72B</option>
            </select>
          </div>

          {/* Auto-Pilot Toggle */}
          <button
            onClick={() => setAutoPilot(!autoPilot)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border transition ${
              autoPilot
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 shadow-lg shadow-emerald-500/10'
                : 'bg-gray-800/80 border-gray-700 text-gray-400 hover:text-white'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                autoPilot ? 'bg-emerald-400 animate-ping' : 'bg-gray-500'
              }`}
            />
            {autoPilot ? 'MODO 100% AUTÓNOMO ACTIVO' : 'MODO SUPERVISIÓN MANUAL'}
          </button>

          {/* Trigger Poll Button */}
          <button
            onClick={handleManualPoll}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow-md shadow-red-600/30 transition active:scale-95"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Sondear Diarios Ahora</span>
          </button>
        </div>
      </div>

      {/* Sources & Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-900/60 p-3 rounded-xl border border-gray-800">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          <span className="text-xs font-semibold text-gray-400 flex items-center gap-1.5 mr-1">
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
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                selectedSource === src.id
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'bg-gray-800/60 text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }`}
            >
              {src.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-gray-800/80 p-1 rounded-lg border border-gray-700/60 text-xs">
          <button
            onClick={() => setFilterTab('pending')}
            className={`px-3 py-1 rounded-md font-medium transition ${
              filterTab === 'pending' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Pendientes ({rawNews.filter((n) => n.status !== 'processed').length})
          </button>
          <button
            onClick={() => setFilterTab('processed')}
            className={`px-3 py-1 rounded-md font-medium transition ${
              filterTab === 'processed' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Procesadas ({processedNews.length})
          </button>
        </div>
      </div>

      {/* Main Grid: Feed Cards */}
      {loading && rawNews.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 space-y-3">
          <RefreshCw className="w-8 h-8 animate-spin text-red-500" />
          <p className="text-sm font-medium">Sondeando medios de Puerto Rico...</p>
        </div>
      ) : filteredRawNews.length === 0 ? (
        <div className="text-center py-16 bg-gray-900/40 rounded-2xl border border-gray-800 space-y-2">
          <Newspaper className="w-10 h-10 text-gray-600 mx-auto" />
          <p className="text-base font-semibold text-gray-300">No hay noticias en esta sección</p>
          <p className="text-xs text-gray-500">Pulsa "Sondear Diarios Ahora" para consultar los feeds RSS de PR.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredRawNews.map((item) => {
            const isProcessing = processingId === item.id;
            const proc = processedNews.find((p) => p.raw_news_id === item.id);

            return (
              <div
                key={item.id}
                className="group flex flex-col justify-between rounded-2xl bg-[#0f1629] border border-gray-800 hover:border-gray-700 shadow-lg hover:shadow-2xl transition duration-200 overflow-hidden"
              >
                <div>
                  {/* Card Header & Image */}
                  <div className="relative h-44 w-full bg-gray-950 overflow-hidden">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-500 opacity-90"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-900 to-gray-800 text-gray-600">
                        <Newspaper className="w-12 h-12 stroke-[1.2]" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0f1629] via-transparent to-black/40" />

                    {/* Source Badge */}
                    <div className="absolute top-3 left-3 flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-black/80 backdrop-blur text-white border border-white/10">
                        {item.source_name}
                      </span>
                    </div>

                    {/* Status Pill */}
                    <div className="absolute top-3 right-3">
                      {proc ? (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-500/30">
                          <CheckCircle2 className="w-3 h-3" /> Procesada
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-amber-950/80 text-amber-300 border border-amber-500/30">
                          <Clock className="w-3 h-3" /> Pendiente
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Card Content */}
                  <div className="p-4 space-y-2">
                    <h3 className="font-bold text-sm text-gray-100 line-clamp-2 leading-snug group-hover:text-white transition">
                      {item.title}
                    </h3>
                    <p className="text-xs text-gray-400 line-clamp-3 leading-relaxed">
                      {item.summary || item.content}
                    </p>
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="p-4 pt-0 border-t border-gray-800/80 mt-3 flex items-center justify-between gap-2">
                  <a
                    href={item.original_url}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition"
                    title="Ver en diario original"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>

                  <div className="flex items-center gap-2">
                    {proc ? (
                      <button
                        onClick={() => openModal({ raw: item, processed: proc })}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-medium transition"
                      >
                        <Eye className="w-3.5 h-3.5 text-blue-400" />
                        <span>Ver Pieza</span>
                      </button>
                    ) : (
                      <button
                        disabled={isProcessing}
                        onClick={() => handleRunPipeline(item)}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition shadow-md ${
                          isProcessing
                            ? 'bg-gray-800 text-gray-400 cursor-not-allowed'
                            : 'bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white shadow-red-600/20 active:scale-95'
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

      {/* Enhanced Modal for Reviewing Article & Generated Video */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-fadeIn">
          <div className="bg-[#0e1526] border border-gray-700/80 rounded-3xl max-w-5xl w-full max-h-[92vh] overflow-hidden flex flex-col shadow-2xl">
            {/* Modal Top Bar */}
            <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between bg-gray-900/80 backdrop-blur">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-red-600 text-white text-xs font-black tracking-wider uppercase shadow-md shadow-red-600/30">
                  <Sparkles className="w-3.5 h-3.5 text-yellow-300" />
                  <span>PRENSA ABIERTA</span>
                </div>
                <span className="text-xs text-gray-400 hidden sm:inline">•</span>
                <span className="text-xs font-semibold text-gray-300 hidden sm:inline">
                  Redacción Editorial IA & Video Vertical (9:16)
                </span>
              </div>

              <div className="flex items-center gap-2">
                {/* View Tabs */}
                <div className="flex items-center bg-gray-950 p-1 rounded-xl border border-gray-800 text-xs">
                  <button
                    onClick={() => setModalViewTab('read')}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-bold transition ${
                      modalViewTab === 'read'
                        ? 'bg-red-600 text-white shadow-sm'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Lectura</span>
                  </button>
                  <button
                    onClick={() => setModalViewTab('edit')}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-bold transition ${
                      modalViewTab === 'edit'
                        ? 'bg-red-600 text-white shadow-sm'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Editar</span>
                  </button>
                </div>

                <button
                  onClick={() => setSelectedItem(null)}
                  className="p-2 text-gray-400 hover:text-white rounded-xl hover:bg-gray-800 transition font-bold text-xs ml-1"
                >
                  ✕ Cerrar
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Left Column: Article Reader / Editor */}
              <div className="lg:col-span-7 flex flex-col justify-between space-y-5">
                {modalViewTab === 'read' ? (
                  /* --- Clean Magazine Reading Mode --- */
                  <div className="space-y-5">
                    {/* Header & Meta */}
                    <div className="space-y-2 border-b border-gray-800/80 pb-4">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-red-500/10 text-red-400 border border-red-500/20 uppercase tracking-wide">
                          {selectedItem.processed?.category || selectedItem.raw?.category || 'Noticias'}
                        </span>
                        <span className="text-xs text-gray-500">•</span>
                        <span className="text-xs text-gray-400 font-medium">
                          Fuente original: {selectedItem.raw?.source_name}
                        </span>
                      </div>

                      <h1 className="text-2xl sm:text-3xl font-black text-white leading-tight tracking-tight">
                        {editedTitle || selectedItem.processed?.title || selectedItem.raw?.title}
                      </h1>

                      {(editedSubtitle || selectedItem.processed?.subtitle) && (
                        <div className="border-l-2 border-red-500 pl-3 py-0.5">
                          <p className="text-sm font-medium text-gray-300 leading-relaxed italic">
                            {editedSubtitle || selectedItem.processed?.subtitle}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Formatted Article Body */}
                    <div className="p-5 rounded-2xl bg-[#090e1c] border border-gray-800/80 space-y-4">
                      <div className="flex items-center justify-between border-b border-gray-800/60 pb-2.5">
                        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                          <BookOpen className="w-3.5 h-3.5 text-red-400" />
                          Redacción Prensa Abierta (Listo para WordPress)
                        </span>

                        <button
                          onClick={handleCopyContent}
                          className="flex items-center gap-1 text-[11px] font-bold text-gray-400 hover:text-white transition px-2 py-1 rounded bg-gray-900 border border-gray-800"
                        >
                          {copied ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span className="text-emerald-400">Copiado</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copiar</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* Content Render with Beautiful Line-Height & Spacing */}
                      <div
                        className="text-sm text-gray-200 space-y-3.5 leading-relaxed [&>p]:mb-3.5 [&>p]:text-gray-200 [&>p]:leading-relaxed [&>strong]:text-white [&>strong]:font-bold"
                        dangerouslySetInnerHTML={{
                          __html: editedContent || selectedItem.processed?.content_html || selectedItem.raw?.content || '',
                        }}
                      />
                    </div>

                    {/* Tags */}
                    {selectedItem.processed?.tags && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-xs text-gray-500 font-semibold mr-1">Etiquetas:</span>
                        {selectedItem.processed.tags.map((t, idx) => (
                          <span
                            key={idx}
                            className="px-2.5 py-1 rounded-lg bg-gray-900 border border-gray-800 text-[11px] font-medium text-gray-300"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  /* --- Fast Inline Editor Mode --- */
                  <div className="space-y-4 p-5 rounded-2xl bg-[#090e1c] border border-gray-800">
                    <div className="flex items-center justify-between border-b border-gray-800 pb-3">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Edit3 className="w-4 h-4 text-amber-400" /> Editor Rápido de Noticia
                      </span>
                      <span className="text-[11px] text-gray-400">Edita el texto antes de inyectarlo en WordPress</span>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-gray-300">Titular de Prensa Abierta</label>
                      <input
                        type="text"
                        value={editedTitle}
                        onChange={(e) => setEditedTitle(e.target.value)}
                        className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3.5 py-2.5 text-sm text-white font-bold focus:outline-none focus:border-red-500"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-gray-300">Bajada / Subtítulo</label>
                      <input
                        type="text"
                        value={editedSubtitle}
                        onChange={(e) => setEditedSubtitle(e.target.value)}
                        className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-red-500"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-gray-300">Cuerpo del Artículo (HTML / Párrafos)</label>
                      <textarea
                        rows={8}
                        value={editedContent}
                        onChange={(e) => setEditedContent(e.target.value)}
                        className="w-full bg-gray-950 border border-gray-700 rounded-xl p-3 text-xs text-gray-200 font-mono leading-relaxed focus:outline-none focus:border-red-500"
                      />
                    </div>

                    <div className="flex justify-end pt-2">
                      <button
                        onClick={handleSaveChanges}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold shadow-md shadow-red-600/30 transition active:scale-95"
                      >
                        <Save className="w-4 h-4" />
                        <span>Guardar Cambios</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: 9:16 Vertical Video Preview */}
              <div className="lg:col-span-5 flex flex-col items-center justify-between p-5 rounded-2xl bg-[#090e1c] border border-gray-800 space-y-4">
                <div className="w-full text-center">
                  <span className="text-xs font-bold text-gray-300 flex items-center justify-center gap-1.5">
                    <Video className="w-4 h-4 text-amber-400" /> Pieza de Video Vertical 9:16 (10-15s)
                  </span>
                </div>

                {/* Interactive 9:16 Video Player with Dynamic Title */}
                <VideoPlayerPreview
                  title={editedTitle || selectedItem.processed?.title || selectedItem.raw?.title || 'Última Hora Puerto Rico'}
                  category={selectedItem.processed?.category || selectedItem.raw?.category || 'Noticias'}
                  imageFallback={selectedItem.processed?.featured_image_url || selectedItem.raw?.image_url}
                  duration={12}
                />

                <div className="w-full space-y-2 pt-2">
                  <button
                    onClick={() => {
                      if (selectedItem.raw) handleRunPipeline(selectedItem.raw, true);
                    }}
                    className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/25 transition flex items-center justify-center gap-2 active:scale-95"
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

