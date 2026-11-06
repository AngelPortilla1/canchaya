import {
  calculateDepositCop,
  DEFAULT_DEPOSIT_PERCENT,
  DEFAULT_HOLD_MINUTES,
  DEFAULT_HOURLY_PRICE_COP,
  DEFAULT_SLOT_MINUTES,
  DEFAULT_TIMEZONE,
} from "./index";
import {
  type BookingAvailabilityCandidate,
  formatMinutesAsWallClockTime,
  isBookingBlockingAt,
  localDateTimeToUtcIso,
  parseWallClockTimeMinutes,
} from "./availability";
import {
  assertNoBookingOverlap,
  type BookingRecord,
  type PaymentRecord,
  type PaymentStatus,
  type PaymentType,
} from "./schema";

export const HOLD_EXPIRED_CANCELLATION_REASON = "HOLD_EXPIRED" as const;
export const EXPIRE_HOLD_BOOKINGS_CRON_JOB_NAME = "expire-overdue-hold-bookings" as const;
export const EXPIRE_HOLD_BOOKINGS_CRON_SCHEDULE = "* * * * *" as const;
export const EXPIRE_HOLD_BOOKINGS_SQL_FUNCTION = "expire_overdue_hold_bookings" as const;

export type DepositPaymentCandidate = Pick<
  PaymentRecord,
  "tenant_id" | "booking_id" | "payment_type" | "status"
>;

export interface ExpireOverdueHoldBookingsInput {
  bookings: readonly BookingRecord[];
  /**
   * Optional payment records used to protect `HOLD` bookings that already have a deposit
   * in `pending_validation` or `approved` status from being expired while awaiting staff review.
   */
  payments?: readonly DepositPaymentCandidate[];
  /**
   * Reference timestamp representing "now" in UTC when the expiration job runs.
   */
  referenceTime?: string | Date;
}

export interface ExpireOverdueHoldBookingsResult {
  bookings: BookingRecord[];
  expiredBookings: BookingRecord[];
  expiredBookingIds: string[];
  expiredCount: number;
}

export interface CreateHoldBookingInput {
  id?: string;
  tenantId: string;
  courtId: string;
  customerId: string;
  /**
   * Explicit UTC ISO-8601 start timestamp. Either provide `startsAtUtc`
   * or (`localDate` + `localStartTime`).
   */
  startsAtUtc?: string;
  /**
   * Explicit UTC ISO-8601 end timestamp. When omitted, computed from
   * `slotDurationMinutes` (default 60 minutes).
   */
  endsAtUtc?: string;
  /**
   * Local calendar date (`YYYY-MM-DD`) in `timezone` (`America/Bogota` by default).
   * Used together with `localStartTime` when `startsAtUtc` is not provided.
   */
  localDate?: string;
  /**
   * Local 24h start time (`HH:MM`) in `timezone` (`America/Bogota` by default).
   */
  localStartTime?: string;
  /**
   * Local 24h end time (`HH:MM`, including `"24:00"`). Optional when `slotDurationMinutes` is used.
   */
  localEndTime?: string;
  timezone?: string;
  slotDurationMinutes?: number;
  /**
   * Hold expiration window in minutes (defaults to `DEFAULT_HOLD_MINUTES` = 15).
   */
  holdDurationMinutes?: number;
  /**
   * Reference timestamp representing "now" when the HOLD is created (defaults to `new Date()`).
   */
  referenceTime?: string | Date;
  /**
   * Total booking price in integer COP (defaults to `DEFAULT_HOURLY_PRICE_COP` = 60000).
   */
  totalPriceCop?: number;
  /**
   * Required deposit percentage `0..100` (defaults to `DEFAULT_DEPOSIT_PERCENT` = 20).
   */
  depositPercent?: number;
  /**
   * Existing bookings on the tenant/court used to reject overlapping active slots (`23P01`)
   * before persisting. Expired HOLD bookings (`hold_expires_at <= referenceTime`) are ignored.
   */
  existingBookings?: readonly BookingAvailabilityCandidate[];
  rescheduledFromBookingId?: string | null;
  createdByUserId?: string | null;
  notes?: string | null;
}

function resolveReferenceDate(referenceTime?: string | Date): Date {
  if (referenceTime === undefined) {
    return new Date();
  }
  const ms = referenceTime instanceof Date ? referenceTime.getTime() : Date.parse(referenceTime);
  if (Number.isNaN(ms)) {
    throw new Error("Invalid referenceTime timestamp");
  }
  return new Date(ms);
}

