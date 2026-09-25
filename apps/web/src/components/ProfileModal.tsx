'use client';

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, X } from 'lucide-react';
import toast from 'react-hot-toast';
import UserAvatar from '@/components/UserAvatar';
import UserFormModal from '@/components/UserFormModal';
import { clearSession, saveSession, type AuthSession, type UpdateUserPayload } from '@/lib/authClient';
import { updateOwnProfile } from '@/lib/profileApi';
import { ROLE_BADGE, describeVideoLimit } from '@/lib/userDisplay';

interface ProfileModalProps {
  session: AuthSession;
  onClose: () => void;
}

/**
 * Perfil del usuario logueado: datos de solo lectura y botón "Editar perfil", que abre el
 * formulario de usuarios en modo auto-edición (nombre, correo y contraseña; cambiar correo o
 * contraseña pide confirmar la contraseña actual).
 */
export default function ProfileModal({ session, onClose }: ProfileModalProps) {
  const { user } = session;
  const [editing, setEditing] = useState(false);
  const badge = ROLE_BADGE[user.role];

  const handleUpdate = async (_userId: string, payload: UpdateUserPayload): Promise<string | null> => {
    const result = await updateOwnProfile(session, payload);
    if (!result.ok) {
      if (result.sessionExpired) {
        clearSession();
        toast.error('Tu sesión expiró o no es válida. Inicia sesión de nuevo.');
      }
      return result.error;
    }
    // El header y el resto de la app leen la sesión: al guardarla se refrescan solos.
    saveSession({ ...session, user: result.user });
    toast.success(payload.password ? 'Perfil y contraseña actualizados.' : 'Perfil actualizado.');
    setEditing(false);
    return null;
  };

  const rows: [string, React.ReactNode][] = [
    ['Correo', user.email],
    ['Estado', user.active ? 'Activo' : 'Inactivo'],
    ['Videos por día', describeVideoLimit(user)],
    ['Miembro desde', new Date(user.created_at).toLocaleDateString('es-PR', { day: 'numeric', month: 'long', year: 'numeric' })],
  ];

  // Portal a <body>: el header tiene backdrop-filter, que hace de "containing block" para
  // los `fixed` descendientes y dejaría el modal atrapado (y cortado) dentro de sus 64px.
  return createPortal(
    editing ? (
      <UserFormModal caller={user} user={user} onClose={() => setEditing(false)} onUpdate={handleUpdate} />
    ) : (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
        <div
          role="dialog"
          aria-label="Mi perfil"
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-3xl bg-white border border-slate-200 shadow-xl overflow-hidden"
        >
          <div className="relative px-6 pt-6 pb-5 bg-gradient-to-b from-orange-50 to-white">
            <button onClick={onClose} aria-label="Cerrar" className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-white/70 text-slate-500">
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-4">
              <UserAvatar name={user.name} size="lg" />
              <div className="min-w-0">
                <h2 className="text-lg font-black text-slate-900 truncate">{user.name}</h2>
                <span className={`inline-block mt-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border ${badge.className}`}>
                  {badge.label}
                </span>
              </div>
            </div>
          </div>

          <dl className="px-6 py-4 divide-y divide-slate-100">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</dt>
                <dd className="font-semibold text-slate-800 text-right break-all">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition"
            >
              Cerrar
            </button>
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#FF5500] hover:bg-[#e04b00] text-white text-sm font-bold transition"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>Editar perfil</span>
            </button>
          </div>
        </div>
      </div>
    ),
    document.body
  );
}
