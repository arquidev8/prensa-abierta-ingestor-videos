'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
  Download,
  Tag,
  Scale,
  Clapperboard,
  Upload,
  Image as ImageIcon,
  LayoutTemplate
} from 'lucide-react';
import { RawNews, ProcessedNews } from '@/lib/types';
import VideoPlayerPreview from '@/components/VideoPlayerPreview';
import ArticleComparison, { LegalAuditBanner, ArticleBody } from '@/components/ArticleComparison';
import EngineOfflineBanner from '@/components/EngineOfflineBanner';
import { calculateViralTrendScore } from '@/lib/trends';
import { fetchFromEngine, ENGINE_URL } from '@/lib/engineClient';
import { inferNewsCategory } from '@/lib/newsCategorizer';
import { useVideoRenderCache } from '@/hooks/useVideoRenderCache';

export default function FeedPage() {
  const [rawNews, setRawNews] = useState<RawNews[]>([]);
  const [processedNews, setProcessedNews] = useState<ProcessedNews[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [engineError, setEngineError] = useState<string | null>(null);
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
  const [modalTab, setModalTab] = useState<'resumen' | 'cotejo' | 'video'>('resumen');
  const [editing, setEditing] = useState<boolean>(false);
  const [editedTitle, setEditedTitle] = useState<string>('');
  const [editedSubtitle, setEditedSubtitle] = useState<string>('');
  const [editedContent, setEditedContent] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationStep, setGenerationStep] = useState<string>('');

  // --- Editor de video: base de la composición 9:16 ---
  // La composición arranca de DOS piezas separadas: una imagen inicial (destacada de
  // la noticia) y un clip de video de b-roll. En modo edición el usuario elige cuál
  // de las dos es la base y puede importar un archivo propio para reemplazarla.
  // Los archivos importados se suben a /api/media/upload (ver `handleImportImage`/
  // `handleImportClip`): así el Go Engine puede descargarlos por HTTP igual que
  // cualquier otro clip/imagen, y quedan reflejados tanto en el preview como en la
  // descarga real (ambos usan el mismo render, ver `useVideoRenderCache`).
  const [videoEditing, setVideoEditing] = useState<boolean>(false);
  const [compBase, setCompBase] = useState<'video' | 'image'>('video');
  const [customImage, setCustomImage] = useState<{ url: string; name: string } | null>(null);
  const [customClip, setCustomClip] = useState<{ url: string; name: string } | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState<'image' | 'video' | null>(null);
  // Plantilla de layout del Reel 9:16 (ver .agents/formato-video-reel.md).
  const [videoTemplate, setVideoTemplate] = useState<'standard' | 'reels-safe'>('standard');

  const { getState: getRenderState, ensureRendered } = useVideoRenderCache();

  const resetVideoEditor = () => {
    setVideoEditing(false);
    setCompBase('video');
    setVideoTemplate('standard');
    setCustomImage(null);
    setCustomClip(null);
    setUploadingMedia(null);
  };

  const uploadEditorFile = async (file: File, kind: 'image' | 'video'): Promise<string> => {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    const res = await fetch('/api/media/upload', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok || !data.url) {
      throw new Error(data.error || 'No se pudo subir el archivo');
    }
    return data.url as string;
  };

  const handleImportImage = async (file?: File | null) => {
    if (!file) return;
    setUploadingMedia('image');
    try {
      const url = await uploadEditorFile(file, 'image');
      setCustomImage({ url, name: file.name });
      setCompBase('image');
    } catch (e: any) {
      alert(e?.message || 'No se pudo subir la imagen');
    } finally {
      setUploadingMedia(null);
    }
  };

  const handleImportClip = async (file?: File | null) => {
    if (!file) return;
    setUploadingMedia('video');
    try {
      const url = await uploadEditorFile(file, 'video');
      setCustomClip({ url, name: file.name });
      setCompBase('video');
    } catch (e: any) {
      alert(e?.message || 'No se pudo subir el video');
    } finally {
      setUploadingMedia(null);
    }
  };

  // La descarga NO vuelve a renderizar nada: usa el mismo .mp4 ya generado para el
  // preview (misma clave en useVideoRenderCache), garantizando que sean la misma
  // pieza. Si aún no está listo, el botón queda deshabilitado (ver barra de acciones).
  const handleDownloadRealVideo = (title: string, url?: string) => {
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = `prensa-abierta-${title
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .slice(0, 40)}.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const fetchNews = async () => {
    setLoading(true);

    const [rawResult, procResult] = await Promise.all([
      fetchFromEngine<{ items: RawNews[] }>('/api/news/raw', { cache: 'no-store' }),
      fetchFromEngine<{ items: ProcessedNews[] }>('/api/news/processed', { cache: 'no-store' }),
    ]);

    if (rawResult.ok) setRawNews(rawResult.data.items || []);
    if (procResult.ok) setProcessedNews(procResult.data.items || []);

    // Solo mostramos el banner de "Engine no disponible" cuando el Engine es
    // inalcanzable (fetch falló), no ante un simple error HTTP puntual.
    const offlineResult = !rawResult.ok && rawResult.offline
      ? rawResult
      : !procResult.ok && procResult.offline
        ? procResult
        : null;
    setEngineError(offlineResult ? offlineResult.error : null);

    setLoading(false);
  };

  useEffect(() => {
    fetchNews();
    const interval = setInterval(fetchNews, 20000);
    return () => clearInterval(interval);
  }, []);

  const handleManualPoll = async () => {
    try {
      const res = await fetch(`${ENGINE_URL}/api/news/poll`, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`No se pudo iniciar el sondeo (${res.status})`);
      }
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
    setModalTab('resumen');
    setEditing(false);
    resetVideoEditor();
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

  // Categorías disponibles para el filtro: derivadas del TÍTULO/RESUMEN de cada
  // noticia (inferNewsCategory), no del campo `category` crudo. Los feeds RSS de
  // estos medios casi nunca traen categoría por artículo, así que agrupar por
  // `item.category` tal cual solo da 3-5 valores genéricos (uno por medio, ej.
  // "General"/"Nacional"), no por tema real — ver lib/newsCategorizer.ts.
  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    rawNews.forEach((item) => {
      set.add(inferNewsCategory(item.title, item.summary || item.content, item.category));
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }, [rawNews]);

  // Categoría que se le pasa al pipeline de video (preview + descarga). Se usa la
  // MISMA categoría inferida del título/resumen que alimenta las chips del Feed
  // (no la cruda `processed.category`/`raw.category`, que suele ser genérica:
  // "General"/"Nacional"/"Noticias") para que el b-roll matchee el tema real —
  // ver el ruteo categoría→carpeta en lib/contentLibrary.ts.
  const modalVideoCategory = useMemo(() => {
    if (!selectedItem) return 'Noticias';
    return inferNewsCategory(
      selectedItem.processed?.title || selectedItem.raw?.title,
      selectedItem.raw?.summary || selectedItem.raw?.content || selectedItem.processed?.content_html,
      selectedItem.processed?.category || selectedItem.raw?.category
    );
  }, [selectedItem]);

  // Titular/imagen/id "committed" de la noticia abierta (ignoran el texto que se
  // esté editando en vivo en el editor rápido, para no disparar un render nuevo en
  // cada tecla — solo cuando se guarda, `selectedItem` cambia y sí re-renderiza).
  const modalHeadline = useMemo(() => {
    if (!selectedItem) return '';
    return (
      selectedItem.processed?.title || selectedItem.raw?.title || 'Última Hora Puerto Rico'
    );
  }, [selectedItem]);
  const modalFeaturedImage = useMemo(
    () => selectedItem?.processed?.featured_image_url || selectedItem?.raw?.image_url,
    [selectedItem]
  );
  const modalVideoId = useMemo(
    () => selectedItem?.processed?.id || selectedItem?.raw?.id,
    [selectedItem]
  );

  // Parámetros que determinan el .mp4 final: cualquier cambio de fondo/plantilla/
  // archivo importado desde el "Editor de video" produce una clave nueva en el
  // cache y dispara un render nuevo (ver useVideoRenderCache).
  const videoRenderParams = useMemo(() => {
    if (!selectedItem || !modalHeadline) return null;
    return {
      newsId: modalVideoId || `news_${Date.now()}`,
      headline: modalHeadline,
      category: modalVideoCategory,
      imageUrl: modalFeaturedImage,
      background: compBase,
      template: videoTemplate,
      customImageUrl: compBase === 'image' ? customImage?.url : undefined,
      customClipUrl: compBase === 'video' ? customClip?.url : undefined,
    };
  }, [
    selectedItem,
    modalHeadline,
    modalVideoId,
    modalVideoCategory,
    modalFeaturedImage,
    compBase,
    videoTemplate,
    customImage,
    customClip,
  ]);

  const videoRenderState = getRenderState(videoRenderParams);

  // Dispara el render real (Go Engine) apenas hay noticia abierta, y de nuevo
  // cada vez que cambian los ajustes del "Editor de video" — así el preview
  // siempre termina mostrando (y la descarga usando) el mismo .mp4.
  useEffect(() => {
    if (!videoRenderParams) return;
    // No disparar mientras se sube un archivo importado: evita renderizar con
    // datos a medio subir.
    if (uploadingMedia) return;
    ensureRendered(videoRenderParams);
  }, [videoRenderParams, uploadingMedia, ensureRendered]);

  // Filter Logic
  const filteredRawNews = rawNews.filter((item) => {
    // Source filter
    if (selectedSource !== 'all' && item.source_id !== selectedSource) return false;

    // Status filter
    if (filterTab === 'pending' && item.status === 'processed') return false;
    if (filterTab === 'processed' && item.status !== 'processed') return false;

    // Category filter (misma categoría inferida que arma el filtro de arriba)
    if (selectedCategory !== 'all') {
      const cat = inferNewsCategory(item.title, item.summary || item.content, item.category);
      if (cat !== selectedCategory) return false;
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
      await fetch(`${ENGINE_URL}/api/news/processed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      setSelectedItem({ ...selectedItem, processed: updated });
      setEditing(false);
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

      {/* Estado explícito cuando el Go Engine no responde (evita confundirlo con "sin noticias") */}
      {engineError && (
        <EngineOfflineBanner message={engineError} onRetry={fetchNews} retrying={loading} />
      )}

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

          {/* Category Filter: dropdown en vez de pills — con 8+ categorías inferidas,
              una fila de botones forzaba scroll horizontal (se veía mal); un select
              nativo se combina igual (AND) con el resto de los filtros activos y no
              tiene ese problema sin importar cuántas categorías haya. */}
          <div className="flex items-center gap-2 bg-slate-50 px-3.5 py-2 rounded-2xl border border-slate-200 text-xs shrink-0">
            <Tag className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-slate-600 font-bold">Categoría:</span>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-transparent text-slate-900 font-black focus:outline-none cursor-pointer max-w-[150px]"
            >
              <option value="all">Todas</option>
              {availableCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
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

      {/* Modal de noticia — pestañas de ancho completo + barra de acciones persistente
          (portado del rediseño aprobado en /dev/comparativa). El tab "Video 9:16" queda
          oculto por ahora: el preview vive dentro de "Resumen de noticia" y la descarga
          en la barra inferior. */}
      {selectedItem && (() => {
        const raw = selectedItem.raw;
        const proc = selectedItem.processed;
        const hasProcessed = Boolean(proc);
        const sourceName = raw?.source_name || 'Diario';
        const displayTitle =
          editedTitle || proc?.title || raw?.title || 'Última Hora Puerto Rico';
        const displaySubtitle = editedSubtitle || proc?.subtitle || '';
        const displayBody = editedContent || proc?.content_html || raw?.content || '';
        const originalBody = raw?.content || raw?.summary || '';
        const featuredImage = proc?.featured_image_url || raw?.image_url;
        const videoId = proc?.id || raw?.id;
        const isProcessingThis = Boolean(raw && processingId === raw.id);

        return (
          <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 animate-fadeIn">
            <div className="bg-white border border-slate-200 rounded-3xl max-w-6xl w-full h-[90vh] overflow-hidden flex flex-col shadow-2xl">
              {/* Barra superior */}
              <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-white shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-orange-50 border border-orange-200 text-[#FF5500] text-[11px] font-black tracking-wider uppercase shadow-sm">
                    <img src="/logo.png" alt="" className="w-4 h-4 rounded object-cover" />
                    <span>Prensa Abierta</span>
                  </span>
                  <span className="hidden sm:block truncate text-xs font-bold text-slate-500">
                    {proc?.category || raw?.category || 'Noticias'} · Fuente: {sourceName}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedItem(null)}
                  className="p-2 text-slate-400 hover:text-slate-900 rounded-xl hover:bg-slate-100 transition font-bold text-xs shrink-0"
                >
                  ✕ Cerrar
                </button>
              </div>

              {/* Pestañas principales (ancho completo) */}
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-3 sm:px-5 shrink-0">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setModalTab('resumen')}
                    className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-3 text-xs font-bold transition ${
                      modalTab === 'resumen'
                        ? 'border-[#FF5500] text-[#FF5500]'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Resumen de noticia</span>
                  </button>
                  <button
                    onClick={() => setModalTab('cotejo')}
                    className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-3 text-xs font-bold transition ${
                      modalTab === 'cotejo'
                        ? 'border-[#FF5500] text-[#FF5500]'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <Scale className="w-3.5 h-3.5" />
                    <span>Comparativa & Diferencias</span>
                  </button>
                  <button
                    onClick={() => setModalTab('video')}
                    className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-3 text-xs font-bold transition ${
                      modalTab === 'video'
                        ? 'border-[#FF5500] text-[#FF5500]'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <Clapperboard className="w-3.5 h-3.5" />
                    <span>Editor de video</span>
                  </button>
                </div>

                {modalTab === 'resumen' && (
                  <button
                    onClick={() => setEditing((e) => !e)}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition ${
                      editing
                        ? 'border-[#FF5500] bg-orange-50 text-[#FF5500]'
                        : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    {editing ? 'Volver a lectura' : 'Editar'}
                  </button>
                )}
              </div>

              {/* Cuerpo (scroll único del modal) */}
              <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/50 custom-scrollbar relative">
                {/* Overlay mientras la IA redacta */}
                {isGenerating && (
                  <div className="absolute inset-0 z-30 bg-white/95 backdrop-blur-md flex flex-col items-center justify-center p-6 space-y-4 text-center animate-fadeIn">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-[#FF5500] to-amber-400 flex items-center justify-center shadow-xl shadow-orange-500/30 animate-pulse">
                      <Sparkles className="w-8 h-8 text-white animate-spin" />
                    </div>
                    <div className="space-y-1 max-w-sm">
                      <h3 className="text-lg font-black text-slate-900">
                        Redactando noticia &amp; generando video
                      </h3>
                      <p className="text-xs text-slate-600 font-medium">
                        {generationStep ||
                          `El modelo de IA (${selectedModel}) está redactando el artículo para WordPress y preparando el Reel 9:16...`}
                      </p>
                    </div>
                    <div className="w-48 h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-[#FF5500] to-amber-400 w-full animate-pulse" />
                    </div>
                  </div>
                )}

                {/* --- Tab: Resumen de noticia --- */}
                {modalTab === 'resumen' && (
                  <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
                    {/* 1 · Título */}
                    <div className="space-y-2.5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-orange-200 bg-orange-100 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wide text-[#FF5500]">
                          {proc?.category || raw?.category || 'Noticias'}
                        </span>
                        {raw?.original_url && (
                          <a
                            href={raw.original_url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"
                          >
                            <ExternalLink className="w-3 h-3" /> {sourceName}
                          </a>
                        )}
                      </div>
                      <h1 className="text-xl sm:text-2xl font-black leading-tight tracking-tight text-slate-900">
                        {displayTitle}
                      </h1>
                      {displaySubtitle && (
                        <div className="rounded-r-xl border-l-4 border-[#FF5500] bg-orange-50/50 py-1 pl-3.5">
                          <p className="text-xs sm:text-sm font-semibold italic leading-relaxed text-slate-700">
                            {displaySubtitle}
                          </p>
                        </div>
                      )}
                    </div>

                    {!editing && (
                      <>
                        {/* 2 · Preview del video */}
                        <div className="flex flex-col items-center gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                          <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
                            <Video className="w-3.5 h-3.5 text-[#FF5500]" /> Video Reel 9:16
                          </span>
                          <VideoPlayerPreview
                            title={displayTitle}
                            category={modalVideoCategory}
                            template={videoTemplate}
                            duration={12}
                            newsId={videoId}
                            renderState={videoRenderState}
                            onRetryRender={() => ensureRendered(videoRenderParams)}
                          />
                          {(compBase === 'image' ||
                            customImage ||
                            customClip ||
                            videoTemplate !== 'standard') && (
                            <p className="text-[11px] text-slate-400">
                              Ajustado en la pestaña “Editor de video”.
                            </p>
                          )}
                        </div>

                        {/* 3 · Auditoría legal anti-plagio */}
                        {hasProcessed && (
                          <LegalAuditBanner
                            originalContent={originalBody}
                            rewrittenContent={displayBody}
                          />
                        )}
                      </>
                    )}

                    {/* 4 · Nota completa / editor */}
                    {editing ? (
                      <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                        <span className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                          <Edit3 className="w-4 h-4 text-[#FF5500]" /> Editor rápido de noticia
                        </span>
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-700">
                            Titular de Prensa Abierta
                          </label>
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
                          <label className="text-xs font-bold text-slate-700">Cuerpo del artículo</label>
                          <textarea
                            rows={12}
                            value={editedContent}
                            onChange={(e) => setEditedContent(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs text-slate-800 font-mono leading-relaxed focus:outline-none focus:border-[#FF5500]"
                          />
                        </div>
                        <div className="flex justify-end">
                          <button
                            onClick={handleSaveChanges}
                            disabled={!hasProcessed}
                            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-white text-xs font-bold shadow-md transition active:scale-95 ${
                              hasProcessed
                                ? 'bg-[#FF5500] hover:bg-[#E04B00] shadow-orange-500/20'
                                : 'bg-slate-300 cursor-not-allowed'
                            }`}
                          >
                            <Save className="w-4 h-4" />
                            <span>Guardar cambios</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                          <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
                            <BookOpen className="w-3.5 h-3.5 text-[#FF5500]" />
                            {hasProcessed
                              ? 'Nota completa (redacción IA)'
                              : 'Texto original (sin redactar)'}
                          </span>
                          {raw && (
                            <button
                              disabled={isProcessingThis}
                              onClick={() => handleRunPipeline(raw, false)}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition ${
                                isProcessingThis
                                  ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                                  : 'bg-gradient-to-r from-[#FF5500] to-[#FF7700] hover:from-[#E04B00] hover:to-[#FF6600] text-white shadow-sm shadow-orange-500/20'
                              }`}
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              {isProcessingThis
                                ? 'Redactando...'
                                : hasProcessed
                                  ? 'Redactar de nuevo'
                                  : 'Redactar con IA'}
                            </button>
                          )}
                        </div>

                        <ArticleBody content={hasProcessed ? displayBody : originalBody} />

                        {proc?.tags && proc.tags.length > 0 && (
                          <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-4">
                            <span className="mr-1 text-xs font-bold text-slate-500">Etiquetas:</span>
                            {proc.tags.map((t, idx) => (
                              <span
                                key={idx}
                                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-700"
                              >
                                #{t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* --- Tab: Comparativa & Diferencias --- */}
                {modalTab === 'cotejo' && (
                  <div className="px-4 py-5 sm:px-6">
                    {hasProcessed && raw ? (
                      <ArticleComparison
                        sourceName={sourceName}
                        originalTitle={raw.title}
                        originalContent={originalBody}
                        rewrittenTitle={displayTitle}
                        rewrittenContent={displayBody}
                      />
                    ) : (
                      <div className="mx-auto max-w-md rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
                        <Scale className="mx-auto mb-3 h-8 w-8 text-slate-300" />
                        <p className="text-sm font-bold text-slate-800">
                          Todavía no hay redacción propia para comparar
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Redacta la noticia con IA y aquí verás el cotejo párrafo a párrafo contra el
                          texto del diario original.
                        </p>
                        {raw && (
                          <button
                            disabled={isProcessingThis}
                            onClick={() => handleRunPipeline(raw, false)}
                            className={`mt-4 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white shadow-md transition ${
                              isProcessingThis
                                ? 'bg-slate-300 cursor-not-allowed'
                                : 'bg-gradient-to-r from-[#FF5500] to-[#FF7700] hover:from-[#E04B00] hover:to-[#FF6600] shadow-orange-500/20'
                            }`}
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                            {isProcessingThis ? 'Redactando...' : 'Redactar con IA'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* --- Tab: Editor de video --- */}
                {modalTab === 'video' && (
                  <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
                    {/* Vista previa + acceso a edición del fondo */}
                    <div className="flex flex-col items-center gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="flex w-full items-center justify-between">
                        <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
                          <Clapperboard className="w-3.5 h-3.5 text-[#FF5500]" /> Vista previa · Reel 9:16
                        </span>
                        <button
                          onClick={() => setVideoEditing((v) => !v)}
                          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition ${
                            videoEditing
                              ? 'border-[#FF5500] bg-orange-50 text-[#FF5500]'
                              : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          {videoEditing ? 'Listo' : 'Editar fondo'}
                        </button>
                      </div>

                      <VideoPlayerPreview
                        title={displayTitle}
                        category={modalVideoCategory}
                        template={videoTemplate}
                        duration={12}
                        newsId={videoId}
                        renderState={videoRenderState}
                        onRetryRender={() => ensureRendered(videoRenderParams)}
                      />

                      {!videoEditing && (
                        <p className="text-[11px] text-slate-400">
                          Fondo actual:{' '}
                          {compBase === 'image'
                            ? customImage
                              ? `imagen importada (${customImage.name})`
                              : 'imagen inicial de la noticia'
                            : customClip
                              ? `video importado (${customClip.name})`
                              : `clip automático · ${modalVideoCategory}`}
                        </p>
                      )}
                    </div>

                    {/* Plantilla del Reel (layout de titular / logo) */}
                    <div className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
                        <LayoutTemplate className="w-3.5 h-3.5 text-[#FF5500]" /> Plantilla del Reel
                      </span>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => setVideoTemplate('standard')}
                          className={`rounded-2xl border p-3 text-left transition ${
                            videoTemplate === 'standard'
                              ? 'border-[#FF5500] bg-orange-50/50 ring-1 ring-[#FF5500]/30'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <span className="block text-xs font-black text-slate-800">Estándar</span>
                          <span className="mt-1 block text-[10.5px] text-slate-500">
                            Titular pegado al borde inferior, ocupa todo el alto 9:16.
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setVideoTemplate('reels-safe')}
                          className={`rounded-2xl border p-3 text-left transition ${
                            videoTemplate === 'reels-safe'
                              ? 'border-[#FF5500] bg-orange-50/50 ring-1 ring-[#FF5500]/30'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <span className="block text-xs font-black text-slate-800">
                            Instagram Reels (Safe Zone)
                          </span>
                          <span className="mt-1 block text-[10.5px] text-slate-500">
                            Titular elevado a la zona 1:1, logo más separado del borde y los
                            últimos ~15% libres para la UI de Reels.
                          </span>
                        </button>
                      </div>
                      <p className="text-[10.5px] text-slate-400">
                        Se aplica a la vista previa y a la descarga (.mp4).
                      </p>
                    </div>

                    {/* Editor del fondo: imagen inicial vs video de composición */}
                    {videoEditing && (
                      <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div>
                          <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
                            <Clapperboard className="w-3.5 h-3.5 text-[#FF5500]" /> Base de la composición
                          </span>
                          <p className="mt-1 text-[11px] text-slate-500">
                            Elige con qué arranca el Reel 9:16 e importa un archivo propio si quieres
                            reemplazar el generado automáticamente.
                          </p>
                        </div>

                        {/* Selector: Imagen inicial | Video de composición (separados) */}
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => setCompBase('image')}
                            className={`rounded-2xl border p-3 text-left transition ${
                              compBase === 'image'
                                ? 'border-[#FF5500] bg-orange-50/50 ring-1 ring-[#FF5500]/30'
                                : 'border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <span className="flex items-center gap-1.5 text-xs font-black text-slate-800">
                              <ImageIcon className="w-3.5 h-3.5 text-[#FF5500]" /> Imagen inicial
                            </span>
                            <span className="mt-1 block text-[10.5px] text-slate-500">
                              {customImage ? customImage.name : 'Imagen destacada de la noticia'}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setCompBase('video')}
                            className={`rounded-2xl border p-3 text-left transition ${
                              compBase === 'video'
                                ? 'border-[#FF5500] bg-orange-50/50 ring-1 ring-[#FF5500]/30'
                                : 'border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <span className="flex items-center gap-1.5 text-xs font-black text-slate-800">
                              <Clapperboard className="w-3.5 h-3.5 text-[#FF5500]" /> Video de composición
                            </span>
                            <span className="mt-1 block text-[10.5px] text-slate-500">
                              {customClip
                                ? customClip.name
                                : `Clip automático · ${modalVideoCategory}`}
                            </span>
                          </button>
                        </div>

                        {/* Importador de la opción seleccionada */}
                        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-4">
                          {compBase === 'image' ? (
                            <div className="space-y-2">
                              <label
                                className={`flex w-fit items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white transition ${
                                  uploadingMedia === 'image'
                                    ? 'bg-slate-400 cursor-not-allowed'
                                    : 'bg-[#FF5500] hover:bg-[#E04B00] cursor-pointer'
                                }`}
                              >
                                <Upload className="w-3.5 h-3.5" />
                                {uploadingMedia === 'image' ? 'Subiendo imagen...' : 'Importar imagen'}
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  disabled={uploadingMedia === 'image'}
                                  onChange={(e) => handleImportImage(e.target.files?.[0])}
                                />
                              </label>
                              {customImage && (
                                <button
                                  onClick={() => setCustomImage(null)}
                                  className="block text-[11px] font-bold text-slate-500 underline hover:text-slate-800"
                                >
                                  Quitar imagen importada — usar la de la noticia
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <label
                                className={`flex w-fit items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white transition ${
                                  uploadingMedia === 'video'
                                    ? 'bg-slate-400 cursor-not-allowed'
                                    : 'bg-[#FF5500] hover:bg-[#E04B00] cursor-pointer'
                                }`}
                              >
                                <Upload className="w-3.5 h-3.5" />
                                {uploadingMedia === 'video' ? 'Subiendo video...' : 'Importar video'}
                                <input
                                  type="file"
                                  accept="video/*"
                                  className="hidden"
                                  disabled={uploadingMedia === 'video'}
                                  onChange={(e) => handleImportClip(e.target.files?.[0])}
                                />
                              </label>
                              {customClip && (
                                <button
                                  onClick={() => setCustomClip(null)}
                                  className="block text-[11px] font-bold text-slate-500 underline hover:text-slate-800"
                                >
                                  Quitar video importado — usar el clip automático
                                </button>
                              )}
                            </div>
                          )}
                          <p className="mt-2 text-[10.5px] text-slate-400">
                            El archivo importado se aplica tanto a la vista previa como a la
                            descarga (.mp4) — se regenera el video real automáticamente.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Barra de acciones persistente */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:px-5 shrink-0">
                <button
                  onClick={handleCopyContent}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-800 transition hover:bg-slate-200"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700">¡Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copiar artículo</span>
                    </>
                  )}
                </button>

                <div className="flex items-center gap-2">
                  <button
                    disabled={videoRenderState.status !== 'ready'}
                    onClick={() => handleDownloadRealVideo(displayTitle, videoRenderState.url)}
                    className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-black text-white shadow-md transition active:scale-95 ${
                      videoRenderState.status !== 'ready'
                        ? 'bg-slate-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-[#FF5500] to-[#FF7700] hover:from-[#E04B00] hover:to-[#FF6600] shadow-orange-500/20'
                    }`}
                  >
                    {videoRenderState.status === 'rendering' ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Generando video...</span>
                      </>
                    ) : videoRenderState.status === 'failed' ? (
                      <>
                        <Download className="w-3.5 h-3.5" />
                        <span>Video no disponible</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" />
                        <span>Descargar Video (.mp4)</span>
                      </>
                    )}
                  </button>

                  {raw && (
                    <button
                      onClick={() => handleRunPipeline(raw, true)}
                      className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white shadow-md shadow-emerald-600/20 transition hover:bg-emerald-500 active:scale-95"
                    >
                      <UploadCloud className="w-3.5 h-3.5" />
                      <span>Aprobar &amp; Inyectar en WordPress</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
