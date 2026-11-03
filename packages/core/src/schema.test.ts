import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertNoBookingOverlap,
  assertTenantAccess,
  type AuthenticatedTenantUserContext,
  BOOKING_EXCLUSION_CONSTRAINT_NAME,
  BookingOverlapError,
  type BookingSlotCandidate,
  canAccessTenantRecord,
  doTimeRangesOverlap,
  filterTenantRecordsForUser,
  INITIAL_SCHEMA_TABLES,
  PILOT_SEED_COURTS,
  PILOT_SEED_DEPOSIT_PERCENT,
  PILOT_SEED_HOURLY_PRICE_COP,
  PILOT_SEED_TENANT_ID,
  PILOT_SEED_TENANT_SLUG,
  POSTGRES_EXCLUSION_VIOLATION_CODE,
  POSTGRES_RLS_VIOLATION_CODE,
  RlsAccessDeniedError,
  TENANT_RLS_HELPER_FUNCTIONS,
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

describe("Row Level Security per tenant_id (CY-018)", () => {
  const rlsMigrationFile = "20261101213000_tenant_rls_policies.sql";
  const tenantAId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const tenantBId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  const userOwnerTenantA: AuthenticatedTenantUserContext = {
    userId: "user-owner-a",
    tenantId: tenantAId,
    role: "owner",
    isActive: true,
  };

  const userStaffTenantA: AuthenticatedTenantUserContext = {
    userId: "user-staff-a",
    tenantId: tenantAId,
    role: "staff",
    isActive: true,
  };

  const userOwnerTenantB: AuthenticatedTenantUserContext = {
    userId: "user-owner-b",
    tenantId: tenantBId,
    role: "owner",
    isActive: true,
  };

  const inactiveUserTenantA: AuthenticatedTenantUserContext = {
    userId: "user-inactive-a",
    tenantId: tenantAId,
    role: "owner",
    isActive: false,
  };

  it("defines a versioned migration forcing RLS, SECURITY DEFINER helpers and policies on all 8 tables", () => {
    const migrationPath = path.join(migrationsDir, rlsMigrationFile);
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");

    for (const fnName of TENANT_RLS_HELPER_FUNCTIONS) {
      expect(sql).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fnName}\\(\\)`, "i"));
      expect(sql).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fnName}\\(\\) TO authenticated;`, "i"),
      );
    }
    expect(sql).toMatch(/SECURITY DEFINER\s+SET search_path = public/i);

    for (const table of INITIAL_SCHEMA_TABLES) {
      expect(sql).toMatch(
        new RegExp(`ALTER TABLE public\\.${table}\\s+FORCE ROW LEVEL SECURITY;`, "i"),
      );
      expect(sql).toMatch(new RegExp(`ON public\\.${table}\\s+FOR SELECT`, "i"));
    }

    for (const table of TENANT_SCOPED_TABLES) {
      expect(sql).toMatch(
        new RegExp(
          `ON public\\.${table}[\\s\\S]*?USING \\([^;]*tenant_id = public\\.current_user_tenant_id\\(\\)`,
          "i",
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `ON public\\.${table}[\\s\\S]*?WITH CHECK \\([^;]*tenant_id = public\\.current_user_tenant_id\\(\\)`,
          "i",
        ),
      );
    }
  });

  it("ensures a user from Tenant A cannot see any data belonging to Tenant B across all 8 tables", () => {
    const tenantsRows = [
      { id: tenantAId, slug: "recinto-pamplona-a" },
      { id: tenantBId, slug: "recinto-cucuta-b" },
    ];

    const visibleTenantsForA = filterTenantRecordsForUser(userStaffTenantA, "tenants", tenantsRows);
    expect(visibleTenantsForA).toEqual([{ id: tenantAId, slug: "recinto-pamplona-a" }]);

    const visibleTenantsForB = filterTenantRecordsForUser(userOwnerTenantB, "tenants", tenantsRows);
    expect(visibleTenantsForB).toEqual([{ id: tenantBId, slug: "recinto-cucuta-b" }]);

    for (const table of TENANT_SCOPED_TABLES) {
      const mixedRows = [
        { id: `${table}-a-1`, tenant_id: tenantAId },
        { id: `${table}-b-1`, tenant_id: tenantBId },
        { id: `${table}-a-2`, tenant_id: tenantAId },
      ];

      const visibleToOwnerA = filterTenantRecordsForUser(userOwnerTenantA, table, mixedRows);
      expect(visibleToOwnerA).toHaveLength(2);
      expect(visibleToOwnerA.every((row) => row.tenant_id === tenantAId)).toBe(true);
      expect(visibleToOwnerA.some((row) => row.tenant_id === tenantBId)).toBe(false);

      const visibleToStaffA = filterTenantRecordsForUser(userStaffTenantA, table, mixedRows);
      expect(visibleToStaffA).toHaveLength(2);
      expect(visibleToStaffA.every((row) => row.tenant_id === tenantAId)).toBe(true);

      const visibleToOwnerB = filterTenantRecordsForUser(userOwnerTenantB, table, mixedRows);
      expect(visibleToOwnerB).toEqual([{ id: `${table}-b-1`, tenant_id: tenantBId }]);

      expect(filterTenantRecordsForUser(inactiveUserTenantA, table, mixedRows)).toEqual([]);
      expect(filterTenantRecordsForUser(null, table, mixedRows)).toEqual([]);
    }
  });

  it("rejects cross-tenant mutations (INSERT, UPDATE, DELETE) and tenant_id reassignment with 42501", () => {
    // Owner of Tenant A trying to insert a booking into Tenant B -> rejected
    expect(() =>
      assertTenantAccess({
        user: userOwnerTenantA,
        table: "bookings",
        operation: "INSERT",
        row: { tenant_id: tenantBId },
      }),
    ).toThrowError(RlsAccessDeniedError);

    // Staff of Tenant A trying to update a payment in Tenant B -> rejected with 42501
    try {
      assertTenantAccess({
        user: userStaffTenantA,
        table: "payments",
        operation: "UPDATE",
        row: { tenant_id: tenantBId },
      });
      expect.unreachable("Expected cross-tenant UPDATE to throw RlsAccessDeniedError");
    } catch (error) {
      expect(error).toBeInstanceOf(RlsAccessDeniedError);
      const rlsError = error as RlsAccessDeniedError;
      expect(rlsError.code).toBe(POSTGRES_RLS_VIOLATION_CODE);
      expect(rlsError.table).toBe("payments");
      expect(rlsError.operation).toBe("UPDATE");
    }

    // Owner of Tenant A trying to reassign a Tenant A customer to Tenant B on UPDATE -> rejected by WITH CHECK
    expect(() =>
      assertTenantAccess({
        user: userOwnerTenantA,
        table: "customers",
        operation: "UPDATE",
        row: { tenant_id: tenantAId },
        updatedRow: { tenant_id: tenantBId },
      }),
    ).toThrowError(RlsAccessDeniedError);

    // Staff of Tenant A can insert/update operational records (customers, bookings, payments) in Tenant A
    for (const table of ["customers", "bookings", "payments"] as const) {
      expect(() =>
        assertTenantAccess({
          user: userStaffTenantA,
          table,
          operation: "INSERT",
          row: { tenant_id: tenantAId },
        }),
      ).not.toThrow();

      expect(() =>
        assertTenantAccess({
          user: userStaffTenantA,
          table,
          operation: "UPDATE",
          row: { tenant_id: tenantAId },
          updatedRow: { tenant_id: tenantAId },
        }),
      ).not.toThrow();
    }

    // Staff of Tenant A cannot mutate owner-managed configuration tables (courts, pricing, sports, users, tenants)
    expect(
      canAccessTenantRecord({
        user: userStaffTenantA,
        table: "courts",
        operation: "INSERT",
        row: { tenant_id: tenantAId },
      }),
    ).toBe(false);
    expect(
      canAccessTenantRecord({
        user: userOwnerTenantA,
        table: "courts",
        operation: "INSERT",
        row: { tenant_id: tenantAId },
      }),
    ).toBe(true);
  });
});

