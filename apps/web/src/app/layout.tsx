import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Newspaper, Video, Folder, Settings, RefreshCw, Radio } from 'lucide-react';

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
    <html lang="es" className="dark">
      <body className="bg-[#090d16] text-gray-100 min-h-screen flex flex-col antialiased">
        {/* Navigation Top Header */}
        <header className="border-b border-gray-800 bg-[#0e1424]/90 backdrop-blur sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-red-600 to-rose-400 flex items-center justify-center shadow-lg shadow-red-500/20 font-black text-white text-lg tracking-wider">
                PA
              </div>
              <div>
                <span className="font-bold text-lg tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-gray-200 to-gray-400">
                  PRENSA ABIERTA
                </span>
                <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                  🇵🇷 Puerto Rico
                </span>
              </div>
            </div>

            {/* Navigation links */}
            <nav className="flex items-center gap-1 sm:gap-2">
              <Link
                href="/"
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-800/80 text-gray-200 hover:text-white transition"
              >
                <Newspaper className="w-4 h-4 text-red-400" />
                <span>Feed PR</span>
              </Link>
              <Link
                href="/media"
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-800/80 text-gray-300 hover:text-white transition"
              >
                <Video className="w-4 h-4 text-amber-400" />
                <span>Banco de Medios</span>
              </Link>
              <Link
                href="/settings"
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-800/80 text-gray-300 hover:text-white transition"
              >
                <Settings className="w-4 h-4 text-blue-400" />
                <span>Configuración IA / WP</span>
              </Link>
            </nav>

            {/* Indicators */}
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-1.5 text-xs text-amber-300 bg-amber-500/10 px-3 py-1.5 rounded-full border border-amber-500/30">
                <span>🛡️ Sandbox Activo (WP Protegido)</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-900/80 px-3 py-1.5 rounded-full border border-gray-800">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="font-mono text-emerald-400 font-semibold">ENGINE ON</span>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content View */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
