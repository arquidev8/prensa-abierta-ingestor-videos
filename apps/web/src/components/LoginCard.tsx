'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { LogIn, Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { loginToEngine, type AuthSession } from '@/lib/authClient';

interface LoginCardProps {
  onLoggedIn: (session: AuthSession) => void;
}

interface LoginValues {
  email: string;
  password: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputClass = (hasError: boolean) =>
  `w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none ${
    hasError ? 'border-red-400 focus:border-red-500 bg-red-50/40' : 'border-slate-200 focus:border-[#FF5500]'
  }`;

export default function LoginCard({ onLoggedIn }: LoginCardProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ mode: 'onTouched', defaultValues: { email: '', password: '' } });

  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onValid = async ({ email, password }: LoginValues) => {
    setError(null);

    const result = await loginToEngine(email.trim(), password);
    if (result.ok) onLoggedIn(result.data);
    else setError(result.error);
  };

  return (
    <div className="w-full max-w-md mx-auto space-y-4">
      <form
        noValidate
        onSubmit={handleSubmit(onValid)}
        className="p-7 sm:p-8 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-5"
      >
        <div className="flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-2xl overflow-hidden border border-orange-200 shadow-sm">
            <img src="/logo.png" alt="Prensa Abierta" className="w-full h-full object-cover" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Iniciar sesión</h1>
            <p className="text-xs sm:text-sm text-slate-500">
              Ingresa con tu cuenta para acceder al panel editorial de Prensa Abierta.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="login-email" className="text-xs font-bold text-slate-700">
            Correo
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="username"
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
          {errors.email && (
            <p role="alert" className="text-[11px] font-semibold text-red-600">
              {errors.email.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="login-password" className="text-xs font-bold text-slate-700">
            Contraseña
          </label>
          <div className="relative">
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              className={`${inputClass(!!errors.password)} pr-11`}
              aria-invalid={!!errors.password}
              {...register('password', { required: 'La contraseña es obligatoria.' })}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {errors.password && (
            <p role="alert" className="text-[11px] font-semibold text-red-600">
              {errors.password.message}
            </p>
          )}
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">
            <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
            <span>{error.charAt(0).toUpperCase() + error.slice(1)}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#FF5500] hover:bg-[#e04b00] text-white text-sm font-bold transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
          <span>{isSubmitting ? 'Ingresando...' : 'Ingresar'}</span>
        </button>
      </form>

    </div>
  );
}
