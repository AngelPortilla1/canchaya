export type AppEnvironment = "development" | "staging" | "production";

export interface PublicSupabaseEnv {
  appEnv: AppEnvironment;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export interface ServerSupabaseEnv extends PublicSupabaseEnv {
  supabaseServiceRoleKey: string;
  supabaseProjectId?: string;
}

export interface WhatsAppServerEnv {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
}

const VALID_APP_ENVS: readonly AppEnvironment[] = ["development", "staging", "production"];

function readRequiredVar(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Normalizes a Supabase project URL by trimming whitespace, removing trailing
 * slashes, and stripping an accidental `/rest/v1` suffix if copied from the
 * Data API settings page.
 */
export function normalizeSupabaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid NEXT_PUBLIC_SUPABASE_URL: must be a valid HTTP/HTTPS URL");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Invalid NEXT_PUBLIC_SUPABASE_URL: protocol must be http or https");
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");

  return `${parsed.origin}${normalizedPath}`;
}

export function parseAppEnvironment(rawEnv?: string): AppEnvironment {
  const normalized = rawEnv?.trim() || "development";
  if ((VALID_APP_ENVS as readonly string[]).includes(normalized)) {
    return normalized as AppEnvironment;
  }
  throw new Error(`Invalid NEXT_PUBLIC_APP_ENV: expected one of ${VALID_APP_ENVS.join(", ")}`);
}

/**
 * Returns the public Supabase configuration safe to use in client and server.
 */
export function getPublicSupabaseEnv(
  env: Record<string, string | undefined> = process.env,
): PublicSupabaseEnv {
  const appEnv = parseAppEnvironment(env.NEXT_PUBLIC_APP_ENV);
  const rawUrl = readRequiredVar(env, "NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = readRequiredVar(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return {
    appEnv,
    supabaseUrl: normalizeSupabaseUrl(rawUrl),
    supabaseAnonKey,
  };
}

/**
 * Returns the privileged Supabase configuration for server-only contexts.
 * Never call this function from client components.
 */
export function getServerSupabaseEnv(
  env: Record<string, string | undefined> = process.env,
): ServerSupabaseEnv {
  if (typeof window !== "undefined") {
    throw new Error("getServerSupabaseEnv must only be called on the server");
  }

  const publicEnv = getPublicSupabaseEnv(env);
  const supabaseServiceRoleKey = readRequiredVar(env, "SUPABASE_SERVICE_ROLE_KEY");
  const supabaseProjectId = env.SUPABASE_PROJECT_ID?.trim() || undefined;

  return {
    ...publicEnv,
    supabaseServiceRoleKey,
    supabaseProjectId,
  };
}

/**
 * Returns the Meta WhatsApp Cloud API credentials for server-only webhook and
 * messaging handlers.
 */
export function getWhatsAppServerEnv(
  env: Record<string, string | undefined> = process.env,
): WhatsAppServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("getWhatsAppServerEnv must only be called on the server");
  }

  return {
    phoneNumberId: readRequiredVar(env, "WHATSAPP_PHONE_NUMBER_ID"),
    accessToken: readRequiredVar(env, "WHATSAPP_ACCESS_TOKEN"),
    appSecret: readRequiredVar(env, "WHATSAPP_APP_SECRET"),
    verifyToken: readRequiredVar(env, "WHATSAPP_VERIFY_TOKEN"),
  };
}
