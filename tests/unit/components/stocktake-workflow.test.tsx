import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { StocktakeWorkflow } from "@/components/inventory/stocktake-workflow";
import type { InventoryItemRow } from "@/types/inventory";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: mockRefresh,
  }),
}));

describe("StocktakeWorkflow Component (T028, US4, Phase 7)", () => {
  const mockItems: InventoryItemRow[] = [
    {
      productId: "prod-st-1",
      productName: "Dark Roast Coffee Beans",
      sku: "CF-DRK-001",
      barcode: "111222333444",
      categoryName: "Coffee",
      productStatus: "active",
      unitOfMeasure: "bag",
      isDiscrete: true,
      quantity: 30,
      reorderPoint: 10,
      reorderQuantity: 40,
      stockStatus: "in_stock",
      version: 2,
      hasInitialMovement: true,
      unitCost: null,
      totalValue: null,
      currency: "USD",
    },
    {
      productId: "prod-st-2",
      productName: "Organic Green Tea",
      sku: "TEA-GRN-002",
      barcode: null,
      categoryName: "Tea",
      productStatus: "active",
      unitOfMeasure: "box",
      isDiscrete: true,
      quantity: 15,
      reorderPoint: 5,
      reorderQuantity: 20,
      stockStatus: "in_stock",
      version: 1,
      hasInitialMovement: true,
      unitCost: null,
      totalValue: null,
      currency: "USD",
    },
    {
      productId: "prod-st-3",
      productName: "Archived Seasonal Mug",
      sku: "MUG-SEA-003",
      barcode: null,
      categoryName: "Merchandise",
      productStatus: "archived",
      unitOfMeasure: "piece",
      isDiscrete: true,
      quantity: 0,
      reorderPoint: null,
      reorderQuantity: null,
      stockStatus: "out_of_stock",
      version: 1,
      hasInitialMovement: true,
      unitCost: null,
      totalValue: null,
      currency: "USD",
    },
  ];

  const defaultProps = {
    slug: "acme-corp",
    items: mockItems,
    totalCount: 3,
    canAdjustStock: true,
    canViewValuation: false,
    currency: "USD",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. Renders workflow header, summary counter, and table of items", () => {
    render(<StocktakeWorkflow {...defaultProps} />);

    expect(screen.getByText("Cycle Count & Stocktake")).toBeInTheDocument();
    expect(screen.getByText("Back to Inventory")).toBeInTheDocument();
    expect(screen.getByText("Session Counted:")).toBeInTheDocument();
    expect(screen.getByText("0 / 3")).toBeInTheDocument();

    expect(screen.getByText("Dark Roast Coffee Beans")).toBeInTheDocument();
    expect(screen.getByText("Organic Green Tea")).toBeInTheDocument();
    expect(screen.getByText("Archived Seasonal Mug")).toBeInTheDocument();
  });

  it("2. Filters items based on search input", () => {
    render(<StocktakeWorkflow {...defaultProps} />);

    const searchInput = screen.getByTestId("stocktake-search-input");
    fireEvent.change(searchInput, { target: { value: "tea" } });

    expect(screen.getByText("Organic Green Tea")).toBeInTheDocument();
    expect(screen.queryByText("Dark Roast Coffee Beans")).toBeNull();
  });

  it("3. Clicking Count button opens StocktakeModal for the selected product", () => {
    render(<StocktakeWorkflow {...defaultProps} />);

    expect(screen.queryByTestId("stocktake-modal")).toBeNull();

    const countBtn = screen.getByTestId("stocktake-btn-prod-st-1");
    fireEvent.click(countBtn);

    const modal = screen.getByTestId("stocktake-modal");
    expect(modal).toBeInTheDocument();
    expect(within(modal).getByText("Dark Roast Coffee Beans")).toBeInTheDocument();
  });

  it("4. Archived product has Count button disabled", () => {
    render(<StocktakeWorkflow {...defaultProps} />);

    const archivedBtn = screen.getByTestId("stocktake-btn-prod-st-3");
    expect(archivedBtn).toBeDisabled();
  });

  it("5. Gated by permission: shows warning banner and disables count buttons when canAdjustStock is false", () => {
    render(<StocktakeWorkflow {...defaultProps} canAdjustStock={false} />);

    expect(screen.getByTestId("workflow-permission-warning")).toBeInTheDocument();
    expect(screen.getByTestId("stocktake-btn-prod-st-1")).toBeDisabled();
    expect(screen.getByTestId("stocktake-btn-prod-st-2")).toBeDisabled();
  });
});
