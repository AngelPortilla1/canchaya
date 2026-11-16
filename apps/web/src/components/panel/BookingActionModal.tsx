"use client";

import type {
  CalendarCellBookingSummary,
  CalendarCourtColumn,
  CalendarTimeSlotRow,
  DailyCalendarGrid,
} from "@canchaya/core";
import { useEffect, useMemo, useState } from "react";
import type { TenantCalendarResponse } from "@/lib/calendar";

interface CustomerOption {
  id: string;
  full_name: string;
  phone: string;
}

export interface BookingModalTarget {
  mode: "create" | "detail";
  court?: CalendarCourtColumn;
  slot?: CalendarTimeSlotRow;
  booking?: CalendarCellBookingSummary;
  visualState?: string;
  priceCop?: number;
}

interface BookingActionModalProps {
  target: BookingModalTarget | null;
  grid: DailyCalendarGrid;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

const QUICK_CANCEL_REASONS = [
  "Lluvia o mal clima",
  "Solicitud del cliente",
  "Error al registrar",
] as const;

function formatCop(amount: number): string {
  return `$${amount.toLocaleString("es-CO")}`;
}

function getAvailableSlotsForCourt(
  targetGrid: DailyCalendarGrid,
  courtId: string,
): Array<{ localStartTime: string; localEndTime: string }> {
  const options: Array<{ localStartTime: string; localEndTime: string }> = [];
  for (const row of targetGrid.slots) {
    const cell = row.cellsByCourtId[courtId];
    if (cell?.visualState === "FREE") {
      options.push({
        localStartTime: row.localStartTime,
        localEndTime: row.localEndTime,
      });
    }
  }
  return options;
}

export function BookingActionModal({ target, grid, onClose, onSuccess }: BookingActionModalProps) {
  const [subMode, setSubMode] = useState<"view" | "move" | "cancel">("view");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Shared date / court / time selection for Create or Move
  const [targetDate, setTargetDate] = useState(grid.localDate);
  const [targetGrid, setTargetGrid] = useState<DailyCalendarGrid>(grid);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [selectedCourtId, setSelectedCourtId] = useState("");
  const [selectedStartTime, setSelectedStartTime] = useState("");

  // Create customer / search state
  const [customerQuery, setCustomerQuery] = useState("");
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [isSearchingCustomers, setIsSearchingCustomers] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);
  const [notes, setNotes] = useState("");

  // Cancel state
  const [cancellationReason, setCancellationReason] = useState("");

  useEffect(() => {
    if (!target) return;
    setSubMode("view");
    setErrorMessage(null);
    setIsSubmitting(false);
    setTargetDate(grid.localDate);
    setTargetGrid(grid);
    setNotes("");
    setCancellationReason("");
    setSelectedCustomer(null);
    setCustomerQuery("");
    setShowNewCustomerForm(false);
    setNewCustomerName("");
    setNewCustomerPhone("");

    const defaultCourtId = target.court?.id ?? grid.courts[0]?.id ?? "";
    setSelectedCourtId(defaultCourtId);

    if (target.mode === "create") {
      if (target.slot?.localStartTime) {
        setSelectedStartTime(target.slot.localStartTime);
      } else {
        const firstFree = getAvailableSlotsForCourt(grid, defaultCourtId)[0];
        setSelectedStartTime(firstFree?.localStartTime ?? "");
      }
    } else {
      const firstFree = getAvailableSlotsForCourt(grid, defaultCourtId)[0];
      setSelectedStartTime(firstFree?.localStartTime ?? "");
    }
  }, [target, grid]);

