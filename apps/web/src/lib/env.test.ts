import { describe, expect, it } from "vitest";
import {
  getPublicSupabaseEnv,
  getServerSupabaseEnv,
  getWhatsAppServerEnv,
  normalizeSupabaseUrl,
  parseAppEnvironment,
} from "./env";

describe("normalizeSupabaseUrl", () => {
  it("keeps a clean base URL unchanged", () => {
    expect(normalizeSupabaseUrl("https://example.supabase.co")).toBe("https://example.supabase.co");
  });

  it("strips trailing slashes and accidental /rest/v1 suffix", () => {
    expect(normalizeSupabaseUrl("  https://example.supabase.co/rest/v1/  ")).toBe(
      "https://example.supabase.co",
    );
  });

  it("throws on invalid URLs", () => {
    expect(() => normalizeSupabaseUrl("not-a-url")).toThrow(/Invalid NEXT_PUBLIC_SUPABASE_URL/);
  });
});

describe("parseAppEnvironment", () => {
  it("defaults to development when omitted", () => {
    expect(parseAppEnvironment(undefined)).toBe("development");
  });

  it("accepts development, staging, and production", () => {
    expect(parseAppEnvironment("staging")).toBe("staging");
    expect(parseAppEnvironment("production")).toBe("production");
  });

  it("rejects unknown environments", () => {
    expect(() => parseAppEnvironment("qa")).toThrow(/Invalid NEXT_PUBLIC_APP_ENV/);
  });
});

describe("getPublicSupabaseEnv & getServerSupabaseEnv", () => {
  const validEnv = {
    NEXT_PUBLIC_APP_ENV: "staging",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co/rest/v1/",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: " test-anon-key ",
    SUPABASE_SERVICE_ROLE_KEY: " test-service-role-key ",
    SUPABASE_PROJECT_ID: " example-ref ",
  };

  it("parses and trims public and server variables", () => {
    const serverEnv = getServerSupabaseEnv(validEnv);
    expect(serverEnv).toEqual({
      appEnv: "staging",
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "test-anon-key",
      supabaseServiceRoleKey: "test-service-role-key",
      supabaseProjectId: "example-ref",
    });
  });

  it("throws when a required variable is missing without leaking values", () => {
    expect(() =>
      getPublicSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      }),
    ).toThrow("Missing required environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY");

    expect(() =>
      getServerSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      }),
    ).toThrow("Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY");
  });
});

describe("getWhatsAppServerEnv", () => {
  it("returns trimmed WhatsApp credentials when all variables are present", () => {
    const result = getWhatsAppServerEnv({
      WHATSAPP_PHONE_NUMBER_ID: " 12345 ",
      WHATSAPP_ACCESS_TOKEN: " token ",
      WHATSAPP_APP_SECRET: " secret ",
      WHATSAPP_VERIFY_TOKEN: " verify ",
    });

    expect(result).toEqual({
      phoneNumberId: "12345",
      accessToken: "token",
      appSecret: "secret",
      verifyToken: "verify",
    });
  });

  it("throws when a WhatsApp variable is missing", () => {
    expect(() => getWhatsAppServerEnv({})).toThrow(
      "Missing required environment variable: WHATSAPP_PHONE_NUMBER_ID",
    );
  });
});
