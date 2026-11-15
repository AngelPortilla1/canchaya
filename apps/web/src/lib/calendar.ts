import {
  type AuthenticatedTenantUserContext,
  type BookingStatus,
  type CalendarBookingItem,
  type CalendarCourtItem,
  type CalendarSportItem,
  DEFAULT_HOURLY_PRICE_COP,
  DEFAULT_TIMEZONE,
  type DailyCalendarGrid,
  type PaymentMethod,
  type PaymentStatus,
  type PaymentType,
  buildDailyCalendarGrid,
  formatLocalDateInTimezone,
  getLocalDateUtcBounds,
} from "@canchaya/core";
import { getPublicSupabaseEnv } from "./env";

interface TenantRow {
  id: string;
  name: string;
  timezone: string;
  slot_duration_minutes: number;
  operating_hours: Record<string, unknown>;
}

interface BookingQueryRow {
  id: string;
  tenant_id: string;
  court_id: string;
  status: BookingStatus;
  starts_at: string;
  ends_at: string;
  hold_expires_at: string | null;
  total_price_cop: number;
  deposit_required_cop: number;
  balance_due_cop: number;
  customer?: { full_name?: string | null } | Array<{ full_name?: string | null }> | null;
  payments?: Array<{
    payment_type: PaymentType;
    method: PaymentMethod;
    status: PaymentStatus;
  }> | null;
}

export interface TenantCalendarResponse {
  tenantName: string;
  userRole: AuthenticatedTenantUserContext["role"];
  grid: DailyCalendarGrid;
}

async function fetchSupabaseRest<T>(params: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string;
  path: string;
  searchParams: Record<string, string>;
  fetchImpl: typeof fetch;
}): Promise<T> {
  const url = new URL(`${params.supabaseUrl}/rest/v1/${params.path}`);
  for (const [key, value] of Object.entries(params.searchParams)) {
    url.searchParams.set(key, value);
  }

  const response = await params.fetchImpl(url.toString(), {
    method: "GET",
    headers: {
      apikey: params.supabaseAnonKey,
      Authorization: `Bearer ${params.accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Supabase query failed for ${params.path} (${response.status})`);
  }

  return (await response.json()) as T;
}

function extractCustomerName(customer: BookingQueryRow["customer"]): string | null {
  if (!customer) {
    return null;
  }
  if (Array.isArray(customer)) {
    return customer[0]?.full_name?.trim() || null;
  }
  return customer.full_name?.trim() || null;
}

function mapBookingRow(row: BookingQueryRow): CalendarBookingItem {
  const payments = Array.isArray(row.payments) ? row.payments : [];
  const hasPendingDepositValidation = payments.some(
    (p) => p.payment_type === "deposit" && p.status === "pending_validation",
  );
  const approvedBalance = payments.find(
    (p) => p.payment_type === "balance" && p.status === "approved",
  );

  return {
    id: row.id,
    tenant_id: row.tenant_id,
    court_id: row.court_id,
    status: row.status,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    hold_expires_at: row.hold_expires_at,
    total_price_cop: row.total_price_cop,
    deposit_required_cop: row.deposit_required_cop,
    balance_due_cop: row.balance_due_cop,
    customerName: extractCustomerName(row.customer),
    hasPendingDepositValidation,
    balancePaymentMethod: approvedBalance?.method ?? null,
  };
}

/**
 * Loads the daily calendar grid for the authenticated user's tenant using RLS.
 */
export async function loadTenantDailyCalendar(params: {
  user: AuthenticatedTenantUserContext;
  accessToken: string;
  localDate?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  referenceTime?: string | Date;
}): Promise<TenantCalendarResponse> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const supabaseConfig = getPublicSupabaseEnv(params.env);

  const tenantRows = await fetchSupabaseRest<TenantRow[]>({
    supabaseUrl: supabaseConfig.supabaseUrl,
    supabaseAnonKey: supabaseConfig.supabaseAnonKey,
    accessToken: params.accessToken,
    path: "tenants",
    searchParams: {
      select: "id,name,timezone,slot_duration_minutes,operating_hours",
      id: `eq.${params.user.tenantId}`,
      limit: "1",
    },
    fetchImpl,
  });

  const tenant = tenantRows[0];
  if (!tenant) {
    throw new Error("Tenant not found or not accessible");
  }

  const timezone = tenant.timezone || DEFAULT_TIMEZONE;
  const resolvedLocalDate =
    params.localDate?.trim() || formatLocalDateInTimezone(new Date(), timezone);
  const { startUtc, endUtc } = getLocalDateUtcBounds(resolvedLocalDate, timezone);

  const [sports, courts, bookingRows] = await Promise.all([
    fetchSupabaseRest<CalendarSportItem[]>({
      supabaseUrl: supabaseConfig.supabaseUrl,
      supabaseAnonKey: supabaseConfig.supabaseAnonKey,
      accessToken: params.accessToken,
      path: "sports",
      searchParams: {
        select: "id,code,name,is_active",
        tenant_id: `eq.${tenant.id}`,
        is_active: "eq.true",
      },
      fetchImpl,
    }),
    fetchSupabaseRest<CalendarCourtItem[]>({
      supabaseUrl: supabaseConfig.supabaseUrl,
      supabaseAnonKey: supabaseConfig.supabaseAnonKey,
      accessToken: params.accessToken,
      path: "courts",
      searchParams: {
        select: "id,tenant_id,sport_id,name,display_order,is_active",
        tenant_id: `eq.${tenant.id}`,
        is_active: "eq.true",
        order: "display_order.asc",
      },
      fetchImpl,
    }),
    fetchSupabaseRest<BookingQueryRow[]>({
      supabaseUrl: supabaseConfig.supabaseUrl,
      supabaseAnonKey: supabaseConfig.supabaseAnonKey,
      accessToken: params.accessToken,
      path: "bookings",
      searchParams: {
        select:
          "id,tenant_id,court_id,status,starts_at,ends_at,hold_expires_at,total_price_cop,deposit_required_cop,balance_due_cop,customer:customers(full_name),payments(payment_type,method,status)",
        tenant_id: `eq.${tenant.id}`,
        and: `(starts_at.lt.${endUtc},ends_at.gt.${startUtc})`,
      },
      fetchImpl,
    }),
  ]);

  const bookings = bookingRows.map(mapBookingRow);
  const grid = buildDailyCalendarGrid({
    tenantId: tenant.id,
    localDate: resolvedLocalDate,
    timezone,
    slotDurationMinutes: tenant.slot_duration_minutes,
    defaultPriceCop: DEFAULT_HOURLY_PRICE_COP,
    operatingHours: tenant.operating_hours,
    sports,
    courts,
    bookings,
    referenceTime: params.referenceTime,
  });

  return {
    tenantName: tenant.name,
    userRole: params.user.role,
    grid,
  };
}
