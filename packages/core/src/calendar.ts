import {
  DEFAULT_HOURLY_PRICE_COP,
  DEFAULT_SLOT_MINUTES,
  DEFAULT_TIMEZONE,
  type BookingStatus,
  type SportCode,
} from "./index";
import {
  type DailyOperatingHoursWindow,
  type WeekdayName,
  type WeeklyOperatingHours,
  formatMinutesAsWallClockTime,
  getLocalDateUtcBounds,
  isBookingBlockingAt,
  localDateTimeToUtcIso,
  parseWallClockTimeMinutes,
} from "./availability";
import { type PaymentMethod, doTimeRangesOverlap } from "./schema";

export type CalendarCellVisualState =
  | "FREE"
  | "HOLD"
  | "PENDING_VALIDATION"
  | "CONFIRMED"
  | "COMPLETED"
  | "NO_SHOW";

export interface CalendarSportItem {
  id: string;
  code: SportCode;
  name: string;
  is_active?: boolean;
}

export interface CalendarCourtItem {
  id: string;
  tenant_id: string;
  sport_id: string;
  name: string;
  display_order: number;
  is_active?: boolean;
}

export interface CalendarBookingItem {
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
  customerName?: string | null;
  hasPendingDepositValidation?: boolean;
  balancePaymentMethod?: PaymentMethod | null;
}

export interface CalendarCourtColumn {
  id: string;
  name: string;
  sportId: string;
  sportCode: SportCode;
  sportName: string;
  displayOrder: number;
}

export interface CalendarCellBookingSummary {
  id: string;
  status: BookingStatus;
  startsAtUtc: string;
  endsAtUtc: string;
  holdExpiresAtUtc: string | null;
  totalPriceCop: number;
  depositRequiredCop: number;
  balanceDueCop: number;
  customerName: string | null;
  hasPendingDepositValidation: boolean;
  balancePaymentMethod: PaymentMethod | null;
}

export interface CalendarCell {
  courtId: string;
  visualState: CalendarCellVisualState;
  priceCop: number;
  booking: CalendarCellBookingSummary | null;
}

export interface CalendarTimeSlotRow {
  localDate: string;
  localStartTime: string;
  localEndTime: string;
  startsAtUtc: string;
  endsAtUtc: string;
  cellsByCourtId: Record<string, CalendarCell>;
}

export interface DailyCalendarGrid {
  tenantId: string;
  localDate: string;
  timezone: string;
  weekday: WeekdayName;
  isClosed: boolean;
  courts: CalendarCourtColumn[];
  slots: CalendarTimeSlotRow[];
  pendingValidationCount: number;
  activeHoldCount: number;
}

export interface BuildDailyCalendarGridInput {
  tenantId: string;
  localDate: string;
  timezone?: string;
  slotDurationMinutes?: number;
  defaultPriceCop?: number;
  operatingHours: WeeklyOperatingHours | Record<string, unknown>;
  sports: readonly CalendarSportItem[];
  courts: readonly CalendarCourtItem[];
  bookings: readonly CalendarBookingItem[];
  referenceTime?: string | Date;
}

function resolveOperatingWindowMinutes(
  operatingHours: WeeklyOperatingHours | Record<string, unknown>,
  weekday: WeekdayName,
): { openMinutes: number; closeMinutes: number } | null {
  const rawWindow = (operatingHours as Record<string, unknown>)[weekday];
  if (!rawWindow || typeof rawWindow !== "object") {
    return null;
  }

  const candidate = rawWindow as Partial<DailyOperatingHoursWindow>;
  if (candidate.isClosed === true) {
    return null;
  }

  if (typeof candidate.open !== "string" || typeof candidate.close !== "string") {
    return null;
  }

  const openMinutes = parseWallClockTimeMinutes(candidate.open, false);
  const closeMinutes = parseWallClockTimeMinutes(candidate.close, true);
  if (closeMinutes <= openMinutes) {
    return null;
  }

  return { openMinutes, closeMinutes };
}

function resolveVisualState(
  booking: CalendarBookingItem,
  referenceTime?: string | Date,
): CalendarCellVisualState | null {
  switch (booking.status) {
    case "CANCELLED":
    case "RESCHEDULED":
      return null;
    case "HOLD":
      if (booking.hasPendingDepositValidation) {
        return "PENDING_VALIDATION";
      }
      return isBookingBlockingAt(booking, referenceTime) ? "HOLD" : null;
    case "CONFIRMED":
    case "COMPLETED":
    case "NO_SHOW":
      return booking.status;
  }
}

/**
 * Formats an instant (`Date`) as a `YYYY-MM-DD` calendar date in the target IANA timezone.
 */
export function formatLocalDateInTimezone(
  date: Date = new Date(),
  timezone: string = DEFAULT_TIMEZONE,
): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

/**
 * Shifts a `YYYY-MM-DD` calendar date by `deltaDays` without timezone drift.
 */
