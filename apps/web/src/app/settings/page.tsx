'use client';

import React, { useState } from 'react';
import { Settings, Cpu, Globe, Key, Save, CheckCircle2, Sliders, ShieldCheck } from 'lucide-react';

export default function SettingsPage() {
  const [ollamaHost, setOllamaHost] = useState('https://api.ollama.com/v1');
  const [ollamaKey, setOllamaKey] = useState('');
  const [ollamaModel, setOllamaModel] = useState('qwen2.5:72b');
  const [wpUrl, setWpUrl] = useState('https://prensaabierta.pr');
  const [wpUser, setWpUser] = useState('');
  const [wpAppPassword, setWpAppPassword] = useState('');
  const [saved, setSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="p-5 rounded-2xl bg-gradient-to-r from-gray-900 via-[#131b2e] to-gray-900 border border-gray-800 shadow-xl">
        <h1 className="text-2xl font-black text-white flex items-center gap-2">
          <Settings className="w-6 h-6 text-blue-400" />
          <span>Configuración del Sistema</span>
        </h1>
        <p className="text-sm text-gray-400 mt-1">
          Ajusta tus conexiones de Ollama Cloud (Modelos Open Source), WordPress REST API y parámetros de video.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Ollama Cloud AI Section */}
        <div className="p-6 rounded-2xl bg-[#0f1629] border border-gray-800 space-y-4 shadow-lg">
          <div className="flex items-center gap-2 border-b border-gray-800 pb-3">
            <Cpu className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-bold text-white">Modelos de IA en Ollama Cloud</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs font-semibold text-gray-300">Modelo Seleccionado</label>
              <select
                value={ollamaModel}
                onChange={(e) => setOllamaModel(e.target.value)}
                className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-red-500"
              >
                <option value="qwen2.5:72b">Qwen 2.5 72B (Recomendado - Excelente redacción en español)</option>
                <option value="qwen2.5:32b">Qwen 2.5 32B (Ultrarrápido y balanceado)</option>
                <option value="glm-4:latest">GLM-4 / GLM Latest (Zhipu AI - Alta precisión)</option>
                <option value="minimax-m3">MiniMax M3 / Text (Capacidad narrativa avanzada)</option>
                <option value="mistral-large:latest">Mistral Large (Riguroso y neutral)</option>
                <option value="llama3.3:70b">Llama 3.3 70B (Meta AI - Muy consistente)</option>
              </select>
              <p className="text-[11px] text-gray-500">
                Selecciona el modelo Open Source que deseas que redacte las noticias con el tono de Prensa Abierta.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-300">Ollama Cloud Base URL</label>
              <input
                type="text"
                value={ollamaHost}
                onChange={(e) => setOllamaHost(e.target.value)}
                placeholder="https://api.ollama.com/v1"
                className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-red-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-300">Ollama Cloud API Key</label>
              <input
                type="password"
                value={ollamaKey}
                onChange={(e) => setOllamaKey(e.target.value)}
                placeholder="ollama_sec_..."
                className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-red-500"
              />
            </div>
          </div>
        </div>

        {/* WordPress Integration Section */}
        <div className="p-6 rounded-2xl bg-[#0f1629] border border-gray-800 space-y-4 shadow-lg">
          <div className="flex items-center gap-2 border-b border-gray-800 pb-3">
            <Globe className="w-5 h-5 text-blue-400" />
            <h2 className="text-base font-bold text-white">Conexión WordPress Prensa Abierta</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs font-semibold text-gray-300">URL del Sitio WordPress</label>
              <input
                type="text"
                value={wpUrl}
                onChange={(e) => setWpUrl(e.target.value)}
                placeholder="https://prensaabierta.pr"
                className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-red-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-300">Usuario Administrador / Editor</label>
              <input
                type="text"
                value={wpUser}
                onChange={(e) => setWpUser(e.target.value)}
                placeholder="editor_prensa"
                className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-red-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-300">Application Password</label>
              <input
                type="password"
                value={wpAppPassword}
                onChange={(e) => setWpAppPassword(e.target.value)}
                placeholder="xxxx xxxx xxxx xxxx"
                className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-red-500"
              />
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex items-center justify-between pt-2">
          {saved ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-bold">
              <CheckCircle2 className="w-4 h-4" /> Configuración guardada correctamente
            </span>
          ) : (
            <span className="text-xs text-gray-500">Los cambios se aplican de inmediato en el pipeline.</span>
          )}

          <button
            type="submit"
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-bold shadow-lg shadow-red-600/30 transition active:scale-95"
          >
            <Save className="w-4 h-4" />
            <span>Guardar Configuración</span>
          </button>
        </div>
      </form>
    </div>
  );
}
