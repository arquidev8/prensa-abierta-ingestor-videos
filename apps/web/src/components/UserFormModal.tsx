'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { X, Loader2, AlertCircle, UserPlus, Save, Eye, EyeOff, KeyRound, Copy, Check } from 'lucide-react';
import { canManageUser, canRegisterRole, type EngineUser, type UpdateUserPayload, type UserRole } from '@/lib/authClient';
import { generatePassword } from '@/lib/passwordGenerator';

type LimitMode = 'default' | 'custom' | 'unlimited';

export interface CreateUserPayload {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

interface UserFormModalProps {
  caller: EngineUser;
  user?: EngineUser;
  onClose: () => void;
  // Crear usa `onCreate`; editar (incluida la auto-edición del perfil) usa `onUpdate`.
  onCreate?: (payload: CreateUserPayload) => Promise<string | null>;
  onUpdate?: (userId: string, payload: UpdateUserPayload) => Promise<string | null>;
}

interface FormValues {
  name: string;
  email: string;
  password: string;
  currentPassword: string;
  role: UserRole;
  active: boolean;
  limitMode: LimitMode;
  limitValue: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// bcrypt solo procesa los primeros 72 bytes; el Engine rechaza contraseñas más largas.
const MAX_PASSWORD_LENGTH = 72;

const inputClass = (hasError: boolean) =>
  `w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none disabled:opacity-60 ${
    hasError ? 'border-red-400 focus:border-red-500 bg-red-50/40' : 'border-slate-200 focus:border-[#FF5500]'
  }`;

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-[11px] font-semibold text-red-600">
      {message}
    </p>
  );
}

function initialLimitMode(user?: EngineUser): LimitMode {
  if (user?.daily_video_limit_override === undefined) return 'default';
  return user.daily_video_limit_override < 0 ? 'unlimited' : 'custom';
}