  // Load availability when targetDate changes
  useEffect(() => {
    if (!target) return;
    if (targetDate === grid.localDate) {
      setTargetGrid(grid);
      return;
    }

    let cancelled = false;
    setIsLoadingSlots(true);
    fetch(`/api/panel/calendar?date=${encodeURIComponent(targetDate)}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("No se pudo consultar la disponibilidad de esa fecha.");
        return (await res.json()) as TenantCalendarResponse;
      })
      .then((data) => {
        if (!cancelled) {
          setTargetGrid(data.grid);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : "Error cargando horarios.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingSlots(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [target, targetDate, grid]);

  const availableSlots = useMemo(
    () => (selectedCourtId ? getAvailableSlotsForCourt(targetGrid, selectedCourtId) : []),
    [targetGrid, selectedCourtId],
  );

  // Keep selectedStartTime valid when availableSlots change
  useEffect(() => {
    if (!target) return;
    if (
      target.mode === "create" &&
      target.slot?.localStartTime &&
      targetDate === grid.localDate &&
      selectedCourtId === target.court?.id
    ) {
      return;
    }
    if (!availableSlots.some((s) => s.localStartTime === selectedStartTime)) {
      setSelectedStartTime(availableSlots[0]?.localStartTime ?? "");
    }
  }, [availableSlots, selectedStartTime, target, targetDate, grid.localDate, selectedCourtId]);

  // Search customers in create mode
  useEffect(() => {
    if (!target || target.mode !== "create") return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setIsSearchingCustomers(true);
      fetch(`/api/panel/customers?q=${encodeURIComponent(customerQuery.trim())}`, {
        cache: "no-store",
      })
        .then(async (res) => {
          if (!res.ok) throw new Error("No se pudieron buscar clientes.");
          return (await res.json()) as { customers: CustomerOption[] };
        })
        .then((data) => {
          if (!cancelled) setCustomers(data.customers);
        })
        .catch(() => {
          if (!cancelled) setCustomers([]);
        })
        .finally(() => {
          if (!cancelled) setIsSearchingCustomers(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [target, customerQuery]);

  if (!target) return null;

  const handleCreateCustomer = async () => {
    setErrorMessage(null);
    setIsCreatingCustomer(true);
    try {
      const res = await fetch("/api/panel/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: newCustomerName,
          phone: newCustomerPhone,
        }),
      });
      const payload = (await res.json()) as { customer?: CustomerOption; error?: string };
      if (!res.ok || !payload.customer) {
        setErrorMessage(payload.error ?? "No se pudo crear el cliente.");
        return;
      }
      setSelectedCustomer(payload.customer);
      setCustomers((prev) => [payload.customer!, ...prev]);
      setShowNewCustomerForm(false);
      setNewCustomerName("");
      setNewCustomerPhone("");
    } catch {
      setErrorMessage("Error de conexión al crear el cliente.");
    } finally {
      setIsCreatingCustomer(false);
    }
  };

  const handleCreateBooking = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedCustomer) {
      setErrorMessage("Selecciona o crea un cliente para la reserva.");
      return;
    }
    if (!selectedCourtId || !selectedStartTime) {
      setErrorMessage("Selecciona una cancha y un horario disponible.");
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/panel/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courtId: selectedCourtId,
          customerId: selectedCustomer.id,
          localDate: targetDate,
          localStartTime: selectedStartTime,
          notes,
        }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErrorMessage(payload.error ?? "No se pudo crear la reserva.");
        return;
      }
      onSuccess("Reserva creada en estado HOLD (15 min para validar anticipo).");
    } catch {
      setErrorMessage("Error de conexión al crear la reserva.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMoveBooking = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!target.booking) return;
    if (!selectedCourtId || !selectedStartTime) {
      setErrorMessage("Selecciona la cancha y un horario disponible.");
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/panel/bookings/${target.booking.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newCourtId: selectedCourtId,
          localDate: targetDate,
          localStartTime: selectedStartTime,
        }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErrorMessage(payload.error ?? "No se pudo mover la reserva.");
        return;
      }
      onSuccess("Reserva movida correctamente.");
    } catch {
      setErrorMessage("Error de conexión al mover la reserva.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelBooking = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!target.booking) return;
    if (!cancellationReason.trim()) {
      setErrorMessage("El motivo de cancelación es obligatorio.");
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/panel/bookings/${target.booking.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cancellationReason: cancellationReason.trim(),
        }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErrorMessage(payload.error ?? "No se pudo cancelar la reserva.");
        return;
      }
      onSuccess("Reserva cancelada correctamente.");
    } catch {
      setErrorMessage("Error de conexión al cancelar la reserva.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const booking = target.booking;
  const canModifyBooking =
    booking !== undefined && (booking.status === "HOLD" || booking.status === "CONFIRMED");

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-emerald-400">
              {target.mode === "create"
                ? "Nueva reserva manual (HOLD)"
                : (target.court?.name ?? "Detalle de reserva")}
            </p>
            <h3 className="text-lg font-bold text-white">
              {target.slot
                ? `${target.slot.localStartTime} – ${target.slot.localEndTime}`
                : targetDate}
            </h3>
            {target.slot ? <p className="text-xs text-slate-400">{grid.localDate}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
          >
            ✕ Cerrar
          </button>
        </div>

        {errorMessage ? (
          <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {errorMessage}
          </div>
        ) : null}

        {target.mode === "create" ? (
          <form onSubmit={handleCreateBooking} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block text-xs text-slate-300">
                Fecha
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white"
                  required
                />
              </label>
              <label className="block text-xs text-slate-300">
                Cancha
                <select
                  value={selectedCourtId}
                  onChange={(e) => setSelectedCourtId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white"
                  required
                >
                  {targetGrid.courts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-slate-300">
                Hora disponible
                <select
                  value={selectedStartTime}
                  onChange={(e) => setSelectedStartTime(e.target.value)}
                  disabled={isLoadingSlots || availableSlots.length === 0}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white disabled:opacity-50"
                  required
                >
                  {availableSlots.length === 0 ? (
                    <option value="">Sin horarios libres</option>
                  ) : (
                    availableSlots.map((s) => (
                      <option key={s.localStartTime} value={s.localStartTime}>
                        {s.localStartTime} – {s.localEndTime}
                      </option>
                    ))
                  )}
                </select>
              </label>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-200">Cliente</span>
                <button
                  type="button"
                  onClick={() => setShowNewCustomerForm((v) => !v)}
                  className="text-xs font-medium text-emerald-400 hover:text-emerald-300"
                >
                  {showNewCustomerForm ? "Buscar existente" : "+ Crear nuevo cliente"}
                </button>
              </div>

              {selectedCustomer ? (
                <div className="mt-2 flex items-center justify-between rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs">
                  <div>
                    <p className="font-semibold text-white">{selectedCustomer.full_name}</p>
                    <p className="text-emerald-200">{selectedCustomer.phone}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedCustomer(null)}
                    className="text-slate-300 hover:text-white"
                  >
                    Cambiar
                  </button>
                </div>
              ) : showNewCustomerForm ? (
                <div className="mt-2 space-y-2">
                  <input
                    type="text"
                    placeholder="Nombre completo"
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white"
                  />
                  <input
                    type="tel"
                    placeholder="Teléfono (ej. 3001234567)"
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white"
                  />
                  <button
                    type="button"
                    disabled={isCreatingCustomer}
                    onClick={handleCreateCustomer}
                    className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {isCreatingCustomer ? "Guardando cliente..." : "Guardar y seleccionar cliente"}
                  </button>
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  <input
                    type="search"
                    placeholder="Buscar por nombre o teléfono..."
                    value={customerQuery}
                    onChange={(e) => setCustomerQuery(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white"
                  />
                  <div className="max-h-32 space-y-1 overflow-y-auto">
                    {isSearchingCustomers ? (
                      <p className="text-xs text-slate-400">Buscando...</p>
                    ) : customers.length === 0 ? (
                      <p className="text-xs text-slate-400">
                        Sin resultados. Puedes crear un cliente nuevo arriba.
                      </p>
                    ) : (
                      customers.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelectedCustomer(c)}
                          className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-1.5 text-left text-xs hover:border-emerald-500/40"
                        >
                          <span className="font-medium text-white">{c.full_name}</span>
                          <span className="text-slate-400">{c.phone}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <label className="block text-xs text-slate-300">
              Notas (opcional)
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej. Reserva presencial o por llamada"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
              />
            </label>

            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Se creará en estado <strong>HOLD (15 min)</strong> · Tarifa{" "}
              {formatCop(target.priceCop ?? 60000)} COP (Anticipo 20%:{" "}
              {formatCop(Math.round((target.priceCop ?? 60000) * 0.2))} COP).
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !selectedCustomer || !selectedStartTime}
              className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {isSubmitting ? "Creando reserva..." : "Crear reserva (HOLD)"}
            </button>
          </form>
        ) : booking ? (
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm">
              <p className="text-slate-300">
                <span className="text-slate-400">Cliente:</span>{" "}
                <strong className="text-white">{booking.customerName ?? "Cliente WhatsApp"}</strong>
              </p>
              <p className="text-slate-300">
                <span className="text-slate-400">Estado:</span>{" "}
                <strong className="text-white">{booking.status}</strong>
              </p>
              <p className="text-slate-300">
                <span className="text-slate-400">Total:</span> {formatCop(booking.totalPriceCop)}{" "}
                COP
              </p>
              <p className="text-slate-300">
                <span className="text-slate-400">Anticipo requerido:</span>{" "}
                {formatCop(booking.depositRequiredCop)} COP
              </p>
              <p className="text-slate-300">
                <span className="text-slate-400">Saldo pendiente:</span>{" "}
                {formatCop(booking.balanceDueCop)} COP
              </p>
            </div>

            {canModifyBooking && subMode === "view" ? (
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage(null);
                    setSubMode("move");
                  }}
                  className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25"
                >
                  ↔ Mover reserva
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage(null);
                    setSubMode("cancel");
                  }}
                  className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-2.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/25"
                >
                  ✕ Cancelar reserva
                </button>
              </div>
            ) : null}

            {canModifyBooking && subMode === "move" ? (
              <form
                onSubmit={handleMoveBooking}
                className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5"
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-white">Mover a nuevo horario</h4>
                  <button
                    type="button"
                    onClick={() => setSubMode("view")}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    Volver
                  </button>
                </div>

                {booking.status === "CONFIRMED" ? (
                  <p className="text-[11px] text-emerald-300">
                    La reserva conservará su anticipo y la original pasará a estado Reprogramada.
                  </p>
                ) : null}

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <label className="block text-xs text-slate-300">
                    Fecha
                    <input
                      type="date"
                      value={targetDate}
                      onChange={(e) => setTargetDate(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-white"
                      required
                    />
                  </label>
                  <label className="block text-xs text-slate-300">
                    Cancha
                    <select
                      value={selectedCourtId}
                      onChange={(e) => setSelectedCourtId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-white"
                      required
                    >
                      {targetGrid.courts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs text-slate-300">
                    Hora disponible
                    <select
                      value={selectedStartTime}
                      onChange={(e) => setSelectedStartTime(e.target.value)}
                      disabled={isLoadingSlots || availableSlots.length === 0}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-white disabled:opacity-50"
                      required
                    >
                      {availableSlots.length === 0 ? (
                        <option value="">Sin horarios libres</option>
                      ) : (
                        availableSlots.map((s) => (
                          <option key={s.localStartTime} value={s.localStartTime}>
                            {s.localStartTime} – {s.localEndTime}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || !selectedStartTime}
                  className="w-full rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {isSubmitting ? "Moviendo..." : "Confirmar movimiento"}
                </button>
              </form>
            ) : null}

            {canModifyBooking && subMode === "cancel" ? (
              <form
                onSubmit={handleCancelBooking}
                className="space-y-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3.5"
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-rose-200">Cancelar reserva</h4>
                  <button
                    type="button"
                    onClick={() => setSubMode("view")}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    Volver
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {QUICK_CANCEL_REASONS.map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => setCancellationReason(reason)}
                      className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:border-rose-400"
                    >
                      {reason}
                    </button>
                  ))}
                </div>

                <label className="block text-xs text-slate-300">
                  Motivo de cancelación (obligatorio)
                  <textarea
                    rows={2}
                    value={cancellationReason}
                    onChange={(e) => setCancellationReason(e.target.value)}
                    placeholder="Escribe el motivo de la cancelación..."
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white"
                    required
                  />
                </label>

                <button
                  type="submit"
                  disabled={isSubmitting || cancellationReason.trim().length === 0}
                  className="w-full rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
                >
                  {isSubmitting ? "Cancelando..." : "Confirmar cancelación"}
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
