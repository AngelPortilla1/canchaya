import { describe, expect, it } from "vitest";
import {
  assertCanRescheduleBooking,
  assertNoBookingOverlap,
  BookingOverlapError,
  canRescheduleBooking,
  computeHoldExpiresAt,
  createHoldBooking,
  DEFAULT_MIN_RESCHEDULE_HOURS,
  DEFAULT_PILOT_OPERATING_HOURS,
  expireOverdueHoldBookings,
  getAvailableSlotsBySportAndDate,
  HOLD_EXPIRED_CANCELLATION_REASON,
  InvalidBookingTransitionError,
  isHoldBookingExpired,
  PILOT_SEED_COURTS,
  PILOT_SEED_TENANT_ID,
  POSTGRES_EXCLUSION_VIOLATION_CODE,
  rescheduleBooking,
  ReschedulePolicyError,
  type BookingAvailabilityCandidate,
  type BookingRecord,
  type CourtAvailabilityItem,
  type DepositPaymentCandidate,
  type PaymentRecord,
} from "./index";

const pilotCourts: CourtAvailabilityItem[] = PILOT_SEED_COURTS.map((court) => ({
  id: court.id,
  tenant_id: PILOT_SEED_TENANT_ID,
  sportCode: court.sportCode,
  name: court.name,
  displayOrder: court.displayOrder,
  is_active: true,
}));

const padelCourt1Id = PILOT_SEED_COURTS[0].id;
const padelCourt2Id = PILOT_SEED_COURTS[1].id;
const customerId = "44444444-4444-4444-8444-444444444401";

