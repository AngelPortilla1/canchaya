import type { BookingStatus, SportCode } from "./index";

export const INITIAL_SCHEMA_TABLES = [
  "tenants",
  "courts",
  "sports",
  "pricing",
  "customers",
  "bookings",
  "payments",
  "users",
] as const;

export type SchemaTableName = (typeof INITIAL_SCHEMA_TABLES)[number];

export const TENANT_SCOPED_TABLES = [
  "courts",
  "sports",
  "pricing",
  "customers",
  "bookings",
  "payments",
  "users",
] as const;

export type TenantScopedTableName = (typeof TENANT_SCOPED_TABLES)[number];

export type UserRole = "owner" | "staff";
export type PaymentType = "deposit" | "balance";
export type PaymentMethod = "transfer" | "cash" | "mixed";
export type PaymentStatus = "pending_validation" | "approved" | "rejected";

export interface TenantRecord {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  slot_duration_minutes: number;
  hold_duration_minutes: number;
  deposit_percent: number;
  min_reschedule_hours: number;
  whatsapp_phone_number_id: string | null;
  operating_hours: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SportRecord {
  id: string;
  tenant_id: string;
  code: SportCode;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CourtRecord {
  id: string;
  tenant_id: string;
  sport_id: string;
  name: string;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PricingRecord {
  id: string;
  tenant_id: string;
  sport_id: string;
  court_id: string | null;
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
  price_cop: number;
  deposit_percent: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserRecord {
  id: string;
  tenant_id: string;
  role: UserRole;
  full_name: string;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerRecord {
  id: string;
  tenant_id: string;
  phone: string;
  full_name: string;
  data_consent_at: string | null;
  no_show_count: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BookingRecord {
  id: string;
  tenant_id: string;
  court_id: string;
  customer_id: string;
  status: BookingStatus;
  starts_at: string;
  ends_at: string;
  hold_expires_at: string | null;
  total_price_cop: number;
  deposit_required_cop: number;
  balance_due_cop: number;
  rescheduled_from_booking_id: string | null;
  created_by_user_id: string | null;
  cancellation_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentRecord {
  id: string;
  tenant_id: string;
  booking_id: string;
  payment_type: PaymentType;
  method: PaymentMethod;
  status: PaymentStatus;
  amount_cop: number;
  cash_amount_cop: number;
  transfer_amount_cop: number;
  receipt_media_url: string | null;
  validated_by_user_id: string | null;
  validated_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Validates that a payment breakdown (cash + transfer) matches the total integer COP amount
 * and respects the selected payment method rules.
 */
export function validatePaymentBreakdownCop(params: {
  method: PaymentMethod;
  amountCop: number;
  cashAmountCop: number;
  transferAmountCop: number;
}): boolean {
  const { method, amountCop, cashAmountCop, transferAmountCop } = params;
  if (
    !Number.isInteger(amountCop) ||
    !Number.isInteger(cashAmountCop) ||
    !Number.isInteger(transferAmountCop)
  ) {
    return false;
  }
  if (amountCop <= 0 || cashAmountCop < 0 || transferAmountCop < 0) {
    return false;
  }
  if (cashAmountCop + transferAmountCop !== amountCop) {
    return false;
  }
  if (method === "cash") {
    return cashAmountCop === amountCop && transferAmountCop === 0;
  }
  if (method === "transfer") {
    return transferAmountCop === amountCop && cashAmountCop === 0;
  }
  return cashAmountCop > 0 && transferAmountCop > 0;
}

export const BOOKING_EXCLUSION_CONSTRAINT_NAME =
  "bookings_no_overlapping_active_slots_excl" as const;

export const POSTGRES_EXCLUSION_VIOLATION_CODE = "23P01" as const;

export const BOOKING_BLOCKING_STATUSES = [
  "HOLD",
  "CONFIRMED",
  "COMPLETED",
  "NO_SHOW",
] as const satisfies readonly BookingStatus[];

export const BOOKING_NON_BLOCKING_STATUSES = [
  "CANCELLED",
  "RESCHEDULED",
] as const satisfies readonly BookingStatus[];

export interface BookingSlotCandidate {
  id?: string;
  tenant_id: string;
  court_id: string;
  status: BookingStatus;
  starts_at: string;
  ends_at: string;
}

export class BookingOverlapError extends Error {
  readonly code = POSTGRES_EXCLUSION_VIOLATION_CODE;
  readonly constraint = BOOKING_EXCLUSION_CONSTRAINT_NAME;
  readonly conflictingBookingId: string | undefined;

  constructor(message: string, conflictingBookingId?: string) {
    super(message);
    this.name = "BookingOverlapError";
    this.conflictingBookingId = conflictingBookingId;
  }
}

export function isBlockingBookingStatus(status: BookingStatus): boolean {
  return (BOOKING_BLOCKING_STATUSES as readonly BookingStatus[]).includes(status);
}

/**
 * Evaluates half-open UTC range overlap `[starts_at, ends_at)`, matching PostgreSQL
 * `tstzrange(starts_at, ends_at, '[)') && tstzrange(...)`.
 */
export function doTimeRangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  const startAMs = Date.parse(startA);
  const endAMs = Date.parse(endA);
  const startBMs = Date.parse(startB);
  const endBMs = Date.parse(endB);

  if (
    Number.isNaN(startAMs) ||
    Number.isNaN(endAMs) ||
    Number.isNaN(startBMs) ||
    Number.isNaN(endBMs)
  ) {
    throw new Error("Invalid ISO-8601 UTC timestamp in booking time range");
  }
  if (endAMs <= startAMs || endBMs <= startBMs) {
    throw new Error("Booking ends_at must be strictly greater than starts_at");
  }

  return startAMs < endBMs && startBMs < endAMs;
}

/**
 * Enforces the same invariant as `bookings_no_overlapping_active_slots_excl` (`23P01`):
 * two active bookings on the same tenant and court cannot have overlapping `[starts_at, ends_at)` ranges.
 */
export function assertNoBookingOverlap(
  existingBookings: readonly BookingSlotCandidate[],
  candidate: BookingSlotCandidate,
): void {
  const candidateStartMs = Date.parse(candidate.starts_at);
  const candidateEndMs = Date.parse(candidate.ends_at);

  if (Number.isNaN(candidateStartMs) || Number.isNaN(candidateEndMs)) {
    throw new Error("Invalid ISO-8601 UTC timestamp in booking time range");
  }
  if (candidateEndMs <= candidateStartMs) {
    throw new Error("Booking ends_at must be strictly greater than starts_at");
  }

  if (!isBlockingBookingStatus(candidate.status)) {
    return;
  }

  for (const existing of existingBookings) {
    if (candidate.id && existing.id && candidate.id === existing.id) {
      continue;
    }
    if (existing.tenant_id !== candidate.tenant_id || existing.court_id !== candidate.court_id) {
      continue;
    }
    if (!isBlockingBookingStatus(existing.status)) {
      continue;
    }

    if (
      doTimeRangesOverlap(
        existing.starts_at,
        existing.ends_at,
        candidate.starts_at,
        candidate.ends_at,
      )
    ) {
      throw new BookingOverlapError(
        `conflicting key value violates exclusion constraint "${BOOKING_EXCLUSION_CONSTRAINT_NAME}"`,
        existing.id,
      );
    }
  }
}

export const POSTGRES_RLS_VIOLATION_CODE = "42501" as const;

export const TENANT_RLS_HELPER_FUNCTIONS = ["current_user_tenant_id", "current_user_role"] as const;

export type RlsOperation = "SELECT" | "INSERT" | "UPDATE" | "DELETE";

export const OWNER_MANAGED_CONFIG_TABLES = [
  "sports",
  "courts",
  "pricing",
  "users",
] as const satisfies readonly TenantScopedTableName[];

export const OPERATIONAL_TENANT_TABLES = [
  "customers",
  "bookings",
  "payments",
] as const satisfies readonly TenantScopedTableName[];

export interface AuthenticatedTenantUserContext {
  userId: string;
  tenantId: string;
  role: UserRole;
  isActive?: boolean;
}

export type TenantOwnedRow = { tenant_id: string } | { id: string; slug?: string };

export class RlsAccessDeniedError extends Error {
  readonly code = POSTGRES_RLS_VIOLATION_CODE;
  readonly table: SchemaTableName;
  readonly operation: RlsOperation;

  constructor(table: SchemaTableName, operation: RlsOperation) {
    super(`new row violates row-level security policy for table "${table}" (${operation})`);
    this.name = "RlsAccessDeniedError";
    this.table = table;
    this.operation = operation;
  }
}

function resolveRowTenantId(table: SchemaTableName, row: TenantOwnedRow): string {
  if (table === "tenants") {
    if ("id" in row && typeof row.id === "string") {
      return row.id;
    }
    throw new Error('Table "tenants" row must include an "id" field for RLS evaluation');
  }
  if ("tenant_id" in row && typeof row.tenant_id === "string") {
    return row.tenant_id;
  }
  throw new Error(`Table "${table}" row must include a "tenant_id" field for RLS evaluation`);
}

/**
 * Evaluates the PostgreSQL Row Level Security (RLS) policy for a given table, operation,
 * authenticated user context, and target row.
 * Mirrors the policies in `20261101213000_tenant_rls_policies.sql`.
 */
export function canAccessTenantRecord(params: {
  user: AuthenticatedTenantUserContext | null | undefined;
  table: SchemaTableName;
  operation: RlsOperation;
  row: TenantOwnedRow;
}): boolean {
  const { user, table, operation, row } = params;

  if (!user || !user.userId || !user.tenantId || user.isActive === false) {
    return false;
  }

  const rowTenantId = resolveRowTenantId(table, row);
  if (rowTenantId !== user.tenantId) {
    return false;
  }

  if (table === "tenants") {
    if (operation === "SELECT") {
      return true;
    }
    if (operation === "UPDATE") {
      return user.role === "owner";
    }
    return false;
  }

  if ((OWNER_MANAGED_CONFIG_TABLES as readonly string[]).includes(table)) {
    if (operation === "SELECT") {
      return true;
    }
    return user.role === "owner";
  }

  if ((OPERATIONAL_TENANT_TABLES as readonly string[]).includes(table)) {
    return operation === "SELECT" || operation === "INSERT" || operation === "UPDATE";
  }

  return false;
}

/**
 * Filters a collection of rows using the `SELECT` RLS policy (`USING`) for the given user.
 * Rows belonging to other tenants are invisible (filtered out), matching PostgreSQL RLS behavior.
 */
export function filterTenantRecordsForUser<T extends TenantOwnedRow>(
  user: AuthenticatedTenantUserContext | null | undefined,
  table: SchemaTableName,
  rows: readonly T[],
): T[] {
  return rows.filter((row) =>
    canAccessTenantRecord({
      user,
      table,
      operation: "SELECT",
      row,
    }),
  );
}

/**
 * Enforces `USING` / `WITH CHECK` RLS policies for mutations (`INSERT`, `UPDATE`, `DELETE`).
 * Throws `RlsAccessDeniedError` (`42501`) when a user attempts to mutate another tenant's data
 * or lacks role permissions, or when an `UPDATE` attempts to reassign `tenant_id`.
 */
export function assertTenantAccess(params: {
  user: AuthenticatedTenantUserContext | null | undefined;
  table: SchemaTableName;
  operation: RlsOperation;
  row: TenantOwnedRow;
  updatedRow?: TenantOwnedRow;
}): void {
  const { user, table, operation, row, updatedRow } = params;

  if (!canAccessTenantRecord({ user, table, operation, row })) {
    throw new RlsAccessDeniedError(table, operation);
  }

  if (
    updatedRow &&
    !canAccessTenantRecord({
      user,
      table,
      operation,
      row: updatedRow,
    })
  ) {
    throw new RlsAccessDeniedError(table, operation);
  }
}
