"use client";

import {
  type CalendarCell,
  type CalendarCourtColumn,
  type CalendarTimeSlotRow,
  ROLE_LABELS_ES,
  type SportCode,
  shiftLocalDate,
} from "@canchaya/core";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { PendingDepositQueueItem } from "@/lib/bookings";
import type { TenantCalendarResponse } from "@/lib/calendar";
import { BookingActionModal, type BookingModalTarget } from "./BookingActionModal";
import { PendingDepositsQueue } from "./PendingDepositsQueue";

type SportFilter = "all" | SportCode;
type MobileTab = "calendar" | "queue";

interface DailyCalendarProps {
  initialData: TenantCalendarResponse;
  todayLocalDate: string;
  initialPendingDeposits?: PendingDepositQueueItem[];
}

function formatCop(amount: number): string {
  return `$${amount.toLocaleString("es-CO")}`;
}

function formatTime12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (h === 0 || h === 24) return `12:${String(m).padStart(2, "0")} a. m.`;
  if (h === 12) return `12:${String(m).padStart(2, "0")} p. m.`;
  if (h > 12) return `${h - 12}:${String(m).padStart(2, "0")} p. m.`;
  return `${h}:${String(m).padStart(2, "0")} a. m.`;
}

function formatDisplayDateEs(localDate: string, timezone: string): string {
  const [y, m, d] = localDate.split("-").map(Number);
  const utcNoon = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1, 12, 0, 0));
  const formatted = new Intl.DateTimeFormat("es-CO", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(utcNoon);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function formatHoldCountdown(holdExpiresAtUtc: string | null, nowMs: number): string {
  if (!holdExpiresAtUtc) return "--:--";
  const diffSec = Math.max(0, Math.floor((Date.parse(holdExpiresAtUtc) - nowMs) / 1000));
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  mixed: "Mixto",
};

function CalendarCellCard({
  cell,
  nowMs,
  onSelect,
}: {
  cell: CalendarCell;
  nowMs: number;
  onSelect: () => void;
}) {
  const booking = cell.booking;

  if (cell.visualState === "FREE" || !booking) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className="flex min-h-[76px] w-full flex-col items-start justify-center rounded-xl border border-dashed border-slate-700/80 bg-slate-900/30 px-3 py-2 text-left transition hover:border-emerald-500/50 hover:bg-slate-900/70"
      >
        <span className="text-xs font-semibold text-slate-300">+ Libre</span>
        <span className="mt-0.5 text-[11px] text-slate-400">{formatCop(cell.priceCop)} COP</span>
      </button>
    );
  }

  if (cell.visualState === "PENDING_VALIDATION") {
    return (
      <button
        type="button"
        onClick={onSelect}
        className="flex min-h-[76px] w-full flex-col justify-between rounded-xl border border-violet-500/50 bg-violet-500/15 px-3 py-2 text-left transition hover:bg-violet-500/25"
      >
        <div className="flex w-full items-center justify-between gap-1">
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-200">
            🧾 Por validar
          </span>
        </div>
        <p className="mt-1 truncate text-xs font-semibold text-white">
          {booking.customerName ?? "Cliente WhatsApp"}
        </p>
        <p className="text-[11px] text-violet-200/90">
          Anticipo {formatCop(booking.depositRequiredCop)} en rev.
        </p>
      </button>
    );
  }

  if (cell.visualState === "HOLD") {
    const countdown = formatHoldCountdown(booking.holdExpiresAtUtc, nowMs);
    return (
      <button
        type="button"
        onClick={onSelect}
        className="flex min-h-[76px] w-full flex-col justify-between rounded-xl border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-left transition hover:bg-amber-500/25"
      >
        <div className="flex w-full items-center justify-between gap-1">
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-200">
            ⏳ HOLD · {countdown}
          </span>
        </div>
        <p className="mt-1 truncate text-xs font-semibold text-white">
          {booking.customerName ?? "Cliente"}
        </p>
        <p className="text-[11px] text-amber-200/90">
          Falta anticipo {formatCop(booking.depositRequiredCop)}
        </p>
      </button>
    );
  }

  if (cell.visualState === "CONFIRMED") {
    return (
      <button
        type="button"
        onClick={onSelect}
        className="flex min-h-[76px] w-full flex-col justify-between rounded-xl border border-emerald-500/50 bg-emerald-500/15 px-3 py-2 text-left transition hover:bg-emerald-500/25"
      >
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-500/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-200">
          ✓ Confirmada
        </span>
        <p className="mt-1 truncate text-xs font-semibold text-white">
          {booking.customerName ?? "Cliente"}
        </p>
        <p className="text-[11px] text-emerald-200/90">Saldo: {formatCop(booking.balanceDueCop)}</p>
      </button>
    );
  }

  if (cell.visualState === "COMPLETED") {
    const methodLabel = booking.balancePaymentMethod
      ? (PAYMENT_METHOD_LABELS[booking.balancePaymentMethod] ?? "")
      : "";
    return (
      <button
        type="button"
        onClick={onSelect}
        className="flex min-h-[76px] w-full flex-col justify-between rounded-xl border border-teal-700/60 bg-teal-950/50 px-3 py-2 text-left transition hover:bg-teal-900/50"
      >
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-teal-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal-200">
          ✓✓ Jugada
        </span>
        <p className="mt-1 truncate text-xs font-semibold text-slate-100">
          {booking.customerName ?? "Cliente"}
        </p>
        <p className="text-[11px] text-teal-300/80">
          Pagado {formatCop(booking.totalPriceCop)}
          {methodLabel ? ` (${methodLabel})` : ""}
        </p>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex min-h-[76px] w-full flex-col justify-between rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-left transition hover:bg-rose-500/20"
    >
      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-200">
        ✕ No asistió
      </span>
      <p className="mt-1 truncate text-xs font-semibold text-rose-100">
        {booking.customerName ?? "Cliente"}
      </p>
      <p className="text-[11px] text-rose-200/80">
        Anticipo: {formatCop(booking.depositRequiredCop)}
      </p>
    </button>
  );
}