describe("HOLD booking creation with 15-minute expiration (CY-031)", () => {
  it("computes hold_expires_at exactly 15 minutes after referenceTime in UTC by default", () => {
    const expiresAt = computeHoldExpiresAt("2026-11-05T19:00:00.000Z");
    expect(expiresAt).toBe("2026-11-05T19:15:00.000Z");

    const customExpiresAt = computeHoldExpiresAt("2026-11-05T23:50:00.000Z", 20);
    expect(customExpiresAt).toBe("2026-11-06T00:10:00.000Z");
  });

  it("creates a HOLD booking with 15-min expiration and integer COP amounts ($60.000 total, $12.000 deposit)", () => {
    const referenceNow = "2026-11-05T18:30:00.000Z";

    const holdBooking = createHoldBooking({
      id: "booking-hold-1",
      tenantId: PILOT_SEED_TENANT_ID,
      courtId: padelCourt1Id,
      customerId,
      localDate: "2026-11-05",
      localStartTime: "19:00",
      referenceTime: referenceNow,
    });

    expect(holdBooking).toEqual({
      id: "booking-hold-1",
      tenant_id: PILOT_SEED_TENANT_ID,
      court_id: padelCourt1Id,
      customer_id: customerId,
      status: "HOLD",
      // 19:00-20:00 America/Bogota = 00:00Z-01:00Z next UTC day
      starts_at: "2026-11-06T00:00:00.000Z",
      ends_at: "2026-11-06T01:00:00.000Z",
      hold_expires_at: "2026-11-05T18:45:00.000Z",
      total_price_cop: 60_000,
      deposit_required_cop: 12_000,
      balance_due_cop: 60_000,
      rescheduled_from_booking_id: null,
      created_by_user_id: null,
      cancellation_reason: null,
      notes: null,
      created_at: "2026-11-05T18:30:00.000Z",
      updated_at: "2026-11-05T18:30:00.000Z",
    });
  });

  it("blocks the court slot in availability while within the 15-minute window and releases it once expired", () => {
    const createdAt = "2026-11-05T18:00:00.000Z";

    const holdBooking = createHoldBooking({
      id: "booking-hold-slot-20h",
      tenantId: PILOT_SEED_TENANT_ID,
      courtId: padelCourt1Id,
      customerId,
      localDate: "2026-11-05",
      localStartTime: "20:00",
      referenceTime: createdAt,
    });

    expect(holdBooking.hold_expires_at).toBe("2026-11-05T18:15:00.000Z");

    // 10 minutes after creation (18:10Z < 18:15Z): Court 1 must be blocked at 20:00 local
    const slotsDuringHold = getAvailableSlotsBySportAndDate({
      tenantId: PILOT_SEED_TENANT_ID,
      sport: "padel",
      localDate: "2026-11-05",
      operatingHours: DEFAULT_PILOT_OPERATING_HOURS,
      courts: pilotCourts,
      bookings: [holdBooking],
      referenceTime: "2026-11-05T18:10:00.000Z",
    });

    const slot20hDuringHold = slotsDuringHold.find((slot) => slot.localStartTime === "20:00");
    expect(slot20hDuringHold?.occupiedCourtIds).toEqual([padelCourt1Id]);
    expect(slot20hDuringHold?.availableCourts.map((court) => court.id)).toEqual([padelCourt2Id]);

    // 15 minutes after creation (18:15Z == hold_expires_at): Court 1 is free again
    const slotsAfterExpiry = getAvailableSlotsBySportAndDate({
      tenantId: PILOT_SEED_TENANT_ID,
      sport: "padel",
      localDate: "2026-11-05",
      operatingHours: DEFAULT_PILOT_OPERATING_HOURS,
      courts: pilotCourts,
      bookings: [holdBooking],
      referenceTime: "2026-11-05T18:15:00.000Z",
    });

    const slot20hAfterExpiry = slotsAfterExpiry.find((slot) => slot.localStartTime === "20:00");
    expect(slot20hAfterExpiry?.occupiedCourtIds).toEqual([]);
    expect(slot20hAfterExpiry?.availableCourts.map((court) => court.id)).toEqual([
      padelCourt1Id,
      padelCourt2Id,
    ]);
  });

  it("rejects creating a HOLD booking when an active HOLD or CONFIRMED booking already blocks the court slot", () => {
    const createdAt = "2026-11-05T18:00:00.000Z";

    const firstHold = createHoldBooking({
      id: "hold-first",
      tenantId: PILOT_SEED_TENANT_ID,
      courtId: padelCourt1Id,
      customerId,
      startsAtUtc: "2026-11-05T21:00:00.000Z",
      endsAtUtc: "2026-11-05T22:00:00.000Z",
      referenceTime: createdAt,
    });

    // Attempting to create another HOLD on the same court 5 minutes later -> must fail with 23P01
    try {
      createHoldBooking({
        id: "hold-second-conflict",
        tenantId: PILOT_SEED_TENANT_ID,
        courtId: padelCourt1Id,
        customerId,
        startsAtUtc: "2026-11-05T21:00:00.000Z",
        endsAtUtc: "2026-11-05T22:00:00.000Z",
        referenceTime: "2026-11-05T18:05:00.000Z",
        existingBookings: [firstHold],
      });
      expect.unreachable("Expected overlapping HOLD creation to throw BookingOverlapError");
    } catch (error) {
      expect(error).toBeInstanceOf(BookingOverlapError);
      const overlapError = error as BookingOverlapError;
      expect(overlapError.code).toBe(POSTGRES_EXCLUSION_VIOLATION_CODE);
      expect(overlapError.conflictingBookingId).toBe("hold-first");
    }

    // Creating a HOLD on the same court AFTER the first HOLD has expired (18:16Z > 18:15Z) -> allowed
    const replacementHold = createHoldBooking({
      id: "hold-after-expiry",
      tenantId: PILOT_SEED_TENANT_ID,
      courtId: padelCourt1Id,
      customerId,
      startsAtUtc: "2026-11-05T21:00:00.000Z",
      endsAtUtc: "2026-11-05T22:00:00.000Z",
      referenceTime: "2026-11-05T18:16:00.000Z",
      existingBookings: [firstHold],
    });

    expect(replacementHold.status).toBe("HOLD");
    expect(replacementHold.hold_expires_at).toBe("2026-11-05T18:31:00.000Z");

    // Creating a HOLD on Court 2 at the exact same time while Court 1 has an active HOLD -> allowed
    const otherCourtHold = createHoldBooking({
      id: "hold-court-2",
      tenantId: PILOT_SEED_TENANT_ID,
      courtId: padelCourt2Id,
      customerId,
      startsAtUtc: "2026-11-05T21:00:00.000Z",
      endsAtUtc: "2026-11-05T22:00:00.000Z",
      referenceTime: "2026-11-05T18:05:00.000Z",
      existingBookings: [firstHold],
    });

    expect(otherCourtHold.court_id).toBe(padelCourt2Id);
  });

  it("validates required inputs, time ranges, and integer COP constraints", () => {
    const existingConfirmed: BookingAvailabilityCandidate[] = [];

    expect(() =>
      createHoldBooking({
        tenantId: "",
        courtId: padelCourt1Id,
        customerId,
        startsAtUtc: "2026-11-05T21:00:00.000Z",
        existingBookings: existingConfirmed,
      }),
    ).toThrow(/tenantId is required/);

    expect(() =>
      createHoldBooking({
        tenantId: PILOT_SEED_TENANT_ID,
        courtId: padelCourt1Id,
        customerId,
        startsAtUtc: "2026-11-05T22:00:00.000Z",
        endsAtUtc: "2026-11-05T21:00:00.000Z",
      }),
    ).toThrow(/strictly greater than starts_at/);

    expect(() =>
      createHoldBooking({
        tenantId: PILOT_SEED_TENANT_ID,
        courtId: padelCourt1Id,
        customerId,
        startsAtUtc: "2026-11-05T21:00:00.000Z",
        totalPriceCop: 60000.5,
      }),
    ).toThrow(/positive integer in COP/);

    expect(() => computeHoldExpiresAt("2026-11-05T21:00:00.000Z", 0)).toThrow(
      /holdDurationMinutes must be a positive integer/,
    );
  });
});

