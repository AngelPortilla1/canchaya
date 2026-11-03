import type { AuthenticatedTenantUserContext, UserRecord, UserRole } from "./schema";

export const USER_ROLES = ["owner", "staff"] as const satisfies readonly UserRole[];

export const STAFF_PERMISSIONS = [
  "calendar:view",
  "bookings:manage",
  "customers:manage",
  "deposits:validate",
  "payments:register_balance",
] as const;

export const OWNER_ONLY_PERMISSIONS = [
  "tenant:configure",
  "users:manage",
  "reports:view_financial",
] as const;

export const ALL_ROLE_PERMISSIONS = [...STAFF_PERMISSIONS, ...OWNER_ONLY_PERMISSIONS] as const;

export type RolePermission = (typeof ALL_ROLE_PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly RolePermission[]>> = {
  owner: ALL_ROLE_PERMISSIONS,
  staff: STAFF_PERMISSIONS,
};

export const ROLE_LABELS_ES: Readonly<Record<UserRole, string>> = {
  owner: "Dueño",
  staff: "Empleado",
};

export class RolePermissionDeniedError extends Error {
  readonly code = "AUTH_FORBIDDEN_ROLE" as const;
  readonly status = 403 as const;
  readonly requiredPermission: RolePermission;
  readonly role: UserRole | null;

  constructor(requiredPermission: RolePermission, role: UserRole | null = null) {
    super(`Insufficient permissions for action "${requiredPermission}"`);
    this.name = "RolePermissionDeniedError";
    this.requiredPermission = requiredPermission;
    this.role = role;
  }
}

export class InactiveOrMissingUserProfileError extends Error {
  readonly code = "AUTH_PROFILE_INACTIVE_OR_MISSING" as const;
  readonly status = 403 as const;

  constructor(message = "Authenticated user does not have an active tenant profile") {
    super(message);
    this.name = "InactiveOrMissingUserProfileError";
  }
}

export function isValidUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

export function getRolePermissions(role: UserRole): readonly RolePermission[] {
  if (!isValidUserRole(role)) {
    return [];
  }
  return ROLE_PERMISSIONS[role];
}

/**
 * Checks whether an authenticated user context has a specific permission.
 * Inactive users (`isActive === false`) or missing contexts never have permissions.
 */
export function hasRolePermission(
  user:
    | Pick<AuthenticatedTenantUserContext, "userId" | "tenantId" | "role" | "isActive">
    | null
    | undefined,
  permission: RolePermission,
): boolean {
  if (!user || !user.userId?.trim() || !user.tenantId?.trim() || user.isActive === false) {
    return false;
  }
  if (!isValidUserRole(user.role)) {
    return false;
  }
  return ROLE_PERMISSIONS[user.role].includes(permission);
}

/**
 * Enforces that an authenticated user context holds the required permission.
 * Throws `RolePermissionDeniedError` (HTTP 403) when unauthorized.
 */
export function assertRolePermission(
  user: AuthenticatedTenantUserContext | null | undefined,
  permission: RolePermission,
): void {
  if (!hasRolePermission(user, permission)) {
    throw new RolePermissionDeniedError(permission, user?.role ?? null);
  }
}

/**
 * Validates and resolves an `AuthenticatedTenantUserContext` from the Supabase Auth user ID
 * and the corresponding `public.users` row.
 * Never includes PII (names, phones, emails) or tokens in error messages.
 */
export function resolveAuthenticatedUserContext(
  authUserId: string,
  profile: Pick<UserRecord, "id" | "tenant_id" | "role" | "is_active"> | null | undefined,
): AuthenticatedTenantUserContext {
  const normalizedAuthId = authUserId?.trim();
  if (!normalizedAuthId) {
    throw new InactiveOrMissingUserProfileError("Missing authenticated user identifier");
  }

  if (!profile) {
    throw new InactiveOrMissingUserProfileError("User profile not found in public.users");
  }

  if (profile.id !== normalizedAuthId) {
    throw new InactiveOrMissingUserProfileError("User profile ID mismatch");
  }

  if (!profile.tenant_id?.trim()) {
    throw new InactiveOrMissingUserProfileError("User profile is missing tenant_id");
  }

  if (!isValidUserRole(profile.role)) {
    throw new InactiveOrMissingUserProfileError("User profile has an invalid role");
  }

  if (!profile.is_active) {
    throw new InactiveOrMissingUserProfileError("User profile is inactive");
  }

  return {
    userId: profile.id,
    tenantId: profile.tenant_id,
    role: profile.role,
    isActive: true,
  };
}

const ROUTE_PERMISSION_PREFIXES: readonly { prefix: string; permission: RolePermission }[] = [
  { prefix: "/panel/configuracion", permission: "tenant:configure" },
  { prefix: "/panel/usuarios", permission: "users:manage" },
  { prefix: "/panel/reportes", permission: "reports:view_financial" },
  { prefix: "/panel/caja", permission: "reports:view_financial" },
  { prefix: "/panel/anticipos", permission: "deposits:validate" },
  { prefix: "/panel/pagos", permission: "payments:register_balance" },
  { prefix: "/panel/reservas", permission: "bookings:manage" },
  { prefix: "/panel/clientes", permission: "customers:manage" },
  { prefix: "/panel/calendario", permission: "calendar:view" },
  { prefix: "/panel", permission: "calendar:view" },
];

/**
 * Resolves the required `RolePermission` for a given panel path, or `null` if the route
 * is not a protected panel route.
 */
export function getRequiredPermissionForPath(pathname: string): RolePermission | null {
  const normalized = pathname.trim().replace(/\/+$/, "") || "/";
  for (const { prefix, permission } of ROUTE_PERMISSION_PREFIXES) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return permission;
    }
  }
  return null;
}

/**
 * Determines whether the given authenticated user can access a panel route.
 */
export function canAccessPanelPath(
  user: AuthenticatedTenantUserContext | null | undefined,
  pathname: string,
): boolean {
  const requiredPermission = getRequiredPermissionForPath(pathname);
  if (!requiredPermission) {
    return true;
  }
  return hasRolePermission(user, requiredPermission);
}
