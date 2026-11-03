import {
  InactiveOrMissingUserProfileError,
  OWNER_ONLY_PERMISSIONS,
  RolePermissionDeniedError,
  STAFF_PERMISSIONS,
} from "@canchaya/core";
import { describe, expect, it, vi } from "vitest";
import {
  InvalidCredentialsError,
  UnauthenticatedError,
  buildAuthCookieOptions,
  getAuthenticatedUserFromToken,
  requireRoleForUser,
  signInWithPassword,
  signOutWithToken,
} from "./auth";

const TEST_ENV = {
  NEXT_PUBLIC_APP_ENV: "staging",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
};

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STAFF_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("CY-019 authentication & role authorization (apps/web)", () => {
  it("authenticates an owner and returns full permissions", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/v1/token")) {
        return new Response(
          JSON.stringify({
            access_token: "jwt-owner-token",
            refresh_token: "refresh-owner-token",
            expires_in: 3600,
            user: { id: OWNER_ID },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/rest/v1/users")) {
        return new Response(
          JSON.stringify([
            {
              id: OWNER_ID,
              tenant_id: TENANT_ID,
              role: "owner",
              is_active: true,
            },
          ]),
          { status: 200 },
        );
      }
      return new Response("Not Found", { status: 404 });
    });

    const result = await signInWithPassword({
      email: "dueno@canchaya.co",
      password: "valid-password",
      env: TEST_ENV,
      fetchImpl: fetchMock,
    });

    expect(result.user).toEqual({
      userId: OWNER_ID,
      tenantId: TENANT_ID,
      role: "owner",
      isActive: true,
    });
    expect(result.permissions).toEqual([...STAFF_PERMISSIONS, ...OWNER_ONLY_PERMISSIONS]);
    expect(result.session.accessToken).toBe("jwt-owner-token");
  });

  it("authenticates a staff member with operational permissions only", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/v1/token")) {
        return new Response(
          JSON.stringify({
            access_token: "jwt-staff-token",
            refresh_token: "refresh-staff-token",
            expires_in: 3600,
            user: { id: STAFF_ID },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/rest/v1/users")) {
        return new Response(
          JSON.stringify([
            {
              id: STAFF_ID,
              tenant_id: TENANT_ID,
              role: "staff",
              is_active: true,
            },
          ]),
          { status: 200 },
        );
      }
      return new Response("Not Found", { status: 404 });
    });

    const result = await signInWithPassword({
      email: "empleado@canchaya.co",
      password: "valid-password",
      env: TEST_ENV,
      fetchImpl: fetchMock,
    });

    expect(result.user.role).toBe("staff");
    expect(result.permissions).toEqual(STAFF_PERMISSIONS);

    // Staff can access calendar and bookings, but not financial reports or config
    expect(() => requireRoleForUser(result.user, "bookings:manage")).not.toThrow();
    expect(() => requireRoleForUser(result.user, "deposits:validate")).not.toThrow();
    expect(() => requireRoleForUser(result.user, "reports:view_financial")).toThrow(
      RolePermissionDeniedError,
    );
    expect(() => requireRoleForUser(result.user, "tenant:configure")).toThrow(
      RolePermissionDeniedError,
    );
  });

  it("rejects invalid credentials without leaking email or password in error messages", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    });

    await expect(
      signInWithPassword({
        email: "secreto@canchaya.co",
        password: "mi-clave-super-secreta",
        env: TEST_ENV,
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow(InvalidCredentialsError);

    try {
      await signInWithPassword({
        email: "secreto@canchaya.co",
        password: "mi-clave-super-secreta",
        env: TEST_ENV,
        fetchImpl: fetchMock,
      });
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain("secreto@canchaya.co");
      expect(message).not.toContain("mi-clave-super-secreta");
    }
  });

  it("rejects login when user is authenticated in Supabase Auth but inactive in public.users", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/v1/token")) {
        return new Response(
          JSON.stringify({
            access_token: "jwt-inactive-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
            user: { id: STAFF_ID },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify([
          {
            id: STAFF_ID,
            tenant_id: TENANT_ID,
            role: "staff",
            is_active: false,
          },
        ]),
        { status: 200 },
      );
    });

    await expect(
      signInWithPassword({
        email: "inactivo@canchaya.co",
        password: "valid-password",
        env: TEST_ENV,
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow(InactiveOrMissingUserProfileError);
  });

  it("resolves user from bearer token and rejects missing/expired tokens", async () => {
    await expect(
      getAuthenticatedUserFromToken({ accessToken: "", env: TEST_ENV }),
    ).rejects.toThrow(UnauthenticatedError);

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: OWNER_ID }), { status: 200 });
      }
      return new Response(
        JSON.stringify([
          {
            id: OWNER_ID,
            tenant_id: TENANT_ID,
            role: "owner",
            is_active: true,
          },
        ]),
        { status: 200 },
      );
    });

    const user = await getAuthenticatedUserFromToken({
      accessToken: "valid-jwt",
      env: TEST_ENV,
      fetchImpl: fetchMock,
    });

    expect(user).toEqual({
      userId: OWNER_ID,
      tenantId: TENANT_ID,
      role: "owner",
      isActive: true,
    });
  });

  it("builds secure HttpOnly cookie options and invokes Supabase logout", async () => {
    const stagingCookies = buildAuthCookieOptions({ maxAgeSeconds: 3600, env: TEST_ENV });
    expect(stagingCookies).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 3600,
    });

    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    await signOutWithToken({
      accessToken: "valid-jwt",
      env: TEST_ENV,
      fetchImpl: fetchMock,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

