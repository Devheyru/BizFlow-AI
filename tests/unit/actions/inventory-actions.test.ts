import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getInventoryOverviewAction,
  getInventoryListAction,
  getInventoryProductAction,
  recordStockMovementAction,
  updateInventoryThresholdsAction,
  getMovementHistoryAction,
} from "@/actions/inventory-actions";
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

describe("T017: Inventory Server Actions Unit Tests", () => {
  const mockOrgId = "c0000000-0000-4000-8000-000000000001";
  const mockProductId = "b0000000-0000-4000-8000-000000000002";
  const mockSlug = "test-store";

  // Contexts with different permission combinations
  const createMockContext = (permissions: string[], role: "owner" | "admin" | "manager" | "cashier" = "manager") => ({
    user: { id: "a0000000-0000-4000-8000-000000000003", email: `${role}@store.com` },
    organization: {
      id: mockOrgId,
      name: "Test Store",
      slug: mockSlug,
      currency: "USD",
      is_active: true,
    },
    membership: { role, status: "active" },
    role,
    permissions: permissions as any,
  });

  const fullPermsContext = createMockContext([
    "inventory:read",
    "inventory:receive",
    "inventory:adjust",
    "inventory:history",
    "inventory:read_valuation",
    "products:read_cost",
  ], "owner");

  const readValuationOnlyContext = createMockContext([
    "inventory:read",
    "inventory:receive",
    "inventory:adjust",
    "inventory:history",
    "inventory:read_valuation",
  ], "manager");

  const readCostOnlyContext = createMockContext([
    "inventory:read",
    "inventory:receive",
    "inventory:adjust",
    "inventory:history",
    "products:read_cost",
  ], "manager");

  const noValuationContext = createMockContext([
    "inventory:read",
    "inventory:receive",
    "inventory:adjust",
    "inventory:history",
  ], "cashier");

  const readOnlyContext = createMockContext(["inventory:read"], "cashier");
  const receiveOnlyContext = createMockContext(["inventory:receive"], "cashier");
  const adjustOnlyContext = createMockContext(["inventory:adjust"], "cashier");
  const noPermissionsContext = createMockContext([], "cashier");

  // Helper to create mock query builder
  const createMockQueryBuilder = (mockData: any = null, mockError: any = null, count: number | null = null) => {
    const builder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: mockData, error: mockError }),
      single: vi.fn().mockResolvedValue({ data: mockData, error: mockError }),
      then: (resolve: any) => resolve({ data: mockData, error: mockError, count }),
    };
    return builder;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // 1. getInventoryOverviewAction Tests
  // ============================================================================
  describe("getInventoryOverviewAction", () => {
    it("returns error when tenant context fails to resolve", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: false,
        error: "not_found",
      });

      const res = await getInventoryOverviewAction(mockSlug);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("NOT_FOUND");
      }
    });

    it("rejects caller without inventory:read permission", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: noPermissionsContext as any,
      });

      const res = await getInventoryOverviewAction(mockSlug);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
        expect(res.error.message).toMatch(/inventory:read/i);
      }
    });

    // 4-Case Valuation Matrix for getInventoryOverviewAction
    it("Valuation Case 1: (neither permission) returns totalValuation: null", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: noValuationContext as any,
      });

      const mockData = [
        { quantity: "20.0000", reorder_point: "5.0000", products: { id: "p1", status: "active" } },
        { quantity: "2.0000", reorder_point: "5.0000", products: { id: "p2", status: "active" } },
        { quantity: "0.0000", reorder_point: "5.0000", products: { id: "p3", status: "active" } },
      ];

      const mockBuilder = createMockQueryBuilder(mockData);
      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: vi.fn().mockReturnValue(mockBuilder),
      } as any);

      const res = await getInventoryOverviewAction(mockSlug);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.totalTrackedProducts).toBe(3);
        expect(res.data.inStockCount).toBe(1);
        expect(res.data.lowStockCount).toBe(1);
        expect(res.data.outOfStockCount).toBe(1);
        expect(res.data.totalValuation).toBeNull();
      }
    });

    it("Valuation Case 2: (only inventory:read_valuation) returns totalValuation: null", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: readValuationOnlyContext as any,
      });

      const mockData = [
        { quantity: "20.0000", reorder_point: "5.0000", products: { id: "p1", status: "active" } },
      ];

      const mockBuilder = createMockQueryBuilder(mockData);
      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: vi.fn().mockReturnValue(mockBuilder),
      } as any);

      const res = await getInventoryOverviewAction(mockSlug);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.totalValuation).toBeNull();
      }
    });

    it("Valuation Case 3: (only products:read_cost) returns totalValuation: null", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: readCostOnlyContext as any,
      });

      const mockData = [
        { quantity: "20.0000", reorder_point: "5.0000", products: { id: "p1", status: "active" } },
      ];

      const mockBuilder = createMockQueryBuilder(mockData);
      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: vi.fn().mockReturnValue(mockBuilder),
      } as any);

      const res = await getInventoryOverviewAction(mockSlug);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.totalValuation).toBeNull();
      }
    });

    it("Valuation Case 4: (BOTH permissions) calculates and returns totalValuation correctly", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      const mockData = [
        {
          quantity: "20.0000",
          reorder_point: "5.0000",
          products: {
            id: "p1",
            status: "active",
            product_costs: [{ cost_price: "10.00" }],
          },
        },
        {
          quantity: "5.0000",
          reorder_point: "2.0000",
          products: {
            id: "p2",
            status: "active",
            product_costs: { cost_price: "4.50" }, // single object form
          },
        },
      ];

      const mockBuilder = createMockQueryBuilder(mockData);
      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: vi.fn().mockReturnValue(mockBuilder),
      } as any);

      const res = await getInventoryOverviewAction(mockSlug);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.totalTrackedProducts).toBe(2);
        // (20 * 10.00) + (5 * 4.50) = 200 + 22.50 = 222.50
        expect(res.data.totalValuation).not.toBeNull();
        expect(res.data.totalValuation?.amount).toBe(222.5);
        expect(res.data.totalValuation?.currency).toBe("USD");
        expect(res.data.totalValuation?.formatted).toContain("222.50");
      }
    });

    it("handles database error gracefully", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      const mockBuilder = createMockQueryBuilder(null, { code: "42501", message: "permission denied" });
      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: vi.fn().mockReturnValue(mockBuilder),
      } as any);

      const res = await getInventoryOverviewAction(mockSlug);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("INSUFFICIENT_PERMISSIONS");
      }
    });
  });

  // ============================================================================
  // 2. getInventoryListAction Tests
  // ============================================================================
  describe("getInventoryListAction", () => {
    it("validates query parameters and rejects invalid values", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      const res = await getInventoryListAction(mockSlug, { page: -1, pageSize: 200 });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("VALIDATION_ERROR");
        expect(res.error.details?.page).toBeDefined();
        expect(res.error.details?.pageSize).toBeDefined();
      }
    });

    it("rejects caller without inventory:read permission", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: noPermissionsContext as any,
      });

      const res = await getInventoryListAction(mockSlug, {});
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
      }
    });

    // 4-Case Valuation Matrix for getInventoryListAction
    it("Valuation Matrix: Case 1-3 strips unitCost and totalValue when unauthorized", async () => {
      for (const ctx of [noValuationContext, readValuationOnlyContext, readCostOnlyContext]) {
        vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
          ok: true,
          context: ctx as any,
        });

        const mockData = [
          {
            product_id: "p1",
            quantity: "15.0000",
            reorder_point: "5.0000",
            reorder_quantity: "10.0000",
            version: 1,
            products: {
              id: "p1",
              name: "Product 1",
              sku: "SKU-1",
              barcode: null,
              status: "active",
              unit_of_measure: "piece",
              category_id: null,
            },
          },
        ];

        const mockBuilder = createMockQueryBuilder(mockData);
        vi.mocked(supabaseServer.createClient).mockResolvedValue({
          from: vi.fn().mockReturnValue(mockBuilder),
        } as any);

        const res = await getInventoryListAction(mockSlug, {});
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.data.items[0]?.unitCost).toBeNull();
          expect(res.data.items[0]?.totalValue).toBeNull();
          expect(res.data.items[0]?.currency).toBeNull();
        }
      }
    });

    it("Valuation Matrix: Case 4 calculates unitCost and totalValue when authorized for both", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      const mockData = [
        {
          product_id: "p1",
          quantity: "10.0000",
          reorder_point: "2.0000",
          reorder_quantity: "5.0000",
          version: 2,
          products: {
            id: "p1",
            name: "Premium Coffee",
            sku: "COF-001",
            barcode: "1234567890",
            status: "active",
            unit_of_measure: "bag",
            category_id: "cat-1",
            product_categories: { name: "Beverages" },
            product_costs: [{ cost_price: "15.50" }],
          },
        },
      ];

      const mockBuilder = createMockQueryBuilder(mockData);
      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: vi.fn().mockReturnValue(mockBuilder),
      } as any);

      const res = await getInventoryListAction(mockSlug, {});
      expect(res.success).toBe(true);
      if (res.success) {
        const item = res.data.items[0]!;
        expect(item.unitCost).toBe(15.50);
        expect(item.totalValue).toBe(155.0); // 10 * 15.50
        expect(item.currency).toBe("USD");
        expect(item.categoryName).toBe("Beverages");
        expect(item.stockStatus).toBe("in_stock");
      }
    });

    it("correctly sorts items by stock_status (priority: out_of_stock, low_stock, in_stock)", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      const mockData = [
        {
          product_id: "p1",
          quantity: "50.0000",
          reorder_point: "10.0000",
          reorder_quantity: null,
          version: 1,
          products: { id: "p1", name: "In Stock Item", sku: "A", status: "active", unit_of_measure: "piece" },
        },
        {
          product_id: "p2",
          quantity: "0.0000",
          reorder_point: "5.0000",
          reorder_quantity: null,
          version: 1,
          products: { id: "p2", name: "Out of Stock Item", sku: "B", status: "active", unit_of_measure: "piece" },
        },
        {
          product_id: "p3",
          quantity: "3.0000",
          reorder_point: "5.0000",
          reorder_quantity: null,
          version: 1,
          products: { id: "p3", name: "Low Stock Item", sku: "C", status: "active", unit_of_measure: "piece" },
        },
      ];

      const mockBuilder = createMockQueryBuilder(mockData);
      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: vi.fn().mockReturnValue(mockBuilder),
      } as any);

      const res = await getInventoryListAction(mockSlug, { sortBy: "stock_status", sortOrder: "asc" });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.items[0]?.stockStatus).toBe("out_of_stock");
        expect(res.data.items[1]?.stockStatus).toBe("low_stock");
        expect(res.data.items[2]?.stockStatus).toBe("in_stock");
      }
    });

    it("correctly filters by calculated stock status and client search query", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      const mockData = [
        {
          product_id: "p1",
          quantity: "2.0000",
          reorder_point: "5.0000",
          reorder_quantity: null,
          version: 1,
          products: { id: "p1", name: "Organic Apple Juice", sku: "APP-001", barcode: null, status: "active", unit_of_measure: "bottle" },
        },
        {
          product_id: "p2",
          quantity: "1.0000",
          reorder_point: "5.0000",
          reorder_quantity: null,
          version: 1,
          products: { id: "p2", name: "Organic Orange Juice", sku: "ORG-002", barcode: null, status: "active", unit_of_measure: "bottle" },
        },
        {
          product_id: "p3",
          quantity: "0.0000",
          reorder_point: "5.0000",
          reorder_quantity: null,
          version: 1,
          products: { id: "p3", name: "Apple Cider", sku: "CID-003", barcode: null, status: "active", unit_of_measure: "bottle" },
        },
      ];

      const mockBuilder = createMockQueryBuilder(mockData);
      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: vi.fn().mockReturnValue(mockBuilder),
      } as any);

      // Search for "apple" and stockStatus "low_stock"
      const res = await getInventoryListAction(mockSlug, {
        search: "apple",
        stockStatus: "low_stock",
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.items.length).toBe(1);
        expect(res.data.items[0]?.productName).toBe("Organic Apple Juice");
      }
    });
  });

  // ============================================================================
  // 3. getInventoryProductAction Tests
  // ============================================================================
  describe("getInventoryProductAction", () => {
    it("validates productId presence", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      const res = await getInventoryProductAction(mockSlug, "");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("rejects caller without inventory:read permission", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: noPermissionsContext as any,
      });

      const res = await getInventoryProductAction(mockSlug, mockProductId);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
      }
    });

    it("returns INVENTORY_NOT_FOUND when product does not exist in inventory", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      const mockBuilder = createMockQueryBuilder(null);
      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: vi.fn().mockReturnValue(mockBuilder),
      } as any);

      const res = await getInventoryProductAction(mockSlug, mockProductId);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("INVENTORY_NOT_FOUND");
      }
    });

    // 4-Case Valuation Matrix for getInventoryProductAction
    it("Valuation Matrix: Case 1-3 strips unitCost and totalValue when unauthorized", async () => {
      for (const ctx of [noValuationContext, readValuationOnlyContext, readCostOnlyContext]) {
        vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
          ok: true,
          context: ctx as any,
        });

        const mockInvData = {
          quantity: "25.0000",
          reorder_point: "5.0000",
          reorder_quantity: "15.0000",
          version: 3,
          products: {
            id: mockProductId,
            name: "Artisan Bread",
            sku: "BRD-001",
            barcode: null,
            status: "active",
            unit_of_measure: "piece",
          },
        };

        const mockBuilder = createMockQueryBuilder(mockInvData);
        vi.mocked(supabaseServer.createClient).mockResolvedValue({
          from: vi.fn().mockReturnValue(mockBuilder),
        } as any);

        const res = await getInventoryProductAction(mockSlug, mockProductId);
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.data.unitCost).toBeNull();
          expect(res.data.totalValue).toBeNull();
          expect(res.data.currency).toBeNull();
        }
      }
    });

    it("Valuation Matrix: Case 4 populates unitCost and totalValue when authorized for both", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      const mockInvData = {
        quantity: "20.0000",
        reorder_point: "5.0000",
        reorder_quantity: "10.0000",
        version: 4,
        products: {
          id: mockProductId,
          name: "Artisan Bread",
          sku: "BRD-001",
          barcode: "BRD-1234",
          status: "active",
          unit_of_measure: "piece",
          product_costs: [{ cost_price: "2.50" }],
        },
      };

      const mockBuilder = createMockQueryBuilder(mockInvData);
      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: vi.fn().mockReturnValue(mockBuilder),
      } as any);

      const res = await getInventoryProductAction(mockSlug, mockProductId);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.unitCost).toBe(2.50);
        expect(res.data.totalValue).toBe(50.0); // 20 * 2.50
        expect(res.data.currency).toBe("USD");
        expect(res.data.isDiscrete).toBe(true);
        expect(res.data.stockStatus).toBe("in_stock");
      }
    });
  });

  // ============================================================================
  // 4. recordStockMovementAction Tests
  // ============================================================================
  describe("recordStockMovementAction", () => {
    const validRestockInput = {
      productId: mockProductId,
      movementType: "restock" as const,
      quantity: 50,
      reason: "Restocked from supplier invoice 104",
      referenceId: "PO-2026-99",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    };

    const validAdjustmentInput = {
      productId: mockProductId,
      movementType: "adjustment" as const,
      quantity: 5,
      quantitySemantics: "quantity_delta" as const,
      reason: "Annual audit inventory discrepancy adjustment",
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
    };

    it("rejects caller lacking inventory:receive permission when performing restock", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: adjustOnlyContext as any, // Has adjust but NOT receive
      });

      const res = await recordStockMovementAction(mockSlug, validRestockInput);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
        expect(res.error.message).toMatch(/inventory:receive/i);
      }
    });

    it("rejects caller lacking inventory:adjust permission when performing adjustment", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: receiveOnlyContext as any, // Has receive but NOT adjust
      });

      const res = await recordStockMovementAction(mockSlug, validAdjustmentInput);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
        expect(res.error.message).toMatch(/inventory:adjust/i);
      }
    });

    it("rejects validation: quantity scale exceeds 4 decimal places", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      const res = await recordStockMovementAction(mockSlug, {
        ...validRestockInput,
        quantity: 12.34567, // 5 decimal places
      });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("VALIDATION_ERROR");
        expect(res.error.details?.quantity).toBeDefined();
      }
    });

    it("rejects validation: reason is shorter than 3 characters", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      const res = await recordStockMovementAction(mockSlug, {
        ...validRestockInput,
        reason: "ok",
      });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("VALIDATION_ERROR");
        expect(res.error.details?.reason).toBeDefined();
      }
    });

    it("rejects validation: target_physical_count semantics provided for restock", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      const res = await recordStockMovementAction(mockSlug, {
        ...validRestockInput,
        quantitySemantics: "target_physical_count",
      });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("VALIDATION_ERROR");
        expect(res.error.details?.quantitySemantics).toBeDefined();
      }
    });

    it("successfully commits stock movement, calls RPC, and triggers path revalidations", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      const mockRpcResponse = {
        success: true,
        is_replay: false,
        status: "committed",
        movement_id: "d0000000-0000-4000-8000-000000000001",
        product_id: mockProductId,
        quantity_before: "10.0000",
        quantity_delta: "50.0000",
        quantity_after: "60.0000",
        current_stock: "60.0000",
        version: 2,
        message: "Stock movement recorded successfully",
      };

      const mockRpc = vi.fn().mockResolvedValue({
        data: mockRpcResponse,
        error: null,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await recordStockMovementAction(mockSlug, validRestockInput);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.isReplay).toBe(false);
        expect(res.data.quantityBefore).toBe(10);
        expect(res.data.quantityDelta).toBe(50);
        expect(res.data.quantityAfter).toBe(60);
        expect(res.data.version).toBe(2);
      }

      // Verify RPC invocation payload
      expect(mockRpc).toHaveBeenCalledWith("execute_stock_movement", {
        p_org_id: mockOrgId,
        p_product_id: mockProductId,
        p_movement_type: "restock",
        p_quantity: 50,
        p_reason: "Restocked from supplier invoice 104",
        p_reference_id: "PO-2026-99",
        p_idempotency_key: "11111111-1111-4111-8111-111111111111",
        p_expected_version: undefined,
        p_quantity_semantics: "quantity_delta",
      });

      // Verify cache invalidations
      expect(revalidatePath).toHaveBeenCalledWith(`/[slug]/inventory`, "page");
      expect(revalidatePath).toHaveBeenCalledWith(`/[slug]/products`, "page");
      expect(revalidatePath).toHaveBeenCalledWith(`/[slug]/products/${mockProductId}`, "page");
    });

    it("handles zero-delta stocktake replay response with matched_quantity", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      const mockReplayResponse = {
        success: true,
        is_replay: true,
        status: "matched",
        movement_id: "d0000000-0000-4000-8000-000000000002",
        product_id: mockProductId,
        quantity_before: "20.0000",
        quantity_delta: "0.0000",
        quantity_after: "20.0000",
        current_stock: "15.0000",
        matched_quantity: "20.0000",
        version: 5,
        message: "Request replayed: zero-delta stocktake already confirmed",
      };

      const mockRpc = vi.fn().mockResolvedValue({
        data: mockReplayResponse,
        error: null,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await recordStockMovementAction(mockSlug, {
        ...validAdjustmentInput,
        quantity: 20,
        quantitySemantics: "target_physical_count",
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.isReplay).toBe(true);
        expect(res.data.status).toBe("matched");
        expect(res.data.matchedQuantity).toBe(20.0);
        expect(res.data.currentStock).toBe(15.0);
        expect(res.data.quantityDelta).toBe(0.0);
      }
    });

    // RPC Error Code Mappings
    it("maps RPC P0011 error to INSUFFICIENT_STOCK", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "P0011", message: "Requested reduction exceeds available inventory balance" },
        }),
      } as any);

      const res = await recordStockMovementAction(mockSlug, validAdjustmentInput);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("INSUFFICIENT_STOCK");
      }
    });

    it("maps RPC P0021 error to PRODUCT_ARCHIVED_STOCK_FORBIDDEN", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "P0021", message: "Stock operations on archived products are restricted" },
        }),
      } as any);

      const res = await recordStockMovementAction(mockSlug, validRestockInput);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("PRODUCT_ARCHIVED_STOCK_FORBIDDEN");
      }
    });

    it("maps RPC P0024 error to IDEMPOTENCY_CONFLICT", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "P0024", message: "Idempotency key already used with different payload" },
        }),
      } as any);

      const res = await recordStockMovementAction(mockSlug, validRestockInput);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("IDEMPOTENCY_CONFLICT");
      }
    });

    it("maps RPC P0027 error to STALE_VERSION_CONFLICT", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "P0027", message: "Inventory record updated by another transaction" },
        }),
      } as any);

      const res = await recordStockMovementAction(mockSlug, {
        ...validRestockInput,
        expectedVersion: 1,
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("STALE_VERSION_CONFLICT");
      }
    });

    it("maps RPC P0033 error to INVALID_QUANTITY_SEMANTICS", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "P0033", message: "Invalid quantity semantics submitted" },
        }),
      } as any);

      const res = await recordStockMovementAction(mockSlug, validAdjustmentInput);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("INVALID_QUANTITY_SEMANTICS");
      }
    });
  });

  // ============================================================================
  // 5. updateInventoryThresholdsAction Tests
  // ============================================================================
  describe("updateInventoryThresholdsAction", () => {
    const validThresholdInput = {
      productId: mockProductId,
      reorderPoint: 15,
      reorderQuantity: 30,
      expectedVersion: 2,
    };

    it("rejects caller lacking inventory:adjust permission", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: receiveOnlyContext as any, // Missing adjust permission
      });

      const res = await updateInventoryThresholdsAction(mockSlug, validThresholdInput);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
        expect(res.error.message).toMatch(/inventory:adjust/i);
      }
    });

    it("rejects negative reorder point in validation", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      const res = await updateInventoryThresholdsAction(mockSlug, {
        ...validThresholdInput,
        reorderPoint: -5,
      });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("VALIDATION_ERROR");
        expect(res.error.details?.reorderPoint).toBeDefined();
      }
    });

    it("successfully updates thresholds and revalidates paths", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      const mockRpcResponse = {
        success: true,
        product_id: mockProductId,
        reorder_point: 15,
        reorder_quantity: 30,
        version: 3,
      };

      const mockRpc = vi.fn().mockResolvedValue({
        data: mockRpcResponse,
        error: null,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await updateInventoryThresholdsAction(mockSlug, validThresholdInput);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.reorderPoint).toBe(15);
        expect(res.data.reorderQuantity).toBe(30);
        expect(res.data.version).toBe(3);
      }

      expect(mockRpc).toHaveBeenCalledWith("update_inventory_thresholds", {
        p_org_id: mockOrgId,
        p_product_id: mockProductId,
        p_reorder_point: 15,
        p_reorder_quantity: 30,
        p_expected_version: 2,
      });

      expect(revalidatePath).toHaveBeenCalledWith(`/[slug]/inventory`, "page");
      expect(revalidatePath).toHaveBeenCalledWith(`/[slug]/products/${mockProductId}`, "page");
    });

    it("handles optimistic concurrency conflict (P0027)", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "P0027", message: "Stale version conflict" },
        }),
      } as any);

      const res = await updateInventoryThresholdsAction(mockSlug, validThresholdInput);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("STALE_VERSION_CONFLICT");
      }
    });
  });

  // ============================================================================
  // 6. getMovementHistoryAction Tests
  // ============================================================================
  describe("getMovementHistoryAction", () => {
    it("rejects caller lacking inventory:history permission", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: readOnlyContext as any, // Has inventory:read but NOT inventory:history
      });

      const res = await getMovementHistoryAction(mockSlug, {});
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
        expect(res.error.message).toMatch(/inventory:history/i);
      }
    });

    // 4-Case Valuation Matrix for getMovementHistoryAction
    it("Valuation Matrix: Case 1-3 strips unitCost and currency when unauthorized", async () => {
      for (const ctx of [noValuationContext, readValuationOnlyContext, readCostOnlyContext]) {
        vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
          ok: true,
          context: ctx as any,
        });

        const mockHistoryRows = [
          {
            id: "m1",
            product_id: mockProductId,
            movement_type: "restock",
            quantity_before: "10.0000",
            quantity_delta: "20.0000",
            quantity_after: "30.0000",
            reason: "Supplier delivery",
            reference_id: "INV-101",
            created_by: "u1",
            created_at: "2026-11-10T12:00:00Z",
            products: { name: "Product A", sku: "SKU-A" },
            profiles: { id: "u1", first_name: "Jane", last_name: "Doe" },
          },
        ];

        const mockBuilder = createMockQueryBuilder(mockHistoryRows, null, 1);
        vi.mocked(supabaseServer.createClient).mockResolvedValue({
          from: vi.fn().mockReturnValue(mockBuilder),
        } as any);

        const res = await getMovementHistoryAction(mockSlug, {});
        expect(res.success).toBe(true);
        if (res.success) {
          const item = res.data.items[0]!;
          expect(item.unitCost).toBeNull();
          expect(item.currency).toBeNull();
          expect(item.performedBy.fullName).toBe("Jane Doe");
          expect(item.performedBy.email).toBe(""); // masked
        }
      }
    });

    it("Valuation Matrix: Case 4 populates unitCost and currency when authorized for both", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      const mockHistoryRows = [
        {
          id: "m1",
          product_id: mockProductId,
          movement_type: "restock",
          quantity_before: "0.0000",
          quantity_delta: "50.0000",
          quantity_after: "50.0000",
          reason: "Initial supplier order",
          reference_id: "PO-1001",
          created_by: "u1",
          created_at: "2026-11-10T10:00:00Z",
          products: { name: "Espresso Beans", sku: "ESP-001" },
          profiles: { id: "u1", first_name: "John", last_name: "Manager" },
          stock_movement_costs: [{ unit_cost: "14.25", currency: "USD" }],
        },
      ];

      const mockBuilder = createMockQueryBuilder(mockHistoryRows, null, 1);
      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: vi.fn().mockReturnValue(mockBuilder),
      } as any);

      const res = await getMovementHistoryAction(mockSlug, {});
      expect(res.success).toBe(true);
      if (res.success) {
        const item = res.data.items[0]!;
        expect(item.unitCost).toBe(14.25);
        expect(item.currency).toBe("USD");
        expect(item.performedBy.fullName).toBe("John Manager");
        expect(item.movementType).toBe("restock");
        expect(item.quantityDelta).toBe(50);
      }
    });

    it("handles pagination and date range filters correctly", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: fullPermsContext as any,
      });

      const mockBuilder = createMockQueryBuilder([], null, 42);
      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: vi.fn().mockReturnValue(mockBuilder),
      } as any);

      const res = await getMovementHistoryAction(mockSlug, {
        page: 2,
        pageSize: 10,
        fromDate: "2026-11-01T00:00:00.000Z",
        toDate: "2026-11-11T23:59:59.999Z",
        movementType: "restock",
        productId: mockProductId,
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.page).toBe(2);
        expect(res.data.pageSize).toBe(10);
        expect(res.data.totalCount).toBe(42);
        expect(res.data.totalPages).toBe(5);
      }
    });
  });
});

