import {
  DEFAULT_SLOT_MINUTES,
  DEFAULT_TIMEZONE,
  type BookingStatus,
  type SportCode,
} from "./index";
import { doTimeRangesOverlap, isBlockingBookingStatus } from "./schema";

export const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type WeekdayName = (typeof WEEKDAY_NAMES)[number];

export interface DailyOperatingHoursWindow {
  open: string;
  close: string;
  isClosed?: boolean;
}

export type WeeklyOperatingHours = Partial<
  Record<WeekdayName, DailyOperatingHoursWindow | null>
>;

export const DEFAULT_PILOT_OPERATING_HOURS: Readonly<
  Record<WeekdayName, DailyOperatingHoursWindow>
> = {
  monday: { open: "14:00", close: "24:00" },
  tuesday: { open: "14:00", close: "24:00" },
  wednesday: { open: "14:00", close: "24:00" },
  thursday: { open: "14:00", close: "24:00" },
  friday: { open: "14:00", close: "24:00" },
  saturday: { open: "14:00", close: "24:00" },
  sunday: { open: "14:00", close: "24:00" },
};

export interface CourtAvailabilityItem {
  id: string;
  tenant_id: string;
  sport_id?: string;
  sportCode?: SportCode;
  name: string;
  display_order?: number;
  displayOrder?: number;
  is_active?: boolean;
}

export interface BookingAvailabilityCandidate {
  id?: string;
  tenant_id: string;
  court_id: string;
  status: BookingStatus;
  starts_at: string;
  ends_at: string;
  hold_expires_at?: string | null;
}

export interface AvailableCourtSummary {
  id: string;
  name: string;
  displayOrder: number;
}

export interface AvailabilitySlot {
  localDate: string;
  localStartTime: string;
  localEndTime: string;
  startsAtUtc: string;
  endsAtUtc: string;
  availableCourts: AvailableCourtSummary[];
  occupiedCourtIds: string[];
  isAvailable: boolean;
}

export interface GetAvailableSlotsInput {
  tenantId: string;
  sport: SportCode | string;
  localDate: string;
  timezone?: string;
  slotDurationMinutes?: number;
  operatingHours: WeeklyOperatingHours | Record<string, unknown>;
  courts: readonly CourtAvailabilityItem[];
  bookings: readonly BookingAvailabilityCandidate[];
  referenceTime?: string | Date;
  onlyAvailable?: boolean;
}

export interface LocalDateUtcBounds {
  localDate: string;
  weekday: WeekdayName;
  startUtc: string;
  endUtc: string;
}

interface ParsedLocalDate {
  year: number;
  month: number;
  day: number;
  weekday: WeekdayName;
}

function parseLocalDate(localDate: string): ParsedLocalDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) {
    throw new Error(`Invalid localDate format "${localDate}". Expected YYYY-MM-DD`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date "${localDate}"`);
  }

  const weekdayIndex = probe.getUTCDay();
  const weekday = WEEKDAY_NAMES[weekdayIndex];
  if (!weekday) {
    throw new Error(`Unable to resolve weekday for "${localDate}"`);
  }

  return { year, month, day, weekday };
}

/**
 * Parses a 24-hour wall-clock time string (`HH:MM`) into minutes from midnight (`0..1440`).
 * `"24:00"` is allowed only when `allowEndOfDay24` is true.
 */
export function parseWallClockTimeMinutes(
  timeStr: string,
  allowEndOfDay24: boolean = false,
): number {
  const match = /^(\d{2}):(\d{2})$/.exec(timeStr);
  if (!match) {
    throw new Error(`Invalid wall-clock time "${timeStr}". Expected HH:MM`);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours === 24 && minutes === 0 && allowEndOfDay24) {
    return 1440;
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Out-of-range wall-clock time "${timeStr}"`);
  }

  return hours * 60 + minutes;
}

