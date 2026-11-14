import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ProductDetailPage from "@/app/[slug]/products/[productId]/page";
import * as authContext from "@/lib/auth/context";
import * as authPermissions from "@/lib/auth/permissions";
import * as inventoryPermissions from "@/lib/inventory/permissions";
import * as inventoryActions from "@/actions/inventory-actions";
import * as supabaseServer from "@/lib/supabase/server";
import { notFound } from "next/navigation";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/test-org/products/prod-1",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock auth context
vi.mock("@/lib/auth/context", () => ({
  getTenantContext: vi.fn(),
}));

// Mock permissions
vi.mock("@/lib/auth/permissions", () => ({
  hasPermission: vi.fn(),
}));

vi.mock("@/lib/inventory/permissions", () => ({
  hasInventoryPermission: vi.fn(),
  canViewValuation: vi.fn(),
}));

// Mock Supabase server client
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

// Mock product image actions
vi.mock("@/actions/product-actions", () => ({
  getSignedProductImageUrlAction: vi.fn().mockResolvedValue({ success: true, data: { signedUrl: null } }),
}));

// Mock inventory actions
vi.mock("@/actions/inventory-actions", () => ({
  getInventoryProductAction: vi.fn(),
}));

// Mock InventorySummaryCard to isolate server-page composition in jsdom test runner
vi.mock("@/app/[slug]/products/[productId]/components/inventory-summary-card", () => ({
  InventorySummaryCard: ({ slug, productId }: { slug: string; productId: string }) => (
    <div data-testid="inventory-summary-card">
      <span data-testid="inventory-current-quantity">50 kg</span>
      <span data-testid="inventory-stock-status-badge">In Stock</span>
      <span data-testid="inventory-reorder-threshold">10 kg</span>
      <span data-testid="inventory-card-slug">{slug}</span>
      <span data-testid="inventory-card-product-id">{productId}</span>
    </div>
  ),
}));

describe("ProductDetailPage Server Component & T035 Integration", () => {
  const mockSlug = "alpha-store";
  const mockProductId = "prod-1111-2222-3333";

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
      status: "active",
    },
    user: {
      id: "user-1",
      email: "manager@alpharetail.com",
    },
    permissions: ["products:read", "inventory:read"],
  };

  const mockProductRow = {
    id: mockProductId,
    organization_id: "org-1111-2222-3333-4444",
    name: "Specialty Roasted Beans",
    description: "Premium single-origin beans.",
    sku: "BEAN-001",
    barcode: "1234567890123",
    category_id: null,
    unit_of_measure: "kg",
    selling_price: 25.0,
    image_url: null,
    status: "active",
    version: 1,
    created_at: "2026-11-10T00:00:00Z",
    updated_at: "2026-11-10T00:00:00Z",
    created_by: "user-1",
    updated_by: "user-1",
  };

  const createMockSupabase = () => ({
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "products") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: mockProductRow,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "product_costs") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { cost_price: 15.0 },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "product_categories") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "organization_audit_events") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              contains: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(notFound).mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
    vi.mocked(authContext.getTenantContext).mockResolvedValue(mockContext as any);
    vi.mocked(supabaseServer.createClient).mockResolvedValue(createMockSupabase() as any);
  });

  it("1. Fails closed (notFound) when caller lacks products:read permission", async () => {
    vi.mocked(authPermissions.hasPermission).mockImplementation((_ctx, perm) => {
      if (perm === "products:read") return false;
      return true;
    });

    await expect(
      ProductDetailPage({
        params: Promise.resolve({ slug: mockSlug, productId: mockProductId }),
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("2. When caller has inventory:read, embeds InventorySummaryCard in product details", async () => {
    vi.mocked(authPermissions.hasPermission).mockImplementation((_ctx, perm) => {
      if (perm === "products:read") return true;
      if (perm === "products:read_cost") return false;
      return false;
    });
    vi.mocked(inventoryPermissions.hasInventoryPermission).mockImplementation((_ctx, perm) => {
      if (perm === "inventory:read") return true;
      return false;
    });

    vi.mocked(inventoryActions.getInventoryProductAction).mockResolvedValueOnce({
      success: true,
      data: {
        productId: mockProductId,
        productName: "Specialty Roasted Beans",
        sku: "BEAN-001",
        barcode: "1234567890123",
        unitOfMeasure: "kg",
        isDiscrete: false,
        productStatus: "active",
        quantity: 50.0,
        reorderPoint: 10.0,
        reorderQuantity: 25.0,
        stockStatus: "in_stock",
        version: 1,
        lastMovementAt: "2026-11-14T08:00:00Z",
        unitCost: null,
        totalValue: null,
        currency: null,
      },
    });

    const jsx = await ProductDetailPage({
      params: Promise.resolve({ slug: mockSlug, productId: mockProductId }),
    });

    render(jsx);

    expect(screen.getByText("Specialty Roasted Beans")).toBeInTheDocument();
    expect(screen.getByTestId("inventory-summary-card")).toBeInTheDocument();
    expect(screen.getByTestId("inventory-current-quantity")).toHaveTextContent("50 kg");
    expect(screen.getByTestId("inventory-stock-status-badge")).toHaveTextContent("In Stock");
    expect(screen.getByTestId("inventory-reorder-threshold")).toHaveTextContent("10 kg");
  });

  it("3. When caller lacks inventory:read, omits InventorySummaryCard entirely from product details", async () => {
    vi.mocked(authPermissions.hasPermission).mockImplementation((_ctx, perm) => {
      if (perm === "products:read") return true;
      return false;
    });
    vi.mocked(inventoryPermissions.hasInventoryPermission).mockImplementation((_ctx, perm) => {
      if (perm === "inventory:read") return false;
      return false;
    });

    const jsx = await ProductDetailPage({
      params: Promise.resolve({ slug: mockSlug, productId: mockProductId }),
    });

    render(jsx);

    expect(screen.getByText("Specialty Roasted Beans")).toBeInTheDocument();
    expect(screen.queryByTestId("inventory-summary-card")).toBeNull();
    expect(screen.queryByTestId("inventory-current-quantity")).toBeNull();
  });
});
