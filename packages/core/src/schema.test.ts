import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { INITIAL_SCHEMA_TABLES, TENANT_SCOPED_TABLES, validatePaymentBreakdownCop } from "./schema";

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
