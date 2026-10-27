export const DEFAULT_TIMEZONE = "America/Bogota" as const;
export const DEFAULT_SLOT_MINUTES = 60 as const;
export const DEFAULT_HOLD_MINUTES = 15 as const;
export const DEFAULT_HOURLY_PRICE_COP = 60_000 as const;
export const DEFAULT_DEPOSIT_PERCENT = 20 as const;

export type SportCode = "padel" | "futbol_5";

export type BookingStatus =
  | "HOLD"
  | "CONFIRMED"
  | "COMPLETED"
  | "NO_SHOW"
  | "CANCELLED"
  | "RESCHEDULED";

/**
 * Calculates the deposit amount in integer Colombian Pesos (COP).
 * Throws an error if priceCop is not a positive integer or depositPercent is out of range.
 */
export function calculateDepositCop(
  priceCop: number,
  depositPercent: number = DEFAULT_DEPOSIT_PERCENT,
): number {
  if (!Number.isInteger(priceCop) || priceCop <= 0) {
    throw new Error("priceCop must be a positive integer in COP");
  }
  if (!Number.isInteger(depositPercent) || depositPercent < 0 || depositPercent > 100) {
    throw new Error("depositPercent must be an integer between 0 and 100");
  }
  return Math.round((priceCop * depositPercent) / 100);
}

