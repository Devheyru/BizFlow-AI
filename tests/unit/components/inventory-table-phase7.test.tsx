import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { InventoryTable } from "@/components/inventory/inventory-table";
import type { InventoryItemRow } from "@/types/inventory";

const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    refresh: mockRefresh,
  }),
  usePathname: () => "/acme-corp/inventory",
  useSearchParams: () => new URLSearchParams(),
}));

describe("InventoryTable Phase 7 Modal Wiring (T030, US4)", () => {
  const mockItems: InventoryItemRow[] = [
    {
      productId: "prod-phase7-1",
      productName: "Ethiopian Yirgacheffe Beans",
      sku: "COF-ETH-001",
      barcode: "1234567890123",
      categoryName: "Coffee",
      productStatus: "active",
      unitOfMeasure: "kg",
      isDiscrete: false,
      quantity: 50,
      reorderPoint: 20,
      reorderQuantity: 60,
      stockStatus: "in_stock",
      version: 2,
      hasInitialMovement: true,
      unitCost: null,
      totalValue: null,
      currency: "USD",
    },
    {
      productId: "prod-phase7-2",
      productName: "Archived Vintage Ceramic Cup",
      sku: "CUP-ARC-002",
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
    items: mockItems,
    totalCount: 2,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    canViewValuation: false,
    canReceiveStock: true,
    canAdjustStock: true,
    slug: "acme-corp",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. Renders Adjust, Count (Stocktake), and Threshold action buttons when canAdjustStock is true", () => {
    render(<InventoryTable {...defaultProps} />);

    expect(screen.getByTestId("adjust-btn-prod-phase7-1")).toBeInTheDocument();
    expect(screen.getByTestId("stocktake-btn-prod-phase7-1")).toBeInTheDocument();
    expect(screen.getByTestId("thresholds-btn-prod-phase7-1")).toBeInTheDocument();

    // Archived product should NOT have adjust or stocktake buttons
    expect(screen.queryByTestId("adjust-btn-prod-phase7-2")).toBeNull();
    expect(screen.queryByTestId("stocktake-btn-prod-phase7-2")).toBeNull();
  });

  it("2. Omit all adjustment, stocktake, and threshold buttons when canAdjustStock is false", () => {
    render(<InventoryTable {...defaultProps} canAdjustStock={false} />);

    expect(screen.queryByTestId("adjust-btn-prod-phase7-1")).toBeNull();
    expect(screen.queryByTestId("stocktake-btn-prod-phase7-1")).toBeNull();
    expect(screen.queryByTestId("thresholds-btn-prod-phase7-1")).toBeNull();
  });

  it("3. Clicking Adjust button opens AdjustStockModal with product information", () => {
    render(<InventoryTable {...defaultProps} />);

    expect(screen.queryByTestId("adjust-stock-modal")).toBeNull();

    fireEvent.click(screen.getByTestId("adjust-btn-prod-phase7-1"));

    const modal = screen.getByTestId("adjust-stock-modal");
    expect(modal).toBeInTheDocument();
    expect(within(modal).getByText("Adjust Stock Balance")).toBeInTheDocument();
    expect(within(modal).getByText("Ethiopian Yirgacheffe Beans")).toBeInTheDocument();
  });

  it("4. Clicking Count (Stocktake) button opens StocktakeModal with product information", () => {
    render(<InventoryTable {...defaultProps} />);

    expect(screen.queryByTestId("stocktake-modal")).toBeNull();

    fireEvent.click(screen.getByTestId("stocktake-btn-prod-phase7-1"));

    const modal = screen.getByTestId("stocktake-modal");
    expect(modal).toBeInTheDocument();
    expect(within(modal).getByText("Stocktake / Physical Count")).toBeInTheDocument();
    expect(within(modal).getByText("Ethiopian Yirgacheffe Beans")).toBeInTheDocument();
  });

  it("5. Clicking Thresholds button opens ReorderThresholdModal with product information", () => {
    render(<InventoryTable {...defaultProps} />);

    expect(screen.queryByTestId("reorder-threshold-modal")).toBeNull();

    fireEvent.click(screen.getByTestId("thresholds-btn-prod-phase7-1"));

    const modal = screen.getByTestId("reorder-threshold-modal");
    expect(modal).toBeInTheDocument();
    expect(within(modal).getByText("Reorder Thresholds")).toBeInTheDocument();
    expect(within(modal).getByText("Ethiopian Yirgacheffe Beans")).toBeInTheDocument();
  });
});
