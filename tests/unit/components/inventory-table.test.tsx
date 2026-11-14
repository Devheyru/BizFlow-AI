import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { InventoryTable } from "@/components/inventory/inventory-table";
import type { InventoryItemRow } from "@/types/inventory";

const mockPush = vi.fn();
const mockPathname = "/test-store/inventory";
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}));

describe("InventoryTable Component (T022, FR-INV-001, FR-INV-003, FR-INV-020, US1)", () => {
  const mockSlug = "test-store";

  const mockItems: InventoryItemRow[] = [
    {
      productId: "prod-1",
      productName: "Espresso Dark Roast Beans",
      sku: "COF-ESP-001",
      barcode: "1234567890123",
      categoryName: "Coffee",
      productStatus: "active",
      unitOfMeasure: "kg",
      isDiscrete: false,
      quantity: 45.5,
      reorderPoint: 20.0,
      reorderQuantity: 50.0,
      stockStatus: "in_stock",
      version: 1,
      hasInitialMovement: true,
      unitCost: 12.5,
      totalValue: 568.75,
      currency: "USD",
    },
    {
      productId: "prod-2",
      productName: "Ceramic Coffee Mug 12oz",
      sku: "MUG-CER-002",
      barcode: "9876543210987",
      categoryName: "Merchandise",
      productStatus: "active",
      unitOfMeasure: "piece",
      isDiscrete: true,
      quantity: 5,
      reorderPoint: 10,
      reorderQuantity: 25,
      stockStatus: "low_stock",
      version: 2,
      hasInitialMovement: true,
      unitCost: 4.0,
      totalValue: 20.0,
      currency: "USD",
    },
    {
      productId: "prod-3",
      productName: "Paper Coffee Filters #4",
      sku: "FLT-PAP-003",
      barcode: null,
      categoryName: null,
      productStatus: "active",
      unitOfMeasure: "box",
      isDiscrete: true,
      quantity: 0,
      reorderPoint: 15,
      reorderQuantity: 30,
      stockStatus: "out_of_stock",
      version: 3,
      hasInitialMovement: false,
      unitCost: 2.25,
      totalValue: 0,
      currency: "USD",
    },
    {
      productId: "prod-4",
      productName: "Discontinued Syrup Vanilla",
      sku: "SYR-DIS-004",
      barcode: null,
      categoryName: "Syrups",
      productStatus: "archived",
      unitOfMeasure: "bottle",
      isDiscrete: true,
      quantity: 0,
      reorderPoint: null,
      reorderQuantity: null,
      stockStatus: "out_of_stock",
      version: 1,
      hasInitialMovement: false,
      unitCost: 3.5,
      totalValue: 0,
      currency: "USD",
    },
    {
      productId: "prod-5",
      productName: "Organic Green Tea",
      sku: "TEA-GRN-005",
      barcode: null,
      categoryName: "Tea",
      productStatus: "active",
      unitOfMeasure: "box",
      isDiscrete: true,
      quantity: 0,
      reorderPoint: 10,
      reorderQuantity: 20,
      stockStatus: "out_of_stock",
      version: 4,
      hasInitialMovement: true,
      unitCost: 5.0,
      totalValue: 0,
      currency: "USD",
    },
    {
      productId: "prod-6",
      productName: "Caramel Drizzle Syrup",
      sku: "SYR-CAR-006",
      barcode: null,
      categoryName: "Syrups",
      productStatus: "active",
      unitOfMeasure: "bottle",
      isDiscrete: true,
      quantity: 0,
      reorderPoint: 5,
      reorderQuantity: 10,
      stockStatus: "out_of_stock",
      version: 2,
      hasInitialMovement: true, // Non-initial movement history exists (e.g. restocked then damaged to 0)
      unitCost: 6.0,
      totalValue: 0,
      currency: "USD",
    },
    {
      productId: "prod-7",
      productName: "Seasonal Pumpkin Spice",
      sku: "SYR-PMP-007",
      barcode: null,
      categoryName: "Syrups",
      productStatus: "inactive", // Inactive product status
      unitOfMeasure: "bottle",
      isDiscrete: true,
      quantity: 0,
      reorderPoint: 5,
      reorderQuantity: 10,
      stockStatus: "out_of_stock",
      version: 1,
      hasInitialMovement: false, // Zero stock, no movement history, BUT inactive!
      unitCost: 7.0,
      totalValue: 0,
      currency: "USD",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  it("1. Renders table rows with product details, stock statuses, and formatted quantities", () => {
    render(
      <InventoryTable
        items={mockItems}
        totalCount={4}
        page={1}
        pageSize={20}
        totalPages={1}
        canViewValuation={false}
        slug={mockSlug}
      />
    );

    // Products rendered
    expect(screen.getByText("Espresso Dark Roast Beans")).toBeInTheDocument();
    expect(screen.getAllByText("COF-ESP-001").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("1234567890123")).toBeInTheDocument();
    expect(screen.getByText("Coffee")).toBeInTheDocument();

    // Quantities with UOM
    expect(screen.getByTestId("inventory-quantity-prod-1")).toHaveTextContent("45.5 kg");
    expect(screen.getByTestId("inventory-quantity-prod-2")).toHaveTextContent("5 piece");
    expect(screen.getByTestId("inventory-quantity-prod-3")).toHaveTextContent("0 box");

    // Stock status badges
    expect(screen.getByTestId("stock-status-badge-prod-1")).toHaveTextContent("In Stock");
    expect(screen.getByTestId("stock-status-badge-prod-2")).toHaveTextContent("Low Stock");
    expect(screen.getByTestId("stock-status-badge-prod-3")).toHaveTextContent("Out of Stock");
    expect(screen.getByTestId("stock-status-badge-prod-4")).toHaveTextContent("[Archived]");
  });

  it("2. Applies visual row highlight for low stock and out of stock items", () => {
    render(
      <InventoryTable
        items={mockItems}
        totalCount={4}
        page={1}
        pageSize={20}
        totalPages={1}
        canViewValuation={false}
        slug={mockSlug}
      />
    );

    const rowOutOfStock = screen.getByTestId("inventory-row-prod-3");
    expect(rowOutOfStock.className).toContain("border-l-red-500");

    const rowLowStock = screen.getByTestId("inventory-row-prod-2");
    expect(rowLowStock.className).toContain("border-l-amber-500");

    const rowArchived = screen.getByTestId("inventory-row-prod-4");
    expect(rowArchived.className).toContain("border-l-gray-300");
  });

  it("3. Valuation Gating: Renders Unit Cost and Total Value when canViewValuation is true", () => {
    render(
      <InventoryTable
        items={mockItems}
        totalCount={4}
        page={1}
        pageSize={20}
        totalPages={1}
        canViewValuation={true}
        slug={mockSlug}
      />
    );

    // Headers present
    expect(screen.getByTestId("valuation-th-unit-cost")).toBeInTheDocument();
    expect(screen.getByTestId("valuation-th-total-value")).toBeInTheDocument();

    // Cells present
    expect(screen.getByTestId("valuation-td-unit-cost-prod-1")).toHaveTextContent("$12.50");
    expect(screen.getByTestId("valuation-td-total-value-prod-1")).toHaveTextContent("$568.75");
  });

  it("4. Valuation Confidentiality: Completely omits Unit Cost and Total Value when canViewValuation is false", () => {
    render(
      <InventoryTable
        items={mockItems}
        totalCount={4}
        page={1}
        pageSize={20}
        totalPages={1}
        canViewValuation={false}
        slug={mockSlug}
      />
    );

    // Headers strictly omitted
    expect(screen.queryByTestId("valuation-th-unit-cost")).toBeNull();
    expect(screen.queryByTestId("valuation-th-total-value")).toBeNull();

    // Cells strictly omitted
    expect(screen.queryByTestId("valuation-td-unit-cost-prod-1")).toBeNull();
    expect(screen.queryByTestId("valuation-td-total-value-prod-1")).toBeNull();
    expect(screen.queryByText("$568.75")).toBeNull();
  });

  it("5. Header Sorting: Clicking sortable headers updates URL search params", () => {
    render(
      <InventoryTable
        items={mockItems}
        totalCount={4}
        page={1}
        pageSize={20}
        totalPages={1}
        canViewValuation={false}
        sortBy="stock_status"
        sortOrder="asc"
        slug={mockSlug}
      />
    );

    // Click SKU header
    const skuSortBtn = screen.getByTestId("sort-by-sku-btn");
    fireEvent.click(skuSortBtn);

    expect(mockPush).toHaveBeenCalledWith(
      expect.stringContaining("sortBy=sku&sortOrder=asc")
    );

    // Click Stock Status header again to toggle to desc
    const stockSortBtn = screen.getByTestId("sort-by-stock-status-btn");
    fireEvent.click(stockSortBtn);

    expect(mockPush).toHaveBeenCalledWith(
      expect.stringContaining("sortBy=stock_status&sortOrder=desc")
    );
  });

  it("6. Pagination: Navigates pages and modifies page size", () => {
    render(
      <InventoryTable
        items={mockItems}
        totalCount={50}
        page={2}
        pageSize={10}
        totalPages={5}
        canViewValuation={false}
        slug={mockSlug}
      />
    );

    // Indicator
    expect(screen.getByTestId("inventory-page-indicator")).toHaveTextContent("Page 2 of 5");
    expect(screen.getByTestId("inventory-pagination")).toHaveTextContent("Showing 11 to 20 of 50 products");

    // Next page
    const nextBtn = screen.getByTestId("inventory-next-page-btn");
    fireEvent.click(nextBtn);
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("page=3"));

    // Prev page
    const prevBtn = screen.getByTestId("inventory-prev-page-btn");
    fireEvent.click(prevBtn);
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("page=1"));

    // Change page size
    const select = screen.getByTestId("inventory-page-size-select");
    fireEvent.change(select, { target: { value: "25" } });
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("pageSize=25"));
  });

  it("7. Empty State: Displays empty state with reset filters button when filters are active", () => {
    render(
      <InventoryTable
        items={[]}
        totalCount={0}
        page={1}
        pageSize={20}
        totalPages={1}
        canViewValuation={false}
        slug={mockSlug}
        hasActiveFilters={true}
      />
    );

    expect(screen.getByTestId("inventory-empty-state")).toBeInTheDocument();
    expect(screen.getByText("No matching inventory")).toBeInTheDocument();

    const resetBtn = screen.getByTestId("inventory-clear-filters-btn");
    expect(resetBtn).toBeInTheDocument();
    fireEvent.click(resetBtn);
    expect(mockPush).toHaveBeenCalledWith(mockPathname);
  });

  it("8. Empty State: Displays default empty message when no items and no active filters", () => {
    render(
      <InventoryTable
        items={[]}
        totalCount={0}
        page={1}
        pageSize={20}
        totalPages={1}
        canViewValuation={false}
        slug={mockSlug}
        hasActiveFilters={false}
      />
    );

    expect(screen.getByTestId("inventory-empty-state")).toBeInTheDocument();
    expect(screen.getByText("No inventory tracked")).toBeInTheDocument();
    expect(screen.queryByTestId("inventory-clear-filters-btn")).toBeNull();
  });

  it("9. Action Triggers: Restock button rendered when canReceiveStock is true and product is active", () => {
    const onRestockMock = vi.fn();
    render(
      <InventoryTable
        items={mockItems}
        totalCount={4}
        page={1}
        pageSize={20}
        totalPages={1}
        canViewValuation={false}
        canReceiveStock={true}
        onRestockClick={onRestockMock}
        slug={mockSlug}
      />
    );

    const restockBtn = screen.getByTestId("restock-btn-prod-1");
    expect(restockBtn).toBeInTheDocument();

    fireEvent.click(restockBtn);
    expect(onRestockMock).toHaveBeenCalledWith(mockItems[0]);

    // Archived product should NOT have restock button
    expect(screen.queryByTestId("restock-btn-prod-4")).toBeNull();
  });

  it("10. Action Triggers: Adjust button rendered when canAdjustStock is true and product is not archived", () => {
    const onAdjustMock = vi.fn();
    render(
      <InventoryTable
        items={mockItems}
        totalCount={4}
        page={1}
        pageSize={20}
        totalPages={1}
        canViewValuation={false}
        canAdjustStock={true}
        onAdjustClick={onAdjustMock}
        slug={mockSlug}
      />
    );

    const adjustBtn = screen.getByTestId("adjust-btn-prod-2");
    expect(adjustBtn).toBeInTheDocument();

    fireEvent.click(adjustBtn);
    expect(onAdjustMock).toHaveBeenCalledWith(mockItems[1]);

    // Archived product should NOT have adjust button
    expect(screen.queryByTestId("adjust-btn-prod-4")).toBeNull();
  });

  it("11. Action Triggers: Clicking Restock button opens RestockModal with product snapshot", () => {
    render(
      <InventoryTable
        items={mockItems}
        totalCount={4}
        page={1}
        pageSize={20}
        totalPages={1}
        canViewValuation={false}
        canReceiveStock={true}
        slug={mockSlug}
      />
    );

    // Initial state: modal should not be rendered
    expect(screen.queryByTestId("restock-modal")).toBeNull();

    // Click restock on product 1
    const restockBtn = screen.getByTestId("restock-btn-prod-1");
    fireEvent.click(restockBtn);

    // Modal opens with product info
    const modal = screen.getByTestId("restock-modal");
    expect(modal).toBeInTheDocument();
    expect(within(modal).getByRole("heading", { name: "Receive Stock" })).toBeInTheDocument();
    expect(within(modal).getByText("Espresso Dark Roast Beans")).toBeInTheDocument();
    expect(within(modal).getByText("COF-ESP-001")).toBeInTheDocument();
  });

  // ============================================================================
  // T025: Initial Opening Stock Button Visibility & Integration Tests (US3)
  // ============================================================================
  describe("T025: Initial Opening Stock Action Button (US3)", () => {
    it("12. Initial-stock button is visible when canReceiveStock is true, stock is 0, and hasInitialMovement is false", () => {
      render(
        <InventoryTable
          items={mockItems}
          totalCount={5}
          page={1}
          pageSize={20}
          totalPages={1}
          canViewValuation={false}
          canReceiveStock={true}
          slug={mockSlug}
        />
      );

      // prod-3 has quantity=0, hasInitialMovement=false, productStatus='active' -> Opening Stock button VISIBLE
      const initialStockBtn = screen.getByTestId("initial-stock-btn-prod-3");
      expect(initialStockBtn).toBeInTheDocument();
      expect(within(initialStockBtn).getByText(/Opening Stock/i)).toBeInTheDocument();
    });

    it("13. Initial-stock button is hidden when user lacks inventory:receive permission", () => {
      render(
        <InventoryTable
          items={mockItems}
          totalCount={5}
          page={1}
          pageSize={20}
          totalPages={1}
          canViewValuation={false}
          canReceiveStock={false}
          slug={mockSlug}
        />
      );

      // No initial-stock buttons rendered when canReceiveStock is false
      expect(screen.queryByTestId("initial-stock-btn-prod-3")).toBeNull();
    });

    it("14. Initial-stock button is hidden when current stock is greater than zero", () => {
      render(
        <InventoryTable
          items={mockItems}
          totalCount={5}
          page={1}
          pageSize={20}
          totalPages={1}
          canViewValuation={false}
          canReceiveStock={true}
          slug={mockSlug}
        />
      );

      // prod-1 (qty 45.5) and prod-2 (qty 5) must NOT have initial-stock button
      expect(screen.queryByTestId("initial-stock-btn-prod-1")).toBeNull();
      expect(screen.queryByTestId("initial-stock-btn-prod-2")).toBeNull();
    });

    it("15. Initial-stock button is hidden when initial movement already exists (even with 0 stock)", () => {
      render(
        <InventoryTable
          items={mockItems}
          totalCount={7}
          page={1}
          pageSize={20}
          totalPages={1}
          canViewValuation={false}
          canReceiveStock={true}
          slug={mockSlug}
        />
      );

      // prod-5 has quantity=0 but hasInitialMovement=true -> MUST NOT render initial-stock button!
      expect(screen.queryByTestId("initial-stock-btn-prod-5")).toBeNull();
    });

    it("15b. Initial-stock button is hidden when non-initial movement history exists (even with 0 stock)", () => {
      render(
        <InventoryTable
          items={mockItems}
          totalCount={7}
          page={1}
          pageSize={20}
          totalPages={1}
          canViewValuation={false}
          canReceiveStock={true}
          slug={mockSlug}
        />
      );

      // prod-6 has quantity=0 but non-initial movement history exists (hasInitialMovement=true) -> MUST NOT render!
      expect(screen.queryByTestId("initial-stock-btn-prod-6")).toBeNull();
    });

    it("15c. Initial-stock button is hidden when product is inactive or archived", () => {
      render(
        <InventoryTable
          items={mockItems}
          totalCount={7}
          page={1}
          pageSize={20}
          totalPages={1}
          canViewValuation={false}
          canReceiveStock={true}
          slug={mockSlug}
        />
      );

      // prod-4 has quantity=0, hasInitialMovement=false, but productStatus='archived' -> MUST NOT render
      expect(screen.queryByTestId("initial-stock-btn-prod-4")).toBeNull();

      // prod-7 has quantity=0, hasInitialMovement=false, but productStatus='inactive' -> MUST NOT render
      expect(screen.queryByTestId("initial-stock-btn-prod-7")).toBeNull();
    });

    it("16. Clicking Opening Stock button opens RestockModal in initial mode with 'Opening Stock' heading", () => {
      const onInitialStockMock = vi.fn();
      render(
        <InventoryTable
          items={mockItems}
          totalCount={5}
          page={1}
          pageSize={20}
          totalPages={1}
          canViewValuation={false}
          canReceiveStock={true}
          onInitialStockClick={onInitialStockMock}
          slug={mockSlug}
        />
      );

      // Modal closed initially
      expect(screen.queryByTestId("restock-modal")).toBeNull();

      // Click Opening Stock on prod-3
      const initialBtn = screen.getByTestId("initial-stock-btn-prod-3");
      fireEvent.click(initialBtn);

      expect(onInitialStockMock).toHaveBeenCalledWith(mockItems[2]);

      // Modal opens in initial mode
      const modal = screen.getByTestId("restock-modal");
      expect(modal).toBeInTheDocument();
      expect(within(modal).getByRole("heading", { name: "Opening Stock" })).toBeInTheDocument();
      expect(within(modal).getByText("Paper Coffee Filters #4")).toBeInTheDocument();
      expect(within(modal).getByText(/Record initial baseline inventory/i)).toBeInTheDocument();
      expect(within(modal).getByRole("button", { name: /confirm opening stock/i })).toBeInTheDocument();
    });

    it("17. Existing Restock button visibility and behavior remain unchanged alongside Initial Stock button", () => {
      render(
        <InventoryTable
          items={mockItems}
          totalCount={5}
          page={1}
          pageSize={20}
          totalPages={1}
          canViewValuation={false}
          canReceiveStock={true}
          slug={mockSlug}
        />
      );

      // Restock button is still available on active products (prod-1, prod-2, prod-3, prod-5)
      expect(screen.getByTestId("restock-btn-prod-1")).toBeInTheDocument();
      expect(screen.getByTestId("restock-btn-prod-2")).toBeInTheDocument();
      expect(screen.getByTestId("restock-btn-prod-3")).toBeInTheDocument();
      expect(screen.getByTestId("restock-btn-prod-5")).toBeInTheDocument();

      // But prod-4 (archived) has neither
      expect(screen.queryByTestId("restock-btn-prod-4")).toBeNull();
      expect(screen.queryByTestId("initial-stock-btn-prod-4")).toBeNull();
    });
  });
});

