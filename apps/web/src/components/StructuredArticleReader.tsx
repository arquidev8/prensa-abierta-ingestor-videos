'use client';

import React from 'react';
import { Quote } from 'lucide-react';

interface StructuredArticleReaderProps {
  content: string;
  isAIRewritten?: boolean;
}

export default function StructuredArticleReader({
  content,
  isAIRewritten = false,
}: StructuredArticleReaderProps) {
  if (!content || content.trim() === '') {
    return <p className="text-sm text-slate-400 italic">No hay contenido disponible para este artículo.</p>;
  }

  // Extraer texto limpio sin tags HTML para garantizar un troceado perfecto en párrafos cortos
  const cleanText = content
    .replace(/<p>/gi, '\n\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<[^>]*>?/gm, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Dividir por oraciones completas
  const sentences = cleanText
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length <= 1) {
    return (
      <div className="p-4 rounded-xl bg-orange-50/60 border-l-4 border-[#FF5500]">
        <p className="text-sm sm:text-base text-slate-900 leading-relaxed font-medium">{cleanText}</p>
      </div>
    );
  }

  // Agrupar en párrafos cortos de 2 oraciones máximo para máxima legibilidad
  const paragraphs: { type: 'lead' | 'quote' | 'normal'; text: string }[] = [];
  let currentGroup: string[] = [];

  sentences.forEach((sentence, index) => {
    // Si es una cita directa
    if (
      (sentence.startsWith('"') || sentence.startsWith('“') || sentence.startsWith('«') || sentence.includes('", afirmó') || sentence.includes('”, dijo')) &&
      sentence.length > 25
    ) {
      if (currentGroup.length > 0) {
        paragraphs.push({
          type: paragraphs.length === 0 ? 'lead' : 'normal',
          text: currentGroup.join(' '),
        });
        currentGroup = [];
      }
      paragraphs.push({ type: 'quote', text: sentence });
      return;
    }

    currentGroup.push(sentence);

    // Cortar cada 2 oraciones (o 3 si son oraciones muy cortas)
    const shouldBreak =
      currentGroup.length >= 2 ||
      currentGroup.join(' ').length > 200 ||
      index === sentences.length - 1;

    if (shouldBreak) {
      paragraphs.push({
        type: paragraphs.length === 0 ? 'lead' : 'normal',
        text: currentGroup.join(' '),
      });
      currentGroup = [];
    }
  });

  return (
    <div className="space-y-3.5">
      {paragraphs.map((p, idx) => {
        if (p.type === 'lead') {
          return (
            <div
              key={idx}
              className="p-4 rounded-2xl bg-gradient-to-r from-orange-50 via-amber-50/30 to-white border-l-4 border-[#FF5500] shadow-sm border border-orange-100/80"
            >
              <span className="text-[10.5px] font-black uppercase tracking-wider text-[#FF5500] block mb-1">
                Entradilla / Apertura
              </span>
              <p className="text-sm sm:text-base font-bold text-slate-900 leading-relaxed">
                {p.text}
              </p>
            </div>
          );
        }

        if (p.type === 'quote') {
          return (
            <div
              key={idx}
              className="p-4 rounded-xl bg-amber-50 border-l-4 border-amber-500 my-2.5 shadow-sm flex items-start gap-3 border border-amber-100"
            >
              <Quote className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs sm:text-sm font-semibold text-amber-950 leading-relaxed italic">
                {p.text}
              </p>
            </div>
          );
        }

        return (
          <div
            key={idx}
            className="p-3.5 rounded-xl bg-white border border-slate-200/90 hover:border-slate-300 transition shadow-[0_2px_4px_rgba(0,0,0,0.02)]"
          >
            <p className="text-xs sm:text-sm text-slate-800 leading-relaxed font-normal">
              {p.text}
            </p>
          </div>
        );
      })}
    </div>
  );
}
