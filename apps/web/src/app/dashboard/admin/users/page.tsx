'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users,
  UserPlus,
  Pencil,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import EngineOfflineBanner from '@/components/EngineOfflineBanner';
import UserFormModal, { type CreateUserPayload } from '@/components/UserFormModal';
import { useSession } from '@/hooks/useSession';
import { ROLE_BADGE, describeVideoLimit } from '@/lib/userDisplay';
import {
  canManageUser,
  canRegisterRole,
  clearSession,
  engineRequest,
  saveSession,
  type EngineUser,
  type UpdateUserPayload,
  type UserRole,
} from '@/lib/authClient';

type ModalState = { kind: 'create' } | { kind: 'edit'; user: EngineUser } | { kind: 'delete'; user: EngineUser } | null;
type Notice = { type: 'success' | 'error'; text: string } | null;

const ROLE_ORDER: Record<UserRole, number> = { superadmin: 0, admin: 1, editor: 2 };

function sortUsers(list: EngineUser[]): EngineUser[] {
  return [...list].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name, 'es'));
}

export default function AdminUsersPage() {
  const { session, hydrated } = useSession();
  const [users, setUsers] = useState<EngineUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [deleting, setDeleting] = useState(false);

  const expireSession = useCallback(() => {
    clearSession();
    setModal(null);
    toast.error('Tu sesión expiró o no es válida. Inicia sesión de nuevo.');
  }, []);

  const loadUsers = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const result = await engineRequest<{ items: EngineUser[] }>('/api/users', { token: session.token });
    setLoading(false);
    if (result.ok) {
      setOffline(false);
      // El rol superadmin es para uso interno de desarrollo, no un rol operativo del
      // panel: se oculta por completo de esta tabla (ni admins ni el propio superadmin
      // lo ven acá) para que nadie sepa que existe. No es una restricción de permisos
      // —el Engine lo sigue devolviendo y lo sigue administrando igual— es solo que
      // esta lista no lo muestra.
      setUsers(sortUsers(result.data.items.filter((u) => u.role !== 'superadmin')));
    } else if (result.offline) {
      setOffline(true);
    } else if (result.unauthorized) {
      expireSession();
    } else {
      setNotice({ type: 'error', text: result.error });
    }
  }, [session, expireSession]);

  useEffect(() => {
    if (session) void loadUsers();
  }, [session, loadUsers]);

  const caller = session?.user ?? null;

  const handleCreate = async (payload: CreateUserPayload): Promise<string | null> => {
    const result = await engineRequest<EngineUser>('/api/users', { method: 'POST', token: session!.token, json: payload });
    if (result.ok) {
      setModal(null);
      toast.success(`Usuario ${result.data.name} creado correctamente.`);
      await loadUsers();
      return null;
    }
    if (result.unauthorized) expireSession();
    return result.error;
  };

  const handleUpdate = async (userId: string, payload: UpdateUserPayload): Promise<string | null> => {
    const result = await engineRequest<EngineUser>(`/api/users/${userId}`, {
      method: 'PUT',
      token: session!.token,
      json: payload,
    });
    if (result.ok) {
      setModal(null);
      toast.success(`Usuario ${result.data.name} actualizado.`);
      // Si el usuario editado es el de la sesión, refresca el nombre/correo guardados.
      if (userId === session!.user.id) {
        saveSession({ ...session!, user: result.data });
      }
      await loadUsers();
      return null;
    }
    // Un 401 aquí puede ser "contraseña actual incorrecta" (el usuario sigue logueado);
    // solo se expira la sesión si el token mismo dejó de ser válido.
    if (result.unauthorized && /sesión|Authorization/i.test(result.error)) expireSession();
    return result.error;
  };

  const handleDelete = async (user: EngineUser) => {
    setDeleting(true);
    const result = await engineRequest<void>(`/api/users/${user.id}`, { method: 'DELETE', token: session!.token });
    setDeleting(false);
    if (result.ok) {
      setModal(null);
      toast.success(`Usuario ${user.name} eliminado.`);
      await loadUsers();
    } else {
      setModal(null);
      if (result.unauthorized) expireSession();
      else setNotice({ type: 'error', text: result.error });
    }
  };

  const canCreate = useMemo(
    () => !!caller && (['admin', 'editor'] as UserRole[]).some((r) => canRegisterRole(caller.role, r)),
    [caller]
  );

  if (!hydrated || !session) return null;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-full bg-gradient-to-l from-orange-50 to-transparent pointer-events-none" />
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <span className="inline-flex px-3 py-1 rounded-full bg-orange-100 text-[#FF5500] font-black text-xs tracking-wider uppercase items-center gap-1.5 shadow-sm border border-orange-200">
              <Users className="w-3.5 h-3.5" />
              <span>ADMINISTRACIÓN</span>
            </span>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Usuarios</h1>
            <p className="text-xs sm:text-sm text-slate-500 max-w-xl">
              Crea, edita y elimina las cuentas del equipo y define cuántos videos puede generar cada editor por día.
            </p>
          </div>

        </div>
      </div>

      {notice && (
        <div
          className={`flex items-start justify-between gap-3 p-3.5 rounded-2xl border text-sm font-semibold ${
            notice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <div className="flex items-start gap-2">
            {notice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
            )}
            <span>{notice.text}</span>
          </div>
          <button onClick={() => setNotice(null)} className="p-0.5 rounded hover:bg-black/5">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {!caller ? null : (
        <>
          {offline && <EngineOfflineBanner onRetry={loadUsers} retrying={loading} />}

          <div className="rounded-3xl bg-white border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
              <p className="text-sm font-black text-slate-900">
                Total de {users.length === 1 ? 'usuario' : 'usuarios'} {users.length}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={loadUsers}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  <span>Actualizar</span>
                </button>
                {canCreate && (
                  <button
                    onClick={() => setModal({ kind: 'create' })}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-[#FF5500] hover:bg-[#e04b00] transition"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Crear usuario</span>
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-black uppercase tracking-wider text-slate-500 bg-slate-50">
                    <th className="px-5 py-3">Usuario</th>
                    <th className="px-5 py-3">Rol</th>
                    <th className="px-5 py-3">Estado</th>
                    <th className="px-5 py-3">Videos por día</th>
                    <th className="px-5 py-3">Creado</th>
                    <th className="px-5 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading && users.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-10 text-center text-slate-500">
                        <Loader2 className="w-5 h-5 animate-spin inline-block mr-2 align-middle" />
                        Cargando usuarios...
                      </td>
                    </tr>
                  )}
                  {!loading && users.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-10 text-center text-slate-500">
                        No hay usuarios para mostrar.
                      </td>
                    </tr>
                  )}
                  {users.map((user) => {
                    const isSelf = user.id === caller.id;
                    const canEdit = isSelf || canManageUser(caller.role, user.role);
                    const canDelete = !isSelf && canManageUser(caller.role, user.role);
                    const badge = ROLE_BADGE[user.role];
                    return (
                      <tr key={user.id} className="hover:bg-slate-50/60 transition">
                        <td className="px-5 py-3.5">
                          <p className="font-bold text-slate-900">
                            {user.name}
                            {isSelf && (
                              <span className="ml-2 text-[10px] font-black px-1.5 py-0.5 rounded-md bg-orange-50 text-[#FF5500] border border-orange-200 uppercase">
                                Tú
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-slate-500">{user.email}</p>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${badge.className}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span
                            className={`inline-flex items-center gap-1.5 text-xs font-bold ${
                              user.active ? 'text-emerald-700' : 'text-slate-500'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${user.active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                            {user.active ? 'Activo' : 'Inactivo'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-xs font-semibold text-slate-700">{describeVideoLimit(user)}</td>
                        <td className="px-5 py-3.5 text-xs text-slate-500">
                          {new Date(user.created_at).toLocaleDateString('es-PR')}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center justify-end gap-1.5">
                            {canEdit && (
                              <button
                                onClick={() => setModal({ kind: 'edit', user })}
                                title="Editar"
                                className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                onClick={() => setModal({ kind: 'delete', user })}
                                title="Eliminar"
                                className="p-2 rounded-lg text-red-600 hover:bg-red-50 transition"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {caller && modal?.kind === 'create' && (
        <UserFormModal caller={caller} onClose={() => setModal(null)} onCreate={handleCreate} onUpdate={handleUpdate} />
      )}
      {caller && modal?.kind === 'edit' && (
        <UserFormModal
          key={modal.user.id}
          caller={caller}
          user={modal.user}
          onClose={() => setModal(null)}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
        />
      )}

      {modal?.kind === 'delete' && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white border border-slate-200 shadow-xl p-6 space-y-4">
            <div className="space-y-1.5">
              <h2 className="text-base font-black text-slate-900">Eliminar usuario</h2>
              <p className="text-sm text-slate-600">
                Vas a eliminar a <span className="font-bold text-slate-900">{modal.user.name}</span> (
                {modal.user.email}). Esta acción no se puede deshacer.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setModal(null)}
                disabled={deleting}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(modal.user)}
                disabled={deleting}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold transition disabled:opacity-60"
              >
                {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Eliminar</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
