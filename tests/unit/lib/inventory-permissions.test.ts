import { describe, it, expect } from "vitest";
import {
  canViewValuation,
  hasInventoryPermission,
  INVENTORY_PERMISSIONS,
} from "@/lib/inventory/permissions";
import type { TenantContext } from "@/types/auth";

describe("Inventory Permissions & Valuation Dual-Auth Guard (P4-R02, SEC-INV-004)", () => {
  const createMockContext = (
    role: "owner" | "manager" | "cashier",
    permissions: string[],
    options?: {
      membershipStatus?: "active" | "suspended" | "revoked";
      orgActive?: boolean;
    }
  ): TenantContext => {
    return {
      user: { id: "usr-123", email: "staff@store.com" },
      organization: {
        id: "org-123",
        name: "Test Store",
        slug: "test-store",
        currency: "USD",
        is_active: options?.orgActive ?? true,
        created_at: "2026-11-01T00:00:00Z",
        updated_at: "2026-11-01T00:00:00Z",
      },
      membership: {
        id: "mem-123",
        user_id: "usr-123",
        organization_id: "org-123",
        role,
        status: options?.membershipStatus ?? "active",
        created_at: "2026-11-01T00:00:00Z",
        updated_at: "2026-11-01T00:00:00Z",
      },
      role,
      permissions: permissions as any,
    } as unknown as TenantContext;
  };

  describe("canViewValuation Four-Case Permission Matrix", () => {
    it("Case 1: (false, false) -> Denied when neither permission is held", () => {
      const ctx = createMockContext("cashier", ["inventory:read"]);
      expect(canViewValuation(ctx)).toBe(false);
    });

    it("Case 2: (true, false) -> Denied when holding inventory:read_valuation alone", () => {
      const ctx = createMockContext("manager", [
        "inventory:read",
        "inventory:read_valuation",
      ]);
      expect(canViewValuation(ctx)).toBe(false);
    });

    it("Case 3: (false, true) -> Denied when holding products:read_cost alone", () => {
      const ctx = createMockContext("manager", [
        "inventory:read",
        "products:read_cost",
      ]);
      expect(canViewValuation(ctx)).toBe(false);
    });

    it("Case 4: (true, true) -> Allowed when holding BOTH permissions", () => {
      const ctx = createMockContext("manager", [
        "inventory:read",
        "inventory:read_valuation",
        "products:read_cost",
      ]);
      expect(canViewValuation(ctx)).toBe(true);
    });
  });

  describe("Boundary and Lifecycle Guards", () => {
    it("Denies access when context is null or undefined", () => {
      expect(canViewValuation(null)).toBe(false);
      expect(canViewValuation(undefined)).toBe(false);
      expect(hasInventoryPermission(null, "inventory:read")).toBe(false);
    });

    it("Denies access when membership is inactive/suspended even if permissions exist", () => {
      const ctx = createMockContext(
        "manager",
        ["inventory:read", "inventory:read_valuation", "products:read_cost"],
        { membershipStatus: "suspended" }
      );
      expect(canViewValuation(ctx)).toBe(false);
      expect(hasInventoryPermission(ctx, "inventory:read")).toBe(false);
    });

    it("Denies access when organization is inactive even if permissions exist", () => {
      const ctx = createMockContext(
        "manager",
        ["inventory:read", "inventory:read_valuation", "products:read_cost"],
        { orgActive: false }
      );
      expect(canViewValuation(ctx)).toBe(false);
      expect(hasInventoryPermission(ctx, "inventory:read")).toBe(false);
    });

    it("Grants access to Owner role automatically across all permissions", () => {
      const ctx = createMockContext("owner", []);
      expect(canViewValuation(ctx)).toBe(true);
      for (const perm of INVENTORY_PERMISSIONS) {
        expect(hasInventoryPermission(ctx, perm)).toBe(true);
      }
    });
  });
});