describe("Job that expires overdue HOLD bookings and releases court slots (CY-032)", () => {
  it("identifies expired HOLD bookings (hold_expires_at <= referenceTime) and ignores active or non-HOLD bookings", () => {
    const holdBooking = createHoldBooking({
      id: "hold-check-1",
      tenantId: PILOT_SEED_TENANT_ID,
      courtId: padelCourt1Id,
      customerId,
      startsAtUtc: "2026-11-05T21:00:00.000Z",
      endsAtUtc: "2026-11-05T22:00:00.000Z",
      referenceTime: "2026-11-05T18:00:00.000Z",
    });

    expect(isHoldBookingExpired(holdBooking, "2026-11-05T18:14:59.999Z")).toBe(false);
    expect(isHoldBookingExpired(holdBooking, "2026-11-05T18:15:00.000Z")).toBe(true);
    expect(isHoldBookingExpired(holdBooking, "2026-11-05T18:20:00.000Z")).toBe(true);

    const confirmedBooking: BookingRecord = {
      ...holdBooking,
      status: "CONFIRMED",
      hold_expires_at: null,
    };
    expect(isHoldBookingExpired(confirmedBooking, "2026-11-05T19:00:00.000Z")).toBe(false);
  });

  it("expires overdue HOLD bookings without deposit to CANCELLED (HOLD_EXPIRED) and frees the court slot in GiST exclusion", () => {
    const overdueHold = createHoldBooking({
      id: "hold-overdue-no-deposit",
      tenantId: PILOT_SEED_TENANT_ID,
      courtId: padelCourt1Id,
      customerId,
      startsAtUtc: "2026-11-05T22:00:00.000Z",
      endsAtUtc: "2026-11-05T23:00:00.000Z",
      referenceTime: "2026-11-05T18:00:00.000Z", // expires at 18:15:00Z
    });

    const activeHold = createHoldBooking({
      id: "hold-still-active",
      tenantId: PILOT_SEED_TENANT_ID,
      courtId: padelCourt2Id,
      customerId,
      startsAtUtc: "2026-11-05T22:00:00.000Z",
      endsAtUtc: "2026-11-05T23:00:00.000Z",
      referenceTime: "2026-11-05T18:10:00.000Z", // expires at 18:25:00Z
    });

    // Before job runs, raw GiST exclusion check rejects a new CONFIRMED booking on Court 1
    expect(() =>
      assertNoBookingOverlap([overdueHold, activeHold], {
        id: "new-booking-attempt",
        tenant_id: PILOT_SEED_TENANT_ID,
        court_id: padelCourt1Id,
        status: "CONFIRMED",
        starts_at: "2026-11-05T22:00:00.000Z",
        ends_at: "2026-11-05T23:00:00.000Z",
      }),
    ).toThrowError(BookingOverlapError);

    // Run expiration job at 18:16:00Z
    const jobTime = "2026-11-05T18:16:00.000Z";
    const result = expireOverdueHoldBookings({
      bookings: [overdueHold, activeHold],
      referenceTime: jobTime,
    });

    expect(result.expiredCount).toBe(1);
    expect(result.expiredBookingIds).toEqual(["hold-overdue-no-deposit"]);
    expect(result.expiredBookings[0]?.status).toBe("CANCELLED");
    expect(result.expiredBookings[0]?.cancellation_reason).toBe(HOLD_EXPIRED_CANCELLATION_REASON);
    expect(result.expiredBookings[0]?.updated_at).toBe(jobTime);

    // Active HOLD on Court 2 remains untouched
    const remainingCourt2 = result.bookings.find((b) => b.id === "hold-still-active");
    expect(remainingCourt2?.status).toBe("HOLD");

    // Now the GiST exclusion constraint allows booking Court 1 for the exact same slot
    expect(() =>
      assertNoBookingOverlap(result.bookings, {
        id: "new-booking-attempt",
        tenant_id: PILOT_SEED_TENANT_ID,
        court_id: padelCourt1Id,
        status: "CONFIRMED",
        starts_at: "2026-11-05T22:00:00.000Z",
        ends_at: "2026-11-05T23:00:00.000Z",
      }),
    ).not.toThrow();

    // Running the job a second time is idempotent (0 newly expired)
    const secondRun = expireOverdueHoldBookings({
      bookings: result.bookings,
      referenceTime: "2026-11-05T18:17:00.000Z",
    });
    expect(secondRun.expiredCount).toBe(0);
  });

  it("preserves overdue HOLD bookings that have a deposit pending_validation or approved, and expires those with rejected deposit", () => {
    const holdWithPendingDeposit = createHoldBooking({
      id: "hold-pending-receipt",
      tenantId: PILOT_SEED_TENANT_ID,
      courtId: padelCourt1Id,
      customerId,
      startsAtUtc: "2026-11-05T20:00:00.000Z",
      endsAtUtc: "2026-11-05T21:00:00.000Z",
      referenceTime: "2026-11-05T18:00:00.000Z",
    });

    const holdWithRejectedDeposit = createHoldBooking({
      id: "hold-rejected-receipt",
      tenantId: PILOT_SEED_TENANT_ID,
      courtId: padelCourt2Id,
      customerId,
      startsAtUtc: "2026-11-05T20:00:00.000Z",
      endsAtUtc: "2026-11-05T21:00:00.000Z",
      referenceTime: "2026-11-05T18:00:00.000Z",
    });

    const payments: DepositPaymentCandidate[] = [
      {
        tenant_id: PILOT_SEED_TENANT_ID,
        booking_id: "hold-pending-receipt",
        payment_type: "deposit",
        status: "pending_validation",
      },
      {
        tenant_id: PILOT_SEED_TENANT_ID,
        booking_id: "hold-rejected-receipt",
        payment_type: "deposit",
        status: "rejected",
      },
    ];

    const result = expireOverdueHoldBookings({
      bookings: [holdWithPendingDeposit, holdWithRejectedDeposit],
      payments,
      referenceTime: "2026-11-05T18:20:00.000Z",
    });

    expect(result.expiredBookingIds).toEqual(["hold-rejected-receipt"]);
    expect(result.bookings.find((b) => b.id === "hold-pending-receipt")?.status).toBe("HOLD");
    expect(result.bookings.find((b) => b.id === "hold-rejected-receipt")?.status).toBe("CANCELLED");
  });
});

