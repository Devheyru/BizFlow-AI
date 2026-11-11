import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import InventoryPage from "@/app/[slug]/inventory/page";
import * as authContext from "@/lib/auth/context";
import * as inventoryPermissions from "@/lib/inventory/permissions";
import * as inventoryActions from "@/actions/inventory-actions";
import * as supabaseServer from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import type { TenantContext } from "@/types/auth";
import type { InventoryOverviewData, PaginatedInventoryResult } from "@/types/inventory";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/test-org/inventory",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock auth context
vi.mock("@/lib/auth/context", () => ({
  getTenantContext: vi.fn(),
}));

// Mock permissions
vi.mock("@/lib/inventory/permissions", () => ({
  hasInventoryPermission: vi.fn(),
  canViewValuation: vi.fn(),
}));

// Mock inventory actions
vi.mock("@/actions/inventory-actions", () => ({
  getInventoryOverviewAction: vi.fn(),
  getInventoryListAction: vi.fn(),
}));

// Mock Supabase server client
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

describe("InventoryPage Server Component (T018, FR-INV-001, US1)", () => {
  const mockSlug = "alpha-store";
  const mockContext = {
    organization: {
      id: "org-1111-2222-3333-4444",
      name: "Alpha Retail",
      slug: mockSlug,
      currency: "USD",
      is_active: true,
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
    },
    role: "manager",
    membership: {
      id: "mem-1",
      user_id: "usr-1",
      organization_id: "org-1111-2222-3333-4444",
      role: "manager",
      status: "active",
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
    },
    permissions: [
      "inventory:read",
      "inventory:receive",
      "inventory:adjust",
      "inventory:history",
      "inventory:read_valuation",
      "products:read_cost",
    ],
    user: {
      id: "usr-1",
      email: "manager@alpharetail.com",
    },
  } as unknown as TenantContext;

  const mockOverviewData: InventoryOverviewData = {
    totalTrackedProducts: 25,
    inStockCount: 20,
    lowStockCount: 3,
    outOfStockCount: 2,
    totalValuation: {
      amount: 15420.5,
      currency: "USD",
      formatted: "$15,420.50",
    },
  };

  const mockListData: PaginatedInventoryResult = {
    items: [
      {
        productId: "prod-1",
        productName: "Espresso Roast Beans",
        sku: "COF-001",
        barcode: "123456",
        categoryName: "Coffee",
        productStatus: "active",
        unitOfMeasure: "kg",
        isDiscrete: false,
        quantity: 15.5,
        reorderPoint: 5.0,
        reorderQuantity: 20.0,
        stockStatus: "in_stock",
        version: 1,
        unitCost: 10.0,
        totalValue: 155.0,
        currency: "USD",
      },
    ],
    totalCount: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  };

  const mockSupabase = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [
              { id: "cat-1", name: "Coffee", status: "active" },
              { id: "cat-2", name: "Tea", status: "active" },
            ],
            error: null,
          }),
        }),
      }),
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(notFound).mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
    vi.mocked(authContext.getTenantContext).mockResolvedValue(mockContext);
    vi.mocked(supabaseServer.createClient).mockResolvedValue(mockSupabase as any);
  });

  it("1. Fail-closed: Serves 404 (notFound) when caller lacks inventory:read permission", async () => {
    vi.mocked(inventoryPermissions.hasInventoryPermission).mockReturnValue(false);

    await expect(
      InventoryPage({
        params: Promise.resolve({ slug: mockSlug }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("2. Authorized: Renders inventory overview, filter bar, and table for Manager", async () => {
    vi.mocked(inventoryPermissions.hasInventoryPermission).mockReturnValue(true);
    vi.mocked(inventoryPermissions.canViewValuation).mockReturnValue(true);

    vi.mocked(inventoryActions.getInventoryOverviewAction).mockResolvedValueOnce({
      success: true,
      data: mockOverviewData,
    });
    vi.mocked(inventoryActions.getInventoryListAction).mockResolvedValueOnce({
      success: true,
      data: mockListData,
    });

    const jsx = await InventoryPage({
      params: Promise.resolve({ slug: mockSlug }),
      searchParams: Promise.resolve({
        search: "Espresso",
        page: "1",
        pageSize: "20",
        sortBy: "name",
        sortOrder: "asc",
      }),
    });

    render(jsx);

    expect(screen.getByTestId("inventory-page-root")).toBeInTheDocument();
    expect(screen.getByText("Inventory & Stock")).toBeInTheDocument();

    // Verify server actions called with sanitized arguments
    expect(inventoryActions.getInventoryOverviewAction).toHaveBeenCalledWith(
      mockSlug,
      false
    );
    expect(inventoryActions.getInventoryListAction).toHaveBeenCalledWith(
      mockSlug,
      expect.objectContaining({
        search: "Espresso",
        page: 1,
        pageSize: 20,
        sortBy: "name",
        sortOrder: "asc",
      })
    );

    // Valuation tile is rendered for authorized Manager
    expect(screen.getByTestId("metric-total-valuation")).toBeInTheDocument();
    expect(screen.getByText("$15,420.50")).toBeInTheDocument();

    // Table rows rendered
    expect(screen.getByText("Espresso Roast Beans")).toBeInTheDocument();

    // Action links
    expect(screen.getByTestId("link-movement-history")).toBeInTheDocument();
    expect(screen.getByTestId("link-stocktake")).toBeInTheDocument();
  });

  it("3. Confidentiality for Cashier: Omit valuation tile and valuation columns", async () => {
    vi.mocked(inventoryPermissions.hasInventoryPermission).mockImplementation(
      (_ctx, perm) => {
        if (perm === "inventory:read") return true;
        return false;
      }
    );
    // Cashier lacks valuation permission
    vi.mocked(inventoryPermissions.canViewValuation).mockReturnValue(false);

    vi.mocked(inventoryActions.getInventoryOverviewAction).mockResolvedValueOnce({
      success: true,
      data: {
        ...mockOverviewData,
        totalValuation: null, // Stripped server-side
      },
    });
    vi.mocked(inventoryActions.getInventoryListAction).mockResolvedValueOnce({
      success: true,
      data: {
        ...mockListData,
        items: [
          {
            ...mockListData.items[0]!,
            unitCost: null, // Stripped server-side
            totalValue: null,
          },
        ],
      },
    });

    const jsx = await InventoryPage({
      params: Promise.resolve({ slug: mockSlug }),
      searchParams: Promise.resolve({}),
    });

    render(jsx);

    // Valuation tile MUST NOT exist
    expect(screen.queryByTestId("metric-total-valuation")).toBeNull();
    expect(screen.queryByText("$15,420.50")).toBeNull();

    // Valuation table columns MUST NOT exist
    expect(screen.queryByTestId("valuation-th-unit-cost")).toBeNull();
    expect(screen.queryByTestId("valuation-th-total-value")).toBeNull();

    // Standard metric cards and product details still present
    expect(screen.getByTestId("metric-total-products")).toBeInTheDocument();
    expect(screen.getByText("Espresso Roast Beans")).toBeInTheDocument();
  });

  it("4. Displays error alert banner when overview action fails", async () => {
    vi.mocked(inventoryPermissions.hasInventoryPermission).mockReturnValue(true);
    vi.mocked(inventoryPermissions.canViewValuation).mockReturnValue(true);

    vi.mocked(inventoryActions.getInventoryOverviewAction).mockResolvedValueOnce({
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to connect to database replica.",
      },
    });
    vi.mocked(inventoryActions.getInventoryListAction).mockResolvedValueOnce({
      success: true,
      data: mockListData,
    });

    const jsx = await InventoryPage({
      params: Promise.resolve({ slug: mockSlug }),
      searchParams: Promise.resolve({}),
    });

    render(jsx);

    expect(screen.getByTestId("overview-error-banner")).toBeInTheDocument();
    expect(
      screen.getByText(/Failed to connect to database replica/)
    ).toBeInTheDocument();
  });
});

