import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getInventoryListAction,
  getInventoryProductAction,
  fetchMovementHistoryProductIds,
  isRpcUnavailableError,
} from "@/actions/inventory-actions";
import * as authContext from "@/lib/auth/context";
import * as supabaseServer from "@/lib/supabase/server";

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

describe("T025: Movement-History Completeness & PostgREST Boundary Verification", () => {
  const mockOrgId = "a0000000-0000-4000-8000-000000000001";
  const mockSlug = "audit-store";

  const createTenantContext = (orgId = mockOrgId) => ({
    user: { id: "u0000000-0000-4000-8000-000000000001", email: "manager@store.com" },
    organization: {
      id: orgId,
      name: "Audit Store",
      slug: mockSlug,
      currency: "USD",
      is_active: true,
    },
    membership: { role: "manager", status: "active" },
    role: "manager" as const,
    permissions: [
      "inventory:read",
      "inventory:receive",
      "inventory:adjust",
      "inventory:history",
      "inventory:read_valuation",
      "products:read_cost",
    ] as any,
  });

  const createMockInventoryRow = (
    productId: string,
    name: string,
    quantity = "0.0000",
    status: "active" | "inactive" | "archived" = "active"
  ) => ({
    product_id: productId,
    quantity,
    reorder_point: "5.0000",
    reorder_quantity: "10.0000",
    version: 1,
    products: {
      id: productId,
      name,
      sku: `SKU-${productId}`,
      barcode: null,
      status,
      unit_of_measure: "piece",
      category_id: null,
      product_costs: [{ cost_price: "10.00" }],
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
      ok: true,
      context: createTenantContext() as any,
    });
  });

  // ==========================================================================
  // Test 1: Zero stock, no movement history -> Eligible
  // ==========================================================================
  it("1. A product with zero stock and no movement history is eligible for Initial Opening Stock", async () => {
    const invRow = createMockInventoryRow("prod-clean", "Clean Product", "0.0000");

    const invBuilder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [invRow], error: null }),
    };

    const mvtBuilder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [], error: null }), // No movements exist
    };

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "inventory") return invBuilder;
        if (table === "stock_movements") return mvtBuilder;
        return invBuilder;
      }),
    } as any);

    const res = await getInventoryListAction(mockSlug, {});
    expect(res.success).toBe(true);
    if (!res.success) return;

    const item = res.data.items.find((i) => i.productId === "prod-clean");
    expect(item).toBeDefined();
    expect(item?.quantity).toBe(0);
    expect(item?.hasInitialMovement).toBe(false); // Eligible: hasInitialMovement is false
  });

  // ==========================================================================
  // Test 2: Previous 'initial' movement -> NOT eligible
  // ==========================================================================
  it("2. A product with a previous initial movement is not eligible", async () => {
    const invRow = createMockInventoryRow("prod-with-initial", "Initial Product", "0.0000");

    const invBuilder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [invRow], error: null }),
    };

    const mvtBuilder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      then: (resolve: any) =>
        resolve({
          data: [{ product_id: "prod-with-initial", movement_type: "initial" }],
          error: null,
        }),
    };

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "inventory") return invBuilder;
        if (table === "stock_movements") return mvtBuilder;
        return invBuilder;
      }),
    } as any);

    const res = await getInventoryListAction(mockSlug, {});
    expect(res.success).toBe(true);
    if (!res.success) return;

    const item = res.data.items.find((i) => i.productId === "prod-with-initial");
    expect(item?.hasInitialMovement).toBe(true); // Ineligible
  });

  // ==========================================================================
  // Test 3: Previous 'restock' movement -> NOT eligible
  // ==========================================================================
  it("3. A product with previous restock history is not eligible (even with 0 current stock)", async () => {
    const invRow = createMockInventoryRow("prod-with-restock", "Restocked Product", "0.0000");

    const invBuilder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [invRow], error: null }),
    };

    const mvtBuilder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      then: (resolve: any) =>
        resolve({
          data: [{ product_id: "prod-with-restock", movement_type: "restock" }],
          error: null,
        }),
    };

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "inventory") return invBuilder;
        if (table === "stock_movements") return mvtBuilder;
        return invBuilder;
      }),
    } as any);

    const res = await getInventoryListAction(mockSlug, {});
    expect(res.success).toBe(true);
    if (!res.success) return;

    const item = res.data.items.find((i) => i.productId === "prod-with-restock");
    expect(item?.hasInitialMovement).toBe(true); // Ineligible
  });

  // ==========================================================================
  // Test 4: Previous 'damage' / 'loss' / non-initial movement -> NOT eligible
  // ==========================================================================
  it("4. A product with previous damage, loss, or adjustment history is not eligible", async () => {
    const invRow = createMockInventoryRow("prod-with-damage", "Damaged Product", "0.0000");

    const invBuilder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [invRow], error: null }),
    };

    const mvtBuilder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      then: (resolve: any) =>
        resolve({
          data: [{ product_id: "prod-with-damage", movement_type: "damage" }],
          error: null,
        }),
    };

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "inventory") return invBuilder;
        if (table === "stock_movements") return mvtBuilder;
        return invBuilder;
      }),
    } as any);

    const res = await getInventoryListAction(mockSlug, {});
    expect(res.success).toBe(true);
    if (!res.success) return;

    const item = res.data.items.find((i) => i.productId === "prod-with-damage");
    expect(item?.hasInitialMovement).toBe(true); // Ineligible
  });

  // ==========================================================================
  // Test 5: Movement beyond first PostgREST page (boundary 1000) -> Still detected
  // ==========================================================================
  it("5. A product whose movement history is beyond the first PostgREST response page (row 1001+) is correctly identified as having history", async () => {
    const invRows = [
      createMockInventoryRow("prod-older-history", "Product with Old Movement", "0.0000"),
      createMockInventoryRow("prod-clean", "Clean Product", "0.0000"),
    ];

    const invBuilder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: invRows, error: null }),
    };

    // Simulate PostgREST pagination:
    // Page 1 (range 0..999): exactly 1000 records of other products
    const page1Movements = Array.from({ length: 1000 }, (_, i) => ({
      product_id: `other-product-${i}`,
    }));
    // Page 2 (range 1000..1050): contains 'prod-older-history'
    const page2Movements = [
      { product_id: "prod-older-history" },
      { product_id: "other-product-1001" },
    ];

    let rangeCalls = 0;
    const mvtBuilder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      range: vi.fn().mockImplementation((from: number) => {
        rangeCalls++;
        return {
          then: (resolve: any) => {
            if (from === 0) {
              resolve({ data: page1Movements, error: null });
            } else if (from === 1000) {
              resolve({ data: page2Movements, error: null });
            } else {
              resolve({ data: [], error: null });
            }
          },
        };
      }),
    };

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "inventory") return invBuilder;
        if (table === "stock_movements") return mvtBuilder;
        return invBuilder;
      }),
    } as any);

    const res = await getInventoryListAction(mockSlug, {});
    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(rangeCalls).toBeGreaterThanOrEqual(2); // Verified multi-page traversal
    const oldHistoryItem = res.data.items.find((i) => i.productId === "prod-older-history");
    const cleanItem = res.data.items.find((i) => i.productId === "prod-clean");

    expect(oldHistoryItem?.hasInitialMovement).toBe(true); // Correctly detected beyond row 1000
    expect(cleanItem?.hasInitialMovement).toBe(false); // Clean product remains eligible
  });

  // ==========================================================================
  // Test 6: Multiple pages of movement history do not cause older records to be missed
  // ==========================================================================
  it("6. Multiple pages of movement history do not cause older records to be missed across 3 pages", async () => {
    const invRows = [
      createMockInventoryRow("prod-page-3", "Page 3 Product", "0.0000"),
    ];

    const invBuilder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: invRows, error: null }),
    };

    // Page 1: 1000 items
    const p1 = Array.from({ length: 1000 }, (_, i) => ({ product_id: `p1-${i}` }));
    // Page 2: 1000 items
    const p2 = Array.from({ length: 1000 }, (_, i) => ({ product_id: `p2-${i}` }));
    // Page 3: 50 items, contains 'prod-page-3'
    const p3 = [{ product_id: "prod-page-3" }];

    let pageIndex = 0;
    const mvtBuilder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      range: vi.fn().mockImplementation((from: number) => {
        pageIndex++;
        return {
          then: (resolve: any) => {
            if (from === 0) resolve({ data: p1, error: null });
            else if (from === 1000) resolve({ data: p2, error: null });
            else if (from === 2000) resolve({ data: p3, error: null });
            else resolve({ data: [], error: null });
          },
        };
      }),
    };

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "inventory") return invBuilder;
        if (table === "stock_movements") return mvtBuilder;
        return invBuilder;
      }),
    } as any);

    const res = await getInventoryListAction(mockSlug, {});
    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(pageIndex).toBe(3);
    const item = res.data.items.find((i) => i.productId === "prod-page-3");
    expect(item?.hasInitialMovement).toBe(true);
  });

  // ==========================================================================
  // Test 7: History query failure FAILS CLOSED (never makes product eligible)
  // ==========================================================================
  it("7. A history-query failure does not make the product eligible (fails closed)", async () => {
    const invRow = createMockInventoryRow("prod-candidate", "Candidate Product", "0.0000");

    const invBuilder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [invRow], error: null }),
    };

    const mvtBuilder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      then: (resolve: any) =>
        resolve({ data: null, error: { code: "500", message: "Database connection lost" } }),
    };

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "inventory") return invBuilder;
        if (table === "stock_movements") return mvtBuilder;
        return invBuilder;
      }),
    } as any);

    const res = await getInventoryListAction(mockSlug, {});
    // Must fail closed with error, NEVER returning items with hasInitialMovement=false
    expect(res.success).toBe(false);
  });

  // ==========================================================================
  // Test 8: Movement history checks remain organization-scoped
  // ==========================================================================
  it("8. Movement-history checks remain strictly organization-scoped", async () => {
    const invRow = createMockInventoryRow("prod-clean-in-org1", "Clean In Org1", "0.0000");

    let queriedOrgId: string | null = null;
    const invBuilder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation((field: string, val: string) => {
        if (field === "organization_id") queriedOrgId = val;
        return invBuilder;
      }),
      neq: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [invRow], error: null }),
    };

    let mvtOrgId: string | null = null;
    const mvtBuilder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation((field: string, val: string) => {
        if (field === "organization_id") mvtOrgId = val;
        return mvtBuilder;
      }),
      in: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [], error: null }), // Movements exist in other org, but none in this org
    };

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "inventory") return invBuilder;
        if (table === "stock_movements") return mvtBuilder;
        return invBuilder;
      }),
    } as any);

    const res = await getInventoryListAction(mockSlug, {});
    expect(res.success).toBe(true);
    expect(queriedOrgId).toBe(mockOrgId);
    expect(mvtOrgId).toBe(mockOrgId);
  });

  // ==========================================================================
  // Test 9: Clean product remains eligible when history query returns no records
  // ==========================================================================
  it("9. A clean product remains eligible when the history query completes successfully and returns no records", async () => {
    const invRow = createMockInventoryRow("prod-brand-new", "Brand New Product", "0.0000");

    const invBuilder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [invRow], error: null }),
    };

    const mvtBuilder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [], error: null }),
    };

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "inventory") return invBuilder;
        if (table === "stock_movements") return mvtBuilder;
        return invBuilder;
      }),
    } as any);

    const res = await getInventoryListAction(mockSlug, {});
    expect(res.success).toBe(true);
    if (!res.success) return;

    const item = res.data.items[0];
    expect(item?.productId).toBe("prod-brand-new");
    expect(item?.hasInitialMovement).toBe(false); // Clean -> Eligible
  });

  // ==========================================================================
  // Test 10: Product-detail and inventory-list eligibility produce consistent results
  // ==========================================================================
  it("10. Product-detail and inventory-list eligibility produce consistent results for both clean and depleted products", async () => {
    const cleanProdId = "prod-clean-consistent";
    const historyProdId = "prod-history-consistent";

    const invRows = [
      createMockInventoryRow(cleanProdId, "Clean Consistent", "0.0000"),
      createMockInventoryRow(historyProdId, "History Consistent", "0.0000"),
    ];

    // List mocks
    const invListBuilder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: invRows, error: null }),
    };

    const mvtListBuilder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [{ product_id: historyProdId }], error: null }),
    };

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "inventory") return invListBuilder;
        if (table === "stock_movements") return mvtListBuilder;
        return invListBuilder;
      }),
    } as any);

    const listRes = await getInventoryListAction(mockSlug, {});
    expect(listRes.success).toBe(true);
    if (!listRes.success) return;

    const listClean = listRes.data.items.find((i) => i.productId === cleanProdId);
    const listHistory = listRes.data.items.find((i) => i.productId === historyProdId);

    expect(listClean?.hasInitialMovement).toBe(false);
    expect(listHistory?.hasInitialMovement).toBe(true);

    // Detail mocks for clean product (no lastMv, no initialMv)
    const detailInvClean: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          quantity: "0.0000",
          reorder_point: null,
          reorder_quantity: null,
          version: 1,
          products: { id: cleanProdId, name: "Clean Consistent", sku: "C-1", status: "active", unit_of_measure: "piece" },
        },
        error: null,
      }),
    };

    const detailMvtClean: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }), // No movements
    };

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "inventory") return detailInvClean;
        if (table === "stock_movements") return detailMvtClean;
        return detailInvClean;
      }),
    } as any);

    const detailCleanRes = await getInventoryProductAction(mockSlug, cleanProdId);
    expect(detailCleanRes.success).toBe(true);
    if (!detailCleanRes.success) return;
    expect(detailCleanRes.data.hasInitialMovement).toBe(false); // Matches listClean

    // Detail mocks for history product (lastMv exists)
    const detailInvHistory: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          quantity: "0.0000",
          reorder_point: null,
          reorder_quantity: null,
          version: 2,
          products: { id: historyProdId, name: "History Consistent", sku: "H-1", status: "active", unit_of_measure: "piece" },
        },
        error: null,
      }),
    };

    const detailMvtHistory: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { created_at: "2026-11-10T12:00:00Z" }, // Prior restock/damage movement exists
        error: null,
      }),
    };

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "inventory") return detailInvHistory;
        if (table === "stock_movements") return detailMvtHistory;
        return detailInvHistory;
      }),
    } as any);

    const detailHistoryRes = await getInventoryProductAction(mockSlug, historyProdId);
    expect(detailHistoryRes.success).toBe(true);
    if (!detailHistoryRes.success) return;
    expect(detailHistoryRes.data.hasInitialMovement).toBe(true); // Matches listHistory
  });
});

