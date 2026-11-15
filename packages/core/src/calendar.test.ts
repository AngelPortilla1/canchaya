import { describe, expect, it } from "vitest";
import {
  DEFAULT_PILOT_OPERATING_HOURS,
  buildDailyCalendarGrid,
  formatLocalDateInTimezone,
  localDateTimeToUtcIso,
  shiftLocalDate,
} from "./index";

const TENANT_ID = "tenant-pamplona";

const SPORTS = [
  { id: "sport-padel", code: "padel" as const, name: "Pádel" },
  { id: "sport-f5", code: "futbol_5" as const, name: "Fútbol 5" },
];

const COURTS = [
  {
    id: "court-p1",
    tenant_id: TENANT_ID,
    sport_id: "sport-padel",
    name: "Cancha Pádel 1",
    display_order: 1,
  },
  {
    id: "court-p2",
    tenant_id: TENANT_ID,
    sport_id: "sport-padel",
    name: "Cancha Pádel 2",
    display_order: 2,
  },
  {
    id: "court-f1",
    tenant_id: TENANT_ID,
    sport_id: "sport-f5",
    name: "Cancha Fútbol 5 - 1",
    display_order: 3,
  },
  {
    id: "court-f2",
    tenant_id: TENANT_ID,
    sport_id: "sport-f5",
    name: "Cancha Fútbol 5 - 2",
    display_order: 4,
  },
];

