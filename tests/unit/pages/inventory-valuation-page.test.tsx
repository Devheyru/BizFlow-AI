import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import InventoryValuationPage from "@/app/[slug]/inventory/valuation/page";
import * as authContext from "@/lib/auth/context";
import * as permissionsModule from "@/lib/inventory/permissions";
import * as inventoryActions from "@/actions/inventory-actions";
import { notFound } from "next/navigation";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getTenantContext: vi.fn(),
}));

vi.mock("@/lib/inventory/permissions", () => ({
  canViewValuation: vi.fn(),
  hasInventoryPermission: vi.fn(),
}));

vi.mock("@/actions/inventory-actions", () => ({
  getInventoryValuationSummaryAction: vi.fn(),
}));

describe("InventoryValuationPage Server Component (T034, Phase 9)", () => {
  const mockTenantContext = {
    organization: {
      id: "org-123",
      name: "Acme Corp",
      slug: "acme",
      currency: "USD",
    },
    membership: {
      id: "mem-123",
      userId: "user-123",
      role: "manager" as const,
      status: "active" as const,
    },
  };

  const mockValuationData = {
    totalValuation: {
      amount: 5400,
      currency: "USD",
      formatted: "$5,400.00",
    },
    totalTrackedProducts: 2,
    valuedProductsCount: 2,
    unvaluedProductsCount: 0,
    zeroStockValuedProductsCount: 0,
    items: [
      {
        productId: "p1",
        productName: "Whole Milk 1L",
        sku: "MILK-001",
        categoryName: "Dairy",
        quantity: 100,
        unitOfMeasure: "unit",
        isDiscrete: true,
        costPrice: 25.0,
        lineValuation: 2500.0,
        currency: "USD",
        stockStatus: "in_stock" as const,
      },
      {
        productId: "p2",
        productName: "Artisan Bread",
        sku: "BREAD-001",
        categoryName: "Bakery",
        quantity: 50,
        unitOfMeasure: "unit",
        isDiscrete: true,
        costPrice: 58.0,
        lineValuation: 2900.0,
        currency: "USD",
        stockStatus: "low_stock" as const,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authContext.getTenantContext).mockResolvedValue(mockTenantContext as any);
  });

  it("1. Calls notFound() when user lacks dual valuation permission", async () => {
    vi.mocked(permissionsModule.canViewValuation).mockReturnValue(false);

    try {
      await InventoryValuationPage({
        params: Promise.resolve({ slug: "acme" }),
        searchParams: Promise.resolve({}),
      });
    } catch {
      // notFound throws in Next.js
    }

    expect(notFound).toHaveBeenCalled();
  });

  it("2. Renders valuation dashboard when user holds both valuation permissions", async () => {
    vi.mocked(permissionsModule.canViewValuation).mockReturnValue(true);
    vi.mocked(inventoryActions.getInventoryValuationSummaryAction).mockResolvedValue({
      success: true,
      data: mockValuationData,
    });

    const jsx = await InventoryValuationPage({
      params: Promise.resolve({ slug: "acme" }),
      searchParams: Promise.resolve({}),
    });

    render(jsx);

    expect(screen.getByTestId("inventory-valuation-page-root")).toBeInTheDocument();
    expect(screen.getByText("Inventory Valuation Summary")).toBeInTheDocument();
    expect(screen.getByTestId("valuation-summary-cards")).toBeInTheDocument();
    expect(screen.getByTestId("valuation-table")).toBeInTheDocument();
    expect(screen.getByText("Whole Milk 1L")).toBeInTheDocument();
    expect(screen.getByText("Artisan Bread")).toBeInTheDocument();
  });

  it("3. Displays unvalued items warning notice when unvalued products exist", async () => {
    vi.mocked(permissionsModule.canViewValuation).mockReturnValue(true);
    vi.mocked(inventoryActions.getInventoryValuationSummaryAction).mockResolvedValue({
      success: true,
      data: {
        ...mockValuationData,
        unvaluedProductsCount: 3,
      },
    });

    const jsx = await InventoryValuationPage({
      params: Promise.resolve({ slug: "acme" }),
      searchParams: Promise.resolve({}),
    });

    render(jsx);

    expect(screen.getByTestId("unvalued-items-notice")).toBeInTheDocument();
    expect(screen.getByText(/3 products have no recorded acquisition cost/i)).toBeInTheDocument();
  });

  it("4. Displays error alert banner when query action returns failure", async () => {
    vi.mocked(permissionsModule.canViewValuation).mockReturnValue(true);
    vi.mocked(inventoryActions.getInventoryValuationSummaryAction).mockResolvedValue({
      success: false,
      error: { code: "DATABASE_ERROR", message: "Failed to connect to database." },
    });

    const jsx = await InventoryValuationPage({
      params: Promise.resolve({ slug: "acme" }),
      searchParams: Promise.resolve({}),
    });

    render(jsx);

    expect(screen.getByTestId("valuation-error-banner")).toBeInTheDocument();
    expect(screen.getByText("Failed to connect to database.")).toBeInTheDocument();
  });
});