export default function UserFormModal({ caller, user, onClose, onCreate, onUpdate }: UserFormModalProps) {
  const isEdit = !!user;
  const isSelf = !!user && user.id === caller.id;
  const canAdminFields = !!user && !isSelf && canManageUser(caller.role, user.role);
  // superadmin y admin administran tanto a otros admin como a editores
  // (ver authClient.canManageUser / el Engine, models.CanManageUser), así que
  // ambos pueden reasignar el rol de a quien administran.
  const canChangeRole = canAdminFields;
  const showLimit = canAdminFields && user?.role === 'editor';

  const creatableRoles = (['admin', 'editor'] as UserRole[]).filter((r) => canRegisterRole(caller.role, r));

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    mode: 'onTouched',
    defaultValues: {
      name: user?.name ?? '',
      email: user?.email ?? '',
      password: '',
      currentPassword: '',
      role: user?.role ?? creatableRoles[0] ?? 'editor',
      active: user?.active ?? true,
      limitMode: initialLimitMode(user),
      limitValue:
        user?.daily_video_limit_override !== undefined && user.daily_video_limit_override >= 0
          ? String(user.daily_video_limit_override)
          : '5',
    },
  });

  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [passwordGenerated, setPasswordGenerated] = useState(false);
  const [copied, setCopied] = useState(false);
  // Último valor generado por "Generar contraseña", para detectar si algo (un
  // gestor de contraseñas del navegador, una extensión) reemplazó el campo por
  // detrás sin que React se entere — bcrypt compara byte a byte, así que un solo
  // carácter de diferencia entre lo copiado y lo realmente enviado basta para que
  // el login falle luego con "credenciales inválidas" sin ninguna pista de por qué.
  const lastGeneratedRef = useRef<string | null>(null);

  const emailValue = watch('email');
  const passwordValue = watch('password');
  const limitMode = watch('limitMode');

  const emailChanged = isEdit && emailValue.trim() !== user!.email;
  const needsCurrentPassword = isSelf && (emailChanged || passwordValue.length > 0);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleGeneratePassword = () => {
    const generated = generatePassword();
    lastGeneratedRef.current = generated;
    setValue('password', generated, { shouldValidate: true, shouldDirty: true });
    setPasswordGenerated(true);
    setShowPassword(true);
    setCopied(false);
  };

  const handleCopyPassword = async () => {
    const current = getValues('password');
    try {
      await navigator.clipboard.writeText(current);
      setCopied(true);
      toast.success('Contraseña copiada al portapapeles.');
    } catch {
      // Sin permiso/API de portapapeles (contexto no seguro, navegador bloqueándolo):
      // lo que el usuario pegue después NO sería esta contraseña, sino lo que ya
      // tuviera copiado antes — mejor avisarlo alto y claro que dejarlo copiar algo viejo.
      toast.error('No se pudo copiar. Selecciona la contraseña del campo y cópiala a mano (Ctrl+C).', {
        duration: 6000,
      });
    }
  };

  // Lleva el mensaje de error del Engine al campo que corresponde; si no aplica a ninguno,
  // queda en el banner general.
  const applyServerError = (message: string) => {
    if (/contraseña actual/i.test(message)) setError('currentPassword', { type: 'server', message });
    else if (/email|correo/i.test(message)) setError('email', { type: 'server', message });
    else if (/contraseña/i.test(message)) setError('password', { type: 'server', message });
    else setServerError(message);
  };

  const buildUpdatePayload = (v: FormValues): UpdateUserPayload => {
    const payload: UpdateUserPayload = {};
    if (v.name.trim() !== user!.name) payload.name = v.name.trim();
    if (emailChanged) payload.email = v.email.trim();
    if (v.password) payload.password = v.password;
    if (needsCurrentPassword) payload.current_password = v.currentPassword;
    if (canChangeRole && v.role !== user!.role) payload.role = v.role;
    if (canAdminFields && v.active !== user!.active) payload.active = v.active;
    if (showLimit) {
      const original = initialLimitMode(user);
      if (v.limitMode === 'default' && original !== 'default') {
        payload.clear_daily_video_limit_override = true;
      } else if (v.limitMode === 'unlimited' && user!.daily_video_limit_override !== -1) {
        payload.daily_video_limit_override = -1;
      } else if (v.limitMode === 'custom') {
        const n = Number(v.limitValue);
        if (n !== user!.daily_video_limit_override) payload.daily_video_limit_override = n;
      }
    }
    return payload;
  };

  const onValid = async (v: FormValues) => {
    setServerError(null);

    // Si el campo todavía "cree" tener la última contraseña generada (nadie tocó el
    // input a mano: `onChange` de abajo apaga `passwordGenerated`) pero su valor real
    // ya no coincide con lo que generamos, algo lo cambió por fuera de React (gestor
    // de contraseñas del navegador, extensión). Enviar eso igual crearía un usuario
    // con una contraseña que nadie vio ni copió — se corta acá con un mensaje claro
    // en vez de fallar silenciosamente y descubrirlo recién al intentar iniciar sesión.
    if (passwordGenerated && lastGeneratedRef.current !== null && v.password !== lastGeneratedRef.current) {
      setError('password', {
        type: 'tampered',
        message:
          'La contraseña del campo cambió por sí sola (probablemente un gestor de contraseñas del navegador). Genera una nueva o escríbela a mano antes de continuar.',
      });
      return;
    }

    let failure: string | null;
    if (isEdit) {
      const payload = buildUpdatePayload(v);
      if (Object.keys(payload).filter((k) => k !== 'current_password').length === 0) {
        setServerError('No hay cambios para guardar.');
        return;
      }
      if (!onUpdate) throw new Error('UserFormModal en modo edición requiere onUpdate');
      failure = await onUpdate(user!.id, payload);
    } else {
      if (!onCreate) throw new Error('UserFormModal en modo creación requiere onCreate');
      failure = await onCreate({ name: v.name.trim(), email: v.email.trim(), password: v.password, role: v.role });
    }
    if (failure) applyServerError(failure);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <form
        noValidate
        onSubmit={handleSubmit(onValid)}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl bg-white border border-slate-200 shadow-xl"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-3xl z-10">
          <h2 className="flex items-center gap-2 text-base font-black text-slate-900">
            {isEdit ? <Save className="w-4 h-4 text-[#FF5500]" /> : <UserPlus className="w-4 h-4 text-[#FF5500]" />}
            {isEdit ? `Editar usuario${isSelf ? ' (tu cuenta)' : ''}` : 'Crear usuario'}
          </h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="uf-name" className="text-xs font-bold text-slate-700">
              Nombre
            </label>
            <input
              id="uf-name"
              className={inputClass(!!errors.name)}
              aria-invalid={!!errors.name}
              {...register('name', {
                validate: (v) => {
                  const t = v.trim();
                  if (!t) return 'El nombre es obligatorio.';
                  if (t.length < 2) return 'El nombre debe tener al menos 2 caracteres.';
                  if (t.length > 80) return 'El nombre no puede superar los 80 caracteres.';
                  return true;
                },
              })}
            />
            <FieldError message={errors.name?.message} />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="uf-email" className="text-xs font-bold text-slate-700">
              Correo
            </label>
            <input
              id="uf-email"
              type="email"
              autoComplete="off"
              className={inputClass(!!errors.email)}
              aria-invalid={!!errors.email}
              {...register('email', {
                validate: (v) => {
                  const t = v.trim();
                  if (!t) return 'El correo es obligatorio.';
                  if (!EMAIL_PATTERN.test(t)) return 'Ingresa un correo válido (ej. nombre@dominio.com).';
                  return true;
                },
              })}
            />
            <FieldError message={errors.email?.message} />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="uf-password" className="text-xs font-bold text-slate-700">
              {isEdit ? 'Nueva contraseña (opcional)' : 'Contraseña'}
            </label>
            <div className="relative">
              <input
                id="uf-password"
                type={showPassword ? 'text' : 'password'}
                className={`${inputClass(!!errors.password)} pr-11 ${showPassword ? 'font-mono tracking-wide' : ''}`}
                placeholder={isEdit ? 'Déjala vacía para no cambiarla' : 'Mínimo 8 caracteres'}
                autoComplete="new-password"
                // Le piden a los gestores de contraseñas más comunes (LastPass, 1Password,
                // Bitwarden, Dashlane) que NO sugieran ni reemplacen el valor de este campo:
                // una contraseña generada por nosotros que un gestor pisa en silencio produce
                // exactamente el bug reportado (se copia/ve una contraseña, se guarda otra).
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
                data-dashlane-ignore="true"
                data-form-type="other"
                aria-invalid={!!errors.password}
                {...register('password', {
                  onChange: () => {
                    setPasswordGenerated(false);
                    lastGeneratedRef.current = null;
                  },
                  validate: (v) => {
                    if (!v) return isEdit ? true : 'La contraseña es obligatoria.';
                    if (v.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
                    if (v.length > MAX_PASSWORD_LENGTH) {
                      return `La contraseña no puede superar los ${MAX_PASSWORD_LENGTH} caracteres.`;
                    }
                    return true;
                  },
                })}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <FieldError message={errors.password?.message} />

            <div className="flex items-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={handleGeneratePassword}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-[#FF5500] bg-orange-50 border border-orange-200 hover:bg-[#FF5500] hover:text-white transition"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Generar contraseña</span>
              </button>
              <button
                type="button"
                onClick={handleCopyPassword}
                disabled={!passwordValue}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copiada' : 'Copiar'}</span>
              </button>
            </div>

            {passwordGenerated && (
              <p className="text-[11px] text-slate-500">
                Cópiala o anótala ahora: una vez guardado el usuario no se puede volver a ver.
              </p>
            )}
          </div>

          {needsCurrentPassword && (
            <div className="space-y-1.5 p-3 rounded-2xl bg-amber-50 border border-amber-200">
              <label htmlFor="uf-current" className="text-xs font-bold text-amber-900">
                Contraseña actual (confirmación)
              </label>
              <input
                id="uf-current"
                type="password"
                autoComplete="current-password"
                className={inputClass(!!errors.currentPassword)}
                aria-invalid={!!errors.currentPassword}
                {...register('currentPassword', {
                  validate: (v) => (needsCurrentPassword && !v ? 'Ingresa tu contraseña actual para confirmar el cambio.' : true),
                })}
              />
              <FieldError message={errors.currentPassword?.message} />
              <p className="text-[11px] text-amber-800">
                Cambiar tu propio correo o contraseña exige confirmar la contraseña actual.
              </p>
            </div>
          )}

          {!isEdit && (
            <div className="space-y-1.5">
              <label htmlFor="uf-role" className="text-xs font-bold text-slate-700">
                Rol
              </label>
              <select id="uf-role" className={inputClass(false)} {...register('role')}>
                {creatableRoles.map((r) => (
                  <option key={r} value={r}>
                    {r === 'admin' ? 'Administrador' : 'Editor'}
                  </option>
                ))}
              </select>
              {creatableRoles.length === 0 && (
                <p className="text-[11px] text-red-600">Tu rol no puede registrar usuarios.</p>
              )}
            </div>
          )}

          {canChangeRole && (
            <div className="space-y-1.5">
              <label htmlFor="uf-role" className="text-xs font-bold text-slate-700">
                Rol
              </label>
              <select id="uf-role" className={inputClass(false)} {...register('role')}>
                <option value="admin">Administrador</option>
                <option value="editor">Editor</option>
              </select>
            </div>
          )}

          {canAdminFields && (
            <label className="flex items-center gap-2.5 text-sm font-semibold text-slate-800 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-[#FF5500]" {...register('active')} />
              Cuenta activa
            </label>
          )}

          {showLimit && (
            <div className="space-y-2 p-3 rounded-2xl bg-slate-50 border border-slate-200">
              <label htmlFor="uf-limit-mode" className="text-xs font-bold text-slate-700">
                Límite diario de videos
              </label>
              <select id="uf-limit-mode" className={inputClass(false)} {...register('limitMode')}>
                <option value="default">Usar el límite por defecto del rol</option>
                <option value="custom">Límite personalizado</option>
                <option value="unlimited">Sin límite</option>
              </select>
              {limitMode === 'custom' && (
                <>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className={inputClass(!!errors.limitValue)}
                    aria-invalid={!!errors.limitValue}
                    {...register('limitValue', {
                      validate: (v) => {
                        if (getValues('limitMode') !== 'custom') return true;
                        const t = String(v).trim();
                        if (t === '') return 'Ingresa el límite diario.';
                        const n = Number(t);
                        if (!Number.isInteger(n) || n < 0) return 'Debe ser un número entero mayor o igual a 0.';
                        return true;
                      },
                    })}
                  />
                  <FieldError message={errors.limitValue?.message} />
                </>
              )}
              <p className="text-[11px] text-slate-500">Se reinicia cada día. 0 bloquea la generación de videos.</p>
            </div>
          )}

          {serverError && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
              <span>{serverError}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSubmitting || (!isEdit && creatableRoles.length === 0)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#FF5500] hover:bg-[#e04b00] text-white text-sm font-bold transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{isEdit ? 'Guardar cambios' : 'Crear usuario'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
