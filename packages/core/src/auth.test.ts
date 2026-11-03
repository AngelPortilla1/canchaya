import { describe, expect, it } from "vitest";
import {
  ALL_ROLE_PERMISSIONS,
  InactiveOrMissingUserProfileError,
  OWNER_ONLY_PERMISSIONS,
  ROLE_LABELS_ES,
  RolePermissionDeniedError,
  STAFF_PERMISSIONS,
  assertRolePermission,
  canAccessPanelPath,
  getRequiredPermissionForPath,
  getRolePermissions,
  hasRolePermission,
  isValidUserRole,
  resolveAuthenticatedUserContext,
} from "./auth";
import type { AuthenticatedTenantUserContext } from "./schema";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STAFF_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const ownerContext: AuthenticatedTenantUserContext = {
  userId: OWNER_ID,
  tenantId: TENANT_ID,
  role: "owner",
  isActive: true,
};

const staffContext: AuthenticatedTenantUserContext = {
  userId: STAFF_ID,
  tenantId: TENANT_ID,
  role: "staff",
  isActive: true,
};

describe("CY-019 role and permission model (@canchaya/core)", () => {
  it("validates supported roles and Spanish labels", () => {
    expect(isValidUserRole("owner")).toBe(true);
    expect(isValidUserRole("staff")).toBe(true);
    expect(isValidUserRole("admin")).toBe(false);
    expect(isValidUserRole(null)).toBe(false);

    expect(ROLE_LABELS_ES.owner).toBe("Dueño");
    expect(ROLE_LABELS_ES.staff).toBe("Empleado");
  });

  it("grants owner all permissions (daily operation + config + users + financial reports)", () => {
    expect(getRolePermissions("owner")).toEqual(ALL_ROLE_PERMISSIONS);
    for (const permission of ALL_ROLE_PERMISSIONS) {
      expect(hasRolePermission(ownerContext, permission)).toBe(true);
      expect(() => assertRolePermission(ownerContext, permission)).not.toThrow();
    }
  });

  it("grants staff daily operational permissions and denies config, user management, and financial reports", () => {
    expect(getRolePermissions("staff")).toEqual(STAFF_PERMISSIONS);

    for (const permission of STAFF_PERMISSIONS) {
      expect(hasRolePermission(staffContext, permission)).toBe(true);
      expect(() => assertRolePermission(staffContext, permission)).not.toThrow();
    }

    for (const restrictedPermission of OWNER_ONLY_PERMISSIONS) {
      expect(hasRolePermission(staffContext, restrictedPermission)).toBe(false);
      expect(() => assertRolePermission(staffContext, restrictedPermission)).toThrow(
        RolePermissionDeniedError,
      );
    }
  });

  it("denies all permissions when user context is null, missing tenantId, or inactive", () => {
    const inactiveOwner: AuthenticatedTenantUserContext = {
      ...ownerContext,
      isActive: false,
    };

    for (const permission of ALL_ROLE_PERMISSIONS) {
      expect(hasRolePermission(null, permission)).toBe(false);
      expect(hasRolePermission(undefined, permission)).toBe(false);
      expect(hasRolePermission(inactiveOwner, permission)).toBe(false);
      expect(
        hasRolePermission({ ...ownerContext, tenantId: "   " }, permission),
      ).toBe(false);
    }
  });

  it("resolves AuthenticatedTenantUserContext from authUserId and active public.users profile", () => {
    const context = resolveAuthenticatedUserContext(OWNER_ID, {
      id: OWNER_ID,
      tenant_id: TENANT_ID,
      role: "owner",
      is_active: true,
    });

    expect(context).toEqual({
      userId: OWNER_ID,
      tenantId: TENANT_ID,
      role: "owner",
      isActive: true,
    });
  });

  it("rejects missing, mismatched, or inactive public.users profiles", () => {
    expect(() => resolveAuthenticatedUserContext(OWNER_ID, null)).toThrow(
      InactiveOrMissingUserProfileError,
    );

    expect(() =>
      resolveAuthenticatedUserContext(OWNER_ID, {
        id: STAFF_ID,
        tenant_id: TENANT_ID,
        role: "owner",
        is_active: true,
      }),
    ).toThrow(InactiveOrMissingUserProfileError);

    expect(() =>
      resolveAuthenticatedUserContext(STAFF_ID, {
        id: STAFF_ID,
        tenant_id: TENANT_ID,
        role: "staff",
        is_active: false,
      }),
    ).toThrow(InactiveOrMissingUserProfileError);
  });

  it("enforces panel route permissions for owner vs staff", () => {
    expect(getRequiredPermissionForPath("/panel")).toBe("calendar:view");
    expect(getRequiredPermissionForPath("/panel/calendario")).toBe("calendar:view");
    expect(getRequiredPermissionForPath("/panel/reservas/nueva")).toBe("bookings:manage");
    expect(getRequiredPermissionForPath("/panel/anticipos")).toBe("deposits:validate");
    expect(getRequiredPermissionForPath("/panel/configuracion")).toBe("tenant:configure");
    expect(getRequiredPermissionForPath("/panel/reportes")).toBe("reports:view_financial");
    expect(getRequiredPermissionForPath("/panel/caja")).toBe("reports:view_financial");
    expect(getRequiredPermissionForPath("/login")).toBeNull();

    // Staff can access operational routes
    expect(canAccessPanelPath(staffContext, "/panel")).toBe(true);
    expect(canAccessPanelPath(staffContext, "/panel/calendario")).toBe(true);
    expect(canAccessPanelPath(staffContext, "/panel/reservas")).toBe(true);
    expect(canAccessPanelPath(staffContext, "/panel/anticipos")).toBe(true);
    expect(canAccessPanelPath(staffContext, "/panel/clientes")).toBe(true);

    // Staff cannot access owner-only routes
    expect(canAccessPanelPath(staffContext, "/panel/configuracion")).toBe(false);
    expect(canAccessPanelPath(staffContext, "/panel/usuarios")).toBe(false);
    expect(canAccessPanelPath(staffContext, "/panel/reportes")).toBe(false);
    expect(canAccessPanelPath(staffContext, "/panel/caja")).toBe(false);

    // Owner can access all panel routes
    expect(canAccessPanelPath(ownerContext, "/panel/configuracion")).toBe(true);
    expect(canAccessPanelPath(ownerContext, "/panel/usuarios")).toBe(true);
    expect(canAccessPanelPath(ownerContext, "/panel/reportes")).toBe(true);
    expect(canAccessPanelPath(ownerContext, "/panel/caja")).toBe(true);
  });
});

