import {
  type ApproveDepositPaymentResult,
  type AuthenticatedTenantUserContext,
  type BookingAvailabilityCandidate,
  BookingOverlapError,
  type BookingRecord,
  type BookingStatus,
  DEFAULT_HOURLY_PRICE_COP,
  DEFAULT_SLOT_MINUTES,
  DEFAULT_TIMEZONE,
  DepositValidationError,
  InvalidBookingTransitionError,
  POSTGRES_EXCLUSION_VIOLATION_CODE,
  type PaymentMethod,
  type PaymentRecord,
  type RejectDepositPaymentResult,
  ReschedulePolicyError,
  type SportCode,
  approveDepositPayment,
  cancelBooking,
  createHoldBooking,
  formatLocalDateInTimezone,
  localDateTimeToUtcIso,
  moveHoldBooking,
  rejectDepositPayment,
  rescheduleBooking,
  submitDepositReceipt,
} from "@canchaya/core";
import { getPublicSupabaseEnv } from "./env";

export interface PanelCustomerSummary {
  id: string;
  tenant_id: string;
  full_name: string;
  phone: string;
}

interface TenantRow {
  id: string;
  timezone: string;
  slot_duration_minutes: number;
}

interface CourtRow {
  id: string;
  tenant_id: string;
  name: string;
  is_active: boolean;
}

interface SupabaseErrorPayload {
  code?: string;
  message?: string;
  details?: string;
}

export class BookingValidationError extends Error {
  readonly status = 400 as const;

  constructor(message: string) {
    super(message);
    this.name = "BookingValidationError";
  }
}

export class BookingNotFoundError extends Error {
  readonly status = 404 as const;

  constructor(message = "La reserva o recurso solicitado no existe.") {
    super(message);
    this.name = "BookingNotFoundError";
  }
}

export class BookingConflictError extends Error {
  readonly status = 409 as const;

  constructor(message = "Ese horario ya está ocupado en la cancha seleccionada.") {
    super(message);
    this.name = "BookingConflictError";
  }
}

