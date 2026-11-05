import { describe, expect, it } from "vitest";
import {
  BookingOverlapError,
  computeHoldExpiresAt,
  createHoldBooking,
  DEFAULT_PILOT_OPERATING_HOURS,
  getAvailableSlotsBySportAndDate,
  PILOT_SEED_COURTS,
  PILOT_SEED_TENANT_ID,
  POSTGRES_EXCLUSION_VIOLATION_CODE,
  type BookingAvailabilityCandidate,
  type CourtAvailabilityItem,
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

