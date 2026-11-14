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
    it("grants Owner access to all 21 registered system permissions dynamically", () => {
      const ownerCtx = createMockContext("owner");

      expect(SYSTEM_PERMISSIONS).toHaveLength(21);
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
    it("grants Admin all 21 system permissions", () => {
      const adminCtx = createMockContext("admin");

      for (const permission of SYSTEM_PERMISSIONS) {
        expect(hasPermission(adminCtx, permission)).toBe(true);
      }
    });

    it("grants Manager operational permissions and denies archive/destructive permissions", () => {
      const managerCtx = createMockContext("manager");

      // Feature 002: employees read only
      expect(hasPermission(managerCtx, "employees:read")).toBe(true);
      expect(hasPermission(managerCtx, "employees:invite")).toBe(false);
      expect(hasPermission(managerCtx, "employees:update_role")).toBe(false);
      expect(hasPermission(managerCtx, "employees:suspend")).toBe(false);
      expect(hasPermission(managerCtx, "employees:remove")).toBe(false);
      expect(hasPermission(managerCtx, "employees:invitations_read")).toBe(false);
      expect(hasPermission(managerCtx, "employees:invitations_revoke")).toBe(false);

      // Feature 003: products operational
      expect(hasPermission(managerCtx, "products:read")).toBe(true);
      expect(hasPermission(managerCtx, "products:read_cost")).toBe(true);
      expect(hasPermission(managerCtx, "products:create")).toBe(true);
      expect(hasPermission(managerCtx, "products:update")).toBe(true);
      expect(hasPermission(managerCtx, "products:archive")).toBe(false);

      // Feature 003: categories operational
      expect(hasPermission(managerCtx, "categories:read")).toBe(true);
      expect(hasPermission(managerCtx, "categories:create")).toBe(true);
      expect(hasPermission(managerCtx, "categories:update")).toBe(true);
      expect(hasPermission(managerCtx, "categories:archive")).toBe(false);

      // Feature 004: inventory operational
      expect(hasPermission(managerCtx, "inventory:read")).toBe(true);
      expect(hasPermission(managerCtx, "inventory:read_valuation")).toBe(true);
      expect(hasPermission(managerCtx, "inventory:receive")).toBe(true);
      expect(hasPermission(managerCtx, "inventory:adjust")).toBe(true);
      expect(hasPermission(managerCtx, "inventory:history")).toBe(true);
    });

    it("restricts Cashier to retail read-only permissions and denies cost/mutation permissions", () => {
      const cashierCtx = createMockContext("cashier");

      // Feature 002: strictly denied all 7 employee permissions
      expect(hasPermission(cashierCtx, "employees:read")).toBe(false);
      expect(hasPermission(cashierCtx, "employees:invite")).toBe(false);
      expect(hasPermission(cashierCtx, "employees:update_role")).toBe(false);
      expect(hasPermission(cashierCtx, "employees:suspend")).toBe(false);
      expect(hasPermission(cashierCtx, "employees:remove")).toBe(false);
      expect(hasPermission(cashierCtx, "employees:invitations_read")).toBe(false);
      expect(hasPermission(cashierCtx, "employees:invitations_revoke")).toBe(false);

      // Feature 003: read-only access without cost or mutation
      expect(hasPermission(cashierCtx, "products:read")).toBe(true);
      expect(hasPermission(cashierCtx, "categories:read")).toBe(true);
      expect(hasPermission(cashierCtx, "products:read_cost")).toBe(false);
      expect(hasPermission(cashierCtx, "products:create")).toBe(false);
      expect(hasPermission(cashierCtx, "products:update")).toBe(false);
      expect(hasPermission(cashierCtx, "products:archive")).toBe(false);
      expect(hasPermission(cashierCtx, "categories:create")).toBe(false);
      expect(hasPermission(cashierCtx, "categories:update")).toBe(false);
      expect(hasPermission(cashierCtx, "categories:archive")).toBe(false);

      // Feature 004: stock read only without valuation or adjustment
      expect(hasPermission(cashierCtx, "inventory:read")).toBe(true);
      expect(hasPermission(cashierCtx, "inventory:read_valuation")).toBe(false);
      expect(hasPermission(cashierCtx, "inventory:receive")).toBe(false);
      expect(hasPermission(cashierCtx, "inventory:adjust")).toBe(false);
      expect(hasPermission(cashierCtx, "inventory:history")).toBe(false);
    });

    it("evaluates against ROLE_PERMISSIONS static mapping when context.permissions is undefined", () => {
      const managerNoPerms = createMockContext("manager");
      // @ts-expect-error - simulating legacy/undefined context.permissions
      delete managerNoPerms.permissions;

      expect(hasPermission(managerNoPerms, "products:read")).toBe(true);
      expect(hasPermission(managerNoPerms, "products:create")).toBe(true);
      expect(hasPermission(managerNoPerms, "products:archive")).toBe(false);
      expect(hasPermission(managerNoPerms, "employees:invite")).toBe(false);

      const cashierNoPerms = createMockContext("cashier");
      // @ts-expect-error - simulating legacy/undefined context.permissions
      delete cashierNoPerms.permissions;

      expect(hasPermission(cashierNoPerms, "products:read")).toBe(true);
      expect(hasPermission(cashierNoPerms, "categories:read")).toBe(true);
      expect(hasPermission(cashierNoPerms, "products:create")).toBe(false);
      expect(hasPermission(cashierNoPerms, "products:read_cost")).toBe(false);
    });
  });
});

