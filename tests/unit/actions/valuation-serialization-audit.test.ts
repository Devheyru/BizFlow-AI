import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getInventoryOverviewAction,
  getInventoryListAction,
  getInventoryProductAction,
  getMovementHistoryAction,
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

describe("Audit A: Valuation Serialization Exact JSON Evidence Across Complete Permission Matrix", () => {
  const mockOrgId = "c0000000-0000-4000-8000-000000000001";
  const mockProductId = "b0000000-0000-4000-8000-000000000002";
  const mockSlug = "audit-store";

  const createMockContext = (readValuation: boolean, readCost: boolean) => {
    const permissions = ["inventory:read", "inventory:history"];
    if (readValuation) permissions.push("inventory:read_valuation");
    if (readCost) permissions.push("products:read_cost");

    return {
      user: { id: "a0000000-0000-4000-8000-000000000003", email: "user@store.com" },
      organization: {
        id: mockOrgId,
        name: "Audit Store",
        slug: mockSlug,
        currency: "USD",
        is_active: true,
      },
      membership: { role: "member", status: "active" },
      role: "member" as const,
      permissions: permissions as any,
    };
  };

  const createMockQueryBuilder = (mockData: any, count: number | null = 1) => {
    const builder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: mockData, error: null }),
      single: vi.fn().mockResolvedValue({ data: mockData, error: null }),
      then: (resolve: any) => resolve({ data: mockData, error: null, count }),
    };
    return builder;
  };

  const overviewDbRows = [
    {
      quantity: "20.0000",
      reorder_point: "5.0000",
      products: { id: mockProductId, status: "active", product_costs: [{ cost_price: "15.00" }] },
    },
  ];

  const listDbRows = [
    {
      product_id: mockProductId,
      quantity: "20.0000",
      reorder_point: "5.0000",
      reorder_quantity: "10.0000",
      version: 1,
      products: {
        id: mockProductId,
        name: "Espresso Beans",
        sku: "ESP-001",
        barcode: "12345678",
        status: "active",
        unit_of_measure: "bag",
        category_id: null,
        product_costs: [{ cost_price: "15.00" }],
      },
    },
  ];

  const productDbRow = {
    quantity: "20.0000",
    reorder_point: "5.0000",
    reorder_quantity: "10.0000",
    version: 1,
    products: {
      id: mockProductId,
      name: "Espresso Beans",
      sku: "ESP-001",
      barcode: "12345678",
      status: "active",
      unit_of_measure: "bag",
      product_costs: [{ cost_price: "15.00" }],
    },
  };

  const historyDbRows = [
    {
      id: "m0000000-0000-4000-8000-000000000001",
      product_id: mockProductId,
      movement_type: "restock",
      quantity_before: "0.0000",
      quantity_delta: "20.0000",
      quantity_after: "20.0000",
      reason: "Supplier delivery",
      reference_id: "PO-101",
      created_by: "a0000000-0000-4000-8000-000000000003",
      created_at: "2026-11-10T12:00:00Z",
      products: { name: "Espresso Beans", sku: "ESP-001" },
      profiles: { id: "a0000000-0000-4000-8000-000000000003", first_name: "Audit", last_name: "User" },
      stock_movement_costs: [{ unit_cost: "15.00", currency: "USD" }],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const matrixCases = [
    { label: "Case 1: (false, false) - Both Permissions Absent", readValuation: false, readCost: false },
    { label: "Case 2: (true, false) - Only inventory:read_valuation Present", readValuation: true, readCost: false },
    { label: "Case 3: (false, true) - Only products:read_cost Present", readValuation: false, readCost: true },
    { label: "Case 4: (true, true) - BOTH Permissions Present (Authorized)", readValuation: true, readCost: true },
  ];

  for (const c of matrixCases) {
    it(`evaluates ${c.label}`, async () => {
      const ctx = createMockContext(c.readValuation, c.readCost);
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({ ok: true, context: ctx as any });

      // 1. Overview Action
      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: vi.fn().mockReturnValue(createMockQueryBuilder(overviewDbRows)),
      } as any);
      const overviewRes = await getInventoryOverviewAction(mockSlug);
      expect(overviewRes.success).toBe(true);
      if (overviewRes.success) {
        if (c.readValuation && c.readCost) {
          expect(overviewRes.data.totalValuation).toEqual({
            amount: 300,
            currency: "USD",
            formatted: "$300.00",
          });
        } else {
          expect(overviewRes.data.totalValuation).toBeNull();
        }
      }

      // 2. List Action
      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: vi.fn().mockReturnValue(createMockQueryBuilder(listDbRows)),
      } as any);
      const listRes = await getInventoryListAction(mockSlug, {});
      expect(listRes.success).toBe(true);
      if (listRes.success) {
        const item = listRes.data.items[0]!;
        if (c.readValuation && c.readCost) {
          expect(item.unitCost).toBe(15.0);
          expect(item.totalValue).toBe(300.0);
          expect(item.currency).toBe("USD");
        } else {
          expect(item.unitCost).toBeNull();
          expect(item.totalValue).toBeNull();
          expect(item.currency).toBeNull();
        }
      }

      // 3. Product Action
      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: vi.fn().mockImplementation((tbl: string) => {
          if (tbl === "stock_movements") {
            return createMockQueryBuilder({ created_at: "2026-11-10T12:00:00Z" });
          }
          return createMockQueryBuilder(productDbRow);
        }),
      } as any);
      const prodRes = await getInventoryProductAction(mockSlug, mockProductId);
      expect(prodRes.success).toBe(true);
      if (prodRes.success) {
        if (c.readValuation && c.readCost) {
          expect(prodRes.data.unitCost).toBe(15.0);
          expect(prodRes.data.totalValue).toBe(300.0);
          expect(prodRes.data.currency).toBe("USD");
        } else {
          expect(prodRes.data.unitCost).toBeNull();
          expect(prodRes.data.totalValue).toBeNull();
          expect(prodRes.data.currency).toBeNull();
        }
      }

      // 4. Movement History Action
      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: vi.fn().mockReturnValue(createMockQueryBuilder(historyDbRows)),
      } as any);
      const historyRes = await getMovementHistoryAction(mockSlug, {});
      expect(historyRes.success).toBe(true);
      if (historyRes.success) {
        const item = historyRes.data.items[0]!;
        if (c.readValuation && c.readCost) {
          expect(item.unitCost).toBe(15.0);
          expect(item.currency).toBe("USD");
        } else {
          expect(item.unitCost).toBeNull();
          expect(item.currency).toBeNull();
        }
      }
    });
  }
});

