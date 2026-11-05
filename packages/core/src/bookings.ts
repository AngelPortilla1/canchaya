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
import { assertNoBookingOverlap, type BookingRecord } from "./schema";

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
