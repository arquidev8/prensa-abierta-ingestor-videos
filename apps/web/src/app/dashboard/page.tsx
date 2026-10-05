'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
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
  LayoutTemplate,
  Type,
  Palette,
  Mic,
  Sliders,
  Volume2,
  Film,
  RotateCcw,
  Zap,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Quote,
} from 'lucide-react';
import { RawNews, ProcessedNews, VideoStyle, VideoStylePreset } from '@/lib/types';
import VideoPlayerPreview from '@/components/VideoPlayerPreview';
import ArticleComparison, { LegalAuditBanner, ArticleBody } from '@/components/ArticleComparison';
import EngineOfflineBanner from '@/components/EngineOfflineBanner';
import RelatedCoverageRow from '@/components/RelatedCoverageRow';
import RelatedCoverageStack from '@/components/RelatedCoverageStack';
import CardImage from '@/components/CardImage';
import { calculateViralTrendScore } from '@/lib/trends';
import { fetchFromEngine, ENGINE_URL } from '@/lib/engineClient';
import { buildVoiceScript } from '@/lib/voiceScript';
import { inferNewsCategory } from '@/lib/newsCategorizer';
import { useVideoRenderCache } from '@/hooks/useVideoRenderCache';

const NEWS_POLL_INTERVAL_MS = 120000;

// Cards de la página cuyas imágenes se piden al abrirla (dos filas de la grilla de 3
// columnas); el resto carga al acercarse el scroll.
const EAGER_IMAGE_CARDS = 6;

// Debe coincidir con los `id` de services/engine/pkg/scraper/sources.go.
const NEWS_SOURCE_FILTER_OPTIONS = [
  { id: 'all', label: 'Todos los Diarios' },
  { id: 'prensa-abierta', label: 'Prensa Abierta' },
  { id: 'el-nuevo-dia', label: 'El Nuevo Día' },
  { id: 'primera-hora', label: 'Primera Hora' },
  { id: 'el-vocero', label: 'El Vocero' },
  { id: 'noticel', label: 'NotiCel' },
  { id: 'metro-pr', label: 'Metro PR' },
  { id: 'la-perla-del-sur', label: 'La Perla del Sur' },
  { id: 'telemundo-pr', label: 'Telemundo PR' },
  { id: 'wapa', label: 'WAPA' },
  { id: 'radio-isla', label: 'Radio Isla 1320' },
  { id: 'el-calce', label: 'El Calce' },
];

