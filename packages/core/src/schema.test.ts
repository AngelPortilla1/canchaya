import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertNoBookingOverlap,
  BOOKING_EXCLUSION_CONSTRAINT_NAME,
  BookingOverlapError,
  type BookingSlotCandidate,
  doTimeRangesOverlap,
  INITIAL_SCHEMA_TABLES,
  POSTGRES_EXCLUSION_VIOLATION_CODE,
  TENANT_SCOPED_TABLES,
  validatePaymentBreakdownCop,
} from "./schema";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const migrationsDir = path.join(repoRoot, "supabase/migrations");

describe("Initial multi-tenant database schema migration (CY-016)", () => {
  it("has a versioned SQL migration file in supabase/migrations", () => {
    expect(existsSync(migrationsDir)).toBe(true);
    const files = readdirSync(migrationsDir).filter((file) => /^\d{14}_.*\.sql$/.test(file));
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files).toContain("20261030220000_initial_multi_tenant_schema.sql");
  });

  it("creates all 8 required tables with RLS enabled", () => {
    const migrationPath = path.join(
      migrationsDir,
      "20261030220000_initial_multi_tenant_schema.sql",
    );
    const sql = readFileSync(migrationPath, "utf8");

    for (const table of INITIAL_SCHEMA_TABLES) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE public\\.${table}\\s*\\(`, "i"));
      expect(sql).toMatch(
        new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY;`, "i"),
      );
    }
  });

  it("enforces tenant_id on every tenant-scoped business table and composite FK integrity", () => {
    const migrationPath = path.join(
      migrationsDir,
      "20261030220000_initial_multi_tenant_schema.sql",
    );
    const sql = readFileSync(migrationPath, "utf8");

    for (const table of TENANT_SCOPED_TABLES) {
      const tableBlockMatch = sql.match(
        new RegExp(`CREATE TABLE public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, "i"),
      );
      expect(tableBlockMatch).not.toBeNull();
      const tableBody = tableBlockMatch?.[1] ?? "";
      expect(tableBody).toMatch(
        /tenant_id\s+UUID\s+NOT NULL\s+REFERENCES\s+public\.tenants\(id\)/i,
      );
    }

    expect(sql).toContain("REFERENCES auth.users(id) ON DELETE CASCADE");
    expect(sql).toContain("REFERENCES public.sports(id, tenant_id)");
    expect(sql).toContain("REFERENCES public.courts(id, tenant_id)");
    expect(sql).toContain("REFERENCES public.customers(id, tenant_id)");
    expect(sql).toContain("REFERENCES public.bookings(id, tenant_id)");
    expect(sql).toContain("REFERENCES public.users(id, tenant_id)");
  });

  it("uses TIMESTAMPTZ for timestamps and integer COP for all monetary columns", () => {
    const migrationPath = path.join(
      migrationsDir,
      "20261030220000_initial_multi_tenant_schema.sql",
    );
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).not.toMatch(/\bTIMESTAMP\s+WITHOUT\s+TIME\s+ZONE\b/i);
    expect(sql).not.toMatch(/\b(NUMERIC|DECIMAL|REAL|DOUBLE PRECISION|FLOAT)\b/i);

    expect(sql).toMatch(/price_cop\s+INTEGER\s+NOT NULL/i);
    expect(sql).toMatch(/total_price_cop\s+INTEGER\s+NOT NULL/i);
    expect(sql).toMatch(/deposit_required_cop\s+INTEGER\s+NOT NULL/i);
    expect(sql).toMatch(/balance_due_cop\s+INTEGER\s+NOT NULL/i);
    expect(sql).toMatch(/amount_cop\s+INTEGER\s+NOT NULL/i);
    expect(sql).toMatch(/cash_amount_cop\s+INTEGER\s+NOT NULL/i);
    expect(sql).toMatch(/transfer_amount_cop\s+INTEGER\s+NOT NULL/i);
  });

  it("validates payment breakdown in integer COP for cash, transfer and mixed methods", () => {
    expect(
      validatePaymentBreakdownCop({
        method: "transfer",
        amountCop: 12_000,
        cashAmountCop: 0,
        transferAmountCop: 12_000,
      }),
    ).toBe(true);

    expect(
      validatePaymentBreakdownCop({
        method: "cash",
        amountCop: 48_000,
        cashAmountCop: 48_000,
        transferAmountCop: 0,
      }),
    ).toBe(true);

    expect(
      validatePaymentBreakdownCop({
        method: "mixed",
        amountCop: 48_000,
        cashAmountCop: 20_000,
        transferAmountCop: 28_000,
      }),
    ).toBe(true);

    expect(
      validatePaymentBreakdownCop({
        method: "mixed",
        amountCop: 48_000,
        cashAmountCop: 48_000,
        transferAmountCop: 0,
      }),
    ).toBe(false);

    expect(
      validatePaymentBreakdownCop({
        method: "cash",
        amountCop: 48_000,
        cashAmountCop: 20_000,
        transferAmountCop: 20_000,
      }),
    ).toBe(false);
  });
});

describe("Booking exclusion constraint (tstzrange + GiST) per court (CY-017)", () => {
  const exclusionMigrationFile = "20261031120000_booking_exclusion_constraint.sql";
  const tenantId = "11111111-1111-1111-1111-111111111111";
  const courtPadel1 = "22222222-2222-2222-2222-222222222221";
  const courtPadel2 = "22222222-2222-2222-2222-222222222222";

  it("defines a versioned migration enabling btree_gist and GiST tstzrange exclusion per court", () => {
    const migrationPath = path.join(migrationsDir, exclusionMigrationFile);
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS btree_gist;/i);
    expect(sql).toContain(BOOKING_EXCLUSION_CONSTRAINT_NAME);
    expect(sql).toMatch(/EXCLUDE USING gist\s*\(/i);
    expect(sql).toMatch(/tenant_id\s+WITH\s*=/i);
    expect(sql).toMatch(/court_id\s+WITH\s*=/i);
    expect(sql).toMatch(/tstzrange\(starts_at,\s*ends_at,\s*'\[\)'\)\s+WITH\s*&&/i);
    expect(sql).toMatch(
      /WHERE\s*\(\s*status\s+NOT IN\s*\(\s*'CANCELLED',\s*'RESCHEDULED'\s*\)\s*\)/i,
    );
  });

  it("fails with BookingOverlapError (23P01) when forcing an exact or partial double booking on the same court", () => {
    const existingHold: BookingSlotCandidate = {
      id: "booking-1",
      tenant_id: tenantId,
      court_id: courtPadel1,
      status: "HOLD",
      starts_at: "2026-11-01T23:00:00.000Z",
      ends_at: "2026-11-02T00:00:00.000Z",
    };

    // 1. Exact same 60-min slot on the same court -> must fail
    expect(() =>
      assertNoBookingOverlap([existingHold], {
        id: "booking-2",
        tenant_id: tenantId,
        court_id: courtPadel1,
        status: "CONFIRMED",
        starts_at: "2026-11-01T23:00:00.000Z",
        ends_at: "2026-11-02T00:00:00.000Z",
      }),
    ).toThrowError(BookingOverlapError);

    try {
      assertNoBookingOverlap([existingHold], {
        id: "booking-2",
        tenant_id: tenantId,
        court_id: courtPadel1,
        status: "HOLD",
        starts_at: "2026-11-01T23:30:00.000Z",
        ends_at: "2026-11-02T00:30:00.000Z",
      });
      expect.unreachable("Expected double booking attempt to throw BookingOverlapError");
    } catch (error) {
      expect(error).toBeInstanceOf(BookingOverlapError);
      const overlapError = error as BookingOverlapError;
      expect(overlapError.code).toBe(POSTGRES_EXCLUSION_VIOLATION_CODE);
      expect(overlapError.constraint).toBe(BOOKING_EXCLUSION_CONSTRAINT_NAME);
      expect(overlapError.conflictingBookingId).toBe("booking-1");
    }
  });

  it("allows back-to-back bookings '[)', bookings on another court, or re-booking a CANCELLED/RESCHEDULED slot", () => {
    const existingBookings: BookingSlotCandidate[] = [
      {
        id: "booking-active",
        tenant_id: tenantId,
        court_id: courtPadel1,
        status: "CONFIRMED",
        starts_at: "2026-11-01T23:00:00.000Z",
        ends_at: "2026-11-02T00:00:00.000Z",
      },
      {
        id: "booking-cancelled",
        tenant_id: tenantId,
        court_id: courtPadel1,
        status: "CANCELLED",
        starts_at: "2026-11-02T00:00:00.000Z",
        ends_at: "2026-11-02T01:00:00.000Z",
      },
      {
        id: "booking-rescheduled",
        tenant_id: tenantId,
        court_id: courtPadel1,
        status: "RESCHEDULED",
        starts_at: "2026-11-02T01:00:00.000Z",
        ends_at: "2026-11-02T02:00:00.000Z",
      },
    ];

    // Contiguous slot [00:00, 01:00) right after [23:00, 00:00) and replacing a CANCELLED booking -> allowed
    expect(() =>
      assertNoBookingOverlap(existingBookings, {
        id: "booking-contiguous",
        tenant_id: tenantId,
        court_id: courtPadel1,
        status: "HOLD",
        starts_at: "2026-11-02T00:00:00.000Z",
        ends_at: "2026-11-02T01:00:00.000Z",
      }),
    ).not.toThrow();

    // Replacing a RESCHEDULED slot on the same court -> allowed
    expect(() =>
      assertNoBookingOverlap(existingBookings, {
        id: "booking-replace-rescheduled",
        tenant_id: tenantId,
        court_id: courtPadel1,
        status: "CONFIRMED",
        starts_at: "2026-11-02T01:00:00.000Z",
        ends_at: "2026-11-02T02:00:00.000Z",
      }),
    ).not.toThrow();

    // Same time range on a different court (courtPadel2) -> allowed
    expect(() =>
      assertNoBookingOverlap(existingBookings, {
        id: "booking-other-court",
        tenant_id: tenantId,
        court_id: courtPadel2,
        status: "CONFIRMED",
        starts_at: "2026-11-01T23:00:00.000Z",
        ends_at: "2026-11-02T00:00:00.000Z",
      }),
    ).not.toThrow();

    expect(
      doTimeRangesOverlap(
        "2026-11-01T23:00:00.000Z",
        "2026-11-02T00:00:00.000Z",
        "2026-11-02T00:00:00.000Z",
        "2026-11-02T01:00:00.000Z",
      ),
    ).toBe(false);
  });
});
