import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEPOSIT_PERCENT,
  DEFAULT_HOLD_MINUTES,
  DEFAULT_HOURLY_PRICE_COP,
  DEFAULT_SLOT_MINUTES,
  DEFAULT_TIMEZONE,
  calculateDepositCop,
} from "./index";

describe("@canchaya/core base domain rules", () => {
  it("exposes default pilot constants", () => {
    expect(DEFAULT_TIMEZONE).toBe("America/Bogota");
    expect(DEFAULT_SLOT_MINUTES).toBe(60);
    expect(DEFAULT_HOLD_MINUTES).toBe(15);
    expect(DEFAULT_HOURLY_PRICE_COP).toBe(60_000);
    expect(DEFAULT_DEPOSIT_PERCENT).toBe(20);
  });

  it("calculates integer COP deposit (20% of 60,000 COP = 12,000 COP)", () => {
    expect(calculateDepositCop(DEFAULT_HOURLY_PRICE_COP)).toBe(12_000);
    expect(Number.isInteger(calculateDepositCop(DEFAULT_HOURLY_PRICE_COP))).toBe(true);
  });

  it("rejects non-integer or invalid COP values", () => {
    expect(() => calculateDepositCop(60000.5)).toThrow(/positive integer/);
    expect(() => calculateDepositCop(0)).toThrow(/positive integer/);
    expect(() => calculateDepositCop(60_000, 120)).toThrow(/between 0 and 100/);
  });
});

