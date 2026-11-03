import { describe, it, expect } from "vitest";
import { hasPermission, SYSTEM_PERMISSIONS, ROLE_PERMISSIONS } from "@/lib/auth/permissions";
import type { TenantContext, AppRole, PermissionKey, Organization, OrganizationMembership } from "@/types/auth";
import type { User } from "@supabase/supabase-js";

function createMockContext(
  role: AppRole,
  overrides?: {
    membershipStatus?: "active" | "suspended" | "revoked";
    orgIsActive?: boolean;
    permissions?: PermissionKey[];
  }
): TenantContext {
  const user: User = {
    id: "user-123",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: new Date().toISOString(),
  } as User;

  const organization: Organization = {
    id: "org-123",
    name: "Test Org",
    slug: "test-org",
    business_type: "Retail",
    country: "US",
    currency: "USD",
    timezone: "UTC",
    is_active: overrides?.orgIsActive !== undefined ? overrides.orgIsActive : true,
    created_by: "user-123",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    address: null,
    client_mutation_id: null,
    closed_at: null,
    closed_by: null,
    email: null,
    phone: null,
    tax_id: null,
  };

  const membership: OrganizationMembership = {
    id: "mem-123",
    organization_id: "org-123",
    user_id: "user-123",
    role,
    status: overrides?.membershipStatus || "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return {
    user,
    organization,
    membership,
    role,
    activeOrganizations: [],
    permissions: overrides?.permissions ?? (role === "owner" ? [...SYSTEM_PERMISSIONS] : [...(ROLE_PERMISSIONS[role] || [])]),
  };
}

describe("T046: TypeScript hasPermission 4-Rule Resolution Engine (FR-032, FR-033)", () => {
  describe("Rule 1: Catalog Bounding & Rejection of Unknown Keys", () => {
    it("strictly rejects unknown or unregistered permissions for Owner", () => {
      const ownerCtx = createMockContext("owner");
      expect(hasPermission(ownerCtx, "unknown:permission")).toBe(false);
      expect(hasPermission(ownerCtx, "employees:delete_everything")).toBe(false);
      expect(hasPermission(ownerCtx, "random_string")).toBe(false);
      expect(hasPermission(ownerCtx, "")).toBe(false);
    });

    it("strictly rejects unknown or unregistered permissions for Admin, Manager, and Cashier", () => {
      const adminCtx = createMockContext("admin");
      const managerCtx = createMockContext("manager");
      const cashierCtx = createMockContext("cashier");

      expect(hasPermission(adminCtx, "employees:hack")).toBe(false);
      expect(hasPermission(managerCtx, "billing:view")).toBe(false);
      expect(hasPermission(cashierCtx, "settings:edit")).toBe(false);
    });
  });

  describe("Rule 2: Active Membership & Organization Invariance", () => {
    it("returns false for null or undefined context", () => {
      expect(hasPermission(null, "employees:read")).toBe(false);
      expect(hasPermission(undefined, "employees:read")).toBe(false);
    });

    it("returns false if membership status is suspended", () => {
      const suspendedOwner = createMockContext("owner", { membershipStatus: "suspended" });
      const suspendedAdmin = createMockContext("admin", { membershipStatus: "suspended" });

      expect(hasPermission(suspendedOwner, "employees:read")).toBe(false);
      expect(hasPermission(suspendedAdmin, "employees:read")).toBe(false);
    });

    it("returns false if membership status is revoked", () => {
      const revokedAdmin = createMockContext("admin", { membershipStatus: "revoked" });
      expect(hasPermission(revokedAdmin, "employees:read")).toBe(false);
    });

    it("returns false if organization is inactive", () => {
      const inactiveOrgOwner = createMockContext("owner", { orgIsActive: false });
      expect(hasPermission(inactiveOrgOwner, "employees:read")).toBe(false);
    });
  });

  describe("Rule 3: Automatic Owner Access for Registered Permissions", () => {
    it("grants Owner access to all 7 registered system permissions dynamically", () => {
      const ownerCtx = createMockContext("owner");

      for (const permission of SYSTEM_PERMISSIONS) {
        expect(hasPermission(ownerCtx, permission)).toBe(true);
      }
    });

    it("grants Owner access even if context.permissions is empty (dynamic catalog access)", () => {
      const ownerCtx = createMockContext("owner", { permissions: [] });

      for (const permission of SYSTEM_PERMISSIONS) {
        expect(hasPermission(ownerCtx, permission)).toBe(true);
      }
    });
  });

  describe("Rule 4: Deterministic Role-Permission Mappings for Non-Owners", () => {
    it("grants Admin all 7 employee permissions", () => {
      const adminCtx = createMockContext("admin");

      for (const permission of SYSTEM_PERMISSIONS) {
        expect(hasPermission(adminCtx, permission)).toBe(true);
      }
    });

    it("grants Manager only employees:read permission and denies mutation permissions", () => {
      const managerCtx = createMockContext("manager");

      expect(hasPermission(managerCtx, "employees:read")).toBe(true);
      expect(hasPermission(managerCtx, "employees:invite")).toBe(false);
      expect(hasPermission(managerCtx, "employees:update_role")).toBe(false);
      expect(hasPermission(managerCtx, "employees:suspend")).toBe(false);
      expect(hasPermission(managerCtx, "employees:remove")).toBe(false);
      expect(hasPermission(managerCtx, "employees:invitations_read")).toBe(false);
      expect(hasPermission(managerCtx, "employees:invitations_revoke")).toBe(false);
    });

    it("denies Cashier all employee permissions", () => {
      const cashierCtx = createMockContext("cashier");

      for (const permission of SYSTEM_PERMISSIONS) {
        expect(hasPermission(cashierCtx, permission)).toBe(false);
      }
    });
  });
});

