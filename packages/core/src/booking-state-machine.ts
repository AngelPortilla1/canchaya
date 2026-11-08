import type { BookingStatus } from "./index";
import type { BookingRecord } from "./schema";

export const BOOKING_STATUSES = [
  "HOLD",
  "CONFIRMED",
  "COMPLETED",
  "NO_SHOW",
  "CANCELLED",
  "RESCHEDULED",
] as const satisfies readonly BookingStatus[];

/**
 * Allowed booking status transitions. Terminal states have no outgoing transitions.
 */
export const BOOKING_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  HOLD: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["COMPLETED", "NO_SHOW", "CANCELLED", "RESCHEDULED"],
  COMPLETED: [],
  NO_SHOW: [],
  CANCELLED: [],
  RESCHEDULED: [],
};

export class InvalidBookingTransitionError extends Error {
  readonly from: BookingStatus;
  readonly to: BookingStatus;

  constructor(from: BookingStatus, to: BookingStatus, detail?: string) {
    super(`Invalid booking transition ${from} -> ${to}${detail ? `: ${detail}` : ""}`);
    this.name = "InvalidBookingTransitionError";
    this.from = from;
    this.to = to;
  }
}

export interface BookingTransitionOptions {
  /** Reference "now" in UTC (defaults to `new Date()`). */
  referenceTime?: string | Date;
  /** Required when transitioning to `CANCELLED`. */
  cancellationReason?: string | null;
}

function resolveNow(referenceTime?: string | Date): Date {
  if (referenceTime === undefined) {
    return new Date();
  }
  const ms = referenceTime instanceof Date ? referenceTime.getTime() : Date.parse(referenceTime);
  if (Number.isNaN(ms)) {
    throw new Error("Invalid referenceTime timestamp");
  }
  return new Date(ms);
}

/** Returns true if the status graph allows `from -> to` (ignores time/reason rules). */
export function canTransitionBooking(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

/**
 * Throws `InvalidBookingTransitionError` when the transition is not allowed:
 * - the status graph must allow it;
 * - `COMPLETED` / `NO_SHOW` only once `ends_at` has passed;
 * - `CANCELLED` requires a non-empty `cancellation_reason`.
 */
export function assertBookingTransition(
  booking: Pick<BookingRecord, "status" | "ends_at">,
  to: BookingStatus,
  options: BookingTransitionOptions = {},
): void {
  const from = booking.status;
  if (!canTransitionBooking(from, to)) {
    throw new InvalidBookingTransitionError(from, to);
  }

  if (to === "COMPLETED" || to === "NO_SHOW") {
    const endsAtMs = Date.parse(booking.ends_at);
    if (Number.isNaN(endsAtMs)) {
      throw new Error("Invalid ISO-8601 UTC timestamp in ends_at");
    }
    if (resolveNow(options.referenceTime).getTime() < endsAtMs) {
      throw new InvalidBookingTransitionError(from, to, "booking has not ended yet");
    }
  }

  if (to === "CANCELLED" && (options.cancellationReason ?? "").trim().length === 0) {
    throw new InvalidBookingTransitionError(from, to, "cancellation_reason is required");
  }
}

/**
 * Returns a copy of the booking in the new status after validating the transition.
 */
export function transitionBooking(
  booking: BookingRecord,
  to: BookingStatus,
  options: BookingTransitionOptions = {},
): BookingRecord {
  assertBookingTransition(booking, to, options);
  const now = resolveNow(options.referenceTime);
  return {
    ...booking,
    status: to,
    cancellation_reason:
      to === "CANCELLED" ? (options.cancellationReason ?? "").trim() : booking.cancellation_reason,
    updated_at: now.toISOString(),
  };
}
