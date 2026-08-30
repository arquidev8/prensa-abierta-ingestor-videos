'use client';

import { WifiOff, RefreshCw } from 'lucide-react';

interface EngineOfflineBannerProps {
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
}

/**
 * Banner de estado explícito para cuando el Go Engine no responde. Se muestra
 * en vez de dejar la UI en un estado vacío indistinguible de "no hay datos".
 */
export default function EngineOfflineBanner({ message, onRetry, retrying = false }: EngineOfflineBannerProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-red-50 border border-red-200 text-red-800 shadow-sm">
      <div className="flex items-center gap-3">
        <WifiOff className="w-5 h-5 text-red-500 shrink-0" />
        <div>
          <p className="text-sm font-black">Motor Go (Engine) no disponible</p>
          <p className="text-xs text-red-700/80">
            {message || 'No se pudo conectar con el servidor de datos. Verifica que el servicio esté corriendo.'}
          </p>
        </div>
      </div>

      {onRetry && (
        <button
          onClick={onRetry}
          disabled={retrying}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-100 hover:bg-red-200 text-red-800 text-xs font-bold transition shrink-0 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />
          <span>Reintentar</span>
        </button>
      )}
    </div>
  );
}
