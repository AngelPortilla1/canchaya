import {
  DEFAULT_DEPOSIT_PERCENT,
  DEFAULT_HOLD_MINUTES,
  DEFAULT_HOURLY_PRICE_COP,
  DEFAULT_SLOT_MINUTES,
  DEFAULT_TIMEZONE,
  calculateDepositCop,
} from "@canchaya/core";

export default function HomePage() {
  const depositCop = calculateDepositCop(DEFAULT_HOURLY_PRICE_COP, DEFAULT_DEPOSIT_PERCENT);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-16">
      <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
        Piloto · Pamplona, Colombia ({DEFAULT_TIMEZONE})
      </div>

      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">CanchaYa</h1>
        <p className="text-base text-slate-300">
          Nunca más pierdes una reserva por no contestar. Panel de operación y reservas por
          WhatsApp para canchas de pádel y fútbol 5.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs text-slate-400">Tarifa por bloque ({DEFAULT_SLOT_MINUTES} min)</p>
          <p className="mt-1 text-xl font-semibold text-white">
            ${DEFAULT_HOURLY_PRICE_COP.toLocaleString("es-CO")} COP
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs text-slate-400">Anticipo ({DEFAULT_DEPOSIT_PERCENT}%)</p>
          <p className="mt-1 text-xl font-semibold text-emerald-400">
            ${depositCop.toLocaleString("es-CO")} COP
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs text-slate-400">Bloqueo temporal (HOLD)</p>
          <p className="mt-1 text-xl font-semibold text-white">{DEFAULT_HOLD_MINUTES} minutos</p>
        </div>
      </section>
    </main>
  );
}

