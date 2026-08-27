import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Newspaper, Video, Folder, Settings, RefreshCw, Radio, Flame, Sparkles } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Prensa Abierta | Pipeline Editorial & Video PR',
  description: 'Sistema automatizado de ingestión, redacción IA y generación de video para Puerto Rico',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="bg-[#F8FAFC] text-slate-900 min-h-screen flex flex-col antialiased bg-grid-mesh relative selection:bg-[#FF5500] selection:text-white">
        {/* Subtle Brand Orange Radial Glow in Background */}
        <div className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[350px] pointer-events-none orange-glow-aura -z-10" />

        {/* Navigation Top Header (Pro, Clean, Single-Line Horizontal Layout) */}
        <header className="border-b border-slate-200/80 bg-white/95 backdrop-blur-md sticky top-0 z-50 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4 flex-nowrap">
            
            {/* Left: Brand Identity (Single Line, Never Wraps) */}
            <Link href="/" className="flex items-center gap-2.5 shrink-0 group whitespace-nowrap">
              <div className="w-8 h-8 rounded-xl overflow-hidden shadow-sm group-hover:scale-105 transition duration-200 shrink-0 border border-orange-200">
                <img
                  src="/logo.png"
                  alt="Prensa Abierta Logo"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span className="font-extrabold text-base tracking-tight text-slate-900 group-hover:text-[#FF5500] transition">
                  Prensa Abierta
                </span>
                <span className="text-[10px] font-black px-1.5 py-0.5 rounded-md bg-orange-50 text-[#FF5500] border border-orange-200/80 uppercase">
                  PR
                </span>
              </div>
            </Link>

            {/* Center: Navigation Links (Clean Single-Line Tabs) */}
            <nav className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto no-scrollbar shrink-0 whitespace-nowrap">
              <Link
                href="/"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs sm:text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition whitespace-nowrap shrink-0"
              >
                <Newspaper className="w-4 h-4 text-[#FF5500] shrink-0" />
                <span>Feed PR</span>
              </Link>
              
              <Link
                href="/autopilot"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs sm:text-sm font-bold bg-orange-50 border border-orange-200 text-[#FF5500] hover:bg-[#FF5500] hover:text-white transition shadow-sm whitespace-nowrap shrink-0"
              >
                <Flame className="w-4 h-4 fill-current shrink-0" />
                <span>Piezas Listas</span>
              </Link>
              
              <Link
                href="/media"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs sm:text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition whitespace-nowrap shrink-0"
              >
                <Video className="w-4 h-4 text-amber-500 shrink-0" />
                <span>Banco de Medios</span>
              </Link>
              
              <Link
                href="/settings"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs sm:text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition whitespace-nowrap shrink-0"
              >
                <Settings className="w-4 h-4 text-slate-400 shrink-0" />
                <span>Configuración</span>
              </Link>
            </nav>

            {/* Right: Compact Status Badges (Single Line) */}
            <div className="hidden md:flex items-center gap-2 shrink-0 whitespace-nowrap">
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                Engine Activo
              </span>
              <span className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 border border-slate-200 whitespace-nowrap">
                Sandbox WP
              </span>
            </div>

          </div>
        </header>

        {/* Main Content View */}
        <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-7 w-full">
          {children}
        </main>

        {/* Modern Clean Footer */}
        <footer className="border-t border-slate-200/80 bg-white py-5 text-center text-xs text-slate-500 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="Logo" className="w-4 h-4 rounded" />
              <span className="font-bold text-slate-800">Prensa Abierta</span>
              <span>— Redacción Editorial Autónoma y Video 9:16</span>
            </div>
            <span>© {new Date().getFullYear()} Prensa Abierta PR</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
