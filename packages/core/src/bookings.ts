import {
  calculateDepositCop,
  DEFAULT_DEPOSIT_PERCENT,
  DEFAULT_HOLD_MINUTES,
  DEFAULT_HOURLY_PRICE_COP,
  DEFAULT_MIN_RESCHEDULE_HOURS,
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
  assertBookingTransition,
  InvalidBookingTransitionError,
  transitionBooking,
} from "./booking-state-machine";
import {
  assertNoBookingOverlap,
  type BookingRecord,
  type PaymentMethod,
  type PaymentRecord,
  type PaymentStatus,
  type PaymentType,
  validatePaymentBreakdownCop,
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
        ...transitionBooking(booking, "CANCELLED", {
          referenceTime: referenceDate,
          cancellationReason: booking.cancellation_reason ?? HOLD_EXPIRED_CANCELLATION_REASON,
        }),
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

export type ReschedulePolicyErrorCode =
  | "INVALID_MIN_RESCHEDULE_HOURS"
  | "INSUFFICIENT_NOTICE"
  | "MAX_RESCHEDULES_REACHED"
  | "NEW_SLOT_IN_PAST";

export class ReschedulePolicyError extends Error {
  readonly code: ReschedulePolicyErrorCode;

  constructor(code: ReschedulePolicyErrorCode, message: string) {
    super(message);
    this.name = "ReschedulePolicyError";
    this.code = code;
  }
}

export interface ReschedulePolicyOptions {
  /**
   * Minimum notice in hours before `booking.starts_at` required to reschedule.
   * Configurable per tenant (`tenants.min_reschedule_hours`, defaults to `DEFAULT_MIN_RESCHEDULE_HOURS` = 4).
   */
  minRescheduleHours?: number;
  /**
   * Reference timestamp representing "now" in UTC (defaults to `new Date()`).
   */
  referenceTime?: string | Date;
  /**
   * When false, rejects rescheduling a booking that was already created from a previous reschedule.
   * Defaults to true.
   */
  allowMultipleReschedules?: boolean;
}

export interface RescheduleBookingInput extends ReschedulePolicyOptions {
  /**
   * The existing booking to reschedule (must be in `CONFIRMED` status).
   */
  booking: BookingRecord;
  /**
   * Optional ID for the newly created rescheduled booking (defaults to `crypto.randomUUID()`).
   */
  newBookingId?: string;
  /**
   * Target court ID for the rescheduled slot (defaults to `booking.court_id`).
   */
  newCourtId?: string;
  /**
   * Explicit UTC ISO-8601 start timestamp for the new slot.
   * Either provide `startsAtUtc` or (`localDate` + `localStartTime`).
   */
  startsAtUtc?: string;
  /**
   * Explicit UTC ISO-8601 end timestamp for the new slot.
   */
  endsAtUtc?: string;
  /**
   * Local calendar date (`YYYY-MM-DD`) in `timezone` (`America/Bogota` by default).
   */
  localDate?: string;
  /**
   * Local 24h start time (`HH:MM`) in `timezone` (`America/Bogota` by default).
   */
  localStartTime?: string;
  /**
   * Local 24h end time (`HH:MM`, including `"24:00"`).
   */
  localEndTime?: string;
  timezone?: string;
  slotDurationMinutes?: number;
  /**
   * Existing bookings used to verify that the target court and time slot has no overlap (`23P01`).
   * The original booking being rescheduled and expired `HOLD` bookings are ignored.
   */
  existingBookings?: readonly BookingAvailabilityCandidate[];
  /**
   * Optional payments associated with the tenant/booking. Deposit payments linked to the
   * original booking are reassigned to the new booking so the deposit is preserved end-to-end.
   */
  payments?: readonly PaymentRecord[];
  createdByUserId?: string | null;
  notes?: string | null;
}

export interface RescheduleBookingResult {
  /**
   * Copy of the original booking transitioned to `RESCHEDULED` status.
   */
  originalBooking: BookingRecord;
  /**
   * Newly created booking in `CONFIRMED` status with preserved integer COP deposit and balance.
   */
  newBooking: BookingRecord;
  /**
   * Updated payment records with deposit payments linked to `newBooking.id`.
   */
  payments: PaymentRecord[];
}

/**
 * Validates that a booking can be rescheduled at `referenceTime` under the tenant's
 * configurable `minRescheduleHours` policy (`RF-05`).
 *
 * Throws:
 * - `InvalidBookingTransitionError` if `booking.status` cannot transition to `RESCHEDULED`
 *   (only `CONFIRMED` bookings can be rescheduled).
 * - `ReschedulePolicyError` if `minRescheduleHours` is invalid, if the booking was already
 *   rescheduled when `allowMultipleReschedules === false`, or if `starts_at - referenceTime`
 *   is less than `minRescheduleHours`.
 */
export function assertCanRescheduleBooking(
  booking: Pick<BookingRecord, "status" | "starts_at" | "ends_at" | "rescheduled_from_booking_id">,
  options: ReschedulePolicyOptions = {},
): void {
  const {
    minRescheduleHours = DEFAULT_MIN_RESCHEDULE_HOURS,
    referenceTime,
    allowMultipleReschedules = true,
  } = options;

  if (!Number.isInteger(minRescheduleHours) || minRescheduleHours < 0) {
    throw new ReschedulePolicyError(
      "INVALID_MIN_RESCHEDULE_HOURS",
      "minRescheduleHours must be a non-negative integer",
    );
  }

  assertBookingTransition(booking, "RESCHEDULED", { referenceTime });

  if (!allowMultipleReschedules && booking.rescheduled_from_booking_id !== null) {
    throw new ReschedulePolicyError(
      "MAX_RESCHEDULES_REACHED",
      "Booking has already been rescheduled once",
    );
  }

  const startsAtMs = Date.parse(booking.starts_at);
  if (Number.isNaN(startsAtMs)) {
    throw new Error("Invalid ISO-8601 UTC timestamp in starts_at");
  }

  const referenceDate = resolveReferenceDate(referenceTime);
  const requiredNoticeMs = minRescheduleHours * 3_600_000;
  const remainingMs = startsAtMs - referenceDate.getTime();

  if (remainingMs < requiredNoticeMs) {
    throw new ReschedulePolicyError(
      "INSUFFICIENT_NOTICE",
      `Booking can only be rescheduled at least ${minRescheduleHours} hours before starts_at`,
    );
  }
}

/**
 * Returns `true` when the booking is in `CONFIRMED` status and satisfies the tenant's
 * minimum notice hours (`minRescheduleHours`) before `starts_at`.
 */
export function canRescheduleBooking(
  booking: Pick<BookingRecord, "status" | "starts_at" | "ends_at" | "rescheduled_from_booking_id">,
  options: ReschedulePolicyOptions = {},
): boolean {
  try {
    assertCanRescheduleBooking(booking, options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reschedules a `CONFIRMED` booking to a new court/time slot while preserving the deposit (`RF-05`, `CY-034`):
 * 1. Enforces the state machine (`CONFIRMED -> RESCHEDULED`) and the tenant's `minRescheduleHours` notice rule.
 * 2. Verifies the target slot is not in the past and does not overlap any active booking on the target court (`23P01`).
 * 3. Transitions the original booking to `RESCHEDULED` (releasing its court slot) and creates the new booking
 *    in `CONFIRMED` status with `rescheduled_from_booking_id = booking.id` and the preserved integer COP amounts.
 */
export function rescheduleBooking(input: RescheduleBookingInput): RescheduleBookingResult {
  const {
    booking,
    newBookingId,
    newCourtId,
    minRescheduleHours = DEFAULT_MIN_RESCHEDULE_HOURS,
    referenceTime,
    allowMultipleReschedules = true,
    existingBookings = [],
    payments = [],
    createdByUserId,
    notes,
  } = input;

  const referenceDate = resolveReferenceDate(referenceTime);

  assertCanRescheduleBooking(booking, {
    minRescheduleHours,
    referenceTime: referenceDate,
    allowMultipleReschedules,
  });

  const targetCourtId = newCourtId !== undefined ? newCourtId.trim() : booking.court_id;
  if (!targetCourtId || targetCourtId.length === 0) {
    throw new Error("newCourtId must be a non-empty court ID");
  }

  const originalDurationMinutes = Math.round(
    (Date.parse(booking.ends_at) - Date.parse(booking.starts_at)) / 60_000,
  );
  const fallbackSlotDuration =
    Number.isInteger(originalDurationMinutes) && originalDurationMinutes > 0
      ? originalDurationMinutes
      : DEFAULT_SLOT_MINUTES;

  const { startsAtUtc, endsAtUtc } = resolveBookingUtcSlot({
    tenantId: booking.tenant_id,
    courtId: targetCourtId,
    customerId: booking.customer_id,
    startsAtUtc: input.startsAtUtc,
    endsAtUtc: input.endsAtUtc,
    localDate: input.localDate,
    localStartTime: input.localStartTime,
    localEndTime: input.localEndTime,
    timezone: input.timezone,
    slotDurationMinutes: input.slotDurationMinutes ?? fallbackSlotDuration,
  });

  if (Date.parse(startsAtUtc) < referenceDate.getTime()) {
    throw new ReschedulePolicyError(
      "NEW_SLOT_IN_PAST",
      "Rescheduled booking slot starts_at cannot be in the past",
    );
  }

  const resolvedNewBookingId =
    newBookingId && newBookingId.trim().length > 0 ? newBookingId.trim() : crypto.randomUUID();

  const activeBlockingBookings = existingBookings.filter(
    (candidate) => candidate.id !== booking.id && isBookingBlockingAt(candidate, referenceDate),
  );

  assertNoBookingOverlap(activeBlockingBookings, {
    id: resolvedNewBookingId,
    tenant_id: booking.tenant_id,
    court_id: targetCourtId,
    status: "CONFIRMED",
    starts_at: startsAtUtc,
    ends_at: endsAtUtc,
  });

  const nowIso = referenceDate.toISOString();

  const originalBooking = transitionBooking(booking, "RESCHEDULED", {
    referenceTime: referenceDate,
  });

  const newBooking: BookingRecord = {
    id: resolvedNewBookingId,
    tenant_id: booking.tenant_id,
    court_id: targetCourtId,
    customer_id: booking.customer_id,
    status: "CONFIRMED",
    starts_at: startsAtUtc,
    ends_at: endsAtUtc,
    hold_expires_at: null,
    total_price_cop: booking.total_price_cop,
    deposit_required_cop: booking.deposit_required_cop,
    balance_due_cop: booking.balance_due_cop,
    rescheduled_from_booking_id: booking.id,
    created_by_user_id:
      createdByUserId !== undefined ? createdByUserId : booking.created_by_user_id,
    cancellation_reason: null,
    notes: notes !== undefined ? notes : booking.notes,
    created_at: nowIso,
    updated_at: nowIso,
  };

  const updatedPayments = payments.map((payment) => {
    if (
      payment.tenant_id === booking.tenant_id &&
      payment.booking_id === booking.id &&
      payment.payment_type === DEPOSIT_PAYMENT_TYPE &&
      ACTIVE_DEPOSIT_STATUSES.includes(payment.status)
    ) {
      return {
        ...payment,
        booking_id: newBooking.id,
        updated_at: nowIso,
      };
    }
    return payment;
  });

  return {
    originalBooking,
    newBooking,
    payments: updatedPayments,
  };
}

export interface MoveHoldBookingInput {
  booking: BookingRecord;
  newCourtId?: string;
  startsAtUtc?: string;
  endsAtUtc?: string;
  localDate?: string;
  localStartTime?: string;
  localEndTime?: string;
  timezone?: string;
  slotDurationMinutes?: number;
  referenceTime?: string | Date;
  existingBookings?: readonly BookingAvailabilityCandidate[];
}

/**
 * Moves an active (non-expired) `HOLD` booking to another court/time slot in place,
 * verifying that the target slot is not in the past and does not overlap any blocking booking.
 */
export function moveHoldBooking(input: MoveHoldBookingInput): BookingRecord {
  const { booking, newCourtId, referenceTime, existingBookings = [] } = input;
  const referenceDate = resolveReferenceDate(referenceTime);

  if (booking.status !== "HOLD") {
    throw new InvalidBookingTransitionError(
      booking.status,
      "HOLD",
      "only HOLD bookings can be moved in place",
    );
  }

  if (isHoldBookingExpired(booking, referenceDate)) {
    throw new InvalidBookingTransitionError(
      booking.status,
      "HOLD",
      "HOLD booking has already expired",
    );
  }

  const targetCourtId = newCourtId !== undefined ? newCourtId.trim() : booking.court_id;
  if (!targetCourtId || targetCourtId.length === 0) {
    throw new Error("newCourtId must be a non-empty court ID");
  }

  const originalDurationMinutes = Math.round(
    (Date.parse(booking.ends_at) - Date.parse(booking.starts_at)) / 60_000,
  );
  const fallbackSlotDuration =
    Number.isInteger(originalDurationMinutes) && originalDurationMinutes > 0
      ? originalDurationMinutes
      : DEFAULT_SLOT_MINUTES;

  const { startsAtUtc, endsAtUtc } = resolveBookingUtcSlot({
    tenantId: booking.tenant_id,
    courtId: targetCourtId,
    customerId: booking.customer_id,
    startsAtUtc: input.startsAtUtc,
    endsAtUtc: input.endsAtUtc,
    localDate: input.localDate,
    localStartTime: input.localStartTime,
    localEndTime: input.localEndTime,
    timezone: input.timezone,
    slotDurationMinutes: input.slotDurationMinutes ?? fallbackSlotDuration,
  });

  if (Date.parse(startsAtUtc) < referenceDate.getTime()) {
    throw new ReschedulePolicyError(
      "NEW_SLOT_IN_PAST",
      "Moved booking slot starts_at cannot be in the past",
    );
  }

  const activeBlockingBookings = existingBookings.filter(
    (candidate) => candidate.id !== booking.id && isBookingBlockingAt(candidate, referenceDate),
  );

  assertNoBookingOverlap(activeBlockingBookings, {
    id: booking.id,
    tenant_id: booking.tenant_id,
    court_id: targetCourtId,
    status: "HOLD",
    starts_at: startsAtUtc,
    ends_at: endsAtUtc,
  });

  return {
    ...booking,
    court_id: targetCourtId,
    starts_at: startsAtUtc,
    ends_at: endsAtUtc,
    updated_at: referenceDate.toISOString(),
  };
}

export interface CancelBookingInput {
  booking: BookingRecord;
  cancellationReason: string;
  referenceTime?: string | Date;
}

/**
 * Cancels an active (`HOLD` or `CONFIRMED`) booking with a mandatory cancellation reason.
 */
export function cancelBooking(input: CancelBookingInput): BookingRecord {
  return transitionBooking(input.booking, "CANCELLED", {
    cancellationReason: input.cancellationReason,
    referenceTime: input.referenceTime,
  });
}

export const QUICK_DEPOSIT_REJECTION_REASONS = [
  "Monto incompleto",
  "Imagen borrosa / no abre",
  "Comprobante no válido",
] as const;

export type DepositValidationErrorCode =
  | "BOOKING_MISMATCH"
  | "INVALID_PAYMENT_TYPE"
  | "PAYMENT_NOT_PENDING"
  | "VALIDATOR_USER_REQUIRED"
  | "REJECTION_REASON_REQUIRED"
  | "RECEIPT_URL_REQUIRED"
  | "INVALID_DEPOSIT_AMOUNT";

export class DepositValidationError extends Error {
  readonly code: DepositValidationErrorCode;

  constructor(code: DepositValidationErrorCode, message: string) {
    super(message);
    this.name = "DepositValidationError";
    this.code = code;
  }
}

export interface SubmitDepositReceiptInput {
  id?: string;
  booking: BookingRecord;
  receiptMediaUrl: string;
  amountCop?: number;
  method?: Extract<PaymentMethod, "transfer" | "cash">;
  referenceTime?: string | Date;
}

/**
 * Registers a deposit payment with a receipt (`status = 'pending_validation'`) for a `HOLD` booking,
 * protecting the booking from automatic `HOLD` expiration while awaiting staff review (`RF-08`, `CY-038`).
 */
export function submitDepositReceipt(input: SubmitDepositReceiptInput): PaymentRecord {
  const { booking, receiptMediaUrl, method = "transfer", referenceTime } = input;

  if (booking.status !== "HOLD") {
    throw new InvalidBookingTransitionError(
      booking.status,
      "HOLD",
      "deposit receipt can only be submitted for a HOLD booking",
    );
  }

  const trimmedUrl = (receiptMediaUrl ?? "").trim();
  if (trimmedUrl.length === 0) {
    throw new DepositValidationError("RECEIPT_URL_REQUIRED", "receiptMediaUrl is required");
  }

  const amountCop = input.amountCop ?? booking.deposit_required_cop;
  if (!Number.isInteger(amountCop) || amountCop <= 0 || amountCop > booking.total_price_cop) {
    throw new DepositValidationError(
      "INVALID_DEPOSIT_AMOUNT",
      "amountCop must be a positive integer in COP not exceeding total_price_cop",
    );
  }

  const cashAmountCop = method === "cash" ? amountCop : 0;
  const transferAmountCop = method === "transfer" ? amountCop : 0;

  if (
    !validatePaymentBreakdownCop({
      method,
      amountCop,
      cashAmountCop,
      transferAmountCop,
    })
  ) {
    throw new DepositValidationError(
      "INVALID_DEPOSIT_AMOUNT",
      "Invalid deposit payment breakdown in COP",
    );
  }

  const referenceDate = resolveReferenceDate(referenceTime);
  const nowIso = referenceDate.toISOString();
  const paymentId = input.id && input.id.trim().length > 0 ? input.id.trim() : crypto.randomUUID();

  return {
    id: paymentId,
    tenant_id: booking.tenant_id,
    booking_id: booking.id,
    payment_type: "deposit",
    method,
    status: "pending_validation",
    amount_cop: amountCop,
    cash_amount_cop: cashAmountCop,
    transfer_amount_cop: transferAmountCop,
    receipt_media_url: trimmedUrl,
    validated_by_user_id: null,
    validated_at: null,
    rejection_reason: null,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

export interface ApproveDepositPaymentInput {
  booking: BookingRecord;
  payment: PaymentRecord;
  validatedByUserId: string;
  referenceTime?: string | Date;
}

export interface ApproveDepositPaymentResult {
  booking: BookingRecord;
  payment: PaymentRecord;
}

function assertPendingDepositForBooking(
  booking: BookingRecord,
  payment: PaymentRecord,
  validatedByUserId: string,
): string {
  if (payment.tenant_id !== booking.tenant_id || payment.booking_id !== booking.id) {
    throw new DepositValidationError(
      "BOOKING_MISMATCH",
      "Payment does not belong to the target booking and tenant",
    );
  }
  if (payment.payment_type !== "deposit") {
    throw new DepositValidationError(
      "INVALID_PAYMENT_TYPE",
      "Only deposit payments can be validated in the deposit queue",
    );
  }
  if (payment.status !== "pending_validation") {
    throw new DepositValidationError(
      "PAYMENT_NOT_PENDING",
      `Deposit payment is already in status ${payment.status}`,
    );
  }
  const validatorId = (validatedByUserId ?? "").trim();
  if (validatorId.length === 0) {
    throw new DepositValidationError(
      "VALIDATOR_USER_REQUIRED",
      "validatedByUserId is required to validate a deposit",
    );
  }
  return validatorId;
}

/**
 * Approves a pending deposit payment in 1 touch (`CY-038`, `RF-08`):
 * 1. Marks the payment as `approved` with `validated_by_user_id` and `validated_at`.
 * 2. Transitions the booking from `HOLD` to `CONFIRMED` (`hold_expires_at = null`)
 *    and updates `balance_due_cop = Math.max(0, total_price_cop - payment.amount_cop)`.
 */
export function approveDepositPayment(
  input: ApproveDepositPaymentInput,
): ApproveDepositPaymentResult {
  const { booking, payment, validatedByUserId, referenceTime } = input;
  const validatorId = assertPendingDepositForBooking(booking, payment, validatedByUserId);
  const referenceDate = resolveReferenceDate(referenceTime);
  const nowIso = referenceDate.toISOString();

  const confirmedBooking = transitionBooking(booking, "CONFIRMED", {
    referenceTime: referenceDate,
  });

  const updatedBooking: BookingRecord = {
    ...confirmedBooking,
    hold_expires_at: null,
    balance_due_cop: Math.max(0, booking.total_price_cop - payment.amount_cop),
    updated_at: nowIso,
  };

  const updatedPayment: PaymentRecord = {
    ...payment,
    status: "approved",
    validated_by_user_id: validatorId,
    validated_at: nowIso,
    rejection_reason: null,
    updated_at: nowIso,
  };

  return {
    booking: updatedBooking,
    payment: updatedPayment,
  };
}

export interface RejectDepositPaymentInput {
  booking: BookingRecord;
  payment: PaymentRecord;
  validatedByUserId: string;
  rejectionReason: string;
  /**
   * Optional additional payment records for the booking to check if another active deposit exists.
   */
  otherPayments?: readonly DepositPaymentCandidate[];
  referenceTime?: string | Date;
}

export interface RejectDepositPaymentResult {
  booking: BookingRecord;
  payment: PaymentRecord;
  bookingExpired: boolean;
}

/**
 * Rejects a pending deposit payment with a mandatory reason (`CY-038`, `RF-08`):
 * 1. Marks the payment as `rejected` with `rejection_reason`, `validated_by_user_id`, and `validated_at`.
 * 2. If the `HOLD` booking has already passed `hold_expires_at` and has no other active deposit,
 *    automatically transitions the booking to `CANCELLED` (`HOLD_EXPIRED`) to release the court slot.
 *    Otherwise keeps the booking in `HOLD` so the customer can send a new receipt before it expires.
 */
export function rejectDepositPayment(input: RejectDepositPaymentInput): RejectDepositPaymentResult {
  const {
    booking,
    payment,
    validatedByUserId,
    rejectionReason,
    otherPayments = [],
    referenceTime,
  } = input;

  const validatorId = assertPendingDepositForBooking(booking, payment, validatedByUserId);
  const trimmedReason = (rejectionReason ?? "").trim();
  if (trimmedReason.length === 0) {
    throw new DepositValidationError(
      "REJECTION_REASON_REQUIRED",
      "rejectionReason is required when rejecting a deposit receipt",
    );
  }

  const referenceDate = resolveReferenceDate(referenceTime);
  const nowIso = referenceDate.toISOString();

  const updatedPayment: PaymentRecord = {
    ...payment,
    status: "rejected",
    validated_by_user_id: validatorId,
    validated_at: nowIso,
    rejection_reason: trimmedReason,
    updated_at: nowIso,
  };

  const remainingPayments = otherPayments.filter((candidate) => candidate !== payment);
  const shouldExpireHold =
    booking.status === "HOLD" &&
    isHoldBookingExpired(booking, referenceDate) &&
    !hasActiveDepositPayment(booking, remainingPayments);

  if (shouldExpireHold) {
    const expiredBooking = transitionBooking(booking, "CANCELLED", {
      referenceTime: referenceDate,
      cancellationReason: HOLD_EXPIRED_CANCELLATION_REASON,
    });
    return {
      booking: {
        ...expiredBooking,
        updated_at: nowIso,
      },
      payment: updatedPayment,
      bookingExpired: true,
    };
  }

  return {
    booking,
    payment: updatedPayment,
    bookingExpired: false,
  };
}
