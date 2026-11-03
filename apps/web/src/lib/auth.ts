import {
  type AuthenticatedTenantUserContext,
  type RolePermission,
  type UserRecord,
  assertRolePermission,
  getRolePermissions,
  resolveAuthenticatedUserContext,
} from "@canchaya/core";
import { type PublicSupabaseEnv, getPublicSupabaseEnv } from "./env";

export const ACCESS_TOKEN_COOKIE_NAME = "cy_access_token" as const;
export const REFRESH_TOKEN_COOKIE_NAME = "cy_refresh_token" as const;

export interface AuthSessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface SignInResult {
  session: AuthSessionTokens;
  user: AuthenticatedTenantUserContext;
  permissions: readonly RolePermission[];
}

export class InvalidCredentialsError extends Error {
  readonly code = "AUTH_INVALID_CREDENTIALS" as const;
  readonly status = 401 as const;

  constructor(message = "Invalid login credentials") {
    super(message);
    this.name = "InvalidCredentialsError";
  }
}

export class UnauthenticatedError extends Error {
  readonly code = "AUTH_UNAUTHENTICATED" as const;
  readonly status = 401 as const;

  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

interface SupabaseTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: {
    id?: string;
  };
}

interface SupabaseAuthUserResponse {
  id?: string;
}

type PublicUserProfileRow = Pick<UserRecord, "id" | "tenant_id" | "role" | "is_active">;

async function fetchTenantUserProfile(params: {
  supabaseConfig: PublicSupabaseEnv;
  accessToken: string;
  userId: string;
  fetchImpl: typeof fetch;
}): Promise<PublicUserProfileRow | null> {
  const { supabaseConfig, accessToken, userId, fetchImpl } = params;
  const queryUrl = new URL(`${supabaseConfig.supabaseUrl}/rest/v1/users`);
  queryUrl.searchParams.set("select", "id,tenant_id,role,is_active");
  queryUrl.searchParams.set("id", `eq.${userId}`);
  queryUrl.searchParams.set("limit", "1");

  const profileRes = await fetchImpl(queryUrl.toString(), {
    method: "GET",
    headers: {
      apikey: supabaseConfig.supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!profileRes.ok) {
    return null;
  }

  const rows = (await profileRes.json()) as PublicUserProfileRow[];
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return rows[0] ?? null;
}

/**
 * Authenticates a user with email and password against Supabase Auth and resolves
 * their tenant-scoped role profile from `public.users` under Row Level Security.
 * Never logs or exposes tokens, passwords, emails, names, or phone numbers.
 */
export async function signInWithPassword(params: {
  email: string;
  password: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<SignInResult> {
  const email = params.email?.trim() ?? "";
  const password = params.password ?? "";
  const fetchImpl = params.fetchImpl ?? fetch;

  if (!email || !email.includes("@") || !password) {
    throw new InvalidCredentialsError();
  }

  const supabaseConfig = getPublicSupabaseEnv(params.env);
  const tokenRes = await fetchImpl(
    `${supabaseConfig.supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: supabaseConfig.supabaseAnonKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    },
  );

  if (!tokenRes.ok) {
    throw new InvalidCredentialsError();
  }

  const tokenPayload = (await tokenRes.json()) as SupabaseTokenResponse;
  const accessToken = tokenPayload.access_token?.trim();
  const refreshToken = tokenPayload.refresh_token?.trim() ?? "";
  const expiresIn =
    typeof tokenPayload.expires_in === "number" && tokenPayload.expires_in > 0
      ? tokenPayload.expires_in
      : 3600;
  const authUserId = tokenPayload.user?.id?.trim();

  if (!accessToken || !authUserId) {
    throw new InvalidCredentialsError();
  }

  const profile = await fetchTenantUserProfile({
    supabaseConfig,
    accessToken,
    userId: authUserId,
    fetchImpl,
  });

  const user = resolveAuthenticatedUserContext(authUserId, profile);

  return {
    session: {
      accessToken,
      refreshToken,
      expiresIn,
    },
    user,
    permissions: getRolePermissions(user.role),
  };
}

/**
 * Verifies a bearer/session access token with Supabase Auth and loads the active
 * `public.users` tenant role context.
 */
export async function getAuthenticatedUserFromToken(params: {
  accessToken: string | null | undefined;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<AuthenticatedTenantUserContext> {
  const accessToken = params.accessToken?.trim();
  if (!accessToken) {
    throw new UnauthenticatedError();
  }

  const fetchImpl = params.fetchImpl ?? fetch;
  const supabaseConfig = getPublicSupabaseEnv(params.env);

  const userRes = await fetchImpl(`${supabaseConfig.supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: supabaseConfig.supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!userRes.ok) {
    throw new UnauthenticatedError();
  }

  const authUser = (await userRes.json()) as SupabaseAuthUserResponse;
  const authUserId = authUser.id?.trim();
  if (!authUserId) {
    throw new UnauthenticatedError();
  }

  const profile = await fetchTenantUserProfile({
    supabaseConfig,
    accessToken,
    userId: authUserId,
    fetchImpl,
  });

  return resolveAuthenticatedUserContext(authUserId, profile);
}

/**
 * Revokes the current session in Supabase Auth.
 */
export async function signOutWithToken(params: {
  accessToken: string | null | undefined;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const accessToken = params.accessToken?.trim();
  if (!accessToken) {
    return;
  }

  const fetchImpl = params.fetchImpl ?? fetch;
  const supabaseConfig = getPublicSupabaseEnv(params.env);

  await fetchImpl(`${supabaseConfig.supabaseUrl}/auth/v1/logout`, {
    method: "POST",
    headers: {
      apikey: supabaseConfig.supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });
}

/**
 * Enforces that a request has an authenticated active tenant user and that their
 * role grants `requiredPermission`.
 */
export function requireRoleForUser(
  user: AuthenticatedTenantUserContext | null | undefined,
  requiredPermission: RolePermission,
): AuthenticatedTenantUserContext {
  if (!user) {
    throw new UnauthenticatedError();
  }
  assertRolePermission(user, requiredPermission);
  return user;
}

export function buildAuthCookieOptions(params: {
  maxAgeSeconds: number;
  env?: Record<string, string | undefined>;
}) {
  const config = getPublicSupabaseEnv(params.env);
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.appEnv !== "development",
    path: "/",
    maxAge: params.maxAgeSeconds,
  };
}

