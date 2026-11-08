import { describe, expect, it } from "vitest";
import {
  assertBookingTransition,
  BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  canTransitionBooking,
  InvalidBookingTransitionError,
  transitionBooking,
  type BookingRecord,
  type BookingStatus,
} from "./index";

const ENDED_AT = "2026-11-10T16:00:00.000Z";
const AFTER_END = "2026-11-10T16:30:00.000Z";
const BEFORE_END = "2026-11-10T15:30:00.000Z";

function makeBooking(status: BookingStatus): BookingRecord {
  return {
    id: "b1",
    tenant_id: "t1",
    court_id: "c1",
    customer_id: "cu1",
    status,
    starts_at: "2026-11-10T15:00:00.000Z",
    ends_at: ENDED_AT,
    hold_expires_at: status === "HOLD" ? "2026-11-09T00:00:00.000Z" : null,
    total_price_cop: 60000,
    deposit_required_cop: 12000,
    balance_due_cop: 60000,
    rescheduled_from_booking_id: null,
    created_by_user_id: null,
    cancellation_reason: null,
    notes: null,
    created_at: "2026-11-08T00:00:00.000Z",
    updated_at: "2026-11-08T00:00:00.000Z",
  };
}

describe("booking state machine", () => {
  const validPairs = BOOKING_STATUSES.flatMap((from) =>
    BOOKING_TRANSITIONS[from].map((to) => [from, to] as const),
  );
  const invalidPairs = BOOKING_STATUSES.flatMap((from) =>
    BOOKING_STATUSES.filter((to) => !BOOKING_TRANSITIONS[from].includes(to)).map(
      (to) => [from, to] as const,
    ),
  );

  it("defines the agreed graph", () => {
    expect(validPairs).toHaveLength(6);
    expect(invalidPairs).toHaveLength(30);
  });

  it.each(validPairs)("allows %s -> %s", (from, to) => {
    expect(canTransitionBooking(from, to)).toBe(true);
    const result = transitionBooking(makeBooking(from), to, {
      referenceTime: AFTER_END,
      cancellationReason: "customer_request",
    });
    expect(result.status).toBe(to);
    expect(result.updated_at).toBe(AFTER_END);
  });

  it.each(invalidPairs)("rejects %s -> %s", (from, to) => {
    expect(canTransitionBooking(from, to)).toBe(false);
    expect(() =>
      transitionBooking(makeBooking(from), to, {
        referenceTime: AFTER_END,
        cancellationReason: "x",
      }),
    ).toThrow(InvalidBookingTransitionError);
  });

  it("rejects COMPLETED and NO_SHOW before ends_at", () => {
    for (const to of ["COMPLETED", "NO_SHOW"] as const) {
      expect(() =>
        assertBookingTransition(makeBooking("CONFIRMED"), to, { referenceTime: BEFORE_END }),
      ).toThrow(/not ended/);
    }
  });

  it("requires a cancellation reason for CANCELLED", () => {
    expect(() =>
      transitionBooking(makeBooking("HOLD"), "CANCELLED", { referenceTime: BEFORE_END }),
    ).toThrow(/cancellation_reason/);
    expect(() =>
      transitionBooking(makeBooking("HOLD"), "CANCELLED", {
        referenceTime: BEFORE_END,
        cancellationReason: "   ",
      }),
    ).toThrow(/cancellation_reason/);
  });

  it("stores the cancellation reason and does not mutate the input", () => {
    const booking = makeBooking("CONFIRMED");
    const result = transitionBooking(booking, "CANCELLED", {
      referenceTime: BEFORE_END,
      cancellationReason: " customer_request ",
    });
    expect(result.cancellation_reason).toBe("customer_request");
    expect(booking.status).toBe("CONFIRMED");
  });
});
