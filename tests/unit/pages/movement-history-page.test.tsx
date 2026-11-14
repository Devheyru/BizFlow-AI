import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import MovementHistoryPage from "@/app/[slug]/inventory/history/page";
import * as authContext from "@/lib/auth/context";
import * as inventoryPermissions from "@/lib/inventory/permissions";
import * as inventoryActions from "@/actions/inventory-actions";
import * as supabaseServer from "@/lib/supabase/server";
import { notFound } from "next/navigation";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/alpha-store/inventory/history",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/auth/context", () => ({
  getTenantContext: vi.fn(),
}));

vi.mock("@/lib/inventory/permissions", () => ({
  hasInventoryPermission: vi.fn(),
  canViewValuation: vi.fn(),
}));

vi.mock("@/actions/inventory-actions", () => ({
  getMovementHistoryAction: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

describe("Movement History Page (T031, US5, Phase 8)", () => {
  const mockSlug = "alpha-store";
  const mockOrgId = "org-1111-2222-3333-4444";

  const mockContext = {
    organization: {
      id: mockOrgId,
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
      organization_id: mockOrgId,
      role: "manager",
      is_active: true,
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
    },
    user: {
      id: "user-1",
      email: "manager@alpharetail.test",
    },
    permissions: [
      "inventory:read",
      "inventory:history",
      "inventory:read_valuation",
      "products:read_cost",
    ],
  };

  const mockProducts = [
    { id: "p1", name: "Premium Beans", sku: "BEANS-01" },
    { id: "p2", name: "Oat Milk", sku: "MILK-02" },
  ];

  const mockHistoryData = {
    items: [
      {
        id: "m1",
        productId: "p1",
        productName: "Premium Beans",
        sku: "BEANS-01",
        movementType: "restock" as const,
        quantityBefore: 10,
        quantityDelta: 20,
        quantityAfter: 30,
        reason: "Supplier batch delivery",
        referenceId: "PO-100",
        unitCost: 8.5,
        currency: "USD",
        performedBy: {
          id: "user-1",
          fullName: "Manager Dave",
          email: "",
        },
        createdAt: "2026-11-14T09:00:00Z",
      },
    ],
    totalCount: 1,
    page: 1,
    pageSize: 25,
    totalPages: 1,
  };

  const setupSupabaseMock = (products = mockProducts) => {
    const mockOrder = vi.fn().mockResolvedValue({ data: products, error: null });
    const mockEq = vi.fn().mockReturnValue({ order: mockOrder });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      from: mockFrom,
    } as any);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setupSupabaseMock();
  });

  // ==========================================================================
  // 1. Fail-closed authorization guard
  // ==========================================================================
  it("1. Fails closed (notFound) when caller lacks inventory:history permission", async () => {
    vi.mocked(authContext.getTenantContext).mockResolvedValue(mockContext as any);
    vi.mocked(inventoryPermissions.hasInventoryPermission).mockReturnValue(false);

    const result = await MovementHistoryPage({
      params: Promise.resolve({ slug: mockSlug }),
      searchParams: Promise.resolve({}),
    });

    expect(notFound).toHaveBeenCalled();
    expect(result).toBeNull();
  });

  // ==========================================================================
  // 2. Authorized rendering and data fetching
  // ==========================================================================
  it("2. Successfully renders MovementHistoryPage with table when authorized", async () => {
    vi.mocked(authContext.getTenantContext).mockResolvedValue(mockContext as any);
    vi.mocked(inventoryPermissions.hasInventoryPermission).mockReturnValue(true);
    vi.mocked(inventoryPermissions.canViewValuation).mockReturnValue(true);

    vi.mocked(inventoryActions.getMovementHistoryAction).mockResolvedValue({
      success: true,
      data: mockHistoryData,
    });

    const jsx = await MovementHistoryPage({
      params: Promise.resolve({ slug: mockSlug }),
      searchParams: Promise.resolve({}),
    });

    expect(jsx).not.toBeNull();
    render(jsx!);

    // Header and navigation
    expect(screen.getByTestId("movement-history-page-root")).toBeInTheDocument();
    expect(screen.getByTestId("link-back-to-inventory")).toBeInTheDocument();
    expect(screen.getByText("Stock Movement History")).toBeInTheDocument();

    // Table elements
    expect(screen.getByTestId("movement-history-table")).toBeInTheDocument();
    expect(screen.getByText("Premium Beans")).toBeInTheDocument();
    expect(screen.getByText("+20")).toBeInTheDocument();
  });

  // ==========================================================================
  // 3. Valuation Permission Matrix Propagation
  // ==========================================================================
  it("3. Propagates canViewValuation=true to table only when caller holds dual permissions", async () => {
    vi.mocked(authContext.getTenantContext).mockResolvedValue(mockContext as any);
    vi.mocked(inventoryPermissions.hasInventoryPermission).mockReturnValue(true);
    vi.mocked(inventoryPermissions.canViewValuation).mockReturnValue(true);

    vi.mocked(inventoryActions.getMovementHistoryAction).mockResolvedValue({
      success: true,
      data: mockHistoryData,
    });

    const jsx = await MovementHistoryPage({
      params: Promise.resolve({ slug: mockSlug }),
      searchParams: Promise.resolve({}),
    });

    render(jsx!);

    // Unit Cost and Total Cost columns visible in table
    expect(screen.getByTestId("col-unit-cost")).toBeInTheDocument();
    expect(screen.getByTestId("col-total-cost")).toBeInTheDocument();
    expect(screen.getByTestId("unit-cost-m1")).toHaveTextContent("$8.50");
  });

  it("4. Propagates canViewValuation=false to table when canViewValuation returns false", async () => {
    vi.mocked(authContext.getTenantContext).mockResolvedValue(mockContext as any);
    vi.mocked(inventoryPermissions.hasInventoryPermission).mockReturnValue(true);
    vi.mocked(inventoryPermissions.canViewValuation).mockReturnValue(false);

    vi.mocked(inventoryActions.getMovementHistoryAction).mockResolvedValue({
      success: true,
      data: {
        ...mockHistoryData,
        items: [
          {
            ...mockHistoryData.items[0]!,
            unitCost: null,
            currency: null,
          },
        ],
      },
    });

    const jsx = await MovementHistoryPage({
      params: Promise.resolve({ slug: mockSlug }),
      searchParams: Promise.resolve({}),
    });

    render(jsx!);

    // Cost columns strictly absent
    expect(screen.queryByTestId("col-unit-cost")).not.toBeInTheDocument();
    expect(screen.queryByTestId("col-total-cost")).not.toBeInTheDocument();
  });

  // ==========================================================================
  // 4. Query Parameter Parsing
  // ==========================================================================
  it("5. Parses query parameters including YYYY-MM-DD dates converted to ISO bounds", async () => {
    vi.mocked(authContext.getTenantContext).mockResolvedValue(mockContext as any);
    vi.mocked(inventoryPermissions.hasInventoryPermission).mockReturnValue(true);
    vi.mocked(inventoryPermissions.canViewValuation).mockReturnValue(true);

    vi.mocked(inventoryActions.getMovementHistoryAction).mockResolvedValue({
      success: true,
      data: mockHistoryData,
    });

    await MovementHistoryPage({
      params: Promise.resolve({ slug: mockSlug }),
      searchParams: Promise.resolve({
        page: "2",
        pageSize: "50",
        productId: "p1",
        movementType: "restock",
        fromDate: "2026-11-01",
        toDate: "2026-11-10",
      }),
    });

    expect(inventoryActions.getMovementHistoryAction).toHaveBeenCalledWith(
      mockSlug,
      {
        page: 2,
        pageSize: 50,
        productId: "p1",
        movementType: "restock",
        fromDate: "2026-11-01T00:00:00.000Z",
        toDate: "2026-11-10T23:59:59.999Z",
      }
    );
  });

  // ==========================================================================
  // 5. Error Banner Display
  // ==========================================================================
  it("6. Displays error banner when getMovementHistoryAction returns failure", async () => {
    vi.mocked(authContext.getTenantContext).mockResolvedValue(mockContext as any);
    vi.mocked(inventoryPermissions.hasInventoryPermission).mockReturnValue(true);
    vi.mocked(inventoryPermissions.canViewValuation).mockReturnValue(false);

    vi.mocked(inventoryActions.getMovementHistoryAction).mockResolvedValue({
      success: false,
      error: { code: "DB_ERROR", message: "Database connection timed out." },
    });

    const jsx = await MovementHistoryPage({
      params: Promise.resolve({ slug: mockSlug }),
      searchParams: Promise.resolve({}),
    });

    render(jsx!);

    expect(screen.getByTestId("history-error-banner")).toBeInTheDocument();
    expect(screen.getByText(/Database connection timed out/i)).toBeInTheDocument();
  });
});
