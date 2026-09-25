'use client';

import { Toaster } from 'react-hot-toast';

export default function AppToaster() {
  return (
    <Toaster
      position="top-right"
      // El header mide 64px (sticky): se baja el contenedor para no tapar el menú de usuario.
      containerStyle={{ top: 80 }}
      toastOptions={{
        duration: 4000,
        style: {
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          background: '#ffffff',
          color: '#0f172a',
          fontSize: '13px',
          fontWeight: 600,
          boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.12)',
        },
        success: { iconTheme: { primary: '#10b981', secondary: '#ffffff' } },
        error: { iconTheme: { primary: '#ef4444', secondary: '#ffffff' } },
      }}
    />
  );
}
