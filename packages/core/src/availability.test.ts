import { describe, expect, it } from "vitest";
import {
  DEFAULT_PILOT_OPERATING_HOURS,
  type BookingAvailabilityCandidate,
  type CourtAvailabilityItem,
  getAvailableSlotsBySportAndDate,
  getLocalDateUtcBounds,
  isBookingBlockingAt,
  localDateTimeToUtcIso,
  PILOT_SEED_COURTS,
  PILOT_SEED_TENANT_ID,
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
const futbolCourt1Id = PILOT_SEED_COURTS[2].id;

describe("Availability service by sport and date (CY-030)", () => {
  it("computes exact UTC bounds for a local date in America/Bogota (ADR-003)", () => {
    const bounds = getLocalDateUtcBounds("2026-11-05", "America/Bogota");

    expect(bounds).toEqual({
      localDate: "2026-11-05",
      weekday: "thursday",
      startUtc: "2026-11-05T05:00:00.000Z",
      endUtc: "2026-11-06T05:00:00.000Z",
    });
  });

  it("returns all 10 hourly slots (14:00 to 24:00) with both padel courts free when there are no bookings", () => {
    const slots = getAvailableSlotsBySportAndDate({
      tenantId: PILOT_SEED_TENANT_ID,
      sport: "padel",
      localDate: "2026-11-05",
      operatingHours: DEFAULT_PILOT_OPERATING_HOURS,
      courts: pilotCourts,
      bookings: [],
      referenceTime: "2026-11-05T15:00:00.000Z",
    });

    expect(slots).toHaveLength(10);
    expect(slots[0]?.localStartTime).toBe("14:00");
    expect(slots[0]?.localEndTime).toBe("15:00");
    expect(slots[0]?.startsAtUtc).toBe("2026-11-05T19:00:00.000Z");
    expect(slots[0]?.endsAtUtc).toBe("2026-11-05T20:00:00.000Z");

    expect(slots[9]?.localStartTime).toBe("23:00");
    expect(slots[9]?.localEndTime).toBe("24:00");
    expect(slots[9]?.startsAtUtc).toBe("2026-11-06T04:00:00.000Z");
    expect(slots[9]?.endsAtUtc).toBe("2026-11-06T05:00:00.000Z");

    for (const slot of slots) {
      expect(slot.isAvailable).toBe(true);
      expect(slot.availableCourts.map((court) => court.id)).toEqual([
        padelCourt1Id,
        padelCourt2Id,
      ]);
      expect(slot.occupiedCourtIds).toEqual([]);
    }
  });

  it("handles midnight crossing (19:00-24:00 America/Bogota = 00:00Z-05:00Z next UTC day) without mixing previous night UTC bookings", () => {
    const bookings: BookingAvailabilityCandidate[] = [
      // Previous local night (2026-11-04 22:00-23:00 Bogota = 2026-11-05T03:00Z-04:00Z):
      // Same UTC calendar date "2026-11-05", but belongs to Nov 4 in Bogota -> must NOT affect Nov 5
      {
        id: "booking-prev-night-utc",
        tenant_id: PILOT_SEED_TENANT_ID,
        court_id: padelCourt1Id,
        status: "CONFIRMED",
        starts_at: "2026-11-05T03:00:00.000Z",
        ends_at: "2026-11-05T04:00:00.000Z",
      },
      // Exact UTC midnight boundary (2026-11-05 19:00-20:00 Bogota = 2026-11-06T00:00Z-01:00Z)
      {
        id: "booking-19h-utc-midnight",
        tenant_id: PILOT_SEED_TENANT_ID,
        court_id: padelCourt1Id,
        status: "CONFIRMED",
        starts_at: localDateTimeToUtcIso("2026-11-05", "19:00", "America/Bogota"),
        ends_at: localDateTimeToUtcIso("2026-11-05", "20:00", "America/Bogota"),
      },
      // Last slot before local midnight closing (2026-11-05 23:00-24:00 Bogota = 2026-11-06T04:00Z-05:00Z) on both courts
      {
        id: "booking-23h-court-1",
        tenant_id: PILOT_SEED_TENANT_ID,
        court_id: padelCourt1Id,
        status: "CONFIRMED",
        starts_at: "2026-11-06T04:00:00.000Z",
        ends_at: "2026-11-06T05:00:00.000Z",
      },
      {
        id: "booking-23h-court-2",
        tenant_id: PILOT_SEED_TENANT_ID,
        court_id: padelCourt2Id,
        status: "CONFIRMED",
        starts_at: "2026-11-06T04:00:00.000Z",
        ends_at: "2026-11-06T05:00:00.000Z",
      },
    ];

    const slots = getAvailableSlotsBySportAndDate({
      tenantId: PILOT_SEED_TENANT_ID,
      sport: "padel",
      localDate: "2026-11-05",
      operatingHours: DEFAULT_PILOT_OPERATING_HOURS,
      courts: pilotCourts,
      bookings,
      referenceTime: "2026-11-05T18:00:00.000Z",
    });

    const slot19h = slots.find((slot) => slot.localStartTime === "19:00");
    expect(slot19h?.startsAtUtc).toBe("2026-11-06T00:00:00.000Z");
    expect(slot19h?.endsAtUtc).toBe("2026-11-06T01:00:00.000Z");
    expect(slot19h?.isAvailable).toBe(true);
    expect(slot19h?.occupiedCourtIds).toEqual([padelCourt1Id]);
    expect(slot19h?.availableCourts.map((court) => court.id)).toEqual([padelCourt2Id]);

    const slot22h = slots.find((slot) => slot.localStartTime === "22:00");
    expect(slot22h?.isAvailable).toBe(true);
    expect(slot22h?.availableCourts).toHaveLength(2);

    const slot23h = slots.find((slot) => slot.localStartTime === "23:00");
    expect(slot23h?.isAvailable).toBe(false);
    expect(slot23h?.availableCourts).toEqual([]);
    expect(slot23h?.occupiedCourtIds).toEqual([padelCourt1Id, padelCourt2Id]);

    const freeSlotsOnly = getAvailableSlotsBySportAndDate({
      tenantId: PILOT_SEED_TENANT_ID,
      sport: "padel",
      localDate: "2026-11-05",
      operatingHours: DEFAULT_PILOT_OPERATING_HOURS,
      courts: pilotCourts,
      bookings,
      referenceTime: "2026-11-05T18:00:00.000Z",
      onlyAvailable: true,
    });

    expect(freeSlotsOnly).toHaveLength(9);
    expect(freeSlotsOnly.some((slot) => slot.localStartTime === "23:00")).toBe(false);
  });

  it("treats active HOLD bookings as blocking and expired HOLD bookings (hold_expires_at <= now) as free", () => {
    const referenceNow = "2026-11-05T20:15:00.000Z";

    const bookings: BookingAvailabilityCandidate[] = [
      // Active HOLD on Court 1 for 16:00-17:00 local (expires 5 min in the future)
      {
        id: "hold-active",
        tenant_id: PILOT_SEED_TENANT_ID,
        court_id: padelCourt1Id,
        status: "HOLD",
        starts_at: "2026-11-05T21:00:00.000Z",
        ends_at: "2026-11-05T22:00:00.000Z",
        hold_expires_at: "2026-11-05T20:20:00.000Z",
      },
      // Expired HOLD on Court 2 for 16:00-17:00 local (expired at exact referenceNow boundary)
      {
        id: "hold-expired-boundary",
        tenant_id: PILOT_SEED_TENANT_ID,
        court_id: padelCourt2Id,
        status: "HOLD",
        starts_at: "2026-11-05T21:00:00.000Z",
        ends_at: "2026-11-05T22:00:00.000Z",
        hold_expires_at: "2026-11-05T20:15:00.000Z",
      },
      // Expired HOLD on Court 1 for 17:00-18:00 local (expired 10 min ago)
      {
        id: "hold-expired-past",
        tenant_id: PILOT_SEED_TENANT_ID,
        court_id: padelCourt1Id,
        status: "HOLD",
        starts_at: "2026-11-05T22:00:00.000Z",
        ends_at: "2026-11-05T23:00:00.000Z",
        hold_expires_at: "2026-11-05T20:05:00.000Z",
      },
    ];

    expect(isBookingBlockingAt(bookings[0]!, referenceNow)).toBe(true);
    expect(isBookingBlockingAt(bookings[1]!, referenceNow)).toBe(false);
    expect(isBookingBlockingAt(bookings[2]!, referenceNow)).toBe(false);

    const slots = getAvailableSlotsBySportAndDate({
      tenantId: PILOT_SEED_TENANT_ID,
      sport: "padel",
      localDate: "2026-11-05",
      operatingHours: DEFAULT_PILOT_OPERATING_HOURS,
      courts: pilotCourts,
      bookings,
      referenceTime: referenceNow,
    });

    const slot16h = slots.find((slot) => slot.localStartTime === "16:00");
    expect(slot16h?.isAvailable).toBe(true);
    expect(slot16h?.occupiedCourtIds).toEqual([padelCourt1Id]);
    expect(slot16h?.availableCourts.map((court) => court.id)).toEqual([padelCourt2Id]);

    const slot17h = slots.find((slot) => slot.localStartTime === "17:00");
    expect(slot17h?.isAvailable).toBe(true);
    expect(slot17h?.occupiedCourtIds).toEqual([]);
    expect(slot17h?.availableCourts.map((court) => court.id)).toEqual([
      padelCourt1Id,
      padelCourt2Id,
    ]);
  });

  it("ignores CANCELLED and RESCHEDULED bookings, other sports, other tenants, and inactive courts", () => {
    const courtsWithInactive: CourtAvailabilityItem[] = [
      ...pilotCourts.map((court) =>
        court.id === padelCourt2Id ? { ...court, is_active: false } : court,
      ),
    ];

    const bookings: BookingAvailabilityCandidate[] = [
      {
        id: "cancelled-booking",
        tenant_id: PILOT_SEED_TENANT_ID,
        court_id: padelCourt1Id,
        status: "CANCELLED",
        starts_at: "2026-11-05T19:00:00.000Z",
        ends_at: "2026-11-05T20:00:00.000Z",
      },
      {
        id: "rescheduled-booking",
        tenant_id: PILOT_SEED_TENANT_ID,
        court_id: padelCourt1Id,
        status: "RESCHEDULED",
        starts_at: "2026-11-05T19:00:00.000Z",
        ends_at: "2026-11-05T20:00:00.000Z",
      },
      {
        id: "other-sport-booking",
        tenant_id: PILOT_SEED_TENANT_ID,
        court_id: futbolCourt1Id,
        status: "CONFIRMED",
        starts_at: "2026-11-05T19:00:00.000Z",
        ends_at: "2026-11-05T20:00:00.000Z",
      },
      {
        id: "other-tenant-booking",
        tenant_id: "99999999-9999-4999-8999-999999999999",
        court_id: padelCourt1Id,
        status: "CONFIRMED",
        starts_at: "2026-11-05T19:00:00.000Z",
        ends_at: "2026-11-05T20:00:00.000Z",
      },
    ];

    const slots = getAvailableSlotsBySportAndDate({
      tenantId: PILOT_SEED_TENANT_ID,
      sport: "padel",
      localDate: "2026-11-05",
      operatingHours: DEFAULT_PILOT_OPERATING_HOURS,
      courts: courtsWithInactive,
      bookings,
      referenceTime: "2026-11-05T18:00:00.000Z",
    });

    const slot14h = slots.find((slot) => slot.localStartTime === "14:00");
    expect(slot14h?.isAvailable).toBe(true);
    expect(slot14h?.availableCourts.map((court) => court.id)).toEqual([padelCourt1Id]);
  });

  it("returns empty slots when the venue is closed on the requested weekday and validates bad inputs", () => {
    const closedOnSunday = {
      ...DEFAULT_PILOT_OPERATING_HOURS,
      sunday: { open: "14:00", close: "24:00", isClosed: true },
    };

    // 2026-11-08 is a Sunday
    const slots = getAvailableSlotsBySportAndDate({
      tenantId: PILOT_SEED_TENANT_ID,
      sport: "futbol_5",
      localDate: "2026-11-08",
      operatingHours: closedOnSunday,
      courts: pilotCourts,
      bookings: [],
    });

    expect(slots).toEqual([]);

    expect(() =>
      getAvailableSlotsBySportAndDate({
        tenantId: PILOT_SEED_TENANT_ID,
        sport: "padel",
        localDate: "2026-02-30",
        operatingHours: DEFAULT_PILOT_OPERATING_HOURS,
        courts: pilotCourts,
        bookings: [],
      }),
    ).toThrow(/Invalid calendar date/);

    expect(() =>
      isBookingBlockingAt(
        { status: "HOLD", hold_expires_at: null },
        "2026-11-05T18:00:00.000Z",
      ),
    ).toThrow(/hold_expires_at/);
  });
});