describe("Pilot seed data (CY-021)", () => {
  const seedFilePath = path.join(repoRoot, "supabase/seed.sql");

  it("provides supabase/seed.sql with pilot tenant, 2 sports, 4 courts, 60000 COP pricing, and test roles", () => {
    expect(existsSync(seedFilePath)).toBe(true);
    const seedSql = readFileSync(seedFilePath, "utf8");

    expect(seedSql).toContain(PILOT_SEED_TENANT_ID);
    expect(seedSql).toContain(PILOT_SEED_TENANT_SLUG);
    expect(seedSql).toContain("America/Bogota");

    expect(PILOT_SEED_COURTS).toHaveLength(4);
    for (const court of PILOT_SEED_COURTS) {
      expect(seedSql).toContain(court.id);
      expect(seedSql).toContain(court.name);
    }

    expect(seedSql).toMatch(new RegExp(`\\b${PILOT_SEED_HOURLY_PRICE_COP}\\b`));
    expect(seedSql).toMatch(new RegExp(`\\b${PILOT_SEED_DEPOSIT_PERCENT}\\b`));
    expect(seedSql).toContain("dueno@canchaya.test");
    expect(seedSql).toContain("empleado@canchaya.test");
    expect(seedSql).toMatch(/ON CONFLICT[\s\S]*DO (UPDATE|NOTHING)/i);
  });
});
