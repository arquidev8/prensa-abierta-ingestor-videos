'use client';

import React, { useState, useEffect } from 'react';
import { Video, Image as ImageIcon, Plus, FolderCheck, Tag, Upload, Play, Check } from 'lucide-react';
import { MediaItem } from '@/lib/types';

export default function MediaBankPage() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState<boolean>(false);

  // Form State
  const [newTitle, setNewTitle] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newType, setNewType] = useState<'image' | 'video'>('image');
  const [newCategory, setNewCategory] = useState('Gobierno');
  const [newTags, setNewTags] = useState('');

  const categories = [
    'all',
    'Gobierno',
    'Tribunales',
    'Policía & Seguridad',
    'San Juan',
    'Deportes',
    'El Tiempo & Huracanes',
    'Economía',
    'Farándula',
  ];

  const fetchMedia = async () => {
    try {
      const res = await fetch('http://localhost:8085/api/media', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      }
    } catch (e) {
      console.error(e);
    }
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
      const res = await fetch('http://localhost:8085/api/media', {
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
      console.error(err);
    }
  };

  const filteredItems = items.filter((item) => {
    if (selectedCategory !== 'all' && item.category !== selectedCategory) return false;
    if (selectedType !== 'all' && item.type !== selectedType) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-gray-900 via-[#131b2e] to-gray-900 border border-gray-800 shadow-xl">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <Video className="w-6 h-6 text-amber-400" />
            <span>Banco de Medios Clasificado</span>
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Biblioteca de fotos y clips de video categorizados para Puerto Rico (asociación automática de noticias).
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold shadow-lg shadow-red-600/30 transition active:scale-95"
        >
          <Plus className="w-4 h-4" />
          <span>Añadir Medio al Banco</span>
        </button>
      </div>

      {/* Category Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-900/60 p-3 rounded-xl border border-gray-800">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                selectedCategory === cat
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'bg-gray-800/60 text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }`}
            >
              {cat === 'all' ? 'Todas las Categorías' : cat}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-gray-800/80 p-1 rounded-lg border border-gray-700/60 text-xs">
          <button
            onClick={() => setSelectedType('all')}
            className={`px-3 py-1 rounded-md font-medium transition ${
              selectedType === 'all' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Todos
          </button>
          <button
            onClick={() => setSelectedType('image')}
            className={`px-3 py-1 rounded-md font-medium transition ${
              selectedType === 'image' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Fotos
          </button>
          <button
            onClick={() => setSelectedType('video')}
            className={`px-3 py-1 rounded-md font-medium transition ${
              selectedType === 'video' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Clips de Video
          </button>
        </div>
      </div>

      {/* Media Grid */}
      {filteredItems.length === 0 ? (
        <div className="text-center py-16 bg-gray-900/40 rounded-2xl border border-gray-800 space-y-3">
          <FolderCheck className="w-10 h-10 text-gray-600 mx-auto" />
          <p className="text-base font-semibold text-gray-300">No hay medios cargados en esta categoría</p>
          <p className="text-xs text-gray-500">
            Haz clic en "Añadir Medio al Banco" para indexar imágenes o clips para el pipeline de video.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className="group rounded-xl bg-[#0f1629] border border-gray-800 hover:border-gray-700 overflow-hidden shadow-lg transition"
            >
              <div className="relative h-44 w-full bg-black">
                {item.type === 'video' ? (
                  <div className="w-full h-full flex items-center justify-center relative">
                    <video src={item.url} className="w-full h-full object-cover opacity-80" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur flex items-center justify-center border border-white/20">
                        <Play className="w-4 h-4 text-white fill-white ml-0.5" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <img src={item.url} alt={item.title} className="w-full h-full object-cover" />
                )}

                <div className="absolute top-2 left-2 flex items-center gap-1">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-black/80 backdrop-blur text-white">
                    {item.type === 'video' ? 'CLIP 9:16' : 'IMAGEN'}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-red-950/80 text-red-300 border border-red-500/20">
                    {item.category}
                  </span>
                </div>
              </div>

              <div className="p-3 space-y-1.5">
                <h4 className="font-bold text-xs text-white truncate">{item.title}</h4>
                <div className="flex flex-wrap gap-1">
                  {item.tags.map((t, idx) => (
                    <span key={idx} className="text-[10px] text-gray-400 bg-gray-800/80 px-1.5 py-0.5 rounded">
                      #{t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Media Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f1629] border border-gray-700 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <h3 className="font-bold text-white text-base">Añadir Medio al Banco de Prensa Abierta</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-gray-400 hover:text-white text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddItem} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-300">Tipo de Medio</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewType('image')}
                    className={`py-2 rounded-lg text-xs font-bold border transition ${
                      newType === 'image'
                        ? 'bg-red-600 border-red-500 text-white'
                        : 'bg-gray-950 border-gray-800 text-gray-400'
                    }`}
                  >
                    Imagen (WordPress)
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewType('video')}
                    className={`py-2 rounded-lg text-xs font-bold border transition ${
                      newType === 'video'
                        ? 'bg-amber-600 border-amber-500 text-white'
                        : 'bg-gray-950 border-gray-800 text-gray-400'
                    }`}
                  >
                    Clip de Video (10-15s)
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-300">Título / Descripción</label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Fachada de El Capitolio en San Juan"
                  className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-300">URL del Archivo (Direct URL / S3)</label>
                <input
                  type="url"
                  required
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-300">Categoría Puerto Rico</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500"
                >
                  {categories
                    .filter((c) => c !== 'all')
                    .map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-300">Tags (Separados por coma)</label>
                <input
                  type="text"
                  value={newTags}
                  onChange={(e) => setNewTags(e.target.value)}
                  placeholder="san juan, senado, capitolio, leyes"
                  className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition shadow-md shadow-red-600/30"
                >
                  Guardar en Biblioteca
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
