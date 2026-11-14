import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import StocktakePage from "@/app/[slug]/inventory/stocktake/page";
import StocktakeAliasPage from "@/app/[slug]/stocktake/page";
import * as authContext from "@/lib/auth/context";
import * as inventoryPermissions from "@/lib/inventory/permissions";
import * as inventoryActions from "@/actions/inventory-actions";
import { notFound, redirect } from "next/navigation";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  redirect: vi.fn(),
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/lib/auth/context", () => ({
  getTenantContext: vi.fn(),
}));

vi.mock("@/lib/inventory/permissions", () => ({
  hasInventoryPermission: vi.fn(),
  canViewValuation: vi.fn(),
}));

vi.mock("@/actions/inventory-actions", () => ({
  getInventoryListAction: vi.fn(),
}));

describe("Stocktake Page & Alias (T028, US4, Phase 7)", () => {
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
      user_id: "user-1",
      organization_id: "org-1111-2222-3333-4444",
      role: "manager",
      is_active: true,
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
    },
    user: {
      id: "user-1",
      email: "manager@alpharetail.test",
    },
    permissions: ["inventory:read", "inventory:adjust"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. Fails closed (notFound) when caller lacks inventory:read permission", async () => {
    vi.mocked(authContext.getTenantContext).mockResolvedValue(mockContext as any);
    vi.mocked(inventoryPermissions.hasInventoryPermission).mockReturnValue(false);

    await StocktakePage({
      params: Promise.resolve({ slug: mockSlug }),
    });

    expect(notFound).toHaveBeenCalled();
  });

  it("2. Renders StocktakeWorkflow with inventory items when authorized", async () => {
    vi.mocked(authContext.getTenantContext).mockResolvedValue(mockContext as any);
    vi.mocked(inventoryPermissions.hasInventoryPermission).mockImplementation(
      (_ctx, perm) => perm === "inventory:read" || perm === "inventory:adjust"
    );
    vi.mocked(inventoryPermissions.canViewValuation).mockReturnValue(false);

    vi.mocked(inventoryActions.getInventoryListAction).mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            productId: "prod-1",
            productName: "Espresso Beans",
            sku: "COF-001",
            barcode: null,
            categoryName: "Coffee",
            productStatus: "active",
            unitOfMeasure: "kg",
            isDiscrete: false,
            quantity: 20,
            reorderPoint: 5,
            reorderQuantity: 10,
            stockStatus: "in_stock",
            version: 1,
            hasInitialMovement: true,
            unitCost: null,
            totalValue: null,
            currency: "USD",
          },
        ],
        totalCount: 1,
        page: 1,
        pageSize: 100,
        totalPages: 1,
      },
    });

    const jsx = await StocktakePage({
      params: Promise.resolve({ slug: mockSlug }),
    });

    render(jsx);

    expect(screen.getByText("Cycle Count & Stocktake")).toBeInTheDocument();
    expect(screen.getByText("Espresso Beans")).toBeInTheDocument();
  });

  it("3. Alias route redirects to /slug/inventory/stocktake", async () => {
    await StocktakeAliasPage({
      params: Promise.resolve({ slug: mockSlug }),
    });

    expect(redirect).toHaveBeenCalledWith(`/${mockSlug}/inventory/stocktake`);
  });
});