export function DailyCalendar({
  initialData,
  todayLocalDate,
  initialPendingDeposits = [],
}: DailyCalendarProps) {
  const router = useRouter();
  const [data, setData] = useState<TenantCalendarResponse>(initialData);
  const [pendingDeposits, setPendingDeposits] =
    useState<PendingDepositQueueItem[]>(initialPendingDeposits);
  const [isLoadingDeposits, setIsLoadingDeposits] = useState<boolean>(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("calendar");
  const [selectedDate, setSelectedDate] = useState<string>(initialData.grid.localDate);
  const [sportFilter, setSportFilter] = useState<SportFilter>("all");
  const [mobileSport, setMobileSport] = useState<SportCode>("padel");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [modalTarget, setModalTarget] = useState<BookingModalTarget | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  function openCellModal(
    court: CalendarCourtColumn,
    slot: CalendarTimeSlotRow,
    cell: CalendarCell,
  ) {
    setSuccessMessage(null);
    if (cell.booking) {
      setModalTarget({
        mode: "detail",
        court,
        slot,
        booking: cell.booking,
        visualState: cell.visualState,
        priceCop: cell.priceCop,
      });
      return;
    }
    if (cell.visualState === "FREE") {
      setModalTarget({
        mode: "create",
        court,
        slot,
        priceCop: cell.priceCop,
      });
    }
  }

  async function loadPendingDeposits() {
    setIsLoadingDeposits(true);
    try {
      const response = await fetch("/api/panel/deposits", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { deposits?: PendingDepositQueueItem[] };
      if (Array.isArray(payload.deposits)) {
        setPendingDeposits(payload.deposits);
      }
    } catch {
      // Keep current queue on transient error
    } finally {
      setIsLoadingDeposits(false);
    }
  }

  async function loadDate(nextDate: string) {
    setSelectedDate(nextDate);
    setModalTarget(null);
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const [response] = await Promise.all([
        fetch(`/api/panel/calendar?date=${encodeURIComponent(nextDate)}`, {
          method: "GET",
          cache: "no-store",
        }),
        loadPendingDeposits(),
      ]);

      if (response.status === 401) {
        router.push("/login");
        return;
      }

      const payload = (await response.json()) as TenantCalendarResponse & { error?: string };
      if (!response.ok || !payload.grid) {
        setErrorMessage(payload.error ?? "No se pudo cargar el calendario.");
        return;
      }

      setData(payload);
    } catch {
      setErrorMessage("Error de conexión al consultar el calendario.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const { grid } = data;
  const padelCount = grid.courts.filter((c) => c.sportCode === "padel").length;
  const futbolCount = grid.courts.filter((c) => c.sportCode === "futbol_5").length;

  const desktopCourts = useMemo(() => {
    if (sportFilter === "all") return grid.courts;
    return grid.courts.filter((c) => c.sportCode === sportFilter);
  }, [grid.courts, sportFilter]);

  const mobileCourts = useMemo(() => {
    if (sportFilter === "all") {
      return grid.courts.filter((c) => c.sportCode === mobileSport);
    }
    return grid.courts.filter((c) => c.sportCode === sportFilter);
  }, [grid.courts, sportFilter, mobileSport]);

  const totalPendingCount = Math.max(pendingDeposits.length, grid.pendingValidationCount);

  const isToday = selectedDate === todayLocalDate;
  const displayDate = formatDisplayDateEs(selectedDate, grid.timezone);

  return (
    <div className="min-h-screen bg-slate-950 pb-20 text-slate-100 lg:pb-8">
      {/* Top Bar */}
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 text-lg">
              🏟️
            </span>
            <div>
              <h1 className="text-sm font-bold text-white sm:text-base">{data.tenantName}</h1>
              <p className="text-xs text-slate-400">
                Rol: {ROLE_LABELS_ES[data.userRole]} · Hora {grid.timezone}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSuccessMessage(null);
                setModalTarget({ mode: "create" });
              }}
              className="hidden rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 sm:inline-flex"
            >
              + Nueva reserva
            </button>
            {data.userRole === "owner" ? (
              <span
                title="Disponible en CY-040"
                className="hidden rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-400 sm:inline-flex"
              >
                ⚙️ Configuración
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => loadDate(selectedDate)}
              disabled={isLoading}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-500 disabled:opacity-50"
            >
              {isLoading ? "Cargando..." : "↻ Actualizar"}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-rose-500/60 hover:text-rose-200"
            >
              Salir
            </button>
          </div>
        </div>

        {/* Date & Sport Controls */}
        <div className="mx-auto flex max-w-7xl flex-col gap-2 border-t border-slate-800/80 px-4 py-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-start">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Día anterior"
                onClick={() => loadDate(shiftLocalDate(selectedDate, -1))}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-sm font-semibold text-white hover:border-slate-500"
              >
                ◀
              </button>
              <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5">
                <span className="text-xs font-semibold text-white sm:text-sm">{displayDate}</span>
                {isToday ? (
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                    Hoy
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="Día siguiente"
                onClick={() => loadDate(shiftLocalDate(selectedDate, 1))}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-sm font-semibold text-white hover:border-slate-500"
              >
                ▶
              </button>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="date"
                aria-label="Seleccionar fecha"
                value={selectedDate}
                onChange={(e) => {
                  if (e.target.value) loadDate(e.target.value);
                }}
                className="h-9 rounded-lg border border-slate-700 bg-slate-900 px-2 text-xs text-slate-200"
              />
              {!isToday ? (
                <button
                  type="button"
                  onClick={() => loadDate(todayLocalDate)}
                  className="h-9 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25"
                >
                  Ir a Hoy
                </button>
              ) : null}
            </div>
          </div>

          {/* Mobile Sport Selector (2 columns per sport) */}
          <div className="flex items-center gap-1.5 lg:hidden">
            <button
              type="button"
              onClick={() => {
                setSportFilter("all");
                setMobileSport("padel");
              }}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                mobileSport === "padel"
                  ? "bg-emerald-500 text-slate-950"
                  : "border border-slate-700 bg-slate-900 text-slate-300"
              }`}
            >
              🎾 Pádel ({padelCount})
            </button>
            <button
              type="button"
              onClick={() => {
                setSportFilter("all");
                setMobileSport("futbol_5");
              }}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                mobileSport === "futbol_5"
                  ? "bg-emerald-500 text-slate-950"
                  : "border border-slate-700 bg-slate-900 text-slate-300"
              }`}
            >
              ⚽ Fútbol 5 ({futbolCount})
            </button>
          </div>

          {/* Desktop Filter */}
          <div className="hidden items-center gap-1.5 lg:flex">
            <button
              type="button"
              onClick={() => setSportFilter("all")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                sportFilter === "all"
                  ? "bg-emerald-500 text-slate-950"
                  : "border border-slate-700 bg-slate-900 text-slate-300"
              }`}
            >
              Todas ({grid.courts.length})
            </button>
            <button
              type="button"
              onClick={() => setSportFilter("padel")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                sportFilter === "padel"
                  ? "bg-emerald-500 text-slate-950"
                  : "border border-slate-700 bg-slate-900 text-slate-300"
              }`}
            >
              🎾 Pádel ({padelCount})
            </button>
            <button
              type="button"
              onClick={() => setSportFilter("futbol_5")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                sportFilter === "futbol_5"
                  ? "bg-emerald-500 text-slate-950"
                  : "border border-slate-700 bg-slate-900 text-slate-300"
              }`}
            >
              ⚽ Fútbol 5 ({futbolCount})
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 py-4">
        {errorMessage ? (
          <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {errorMessage}
          </div>
        ) : null}

        {/* Status Legend */}
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
          <span className="rounded-md border border-dashed border-slate-700 px-2 py-0.5">
            + Libre
          </span>
          <span className="rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-amber-200">
            ⏳ HOLD (15 min)
          </span>
          <span className="rounded-md border border-violet-500/40 bg-violet-500/15 px-2 py-0.5 text-violet-200">
            🧾 Por validar ({totalPendingCount})
          </span>
          <span className="rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-emerald-200">
            ✓ Confirmada
          </span>
          <span className="rounded-md border border-teal-700/60 bg-teal-950/60 px-2 py-0.5 text-teal-200">
            ✓✓ Jugada
          </span>
          <span className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-rose-200">
            ✕ No asistió
          </span>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          {/* Mobile Queue View when tab === 'queue' */}
          {mobileTab === "queue" ? (
            <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 lg:hidden">
              <PendingDepositsQueue
                items={pendingDeposits}
                isLoading={isLoadingDeposits}
                onRefresh={() => void loadPendingDeposits()}
                onValidated={(message) => {
                  setSuccessMessage(message);
                  void loadDate(selectedDate);
                }}
              />
            </section>
          ) : null}

          {/* Calendar Grid */}
          <section
            className={`rounded-2xl border border-slate-800 bg-slate-900/40 p-3 sm:p-4 ${
              mobileTab === "queue" ? "hidden lg:block" : ""
            }`}
          >
            {grid.isClosed ? (
              <div className="py-12 text-center">
                <p className="text-base font-semibold text-white">Recinto cerrado este día</p>
                <p className="mt-1 text-sm text-slate-400">
                  No hay franjas horarias configuradas para esta fecha.
                </p>
              </div>
            ) : grid.slots.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-base font-semibold text-white">Sin franjas disponibles</p>
              </div>
            ) : (
              <>
                {/* Mobile 2-column grid */}
                <div className="space-y-2 lg:hidden">
                  <div className="grid grid-cols-[64px_1fr_1fr] gap-2 border-b border-slate-800 pb-2 text-xs font-semibold text-slate-300">
                    <div>Hora</div>
                    {mobileCourts.map((court) => (
                      <div key={court.id} className="truncate">
                        {court.sportCode === "padel" ? "🎾" : "⚽"} {court.name}
                      </div>
                    ))}
                  </div>

                  {grid.slots.map((slot) => (
                    <div
                      key={slot.localStartTime}
                      className="grid grid-cols-[64px_1fr_1fr] items-stretch gap-2"
                    >
                      <div className="flex flex-col justify-center text-xs">
                        <span className="font-bold text-white">{slot.localStartTime}</span>
                        <span className="text-[10px] text-slate-400">
                          {formatTime12h(slot.localStartTime)}
                        </span>
                      </div>
                      {mobileCourts.map((court) => {
                        const cell = slot.cellsByCourtId[court.id];
                        if (!cell) return null;
                        return (
                          <CalendarCellCard
                            key={court.id}
                            cell={cell}
                            nowMs={nowMs}
                            onSelect={() => openCellModal(court, slot, cell)}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>

                {/* Desktop 4-column parallel grid */}
                <div className="hidden space-y-2 lg:block">
                  <div
                    className="grid gap-3 border-b border-slate-800 pb-2.5 text-xs font-semibold text-slate-200"
                    style={{
                      gridTemplateColumns: `80px repeat(${Math.max(1, desktopCourts.length)}, minmax(0, 1fr))`,
                    }}
                  >
                    <div>Hora</div>
                    {desktopCourts.map((court) => (
                      <div key={court.id} className="flex items-center gap-1.5 truncate">
                        <span>{court.sportCode === "padel" ? "🎾" : "⚽"}</span>
                        <span className="truncate">{court.name}</span>
                      </div>
                    ))}
                  </div>

                  {grid.slots.map((slot) => (
                    <div
                      key={slot.localStartTime}
                      className="grid items-stretch gap-3"
                      style={{
                        gridTemplateColumns: `80px repeat(${Math.max(1, desktopCourts.length)}, minmax(0, 1fr))`,
                      }}
                    >
                      <div className="flex flex-col justify-center">
                        <span className="text-sm font-bold text-white">{slot.localStartTime}</span>
                        <span className="text-[11px] text-slate-400">
                          {formatTime12h(slot.localStartTime)}
                        </span>
                      </div>
                      {desktopCourts.map((court) => {
                        const cell = slot.cellsByCourtId[court.id];
                        if (!cell) return null;
                        return (
                          <CalendarCellCard
                            key={court.id}
                            cell={cell}
                            nowMs={nowMs}
                            onSelect={() => openCellModal(court, slot, cell)}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* Desktop Right Sidebar: Pending Queue */}
          <aside className="hidden space-y-3 lg:block">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <PendingDepositsQueue
                items={pendingDeposits}
                isLoading={isLoadingDeposits}
                onRefresh={() => void loadPendingDeposits()}
                onValidated={(message) => {
                  setSuccessMessage(message);
                  void loadDate(selectedDate);
                }}
              />
            </div>
          </aside>
        </div>
      </main>

      {/* Booking Create / Move / Cancel / Deposit Validation Modal */}
      <BookingActionModal
        target={modalTarget}
        grid={grid}
        pendingDeposits={pendingDeposits}
        onClose={() => setModalTarget(null)}
        onSuccess={(message) => {
          setModalTarget(null);
          setSuccessMessage(message);
          void loadDate(selectedDate);
        }}
      />

      {successMessage ? (
        <div className="fixed bottom-20 right-4 z-30 rounded-xl border border-emerald-500/40 bg-emerald-950/95 px-4 py-2.5 text-xs font-medium text-emerald-200 shadow-lg lg:bottom-6">
          {successMessage}
        </div>
      ) : null}

      {/* Mobile Bottom Navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-800 bg-slate-950/95 backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-3 text-xs font-medium">
          <button
            type="button"
            onClick={() => setMobileTab("calendar")}
            className={`flex flex-col items-center justify-center gap-0.5 py-2.5 ${
              mobileTab === "calendar" ? "text-emerald-400" : "text-slate-400"
            }`}
          >
            <span>📅</span>
            <span>Calendario</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileTab("queue")}
            className={`flex flex-col items-center justify-center gap-0.5 py-2.5 ${
              mobileTab === "queue"
                ? "text-violet-300"
                : totalPendingCount > 0
                  ? "text-violet-200"
                  : "text-slate-400"
            }`}
          >
            <span>🧾</span>
            <span>Pendientes ({totalPendingCount})</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSuccessMessage(null);
              setModalTarget({ mode: "create" });
            }}
            className="flex flex-col items-center justify-center gap-0.5 py-2.5 text-emerald-300 hover:text-emerald-200"
          >
            <span>➕</span>
            <span>Nueva</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
