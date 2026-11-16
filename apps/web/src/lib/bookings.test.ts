import type { AuthenticatedTenantUserContext, BookingRecord, PaymentRecord } from "@canchaya/core";
import { describe, expect, it, vi } from "vitest";
import {
  BookingConflictError,
  BookingNotFoundError,
  BookingValidationError,
  cancelManualBooking,
  createManualHoldBooking,
  createTenantCustomer,
  moveManualBooking,
  normalizePhoneInput,
  searchTenantCustomers,
} from "./bookings";

const ENV = {
  NEXT_PUBLIC_APP_ENV: "development",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
};

const USER: AuthenticatedTenantUserContext = {
  userId: "user-staff-1",
  email: "staff@canchaya.co",
  tenantId: "tenant-1",
  role: "staff",
  fullName: "Staff Piloto",
  isActive: true,
};

describe("apps/web manual booking operations (CY-037)", () => {
  it("normalizes Colombian 10-digit phones to E.164", () => {
    expect(normalizePhoneInput("300 123 4567")).toBe("+573001234567");
    expect(normalizePhoneInput("+573109998877")).toBe("+573109998877");
  });

  it("searches and creates tenant customers under RLS", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.includes("/rest/v1/customers") && method === "GET") {
        expect(url).toContain("tenant_id=eq.tenant-1");
        return new Response(
          JSON.stringify([
            {
              id: "cust-1",
              tenant_id: "tenant-1",
              full_name: "Carlos Pérez",
              phone: "+573001234567",
            },
          ]),
          { status: 200 },
        );
      }

      if (url.includes("/rest/v1/customers") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as Record<string, string>;
        expect(body.phone).toBe("+573112223344");
        return new Response(
          JSON.stringify([
            {
              id: "cust-2",
              tenant_id: "tenant-1",
              full_name: body.full_name,
              phone: body.phone,
            },
          ]),
          { status: 201 },
        );
      }

      return new Response("Not found", { status: 404 });
    });

    const found = await searchTenantCustomers({
      user: USER,
      accessToken: "token",
      query: "Carlos",
      env: ENV,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.full_name).toBe("Carlos Pérez");

    const created = await createTenantCustomer({
      user: USER,
      accessToken: "token",
      fullName: "Laura Gómez",
      phone: "3112223344",
      env: ENV,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(created.id).toBe("cust-2");
    expect(created.phone).toBe("+573112223344");
  });

  it("creates a HOLD booking with availability check and maps 23P01 conflicts to 409", async () => {
    const referenceTime = "2026-11-12T18:00:00.000Z";
    let shouldSimulateDbExclusion = false;

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.includes("/rest/v1/tenants")) {
        return new Response(
          JSON.stringify([
            { id: "tenant-1", timezone: "America/Bogota", slot_duration_minutes: 60 },
          ]),
          { status: 200 },
        );
      }
      if (url.includes("/rest/v1/courts")) {
        return new Response(
          JSON.stringify([
            { id: "court-1", tenant_id: "tenant-1", name: "Pádel 1", is_active: true },
          ]),
          { status: 200 },
        );
      }
      if (url.includes("/rest/v1/customers")) {
        return new Response(JSON.stringify([{ id: "cust-1" }]), { status: 200 });
      }
      if (url.includes("/rest/v1/bookings") && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes("/rest/v1/bookings") && method === "POST") {
        if (shouldSimulateDbExclusion) {
          return new Response(
            JSON.stringify({ code: "23P01", message: "conflicting key value" }),
            { status: 409 },
          );
        }
        return new Response(init?.body as string, { status: 201 });
      }

      return new Response("Not found", { status: 404 });
    });

    const booking = await createManualHoldBooking({
      user: USER,
      accessToken: "token",
      courtId: "court-1",
      customerId: "cust-1",
      localDate: "2026-11-12",
      localStartTime: "19:00",
      referenceTime,
      env: ENV,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(booking.status).toBe("HOLD");
    expect(booking.hold_expires_at).toBe("2026-11-12T18:15:00.000Z");
    expect(booking.total_price_cop).toBe(60000);
    expect(booking.deposit_required_cop).toBe(12000);

    shouldSimulateDbExclusion = true;
    await expect(
      createManualHoldBooking({
        user: USER,
        accessToken: "token",
        courtId: "court-1",
        customerId: "cust-1",
        localDate: "2026-11-12",
        localStartTime: "19:00",
        referenceTime,
        env: ENV,
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(BookingConflictError);
  });

  it("moves a CONFIRMED booking even 30 minutes before start and preserves deposit payment", async () => {
    const referenceTime = "2026-11-12T23:30:00.000Z";
    const confirmedBooking: BookingRecord = {
      id: "booking-confirmed-1",
      tenant_id: "tenant-1",
      court_id: "court-1",
      customer_id: "cust-1",
      status: "CONFIRMED",
      starts_at: "2026-11-13T00:00:00.000Z",
      ends_at: "2026-11-13T01:00:00.000Z",
      hold_expires_at: null,
      total_price_cop: 60000,
      deposit_required_cop: 12000,
      balance_due_cop: 48000,
      rescheduled_from_booking_id: null,
      created_by_user_id: "user-staff-1",
      cancellation_reason: null,
      notes: null,
      created_at: "2026-11-10T15:00:00.000Z",
      updated_at: "2026-11-10T15:00:00.000Z",
    };

    const depositPayment: PaymentRecord = {
      id: "pay-1",
      tenant_id: "tenant-1",
      booking_id: "booking-confirmed-1",
      payment_type: "deposit",
      method: "transfer",
      amount_cop: 12000,
      status: "approved",
      proof_url: null,
      validated_by_user_id: "user-staff-1",
      validated_at: "2026-11-10T15:00:00.000Z",
      notes: null,
      created_at: "2026-11-10T15:00:00.000Z",
      updated_at: "2026-11-10T15:00:00.000Z",
    };

    let patchedOriginal = false;
    let patchedPayment = false;

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.includes("/rest/v1/bookings") && method === "GET" && url.includes("id=eq.")) {
        return new Response(JSON.stringify([confirmedBooking]), { status: 200 });
      }
      if (url.includes("/rest/v1/tenants")) {
        return new Response(
          JSON.stringify([
            { id: "tenant-1", timezone: "America/Bogota", slot_duration_minutes: 60 },
          ]),
          { status: 200 },
        );
      }
      if (url.includes("/rest/v1/courts")) {
        return new Response(
          JSON.stringify([
            { id: "court-2", tenant_id: "tenant-1", name: "Pádel 2", is_active: true },
          ]),
          { status: 200 },
        );
      }
      if (url.includes("/rest/v1/bookings") && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes("/rest/v1/payments") && method === "GET") {
        return new Response(JSON.stringify([depositPayment]), { status: 200 });
      }
      if (url.includes("/rest/v1/bookings") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as BookingRecord;
        return new Response(JSON.stringify([body]), { status: 201 });
      }
      if (url.includes("/rest/v1/payments") && method === "PATCH") {
        patchedPayment = true;
        return new Response(null, { status: 204 });
      }
      if (url.includes("/rest/v1/bookings") && method === "PATCH") {
        patchedOriginal = true;
        return new Response(null, { status: 204 });
      }

      return new Response("Not found", { status: 404 });
    });

    const moved = await moveManualBooking({
      user: USER,
      accessToken: "token",
      bookingId: "booking-confirmed-1",
      newCourtId: "court-2",
      localDate: "2026-11-13",
      localStartTime: "19:00",
      referenceTime,
      env: ENV,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(moved.status).toBe("CONFIRMED");
    expect(moved.court_id).toBe("court-2");
    expect(moved.rescheduled_from_booking_id).toBe("booking-confirmed-1");
    expect(patchedOriginal).toBe(true);
    expect(patchedPayment).toBe(true);
  });

  it("cancels a booking with mandatory reason and throws 404 if missing", async () => {
    const holdBooking: BookingRecord = {
      id: "booking-hold-1",
      tenant_id: "tenant-1",
      court_id: "court-1",
      customer_id: "cust-1",
      status: "HOLD",
      starts_at: "2026-11-13T00:00:00.000Z",
      ends_at: "2026-11-13T01:00:00.000Z",
      hold_expires_at: "2026-11-12T18:15:00.000Z",
      total_price_cop: 60000,
      deposit_required_cop: 12000,
      balance_due_cop: 60000,
      rescheduled_from_booking_id: null,
      created_by_user_id: "user-staff-1",
      cancellation_reason: null,
      notes: null,
      created_at: "2026-11-12T18:00:00.000Z",
      updated_at: "2026-11-12T18:00:00.000Z",
    };

    let returnEmpty = false;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.includes("/rest/v1/bookings") && method === "GET") {
        return new Response(JSON.stringify(returnEmpty ? [] : [holdBooking]), { status: 200 });
      }
      if (url.includes("/rest/v1/bookings") && method === "PATCH") {
        const body = JSON.parse(String(init?.body)) as Partial<BookingRecord>;
        return new Response(JSON.stringify([{ ...holdBooking, ...body }]), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    });

    await expect(
      cancelManualBooking({
        user: USER,
        accessToken: "token",
        bookingId: "booking-hold-1",
        cancellationReason: "   ",
        env: ENV,
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(BookingValidationError);

    const cancelled = await cancelManualBooking({
      user: USER,
      accessToken: "token",
      bookingId: "booking-hold-1",
      cancellationReason: "Cliente no pudo asistir",
      env: ENV,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancellation_reason).toBe("Cliente no pudo asistir");

    returnEmpty = true;
    await expect(
      cancelManualBooking({
        user: USER,
        accessToken: "token",
        bookingId: "missing-id",
        cancellationReason: "Motivo válido",
        env: ENV,
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(BookingNotFoundError);
  });
});
