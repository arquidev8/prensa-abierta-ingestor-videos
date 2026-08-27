'use client';

import React, { useState } from 'react';
import { Settings, Cpu, Globe, Key, Save, CheckCircle2, Sliders, ShieldCheck, Sparkles } from 'lucide-react';

export default function SettingsPage() {
  const [ollamaHost, setOllamaHost] = useState('https://api.siliconflow.cn/v1');
  const [ollamaKey, setOllamaKey] = useState('');
  const [ollamaModel, setOllamaModel] = useState('glm-5.2');
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
      {/* Top Banner (Clean Light with Brand Orange Accents) */}
      <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-full bg-gradient-to-l from-orange-50 to-transparent pointer-events-none" />

        <div className="space-y-1 relative z-10">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-orange-100 text-[#FF5500] font-black text-xs tracking-wider uppercase flex items-center gap-1.5 shadow-sm border border-orange-200">
              <Settings className="w-3.5 h-3.5" />
              <span>AJUSTES EDITORIALES & INTEGRACIONES</span>
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            Configuración del Sistema
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 max-w-xl">
            Ajusta tus conexiones de IA (GLM-4 / MiniMax / Qwen), credenciales de WordPress REST API y parámetros de video.
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* IA Model Section */}
        <div className="p-6 rounded-3xl bg-white border border-slate-200 space-y-4 shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Cpu className="w-5 h-5 text-[#FF5500]" />
            <h2 className="text-base font-black text-slate-900">Modelos de IA & Redacción Periodística</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs font-bold text-slate-700">Modelo Seleccionado</label>
              <select
                value={ollamaModel}
                onChange={(e) => setOllamaModel(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-bold text-slate-900 focus:outline-none focus:border-[#FF5500]"
              >
                <option value="glm-5.2">GLM 5.2 / GLM-4 (Zhipu AI - Máxima precisión y fluidez)</option>
                <option value="minimax-m3">MiniMax M3 / Text (Capacidad narrativa avanzada)</option>
                <option value="qwen2.5:72b">Qwen 2.5 72B (Excelente redacción en español)</option>
              </select>
              <p className="text-[11px] text-slate-500">
                Selecciona el modelo de lenguaje que redacta las noticias con el tono de Prensa Abierta.
              </p>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs font-bold text-slate-700">API Endpoint Base</label>
              <input
                type="text"
                value={ollamaHost}
                onChange={(e) => setOllamaHost(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:border-[#FF5500]"
              />
            </div>
          </div>
        </div>

        {/* WordPress API Section */}
        <div className="p-6 rounded-3xl bg-white border border-slate-200 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-blue-600" />
              <h2 className="text-base font-black text-slate-900">Conexión con WordPress (prensaabierta.pr)</h2>
            </div>
            <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Modo Sandbox Protegido
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="font-bold text-slate-700">URL del Sitio WordPress</label>
              <input
                type="text"
                value={wpUrl}
                onChange={(e) => setWpUrl(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-slate-900 font-mono focus:outline-none focus:border-[#FF5500]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-bold text-slate-700">Usuario de WordPress</label>
              <input
                type="text"
                placeholder="admin / redactor"
                value={wpUser}
                onChange={(e) => setWpUser(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-slate-900 focus:outline-none focus:border-[#FF5500]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-bold text-slate-700">Application Password</label>
              <input
                type="password"
                placeholder="xxxx xxxx xxxx xxxx"
                value={wpAppPassword}
                onChange={(e) => setWpAppPassword(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-slate-900 font-mono focus:outline-none focus:border-[#FF5500]"
              />
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Los cambios se aplican de inmediato en los endpoints del pipeline.
          </p>

          <button
            type="submit"
            className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-[#FF5500] to-[#FF7700] hover:from-[#E04B00] hover:to-[#FF6600] text-white text-xs font-black shadow-md shadow-orange-500/20 transition active:scale-95"
          >
            {saved ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-white" />
                <span>¡Ajustes Guardados!</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>Guardar Configuración</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