describe("Booking rescheduling with configurable minimum notice and preserved deposit (CY-034)", () => {
  function makeConfirmedBooking(overrides: Partial<BookingRecord> = {}): BookingRecord {
    return {
      id: "booking-confirmed-original",
      tenant_id: PILOT_SEED_TENANT_ID,
      court_id: padelCourt1Id,
      customer_id: customerId,
      status: "CONFIRMED",
      // 2026-11-10 19:00-20:00 America/Bogota = 2026-11-11 00:00-01:00 UTC
      starts_at: "2026-11-11T00:00:00.000Z",
      ends_at: "2026-11-11T01:00:00.000Z",
      hold_expires_at: null,
      total_price_cop: 60_000,
      deposit_required_cop: 12_000,
      balance_due_cop: 48_000,
      rescheduled_from_booking_id: null,
      created_by_user_id: null,
      cancellation_reason: null,
      notes: "Reserva confirmada con anticipo",
      created_at: "2026-11-08T15:00:00.000Z",
      updated_at: "2026-11-08T15:10:00.000Z",
      ...overrides,
    };
  }

  it("reschedules a CONFIRMED booking when notice >= minRescheduleHours, releasing the old slot and preserving integer COP deposit", () => {
    const confirmedBooking = makeConfirmedBooking();
    const depositPayment: PaymentRecord = {
      id: "pay-deposit-1",
      tenant_id: PILOT_SEED_TENANT_ID,
      booking_id: confirmedBooking.id,
      payment_type: "deposit",
      method: "transfer",
      status: "approved",
      amount_cop: 12_000,
      cash_amount_cop: 0,
      transfer_amount_cop: 12_000,
      receipt_media_url: "https://storage.canchaya.test/receipts/1.jpg",
      validated_by_user_id: "55555555-5555-4555-8555-555555555502",
      validated_at: "2026-11-08T15:10:00.000Z",
      rejection_reason: null,
      created_at: "2026-11-08T15:05:00.000Z",
      updated_at: "2026-11-08T15:10:00.000Z",
    };

    // Exactly 4 hours (DEFAULT_MIN_RESCHEDULE_HOURS) before starts_at (2026-11-11T00:00:00Z)
    const exactBoundaryNow = "2026-11-10T20:00:00.000Z";
    expect(DEFAULT_MIN_RESCHEDULE_HOURS).toBe(4);
    expect(canRescheduleBooking(confirmedBooking, { referenceTime: exactBoundaryNow })).toBe(true);

    const { originalBooking, newBooking, payments } = rescheduleBooking({
      booking: confirmedBooking,
      newBookingId: "booking-rescheduled-new",
      localDate: "2026-11-11",
      localStartTime: "20:00",
      referenceTime: exactBoundaryNow,
      existingBookings: [confirmedBooking],
      payments: [depositPayment],
    });

    // Original booking transitions to RESCHEDULED
    expect(originalBooking.status).toBe("RESCHEDULED");
    expect(originalBooking.updated_at).toBe(exactBoundaryNow);

    // New booking is CONFIRMED on the new slot and preserves deposit/balance in integer COP
    expect(newBooking).toEqual({
      id: "booking-rescheduled-new",
      tenant_id: PILOT_SEED_TENANT_ID,
      court_id: padelCourt1Id,
      customer_id: customerId,
      status: "CONFIRMED",
      // 2026-11-11 20:00-21:00 America/Bogota = 2026-11-12 01:00-02:00 UTC
      starts_at: "2026-11-12T01:00:00.000Z",
      ends_at: "2026-11-12T02:00:00.000Z",
      hold_expires_at: null,
      total_price_cop: 60_000,
      deposit_required_cop: 12_000,
      balance_due_cop: 48_000,
      rescheduled_from_booking_id: confirmedBooking.id,
      created_by_user_id: null,
      cancellation_reason: null,
      notes: "Reserva confirmada con anticipo",
      created_at: exactBoundaryNow,
      updated_at: exactBoundaryNow,
    });

    // Deposit payment is reassigned to the new booking
    expect(payments[0]?.booking_id).toBe("booking-rescheduled-new");
    expect(payments[0]?.amount_cop).toBe(12_000);

    // Old slot (2026-11-10 19:00 local) is now free for another customer in GiST exclusion & availability
    expect(() =>
      assertNoBookingOverlap([originalBooking, newBooking], {
        id: "another-customer-booking",
        tenant_id: PILOT_SEED_TENANT_ID,
        court_id: padelCourt1Id,
        status: "CONFIRMED",
        starts_at: confirmedBooking.starts_at,
        ends_at: confirmedBooking.ends_at,
      }),
    ).not.toThrow();
  });

  it("enforces configurable minRescheduleHours and rejects rescheduling when notice is insufficient", () => {
    const confirmedBooking = makeConfirmedBooking({
      starts_at: "2026-11-11T00:00:00.000Z",
      ends_at: "2026-11-11T01:00:00.000Z",
    });

    // 3 hours 59 minutes 59 seconds before starts_at with default 4h rule -> rejected
    const oneSecondTooLate = "2026-11-10T20:00:01.000Z";
    expect(canRescheduleBooking(confirmedBooking, { referenceTime: oneSecondTooLate })).toBe(false);

    expect(() =>
      rescheduleBooking({
        booking: confirmedBooking,
        startsAtUtc: "2026-11-12T00:00:00.000Z",
        endsAtUtc: "2026-11-12T01:00:00.000Z",
        referenceTime: oneSecondTooLate,
      }),
    ).toThrowError(ReschedulePolicyError);

    try {
      assertCanRescheduleBooking(confirmedBooking, {
        referenceTime: oneSecondTooLate,
        minRescheduleHours: 4,
      });
      expect.unreachable("Should have thrown INSUFFICIENT_NOTICE");
    } catch (error) {
      expect(error).toBeInstanceOf(ReschedulePolicyError);
      expect((error as ReschedulePolicyError).code).toBe("INSUFFICIENT_NOTICE");
    }

    // If tenant configures min_reschedule_hours = 2, then 3h59m before starts_at is allowed
    expect(
      canRescheduleBooking(confirmedBooking, {
        referenceTime: oneSecondTooLate,
        minRescheduleHours: 2,
      }),
    ).toBe(true);

    // If tenant configures min_reschedule_hours = 6, then 5h before starts_at is rejected
    expect(
      canRescheduleBooking(confirmedBooking, {
        referenceTime: "2026-11-10T19:00:00.000Z",
        minRescheduleHours: 6,
      }),
    ).toBe(false);
  });

  it("rejects rescheduling from non-CONFIRMED statuses or when allowMultipleReschedules is false for already-rescheduled bookings", () => {
    const referenceNow = "2026-11-10T12:00:00.000Z";

    for (const invalidStatus of [
      "HOLD",
      "COMPLETED",
      "NO_SHOW",
      "CANCELLED",
      "RESCHEDULED",
    ] as const) {
      const booking = makeConfirmedBooking({
        status: invalidStatus,
        hold_expires_at: invalidStatus === "HOLD" ? "2026-11-10T12:15:00.000Z" : null,
      });

      expect(canRescheduleBooking(booking, { referenceTime: referenceNow })).toBe(false);
      expect(() =>
        rescheduleBooking({
          booking,
          startsAtUtc: "2026-11-12T00:00:00.000Z",
          endsAtUtc: "2026-11-12T01:00:00.000Z",
          referenceTime: referenceNow,
        }),
      ).toThrowError(InvalidBookingTransitionError);
    }

    const alreadyRescheduledOnce = makeConfirmedBooking({
      rescheduled_from_booking_id: "previous-booking-id",
    });

    expect(
      canRescheduleBooking(alreadyRescheduledOnce, {
        referenceTime: referenceNow,
        allowMultipleReschedules: false,
      }),
    ).toBe(false);

    expect(() =>
      rescheduleBooking({
        booking: alreadyRescheduledOnce,
        startsAtUtc: "2026-11-12T00:00:00.000Z",
        endsAtUtc: "2026-11-12T01:00:00.000Z",
        referenceTime: referenceNow,
        allowMultipleReschedules: false,
      }),
    ).toThrow(/already been rescheduled/);
  });

  it("rejects rescheduling to a past slot or a slot occupied by another active booking (23P01), but ignores expired HOLDs", () => {
    const confirmedBooking = makeConfirmedBooking();
    const referenceNow = "2026-11-10T18:00:00.000Z";

    // Target slot in the past
    expect(() =>
      rescheduleBooking({
        booking: confirmedBooking,
        startsAtUtc: "2026-11-10T17:00:00.000Z",
        endsAtUtc: "2026-11-10T18:00:00.000Z",
        referenceTime: referenceNow,
      }),
    ).toThrow(/cannot be in the past/);

    const conflictingBooking: BookingAvailabilityCandidate = {
      id: "other-confirmed-booking",
      tenant_id: PILOT_SEED_TENANT_ID,
      court_id: padelCourt2Id,
      status: "CONFIRMED",
      starts_at: "2026-11-12T00:00:00.000Z",
      ends_at: "2026-11-12T01:00:00.000Z",
    };

    // Moving to Court 2 at an occupied time throws BookingOverlapError (23P01)
    expect(() =>
      rescheduleBooking({
        booking: confirmedBooking,
        newCourtId: padelCourt2Id,
        startsAtUtc: "2026-11-12T00:00:00.000Z",
        endsAtUtc: "2026-11-12T01:00:00.000Z",
        referenceTime: referenceNow,
        existingBookings: [confirmedBooking, conflictingBooking],
      }),
    ).toThrowError(BookingOverlapError);

    // Moving to Court 2 where only an expired HOLD exists succeeds
    const expiredHoldOnCourt2: BookingAvailabilityCandidate = {
      id: "expired-hold-court2",
      tenant_id: PILOT_SEED_TENANT_ID,
      court_id: padelCourt2Id,
      status: "HOLD",
      starts_at: "2026-11-12T00:00:00.000Z",
      ends_at: "2026-11-12T01:00:00.000Z",
      hold_expires_at: "2026-11-10T17:59:00.000Z",
    };

    const movedToCourt2 = rescheduleBooking({
      booking: confirmedBooking,
      newBookingId: "moved-to-court-2",
      newCourtId: padelCourt2Id,
      startsAtUtc: "2026-11-12T00:00:00.000Z",
      endsAtUtc: "2026-11-12T01:00:00.000Z",
      referenceTime: referenceNow,
      existingBookings: [confirmedBooking, expiredHoldOnCourt2],
    });

    expect(movedToCourt2.newBooking.court_id).toBe(padelCourt2Id);
    expect(movedToCourt2.newBooking.status).toBe("CONFIRMED");
  });
});
