import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  toggleProductStatusAction,
  archiveProductAction,
  restoreProductAction,
  getProductStateAction,
} from "@/actions/product-actions";
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

describe("T050: Product Lifecycle Server Actions Unit Tests (US5)", () => {
  const mockOrgId = "b0000000-0000-4000-8000-000000000001";
  const mockProductId = "b1111111-1111-4111-8111-111111111111";
  const mockSlug = "test-store";

  const ownerContext = {
    user: { id: "u0000000-0000-4000-8000-000000000001", email: "owner@store.com" },
    organization: { id: mockOrgId, name: "Test Store", slug: mockSlug, currency: "USD", is_active: true },
    membership: { role: "owner", status: "active" },
    role: "owner" as const,
    permissions: [
      "products:read",
      "products:create",
      "products:update",
      "products:archive",
      "products:read_cost",
    ] as any,
  };

  const adminContext = {
    user: { id: "u0000000-0000-4000-8000-000000000004", email: "admin@store.com" },
    organization: { id: mockOrgId, name: "Test Store", slug: mockSlug, currency: "USD", is_active: true },
    membership: { role: "admin", status: "active" },
    role: "admin" as const,
    permissions: [
      "products:read",
      "products:create",
      "products:update",
      "products:archive",
      "products:read_cost",
    ] as any,
  };

  const managerContext = {
    user: { id: "u0000000-0000-4000-8000-000000000002", email: "manager@store.com" },
    organization: { id: mockOrgId, name: "Test Store", slug: mockSlug, currency: "USD", is_active: true },
    membership: { role: "manager", status: "active" },
    role: "manager" as const,
    permissions: [
      "products:read",
      "products:create",
      "products:update",
      "products:read_cost",
    ] as any,
  };

  const cashierContext = {
    user: { id: "u0000000-0000-4000-8000-000000000003", email: "cashier@store.com" },
    organization: { id: mockOrgId, name: "Test Store", slug: mockSlug, currency: "USD", is_active: true },
    membership: { role: "cashier", status: "active" },
    role: "cashier" as const,
    permissions: ["products:read"] as any,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("toggleProductStatusAction", () => {
    it("rejects invalid input schemas prior to tenant resolution", async () => {
      // Invalid UUID
      const res1 = await toggleProductStatusAction(mockSlug, "invalid-uuid", 1, "active");
      expect(res1.success).toBe(false);
      if (!res1.success) {
        expect(res1.error.code).toBe("VALIDATION_ERROR");
      }

      // Invalid expected version (non-integer)
      const res2 = await toggleProductStatusAction(mockSlug, mockProductId, 1.5, "active");
      expect(res2.success).toBe(false);
      if (!res2.success) {
        expect(res2.error.code).toBe("VALIDATION_ERROR");
      }

      // Invalid expected version (zero)
      const res3 = await toggleProductStatusAction(mockSlug, mockProductId, 0, "active");
      expect(res3.success).toBe(false);
      if (!res3.success) {
        expect(res3.error.code).toBe("VALIDATION_ERROR");
      }

      // Invalid status (e.g. archived is prohibited in toggle)
      const res4 = await toggleProductStatusAction(mockSlug, mockProductId, 1, "archived" as any);
      expect(res4.success).toBe(false);
      if (!res4.success) {
        expect(res4.error.code).toBe("VALIDATION_ERROR");
      }

      expect(authContext.resolveTenantContext).not.toHaveBeenCalled();
    });

    it("rejects unauthorized caller lacking products:update (Cashier)", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: cashierContext as any,
      });

      const res = await toggleProductStatusAction(mockSlug, mockProductId, 1, "inactive");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
      }
    });

    it("allows Manager (holding products:update) to toggle status successfully", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          data: { id: mockProductId, status: "inactive", version: 2 },
        },
        error: null,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await toggleProductStatusAction(mockSlug, mockProductId, 1, "inactive");
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toEqual({ id: mockProductId, status: "inactive", version: 2 });
      }

      expect(mockRpc).toHaveBeenCalledWith("toggle_product_status", {
        p_org_id: mockOrgId,
        p_product_id: mockProductId,
        p_expected_version: 1,
        p_new_status: "inactive",
      });

      expect(revalidatePath).toHaveBeenCalledWith(`/${mockSlug}/products`, "page");
      expect(revalidatePath).toHaveBeenCalledWith(`/${mockSlug}/products/${mockProductId}`, "page");
    });

    it("allows Admin and Owner to toggle status successfully", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: adminContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          data: { id: mockProductId, status: "active", version: 3 },
        },
        error: null,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await toggleProductStatusAction(mockSlug, mockProductId, 2, "active");
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.status).toBe("active");
        expect(res.data.version).toBe(3);
      }
    });

    it("maps P0010 error to CONCURRENCY_CONFLICT", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code: "P0010", message: "Concurrency conflict detected" },
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await toggleProductStatusAction(mockSlug, mockProductId, 1, "inactive");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("CONCURRENCY_CONFLICT");
        expect(res.error.message).toContain("modified by another user");
      }
    });

    it("maps P0015 error to STATE_CONFLICT", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code: "P0015", message: "Cannot toggle archived product" },
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await toggleProductStatusAction(mockSlug, mockProductId, 1, "active");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("STATE_CONFLICT");
      }
    });
  });

  describe("archiveProductAction", () => {
    it("rejects invalid input schemas prior to tenant resolution", async () => {
      const res1 = await archiveProductAction(mockSlug, "not-a-uuid", 1);
      expect(res1.success).toBe(false);
      if (!res1.success) {
        expect(res1.error.code).toBe("VALIDATION_ERROR");
      }

      const res2 = await archiveProductAction(mockSlug, mockProductId, -1);
      expect(res2.success).toBe(false);
      if (!res2.success) {
        expect(res2.error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("rejects Manager lacking products:archive with FORBIDDEN", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const res = await archiveProductAction(mockSlug, mockProductId, 1);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
        expect(res.error.message).toContain("products:archive");
      }
    });

    it("rejects Cashier lacking products:archive with FORBIDDEN", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: cashierContext as any,
      });

      const res = await archiveProductAction(mockSlug, mockProductId, 1);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
      }
    });

    it("allows Owner/Admin with products:archive to archive successfully", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: ownerContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          data: {
            id: mockProductId,
            status: "archived",
            version: 3,
            archived_at: "2026-11-09T12:00:00Z",
          },
        },
        error: null,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await archiveProductAction(mockSlug, mockProductId, 2);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.status).toBe("archived");
        expect(res.data.version).toBe(3);
        expect(res.data.archived_at).toBe("2026-11-09T12:00:00Z");
      }

      expect(mockRpc).toHaveBeenCalledWith("archive_product", {
        p_org_id: mockOrgId,
        p_product_id: mockProductId,
        p_expected_version: 2,
      });

      expect(revalidatePath).toHaveBeenCalledWith(`/${mockSlug}/products`, "page");
      expect(revalidatePath).toHaveBeenCalledWith(`/${mockSlug}/products/${mockProductId}`, "page");
    });

    it("maps P0010 error to CONCURRENCY_CONFLICT during archival", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: ownerContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code: "P0010", message: "Stale version" },
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await archiveProductAction(mockSlug, mockProductId, 1);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("CONCURRENCY_CONFLICT");
      }
    });
  });

  describe("restoreProductAction", () => {
    it("rejects invalid input schemas prior to tenant resolution", async () => {
      const res1 = await restoreProductAction(mockSlug, "bad-uuid", 1);
      expect(res1.success).toBe(false);
      if (!res1.success) {
        expect(res1.error.code).toBe("VALIDATION_ERROR");
      }

      const res2 = await restoreProductAction(mockSlug, mockProductId, 0);
      expect(res2.success).toBe(false);
      if (!res2.success) {
        expect(res2.error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("rejects Manager lacking products:archive with FORBIDDEN", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const res = await restoreProductAction(mockSlug, mockProductId, 1);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
      }
    });

    it("rejects Cashier lacking products:archive with FORBIDDEN", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: cashierContext as any,
      });

      const res = await restoreProductAction(mockSlug, mockProductId, 1);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
      }
    });

    it("allows Owner/Admin with products:archive to restore successfully", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: ownerContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          data: {
            id: mockProductId,
            status: "active",
            version: 4,
          },
        },
        error: null,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await restoreProductAction(mockSlug, mockProductId, 3);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.status).toBe("active");
        expect(res.data.version).toBe(4);
      }

      expect(mockRpc).toHaveBeenCalledWith("restore_product", {
        p_org_id: mockOrgId,
        p_product_id: mockProductId,
        p_expected_version: 3,
      });

      expect(revalidatePath).toHaveBeenCalledWith(`/${mockSlug}/products`, "page");
      expect(revalidatePath).toHaveBeenCalledWith(`/${mockSlug}/products/${mockProductId}`, "page");
    });

    it("maps P0015 error when attempting to restore non-archived product", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: ownerContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code: "P0015", message: "Only archived products can be restored" },
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await restoreProductAction(mockSlug, mockProductId, 1);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("STATE_CONFLICT");
      }
    });
  });

  describe("getProductStateAction", () => {
    it("validates product ID format", async () => {
      const res = await getProductStateAction(mockSlug, "invalid-uuid");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("retrieves current product status and version for authorized caller", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: mockProductId,
                  status: "inactive",
                  version: 5,
                  archived_at: null,
                },
                error: null,
              }),
            }),
          }),
        }),
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: mockFrom,
      } as any);

      const res = await getProductStateAction(mockSlug, mockProductId);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toEqual({
          id: mockProductId,
          status: "inactive",
          version: 5,
          archived_at: null,
        });
      }
    });
  });
});