describe("buildDailyCalendarGrid", () => {
  it("generates 10 hourly slots (14:00-24:00) for 4 courts and resolves all visual states", () => {
    const localDate = "2026-11-10";
    const referenceTime = localDateTimeToUtcIso(localDate, "19:05");

    const grid = buildDailyCalendarGrid({
      tenantId: TENANT_ID,
      localDate,
      operatingHours: DEFAULT_PILOT_OPERATING_HOURS,
      sports: SPORTS,
      courts: COURTS,
      referenceTime,
      bookings: [
        {
          id: "b-completed",
          tenant_id: TENANT_ID,
          court_id: "court-p1",
          status: "COMPLETED",
          starts_at: localDateTimeToUtcIso(localDate, "16:00"),
          ends_at: localDateTimeToUtcIso(localDate, "17:00"),
          hold_expires_at: null,
          total_price_cop: 60000,
          deposit_required_cop: 12000,
          balance_due_cop: 0,
          customerName: "Andrés Vera",
          balancePaymentMethod: "cash",
        },
        {
          id: "b-noshow",
          tenant_id: TENANT_ID,
          court_id: "court-p2",
          status: "NO_SHOW",
          starts_at: localDateTimeToUtcIso(localDate, "16:00"),
          ends_at: localDateTimeToUtcIso(localDate, "17:00"),
          hold_expires_at: null,
          total_price_cop: 60000,
          deposit_required_cop: 12000,
          balance_due_cop: 48000,
          customerName: "Equipo Norte",
        },
        {
          id: "b-pending",
          tenant_id: TENANT_ID,
          court_id: "court-p1",
          status: "HOLD",
          starts_at: localDateTimeToUtcIso(localDate, "19:00"),
          ends_at: localDateTimeToUtcIso(localDate, "20:00"),
          // Even if hold_expires_at is past, pending validation protects the booking
          hold_expires_at: localDateTimeToUtcIso(localDate, "19:00"),
          total_price_cop: 60000,
          deposit_required_cop: 12000,
          balance_due_cop: 48000,
          customerName: "Mateo Rojas",
          hasPendingDepositValidation: true,
        },
        {
          id: "b-hold-active",
          tenant_id: TENANT_ID,
          court_id: "court-p1",
          status: "HOLD",
          starts_at: localDateTimeToUtcIso(localDate, "20:00"),
          ends_at: localDateTimeToUtcIso(localDate, "21:00"),
          hold_expires_at: localDateTimeToUtcIso(localDate, "19:15"),
          total_price_cop: 60000,
          deposit_required_cop: 12000,
          balance_due_cop: 48000,
          customerName: "Camilo Duarte",
        },
        {
          id: "b-hold-expired",
          tenant_id: TENANT_ID,
          court_id: "court-p2",
          status: "HOLD",
          starts_at: localDateTimeToUtcIso(localDate, "20:00"),
          ends_at: localDateTimeToUtcIso(localDate, "21:00"),
          hold_expires_at: localDateTimeToUtcIso(localDate, "19:00"),
          total_price_cop: 60000,
          deposit_required_cop: 12000,
          balance_due_cop: 48000,
          customerName: "Expirado",
        },
        {
          id: "b-confirmed-night",
          tenant_id: TENANT_ID,
          court_id: "court-f1",
          status: "CONFIRMED",
          starts_at: localDateTimeToUtcIso(localDate, "23:00"),
          ends_at: localDateTimeToUtcIso(localDate, "24:00"),
          hold_expires_at: null,
          total_price_cop: 60000,
          deposit_required_cop: 12000,
          balance_due_cop: 48000,
          customerName: "Laura Méndez",
        },
        {
          id: "b-cancelled",
          tenant_id: TENANT_ID,
          court_id: "court-f2",
          status: "CANCELLED",
          starts_at: localDateTimeToUtcIso(localDate, "21:00"),
          ends_at: localDateTimeToUtcIso(localDate, "22:00"),
          hold_expires_at: null,
          total_price_cop: 60000,
          deposit_required_cop: 12000,
          balance_due_cop: 48000,
          customerName: "Cancelado",
        },
      ],
    });

    expect(grid.isClosed).toBe(false);
    expect(grid.courts).toHaveLength(4);
    expect(grid.slots).toHaveLength(10);
    expect(grid.pendingValidationCount).toBe(1);
    expect(grid.activeHoldCount).toBe(1);

    const slot16 = grid.slots.find((s) => s.localStartTime === "16:00");
    expect(slot16?.cellsByCourtId["court-p1"]?.visualState).toBe("COMPLETED");
    expect(slot16?.cellsByCourtId["court-p2"]?.visualState).toBe("NO_SHOW");

    const slot19 = grid.slots.find((s) => s.localStartTime === "19:00");
    expect(slot19?.cellsByCourtId["court-p1"]?.visualState).toBe("PENDING_VALIDATION");
    expect(slot19?.cellsByCourtId["court-p1"]?.booking?.customerName).toBe("Mateo Rojas");

    const slot20 = grid.slots.find((s) => s.localStartTime === "20:00");
    expect(slot20?.cellsByCourtId["court-p1"]?.visualState).toBe("HOLD");
    expect(slot20?.cellsByCourtId["court-p2"]?.visualState).toBe("FREE");

    const slot21 = grid.slots.find((s) => s.localStartTime === "21:00");
    expect(slot21?.cellsByCourtId["court-f2"]?.visualState).toBe("FREE");

    const slot23 = grid.slots.find((s) => s.localStartTime === "23:00");
    expect(slot23?.cellsByCourtId["court-f1"]?.visualState).toBe("CONFIRMED");
    expect(slot23?.cellsByCourtId["court-f1"]?.booking?.balanceDueCop).toBe(48000);
  });

  it("returns isClosed=true and empty slots when the day is marked closed", () => {
    const grid = buildDailyCalendarGrid({
      tenantId: TENANT_ID,
      localDate: "2026-11-10",
      operatingHours: {
        tuesday: { open: "14:00", close: "24:00", isClosed: true },
      },
      sports: SPORTS,
      courts: COURTS,
      bookings: [],
    });

    expect(grid.isClosed).toBe(true);
    expect(grid.slots).toHaveLength(0);
    expect(grid.courts).toHaveLength(4);
  });
});

describe("date helpers", () => {
  it("shifts YYYY-MM-DD dates accurately across month boundaries", () => {
    expect(shiftLocalDate("2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftLocalDate("2026-11-01", -1)).toBe("2026-10-31");
  });

  it("formats UTC timestamps into America/Bogota YYYY-MM-DD", () => {
    // 2026-11-11T04:30:00Z is 2026-11-10 23:30 in America/Bogota (UTC-5)
    const utcDate = new Date("2026-11-11T04:30:00.000Z");
    expect(formatLocalDateInTimezone(utcDate, "America/Bogota")).toBe("2026-11-10");
  });
});