async function supabaseRestRequest<T>(params: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string;
  method: "GET" | "POST" | "PATCH";
  path: string;
  searchParams?: Record<string, string>;
  body?: unknown;
  prefer?: string;
  fetchImpl: typeof fetch;
}): Promise<T> {
  const url = new URL(`${params.supabaseUrl}/rest/v1/${params.path}`);
  if (params.searchParams) {
    for (const [key, value] of Object.entries(params.searchParams)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    apikey: params.supabaseAnonKey,
    Authorization: `Bearer ${params.accessToken}`,
    Accept: "application/json",
  };

  if (params.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (params.prefer) {
    headers.Prefer = params.prefer;
  }

  const response = await params.fetchImpl(url.toString(), {
    method: params.method,
    headers,
    body: params.body !== undefined ? JSON.stringify(params.body) : undefined,
    cache: "no-store",
  });

  if (!response.ok) {
    let errorPayload: SupabaseErrorPayload | null = null;
    try {
      errorPayload = (await response.json()) as SupabaseErrorPayload;
    } catch {
      errorPayload = null;
    }

    if (errorPayload?.code === POSTGRES_EXCLUSION_VIOLATION_CODE) {
      throw new BookingConflictError("Ese horario ya está ocupado en la cancha seleccionada.");
    }
    if (errorPayload?.code === "23505") {
      throw new BookingConflictError("Ya existe un registro con esos datos.");
    }

    throw new Error(`Supabase ${params.method} ${params.path} failed (${response.status})`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

function sanitizePostgrestSearchTerm(term: string): string {
  return term.replace(/[,()*]/g, " ").trim();
}

export function normalizePhoneInput(rawPhone: string): string {
  const trimmed = rawPhone.trim();
  const digitsOnly = trimmed.replace(/[^\d+]/g, "");
  if (/^3\d{9}$/.test(digitsOnly)) {
    return `+57${digitsOnly}`;
  }
  if (/^57\d{10}$/.test(digitsOnly)) {
    return `+${digitsOnly}`;
  }
  return digitsOnly;
}

function resolveSlotUtcRange(params: {
  localDate: string;
  localStartTime: string;
  timezone: string;
  slotDurationMinutes: number;
}): { startsAtUtc: string; endsAtUtc: string } {
  const startsAtUtc = localDateTimeToUtcIso(
    params.localDate,
    params.localStartTime,
    params.timezone,
  );
  const startMs = Date.parse(startsAtUtc);
  const endsAtUtc = new Date(startMs + params.slotDurationMinutes * 60_000).toISOString();
  return { startsAtUtc, endsAtUtc };
}

function mapDomainError(error: unknown): never {
  if (error instanceof BookingOverlapError) {
    throw new BookingConflictError("Ese horario ya está ocupado en la cancha seleccionada.");
  }
  if (error instanceof ReschedulePolicyError) {
    if (error.code === "NEW_SLOT_IN_PAST") {
      throw new BookingValidationError("No puedes mover una reserva a un horario pasado.");
    }
    throw new BookingValidationError(error.message);
  }
  if (error instanceof InvalidBookingTransitionError) {
    if (error.message.includes("cancellation_reason is required")) {
      throw new BookingValidationError("El motivo de cancelación es obligatorio.");
    }
    if (error.message.includes("already expired")) {
      throw new BookingValidationError("La reserva en HOLD ya expiró y no puede moverse.");
    }
    throw new BookingValidationError(
      `No se puede realizar esta acción sobre una reserva en estado ${error.from}.`,
    );
  }
  if (error instanceof DepositValidationError) {
    if (error.code === "REJECTION_REASON_REQUIRED") {
      throw new BookingValidationError("Debes indicar un motivo para rechazar el comprobante.");
    }
    if (error.code === "RECEIPT_URL_REQUIRED") {
      throw new BookingValidationError("Debes adjuntar o indicar la referencia del comprobante.");
    }
    if (error.code === "PAYMENT_NOT_PENDING") {
      throw new BookingConflictError("Este anticipo ya fue procesado anteriormente.");
    }
    if (error.code === "INVALID_DEPOSIT_AMOUNT") {
      throw new BookingValidationError("El monto del anticipo en COP no es válido.");
    }
    throw new BookingValidationError(error.message);
  }
  throw error;
}

async function loadTenantAndCourt(params: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string;
  tenantId: string;
  courtId: string;
  fetchImpl: typeof fetch;
}): Promise<{ tenant: TenantRow; court: CourtRow }> {
  const [tenants, courts] = await Promise.all([
    supabaseRestRequest<TenantRow[]>({
      supabaseUrl: params.supabaseUrl,
      supabaseAnonKey: params.supabaseAnonKey,
      accessToken: params.accessToken,
      method: "GET",
      path: "tenants",
      searchParams: {
        select: "id,timezone,slot_duration_minutes",
        id: `eq.${params.tenantId}`,
        limit: "1",
      },
      fetchImpl: params.fetchImpl,
    }),
    supabaseRestRequest<CourtRow[]>({
      supabaseUrl: params.supabaseUrl,
      supabaseAnonKey: params.supabaseAnonKey,
      accessToken: params.accessToken,
      method: "GET",
      path: "courts",
      searchParams: {
        select: "id,tenant_id,name,is_active",
        id: `eq.${params.courtId}`,
        tenant_id: `eq.${params.tenantId}`,
        limit: "1",
      },
      fetchImpl: params.fetchImpl,
    }),
  ]);

  const tenant = tenants[0];
  if (!tenant) {
    throw new BookingNotFoundError("No se encontró el recinto configurado.");
  }
  const court = courts[0];
  if (!court || !court.is_active) {
    throw new BookingValidationError("La cancha seleccionada no existe o está inactiva.");
  }
  return { tenant, court };
}

async function loadOverlappingBookingsForCourt(params: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string;
  tenantId: string;
  courtId: string;
  startsAtUtc: string;
  endsAtUtc: string;
  fetchImpl: typeof fetch;
}): Promise<BookingAvailabilityCandidate[]> {
  return supabaseRestRequest<BookingAvailabilityCandidate[]>({
    supabaseUrl: params.supabaseUrl,
    supabaseAnonKey: params.supabaseAnonKey,
    accessToken: params.accessToken,
    method: "GET",
    path: "bookings",
    searchParams: {
      select: "id,tenant_id,court_id,status,starts_at,ends_at,hold_expires_at",
      tenant_id: `eq.${params.tenantId}`,
      court_id: `eq.${params.courtId}`,
      and: `(starts_at.lt.${params.endsAtUtc},ends_at.gt.${params.startsAtUtc})`,
    },
    fetchImpl: params.fetchImpl,
  });
}

export async function searchTenantCustomers(params: {
  user: AuthenticatedTenantUserContext;
  accessToken: string;
  query?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<PanelCustomerSummary[]> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const { supabaseUrl, supabaseAnonKey } = getPublicSupabaseEnv(params.env);
  const searchParams: Record<string, string> = {
    select: "id,tenant_id,full_name,phone",
    tenant_id: `eq.${params.user.tenantId}`,
    order: "full_name.asc",
    limit: "15",
  };

  const sanitized = sanitizePostgrestSearchTerm(params.query ?? "");
  if (sanitized.length > 0) {
    searchParams.or = `(full_name.ilike.*${sanitized}*,phone.ilike.*${sanitized}*)`;
  }

  return supabaseRestRequest<PanelCustomerSummary[]>({
    supabaseUrl,
    supabaseAnonKey,
    accessToken: params.accessToken,
    method: "GET",
    path: "customers",
    searchParams,
    fetchImpl,
  });
}

export async function createTenantCustomer(params: {
  user: AuthenticatedTenantUserContext;
  accessToken: string;
  fullName: string;
  phone: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<PanelCustomerSummary> {
  const fullName = params.fullName.trim();
  const phone = normalizePhoneInput(params.phone);

  if (fullName.length < 2) {
    throw new BookingValidationError("El nombre del cliente debe tener al menos 2 caracteres.");
  }
  const digitCount = phone.replace(/\D/g, "").length;
  if (digitCount < 7 || digitCount > 15) {
    throw new BookingValidationError("Ingresa un número de teléfono válido (ej. 3001234567).");
  }

  const fetchImpl = params.fetchImpl ?? fetch;
  const { supabaseUrl, supabaseAnonKey } = getPublicSupabaseEnv(params.env);

  try {
    const created = await supabaseRestRequest<PanelCustomerSummary[]>({
      supabaseUrl,
      supabaseAnonKey,
      accessToken: params.accessToken,
      method: "POST",
      path: "customers",
      body: {
        tenant_id: params.user.tenantId,
        full_name: fullName,
        phone,
      },
      prefer: "return=representation",
      fetchImpl,
    });

    if (!created[0]) {
      throw new Error("Supabase did not return created customer");
    }
    return created[0];
  } catch (error) {
    if (error instanceof BookingConflictError) {
      throw new BookingConflictError("Ya existe un cliente registrado con ese teléfono.");
    }
    throw error;
  }
}

export async function createManualHoldBooking(params: {
  user: AuthenticatedTenantUserContext;
  accessToken: string;
  courtId: string;
  customerId: string;
  localDate: string;
  localStartTime: string;
  notes?: string | null;
  referenceTime?: string | Date;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<BookingRecord> {
  if (!params.courtId.trim() || !params.customerId.trim()) {
    throw new BookingValidationError("Debes seleccionar una cancha y un cliente.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.localDate)) {
    throw new BookingValidationError("Formato de fecha inválido. Usa YYYY-MM-DD.");
  }
  if (!/^\d{2}:\d{2}$/.test(params.localStartTime)) {
    throw new BookingValidationError("Formato de hora inválido. Usa HH:MM.");
  }

  const fetchImpl = params.fetchImpl ?? fetch;
  const { supabaseUrl, supabaseAnonKey } = getPublicSupabaseEnv(params.env);
  const referenceDate =
    params.referenceTime !== undefined ? new Date(params.referenceTime) : new Date();

  const [{ tenant }, customers] = await Promise.all([
    loadTenantAndCourt({
      supabaseUrl,
      supabaseAnonKey,
      accessToken: params.accessToken,
      tenantId: params.user.tenantId,
      courtId: params.courtId,
      fetchImpl,
    }),
    supabaseRestRequest<Array<{ id: string }>>({
      supabaseUrl,
      supabaseAnonKey,
      accessToken: params.accessToken,
      method: "GET",
      path: "customers",
      searchParams: {
        select: "id",
        id: `eq.${params.customerId}`,
        tenant_id: `eq.${params.user.tenantId}`,
        limit: "1",
      },
      fetchImpl,
    }),
  ]);

  if (!customers[0]) {
    throw new BookingValidationError("El cliente seleccionado no pertenece al recinto.");
  }

  const timezone = tenant.timezone || DEFAULT_TIMEZONE;
  const slotDurationMinutes = tenant.slot_duration_minutes || DEFAULT_SLOT_MINUTES;
  const { startsAtUtc, endsAtUtc } = resolveSlotUtcRange({
    localDate: params.localDate,
    localStartTime: params.localStartTime,
    timezone,
    slotDurationMinutes,
  });

  if (Date.parse(startsAtUtc) < referenceDate.getTime()) {
    throw new BookingValidationError("No puedes crear una reserva en un horario pasado.");
  }

  const existingBookings = await loadOverlappingBookingsForCourt({
    supabaseUrl,
    supabaseAnonKey,
    accessToken: params.accessToken,
    tenantId: params.user.tenantId,
    courtId: params.courtId,
    startsAtUtc,
    endsAtUtc,
    fetchImpl,
  });

  let bookingDraft: BookingRecord;
  try {
    bookingDraft = createHoldBooking({
      tenantId: params.user.tenantId,
      courtId: params.courtId,
      customerId: params.customerId,
      startsAtUtc,
      endsAtUtc,
      totalPriceCop: DEFAULT_HOURLY_PRICE_COP,
      existingBookings,
      createdByUserId: params.user.userId,
      notes: params.notes?.trim() || null,
      referenceTime: referenceDate,
    });
  } catch (error) {
    mapDomainError(error);
  }

  const created = await supabaseRestRequest<BookingRecord[]>({
    supabaseUrl,
    supabaseAnonKey,
    accessToken: params.accessToken,
    method: "POST",
    path: "bookings",
    body: {
      id: bookingDraft.id,
      tenant_id: bookingDraft.tenant_id,
      court_id: bookingDraft.court_id,
      customer_id: bookingDraft.customer_id,
      status: bookingDraft.status,
      starts_at: bookingDraft.starts_at,
      ends_at: bookingDraft.ends_at,
      hold_expires_at: bookingDraft.hold_expires_at,
      total_price_cop: bookingDraft.total_price_cop,
      deposit_required_cop: bookingDraft.deposit_required_cop,
      balance_due_cop: bookingDraft.balance_due_cop,
      rescheduled_from_booking_id: bookingDraft.rescheduled_from_booking_id,
      created_by_user_id: bookingDraft.created_by_user_id,
      cancellation_reason: bookingDraft.cancellation_reason,
      notes: bookingDraft.notes,
    },
    prefer: "return=representation",
    fetchImpl,
  });

  return created[0] ?? bookingDraft;
}

export async function moveManualBooking(params: {
  user: AuthenticatedTenantUserContext;
  accessToken: string;
  bookingId: string;
  newCourtId: string;
  localDate: string;
  localStartTime: string;
  referenceTime?: string | Date;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<BookingRecord> {
  if (!params.newCourtId.trim()) {
    throw new BookingValidationError("Debes seleccionar la cancha destino.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.localDate)) {
    throw new BookingValidationError("Formato de fecha inválido. Usa YYYY-MM-DD.");
  }
  if (!/^\d{2}:\d{2}$/.test(params.localStartTime)) {
    throw new BookingValidationError("Formato de hora inválido. Usa HH:MM.");
  }

  const fetchImpl = params.fetchImpl ?? fetch;
  const { supabaseUrl, supabaseAnonKey } = getPublicSupabaseEnv(params.env);
  const referenceDate =
    params.referenceTime !== undefined ? new Date(params.referenceTime) : new Date();

  const bookingRows = await supabaseRestRequest<BookingRecord[]>({
    supabaseUrl,
    supabaseAnonKey,
    accessToken: params.accessToken,
    method: "GET",
    path: "bookings",
    searchParams: {
      select: "*",
      id: `eq.${params.bookingId}`,
      tenant_id: `eq.${params.user.tenantId}`,
      limit: "1",
    },
    fetchImpl,
  });

  const currentBooking = bookingRows[0];
  if (!currentBooking) {
    throw new BookingNotFoundError("No se encontró la reserva solicitada.");
  }

  const { tenant } = await loadTenantAndCourt({
    supabaseUrl,
    supabaseAnonKey,
    accessToken: params.accessToken,
    tenantId: params.user.tenantId,
    courtId: params.newCourtId,
    fetchImpl,
  });

  const timezone = tenant.timezone || DEFAULT_TIMEZONE;
  const slotDurationMinutes = tenant.slot_duration_minutes || DEFAULT_SLOT_MINUTES;
  const { startsAtUtc, endsAtUtc } = resolveSlotUtcRange({
    localDate: params.localDate,
    localStartTime: params.localStartTime,
    timezone,
    slotDurationMinutes,
  });

  const existingBookings = await loadOverlappingBookingsForCourt({
    supabaseUrl,
    supabaseAnonKey,
    accessToken: params.accessToken,
    tenantId: params.user.tenantId,
    courtId: params.newCourtId,
    startsAtUtc,
    endsAtUtc,
    fetchImpl,
  });

  if (currentBooking.status === "HOLD") {
    let movedHold: BookingRecord;
    try {
      movedHold = moveHoldBooking({
        booking: currentBooking,
        newCourtId: params.newCourtId,
        startsAtUtc,
        endsAtUtc,
        referenceTime: referenceDate,
        existingBookings,
      });
    } catch (error) {
      mapDomainError(error);
    }

    const updated = await supabaseRestRequest<BookingRecord[]>({
      supabaseUrl,
      supabaseAnonKey,
      accessToken: params.accessToken,
      method: "PATCH",
      path: "bookings",
      searchParams: {
        id: `eq.${currentBooking.id}`,
        tenant_id: `eq.${params.user.tenantId}`,
      },
      body: {
        court_id: movedHold.court_id,
        starts_at: movedHold.starts_at,
        ends_at: movedHold.ends_at,
        updated_at: movedHold.updated_at,
      },
      prefer: "return=representation",
      fetchImpl,
    });

    return updated[0] ?? movedHold;
  }

  if (currentBooking.status === "CONFIRMED") {
    const payments = await supabaseRestRequest<PaymentRecord[]>({
      supabaseUrl,
      supabaseAnonKey,
      accessToken: params.accessToken,
      method: "GET",
      path: "payments",
      searchParams: {
        select: "*",
        booking_id: `eq.${currentBooking.id}`,
        tenant_id: `eq.${params.user.tenantId}`,
      },
      fetchImpl,
    });

    let rescheduled;
    try {
      rescheduled = rescheduleBooking({
        booking: currentBooking,
        newCourtId: params.newCourtId,
        startsAtUtc,
        endsAtUtc,
        minRescheduleHours: 0,
        referenceTime: referenceDate,
        existingBookings,
        payments,
        createdByUserId: params.user.userId,
      });
    } catch (error) {
      mapDomainError(error);
    }

    const createdNew = await supabaseRestRequest<BookingRecord[]>({
      supabaseUrl,
      supabaseAnonKey,
      accessToken: params.accessToken,
      method: "POST",
      path: "bookings",
      body: {
        id: rescheduled.newBooking.id,
        tenant_id: rescheduled.newBooking.tenant_id,
        court_id: rescheduled.newBooking.court_id,
        customer_id: rescheduled.newBooking.customer_id,
        status: rescheduled.newBooking.status,
        starts_at: rescheduled.newBooking.starts_at,
        ends_at: rescheduled.newBooking.ends_at,
        hold_expires_at: rescheduled.newBooking.hold_expires_at,
        total_price_cop: rescheduled.newBooking.total_price_cop,
        deposit_required_cop: rescheduled.newBooking.deposit_required_cop,
        balance_due_cop: rescheduled.newBooking.balance_due_cop,
        rescheduled_from_booking_id: rescheduled.newBooking.rescheduled_from_booking_id,
        created_by_user_id: rescheduled.newBooking.created_by_user_id,
        cancellation_reason: rescheduled.newBooking.cancellation_reason,
        notes: rescheduled.newBooking.notes,
      },
      prefer: "return=representation",
      fetchImpl,
    });

    const movedPayments = rescheduled.payments.filter(
      (p) => p.booking_id === rescheduled.newBooking.id,
    );
    await Promise.all(
      movedPayments.map((payment) =>
        supabaseRestRequest({
          supabaseUrl,
          supabaseAnonKey,
          accessToken: params.accessToken,
          method: "PATCH",
          path: "payments",
          searchParams: {
            id: `eq.${payment.id}`,
            tenant_id: `eq.${params.user.tenantId}`,
          },
          body: {
            booking_id: payment.booking_id,
            updated_at: payment.updated_at,
          },
          fetchImpl,
        }),
      ),
    );

    await supabaseRestRequest({
      supabaseUrl,
      supabaseAnonKey,
      accessToken: params.accessToken,
      method: "PATCH",
      path: "bookings",
      searchParams: {
        id: `eq.${currentBooking.id}`,
        tenant_id: `eq.${params.user.tenantId}`,
      },
      body: {
        status: "RESCHEDULED",
        updated_at: rescheduled.originalBooking.updated_at,
      },
      fetchImpl,
    });

    return createdNew[0] ?? rescheduled.newBooking;
  }

  throw new BookingValidationError(
    `No se puede mover una reserva en estado ${currentBooking.status}.`,
  );
}

export async function cancelManualBooking(params: {
  user: AuthenticatedTenantUserContext;
  accessToken: string;
  bookingId: string;
  cancellationReason: string;
  referenceTime?: string | Date;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<BookingRecord> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const { supabaseUrl, supabaseAnonKey } = getPublicSupabaseEnv(params.env);
  const referenceDate =
    params.referenceTime !== undefined ? new Date(params.referenceTime) : new Date();

  const bookingRows = await supabaseRestRequest<BookingRecord[]>({
    supabaseUrl,
    supabaseAnonKey,
    accessToken: params.accessToken,
    method: "GET",
    path: "bookings",
    searchParams: {
      select: "*",
      id: `eq.${params.bookingId}`,
      tenant_id: `eq.${params.user.tenantId}`,
      limit: "1",
    },
    fetchImpl,
  });

  const currentBooking = bookingRows[0];
  if (!currentBooking) {
    throw new BookingNotFoundError("No se encontró la reserva solicitada.");
  }

  let cancelled: BookingRecord;
  try {
    cancelled = cancelBooking({
      booking: currentBooking,
      cancellationReason: params.cancellationReason,
      referenceTime: referenceDate,
    });
  } catch (error) {
    mapDomainError(error);
  }

  const updated = await supabaseRestRequest<BookingRecord[]>({
    supabaseUrl,
    supabaseAnonKey,
    accessToken: params.accessToken,
    method: "PATCH",
    path: "bookings",
    searchParams: {
      id: `eq.${currentBooking.id}`,
      tenant_id: `eq.${params.user.tenantId}`,
    },
    body: {
      status: "CANCELLED",
      cancellation_reason: cancelled.cancellation_reason,
      updated_at: cancelled.updated_at,
    },
    prefer: "return=representation",
    fetchImpl,
  });

  return updated[0] ?? cancelled;
}

export interface PendingDepositQueueItem {
  paymentId: string;
  bookingId: string;
  tenantId: string;
  courtId: string;
  courtName: string;
  sportCode: SportCode;
  customerId: string;
  customerName: string;
  customerPhone: string;
  startsAtUtc: string;
  endsAtUtc: string;
  localDate: string;
  localStartTime: string;
  localEndTime: string;
  totalPriceCop: number;
  depositRequiredCop: number;
  amountCop: number;
  method: PaymentMethod;
  receiptMediaUrl: string | null;
  createdAtUtc: string;
}

interface PendingDepositQueryRow {
  id: string;
  tenant_id: string;
  booking_id: string;
  payment_type: string;
  method: PaymentMethod;
  status: string;
  amount_cop: number;
  receipt_media_url: string | null;
  created_at: string;
  booking?:
    | {
        id: string;
        court_id: string;
        customer_id: string;
        status: BookingStatus;
        starts_at: string;
        ends_at: string;
        total_price_cop: number;
        deposit_required_cop: number;
        court?:
          | {
              id?: string;
              name?: string | null;
              sport?: { code?: SportCode } | Array<{ code?: SportCode }> | null;
            }
          | Array<{
              id?: string;
              name?: string | null;
              sport?: { code?: SportCode } | Array<{ code?: SportCode }> | null;
            }>
          | null;
        customer?:
          | { id?: string; full_name?: string | null; phone?: string | null }
          | Array<{ id?: string; full_name?: string | null; phone?: string | null }>
          | null;
      }
    | Array<{
        id: string;
        court_id: string;
        customer_id: string;
        status: BookingStatus;
        starts_at: string;
        ends_at: string;
        total_price_cop: number;
        deposit_required_cop: number;
        court?:
          | {
              id?: string;
              name?: string | null;
              sport?: { code?: SportCode } | Array<{ code?: SportCode }> | null;
            }
          | Array<{
              id?: string;
              name?: string | null;
              sport?: { code?: SportCode } | Array<{ code?: SportCode }> | null;
            }>
          | null;
        customer?:
          | { id?: string; full_name?: string | null; phone?: string | null }
          | Array<{ id?: string; full_name?: string | null; phone?: string | null }>
          | null;
      }>
    | null;
}

function unwrapSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function formatUtcAsLocalTime(utcIso: string, timezone: string): string {
  const date = new Date(utcIso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour === "24" ? "00" : hour}:${minute}`;
}

/**
 * Lists all pending deposit payments (`status = 'pending_validation'`, `payment_type = 'deposit'`)
 * for the authenticated user's tenant across all dates, ordered by arrival (`created_at ASC`).
 */
export async function listPendingDepositValidations(params: {
  user: AuthenticatedTenantUserContext;
  accessToken: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<PendingDepositQueueItem[]> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const { supabaseUrl, supabaseAnonKey } = getPublicSupabaseEnv(params.env);

  const [tenants, paymentRows] = await Promise.all([
    supabaseRestRequest<Array<{ id: string; timezone: string }>>({
      supabaseUrl,
      supabaseAnonKey,
      accessToken: params.accessToken,
      method: "GET",
      path: "tenants",
      searchParams: {
        select: "id,timezone",
        id: `eq.${params.user.tenantId}`,
        limit: "1",
      },
      fetchImpl,
    }),
    supabaseRestRequest<PendingDepositQueryRow[]>({
      supabaseUrl,
      supabaseAnonKey,
      accessToken: params.accessToken,
      method: "GET",
      path: "payments",
      searchParams: {
        select:
          "id,tenant_id,booking_id,payment_type,method,status,amount_cop,receipt_media_url,created_at,booking:bookings(id,court_id,customer_id,status,starts_at,ends_at,total_price_cop,deposit_required_cop,court:courts(id,name,sport:sports(code)),customer:customers(id,full_name,phone))",
        tenant_id: `eq.${params.user.tenantId}`,
        payment_type: "eq.deposit",
        status: "eq.pending_validation",
        order: "created_at.asc",
      },
      fetchImpl,
    }),
  ]);

  const timezone = tenants[0]?.timezone || DEFAULT_TIMEZONE;
  const items: PendingDepositQueueItem[] = [];

  for (const row of paymentRows) {
    const booking = unwrapSingle(row.booking);
    if (!booking || booking.status !== "HOLD") {
      continue;
    }

    const court = unwrapSingle(booking.court);
    const sport = unwrapSingle(court?.sport);
    const customer = unwrapSingle(booking.customer);

    const localDate = formatLocalDateInTimezone(new Date(booking.starts_at), timezone);
    const localStartTime = formatUtcAsLocalTime(booking.starts_at, timezone);
    const localEndTimeRaw = formatUtcAsLocalTime(booking.ends_at, timezone);
    const localEndTime =
      localEndTimeRaw === "00:00" && localStartTime !== "00:00" ? "24:00" : localEndTimeRaw;

    items.push({
      paymentId: row.id,
      bookingId: booking.id,
      tenantId: row.tenant_id,
      courtId: booking.court_id,
      courtName: court?.name?.trim() || "Cancha",
      sportCode: sport?.code === "futbol_5" ? "futbol_5" : "padel",
      customerId: booking.customer_id,
      customerName: customer?.full_name?.trim() || "Cliente WhatsApp",
      customerPhone: customer?.phone?.trim() || "",
      startsAtUtc: booking.starts_at,
      endsAtUtc: booking.ends_at,
      localDate,
      localStartTime,
      localEndTime,
      totalPriceCop: booking.total_price_cop,
      depositRequiredCop: booking.deposit_required_cop,
      amountCop: row.amount_cop,
      method: row.method,
      receiptMediaUrl: row.receipt_media_url,
      createdAtUtc: row.created_at,
    });
  }

  return items;
}

/**
 * Registers a deposit receipt (`status = 'pending_validation'`) for a `HOLD` booking so it enters
 * the validation queue and is protected from automatic `HOLD` expiration (`CY-038`).
 */
export async function registerManualDepositReceipt(params: {
  user: AuthenticatedTenantUserContext;
  accessToken: string;
  bookingId: string;
  receiptMediaUrl: string;
  amountCop?: number;
  method?: Extract<PaymentMethod, "transfer" | "cash">;
  referenceTime?: string | Date;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<PaymentRecord> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const { supabaseUrl, supabaseAnonKey } = getPublicSupabaseEnv(params.env);
  const referenceDate =
    params.referenceTime !== undefined ? new Date(params.referenceTime) : new Date();

  const [bookingRows, existingPending] = await Promise.all([
    supabaseRestRequest<BookingRecord[]>({
      supabaseUrl,
      supabaseAnonKey,
      accessToken: params.accessToken,
      method: "GET",
      path: "bookings",
      searchParams: {
        select: "*",
        id: `eq.${params.bookingId}`,
        tenant_id: `eq.${params.user.tenantId}`,
        limit: "1",
      },
      fetchImpl,
    }),
    supabaseRestRequest<PaymentRecord[]>({
      supabaseUrl,
      supabaseAnonKey,
      accessToken: params.accessToken,
      method: "GET",
      path: "payments",
      searchParams: {
        select: "*",
        booking_id: `eq.${params.bookingId}`,
        tenant_id: `eq.${params.user.tenantId}`,
        payment_type: "eq.deposit",
        status: "eq.pending_validation",
        limit: "1",
      },
      fetchImpl,
    }),
  ]);

  const booking = bookingRows[0];
  if (!booking) {
    throw new BookingNotFoundError("No se encontró la reserva solicitada.");
  }

  let draftPayment: PaymentRecord;
  try {
    draftPayment = submitDepositReceipt({
      id: existingPending[0]?.id,
      booking,
      receiptMediaUrl: params.receiptMediaUrl,
      amountCop: params.amountCop,
      method: params.method,
      referenceTime: referenceDate,
    });
  } catch (error) {
    mapDomainError(error);
  }

  if (existingPending[0]) {
    const updated = await supabaseRestRequest<PaymentRecord[]>({
      supabaseUrl,
      supabaseAnonKey,
      accessToken: params.accessToken,
      method: "PATCH",
      path: "payments",
      searchParams: {
        id: `eq.${existingPending[0].id}`,
        tenant_id: `eq.${params.user.tenantId}`,
      },
      body: {
        method: draftPayment.method,
        amount_cop: draftPayment.amount_cop,
        cash_amount_cop: draftPayment.cash_amount_cop,
        transfer_amount_cop: draftPayment.transfer_amount_cop,
        receipt_media_url: draftPayment.receipt_media_url,
        updated_at: draftPayment.updated_at,
      },
      prefer: "return=representation",
      fetchImpl,
    });
    return updated[0] ?? draftPayment;
  }

  const created = await supabaseRestRequest<PaymentRecord[]>({
    supabaseUrl,
    supabaseAnonKey,
    accessToken: params.accessToken,
    method: "POST",
    path: "payments",
    body: {
      id: draftPayment.id,
      tenant_id: draftPayment.tenant_id,
      booking_id: draftPayment.booking_id,
      payment_type: draftPayment.payment_type,
      method: draftPayment.method,
      status: draftPayment.status,
      amount_cop: draftPayment.amount_cop,
      cash_amount_cop: draftPayment.cash_amount_cop,
      transfer_amount_cop: draftPayment.transfer_amount_cop,
      receipt_media_url: draftPayment.receipt_media_url,
    },
    prefer: "return=representation",
    fetchImpl,
  });

  return created[0] ?? draftPayment;
}

/**
 * Approves a pending deposit payment in 1 touch (`CY-038`), transitioning the booking
 * from `HOLD` to `CONFIRMED` and deducting the deposit from `balance_due_cop`.
 */
export async function approvePendingDeposit(params: {
  user: AuthenticatedTenantUserContext;
  accessToken: string;
  paymentId: string;
  referenceTime?: string | Date;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<ApproveDepositPaymentResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const { supabaseUrl, supabaseAnonKey } = getPublicSupabaseEnv(params.env);
  const referenceDate =
    params.referenceTime !== undefined ? new Date(params.referenceTime) : new Date();

  const paymentRows = await supabaseRestRequest<PaymentRecord[]>({
    supabaseUrl,
    supabaseAnonKey,
    accessToken: params.accessToken,
    method: "GET",
    path: "payments",
    searchParams: {
      select: "*",
      id: `eq.${params.paymentId}`,
      tenant_id: `eq.${params.user.tenantId}`,
      limit: "1",
    },
    fetchImpl,
  });

  const currentPayment = paymentRows[0];
  if (!currentPayment) {
    throw new BookingNotFoundError("No se encontró el anticipo por validar.");
  }

  const bookingRows = await supabaseRestRequest<BookingRecord[]>({
    supabaseUrl,
    supabaseAnonKey,
    accessToken: params.accessToken,
    method: "GET",
    path: "bookings",
    searchParams: {
      select: "*",
      id: `eq.${currentPayment.booking_id}`,
      tenant_id: `eq.${params.user.tenantId}`,
      limit: "1",
    },
    fetchImpl,
  });

  const currentBooking = bookingRows[0];
  if (!currentBooking) {
    throw new BookingNotFoundError("No se encontró la reserva asociada al anticipo.");
  }

  let approved: ApproveDepositPaymentResult;
  try {
    approved = approveDepositPayment({
      booking: currentBooking,
      payment: currentPayment,
      validatedByUserId: params.user.userId,
      referenceTime: referenceDate,
    });
  } catch (error) {
    mapDomainError(error);
  }

  const [updatedPayments, updatedBookings] = await Promise.all([
    supabaseRestRequest<PaymentRecord[]>({
      supabaseUrl,
      supabaseAnonKey,
      accessToken: params.accessToken,
      method: "PATCH",
      path: "payments",
      searchParams: {
        id: `eq.${currentPayment.id}`,
        tenant_id: `eq.${params.user.tenantId}`,
      },
      body: {
        status: approved.payment.status,
        validated_by_user_id: approved.payment.validated_by_user_id,
        validated_at: approved.payment.validated_at,
        rejection_reason: null,
        updated_at: approved.payment.updated_at,
      },
      prefer: "return=representation",
      fetchImpl,
    }),
    supabaseRestRequest<BookingRecord[]>({
      supabaseUrl,
      supabaseAnonKey,
      accessToken: params.accessToken,
      method: "PATCH",
      path: "bookings",
      searchParams: {
        id: `eq.${currentBooking.id}`,
        tenant_id: `eq.${params.user.tenantId}`,
      },
      body: {
        status: approved.booking.status,
        hold_expires_at: approved.booking.hold_expires_at,
        balance_due_cop: approved.booking.balance_due_cop,
        updated_at: approved.booking.updated_at,
      },
      prefer: "return=representation",
      fetchImpl,
    }),
  ]);

  return {
    payment: updatedPayments[0] ?? approved.payment,
    booking: updatedBookings[0] ?? approved.booking,
  };
}

/**
 * Rejects a pending deposit payment with a mandatory reason (`CY-038`), expiring the `HOLD`
 * booking to `CANCELLED` (`HOLD_EXPIRED`) if `hold_expires_at` has already passed.
 */
export async function rejectPendingDeposit(params: {
  user: AuthenticatedTenantUserContext;
  accessToken: string;
  paymentId: string;
  rejectionReason: string;
  referenceTime?: string | Date;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<RejectDepositPaymentResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const { supabaseUrl, supabaseAnonKey } = getPublicSupabaseEnv(params.env);
  const referenceDate =
    params.referenceTime !== undefined ? new Date(params.referenceTime) : new Date();

  const paymentRows = await supabaseRestRequest<PaymentRecord[]>({
    supabaseUrl,
    supabaseAnonKey,
    accessToken: params.accessToken,
    method: "GET",
    path: "payments",
    searchParams: {
      select: "*",
      id: `eq.${params.paymentId}`,
      tenant_id: `eq.${params.user.tenantId}`,
      limit: "1",
    },
    fetchImpl,
  });

  const currentPayment = paymentRows[0];
  if (!currentPayment) {
    throw new BookingNotFoundError("No se encontró el anticipo por validar.");
  }

  const [bookingRows, allBookingPayments] = await Promise.all([
    supabaseRestRequest<BookingRecord[]>({
      supabaseUrl,
      supabaseAnonKey,
      accessToken: params.accessToken,
      method: "GET",
      path: "bookings",
      searchParams: {
        select: "*",
        id: `eq.${currentPayment.booking_id}`,
        tenant_id: `eq.${params.user.tenantId}`,
        limit: "1",
      },
      fetchImpl,
    }),
    supabaseRestRequest<PaymentRecord[]>({
      supabaseUrl,
      supabaseAnonKey,
      accessToken: params.accessToken,
      method: "GET",
      path: "payments",
      searchParams: {
        select: "*",
        booking_id: `eq.${currentPayment.booking_id}`,
        tenant_id: `eq.${params.user.tenantId}`,
      },
      fetchImpl,
    }),
  ]);

  const currentBooking = bookingRows[0];
  if (!currentBooking) {
    throw new BookingNotFoundError("No se encontró la reserva asociada al anticipo.");
  }

  let rejected: RejectDepositPaymentResult;
  try {
    rejected = rejectDepositPayment({
      booking: currentBooking,
      payment: currentPayment,
      validatedByUserId: params.user.userId,
      rejectionReason: params.rejectionReason,
      otherPayments: allBookingPayments.filter((p) => p.id !== currentPayment.id),
      referenceTime: referenceDate,
    });
  } catch (error) {
    mapDomainError(error);
  }

  const updatedPayments = await supabaseRestRequest<PaymentRecord[]>({
    supabaseUrl,
    supabaseAnonKey,
    accessToken: params.accessToken,
    method: "PATCH",
    path: "payments",
    searchParams: {
      id: `eq.${currentPayment.id}`,
      tenant_id: `eq.${params.user.tenantId}`,
    },
    body: {
      status: rejected.payment.status,
      validated_by_user_id: rejected.payment.validated_by_user_id,
      validated_at: rejected.payment.validated_at,
      rejection_reason: rejected.payment.rejection_reason,
      updated_at: rejected.payment.updated_at,
    },
    prefer: "return=representation",
    fetchImpl,
  });

  let finalBooking = rejected.booking;
  if (rejected.bookingExpired) {
    const updatedBookings = await supabaseRestRequest<BookingRecord[]>({
      supabaseUrl,
      supabaseAnonKey,
      accessToken: params.accessToken,
      method: "PATCH",
      path: "bookings",
      searchParams: {
        id: `eq.${currentBooking.id}`,
        tenant_id: `eq.${params.user.tenantId}`,
      },
      body: {
        status: rejected.booking.status,
        cancellation_reason: rejected.booking.cancellation_reason,
        updated_at: rejected.booking.updated_at,
      },
      prefer: "return=representation",
      fetchImpl,
    });
    finalBooking = updatedBookings[0] ?? rejected.booking;
  }

  return {
    booking: finalBooking,
    payment: updatedPayments[0] ?? rejected.payment,
    bookingExpired: rejected.bookingExpired,
  };
}
