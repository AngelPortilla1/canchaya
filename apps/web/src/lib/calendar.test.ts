import { DEFAULT_PILOT_OPERATING_HOURS, localDateTimeToUtcIso } from "@canchaya/core";
import { describe, expect, it, vi } from "vitest";
import { loadTenantDailyCalendar } from "./calendar";

const ENV = {
  NEXT_PUBLIC_APP_ENV: "development",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
};

describe("loadTenantDailyCalendar", () => {
  it("loads tenant, sports, courts, and bookings under RLS and builds the daily grid", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/rest/v1/tenants")) {
        return new Response(
          JSON.stringify([
            {
              id: "t-1",
              name: "CanchaYa Piloto Pamplona",
              timezone: "America/Bogota",
              slot_duration_minutes: 60,
              operating_hours: DEFAULT_PILOT_OPERATING_HOURS,
            },
          ]),
          { status: 200 },
        );
      }

      if (url.includes("/rest/v1/sports")) {
        return new Response(
          JSON.stringify([
            { id: "s-1", code: "padel", name: "Pádel", is_active: true },
            { id: "s-2", code: "futbol_5", name: "Fútbol 5", is_active: true },
          ]),
          { status: 200 },
        );
      }

      if (url.includes("/rest/v1/courts")) {
        return new Response(
          JSON.stringify([
            {
              id: "c-1",
              tenant_id: "t-1",
              sport_id: "s-1",
              name: "Cancha Pádel 1",
              display_order: 1,
              is_active: true,
            },
            {
              id: "c-2",
              tenant_id: "t-1",
              sport_id: "s-2",
              name: "Cancha Fútbol 5 - 1",
              display_order: 3,
              is_active: true,
            },
          ]),
          { status: 200 },
        );
      }

      if (url.includes("/rest/v1/bookings")) {
        return new Response(
          JSON.stringify([
            {
              id: "b-1",
              tenant_id: "t-1",
              court_id: "c-1",
              status: "HOLD",
              starts_at: localDateTimeToUtcIso("2026-11-10", "19:00"),
              ends_at: localDateTimeToUtcIso("2026-11-10", "20:00"),
              hold_expires_at: localDateTimeToUtcIso("2026-11-10", "19:15"),
              total_price_cop: 60000,
              deposit_required_cop: 12000,
              balance_due_cop: 48000,
              customer: { full_name: "Mateo Rojas" },
              payments: [
                { payment_type: "deposit", method: "transfer", status: "pending_validation" },
              ],
            },
          ]),
          { status: 200 },
        );
      }

      return new Response("Not found", { status: 404 });
    });

    const result = await loadTenantDailyCalendar({
      user: { userId: "u-1", tenantId: "t-1", role: "staff", isActive: true },
      accessToken: "token-123",
      localDate: "2026-11-10",
      env: ENV,
      fetchImpl: fetchMock as unknown as typeof fetch,
      referenceTime: localDateTimeToUtcIso("2026-11-10", "19:05"),
    });

    expect(result.tenantName).toBe("CanchaYa Piloto Pamplona");
    expect(result.userRole).toBe("staff");
    expect(result.grid.courts).toHaveLength(2);
    expect(result.grid.slots).toHaveLength(10);
    expect(result.grid.pendingValidationCount).toBe(1);

    const slot19 = result.grid.slots.find((s) => s.localStartTime === "19:00");
    expect(slot19?.cellsByCourtId["c-1"]?.visualState).toBe("PENDING_VALIDATION");
    expect(slot19?.cellsByCourtId["c-1"]?.booking?.customerName).toBe("Mateo Rojas");
    expect(slot19?.cellsByCourtId["c-2"]?.visualState).toBe("FREE");
  });
});