describe("T025: RPC Fallback Security & Pagination Determinism Hardening (Audit Sections 3 & 4)", () => {
  const orgId = "a0000000-0000-4000-8000-000000000001";
  const candidateA = "prod-candidate-a";
  const candidateB = "prod-candidate-b";

  describe("Audit Section 3: RPC Fallback Boundary & Security", () => {
    it("isRpcUnavailableError accurately identifies missing function / schema cache errors", () => {
      expect(isRpcUnavailableError({ code: "PGRST202" })).toBe(true);
      expect(isRpcUnavailableError({ code: "42883" })).toBe(true);
      expect(
        isRpcUnavailableError({
          code: "PGRST202",
          message: "Could not find the function public.get_products_with_movement_history in the schema cache",
        })
      ).toBe(true);
      expect(
        isRpcUnavailableError({
          code: "42883",
          message: "function public.get_products_with_movement_history() does not exist",
        })
      ).toBe(true);

      // Must return false for all non-missing-function errors
      expect(isRpcUnavailableError({ code: "42501", message: "INSUFFICIENT_PERMISSIONS" })).toBe(false);
      expect(isRpcUnavailableError({ code: "P0001", message: "ORGANIZATION_INACTIVE" })).toBe(false);
      expect(isRpcUnavailableError({ code: "P0002", message: "MEMBERSHIP_INACTIVE" })).toBe(false);
      expect(isRpcUnavailableError({ code: "08001", message: "UNAUTHENTICATED" })).toBe(false);
      expect(isRpcUnavailableError({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false);
      expect(isRpcUnavailableError(null)).toBe(false);
      expect(isRpcUnavailableError(undefined)).toBe(false);
    });

    it("1. Missing RPC (PGRST202 / 42883) triggers fallback query and returns movement history", async () => {
      const fallbackData = [{ product_id: candidateA }];
      const mockSupabase: any = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "PGRST202", message: "Could not find the function in schema cache" },
        }),
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockResolvedValue({ data: fallbackData, error: null }),
        }),
      };

      const result = await fetchMovementHistoryProductIds(mockSupabase, orgId, [candidateA]);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.movementProductIds.has(candidateA)).toBe(true);
      expect(mockSupabase.from).toHaveBeenCalledWith("stock_movements");
    });

    it("2. Authorization failure (08001 / P0001 / P0002) in RPC DOES NOT trigger fallback and fails closed", async () => {
      const authErrors = [
        { code: "08001", message: "UNAUTHENTICATED" },
        { code: "P0001", message: "ORGANIZATION_INACTIVE" },
        { code: "P0002", message: "MEMBERSHIP_INACTIVE" },
      ];

      for (const authError of authErrors) {
        const mockSupabase: any = {
          rpc: vi.fn().mockResolvedValue({ data: null, error: authError }),
          from: vi.fn(), // Should NEVER be called!
        };

        const result = await fetchMovementHistoryProductIds(mockSupabase, orgId, [candidateA]);
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error).toEqual(authError);
        expect(mockSupabase.from).not.toHaveBeenCalled();
      }
    });

    it("3. Permission denial (42501) in RPC DOES NOT trigger fallback and fails closed", async () => {
      const permError = { code: "42501", message: "INSUFFICIENT_PERMISSIONS" };
      const mockSupabase: any = {
        rpc: vi.fn().mockResolvedValue({ data: null, error: permError }),
        from: vi.fn(), // Must NOT be called
      };

      const result = await fetchMovementHistoryProductIds(mockSupabase, orgId, [candidateA]);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toEqual(permError);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it("4. Unexpected RPC failure (57014 statement timeout / internal error) DOES NOT trigger fallback and fails closed", async () => {
      const timeoutError = { code: "57014", message: "canceling statement due to statement timeout" };
      const mockSupabase: any = {
        rpc: vi.fn().mockResolvedValue({ data: null, error: timeoutError }),
        from: vi.fn(), // Must NOT bypass timeout via fallback
      };

      const result = await fetchMovementHistoryProductIds(mockSupabase, orgId, [candidateA]);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toEqual(timeoutError);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it("5. Fallback query failure returns failure (fails closed)", async () => {
      const dbError = { code: "42P01", message: "relation stock_movements does not exist" };
      const mockSupabase: any = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "PGRST202", message: "function not found" },
        }),
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockResolvedValue({ data: null, error: dbError }),
        }),
      };

      const result = await fetchMovementHistoryProductIds(mockSupabase, orgId, [candidateA]);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toEqual(dbError);
    });

    it("6. No error path returns an empty set that incorrectly makes products eligible", async () => {
      // Test when RPC throws an unexpected exception
      const mockSupabaseThrow: any = {
        rpc: vi.fn().mockRejectedValue(new Error("Fatal network disconnect")),
        from: vi.fn(),
      };

      const result = await fetchMovementHistoryProductIds(mockSupabaseThrow, orgId, [candidateA]);
      expect(result.success).toBe(false);
      // Guarantee result is not a success with empty set
      expect((result as any).movementProductIds).toBeUndefined();
    });
  });

  describe("Audit Section 4: Pagination Determinism & Boundary Conditions", () => {
    it("7. PostgREST fallback applies deterministic ordering (.order('id', { ascending: true }))", async () => {
      const orderMock = vi.fn().mockReturnThis();
      const mockSupabase: any = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "PGRST202", message: "not found" },
        }),
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: orderMock,
          range: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      };

      await fetchMovementHistoryProductIds(mockSupabase, orgId, [candidateA]);
      expect(orderMock).toHaveBeenCalledWith("id", { ascending: true });
    });

    it("8. Multiple pages with repeated product IDs across pages are properly deduplicated in Set", async () => {
      // 2,500 total movements spanning 3 pages, repeating candidateA and candidateB
      let pageCallCount = 0;
      const mockSupabase: any = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "PGRST202", message: "not found" },
        }),
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockImplementation((from: number) => {
            pageCallCount++;
            if (from === 0) {
              // Page 1: 1,000 records of candidateA
              return Promise.resolve({
                data: Array(1000).fill({ product_id: candidateA }),
                error: null,
              });
            } else if (from === 1000) {
              // Page 2: 1,000 records of candidateA
              return Promise.resolve({
                data: Array(1000).fill({ product_id: candidateA }),
                error: null,
              });
            } else if (from === 2000) {
              // Page 3: 500 records of candidateB
              return Promise.resolve({
                data: Array(500).fill({ product_id: candidateB }),
                error: null,
              });
            }
            return Promise.resolve({ data: [], error: null });
          }),
        }),
      };

      const result = await fetchMovementHistoryProductIds(mockSupabase, orgId);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(pageCallCount).toBe(3);
      expect(result.movementProductIds.size).toBe(2);
      expect(result.movementProductIds.has(candidateA)).toBe(true);
      expect(result.movementProductIds.has(candidateB)).toBe(true);
    });

    it("9. Records at page boundaries (index 999 and index 1000) are cleanly captured without skipping", async () => {
      const prodAt999 = "prod-at-999";
      const prodAt1000 = "prod-at-1000";

      const mockSupabase: any = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "PGRST202", message: "not found" },
        }),
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockImplementation((from: number) => {
            if (from === 0) {
              const p1 = Array(999).fill({ product_id: "noise" });
              p1.push({ product_id: prodAt999 }); // Exactly at index 999
              return Promise.resolve({ data: p1, error: null });
            } else if (from === 1000) {
              const p2 = [{ product_id: prodAt1000 }]; // Exactly at index 1000
              return Promise.resolve({ data: p2, error: null }); // Length 1 < 1000 -> terminates
            }
            return Promise.resolve({ data: [], error: null });
          }),
        }),
      };

      const result = await fetchMovementHistoryProductIds(mockSupabase, orgId);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.movementProductIds.has(prodAt999)).toBe(true);
      expect(result.movementProductIds.has(prodAt1000)).toBe(true);
    });

    it("10. Candidate whose only movement appears on later page (page 3) is detected", async () => {
      const lateCandidate = "prod-late-p3";
      const cleanCandidate = "prod-clean-forever";

      const mockSupabase: any = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "PGRST202", message: "not found" },
        }),
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockImplementation((from: number) => {
            if (from === 0) {
              return Promise.resolve({ data: Array(1000).fill({ product_id: "other-prod" }), error: null });
            } else if (from === 1000) {
              return Promise.resolve({ data: Array(1000).fill({ product_id: "other-prod" }), error: null });
            } else if (from === 2000) {
              return Promise.resolve({ data: [{ product_id: lateCandidate }], error: null });
            }
            return Promise.resolve({ data: [], error: null });
          }),
        }),
      };

      const result = await fetchMovementHistoryProductIds(mockSupabase, orgId, [lateCandidate, cleanCandidate]);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.movementProductIds.has(lateCandidate)).toBe(true);
      expect(result.movementProductIds.has(cleanCandidate)).toBe(false);
    });

    it("11. Fully exhausted query containing no history for candidate keeps candidate history-free", async () => {
      const cleanCandidate = "prod-truly-clean";

      const mockSupabase: any = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "PGRST202", message: "not found" },
        }),
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockImplementation((from: number) => {
            if (from === 0) {
              // 1000 records of noise
              return Promise.resolve({ data: Array(1000).fill({ product_id: "other" }), error: null });
            } else if (from === 1000) {
              // 500 records of noise, then terminates
              return Promise.resolve({ data: Array(500).fill({ product_id: "other" }), error: null });
            }
            return Promise.resolve({ data: [], error: null });
          }),
        }),
      };

      const result = await fetchMovementHistoryProductIds(mockSupabase, orgId, [cleanCandidate]);
      expect(result.success).toBe(true);
      if (!result.success) return;
      // Because query was completely exhausted and candidate was not found:
      expect(result.movementProductIds.has(cleanCandidate)).toBe(false);
    });

    it("12. Query failure during a later page fails closed (returns error, not partial set)", async () => {
      const page2Error = { code: "57014", message: "statement timeout on page 2" };

      const mockSupabase: any = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "PGRST202", message: "not found" },
        }),
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockImplementation((from: number) => {
            if (from === 0) {
              return Promise.resolve({ data: Array(1000).fill({ product_id: candidateA }), error: null });
            } else {
              return Promise.resolve({ data: null, error: page2Error });
            }
          }),
        }),
      };

      const result = await fetchMovementHistoryProductIds(mockSupabase, orgId, [candidateA, candidateB]);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toEqual(page2Error);
    });

    it("13. Early exit occurs when all candidates have been confirmed to have history", async () => {
      let pageCallCount = 0;

      const mockSupabase: any = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "PGRST202", message: "not found" },
        }),
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockImplementation((from: number) => {
            pageCallCount++;
            if (from === 0) {
              // Page 1 has 1000 items, and BOTH candidateA and candidateB appear on Page 1!
              return Promise.resolve({
                data: [
                  { product_id: candidateA },
                  { product_id: candidateB },
                  ...Array(998).fill({ product_id: "noise" }),
                ],
                error: null,
              });
            } else {
              // Should NOT reach page 2 because all candidates are already resolved
              return Promise.resolve({ data: Array(1000).fill({ product_id: "noise" }), error: null });
            }
          }),
        }),
      };

      const result = await fetchMovementHistoryProductIds(mockSupabase, orgId, [candidateA, candidateB]);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(pageCallCount).toBe(1); // Exited early after Page 1!
      expect(result.movementProductIds.has(candidateA)).toBe(true);
      expect(result.movementProductIds.has(candidateB)).toBe(true);
    });
  });
});
