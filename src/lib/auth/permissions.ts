import type { AppRole, PermissionKey, TenantContext } from "@/types/auth";

/**
 * Authoritative System Permissions Catalog (Feature 002)
 * All permissions strictly use colon-separated `<resource>:<action>` format.
 */
export const SYSTEM_PERMISSIONS = [
  "employees:read",
  "employees:invite",
  "employees:update_role",
  "employees:suspend",
  "employees:remove",
  "employees:invitations_read",
  "employees:invitations_revoke",
] as const;

export type SystemPermission = (typeof SYSTEM_PERMISSIONS)[number];

/**
 * Deterministic Role-to-Permission Mappings
 * Note: 'owner' receives all registered system permissions dynamically via hasPermission.
 */
export const ROLE_PERMISSIONS: Record<AppRole, readonly PermissionKey[]> = {
  owner: SYSTEM_PERMISSIONS,
  admin: [
    "employees:read",
    "employees:invite",
    "employees:update_role",
    "employees:suspend",
    "employees:remove",
    "employees:invitations_read",
    "employees:invitations_revoke",
  ],
  manager: [
    "employees:read",
  ],
  cashier: [],
};

/**
 * Authoritative 4-Rule Permission Resolution Engine (FR-032, FR-033, FR-034, Principle IV)
 *
 * Rules:
 * 1. Catalog Existence Requirement: The evaluated permission key MUST exist in SYSTEM_PERMISSIONS.
 *    Any unknown, unregistered, or misspelled permission string evaluates to false for ALL roles (including Owner).
 * 2. Active Membership Requirement: Tenant context must represent an active member in an active organization.
 * 3. Owner Automatic Access: Active Owners dynamically receive access to all registered permissions in the catalog.
 * 4. Deterministic Role Evaluation: Admin, Manager, and Cashier evaluate against context.permissions or static mapping.
 */
export function hasPermission(
  context: TenantContext | null | undefined,
  permission: string
): boolean {
  if (!context) {
    return false;
  }

  // Rule 1: Unknown/unregistered permissions MUST ALWAYS return false, even for Owner
  if (!SYSTEM_PERMISSIONS.includes(permission as PermissionKey)) {
    return false;
  }

  // Rule 2: Active membership check
  if (context.membership?.status !== "active" || !context.organization?.is_active) {
    return false;
  }

  // Rule 3: Dynamic Owner access for all registered permissions
  if (context.role === "owner") {
    return true;
  }

  // Rule 4: Evaluated against context permissions (or role permissions fallback)
  if (context.permissions && context.permissions.length > 0) {
    return context.permissions.includes(permission as PermissionKey);
  }

  const rolePerms = ROLE_PERMISSIONS[context.role] ?? [];
  return rolePerms.includes(permission as PermissionKey);
}

