'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Sparkles, Mic, Film, CheckCircle2, Zap } from 'lucide-react';
import type { RenderState } from '@/hooks/useVideoRenderCache';

interface PhoneStudioLoaderProps {
  isGenerating?: boolean;
  generationStep?: string;
  renderState?: RenderState;
  headline?: string;
  category?: string;
}

type StageKey = 'ia' | 'voice' | 'render' | 'ready';

interface StageConfig {
  key: StageKey;
  stepNumber: number;
  label: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  startPct: number;
  endPct: number;
}

const STAGES: StageConfig[] = [
  {
    key: 'ia',
    stepNumber: 1,
    label: 'Redacción IA',
    subtitle: 'Redactando titular, síntesis y guion...',
    icon: Sparkles,
    startPct: 5,
    endPct: 35,
  },
  {
    key: 'voice',
    stepNumber: 2,
    label: 'Locución Neuronal',
    subtitle: 'Generando voz de locutor con ElevenLabs...',
    icon: Mic,
    startPct: 35,
    endPct: 65,
  },
  {
    key: 'render',
    stepNumber: 3,
    label: 'Renderizado 9:16',
    subtitle: 'Componiendo capas, B-roll y marca en FFmpeg...',
    icon: Film,
    startPct: 65,
    endPct: 94,
  },
  {
    key: 'ready',
    stepNumber: 4,
    label: 'Reel Listo',
    subtitle: '¡Video 9:16 generado con éxito!',
    icon: CheckCircle2,
    startPct: 100,
    endPct: 100,
  },
];

export default function PhoneStudioLoader({
  isGenerating = false,
  generationStep = '',
  renderState,
  headline,
  category = 'NOTICIAS',
}: PhoneStudioLoaderProps) {
  const [progress, setProgress] = useState<number>(10);
  const isRenderReady = renderState?.status === 'ready';

  // Determinar la etapa activa
  const currentStage: StageConfig = useMemo(() => {
    if (isRenderReady) return STAGES[3];
    if (isGenerating) return STAGES[0];
    if (renderState?.status === 'rendering') {
      if (progress < 60) return STAGES[1];
      return STAGES[2];
    }
    return STAGES[0];
  }, [isGenerating, renderState?.status, isRenderReady, progress]);

  // Simulación continua de progreso
  useEffect(() => {
    if (isRenderReady) {
      setProgress(100);
      return;
    }

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (isGenerating) {
          if (prev < 33) return prev + Math.random() * 2.2 + 0.8;
          return prev;
        }

        if (renderState?.status === 'rendering') {
          const targetCap = 92;
          if (prev < targetCap) {
            const step = prev < 60 ? Math.random() * 2.0 + 0.8 : Math.random() * 1.1 + 0.3;
            return Math.min(targetCap, prev + step);
          }
          return prev;
        }

        return prev;
      });
    }, 280);

    return () => clearInterval(interval);
  }, [isGenerating, renderState?.status, isRenderReady]);

  // Si pasa a renderizado real, avanzar el piso de progreso
  useEffect(() => {
    if (renderState?.status === 'rendering' && progress < 35) {
      setProgress(36);
    }
  }, [renderState?.status]);

  const roundedPct = Math.min(100, Math.round(progress));

  const estimatedSeconds = useMemo(() => {
    if (roundedPct >= 95) return '1s';
    if (roundedPct >= 80) return '3s';
    if (roundedPct >= 60) return '6s';
    if (roundedPct >= 40) return '9s';
    return '12s';
  }, [roundedPct]);

  const ActiveIcon = currentStage.icon;

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-between bg-slate-50 p-4 text-slate-800 overflow-hidden select-none animate-fadeIn border border-slate-200">
      {/* ── 1. Cabecera limpia y sólida ── */}
      <div className="relative z-10 flex items-center justify-between pt-0.5">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-slate-200 shadow-sm">
          <span className="w-2 h-2 rounded-full bg-[#FF5500] animate-ping" />
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-800">
            Studio Reel 9:16
          </span>
        </div>
        <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-orange-100 border border-orange-200 text-[10px] font-mono font-bold text-[#FF5500]">
          ~{estimatedSeconds}
        </div>
      </div>

      {/* ── 2. Zona central: Tarjeta blanca sólida con icono y estado ── */}
      <div className="relative z-10 my-auto flex flex-col items-center text-center py-2">
        {/* Contenedor del Icono Principal */}
        <div className="relative mb-3 flex items-center justify-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-[#FF5500] to-amber-500 flex items-center justify-center shadow-lg shadow-orange-500/25 text-white">
            <ActiveIcon className="w-8 h-8 animate-pulse" />
          </div>
          {/* Badge de porcentaje */}
          <div className="absolute -bottom-2 -right-2 bg-slate-900 text-white border-2 border-white rounded-full px-2 py-0.5 text-[10.5px] font-mono font-black shadow-md">
            {roundedPct}%
          </div>
        </div>

        {/* Título de la fase actual */}
        <div className="flex items-center gap-1 text-[14px] font-black tracking-tight text-slate-900 mb-0.5">
          <span>{currentStage.label}</span>
          <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
        </div>

        {/* Mensaje descriptivo legible */}
        <p className="text-[11px] text-slate-600 font-medium leading-relaxed px-2 min-h-[30px] line-clamp-2 max-w-[210px]">
          {generationStep || currentStage.subtitle}
        </p>

        {/* Barra de progreso sólida de alta visibilidad */}
        <div className="w-full mt-3 space-y-1.5">
          <div className="w-full h-3 rounded-full bg-slate-200 border border-slate-300/80 overflow-hidden p-0.5 shadow-inner">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#FF5500] to-amber-500 transition-all duration-300 ease-out shadow-sm"
              style={{ width: `${roundedPct}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[9.5px] font-bold text-slate-500 px-0.5">
            <span className="uppercase tracking-wide text-slate-600 font-black">{category}</span>
            <span className="text-[#FF5500] font-black">{roundedPct}% completado</span>
          </div>
        </div>

        {/* Stepper horizontal: 3 etapas nítidas */}
        <div className="grid grid-cols-3 gap-1 mt-3.5 pt-2 border-t border-slate-200 w-full">
          {STAGES.slice(0, 3).map((stg) => {
            const isDone = progress >= stg.endPct || isRenderReady;
            const isCurrent = currentStage.key === stg.key && !isRenderReady;
            return (
              <div
                key={stg.key}
                className={`flex flex-col items-center justify-center py-1 px-1 rounded-lg text-center transition-all ${
                  isDone
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold'
                    : isCurrent
                    ? 'bg-[#FF5500] text-white font-black shadow-sm'
                    : 'bg-white border border-slate-200 text-slate-400 font-medium'
                }`}
              >
                <span className="text-[8.5px] font-bold uppercase tracking-tight">
                  {isDone ? '✓ Listo' : `Paso ${stg.stepNumber}`}
                </span>
                <span className="text-[9px] font-extrabold truncate w-full">
                  {stg.label.split(' ')[0]}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 3. Pie: Tarjeta blanca sólida con el titular de la noticia ── */}
      {headline && (
        <div className="relative z-10 rounded-xl bg-white border border-slate-200 p-2.5 shadow-sm text-left">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#FF5500]" />
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">
              Generando Reel para:
            </p>
          </div>
          <p className="text-[10.5px] font-bold text-slate-800 line-clamp-2 leading-snug">
            {headline}
          </p>
        </div>
      )}
    </div>
  );
}
