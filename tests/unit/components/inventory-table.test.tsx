import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
      unitCost: 3.5,
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
});

