"use client";

import { QUICK_DEPOSIT_REJECTION_REASONS } from "@canchaya/core";
import { useState } from "react";
import type { PendingDepositQueueItem } from "@/lib/bookings";

interface PendingDepositsQueueProps {
  items: PendingDepositQueueItem[];
  isLoading?: boolean;
  onRefresh: () => void;
  onValidated: (message: string) => void;
}

function formatCop(amount: number): string {
  return `$${amount.toLocaleString("es-CO")}`;
}

function isLikelyImageUrl(url: string | null): boolean {
  if (!url) return false;
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed.startsWith("data:image/") ||
    /\.(png|jpe?g|webp|gif)(\?.*)?$/.test(trimmed) ||
    trimmed.includes("/storage/v1/object/")
  );
}

export function PendingDepositsQueue({
  items,
  isLoading = false,
  onRefresh,
  onValidated,
}: PendingDepositsQueueProps) {
  const [processingPaymentId, setProcessingPaymentId] = useState<string | null>(null);
  const [rejectingPaymentId, setRejectingPaymentId] = useState<string | null>(null);
  const [customReason, setCustomReason] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<PendingDepositQueueItem | null>(null);

  async function handleApprove(item: PendingDepositQueueItem) {
    setErrorMessage(null);
    setProcessingPaymentId(item.paymentId);
    try {
      const response = await fetch(`/api/panel/deposits/${item.paymentId}/approve`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setErrorMessage(payload.error ?? "No se pudo aprobar el anticipo.");
        return;
      }
      onValidated(
        `Reserva confirmada — ${item.customerName} (${item.courtName} · ${item.localStartTime})`,
      );
    } catch {
      setErrorMessage("Error de conexión al aprobar el anticipo.");
    } finally {
      setProcessingPaymentId(null);
    }
  }

  async function handleReject(item: PendingDepositQueueItem, reason: string) {
    const trimmed = reason.trim();
    if (!trimmed) {
      setErrorMessage("Selecciona o escribe un motivo para rechazar el comprobante.");
      return;
    }

    setErrorMessage(null);
    setProcessingPaymentId(item.paymentId);
    try {
      const response = await fetch(`/api/panel/deposits/${item.paymentId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejectionReason: trimmed }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        bookingExpired?: boolean;
        error?: string;
      };
      if (!response.ok) {
        setErrorMessage(payload.error ?? "No se pudo rechazar el anticipo.");
        return;
      }

      setRejectingPaymentId(null);
      setCustomReason("");
      onValidated(
        payload.bookingExpired
          ? `Comprobante rechazado y hora liberada por HOLD vencido — ${item.customerName}`
          : `Comprobante rechazado (${trimmed}) — ${item.customerName}`,
      );
    } catch {
      setErrorMessage("Error de conexión al rechazar el anticipo.");
    } finally {
      setProcessingPaymentId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-white">
            🧾 Anticipos por validar ({items.length})
          </h2>
          <p className="text-[11px] text-slate-400">
            Todas las fechas · Aprobar o rechazar en 1 toque
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:border-slate-500 disabled:opacity-50"
        >
          {isLoading ? "..." : "↻"}
        </button>
      </div>

      {errorMessage ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {errorMessage}
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-center">
          <p className="text-xs font-medium text-slate-300">
            No hay comprobantes pendientes por validar.
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            Cuando un cliente envíe su comprobante de anticipo aparecerá aquí.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const isBusy = processingPaymentId === item.paymentId;
            const isRejectOpen = rejectingPaymentId === item.paymentId;
            const hasImage = isLikelyImageUrl(item.receiptMediaUrl);

            return (
              <li
                key={item.paymentId}
                className="rounded-xl border border-violet-500/40 bg-violet-500/10 p-3.5 text-xs shadow-sm"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-200">
                    🛡️ Protegida de expirar
                  </span>
                  <span className="text-[11px] font-medium text-violet-200/80">
                    {item.localDate}
                  </span>
                </div>

                <div className="mt-2">
                  <p className="text-sm font-bold text-white">{item.customerName}</p>
                  {item.customerPhone ? (
                    <p className="text-[11px] text-slate-300">📱 {item.customerPhone}</p>
                  ) : null}
                  <p className="mt-1 font-medium text-violet-200">
                    {item.sportCode === "padel" ? "🎾" : "⚽"} {item.courtName} ·{" "}
                    <strong>
                      {item.localStartTime} – {item.localEndTime}
                    </strong>
                  </p>
                  <p className="mt-1 text-slate-200">
                    💰 Anticipo:{" "}
                    <strong className="text-emerald-300">{formatCop(item.amountCop)} COP</strong>{" "}
                    <span className="text-slate-400">
                      (Total: {formatCop(item.totalPriceCop)} COP)
                    </span>
                  </p>
                </div>

                {/* Comprobante preview / link */}
                <div className="mt-2.5 rounded-lg border border-slate-800 bg-slate-950/75 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-medium text-slate-200">
                      🖼️ {item.receiptMediaUrl ?? "Comprobante recibido"}
                    </span>
                    {item.receiptMediaUrl ? (
                      <button
                        type="button"
                        onClick={() => setPreviewItem(item)}
                        className="shrink-0 rounded-md border border-violet-400/40 bg-violet-500/20 px-2 py-1 text-[11px] font-semibold text-violet-200 hover:bg-violet-500/30"
                      >
                        🔍 Ver comprobante
                      </button>
                    ) : null}
                  </div>
                  {hasImage && item.receiptMediaUrl ? (
                    <button
                      type="button"
                      onClick={() => setPreviewItem(item)}
                      className="mt-2 block w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-900"
                    >
                      <img
                        src={item.receiptMediaUrl}
                        alt={`Comprobante de ${item.customerName}`}
                        className="max-h-36 w-full object-cover"
                      />
                    </button>
                  ) : null}
                </div>

                {/* 1-touch action buttons */}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleApprove(item)}
                    className="flex min-h-[40px] items-center justify-center rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {isBusy && !isRejectOpen
                      ? "Aprobando..."
                      : `✓ Aprobar (${formatCop(item.amountCop)})`}
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => {
                      setErrorMessage(null);
                      setCustomReason("");
                      setRejectingPaymentId(isRejectOpen ? null : item.paymentId);
                    }}
                    className="flex min-h-[40px] items-center justify-center rounded-xl border border-rose-500/50 bg-rose-500/15 px-3 py-2 text-xs font-bold text-rose-200 transition hover:bg-rose-500/25 disabled:opacity-50"
                  >
                    {isRejectOpen ? "Cancelar" : "✕ Rechazar"}
                  </button>
                </div>

                {/* Quick 1-touch rejection reasons */}
                {isRejectOpen ? (
                  <div className="mt-2.5 space-y-2 rounded-xl border border-rose-500/30 bg-slate-950/90 p-2.5">
                    <p className="text-[11px] font-semibold text-rose-200">
                      Toca un motivo para rechazar de inmediato:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_DEPOSIT_REJECTION_REASONS.map((reason) => (
                        <button
                          key={reason}
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleReject(item, reason)}
                          className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-rose-100 transition hover:bg-rose-500/30 disabled:opacity-50"
                        >
                          {reason}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1.5 pt-1">
                      <input
                        type="text"
                        value={customReason}
                        onChange={(e) => setCustomReason(e.target.value)}
                        placeholder="Otro motivo..."
                        className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
                      />
                      <button
                        type="button"
                        disabled={isBusy || customReason.trim().length === 0}
                        onClick={() => handleReject(item, customReason)}
                        className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
                      >
                        Confirmar
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* Lightbox modal for viewing receipt in full detail */}
      {previewItem ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewItem(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-violet-300">Comprobante de anticipo</p>
                <h3 className="text-base font-bold text-white">{previewItem.customerName}</h3>
                <p className="text-xs text-slate-400">
                  {previewItem.courtName} · {previewItem.localDate} · {previewItem.localStartTime} –{" "}
                  {previewItem.localEndTime}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
              >
                ✕ Cerrar
              </button>
            </div>

            <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950 p-3">
              {isLikelyImageUrl(previewItem.receiptMediaUrl) && previewItem.receiptMediaUrl ? (
                <img
                  src={previewItem.receiptMediaUrl}
                  alt={`Comprobante de ${previewItem.customerName}`}
                  className="max-h-[55vh] w-full rounded-lg object-contain"
                />
              ) : (
                <div className="py-6 text-center">
                  <p className="text-xs text-slate-300">Referencia / URL del comprobante:</p>
                  <p className="mt-1 break-all font-mono text-xs font-semibold text-violet-200">
                    {previewItem.receiptMediaUrl}
                  </p>
                </div>
              )}

              {previewItem.receiptMediaUrl?.startsWith("http") ? (
                <a
                  href={previewItem.receiptMediaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-block text-xs font-semibold text-emerald-400 hover:underline"
                >
                  ↗ Abrir archivo original en pestaña nueva
                </a>
              ) : null}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={processingPaymentId === previewItem.paymentId}
                onClick={async () => {
                  const targetItem = previewItem;
                  setPreviewItem(null);
                  await handleApprove(targetItem);
                }}
                className="rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                ✓ Aprobar ({formatCop(previewItem.amountCop)})
              </button>
              <button
                type="button"
                onClick={() => {
                  setRejectingPaymentId(previewItem.paymentId);
                  setPreviewItem(null);
                }}
                className="rounded-xl border border-rose-500/50 bg-rose-500/15 px-3 py-2.5 text-xs font-bold text-rose-200 hover:bg-rose-500/25"
              >
                ✕ Rechazar...
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
