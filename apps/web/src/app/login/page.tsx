"use client";

import {
  OWNER_ONLY_PERMISSIONS,
  ROLE_LABELS_ES,
  type RolePermission,
  STAFF_PERMISSIONS,
  type UserRole,
} from "@canchaya/core";
import Link from "next/link";
import { type FormEvent, useState } from "react";

interface AuthenticatedSessionView {
  userId: string;
  tenantId: string;
  role: UserRole;
  permissions: readonly RolePermission[];
}

const PERMISSION_LABELS_ES: Readonly<Record<RolePermission, string>> = {
  "calendar:view": "Ver calendario de las 4 canchas",
  "bookings:manage": "Crear, mover y cancelar reservas manualmente",
  "customers:manage": "Gestionar clientes del recinto",
  "deposits:validate": "Aprobar o rechazar comprobantes de anticipo",
  "payments:register_balance": "Registrar saldo en recinto (efectivo, transferencia, mixto)",
  "tenant:configure": "Configurar horarios, canchas, precios y reglas del recinto",
  "users:manage": "Administrar usuarios y roles del recinto",
  "reports:view_financial": "Ver reportes financieros, ocupación e ingresos",
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sessionView, setSessionView] = useState<AuthenticatedSessionView | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const payload = (await response.json()) as {
        error?: string;
        user?: { userId: string; tenantId: string; role: UserRole };
        permissions?: readonly RolePermission[];
      };

      if (!response.ok || !payload.user) {
        setErrorMessage(payload.error ?? "No se pudo iniciar sesión.");
        return;
      }

      setSessionView({
        userId: payload.user.userId,
        tenantId: payload.user.tenantId,
        role: payload.user.role,
        permissions: payload.permissions ?? [],
      });
      setPassword("");
    } catch {
      setErrorMessage("Error de conexión al intentar iniciar sesión.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setSessionView(null);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div className="space-y-2">
        <Link
          href="/"
          className="inline-flex items-center text-xs font-medium text-emerald-400 hover:text-emerald-300"
        >
          ← Volver al inicio
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Ingreso al panel · CanchaYa
        </h1>
        <p className="text-sm text-slate-300">
          Accede con tu cuenta de dueño o empleado del recinto para gestionar reservas y anticipos.
        </p>
      </div>

      {sessionView ? (
        <section className="space-y-4 rounded-2xl border border-emerald-500/30 bg-slate-900/80 p-6">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-emerald-400">
              Sesión activa
            </span>
            <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300">
              Rol: {ROLE_LABELS_ES[sessionView.role]}
            </span>
          </div>

          <div className="space-y-2 text-xs text-slate-300">
            <p className="font-medium text-white">Permisos habilitados para tu rol:</p>
            <ul className="space-y-1">
              {sessionView.permissions.map((permission) => (
                <li key={permission} className="flex items-center gap-2 text-slate-200">
                  <span className="text-emerald-400">✓</span>
                  <span>{PERMISSION_LABELS_ES[permission]}</span>
                </li>
              ))}
            </ul>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            Cerrar sesión
          </button>
        </section>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-6"
        >
          {errorMessage ? (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200"
            >
              {errorMessage}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-xs font-medium text-slate-300">
              Correo electrónico
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="empleado@recinto.co"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-xs font-medium text-slate-300">
              Contraseña
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
          >
            {isSubmitting ? "Ingresando..." : "Iniciar sesión"}
          </button>
        </form>
      )}

      <section className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4 text-xs text-slate-400">
        <p className="font-semibold text-slate-200"> Niveles de acceso (RF-16):</p>
        <p className="mt-1">
          <strong className="text-slate-200">Empleado ({STAFF_PERMISSIONS.length} permisos):</strong>{" "}
          operación diaria de reservas, calendario, validación de anticipos y cobro de saldos.
        </p>
        <p className="mt-1">
          <strong className="text-slate-200">
            Dueño ({STAFF_PERMISSIONS.length + OWNER_ONLY_PERMISSIONS.length} permisos):
          </strong>{" "}
          acceso total incluyendo configuración del recinto, usuarios y reportes financieros.
        </p>
      </section>
    </main>
  );
}