/**
 * Computes the UTC ISO-8601 expiration timestamp (`hold_expires_at`) for a `HOLD` booking.
 * Defaults to 15 minutes (`DEFAULT_HOLD_MINUTES`) from `referenceTime`.
 */
export function computeHoldExpiresAt(
  referenceTime?: string | Date,
  holdDurationMinutes: number = DEFAULT_HOLD_MINUTES,
): string {
  if (!Number.isInteger(holdDurationMinutes) || holdDurationMinutes <= 0) {
    throw new Error("holdDurationMinutes must be a positive integer");
  }
  const referenceDate = resolveReferenceDate(referenceTime);
  return new Date(referenceDate.getTime() + holdDurationMinutes * 60_000).toISOString();
}

function resolveBookingUtcSlot(input: CreateHoldBookingInput): {
  startsAtUtc: string;
  endsAtUtc: string;
} {
  const {
    startsAtUtc,
    endsAtUtc,
    localDate,
    localStartTime,
    localEndTime,
    timezone = DEFAULT_TIMEZONE,
    slotDurationMinutes = DEFAULT_SLOT_MINUTES,
  } = input;

  if (!Number.isInteger(slotDurationMinutes) || slotDurationMinutes <= 0) {
    throw new Error("slotDurationMinutes must be a positive integer");
  }

  if (startsAtUtc) {
    const startMs = Date.parse(startsAtUtc);
    if (Number.isNaN(startMs)) {
      throw new Error("Invalid ISO-8601 UTC timestamp in startsAtUtc");
    }
    const resolvedStartUtc = new Date(startMs).toISOString();

    if (endsAtUtc) {
      const endMs = Date.parse(endsAtUtc);
      if (Number.isNaN(endMs)) {
        throw new Error("Invalid ISO-8601 UTC timestamp in endsAtUtc");
      }
      if (endMs <= startMs) {
        throw new Error("Booking ends_at must be strictly greater than starts_at");
      }
      return {
        startsAtUtc: resolvedStartUtc,
        endsAtUtc: new Date(endMs).toISOString(),
      };
    }

    return {
      startsAtUtc: resolvedStartUtc,
      endsAtUtc: new Date(startMs + slotDurationMinutes * 60_000).toISOString(),
    };
  }

  if (localDate && localStartTime) {
    const startMinutes = parseWallClockTimeMinutes(localStartTime, false);
    const resolvedLocalEndTime =
      localEndTime ?? formatMinutesAsWallClockTime(startMinutes + slotDurationMinutes);
    const endMinutes = parseWallClockTimeMinutes(resolvedLocalEndTime, true);

    if (endMinutes <= startMinutes) {
      throw new Error("Booking ends_at must be strictly greater than starts_at");
    }

    return {
      startsAtUtc: localDateTimeToUtcIso(localDate, localStartTime, timezone),
      endsAtUtc: localDateTimeToUtcIso(localDate, resolvedLocalEndTime, timezone),
    };
  }

  throw new Error("Either startsAtUtc or (localDate and localStartTime) must be provided");
}

/**
 * Creates a booking record in `HOLD` status with a 15-minute expiration (`hold_expires_at`)
 * and integer COP monetary amounts, verifying that no active booking blocks the court slot.
 */