export default function FeedPage() {
  const [rawNews, setRawNews] = useState<RawNews[]>([]);
  const [processedNews, setProcessedNews] = useState<ProcessedNews[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [engineError, setEngineError] = useState<string | null>(null);
  // El polling en background nunca reemplaza las listas visibles por su cuenta
  // (eso hacía saltar el modal/scroll mientras el usuario leía una nota). En
  // vez de eso, guarda lo nuevo aquí y solo se aplica cuando el usuario le da
  // click al botón "Noticias nuevas" (o en un fetch explícito del usuario).
  const [pendingNews, setPendingNews] = useState<{ raw: RawNews[]; processed: ProcessedNews[] } | null>(null);
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
  const [citeSource, setCiteSource] = useState<boolean>(true);
  const [citationText, setCitationText] = useState<string>('');
  const [citationLinkText, setCitationLinkText] = useState<string>('Ver fuente original');
  const [includeCitationLink, setIncludeCitationLink] = useState<boolean>(true);

  const syncCitationInContent = (
    enabled: boolean,
    text: string,
    linkText: string,
    includeLink: boolean,
    rawItem?: RawNews
  ) => {
    const item = rawItem || selectedItem?.raw;
    if (!item) return;
    const url = item.original_url;
    const linkHtml = (includeLink && url && linkText.trim())
      ? ` (<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: #FF5500; text-decoration: underline;">${linkText.trim()}</a>)`
      : '';
    const cleanText = text.trim().replace(/\.+$/, '');
    const citationHtml = `<p class="source-citation" style="margin-top: 1.5rem; padding-top: 0.75rem; border-top: 1px solid #e2e8f0; font-size: 0.85rem; color: #64748b; font-style: italic;">${cleanText}${linkHtml}.</p>`;

    setEditedContent((prev) => {
      const cur = prev || selectedItem?.processed?.content_html || item.content || '';
      const cleaned = cur.replace(/<p class="source-citation"[\s\S]*?<\/p>/gi, '').trim();
      if (!enabled || !cleanText) {
        return cleaned;
      }
      return cleaned + '\n' + citationHtml;
    });
  };

  const handleToggleCiteSource = (enable: boolean) => {
    setCiteSource(enable);
    syncCitationInContent(enable, citationText, citationLinkText, includeCitationLink, selectedItem?.raw);
  };

  const handleUpdateCitationText = (val: string) => {
    setCitationText(val);
    syncCitationInContent(citeSource, val, citationLinkText, includeCitationLink, selectedItem?.raw);
  };

  const handleUpdateCitationLinkText = (val: string) => {
    setCitationLinkText(val);
    syncCitationInContent(citeSource, citationText, val, includeCitationLink, selectedItem?.raw);
  };

  const handleToggleIncludeLink = (val: boolean) => {
    setIncludeCitationLink(val);
    syncCitationInContent(citeSource, citationText, citationLinkText, val, selectedItem?.raw);
  };

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
  const [videoTemplate, setVideoTemplate] = useState<'standard' | 'reels-safe' | 'app-promo'>('standard');
  const [videoStudioTab, setVideoStudioTab] = useState<'typography' | 'template' | 'media' | 'voice' | 'presets'>('typography');
  const [customVoiceText, setCustomVoiceText] = useState<string>('');
  const [committedVoiceText, setCommittedVoiceText] = useState<string>('');

  // --- Estilo del titular (Editor granular): tipografía, colores, posición,
  // logo y banner por encima del layout de `videoTemplate`. `videoStyle` es el
  // valor "en vivo" (cambia con cada tecla/drag de slider); `committedVideoStyle`
  // es la versión debounced (~500ms) que dispara el render real y se persiste en
  // ProcessedNews.video_style — así arrastrar un slider no encola un render por
  // cada pixel. Ver useVideoRenderCache (buildKey incluye `style`).
  const [videoStyle, setVideoStyle] = useState<VideoStyle | null>(null);
  const [committedVideoStyle, setCommittedVideoStyle] = useState<VideoStyle | null>(null);
  const [stylePresets, setStylePresets] = useState<VideoStylePreset[]>([]);
  const [savingPreset, setSavingPreset] = useState(false);
  const [isDownloadingVideo, setIsDownloadingVideo] = useState(false);

  const setStyleField = (patch: Partial<VideoStyle>) => {
    setVideoStyle((prev) => ({ ...(prev || {}), ...patch }));
  };

  // Trae los valores por defecto (números/colores reales) de una plantilla desde
  // el Go Engine — única fuente de verdad, evita duplicar constantes de layout
  // acá. Se usa tanto al abrir una noticia sin estilo guardado como al cambiar de
  // plantilla o al "Restaurar valores de la plantilla".
  const loadTemplateStyleDefaults = async (template: 'standard' | 'reels-safe' | 'app-promo') => {
    const res = await fetchFromEngine<VideoStyle>(`/api/video/style-defaults?template=${template}`);
    if (res.ok) setVideoStyle(res.data);
  };

  const applyTemplate = (template: 'standard' | 'reels-safe' | 'app-promo') => {
    setVideoTemplate(template);
    loadTemplateStyleDefaults(template);
  };

  const fetchStylePresets = async () => {
    const res = await fetchFromEngine<{ presets: VideoStylePreset[] }>('/api/video/style-presets');
    if (res.ok) setStylePresets(res.data.presets || []);
  };
  useEffect(() => { fetchStylePresets(); }, []);

  const handleApplyPreset = (presetId: string) => {
    const preset = stylePresets.find((p) => p.id === presetId);
    if (preset) setVideoStyle((prev) => ({ ...(prev || {}), ...preset.style }));
  };

  const handleSaveAsPreset = async () => {
    if (!videoStyle) return;
    const name = window.prompt('Nombre del preset:');
    if (!name || !name.trim()) return;
    setSavingPreset(true);
    try {
      const res = await fetch(`${ENGINE_URL}/api/video/style-presets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), style: videoStyle }),
      });
      if (res.ok) {
        await fetchStylePresets();
        toast.success('Preset guardado.');
      } else {
        toast.error('No se pudo guardar el preset.');
      }
    } catch {
      toast.error('No se pudo guardar el preset.');
    } finally {
      setSavingPreset(false);
    }
  };

  // Debounce (~1000ms): el render real (FFmpeg) y la persistencia en
  // ProcessedNews.video_style se disparan cuando el usuario termina de ajustar
  // los controles, evitando renders intermedios innecesarios.
  useEffect(() => {
    const t = setTimeout(() => setCommittedVideoStyle(videoStyle), 1000);
    return () => clearTimeout(t);
  }, [videoStyle]);

  // Debounce (~1000ms): el render real con la nueva locución se dispara cuando
  // el usuario termina de escribir o editar el guion.
  useEffect(() => {
    const t = setTimeout(() => setCommittedVoiceText(customVoiceText), 1000);
    return () => clearTimeout(t);
  }, [customVoiceText]);

  // Referencia siempre-actual a la noticia procesada abierta, para persistir el
  // estilo ya asentado (committedVideoStyle) sin que ese efecto dependa de
  // `selectedItem` completo (evita relanzar el guardado en cada refresco de fondo).
  const selectedProcessedRef = useRef<ProcessedNews | undefined>(undefined);
  useEffect(() => { selectedProcessedRef.current = selectedItem?.processed; }, [selectedItem]);

  useEffect(() => {
    const processed = selectedProcessedRef.current;
    if (!processed || !committedVideoStyle) return;
    const updated: ProcessedNews = { ...processed, video_style: committedVideoStyle };
    fetch(`${ENGINE_URL}/api/news/processed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).catch((err) => console.error('Error guardando el estilo de video:', err));
  }, [committedVideoStyle]);

  const { getState: getRenderState, ensureRendered, forceRender } = useVideoRenderCache();

  // Al abrir una noticia, el "Editor de video" arranca desde la dirección de
  // composición que generó la IA / Motor Autónomo (Capa 3): base imagen/video y
  // plantilla. El usuario puede cambiarlas después y su elección manda. El
  // estilo del titular arranca del guardado en la noticia (video_style) si
  // existe; si no, de los defaults reales de la plantilla (Go Engine).
  const resetVideoEditor = (
    direction?: ProcessedNews['video_direction'],
    savedStyle?: VideoStyle
  ) => {
    setVideoEditing(false);
    setCompBase(direction?.lead_with ?? 'video');
    const template = direction?.template ?? 'standard';
    setVideoTemplate(template);
    setCustomImage(null);
    setCustomClip(null);
    setUploadingMedia(null);
    setCustomVoiceText('');
    setCommittedVoiceText('');
    if (savedStyle) {
      setCommittedVideoStyle(savedStyle);
      setVideoStyle(savedStyle);
    } else {
      setCommittedVideoStyle(null);
      setVideoStyle(null);
      loadTemplateStyleDefaults(template);
    }
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
    // El slot "Video de composición" también acepta una imagen: se sube y se
    // guarda igual en `customClip` (sigue siendo la pieza del segmento de
    // VIDEO), sin tocar la imagen de portada (`customImage`/`leadImage`), que
    // solo cambia si el usuario elige explícitamente esa otra tarjeta. El Go
    // Engine detecta por extensión que es una imagen y la renderiza con el
    // mismo zoom lento (`coverImageFilter`) que usa la portada, en vez de
    // tratarla como un clip de video.
    const isImage = file.type.startsWith('image/');
    setUploadingMedia(isImage ? 'image' : 'video');
    try {
      const url = await uploadEditorFile(file, isImage ? 'image' : 'video');
      setCustomClip({ url, name: file.name });
      setCompBase('video');
    } catch (e: any) {
      alert(e?.message || `No se pudo subir ${isImage ? 'la imagen' : 'el video'}`);
    } finally {
      setUploadingMedia(null);
    }
  };

  const [uploadingShotIndex, setUploadingShotIndex] = useState<number | null>(null);

  const handleImportShotMedia = async (slotIndex: number, file?: File | null) => {
    if (!file) return;
    const isImage = file.type.startsWith('image/');
    setUploadingShotIndex(slotIndex);
    try {
      const url = await uploadEditorFile(file, isImage ? 'image' : 'video');
      const currentShots = (videoStyle?.custom_shots || []).filter((s) => s.slot_index !== slotIndex);
      const updatedShots = [
        ...currentShots,
        {
          slot_index: slotIndex,
          media_kind: (isImage ? 'image' : 'video') as 'image' | 'video',
          url,
          name: file.name,
        },
      ];
      setStyleField({ custom_shots: updatedShots });
      toast.success(`Toma ${slotIndex + 1} actualizada con éxito.`);
    } catch (e: any) {
      toast.error(e?.message || `No se pudo subir archivo para la Toma ${slotIndex + 1}`);
    } finally {
      setUploadingShotIndex(null);
    }
  };

  const handleResetShot = (slotIndex: number) => {
    const updatedShots = (videoStyle?.custom_shots || []).filter((s) => s.slot_index !== slotIndex);
    setStyleField({ custom_shots: updatedShots });
    toast.success(`Toma ${slotIndex + 1} restablecida al contenido automático.`);
  };



  // Referencias siempre-actuales para poder comparar contra lo nuevo sin que
  // el closure de fetchNews quede con el estado "stale" de cuando se creó.
  const rawNewsRef = useRef<RawNews[]>(rawNews);
  const processedNewsRef = useRef<ProcessedNews[]>(processedNews);
  useEffect(() => { rawNewsRef.current = rawNews; }, [rawNews]);
  useEffect(() => { processedNewsRef.current = processedNews; }, [processedNews]);
  const isModalOpenRef = useRef<boolean>(false);
  useEffect(() => { isModalOpenRef.current = selectedItem !== null; }, [selectedItem]);
  const idsKey = (items: Array<{ id: string }>) => items.map((i) => i.id).sort().join(',');

  // background=true (usado por el polling automático) nunca pisa lo que el
  // usuario está viendo: si hay noticias nuevas/distintas las deja en
  // `pendingNews` para que el botón "Noticias nuevas" las aplique.
  const fetchNews = async (background = false) => {
    if (!background) setLoading(true);

    const [rawResult, procResult] = await Promise.all([
      fetchFromEngine<{ items: RawNews[] }>('/api/news/raw', { cache: 'no-store' }),
      fetchFromEngine<{ items: ProcessedNews[] }>('/api/news/processed', { cache: 'no-store' }),
    ]);

    const nextRaw = rawResult.ok ? rawResult.data.items || [] : null;
    const nextProc = procResult.ok ? procResult.data.items || [] : null;

    if (background) {
      if (nextRaw && nextProc) {
        const changed =
          idsKey(nextRaw) !== idsKey(rawNewsRef.current) ||
          idsKey(nextProc) !== idsKey(processedNewsRef.current);
        if (changed) setPendingNews({ raw: nextRaw, processed: nextProc });
      }
    } else {
      if (nextRaw) setRawNews(nextRaw);
      if (nextProc) setProcessedNews(nextProc);
      setPendingNews(null);
    }

    // Solo mostramos el banner de "Engine no disponible" cuando el Engine es
    // inalcanzable (fetch falló), no ante un simple error HTTP puntual.
    const offlineResult = !rawResult.ok && rawResult.offline
      ? rawResult
      : !procResult.ok && procResult.offline
        ? procResult
        : null;
    if (!background) setEngineError(offlineResult ? offlineResult.error : null);

    if (!background) setLoading(false);
  };

  const applyPendingNews = () => {
    if (!pendingNews) return;
    setRawNews(pendingNews.raw);
    setProcessedNews(pendingNews.processed);
    setPendingNews(null);
  };

  useEffect(() => {
    fetchNews();
    const interval = setInterval(() => fetchNews(true), NEWS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const handleManualPoll = async () => {
    try {
      const res = await fetch(`${ENGINE_URL}/api/news/poll`, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`No se pudo iniciar el sondeo (${res.status})`);
      }
      // Con el modal abierto el resultado queda pendiente (botón "Noticias nuevas");
      // se lee el ref al disparar el timeout porque el modal pudo abrirse en esos 2s.
      setTimeout(() => fetchNews(isModalOpenRef.current), 2000);
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
    resetVideoEditor(item.processed?.video_direction, item.processed?.video_style);
    const isPA = item.raw?.source_id === 'prensa-abierta';
    const srcName = item.raw?.source_name || 'Fuente externa';
    const defaultText = isPA
      ? 'Nota elaborada por el equipo editorial de Prensa Abierta'
      : `Información recopilada y adaptada a partir del reporte original publicado por ${srcName}`;
    setCiteSource(!isPA);
    setCitationText(defaultText);
    setCitationLinkText('Ver fuente original');
    setIncludeCitationLink(Boolean(item.raw?.original_url && !isPA));
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
        await fetchNews(true);
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
  // Cuerpo que se locuta en el video: la nota redactada, o el original si aún no se redactó.
  const modalBody = useMemo(
    () => selectedItem?.processed?.content_html || selectedItem?.raw?.content || selectedItem?.raw?.summary || '',
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
      body: modalBody,
      background: compBase,
      template: videoTemplate,
      customImageUrl: compBase === 'image' ? customImage?.url : undefined,
      customClipUrl: compBase === 'video' ? customClip?.url : undefined,
      // Capa 3: la dirección de la IA alimenta duración y queries de Pexels en
      // /api/render-video (base/plantilla ya van arriba, derivadas de ella).
      videoDirection: selectedItem.processed?.video_direction,
      // Overrides granulares del "Estilo del titular" (debounced): un cambio a
      // medio hacer (arrastrando un slider) no dispara un render todavía.
      style: committedVideoStyle || undefined,
      // Locución personalizada por el usuario (debounced):
      voiceText: committedVoiceText.trim() ? committedVoiceText.trim() : undefined,
    };
  }, [
    selectedItem,
    modalHeadline,
    modalVideoId,
    modalVideoCategory,
    modalFeaturedImage,
    modalBody,
    compBase,
    videoTemplate,
    customImage,
    customClip,
    committedVideoStyle,
    committedVoiceText,
  ]);

  const videoRenderState = getRenderState(videoRenderParams);

  // Indica si hay cambios de estilo o locución pendientes de renderizar en el MP4
  const isVideoStyleDirty = useMemo(() => {
    return (
      JSON.stringify(videoStyle || {}) !== JSON.stringify(committedVideoStyle || {}) ||
      customVoiceText.trim() !== committedVoiceText.trim()
    );
  }, [videoStyle, committedVideoStyle, customVoiceText, committedVoiceText]);

  // Maneja la descarga del video real garantizando que SIEMPRE corresponda a los
  // ajustes visuales y de texto activos en la pantalla (nunca descarga un .mp4 desactualizado).
  const handleDownloadRealVideo = async (title: string, directUrl?: string) => {
    if (isDownloadingVideo) return;
    setIsDownloadingVideo(true);

    try {
      const isDirty = (
        JSON.stringify(videoStyle || {}) !== JSON.stringify(committedVideoStyle || {}) ||
        customVoiceText.trim() !== committedVoiceText.trim()
      );

      let finalUrl = directUrl;

      // Si hay ajustes visuales recién modificados o el render aún no está listo,
      // compilamos inmediatamente el video con los parámetros actuales exactos.
      if (isDirty || videoRenderState.status !== 'ready' || !finalUrl) {
        toast.loading('Generando video en alta definición con los últimos ajustes...', { id: 'download-video-toast' });
        setCommittedVideoStyle(videoStyle);
        setCommittedVoiceText(customVoiceText);

        const currentParams = videoRenderParams
          ? {
              ...videoRenderParams,
              style: videoStyle || undefined,
              voiceText: customVoiceText.trim() ? customVoiceText.trim() : undefined,
            }
          : null;

        if (!currentParams) {
          toast.error('No se pudo determinar los parámetros del video.', { id: 'download-video-toast' });
          return;
        }

        finalUrl = (await forceRender(currentParams)) || undefined;
      }

      if (!finalUrl) {
        toast.error('No se pudo procesar el video. Intenta nuevamente.', { id: 'download-video-toast' });
        return;
      }

      const downloadUrl = finalUrl.replace('inline=1', 'download=1');
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `prensa-abierta-${title
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .slice(0, 40)}.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('¡Video descargado con éxito!', { id: 'download-video-toast' });
    } catch (err: any) {
      console.error('Error al descargar video:', err);
      toast.error('Error al descargar el video.', { id: 'download-video-toast' });
    } finally {
      setIsDownloadingVideo(false);
    }
  };

  // Dispara el render real (Go Engine) apenas hay noticia abierta, y de nuevo
  // cada vez que cambian los ajustes del "Editor de video" — así el preview
  // siempre termina mostrando (y la descarga usando) el mismo .mp4.
  useEffect(() => {
    if (!videoRenderParams) return;
    // Solo se renderiza la pieza YA redactada. Antes también se renderizaba la noticia
    // cruda (openModal({ raw }) al empezar "Redactar") y otra vez al terminar la IA
    // (cambian titular/cuerpo/dirección → clave nueva): 1 nota = 2 renders = 2 videos
    // descontados de la cuota diaria. Tampoco mientras la IA está redactando.
    if (!selectedItem?.processed || isGenerating) return;
    // No disparar mientras se sube un archivo importado: evita renderizar con
    // datos a medio subir.
    if (uploadingMedia) return;
    ensureRendered(videoRenderParams);
  }, [videoRenderParams, selectedItem, isGenerating, uploadingMedia, ensureRendered]);

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
      fetchNews(true);
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
            Ingestión en tiempo real de <strong>10 medios de Puerto Rico</strong> (El Nuevo Día, Primera Hora, El Vocero, NotiCel, Metro PR, La Perla del Sur, Telemundo PR, WAPA, Radio Isla y El Calce) para producción autónoma.
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
              <option value="glm-5.2">GLM 5.2</option>
              <option value="minimax-m3">MiniMax M3</option>
              <option value="qwen3.5:397b">Qwen 3.5 397B</option>
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

          {/* Aparece solo cuando el polling en background detectó noticias
              nuevas/distintas: el usuario decide cuándo refrescar la lista
              en vez de que salte sola (p.ej. mientras lee una nota). */}
          {pendingNews && (
            <button
              onClick={applyPendingNews}
              className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black shadow-md shadow-emerald-500/20 transition active:scale-95 animate-pulse"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Noticias nuevas — Actualizar</span>
            </button>
          )}
        </div>
      </div>

      {/* Estado explícito cuando el Go Engine no responde (evita confundirlo con "sin noticias") */}
      {engineError && (
        <EngineOfflineBanner message={engineError} onRetry={() => fetchNews()} retrying={loading} />
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
          {/* Source Filter: dropdown (mismo criterio que Categoría) — con 10 medios una
              fila de botones forzaba scroll horizontal. */}
          <div className="flex items-center gap-2 bg-slate-50 px-3.5 py-2 rounded-2xl border border-slate-200 text-xs shrink-0">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-slate-600 font-bold">Fuente:</span>
            <select
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
              className="bg-transparent font-bold text-slate-800 focus:outline-none cursor-pointer"
            >
              {NEWS_SOURCE_FILTER_OPTIONS.map((src) => (
                <option key={src.id} value={src.id}>
                  {src.label}
                </option>
              ))}
            </select>
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
          {paginatedNews.map((item, index) => {
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
                    <CardImage
                      src={item.image_url}
                      alt={item.title}
                      eager={index < EAGER_IMAGE_CARDS}
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                    />
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
                    <RelatedCoverageStack sources={item.related_sources} />
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="p-5 border-t border-slate-100 mt-2 flex items-center justify-between gap-2">
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
                {/* Banner moderno no intrusivo mientras la IA redacta */}
                {isGenerating && (
                  <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-orange-200/80 bg-orange-50/95 backdrop-blur-md px-4 py-2.5 text-xs shadow-sm animate-fadeIn">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-tr from-[#FF5500] to-amber-400 text-white shadow-sm shadow-orange-500/30">
                        <Sparkles className="h-3.5 w-3.5 animate-spin" />
                      </span>
                      <div>
                        <p className="font-black text-slate-900 leading-tight">
                          Generando Reel con IA ({selectedModel})
                        </p>
                        <p className="text-[11px] font-medium text-slate-600 line-clamp-1">
                          {generationStep || 'Redactando noticia y preparando video 9:16...'}
                        </p>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 border border-orange-200 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#FF5500]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#FF5500] animate-ping" /> En progreso
                    </span>
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
                            duration={selectedItem?.processed?.video_direction?.duration_sec || 12}
                            newsId={videoId}
                            mediaKind={compBase}
                            mediaUrl={compBase === 'image' ? customImage?.url : customClip?.url}
                            renderState={videoRenderState}
                            onRetryRender={() => ensureRendered(videoRenderParams)}
                            interactive={true}
                            style={committedVideoStyle || videoStyle}
                            isDirty={isVideoStyleDirty}
                            isGenerating={isGenerating}
                            generationStep={generationStep}
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

                        {/* 3.5 · También lo publicaron (otros medios de los 5 scrapeados) */}
                        <RelatedCoverageRow sources={raw?.related_sources} />
                      </>
                    )}

                    {/* 3.8 · Control editable para citar la fuente original */}
                    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm space-y-3.5">
                      {/* Cabecera con interruptor principal */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100 text-[#FF5500] shadow-sm">
                            <Quote className="h-4.5 w-4.5" />
                          </div>
                          <div>
                            <p className="text-xs font-black text-slate-800">
                              Citar fuente original {sourceName ? `(${sourceName})` : ''}
                            </p>
                            <p className="text-[11px] font-medium text-slate-500">
                              {raw?.source_id === 'prensa-abierta'
                                ? 'Nota propia de Prensa Abierta (atribución interna de autoría)'
                                : 'Añade crédito periodístico ético y enlace editable al pie de la nota'}
                            </p>
                          </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={citeSource}
                            onChange={(e) => handleToggleCiteSource(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-10 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#FF5500]"></div>
                        </label>
                      </div>

                      {/* Configuración editable cuando el switch está activado */}
                      {citeSource && (
                        <div className="pt-2 border-t border-slate-100 space-y-3 animate-fadeIn">
                          {/* Campo editable: Texto de la atribución */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-bold text-slate-700 flex items-center justify-between">
                              <span>Texto de atribución:</span>
                              <span className="text-[10px] text-slate-400 font-semibold">Editable</span>
                            </label>
                            <input
                              type="text"
                              value={citationText}
                              onChange={(e) => handleUpdateCitationText(e.target.value)}
                              placeholder="Ej: Con información de El Vocero..."
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:outline-none focus:border-[#FF5500] focus:bg-white transition"
                            />
                          </div>

                          {/* Campo editable: Texto del enlace e inclusión del link */}
                          {raw?.original_url && raw.source_id !== 'prensa-abierta' && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                              <div className="space-y-1">
                                <label className="text-[11px] font-bold text-slate-700 flex items-center justify-between">
                                  <span>Texto del enlace:</span>
                                  <span className="text-[10px] text-slate-400 font-semibold">Editable</span>
                                </label>
                                <input
                                  type="text"
                                  value={citationLinkText}
                                  onChange={(e) => handleUpdateCitationLinkText(e.target.value)}
                                  disabled={!includeCitationLink}
                                  placeholder="Ej: Ver fuente original"
                                  className={`w-full border rounded-xl px-3.5 py-2 text-xs transition ${
                                    includeCitationLink
                                      ? 'bg-slate-50 border-slate-200 text-slate-800 focus:outline-none focus:border-[#FF5500] focus:bg-white'
                                      : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                                  }`}
                                />
                              </div>

                              <div className="flex flex-col justify-end">
                                <label className="flex items-center gap-2 p-2 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer hover:bg-slate-100 transition text-xs font-semibold text-slate-700">
                                  <input
                                    type="checkbox"
                                    checked={includeCitationLink}
                                    onChange={(e) => handleToggleIncludeLink(e.target.checked)}
                                    className="rounded text-[#FF5500] focus:ring-[#FF5500]"
                                  />
                                  <span className="text-[11px]">Incluir hipervínculo web a la nota</span>
                                </label>
                              </div>
                            </div>
                          )}

                          {/* Vista previa en vivo del pie de nota */}
                          <div className="rounded-xl bg-orange-50/70 border border-orange-200/80 p-2.5 text-xs text-slate-700 italic">
                            <span className="font-bold not-italic text-[#FF5500] text-[10px] uppercase tracking-wider block mb-0.5">
                              Vista previa del pie de nota:
                            </span>
                            {citationText}{' '}
                            {includeCitationLink && raw?.original_url ? (
                              <a
                                href={raw.original_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Abrir fuente original en nueva pestaña"
                                className="text-[#FF5500] hover:text-[#E04B00] underline font-bold not-italic inline-flex items-center gap-0.5 cursor-pointer transition ml-1"
                              >
                                <span>({citationLinkText || 'Ver fuente original'})</span>
                                <ExternalLink className="w-3 h-3 inline" />
                              </a>
                            ) : null}.
                          </div>
                        </div>
                      )}
                    </div>

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

                {/* --- Tab: Editor de video (Modo Estudio en Tiempo Real) --- */}
                {modalTab === 'video' && (() => {
                  const defaultVoiceScript = buildVoiceScript({
                    headline: displayTitle,
                    category: modalVideoCategory,
                    body: displayBody,
                    durationSec: selectedItem?.processed?.video_direction?.duration_sec || 12,
                  });
                  const effectiveVoiceText = customVoiceText !== '' ? customVoiceText : (defaultVoiceScript?.text || '');
                  const effectiveWords = effectiveVoiceText.trim() ? effectiveVoiceText.trim().split(/\s+/).filter(Boolean).length : 0;
                  const targetBudgetWords = defaultVoiceScript?.budgetWords || Math.floor((selectedItem?.processed?.video_direction?.duration_sec || 12) * 2.3);

                  return (
                    <div className="mx-auto max-w-7xl px-3 py-5 sm:px-6">
                      {/* Cabecera del Estudio */}
                      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 text-[#FF5500]">
                            <Clapperboard className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h2 className="text-sm font-black text-slate-900">
                                Estudio de Video Reel 9:16
                              </h2>
                              <span className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10.5px] font-bold text-emerald-700">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                En vivo 60 FPS
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500">
                              Personaliza tipografía, colores, rótulo y medios con respuesta visual instantánea.
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => loadTemplateStyleDefaults(videoTemplate)}
                            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                          >
                            Restaurar plantilla
                          </button>
                        </div>
                      </div>

                      {/* Layout de 2 Columnas: Izquierda Mockup Fijo / Derecha Ajustes */}
                      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
                        {/* ── Columna Izquierda: Phone Mockup Sticky (Siempre visible) ── */}
                        <div className="flex flex-col items-center gap-4 lg:sticky lg:top-4 lg:col-span-5">
                          <div className="flex w-full flex-col items-center rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="mb-3 flex w-full items-center justify-between">
                              <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
                                <Eye className="h-3.5 w-3.5 text-[#FF5500]" /> Vista en vivo
                              </span>
                              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-mono font-bold text-slate-500">
                                1080 × 1920
                              </span>
                            </div>

                            <VideoPlayerPreview
                              title={displayTitle}
                              category={modalVideoCategory}
                              template={videoTemplate}
                              duration={selectedItem?.processed?.video_direction?.duration_sec || 12}
                              newsId={videoId}
                              mediaKind={compBase}
                              mediaUrl={compBase === 'image' ? customImage?.url : customClip?.url}
                              renderState={videoRenderState}
                              onRetryRender={() => ensureRendered(videoRenderParams)}
                              interactive={true}
                              style={videoStyle}
                              isDirty={isVideoStyleDirty}
                              width={220}
                              isGenerating={isGenerating}
                              generationStep={generationStep}
                            />

                            <div className="mt-4 flex w-full flex-col gap-2 border-t border-slate-100 pt-3 text-center">
                              <p className="text-[11px] text-slate-500">
                                Fondo activo:{' '}
                                <strong className="text-slate-700">
                                  {compBase === 'image'
                                    ? customImage
                                      ? `Imagen subida (${customImage.name})`
                                      : 'Imagen destacada de la noticia'
                                    : customClip
                                      ? `Video subido (${customClip.name})`
                                      : `Clip automático · ${modalVideoCategory}`}
                                </strong>
                              </p>

                              {/* Estado del render en segundo plano */}
                              {/* Estado del render en segundo plano */}
                              {isVideoStyleDirty ? (
                                <div className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-[10.5px] font-bold text-amber-700">
                                  <RefreshCw className="h-3.5 w-3.5 text-amber-600" />
                                  <span>Ajustes pendientes de compilar en MP4</span>
                                </div>
                              ) : videoRenderState.status === 'ready' ? (
                                <div className="flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10.5px] font-bold text-emerald-700">
                                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                                  <span>MP4 con voz listo para descarga</span>
                                </div>
                              ) : videoRenderState.status === 'rendering' ? (
                                <div className="flex items-center justify-center gap-1.5 rounded-xl border border-orange-200 bg-orange-50 px-3 py-1.5 text-[10.5px] font-bold text-orange-700 animate-pulse">
                                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-[#FF5500]" />
                                  <span>Compilando MP4 con voz en segundo plano...</span>
                                </div>
                              ) : null}

                              {/* Botón directo para regenerar y forzar MP4 nuevo */}
                              <button
                                type="button"
                                disabled={videoRenderState.status === 'rendering' || isDownloadingVideo}
                                onClick={async () => {
                                  toast.loading('Generando renderizado fresco con FFmpeg...', { id: 'render-toast' });
                                  setCommittedVideoStyle(videoStyle);
                                  setCommittedVoiceText(customVoiceText);
                                  const currentParams = videoRenderParams
                                    ? {
                                        ...videoRenderParams,
                                        style: videoStyle || undefined,
                                        voiceText: customVoiceText.trim() ? customVoiceText.trim() : undefined,
                                      }
                                    : null;
                                  const res = await forceRender(currentParams);
                                  if (res) {
                                    toast.success('Video actualizado con éxito.', { id: 'render-toast' });
                                  } else {
                                    toast.error('Error al actualizar el video.', { id: 'render-toast' });
                                  }
                                }}
                                className={`mt-1 flex w-full items-center justify-center gap-2 rounded-xl py-2 text-xs font-bold transition active:scale-95 ${
                                  videoRenderState.status === 'rendering' || isDownloadingVideo
                                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                                    : 'bg-slate-900 text-white hover:bg-black border border-slate-800 shadow-sm'
                                }`}
                              >
                                <RefreshCw className={`h-3.5 w-3.5 ${videoRenderState.status === 'rendering' || isDownloadingVideo ? 'animate-spin text-[#FF5500]' : 'text-orange-400'}`} />
                                <span>{videoRenderState.status === 'rendering' || isDownloadingVideo ? 'Renderizando nuevo video...' : '🔄 Actualizar Video (Forzar MP4)'}</span>
                              </button>

                              {/* Botón directo de descarga en la columna del mockup */}
                              <button
                                disabled={videoRenderState.status === 'rendering' || isDownloadingVideo}
                                onClick={() => handleDownloadRealVideo(displayTitle, isVideoStyleDirty ? undefined : videoRenderState.url)}
                                className={`mt-1 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-black text-white shadow-md transition active:scale-95 ${
                                  videoRenderState.status === 'rendering' || isDownloadingVideo
                                    ? 'bg-slate-300 cursor-not-allowed'
                                    : 'bg-gradient-to-r from-[#FF5500] to-[#FF7700] hover:from-[#E04B00] hover:to-[#FF6600] shadow-orange-500/20'
                                }`}
                              >
                                {videoRenderState.status === 'rendering' || isDownloadingVideo ? (
                                  <>
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                    <span>Generando descarga...</span>
                                  </>
                                ) : isVideoStyleDirty ? (
                                  <>
                                    <Download className="h-4 w-4" />
                                    <span>Actualizar &amp; Descargar (.mp4)</span>
                                  </>
                                ) : (
                                  <>
                                    <Download className="h-4 w-4" />
                                    <span>Descargar Video (.mp4)</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* ── Columna Derecha: Panel de Ajustes por Pestañas ── */}
                        <div className="space-y-4 lg:col-span-7">
                          {/* Barra de Sub-pestañas */}
                          <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
                            <button
                              type="button"
                              onClick={() => setVideoStudioTab('typography')}
                              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition ${
                                videoStudioTab === 'typography'
                                  ? 'bg-[#FF5500] text-white shadow-sm'
                                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                              }`}
                            >
                              <Type className="h-3.5 w-3.5" />
                              <span>Tipografía &amp; Cintillo</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setVideoStudioTab('template')}
                              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition ${
                                videoStudioTab === 'template'
                                  ? 'bg-[#FF5500] text-white shadow-sm'
                                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                              }`}
                            >
                              <LayoutTemplate className="h-3.5 w-3.5" />
                              <span>Plantilla</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setVideoStudioTab('media')}
                              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition ${
                                videoStudioTab === 'media'
                                  ? 'bg-[#FF5500] text-white shadow-sm'
                                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                              }`}
                            >
                              <ImageIcon className="h-3.5 w-3.5" />
                              <span>Fondo &amp; Medios</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setVideoStudioTab('voice')}
                              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition ${
                                videoStudioTab === 'voice'
                                  ? 'bg-[#FF5500] text-white shadow-sm'
                                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                              }`}
                            >
                              <Mic className="h-3.5 w-3.5" />
                              <span>Locución IA</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setVideoStudioTab('presets')}
                              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition ${
                                videoStudioTab === 'presets'
                                  ? 'bg-[#FF5500] text-white shadow-sm'
                                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                              }`}
                            >
                              <Palette className="h-3.5 w-3.5" />
                              <span>Presets</span>
                            </button>
                          </div>

                          {/* Sub-pestaña 1: Tipografía & Cintillo */}
                          {videoStudioTab === 'typography' && (
                            <div className="space-y-4">
                              {!videoStyle ? (
                                <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
                                  Cargando valores de la plantilla...
                                </div>
                              ) : (
                                <>
                                  {/* 1 · Contenido del Titular (Edición Granular Tipo Canva) */}
                                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
                                    <div className="flex items-center justify-between">
                                      <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
                                        <Edit3 className="h-3.5 w-3.5 text-[#FF5500]" /> Contenido del Titular (Tipo Canva)
                                      </span>
                                      {videoStyle.headline_text && videoStyle.headline_text !== displayTitle && (
                                        <button
                                          type="button"
                                          onClick={() => setStyleField({ headline_text: displayTitle })}
                                          className="text-[10.5px] text-orange-600 hover:underline flex items-center gap-1 font-bold"
                                        >
                                          <RotateCcw className="w-3 h-3" /> Restaurar titular original
                                        </button>
                                      )}
                                    </div>
                                    <textarea
                                      rows={3}
                                      value={videoStyle.headline_text ?? displayTitle}
                                      onChange={(e) => setStyleField({ headline_text: e.target.value })}
                                      placeholder="Escribe el titular aquí..."
                                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs font-bold text-slate-800 focus:border-[#FF5500] focus:bg-white focus:outline-none transition"
                                    />
                                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                                      <span>💡 <strong>Consejo Canva:</strong> puedes pulsar <strong>Enter</strong> para decidir exactamente dónde cortar cada línea.</span>
                                      <span className="font-mono">{(videoStyle.headline_text ?? displayTitle).length} car.</span>
                                    </div>
                                  </div>

                                  {/* 2 · Fuente, Alineación y Formato */}
                                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                                    <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
                                      <Type className="h-3.5 w-3.5 text-[#FF5500]" /> Fuente, Alineación & Posición
                                    </span>
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                      <div>
                                        <label className="mb-1 block text-[11px] font-bold text-slate-600">
                                          Fuente del titular
                                        </label>
                                        <select
                                          value={videoStyle.headline_font || 'classic'}
                                          onChange={(e) =>
                                            setStyleField({ headline_font: e.target.value as VideoStyle['headline_font'] })
                                          }
                                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 bg-white focus:outline-none focus:border-[#FF5500]"
                                        >
                                          <option value="classic">Clásica (Sans-serif limpia)</option>
                                          <option
                                            value="league_spartan"
                                            style={{ fontFamily: 'var(--font-league-spartan)' }}
                                          >
                                            League Spartan (Identidad Prensa Abierta)
                                          </option>
                                        </select>
                                      </div>

                                      {/* Segmented align control (Tipo Canva) */}
                                      <div>
                                        <label className="mb-1 block text-[11px] font-bold text-slate-600">
                                          Alineación del texto (Canva)
                                        </label>
                                        <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
                                          <button
                                            type="button"
                                            onClick={() => setStyleField({ headline_align: 'left' })}
                                            className={`flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-bold transition ${
                                              (videoStyle.headline_align || 'left') === 'left'
                                                ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                                                : 'text-slate-500 hover:text-slate-800'
                                            }`}
                                          >
                                            <AlignLeft className="w-3.5 h-3.5" />
                                            <span>Izq</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setStyleField({ headline_align: 'center' })}
                                            className={`flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-bold transition ${
                                              videoStyle.headline_align === 'center'
                                                ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                                                : 'text-slate-500 hover:text-slate-800'
                                            }`}
                                          >
                                            <AlignCenter className="w-3.5 h-3.5" />
                                            <span>Centro</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setStyleField({ headline_align: 'right' })}
                                            className={`flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-bold transition ${
                                              videoStyle.headline_align === 'right'
                                                ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                                                : 'text-slate-500 hover:text-slate-800'
                                            }`}
                                          >
                                            <AlignRight className="w-3.5 h-3.5" />
                                            <span>Der</span>
                                          </button>
                                        </div>
                                      </div>

                                      <div>
                                        <div className="flex items-center justify-between mb-1">
                                          <label className="text-[11px] font-bold text-slate-600">
                                            Tamaño de letra
                                          </label>
                                          <span className="text-[11px] font-mono font-bold text-[#FF5500] bg-orange-50 px-1.5 py-0.5 rounded">
                                            {videoStyle.headline_font_size ?? 46}px
                                          </span>
                                        </div>
                                        <input
                                          type="range"
                                          min={24}
                                          max={72}
                                          value={videoStyle.headline_font_size ?? 46}
                                          onChange={(e) => setStyleField({ headline_font_size: Number(e.target.value) })}
                                          className="w-full accent-[#FF5500] cursor-pointer"
                                        />
                                      </div>

                                      <div>
                                        <label className="mb-1 block text-[11px] font-bold text-slate-600">
                                          Color del titular
                                        </label>
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="color"
                                            value={videoStyle.headline_color || '#FFFFFF'}
                                            onChange={(e) => setStyleField({ headline_color: e.target.value })}
                                            className="h-9 w-14 cursor-pointer rounded-xl border border-slate-200 p-0.5"
                                          />
                                          <input
                                            type="text"
                                            value={videoStyle.headline_color || '#FFFFFF'}
                                            onChange={(e) => setStyleField({ headline_color: e.target.value })}
                                            className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-mono font-bold text-slate-700 uppercase"
                                          />
                                        </div>
                                      </div>

                                      <div>
                                        <div className="flex items-center justify-between mb-1">
                                          <label className="text-[11px] font-bold text-slate-600">
                                            Interlineado (Espaciado de líneas)
                                          </label>
                                          <span className="text-[11px] font-mono font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                                            {videoStyle.headline_line_spacing ?? 18}px
                                          </span>
                                        </div>
                                        <input
                                          type="range"
                                          min={0}
                                          max={60}
                                          value={videoStyle.headline_line_spacing ?? 18}
                                          onChange={(e) => setStyleField({ headline_line_spacing: Number(e.target.value) })}
                                          className="w-full accent-[#FF5500] cursor-pointer"
                                        />
                                      </div>

                                      <div>
                                        <div className="flex items-center justify-between mb-1">
                                          <label className="text-[11px] font-bold text-slate-600">
                                            Margen lateral (Seguridad de bordes)
                                          </label>
                                          <span className="text-[11px] font-mono font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                                            {videoStyle.headline_x ?? 80}px
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-1.5 mb-1.5">
                                          <button
                                            type="button"
                                            onClick={() => setStyleField({ headline_x: 70 })}
                                            className="px-2 py-0.5 rounded bg-slate-100 text-[10px] font-bold hover:bg-slate-200 text-slate-700"
                                          >
                                            70px (Compacto)
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setStyleField({ headline_x: 90 })}
                                            className="px-2 py-0.5 rounded bg-orange-50 text-[10px] font-bold hover:bg-orange-100 text-orange-700 border border-orange-200"
                                          >
                                            90px (Recomendado)
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setStyleField({ headline_x: 120 })}
                                            className="px-2 py-0.5 rounded bg-slate-100 text-[10px] font-bold hover:bg-slate-200 text-slate-700"
                                          >
                                            120px (Amplio)
                                          </button>
                                        </div>
                                        <input
                                          type="range"
                                          min={50}
                                          max={200}
                                          value={videoStyle.headline_x ?? 80}
                                          onChange={(e) => setStyleField({ headline_x: Number(e.target.value) })}
                                          className="w-full accent-[#FF5500] cursor-pointer"
                                        />
                                      </div>

                                      <div className="sm:col-span-2">
                                        <div className="flex items-center justify-between mb-1">
                                          <label className="text-[11px] font-bold text-slate-600">
                                            Posición vertical (desde el fondo)
                                          </label>
                                          <span className="text-[11px] font-mono font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                                            {videoStyle.headline_y ?? 370}px
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-1.5 mb-1.5">
                                          <button
                                            type="button"
                                            onClick={() => setStyleField({ headline_y: 370 })}
                                            className="px-2.5 py-1 rounded-lg bg-slate-100 text-[10.5px] font-bold hover:bg-slate-200 text-slate-700"
                                          >
                                            ⬇ Abajo (370px)
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setStyleField({ headline_y: 520 })}
                                            className="px-2.5 py-1 rounded-lg bg-slate-100 text-[10.5px] font-bold hover:bg-slate-200 text-slate-700"
                                          >
                                            ⬆ Subir Titular (520px)
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setStyleField({ headline_y: 680 })}
                                            className="px-2.5 py-1 rounded-lg bg-slate-100 text-[10.5px] font-bold hover:bg-slate-200 text-slate-700"
                                          >
                                            📱 Reels Safe (680px)
                                          </button>
                                        </div>
                                        <input
                                          type="range"
                                          min={150}
                                          max={1200}
                                          value={videoStyle.headline_y ?? 370}
                                          onChange={(e) => setStyleField({ headline_y: Number(e.target.value) })}
                                          className="w-full accent-[#FF5500] cursor-pointer"
                                        />
                                      </div>
                                    </div>
                                  </div>

                                  {/* Caja de Fondo */}
                                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                                    <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
                                      <Palette className="h-3.5 w-3.5 text-[#FF5500]" /> Caja de Fondo del Titular
                                    </span>
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                      <div>
                                        <label className="mb-1 block text-[11px] font-bold text-slate-600">
                                          Color de fondo
                                        </label>
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="color"
                                            value={videoStyle.box_color || '#000000'}
                                            onChange={(e) => setStyleField({ box_color: e.target.value })}
                                            className="h-9 w-14 cursor-pointer rounded-xl border border-slate-200 p-0.5"
                                          />
                                          <input
                                            type="text"
                                            value={videoStyle.box_color || '#000000'}
                                            onChange={(e) => setStyleField({ box_color: e.target.value })}
                                            className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-mono font-bold text-slate-700 uppercase"
                                          />
                                        </div>
                                      </div>

                                      <div>
                                        <div className="flex items-center justify-between mb-1">
                                          <label className="text-[11px] font-bold text-slate-600">
                                            Opacidad
                                          </label>
                                          <span className="text-[11px] font-mono font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                                            {Math.round((videoStyle.box_opacity ?? 0.85) * 100)}%
                                          </span>
                                        </div>
                                        <input
                                          type="range"
                                          min={0}
                                          max={100}
                                          value={Math.round((videoStyle.box_opacity ?? 0.85) * 100)}
                                          onChange={(e) => setStyleField({ box_opacity: Number(e.target.value) / 100 })}
                                          className="w-full accent-[#FF5500] cursor-pointer"
                                        />
                                      </div>
                                    </div>
                                  </div>

                                  {/* Rótulo Superior */}
                                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                                    <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
                                      <Sliders className="h-3.5 w-3.5 text-[#FF5500]" /> Rótulo Superior ("ÚLTIMA HORA • CATEGORÍA")
                                    </span>
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr]">
                                      <div>
                                        <label className="mb-1 block text-[11px] font-bold text-slate-600">
                                          Texto del rótulo (vacío = automático)
                                        </label>
                                        <input
                                          type="text"
                                          value={videoStyle.header_text ?? ''}
                                          placeholder={`ULTIMA HORA  •  ${modalVideoCategory.toUpperCase()}`}
                                          onChange={(e) => setStyleField({ header_text: e.target.value })}
                                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:border-[#FF5500]"
                                        />
                                      </div>
                                      <div>
                                        <label className="mb-1 block text-[11px] font-bold text-slate-600">
                                          Color del rótulo
                                        </label>
                                        <input
                                          type="color"
                                          value={videoStyle.header_color || '#FFAA00'}
                                          onChange={(e) => setStyleField({ header_color: e.target.value })}
                                          className="h-9 w-full cursor-pointer rounded-xl border border-slate-200 p-0.5"
                                        />
                                      </div>
                                    </div>
                                  </div>

                                  {/* Logo y Banner App */}
                                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                                    <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
                                      <CheckCircle2 className="h-3.5 w-3.5 text-[#FF5500]" /> Marca Prensa Abierta &amp; Promoción
                                    </span>

                                    {/* Logo */}
                                    <div className="space-y-3 border-b border-slate-100 pb-3">
                                      <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={videoStyle.show_logo ?? true}
                                          onChange={(e) => setStyleField({ show_logo: e.target.checked })}
                                          className="h-4 w-4 accent-[#FF5500] rounded"
                                        />
                                        Mostrar logo oficial de Prensa Abierta
                                      </label>
                                      {(videoStyle.show_logo ?? true) && (
                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-1">
                                          <div>
                                            <div className="flex items-center justify-between mb-1">
                                              <label className="text-[11px] font-bold text-slate-600">
                                                Tamaño del logo
                                              </label>
                                              <span className="text-[11px] font-mono font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                                                {videoStyle.logo_size ?? 240}px
                                              </span>
                                            </div>
                                            <input
                                              type="range"
                                              min={60}
                                              max={500}
                                              value={videoStyle.logo_size ?? 240}
                                              onChange={(e) => setStyleField({ logo_size: Number(e.target.value) })}
                                              className="w-full accent-[#FF5500] cursor-pointer"
                                            />
                                          </div>
                                          <div>
                                            <div className="flex items-center justify-between mb-1">
                                              <label className="text-[11px] font-bold text-slate-600">
                                                Posición vertical del logo (Y)
                                              </label>
                                              <span className="text-[11px] font-mono font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                                                {videoStyle.logo_y ?? 92}px
                                              </span>
                                            </div>
                                            <input
                                              type="range"
                                              min={0}
                                              max={1920}
                                              value={videoStyle.logo_y ?? 92}
                                              onChange={(e) => setStyleField({ logo_y: Number(e.target.value) })}
                                              className="w-full accent-[#FF5500] cursor-pointer"
                                            />
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    {/* Banner App */}
                                    <div className="space-y-3">
                                      <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={videoStyle.show_promo ?? false}
                                          onChange={(e) => setStyleField({ show_promo: e.target.checked })}
                                          className="h-4 w-4 accent-[#FF5500] rounded"
                                        />
                                        Mostrar banner "Descarga la App GRATIS"
                                      </label>
                                      {videoStyle.show_promo && (
                                        <div className="pt-1">
                                          <div className="flex items-center justify-between mb-1">
                                            <label className="text-[11px] font-bold text-slate-600">
                                              Ancho del banner
                                            </label>
                                            <span className="text-[11px] font-mono font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                                              {videoStyle.promo_width ?? 560}px
                                            </span>
                                          </div>
                                          <input
                                            type="range"
                                            min={280}
                                            max={860}
                                            value={videoStyle.promo_width ?? 560}
                                            onChange={(e) => setStyleField({ promo_width: Number(e.target.value) })}
                                            className="w-full accent-[#FF5500] cursor-pointer"
                                          />
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          )}

                          {/* Sub-pestaña 2: Plantilla */}
                          {videoStudioTab === 'template' && (
                            <div className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                              <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
                                <LayoutTemplate className="h-3.5 w-3.5 text-[#FF5500]" /> Plantilla de Formato Reel 9:16
                              </span>
                              <div className="grid grid-cols-1 gap-3">
                                <button
                                  type="button"
                                  onClick={() => applyTemplate('standard')}
                                  className={`rounded-2xl border p-4 text-left transition ${
                                    videoTemplate === 'standard'
                                      ? 'border-[#FF5500] bg-orange-50/50 ring-2 ring-[#FF5500]/30 shadow-sm'
                                      : 'border-slate-200 hover:border-slate-300 bg-white'
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="block text-xs font-black text-slate-900">
                                      Instagram Reels Estándar
                                    </span>
                                    {videoTemplate === 'standard' && (
                                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FF5500] text-white">
                                        Activa
                                      </span>
                                    )}
                                  </div>
                                  <span className="mt-1 block text-[11px] text-slate-500 leading-relaxed">
                                    Titular pegado al borde inferior del lienzo 9:16, máxima visibilidad en feeds completos.
                                  </span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => applyTemplate('reels-safe')}
                                  className={`rounded-2xl border p-4 text-left transition ${
                                    videoTemplate === 'reels-safe'
                                      ? 'border-[#FF5500] bg-orange-50/50 ring-2 ring-[#FF5500]/30 shadow-sm'
                                      : 'border-slate-200 hover:border-slate-300 bg-white'
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="block text-xs font-black text-slate-900">
                                      Cuadrícula Estándar de Publicación (Reels Safe Zone)
                                    </span>
                                    {videoTemplate === 'reels-safe' && (
                                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FF5500] text-white">
                                        Activa
                                      </span>
                                    )}
                                  </div>
                                  <span className="mt-1 block text-[11px] text-slate-500 leading-relaxed">
                                    Titular elevado al área central 1:1, logo más separado y los últimos ~15% inferiores totalmente libres para la UI de Instagram.
                                  </span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => applyTemplate('app-promo')}
                                  className={`rounded-2xl border p-4 text-left transition ${
                                    videoTemplate === 'app-promo'
                                      ? 'border-[#FF5500] bg-orange-50/50 ring-2 ring-[#FF5500]/30 shadow-sm'
                                      : 'border-slate-200 hover:border-slate-300 bg-white'
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="block text-xs font-black text-slate-900">
                                      Instagram Reels + Banner Descarga App
                                    </span>
                                    {videoTemplate === 'app-promo' && (
                                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FF5500] text-white">
                                        Activa
                                      </span>
                                    )}
                                  </div>
                                  <span className="mt-1 block text-[11px] text-slate-500 leading-relaxed">
                                    Titular posicionado con el banner "Descarga la App GRATIS" fijado justo debajo para campañas de captación.
                                  </span>
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Sub-pestaña 3: Fondo & Medios */}
                          {videoStudioTab === 'media' && (
                            <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                              <div>
                                <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
                                  <Clapperboard className="h-3.5 w-3.5 text-[#FF5500]" /> Base de la Composición Visual
                                </span>
                                <p className="mt-1 text-[11px] text-slate-500">
                                  Elige si el Reel inicia con imagen fotográfica (con zoom ken-burns) o un video clip b-roll de fondo.
                                </p>
                              </div>

                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <button
                                  type="button"
                                  onClick={() => setCompBase('image')}
                                  className={`rounded-2xl border p-4 text-left transition ${
                                    compBase === 'image'
                                      ? 'border-[#FF5500] bg-orange-50/50 ring-2 ring-[#FF5500]/30 shadow-sm'
                                      : 'border-slate-200 hover:border-slate-300 bg-white'
                                  }`}
                                >
                                  <span className="flex items-center gap-1.5 text-xs font-black text-slate-800">
                                    <ImageIcon className="h-3.5 w-3.5 text-[#FF5500]" /> Imagen fija (Foto)
                                  </span>
                                  <span className="mt-1 block text-[11px] text-slate-500">
                                    {customImage ? customImage.name : 'Imagen destacada de la noticia'}
                                  </span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => setCompBase('video')}
                                  className={`rounded-2xl border p-4 text-left transition ${
                                    compBase === 'video'
                                      ? 'border-[#FF5500] bg-orange-50/50 ring-2 ring-[#FF5500]/30 shadow-sm'
                                      : 'border-slate-200 hover:border-slate-300 bg-white'
                                  }`}
                                >
                                  <span className="flex items-center gap-1.5 text-xs font-black text-slate-800">
                                    <Film className="h-3.5 w-3.5 text-[#FF5500]" /> Video clip (B-Roll)
                                  </span>
                                  <span className="mt-1 block text-[11px] text-slate-500">
                                    {customClip ? customClip.name : `Clip de banco · ${modalVideoCategory}`}
                                  </span>
                                </button>
                              </div>

                              {/* Zona de Subida */}
                              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-5">
                                {compBase === 'image' ? (
                                  <div className="space-y-3">
                                    <div className="flex items-center gap-3">
                                      <label
                                        className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold text-white shadow-sm transition ${
                                          uploadingMedia === 'image'
                                            ? 'bg-slate-400 cursor-not-allowed'
                                            : 'bg-[#FF5500] hover:bg-[#E04B00] cursor-pointer'
                                        }`}
                                      >
                                        <Upload className="h-4 w-4" />
                                        <span>{uploadingMedia === 'image' ? 'Subiendo imagen...' : 'Importar imagen propia'}</span>
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
                                          type="button"
                                          onClick={() => setCustomImage(null)}
                                          className="text-xs font-bold text-slate-600 underline hover:text-slate-900"
                                        >
                                          Volver a la imagen original
                                        </button>
                                      )}
                                    </div>
                                    <p className="text-[11px] text-slate-500">
                                      Proporción recomendada: <strong className="font-mono text-slate-700">1080 × 1920 px (9:16)</strong>.
                                    </p>
                                  </div>
                                ) : (
                                  <div className="space-y-3">
                                    <div className="flex items-center gap-3">
                                      <label
                                        className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold text-white shadow-sm transition ${
                                          uploadingMedia === 'video' || uploadingMedia === 'image'
                                            ? 'bg-slate-400 cursor-not-allowed'
                                            : 'bg-[#FF5500] hover:bg-[#E04B00] cursor-pointer'
                                        }`}
                                      >
                                        <Upload className="h-4 w-4" />
                                        <span>
                                          {uploadingMedia === 'video'
                                            ? 'Subiendo video...'
                                            : uploadingMedia === 'image'
                                              ? 'Subiendo...'
                                              : 'Importar clip de video'}
                                        </span>
                                        <input
                                          type="file"
                                          accept="video/*,image/*"
                                          className="hidden"
                                          disabled={uploadingMedia === 'video' || uploadingMedia === 'image'}
                                          onChange={(e) => handleImportClip(e.target.files?.[0])}
                                        />
                                      </label>
                                      {customClip && (
                                        <button
                                          type="button"
                                          onClick={() => setCustomClip(null)}
                                          className="text-xs font-bold text-slate-600 underline hover:text-slate-900"
                                        >
                                          Volver al clip automático
                                        </button>
                                      )}
                                    </div>
                                    <p className="text-[11px] text-slate-500">
                                      Proporción vertical: <strong className="font-mono text-slate-700">1080 × 1920 px (9:16)</strong>.
                                    </p>
                                  </div>
                                )}
                              </div>

                              {/* Dinamismo, Storyboard de Tomas y Transiciones */}
                              <div className="pt-3 border-t border-slate-200/80 space-y-4">
                                <div>
                                  <div className="flex items-center justify-between">
                                    <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
                                      <Zap className="h-3.5 w-3.5 text-[#FF5500]" /> Ritmo & Tomas del Video
                                    </span>
                                    <span className="text-[10px] font-mono font-bold text-[#FF5500] bg-orange-50 px-2 py-0.5 rounded-full border border-orange-200">
                                      {videoStyle?.shot_count || 3} tomas en secuencia
                                    </span>
                                  </div>
                                  <p className="mt-0.5 text-[11px] text-slate-500">
                                    Controla cuántos cambios de plano tiene el Reel y personaliza el video o foto de cada toma individualmente.
                                  </p>
                                </div>

                                {/* Selector de cantidad de tomas */}
                                <div className="grid grid-cols-3 gap-2">
                                  {[
                                    { count: 2, label: '2 tomas', desc: 'Clásico (Foto + Clip)' },
                                    { count: 3, label: '3 tomas', desc: 'Dinámico (Recomendado)' },
                                    { count: 4, label: '4 tomas', desc: 'Intenso (Tomas rápidas)' },
                                  ].map((opt) => {
                                    const active = (videoStyle?.shot_count || 3) === opt.count;
                                    return (
                                      <button
                                        key={opt.count}
                                        type="button"
                                        onClick={() => setStyleField({ shot_count: opt.count })}
                                        className={`flex flex-col items-center justify-center p-3 rounded-2xl border text-center transition ${
                                          active
                                            ? 'border-[#FF5500] bg-orange-50/50 text-[#FF5500] ring-2 ring-[#FF5500]/30 font-bold'
                                            : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700'
                                        }`}
                                      >
                                        <span className="text-xs font-black">{opt.label}</span>
                                        <span className="text-[10px] text-slate-500 mt-0.5">{opt.desc}</span>
                                      </button>
                                    );
                                  })}
                                </div>

                                {/* STORYBOARD DE TOMAS (Línea de Tiempo Interactiva) */}
                                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                                  <div className="flex items-center justify-between">
                                    <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
                                      <Film className="h-3.5 w-3.5 text-[#FF5500]" /> Storyboard & Línea de Tiempo
                                    </span>
                                    <span className="text-[10.5px] font-bold text-slate-500">
                                      Total: {selectedItem?.processed?.video_direction?.duration_sec || 12}s
                                    </span>
                                  </div>

                                  {/* Grid de tarjetas por cada toma activa */}
                                  <div className={`grid grid-cols-1 sm:grid-cols-2 ${(videoStyle?.shot_count || 3) === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-3`}>
                                    {Array.from({ length: videoStyle?.shot_count || 3 }).map((_, idx) => {
                                      const totalDur = selectedItem?.processed?.video_direction?.duration_sec || 12;
                                      const totalShots = videoStyle?.shot_count || 3;
                                      
                                      // Rango de tiempo estimado para cada toma
                                      let timeLabel = '';
                                      if (totalShots === 2) {
                                        timeLabel = idx === 0 ? '0.0s – 5.0s' : '5.0s – 12.0s';
                                      } else if (totalShots === 3) {
                                        timeLabel = idx === 0 ? '0.0s – 3.5s' : idx === 1 ? '3.5s – 7.5s' : `7.5s – ${totalDur}s`;
                                      } else {
                                        timeLabel = idx === 0 ? '0.0s – 3.0s' : idx === 1 ? '3.0s – 6.0s' : idx === 2 ? '6.0s – 9.0s' : `9.0s – ${totalDur}s`;
                                      }

                                      // Datos del medio de la toma
                                      const customShot = (videoStyle?.custom_shots || []).find((s) => s.slot_index === idx);
                                      const isCustom = Boolean(customShot);

                                      let mediaKind: 'image' | 'video' = customShot?.media_kind || (idx === 0 && compBase === 'image' ? 'image' : 'video');
                                      let mediaUrl = customShot?.url || '';
                                      let mediaTitle = customShot?.name || '';

                                      const fallbackCategoryVideoUrl = `/api/media/category-video?category=${encodeURIComponent(modalVideoCategory)}${videoId ? `&newsId=${videoId}` : ''}`;

                                      if (!isCustom) {
                                        if (idx === 0) {
                                          if (compBase === 'image') {
                                            mediaKind = 'image';
                                            mediaUrl = customImage?.url || modalFeaturedImage || '';
                                            mediaTitle = customImage ? customImage.name : 'Foto destacada de la noticia';
                                          } else {
                                            mediaKind = 'video';
                                            mediaUrl = customClip?.url || fallbackCategoryVideoUrl;
                                            mediaTitle = customClip ? customClip.name : `Clip inicial · ${modalVideoCategory}`;
                                          }
                                        } else if (idx === 1) {
                                          mediaKind = 'video';
                                          mediaUrl = customClip?.url || fallbackCategoryVideoUrl;
                                          mediaTitle = customClip ? customClip.name : `B-Roll Principal · ${modalVideoCategory}`;
                                        } else if (idx === 2) {
                                          mediaKind = 'video';
                                          mediaUrl = fallbackCategoryVideoUrl;
                                          mediaTitle = `B-Roll Secundario (Pexels / Dinámico)`;
                                        } else {
                                          mediaKind = 'video';
                                          mediaUrl = fallbackCategoryVideoUrl;
                                          mediaTitle = `Cierre Dinámico`;
                                        }
                                      }

                                      return (
                                        <div
                                          key={idx}
                                          className={`flex flex-col justify-between rounded-2xl border bg-white p-3 shadow-xs transition hover:border-[#FF5500]/50 ${
                                            isCustom ? 'border-emerald-300 ring-1 ring-emerald-400/30' : 'border-slate-200'
                                          }`}
                                        >
                                          <div className="space-y-2">
                                            {/* Cabecera de la toma */}
                                            <div className="flex items-center justify-between">
                                              <div className="flex items-center gap-1.5">
                                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#FF5500]/10 text-[10px] font-black text-[#FF5500]">
                                                  {idx + 1}
                                                </span>
                                                <span className="text-xs font-black uppercase text-slate-800">
                                                  Toma {idx + 1}
                                                </span>
                                              </div>
                                              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-mono font-bold text-slate-600">
                                                {timeLabel}
                                              </span>
                                            </div>

                                            {/* Preview visual (Miniatura / Video) */}
                                            <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-900 shadow-inner group">
                                              {mediaKind === 'image' ? (
                                                <img
                                                  src={mediaUrl}
                                                  alt={mediaTitle}
                                                  className="h-full w-full object-cover"
                                                />
                                              ) : (
                                                <video
                                                  src={mediaUrl}
                                                  className="h-full w-full object-cover"
                                                  muted
                                                  playsInline
                                                  loop
                                                  onMouseOver={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                                                  onMouseOut={(e) => (e.currentTarget as HTMLVideoElement).pause()}
                                                />
                                              )}

                                              {/* Badges de tipo */}
                                              <div className="absolute top-1 left-1 flex items-center gap-1">
                                                <span className="rounded bg-black/75 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wider text-white backdrop-blur">
                                                  {mediaKind === 'image' ? 'Foto (Zoom)' : 'Video'}
                                                </span>
                                                {isCustom && (
                                                  <span className="rounded bg-emerald-600/90 px-1.5 py-0.5 text-[8.5px] font-bold text-white shadow-xs">
                                                    Manual
                                                  </span>
                                                )}
                                              </div>
                                            </div>

                                            {/* Título o descripción del medio */}
                                            <p className="text-[11px] font-semibold text-slate-700 truncate" title={mediaTitle}>
                                              {mediaTitle}
                                            </p>
                                          </div>

                                          {/* Acciones para cambiar o restablecer esta toma */}
                                          <div className="mt-3 pt-2 border-t border-slate-100 space-y-1.5">
                                            <label
                                              className={`flex w-full items-center justify-center gap-1.5 rounded-xl py-1.5 text-[10.5px] font-bold transition shadow-xs cursor-pointer ${
                                                uploadingShotIndex === idx
                                                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                                  : 'bg-slate-900 text-white hover:bg-black active:scale-95'
                                              }`}
                                            >
                                              <Upload className="h-3 w-3 text-[#FF5500]" />
                                              <span>{uploadingShotIndex === idx ? 'Subiendo...' : 'Cambiar toma'}</span>
                                              <input
                                                type="file"
                                                accept="video/*,image/*"
                                                disabled={uploadingShotIndex === idx}
                                                className="hidden"
                                                onChange={(e) => handleImportShotMedia(idx, e.target.files?.[0])}
                                              />
                                            </label>

                                            {isCustom && (
                                              <button
                                                type="button"
                                                onClick={() => handleResetShot(idx)}
                                                className="w-full text-center text-[10px] font-bold text-slate-400 hover:text-red-600 transition"
                                              >
                                                Restablecer a automático
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>

                                <div className="pt-1">
                                  <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
                                    <Sliders className="h-3.5 w-3.5 text-[#FF5500]" /> Transición entre Tomas
                                  </span>
                                  <p className="mt-0.5 text-[11px] text-slate-500">
                                    Efecto de transición cinematográfica entre los cortes de cámara.
                                  </p>
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                  {[
                                    { id: 'fade', label: 'Disolvencia', sub: 'Crossfade suave' },
                                    { id: 'slide', label: 'Deslizar', sub: 'Barrido lateral' },
                                    { id: 'fadeblack', label: 'A Negro', sub: 'Fundido de cine' },
                                    { id: 'cut', label: 'Corte directo', sub: 'Sin transición' },
                                  ].map((t) => {
                                    const active = (videoStyle?.transition || 'fade') === t.id;
                                    return (
                                      <button
                                        key={t.id}
                                        type="button"
                                        onClick={() => setStyleField({ transition: t.id as any })}
                                        className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-center transition ${
                                          active
                                            ? 'border-[#FF5500] bg-orange-50/50 text-[#FF5500] ring-2 ring-[#FF5500]/30 font-bold'
                                            : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700'
                                        }`}
                                      >
                                        <span className="text-xs font-bold">{t.label}</span>
                                        <span className="text-[10px] text-slate-500 mt-0.5">{t.sub}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Sub-pestaña 4: Locución IA */}
                          {videoStudioTab === 'voice' && (
                            <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
                                  <Mic className="h-3.5 w-3.5 text-[#FF5500]" /> Locución IA (ElevenLabs)
                                </span>
                                {videoRenderState.voiceStatus === 'ok' ? (
                                  <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                                    <Volume2 className="h-3 w-3" /> Locución lista en render
                                  </span>
                                ) : videoRenderState.voiceStatus === 'disabled' ? (
                                  <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold text-amber-700 border border-amber-200">
                                    Locución no configurada
                                  </span>
                                ) : null}
                              </div>

                              <div className="rounded-2xl bg-slate-50 p-4 border border-slate-200 space-y-3">
                                <div className="flex items-center justify-between text-[11px] font-bold text-slate-600">
                                  <span>Guion de locución (editable):</span>
                                  <span className="text-[#FF5500] font-mono">
                                    {effectiveWords} / {targetBudgetWords} palabras (~{((effectiveWords) / 2.7).toFixed(1)}s)
                                  </span>
                                </div>
                                <textarea
                                  value={effectiveVoiceText}
                                  onChange={(e) => setCustomVoiceText(e.target.value)}
                                  rows={4}
                                  placeholder="Escribe o edita el texto que narrará la voz IA..."
                                  className="w-full rounded-xl border border-slate-300 bg-white p-3 text-xs text-slate-800 leading-relaxed font-serif focus:border-[#FF5500] focus:ring-1 focus:ring-[#FF5500] focus:outline-none transition shadow-sm"
                                />
                                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px]">
                                  <span className="text-slate-500">
                                    {customVoiceText !== ''
                                      ? '✏️ Guion modificado manualmente. El render se actualizará con tu nuevo texto al dejar de escribir.'
                                      : '🤖 Guion generado automáticamente con IA según el titular y la noticia.'}
                                  </span>
                                  {customVoiceText !== '' && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setCustomVoiceText('');
                                        setCommittedVoiceText('');
                                      }}
                                      className="flex items-center gap-1 font-bold text-[#FF5500] hover:text-[#E04B00] hover:underline"
                                    >
                                      <RotateCcw className="h-3 w-3" /> Restaurar guion original de la IA
                                    </button>
                                  )}
                                </div>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-600">
                                <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                                  <span className="block font-bold text-slate-800">Voz asignada:</span>
                                  <span className="text-[11px] text-slate-500 font-mono">ElevenLabs Multilingual v2</span>
                                </div>
                                <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                                  <span className="block font-bold text-slate-800">Sincronización:</span>
                                  <span className="text-[11px] text-slate-500">Ajuste de velocidad y audio automático</span>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Sub-pestaña 5: Presets */}
                          {videoStudioTab === 'presets' && (
                            <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                              <div>
                                <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700">
                                  <Palette className="h-3.5 w-3.5 text-[#FF5500]" /> Presets de Estilo Guardados
                                </span>
                                <p className="mt-1 text-[11px] text-slate-500">
                                  Aplica configuraciones visuales predefinidas o guarda tu estilo actual para futuros videos.
                                </p>
                              </div>

                              <div className="flex flex-wrap items-center gap-3">
                                <select
                                  value=""
                                  onChange={(e) => {
                                    if (e.target.value) handleApplyPreset(e.target.value);
                                  }}
                                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 bg-white focus:outline-none focus:border-[#FF5500]"
                                >
                                  <option value="">Seleccionar y aplicar preset...</option>
                                  {stylePresets.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name}
                                    </option>
                                  ))}
                                </select>

                                <button
                                  type="button"
                                  onClick={handleSaveAsPreset}
                                  disabled={savingPreset}
                                  className="rounded-xl border border-[#FF5500] bg-orange-50 px-4 py-2 text-xs font-bold text-[#FF5500] transition hover:bg-[#FF5500] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {savingPreset ? 'Guardando...' : 'Guardar estilo actual como preset'}
                                </button>
                              </div>

                              {stylePresets.length > 0 && (
                                <div className="mt-3 space-y-2">
                                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                                    Presets disponibles:
                                  </span>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {stylePresets.map((p) => (
                                      <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => handleApplyPreset(p.id)}
                                        className="flex items-center justify-between rounded-xl border border-slate-200 p-3 text-left hover:border-[#FF5500] hover:bg-orange-50/30 transition"
                                      >
                                        <div>
                                          <span className="block text-xs font-bold text-slate-800">{p.name}</span>
                                          <span className="text-[10px] text-slate-400">
                                            {p.style.headline_font === 'league_spartan' ? 'League Spartan' : 'Clásica'} · {p.style.headline_font_size || 46}px
                                          </span>
                                        </div>
                                        <span className="text-[10px] font-bold text-[#FF5500]">Aplicar</span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
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
                    disabled={videoRenderState.status === 'rendering' || isDownloadingVideo}
                    onClick={() => handleDownloadRealVideo(displayTitle, isVideoStyleDirty ? undefined : videoRenderState.url)}
                    className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-black text-white shadow-md transition active:scale-95 ${
                      videoRenderState.status === 'rendering' || isDownloadingVideo
                        ? 'bg-slate-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-[#FF5500] to-[#FF7700] hover:from-[#E04B00] hover:to-[#FF6600] shadow-orange-500/20'
                    }`}
                  >
                    {videoRenderState.status === 'rendering' || isDownloadingVideo ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Generando video...</span>
                      </>
                    ) : isVideoStyleDirty ? (
                      <>
                        <Download className="w-3.5 h-3.5" />
                        <span>Actualizar &amp; Descargar (.mp4)</span>
                      </>
                    ) : videoRenderState.status === 'failed' ? (
                      <>
                        <Download className="w-3.5 h-3.5" />
                        <span>Reintentar y Descargar (.mp4)</span>
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