export function shiftLocalDate(localDate: string, deltaDays: number): string {
  if (!Number.isInteger(deltaDays)) {
    throw new Error("deltaDays must be an integer");
  }
  const { localDate: validated } = getLocalDateUtcBounds(localDate, DEFAULT_TIMEZONE);
  const [yearStr, monthStr, dayStr] = validated.split("-");
  const utc = Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr) + deltaDays);
  const shifted = new Date(utc);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Builds the daily operational calendar grid for a tenant: time slots in `America/Bogota`
 * (or the tenant's IANA timezone) mapped to active courts and visual booking states.
 */
export function buildDailyCalendarGrid(input: BuildDailyCalendarGridInput): DailyCalendarGrid {
  const timezone = input.timezone ?? DEFAULT_TIMEZONE;
  const slotDurationMinutes = input.slotDurationMinutes ?? DEFAULT_SLOT_MINUTES;
  const defaultPriceCop = input.defaultPriceCop ?? DEFAULT_HOURLY_PRICE_COP;

  if (!Number.isInteger(slotDurationMinutes) || slotDurationMinutes <= 0) {
    throw new Error("slotDurationMinutes must be a positive integer");
  }
  if (!Number.isInteger(defaultPriceCop) || defaultPriceCop <= 0) {
    throw new Error("defaultPriceCop must be a positive integer in COP");
  }

  const { weekday } = getLocalDateUtcBounds(input.localDate, timezone);
  const windowMinutes = resolveOperatingWindowMinutes(input.operatingHours, weekday);

  const sportsById = new Map<string, CalendarSportItem>();
  for (const sport of input.sports) {
    if (sport.is_active !== false) {
      sportsById.set(sport.id, sport);
    }
  }

  const activeCourts: CalendarCourtColumn[] = input.courts
    .filter((court) => court.tenant_id === input.tenantId && court.is_active !== false)
    .map((court) => {
      const sport = sportsById.get(court.sport_id);
      return {
        id: court.id,
        name: court.name,
        sportId: court.sport_id,
        sportCode: sport?.code ?? "padel",
        sportName: sport?.name ?? "Cancha",
        displayOrder: court.display_order,
      };
    })
    .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name, "es"));

  if (!windowMinutes) {
    return {
      tenantId: input.tenantId,
      localDate: input.localDate,
      timezone,
      weekday,
      isClosed: true,
      courts: activeCourts,
      slots: [],
      pendingValidationCount: 0,
      activeHoldCount: 0,
    };
  }

  const tenantBookings = input.bookings.filter((b) => b.tenant_id === input.tenantId);
  const slots: CalendarTimeSlotRow[] = [];
  const countedPendingIds = new Set<string>();
  const countedHoldIds = new Set<string>();

  for (
    let startMin = windowMinutes.openMinutes;
    startMin + slotDurationMinutes <= windowMinutes.closeMinutes;
    startMin += slotDurationMinutes
  ) {
    const endMin = startMin + slotDurationMinutes;
    const localStartTime = formatMinutesAsWallClockTime(startMin);
    const localEndTime = formatMinutesAsWallClockTime(endMin);
    const startsAtUtc = localDateTimeToUtcIso(input.localDate, localStartTime, timezone);
    const endsAtUtc = localDateTimeToUtcIso(input.localDate, localEndTime, timezone);

    const cellsByCourtId: Record<string, CalendarCell> = {};

    for (const court of activeCourts) {
      let matchedCell: CalendarCell | null = null;

      for (const booking of tenantBookings) {
        if (booking.court_id !== court.id) {
          continue;
        }
        if (!doTimeRangesOverlap(booking.starts_at, booking.ends_at, startsAtUtc, endsAtUtc)) {
          continue;
        }

        const visualState = resolveVisualState(booking, input.referenceTime);
        if (!visualState) {
          continue;
        }

        if (visualState === "PENDING_VALIDATION") {
          countedPendingIds.add(booking.id);
        } else if (visualState === "HOLD") {
          countedHoldIds.add(booking.id);
        }

        matchedCell = {
          courtId: court.id,
          visualState,
          priceCop: booking.total_price_cop,
          booking: {
            id: booking.id,
            status: booking.status,
            startsAtUtc: booking.starts_at,
            endsAtUtc: booking.ends_at,
            holdExpiresAtUtc: booking.hold_expires_at,
            totalPriceCop: booking.total_price_cop,
            depositRequiredCop: booking.deposit_required_cop,
            balanceDueCop: booking.balance_due_cop,
            customerName: booking.customerName ?? null,
            hasPendingDepositValidation: Boolean(booking.hasPendingDepositValidation),
            balancePaymentMethod: booking.balancePaymentMethod ?? null,
          },
        };
        break;
      }

      cellsByCourtId[court.id] = matchedCell ?? {
        courtId: court.id,
        visualState: "FREE",
        priceCop: defaultPriceCop,
        booking: null,
      };
    }

    slots.push({
      localDate: input.localDate,
      localStartTime,
      localEndTime,
      startsAtUtc,
      endsAtUtc,
      cellsByCourtId,
    });
  }

  return {
    tenantId: input.tenantId,
    localDate: input.localDate,
    timezone,
    weekday,
    isClosed: false,
    courts: activeCourts,
    slots,
    pendingValidationCount: countedPendingIds.size,
    activeHoldCount: countedHoldIds.size,
  };
}