export function formatMinutesAsWallClockTime(totalMinutes: number): string {
  if (!Number.isInteger(totalMinutes) || totalMinutes < 0 || totalMinutes > 1440) {
    throw new Error(`Invalid minute offset ${totalMinutes} for wall-clock formatting`);
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function getTimezoneOffsetMs(utcMs: number, timeZone: string): number {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new Error(`Invalid IANA timezone "${timeZone}"`);
  }

  const parts = formatter.formatToParts(new Date(utcMs));
  const values: Record<string, number> = {};
  for (const part of parts) {
    if (
      part.type === "year" ||
      part.type === "month" ||
      part.type === "day" ||
      part.type === "hour" ||
      part.type === "minute" ||
      part.type === "second"
    ) {
      values[part.type] = Number(part.value);
    }
  }

  const localAsUtcMs = Date.UTC(
    values.year ?? 1970,
    (values.month ?? 1) - 1,
    values.day ?? 1,
    values.hour ?? 0,
    values.minute ?? 0,
    values.second ?? 0,
  );

  const truncatedUtcMs = Math.floor(utcMs / 1000) * 1000;
  return localAsUtcMs - truncatedUtcMs;
}

function localMinutesToUtcIso(
  parsedDate: ParsedLocalDate,
  minutesFromMidnight: number,
  timeZone: string,
): string {
  const targetLocalAsUtcMs = Date.UTC(
    parsedDate.year,
    parsedDate.month - 1,
    parsedDate.day,
    0,
    minutesFromMidnight,
    0,
    0,
  );

  const firstOffsetMs = getTimezoneOffsetMs(targetLocalAsUtcMs, timeZone);
  const firstGuessUtcMs = targetLocalAsUtcMs - firstOffsetMs;
  const secondOffsetMs = getTimezoneOffsetMs(firstGuessUtcMs, timeZone);
  const exactUtcMs = targetLocalAsUtcMs - secondOffsetMs;

  return new Date(exactUtcMs).toISOString();
}

/**
 * Converts a local date (`YYYY-MM-DD`) and 24h wall-clock time (`HH:MM`, including `"24:00"`)
 * in the given IANA timezone (default `America/Bogota`) to an exact UTC ISO-8601 timestamp.
 */
export function localDateTimeToUtcIso(
  localDate: string,
  localTime: string,
  timezone: string = DEFAULT_TIMEZONE,
): string {
  const parsedDate = parseLocalDate(localDate);
  const minutes = parseWallClockTimeMinutes(localTime, true);
  return localMinutesToUtcIso(parsedDate, minutes, timezone);
}

/**
 * Computes the half-open UTC interval `[startUtc, endUtc)` corresponding to an entire
 * local calendar day (`00:00` to `24:00`) in the tenant's IANA timezone (ADR-003).
 */
export function getLocalDateUtcBounds(
  localDate: string,
  timezone: string = DEFAULT_TIMEZONE,
): LocalDateUtcBounds {
  const parsedDate = parseLocalDate(localDate);
  return {
    localDate,
    weekday: parsedDate.weekday,
    startUtc: localMinutesToUtcIso(parsedDate, 0, timezone),
    endUtc: localMinutesToUtcIso(parsedDate, 1440, timezone),
  };
}

function parseReferenceTimeMs(referenceTime?: string | Date): number {
  if (referenceTime === undefined) {
    return Date.now();
  }
  const ms =
    referenceTime instanceof Date ? referenceTime.getTime() : Date.parse(referenceTime);
  if (Number.isNaN(ms)) {
    throw new Error("Invalid referenceTime timestamp");
  }
  return ms;
}

/**
 * Determines whether a booking blocks court availability at `referenceTime`.
 * - `CANCELLED` and `RESCHEDULED` bookings never block.
 * - `HOLD` bookings block only while `hold_expires_at > referenceTime`.
 *   Once `hold_expires_at <= referenceTime`, the hold is expired and the slot is treated as free.
 * - `CONFIRMED`, `COMPLETED`, and `NO_SHOW` bookings block their time range.
 */
export function isBookingBlockingAt(
  booking: Pick<BookingAvailabilityCandidate, "status" | "hold_expires_at">,
  referenceTime?: string | Date,
): boolean {
  if (!isBlockingBookingStatus(booking.status)) {
    return false;
  }

  if (booking.status === "HOLD") {
    if (!booking.hold_expires_at) {
      throw new Error("HOLD booking must include hold_expires_at timestamp");
    }
    const holdExpiresAtMs = Date.parse(booking.hold_expires_at);
    if (Number.isNaN(holdExpiresAtMs)) {
      throw new Error("Invalid ISO-8601 UTC timestamp in hold_expires_at");
    }
    const refMs = parseReferenceTimeMs(referenceTime);
    return holdExpiresAtMs > refMs;
  }

  return true;
}

function resolveDayOperatingWindow(
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
    throw new Error(
      `Invalid operating hours for ${weekday}: close "${candidate.close}" must be after open "${candidate.open}"`,
    );
  }

  return { openMinutes, closeMinutes };
}

