import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createCategoryAction,
  updateCategoryAction,
  archiveCategoryAction,
  restoreCategoryAction,
} from "@/actions/category-actions";
import * as authContext from "@/lib/auth/context";
import * as supabaseServer from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  resolveTenantContext: vi.fn(),
  requireTenantContext: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

describe("T046: Category Server Actions Unit Tests (US4)", () => {
  const mockOrgId = "c0000000-0000-4000-8000-000000000001";
  const mockCategoryId = "c1111111-1111-4111-8111-111111111111";
  const mockSlug = "test-store";

  const ownerContext = {
    user: { id: "u0000000-0000-4000-8000-000000000001", email: "owner@store.com" },
    organization: { id: mockOrgId, name: "Test Store", slug: mockSlug, currency: "USD", is_active: true },
    membership: { role: "owner", status: "active" },
    role: "owner" as const,
    permissions: [
      "categories:read",
      "categories:create",
      "categories:update",
      "categories:archive",
    ] as any,
  };

  const managerContext = {
    user: { id: "u0000000-0000-4000-8000-000000000002", email: "manager@store.com" },
    organization: { id: mockOrgId, name: "Test Store", slug: mockSlug, currency: "USD", is_active: true },
    membership: { role: "manager", status: "active" },
    role: "manager" as const,
    permissions: [
      "categories:read",
      "categories:create",
      "categories:update",
    ] as any,
  };

  const cashierContext = {
    user: { id: "u0000000-0000-4000-8000-000000000003", email: "cashier@store.com" },
    organization: { id: mockOrgId, name: "Test Store", slug: mockSlug, currency: "USD", is_active: true },
    membership: { role: "cashier", status: "active" },
    role: "cashier" as const,
    permissions: ["categories:read"] as any,
  };

  const adminContext = {
    user: { id: "u0000000-0000-4000-8000-000000000004", email: "admin@store.com" },
    organization: { id: mockOrgId, name: "Test Store", slug: mockSlug, currency: "USD", is_active: true },
    membership: { role: "admin", status: "active" },
    role: "admin" as const,
    permissions: [
      "categories:read",
      "categories:create",
      "categories:update",
      "categories:archive",
    ] as any,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createCategoryAction", () => {
    it("returns error when tenant context fails to resolve", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: false,
        error: "not_found",
      });

      const res = await createCategoryAction(mockSlug, { name: "Bakery" });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("NOT_FOUND");
      }
    });

    it("rejects caller without categories:create permission (Cashier)", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: cashierContext as any,
      });

      const res = await createCategoryAction(mockSlug, { name: "Bakery" });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
      }
    });

    it("rejects invalid input (empty name)", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: ownerContext as any,
      });

      const res = await createCategoryAction(mockSlug, { name: "   " });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("VALIDATION_ERROR");
        expect(res.error.details?.name).toBeDefined();
      }
    });

    it("successfully creates category with Manager role and invalidates cache", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          data: {
            id: mockCategoryId,
            organization_id: mockOrgId,
            name: "Bakery & Breads",
            description: "Fresh baked daily",
            status: "active",
            created_at: new Date().toISOString(),
          },
        },
        error: null,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await createCategoryAction(mockSlug, {
        name: "Bakery & Breads",
        description: "Fresh baked daily",
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.id).toBe(mockCategoryId);
        expect(res.data.name).toBe("Bakery & Breads");
        expect(res.data.status).toBe("active");
      }

      expect(mockRpc).toHaveBeenCalledWith("create_product_category", {
        p_org_id: mockOrgId,
        p_name: "Bakery & Breads",
        p_description: "Fresh baked daily",
      });

      expect(revalidatePath).toHaveBeenCalledWith(`/${mockSlug}/products`, "layout");
      expect(revalidatePath).toHaveBeenCalledWith(`/${mockSlug}/products/categories`, "page");
    });

    it("successfully creates category with Admin role", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: adminContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          data: {
            id: mockCategoryId,
            organization_id: mockOrgId,
            name: "Dairy",
            description: null,
            status: "active",
            created_at: new Date().toISOString(),
          },
        },
        error: null,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await createCategoryAction(mockSlug, { name: "Dairy" });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.name).toBe("Dairy");
      }
    });

    it("maps database P0006 error to IDENTIFIER_EXISTS", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: ownerContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code: "P0006", message: 'Category name "Bakery" already exists' },
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await createCategoryAction(mockSlug, { name: "Bakery" });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("IDENTIFIER_EXISTS");
      }
    });
  });

  describe("updateCategoryAction", () => {
    it("rejects caller without categories:update permission (Cashier)", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: cashierContext as any,
      });

      const res = await updateCategoryAction(mockSlug, mockCategoryId, { name: "New Name" });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
      }
    });

    it("rejects invalid category ID", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: ownerContext as any,
      });

      const res = await updateCategoryAction(mockSlug, "invalid-uuid", { name: "New Name" });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("successfully updates category with Owner role", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: ownerContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          data: {
            id: mockCategoryId,
            organization_id: mockOrgId,
            name: "Artisan Bakery",
            description: null,
            status: "active",
            updated_at: new Date().toISOString(),
          },
        },
        error: null,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await updateCategoryAction(mockSlug, mockCategoryId, {
        name: "Artisan Bakery",
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.name).toBe("Artisan Bakery");
      }

      expect(mockRpc).toHaveBeenCalledWith("update_product_category", {
        p_org_id: mockOrgId,
        p_category_id: mockCategoryId,
        p_name: "Artisan Bakery",
        p_description: undefined,
      });
      expect(revalidatePath).toHaveBeenCalledWith(`/${mockSlug}/products`, "layout");
    });

    it("successfully updates category with Admin role", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: adminContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          data: {
            id: mockCategoryId,
            organization_id: mockOrgId,
            name: "Updated by Admin",
            description: null,
            status: "active",
            updated_at: new Date().toISOString(),
          },
        },
        error: null,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await updateCategoryAction(mockSlug, mockCategoryId, { name: "Updated by Admin" });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.name).toBe("Updated by Admin");
      }
    });

    it("successfully updates category with Manager role", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          data: {
            id: mockCategoryId,
            organization_id: mockOrgId,
            name: "Updated by Manager",
            description: null,
            status: "active",
            updated_at: new Date().toISOString(),
          },
        },
        error: null,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await updateCategoryAction(mockSlug, mockCategoryId, { name: "Updated by Manager" });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.name).toBe("Updated by Manager");
      }
    });

    it("maps database P0015 error when updating archived category", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: ownerContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code: "P0015", message: "Archived category cannot be updated" },
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await updateCategoryAction(mockSlug, mockCategoryId, { name: "New Name" });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("STATE_CONFLICT");
      }
    });
  });

  describe("archiveCategoryAction", () => {
    it("rejects Manager role because Manager lacks categories:archive permission", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const res = await archiveCategoryAction(mockSlug, mockCategoryId);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
      }
    });

    it("rejects Cashier role", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: cashierContext as any,
      });

      const res = await archiveCategoryAction(mockSlug, mockCategoryId);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
      }
    });

    it("successfully archives category with Owner role", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: ownerContext as any,
      });

      const mockIso = new Date().toISOString();
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          data: {
            id: mockCategoryId,
            organization_id: mockOrgId,
            name: "Old Category",
            status: "archived",
            archived_at: mockIso,
          },
        },
        error: null,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await archiveCategoryAction(mockSlug, mockCategoryId);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.id).toBe(mockCategoryId);
        expect(res.data.status).toBe("archived");
        expect(res.data.archived_at).toBe(mockIso);
      }

      expect(mockRpc).toHaveBeenCalledWith("archive_product_category", {
        p_org_id: mockOrgId,
        p_category_id: mockCategoryId,
      });
      expect(revalidatePath).toHaveBeenCalledWith(`/${mockSlug}/products`, "layout");
    });

    it("successfully archives category with Admin role", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: adminContext as any,
      });

      const mockIso = new Date().toISOString();
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          data: {
            id: mockCategoryId,
            organization_id: mockOrgId,
            name: "Archived by Admin",
            status: "archived",
            archived_at: mockIso,
          },
        },
        error: null,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await archiveCategoryAction(mockSlug, mockCategoryId);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.status).toBe("archived");
      }
    });
  });

  describe("restoreCategoryAction", () => {
    it("rejects Cashier role", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: cashierContext as any,
      });

      const res = await restoreCategoryAction(mockSlug, mockCategoryId);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
      }
    });

    it("rejects Manager role because Manager lacks categories:archive permission", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const res = await restoreCategoryAction(mockSlug, mockCategoryId);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
      }
    });

    it("successfully restores category with Owner role", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: ownerContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          data: {
            id: mockCategoryId,
            organization_id: mockOrgId,
            name: "Restored Category",
            status: "active",
            updated_at: new Date().toISOString(),
          },
        },
        error: null,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await restoreCategoryAction(mockSlug, mockCategoryId);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.id).toBe(mockCategoryId);
        expect(res.data.status).toBe("active");
        expect(res.data.archived_at).toBeNull();
      }

      expect(mockRpc).toHaveBeenCalledWith("restore_product_category", {
        p_org_id: mockOrgId,
        p_category_id: mockCategoryId,
      });
      expect(revalidatePath).toHaveBeenCalledWith(`/${mockSlug}/products`, "layout");
    });

    it("successfully restores category with Admin role", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: adminContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          data: {
            id: mockCategoryId,
            organization_id: mockOrgId,
            name: "Restored by Admin",
            status: "active",
            updated_at: new Date().toISOString(),
          },
        },
        error: null,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await restoreCategoryAction(mockSlug, mockCategoryId);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.status).toBe("active");
      }
    });
  });
});

