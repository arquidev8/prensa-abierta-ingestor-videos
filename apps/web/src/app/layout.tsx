import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import HeaderNav from '@/components/HeaderNav';
import AppToaster from '@/components/AppToaster';
import AuthGate from '@/components/AuthGate';

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
        <AppToaster />

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

            {/* Nav + estado + menú de usuario: solo con sesión (sin sesión queda únicamente el logo) */}
            <HeaderNav />

          </div>
        </header>

        {/* Main Content View */}
        <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-7 w-full">
          <AuthGate>{children}</AuthGate>
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