export function createHoldBooking(input: CreateHoldBookingInput): BookingRecord {
  const {
    id,
    tenantId,
    courtId,
    customerId,
    holdDurationMinutes = DEFAULT_HOLD_MINUTES,
    referenceTime,
    totalPriceCop = DEFAULT_HOURLY_PRICE_COP,
    depositPercent = DEFAULT_DEPOSIT_PERCENT,
    existingBookings = [],
    rescheduledFromBookingId = null,
    createdByUserId = null,
    notes = null,
  } = input;

  if (!tenantId || tenantId.trim().length === 0) {
    throw new Error("tenantId is required");
  }
  if (!courtId || courtId.trim().length === 0) {
    throw new Error("courtId is required");
  }
  if (!customerId || customerId.trim().length === 0) {
    throw new Error("customerId is required");
  }

  const referenceDate = resolveReferenceDate(referenceTime);
  const holdExpiresAt = computeHoldExpiresAt(referenceDate, holdDurationMinutes);
  const { startsAtUtc, endsAtUtc } = resolveBookingUtcSlot(input);

  const depositRequiredCop = calculateDepositCop(totalPriceCop, depositPercent);
  const balanceDueCop = totalPriceCop;
  const bookingId = id && id.trim().length > 0 ? id : crypto.randomUUID();

  const activeBlockingBookings = existingBookings.filter((booking) =>
    isBookingBlockingAt(booking, referenceDate),
  );

  assertNoBookingOverlap(activeBlockingBookings, {
    id: bookingId,
    tenant_id: tenantId,
    court_id: courtId,
    status: "HOLD",
    starts_at: startsAtUtc,
    ends_at: endsAtUtc,
  });

  const nowIso = referenceDate.toISOString();

  return {
    id: bookingId,
    tenant_id: tenantId,
    court_id: courtId,
    customer_id: customerId,
    status: "HOLD",
    starts_at: startsAtUtc,
    ends_at: endsAtUtc,
    hold_expires_at: holdExpiresAt,
    total_price_cop: totalPriceCop,
    deposit_required_cop: depositRequiredCop,
    balance_due_cop: balanceDueCop,
    rescheduled_from_booking_id: rescheduledFromBookingId,
    created_by_user_id: createdByUserId,
    cancellation_reason: null,
    notes,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

const ACTIVE_DEPOSIT_STATUSES: readonly PaymentStatus[] = ["pending_validation", "approved"];
const DEPOSIT_PAYMENT_TYPE: PaymentType = "deposit";

/**
 * Returns true if the booking already has a deposit payment in `pending_validation` or `approved`
 * status belonging to the same tenant.
 */
export function hasActiveDepositPayment(
  booking: Pick<BookingRecord, "id" | "tenant_id">,
  payments: readonly DepositPaymentCandidate[] = [],
): boolean {
  return payments.some(
    (payment) =>
      payment.tenant_id === booking.tenant_id &&
      payment.booking_id === booking.id &&
      payment.payment_type === DEPOSIT_PAYMENT_TYPE &&
      ACTIVE_DEPOSIT_STATUSES.includes(payment.status),
  );
}

/**
 * Checks whether a booking is in `HOLD` status and its `hold_expires_at` timestamp
 * is less than or equal to `referenceTime` (`hold_expires_at <= now()`).
 */
export function isHoldBookingExpired(
  booking: Pick<BookingRecord, "status" | "hold_expires_at">,
  referenceTime?: string | Date,
): boolean {
  if (booking.status !== "HOLD") {
    return false;
  }
  if (!booking.hold_expires_at) {
    throw new Error("HOLD booking must include hold_expires_at timestamp");
  }
  const expiresAtMs = Date.parse(booking.hold_expires_at);
  if (Number.isNaN(expiresAtMs)) {
    throw new Error("Invalid ISO-8601 UTC timestamp in hold_expires_at");
  }
  const referenceDate = resolveReferenceDate(referenceTime);
  return expiresAtMs <= referenceDate.getTime();
}

/**
 * Expires overdue `HOLD` bookings (`hold_expires_at <= referenceTime`) that do not have an
 * active deposit (`pending_validation` or `approved`), transitioning them to `CANCELLED`
 * with `cancellation_reason = 'HOLD_EXPIRED'` and releasing their court slots.
 *
 * Mirrors the PostgreSQL `public.expire_overdue_hold_bookings(p_now)` cron job (CY-032).
 */
export function expireOverdueHoldBookings(
  input: ExpireOverdueHoldBookingsInput,
): ExpireOverdueHoldBookingsResult {
  const { bookings, payments = [], referenceTime } = input;
  const referenceDate = resolveReferenceDate(referenceTime);
  const nowIso = referenceDate.toISOString();

  const updatedBookings: BookingRecord[] = [];
  const expiredBookings: BookingRecord[] = [];
  const expiredBookingIds: string[] = [];

  for (const booking of bookings) {
    if (
      isHoldBookingExpired(booking, referenceDate) &&
      !hasActiveDepositPayment(booking, payments)
    ) {
      const expiredRecord: BookingRecord = {
        ...booking,
        status: "CANCELLED",
        cancellation_reason: booking.cancellation_reason ?? HOLD_EXPIRED_CANCELLATION_REASON,
        updated_at: nowIso,
      };
      updatedBookings.push(expiredRecord);
      expiredBookings.push(expiredRecord);
      expiredBookingIds.push(expiredRecord.id);
    } else {
      updatedBookings.push(booking);
    }
  }

  return {
    bookings: updatedBookings,
    expiredBookings,
    expiredBookingIds,
    expiredCount: expiredBookings.length,
  };
}
