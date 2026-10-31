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

