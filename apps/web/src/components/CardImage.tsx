'use client';

import { useEffect, useRef, useState } from 'react';
import { ImageOff, Newspaper, RotateCw } from 'lucide-react';

// Esperas antes de cada reintento automático: los fallos suelen ser transitorios
// (el CDN del medio saturado por varias imágenes pedidas a la vez, un timeout).
const AUTO_RETRY_DELAYS_MS = [1500, 4000];

/**
 * Imagen de portada de la card del Feed. Frente a un <img> suelto:
 *  - carga diferida (loading="lazy") para no pedir las 12 imágenes de la página
 *    de golpe a CDNs que a veces responden lento (el navegador solo abre 6
 *    conexiones por dominio), salvo las primeras cards, que van con `eager`;
 *  - si la imagen falla, la vuelve a pedir sola (2 veces, con espera creciente);
 *  - si sigue fallando, muestra un recuadro con un botón "Reintentar" en vez del
 *    ícono de imagen rota.
 * Sin `src` (nota sin imagen) muestra el recuadro neutro, sin botón: no hay nada
 * que reintentar del lado del navegador.
 */
export default function CardImage({
  src,
  alt,
  className = '',
  eager = false,
}: {
  src?: string;
  alt: string;
  className?: string;
  /** Cards visibles al abrir la página: se piden de inmediato y con prioridad alta,
   *  sin esperar a que el scroll se acerque (lo que las hacía aparecer tarde). */
  eager?: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setAttempt(0);
    setFailed(false);
    return () => clearTimeout(retryTimer.current);
  }, [src]);

  const handleError = () => {
    if (attempt < AUTO_RETRY_DELAYS_MS.length) {
      retryTimer.current = setTimeout(() => setAttempt((a) => a + 1), AUTO_RETRY_DELAYS_MS[attempt]);
    } else {
      setFailed(true);
    }
  };

  const retryNow = () => {
    setFailed(false);
    setAttempt((a) => a + 1);
  };

  if (!src) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400">
        <Newspaper className="w-12 h-12 stroke-[1.2]" />
      </div>
    );
  }

  if (failed) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400">
        <ImageOff className="w-9 h-9 stroke-[1.3]" />
        <button
          type="button"
          onClick={retryNow}
          className="relative z-10 flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white/90 px-3 py-1.5 text-[11px] font-bold text-slate-600 shadow-sm transition hover:bg-white hover:text-[#FF5500]"
        >
          <RotateCw className="w-3 h-3" /> Reintentar imagen
        </button>
      </div>
    );
  }

  return (
    // key = attempt: al cambiar, React descarta el <img> y crea otro, que vuelve a pedir la URL.
    <img
      key={attempt}
      src={src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : 'auto'}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={handleError}
      className={className}
    />
  );
}
