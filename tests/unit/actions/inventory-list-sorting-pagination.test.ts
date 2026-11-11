import { describe, it, expect, vi, beforeEach } from "vitest";
import { getInventoryListAction } from "@/actions/inventory-actions";
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

describe("getInventoryListAction: Global Sorting, Tie-Breakers & Pagination Invariants (P4-R03)", () => {
  const mockOrgId = "c0000000-0000-4000-8000-000000000001";
  const mockSlug = "sorting-store";

  const mockContext = {
    user: { id: "a0000000-0000-4000-8000-000000000003", email: "manager@store.com" },
    organization: {
      id: mockOrgId,
      name: "Sorting Store",
      slug: mockSlug,
      currency: "USD",
      is_active: true,
    },
    membership: { role: "manager", status: "active" },
    role: "manager" as const,
    permissions: [
      "inventory:read",
      "inventory:read_valuation",
      "products:read_cost",
    ] as any,
  };

  // 6 products designed to test sorting priorities, identical quantities, and multi-page distribution
  const testDbRows = [
    {
      product_id: "prod-04",
      quantity: "0.0000",
      reorder_point: "10.0000",
      reorder_quantity: "20.0000",
      version: 1,
      products: {
        id: "prod-04",
        name: "Dark Chocolate Bar",
        sku: "CHO-004",
        barcode: null,
        status: "active",
        unit_of_measure: "piece",
        category_id: null,
        product_costs: [{ cost_price: "2.50" }],
      },
    },
    {
      product_id: "prod-01",
      quantity: "0.0000",
      reorder_point: "5.0000",
      reorder_quantity: "15.0000",
      version: 1,
      products: {
        id: "prod-01",
        name: "Apple Cider Vinegar",
        sku: "ACV-001",
        barcode: null,
        status: "active",
        unit_of_measure: "bottle",
        category_id: null,
        product_costs: [{ cost_price: "4.00" }],
      },
    },
    {
      product_id: "prod-03",
      quantity: "3.0000",
      reorder_point: "10.0000",
      reorder_quantity: "25.0000",
      version: 1,
      products: {
        id: "prod-03",
        name: "Chai Tea Bags",
        sku: "TEA-003",
        barcode: null,
        status: "active",
        unit_of_measure: "box",
        category_id: null,
        product_costs: [{ cost_price: "5.00" }],
      },
    },
    {
      product_id: "prod-02",
      quantity: "2.0000",
      reorder_point: "5.0000",
      reorder_quantity: "20.0000",
      version: 1,
      products: {
        id: "prod-02",
        name: "Banana Chips Organic",
        sku: "SNK-002",
        barcode: null,
        status: "active",
        unit_of_measure: "bag",
        category_id: null,
        product_costs: [{ cost_price: "1.75" }],
      },
    },
    {
      product_id: "prod-06",
      quantity: "50.0000",
      reorder_point: "10.0000",
      reorder_quantity: "30.0000",
      version: 1,
      products: {
        id: "prod-06",
        name: "Espresso Roast Coffee",
        sku: "COF-006",
        barcode: null,
        status: "active",
        unit_of_measure: "kg",
        category_id: null,
        product_costs: [{ cost_price: "12.00" }],
      },
    },
    {
      product_id: "prod-05",
      quantity: "100.0000",
      reorder_point: null,
      reorder_quantity: null,
      version: 1,
      products: {
        id: "prod-05",
        name: "Earl Grey Tea Loose",
        sku: "TEA-005",
        barcode: null,
        status: "active",
        unit_of_measure: "tin",
        category_id: null,
        product_costs: [{ cost_price: "8.50" }],
      },
    },
  ];

  const createMockQueryBuilder = (mockData: any) => {
    const builder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: mockData, error: null }),
    };
    return builder;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
      ok: true,
      context: mockContext as any,
    });
    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      from: vi.fn().mockReturnValue(createMockQueryBuilder(testDbRows)),
    } as any);
  });

  it("1. Global Priority Sort: out_of_stock=1, low_stock=2, in_stock=3 with name tie-breaker", async () => {
    // Request page 1 with pageSize 10 (all items)
    const result = await getInventoryListAction(mockSlug, {
      sortBy: "stock_status",
      sortOrder: "asc",
      page: 1,
      pageSize: 10,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const names = result.data.items.map((i) => i.productName);

    // out_of_stock items: "Apple Cider Vinegar" and "Dark Chocolate Bar" (both qty=0)
    // broken by name alphabetically:
    expect(names[0]).toBe("Apple Cider Vinegar");
    expect(names[1]).toBe("Dark Chocolate Bar");

    // low_stock items: "Banana Chips Organic" and "Chai Tea Bags" (both 0 < qty <= rp)
    // broken by name alphabetically:
    expect(names[2]).toBe("Banana Chips Organic");
    expect(names[3]).toBe("Chai Tea Bags");

    // in_stock items: "Earl Grey Tea Loose" and "Espresso Roast Coffee"
    // broken by name alphabetically:
    expect(names[4]).toBe("Earl Grey Tea Loose");
    expect(names[5]).toBe("Espresso Roast Coffee");
  });

  it("2. Multi-Page Pagination Invariance: No missing or duplicated records across pages", async () => {
    // Page 1 with pageSize = 2
    const page1Res = await getInventoryListAction(mockSlug, {
      sortBy: "stock_status",
      sortOrder: "asc",
      page: 1,
      pageSize: 2,
    });

    // Page 2 with pageSize = 2
    const page2Res = await getInventoryListAction(mockSlug, {
      sortBy: "stock_status",
      sortOrder: "asc",
      page: 2,
      pageSize: 2,
    });

    // Page 3 with pageSize = 2
    const page3Res = await getInventoryListAction(mockSlug, {
      sortBy: "stock_status",
      sortOrder: "asc",
      page: 3,
      pageSize: 2,
    });

    expect(page1Res.success).toBe(true);
    expect(page2Res.success).toBe(true);
    expect(page3Res.success).toBe(true);

    if (!page1Res.success || !page2Res.success || !page3Res.success) return;

    expect(page1Res.data.totalCount).toBe(6);
    expect(page1Res.data.totalPages).toBe(3);

    const page1Ids = page1Res.data.items.map((i) => i.productId);
    const page2Ids = page2Res.data.items.map((i) => i.productId);
    const page3Ids = page3Res.data.items.map((i) => i.productId);

    // Each page must have exactly 2 items
    expect(page1Ids).toHaveLength(2);
    expect(page2Ids).toHaveLength(2);
    expect(page3Ids).toHaveLength(2);

    // All IDs combined must have 6 unique elements (zero duplicates, zero omissions)
    const allIds = [...page1Ids, ...page2Ids, ...page3Ids];
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(6);

    // Exact order verified across page boundaries:
    expect(page1Ids).toEqual(["prod-01", "prod-04"]);
    expect(page2Ids).toEqual(["prod-02", "prod-03"]);
    expect(page3Ids).toEqual(["prod-05", "prod-06"]);
  });

  it("3. Quantity Sort with Secondary Tie-Breakers: Stable ordering for equal quantities", async () => {
    const result = await getInventoryListAction(mockSlug, {
      sortBy: "quantity",
      sortOrder: "asc",
      page: 1,
      pageSize: 10,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const items = result.data.items;

    // Both prod-01 and prod-04 have quantity 0.
    // prod-01 ("Apple Cider Vinegar") must precede prod-04 ("Dark Chocolate Bar") by name tie-breaker:
    expect(items[0]!.productId).toBe("prod-01");
    expect(items[1]!.productId).toBe("prod-04");

    // Next by quantity: 2 ("Banana Chips"), then 3 ("Chai Tea"), then 50, then 100
    expect(items[2]!.productId).toBe("prod-02");
    expect(items[3]!.productId).toBe("prod-03");
    expect(items[4]!.productId).toBe("prod-06");
    expect(items[5]!.productId).toBe("prod-05");
  });

  it("4. Name Sort Ascending and Descending: Reversible global sorting", async () => {
    const ascRes = await getInventoryListAction(mockSlug, {
      sortBy: "name",
      sortOrder: "asc",
      page: 1,
      pageSize: 10,
    });
    const descRes = await getInventoryListAction(mockSlug, {
      sortBy: "name",
      sortOrder: "desc",
      page: 1,
      pageSize: 10,
    });

    expect(ascRes.success).toBe(true);
    expect(descRes.success).toBe(true);
    if (!ascRes.success || !descRes.success) return;

    const ascNames = ascRes.data.items.map((i) => i.productName);
    const descNames = descRes.data.items.map((i) => i.productName);

    expect(ascNames).toEqual([...descNames].reverse());
  });
});