function matchesRequestedSport(court: CourtAvailabilityItem, sport: SportCode | string): boolean {
  return court.sportCode === sport || court.sport_id === sport;
}

/**
 * Computes the hourly (or `slotDurationMinutes`) availability slots for a given tenant,
 * sport (`padel`, `futbol_5`, or `sport_id`), and local date (`YYYY-MM-DD`).
 *
 * Follows ADR-003:
 * - Projects local operating hours in `timezone` (`America/Bogota`) to exact UTC intervals,
 *   including evening slots that cross UTC midnight (`19:00`–`24:00` local = `00:00Z`–`05:00Z` next day).
 * - Treats `HOLD` bookings with `hold_expires_at <= referenceTime` as expired (free).
 */
export function getAvailableSlotsBySportAndDate(
  input: GetAvailableSlotsInput,
): AvailabilitySlot[] {
  const {
    tenantId,
    sport,
    localDate,
    timezone = DEFAULT_TIMEZONE,
    slotDurationMinutes = DEFAULT_SLOT_MINUTES,
    operatingHours,
    courts,
    bookings,
    referenceTime,
    onlyAvailable = false,
  } = input;

  if (!tenantId || tenantId.trim().length === 0) {
    throw new Error("tenantId is required");
  }
  if (!sport || String(sport).trim().length === 0) {
    throw new Error("sport is required");
  }
  if (!Number.isInteger(slotDurationMinutes) || slotDurationMinutes <= 0) {
    throw new Error("slotDurationMinutes must be a positive integer");
  }

  const parsedDate = parseLocalDate(localDate);
  const referenceMs = parseReferenceTimeMs(referenceTime);
  const operatingWindow = resolveDayOperatingWindow(operatingHours, parsedDate.weekday);

  if (!operatingWindow) {
    return [];
  }

  const activeSportCourts = courts
    .filter(
      (court) =>
        court.tenant_id === tenantId &&
        court.is_active !== false &&
        matchesRequestedSport(court, sport),
    )
    .sort((a, b) => {
      const orderA = a.displayOrder ?? a.display_order ?? 1;
      const orderB = b.displayOrder ?? b.display_order ?? 1;
      return orderA !== orderB ? orderA - orderB : a.name.localeCompare(b.name);
    });

  if (activeSportCourts.length === 0) {
    return [];
  }

  const activeCourtIds = new Set(activeSportCourts.map((court) => court.id));
  const blockingBookings = bookings.filter(
    (booking) =>
      booking.tenant_id === tenantId &&
      activeCourtIds.has(booking.court_id) &&
      isBookingBlockingAt(booking, new Date(referenceMs)),
  );

  const slots: AvailabilitySlot[] = [];
  const { openMinutes, closeMinutes } = operatingWindow;

  for (
    let slotStartMinutes = openMinutes;
    slotStartMinutes + slotDurationMinutes <= closeMinutes;
    slotStartMinutes += slotDurationMinutes
  ) {
    const slotEndMinutes = slotStartMinutes + slotDurationMinutes;
    const localStartTime = formatMinutesAsWallClockTime(slotStartMinutes);
    const localEndTime = formatMinutesAsWallClockTime(slotEndMinutes);
    const startsAtUtc = localMinutesToUtcIso(parsedDate, slotStartMinutes, timezone);
    const endsAtUtc = localMinutesToUtcIso(parsedDate, slotEndMinutes, timezone);

    const availableCourts: AvailableCourtSummary[] = [];
    const occupiedCourtIds: string[] = [];

    for (const court of activeSportCourts) {
      const isOccupied = blockingBookings.some(
        (booking) =>
          booking.court_id === court.id &&
          doTimeRangesOverlap(booking.starts_at, booking.ends_at, startsAtUtc, endsAtUtc),
      );

      if (isOccupied) {
        occupiedCourtIds.push(court.id);
      } else {
        availableCourts.push({
          id: court.id,
          name: court.name,
          displayOrder: court.displayOrder ?? court.display_order ?? 1,
        });
      }
    }

    const slot: AvailabilitySlot = {
      localDate,
      localStartTime,
      localEndTime,
      startsAtUtc,
      endsAtUtc,
      availableCourts,
      occupiedCourtIds,
      isAvailable: availableCourts.length > 0,
    };

    if (!onlyAvailable || slot.isAvailable) {
      slots.push(slot);
    }
  }

  return slots;
}

