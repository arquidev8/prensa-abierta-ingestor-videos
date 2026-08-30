'use client';

import React, { useState, useEffect } from 'react';
import { Video, Image as ImageIcon, Plus, FolderCheck, Tag, Upload, Play, Check, Sparkles, Film, Layers } from 'lucide-react';
import { MediaItem } from '@/lib/types';
import EngineOfflineBanner from '@/components/EngineOfflineBanner';
import { fetchFromEngine, ENGINE_URL } from '@/lib/engineClient';

export default function MediaBankPage() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [categoryVideos, setCategoryVideos] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [activePreviewUrl, setActivePreviewUrl] = useState<string | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Form State
  const [newTitle, setNewTitle] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newType, setNewType] = useState<'image' | 'video'>('image');
  const [newCategory, setNewCategory] = useState('Gobierno');
  const [newTags, setNewTags] = useState('');

  const categories = [
    'all',
    'Ahora',
    'Gobierno',
    'Tribunales',
    'Policía & Seguridad',
    'Sucesos',
    'San Juan',
    'Deportes',
    'Economía',
    'El Tiempo & Huracanes',
    'Farándula',
  ];

  const fetchMedia = async () => {
    setLoading(true);

    // 1. Cargar items del banco propio (Go Engine)
    const storeResult = await fetchFromEngine<{ items: MediaItem[] }>('/api/media', { cache: 'no-store' });
    const storeItems = storeResult.ok && Array.isArray(storeResult.data.items) ? storeResult.data.items : [];
    // Solo marcamos el banner cuando el Engine es inalcanzable, no ante un
    // simple error HTTP puntual (esos ya quedan logueados en consola).
    setEngineError(!storeResult.ok && storeResult.offline ? storeResult.error : null);

    // 2. Cargar videos de assets/contenido (ruta interna de Next.js, no depende del Engine)
    try {
      const resCat = await fetch('/api/media/category-list', { cache: 'no-store' });
      if (resCat.ok) {
        const catData = await resCat.json();
        const localClips: MediaItem[] = [];
        if (Array.isArray(catData.categories)) {
          catData.categories.forEach((folder: any) => {
            const videos = Array.isArray(folder.videos) ? folder.videos : [];
            videos.forEach((v: any, index: number) => {
              localClips.push({
                id: `local_${folder.name}_${index}`,
                type: 'video',
                title: `Plantilla Oficial: ${folder.name} (${v.fileName})`,
                url: v.streamUrl,
                category: folder.name,
                tags: ['plantilla_oficial', 'assets/contenido', folder.name.toLowerCase(), '9:16'],
                width: 1080,
                height: 1920,
                created_at: new Date().toISOString(),
              });
            });
          });
        }
        setCategoryVideos(localClips);
        setItems([...localClips, ...storeItems]);
      } else {
        setCategoryVideos([]);
        setItems(storeItems);
      }
    } catch (e) {
      console.error('Error cargando categorías de video locales:', e);
      setCategoryVideos([]);
      setItems(storeItems);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchMedia();
  }, []);

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const itemPayload = {
      type: newType,
      title: newTitle,
      url: newUrl,
      category: newCategory,
      tags: newTags.split(',').map((t) => t.trim()).filter(Boolean),
      width: 1080,
      height: newType === 'video' ? 1920 : 1080,
    };

    try {
      const res = await fetch(`${ENGINE_URL}/api/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(itemPayload),
      });
      if (res.ok) {
        setShowAddModal(false);
        setNewTitle('');
        setNewUrl('');
        setNewTags('');
        fetchMedia();
      }
    } catch (err) {
      console.error('Error guardando media:', err);
    }
  };

  const filteredItems = items.filter((item) => {
    if (selectedCategory !== 'all') {
      const itemCat = (item.category || '').toLowerCase();
      const selCat = selectedCategory.toLowerCase();
      if (!itemCat.includes(selCat) && !selCat.includes(itemCat)) return false;
    }
    if (selectedType !== 'all' && item.type !== selectedType) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5 p-6 rounded-3xl bg-white border border-slate-200 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-full bg-gradient-to-l from-orange-50 to-transparent pointer-events-none" />

        <div className="space-y-1 relative z-10">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-orange-100 text-[#FF5500] font-black text-xs tracking-wider uppercase flex items-center gap-1.5 shadow-sm border border-orange-200">
              <Sparkles className="w-3.5 h-3.5 fill-[#FF5500] text-[#FF5500]" />
              <span>REPOSITORIO VISUAL DE PUERTO RICO</span>
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            Banco de Medios & Plantillas de Video
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 max-w-xl">
            Catálogo de videos clasificados en <code>assets/contenido</code> (Ahora, Deportes, Economía, Gobierno, Sucesos) e imágenes para composición automática 9:16.
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-[#FF5500] to-[#FF7700] hover:from-[#E04B00] hover:to-[#FF6600] text-white text-xs font-bold shadow-md shadow-orange-500/20 transition active:scale-95 shrink-0 relative z-10"
        >
          <Plus className="w-4 h-4" />
          <span>Añadir Medio</span>
        </button>
      </div>

      {/* Estado explícito cuando el Go Engine no responde (evita confundirlo con "banco vacío") */}
      {engineError && (
        <EngineOfflineBanner message={engineError} onRetry={fetchMedia} retrying={loading} />
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-3xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                selectedCategory === cat
                  ? 'bg-[#FF5500] text-white shadow-sm shadow-orange-500/20'
                  : 'bg-slate-50 text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              {cat === 'all' ? 'Todas las Categorías' : cat}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-slate-50 p-1.5 rounded-2xl border border-slate-200 text-xs">
          <button
            onClick={() => setSelectedType('all')}
            className={`px-3 py-1 rounded-xl font-bold transition ${
              selectedType === 'all' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Todos ({filteredItems.length})
          </button>
          <button
            onClick={() => setSelectedType('image')}
            className={`px-3 py-1 rounded-xl font-bold transition ${
              selectedType === 'image' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Fotos
          </button>
          <button
            onClick={() => setSelectedType('video')}
            className={`px-3 py-1 rounded-xl font-bold transition ${
              selectedType === 'video' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Videos 9:16 ({categoryVideos.length})
          </button>
        </div>
      </div>

      {/* Media Grid */}
      {filteredItems.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-3xl border border-slate-200 space-y-3 shadow-sm">
          <FolderCheck className="w-12 h-12 text-slate-300 mx-auto" />
          <p className="text-base font-bold text-slate-800">No hay medios cargados en esta categoría</p>
          <p className="text-xs text-slate-500">
            Haz clic en "Añadir Medio" o verifica los videos en la carpeta <code>assets/contenido</code>.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {filteredItems.map((item) => {
            const isLocalTemplate = item.id.startsWith('local_');

            return (
              <div
                key={item.id}
                className="group rounded-3xl bg-white border border-slate-200 hover:border-orange-300 overflow-hidden shadow-sm hover:shadow-xl transition duration-300 flex flex-col justify-between"
              >
                <div className="relative h-56 w-full bg-black overflow-hidden">
                  {item.type === 'video' ? (
                    <div className="w-full h-full flex items-center justify-center relative group/vid">
                      <video
                        src={item.url}
                        muted
                        loop
                        playsInline
                        onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                        onMouseLeave={(e) => {
                          e.currentTarget.pause();
                          e.currentTarget.currentTime = 0;
                        }}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/25 pointer-events-none group-hover/vid:opacity-0 transition">
                        <div className="w-10 h-10 rounded-full bg-white/80 backdrop-blur flex items-center justify-center shadow-md">
                          <Play className="w-4 h-4 text-slate-900 fill-slate-900 ml-0.5" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <img src={item.url} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
                  )}

                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                    {isLocalTemplate ? (
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-gradient-to-r from-[#FF5500] to-amber-500 text-white shadow-sm flex items-center gap-1">
                        <Film className="w-3 h-3" /> PLANTILLA 9:16
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-white/90 backdrop-blur text-slate-900 shadow-sm border border-white/40">
                        {item.type === 'video' ? 'CLIP 9:16' : 'IMAGEN'}
                      </span>
                    )}

                    <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-slate-900/80 backdrop-blur text-white shadow-sm">
                      {item.category}
                    </span>
                  </div>
                </div>

                <div className="p-4 space-y-2">
                  <h4 className="font-bold text-xs text-slate-900 truncate" title={item.title}>
                    {item.title}
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {item.tags.map((t, idx) => (
                      <span key={idx} className="text-[10px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200/80">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Media Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-black text-slate-900 text-base">Añadir Medio al Banco de Prensa Abierta</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-900 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddItem} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-bold text-slate-700">Tipo de Medio</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewType('image')}
                    className={`py-2 rounded-xl font-bold border transition ${
                      newType === 'image'
                        ? 'bg-orange-50 border-[#FF5500] text-[#FF5500]'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    Fotografía
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewType('video')}
                    className={`py-2 rounded-xl font-bold border transition ${
                      newType === 'video'
                        ? 'bg-orange-50 border-[#FF5500] text-[#FF5500]'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    Clip Vertical (9:16)
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700">Título / Descripción</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Fachada de El Capitolio en San Juan"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-slate-900 font-medium focus:outline-none focus:border-[#FF5500]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700">URL del Recurso</label>
                <input
                  type="url"
                  required
                  placeholder="https://..."
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-slate-900 font-mono focus:outline-none focus:border-[#FF5500]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700">Categoría</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-slate-900 font-bold focus:outline-none focus:border-[#FF5500]"
                >
                  {categories.filter((c) => c !== 'all').map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700">Etiquetas (separadas por coma)</label>
                <input
                  type="text"
                  placeholder="san juan, gobierno, capitolio"
                  value={newTags}
                  onChange={(e) => setNewTags(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-slate-900 focus:outline-none focus:border-[#FF5500]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[#FF5500] hover:bg-[#E04B00] text-white font-bold transition shadow-md shadow-orange-500/20"
                >
                  Guardar en Banco
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
