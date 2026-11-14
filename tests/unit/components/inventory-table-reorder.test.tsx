import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InventoryTable } from "@/components/inventory/inventory-table";
import type { InventoryItemRow } from "@/types/inventory";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/acme/inventory",
  useSearchParams: () => new URLSearchParams(),
}));

describe("InventoryTable Reorder Threshold & Low-Stock Badge (T033, T034, US6)", () => {
  const mockLowStockItem: InventoryItemRow = {
    productId: "prod-low",
    productName: "Low Stock Coffee",
    sku: "COF-001",
    barcode: "1234567890",
    categoryName: "Beverages",
    productStatus: "active",
    unitOfMeasure: "unit",
    isDiscrete: true,
    quantity: 5,
    reorderPoint: 10,
    reorderQuantity: 20,
    stockStatus: "low_stock",
    version: 3,
    hasInitialMovement: true,
    unitCost: null,
    totalValue: null,
    currency: null,
  };

  const mockOutOfStockItem: InventoryItemRow = {
    productId: "prod-out",
    productName: "Out of Stock Tea",
    sku: "TEA-001",
    barcode: "0987654321",
    categoryName: "Beverages",
    productStatus: "active",
    unitOfMeasure: "unit",
    isDiscrete: true,
    quantity: 0,
    reorderPoint: 15,
    reorderQuantity: 30,
    stockStatus: "out_of_stock",
    version: 1,
    hasInitialMovement: true,
    unitCost: null,
    totalValue: null,
    currency: null,
  };

  it("1. [T034] Renders Low Stock badge with tooltip displaying configured reorder threshold", () => {
    render(
      <InventoryTable
        items={[mockLowStockItem]}
        totalCount={1}
        page={1}
        pageSize={25}
        totalPages={1}
        canViewValuation={false}
        canAdjustStock={true}
        slug="acme"
      />
    );

    const badge = screen.getByTestId("stock-status-badge-prod-low");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Low Stock");
    expect(badge).toHaveAttribute(
      "title",
      "Low Stock: 5 unit on hand (Reorder threshold: 10 unit)"
    );
  });

  it("2. [T034] Renders Out of Stock badge with tooltip displaying 0 on hand", () => {
    render(
      <InventoryTable
        items={[mockOutOfStockItem]}
        totalCount={1}
        page={1}
        pageSize={25}
        totalPages={1}
        canViewValuation={false}
        canAdjustStock={true}
        slug="acme"
      />
    );

    const badge = screen.getByTestId("stock-status-badge-prod-out");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Out of Stock");
    expect(badge).toHaveAttribute("title", "Out of Stock (0 on hand)");
  });

  it("3. [T033] Renders reorder threshold button when canAdjustStock is true", () => {
    render(
      <InventoryTable
        items={[mockLowStockItem]}
        totalCount={1}
        page={1}
        pageSize={25}
        totalPages={1}
        canViewValuation={false}
        canAdjustStock={true}
        slug="acme"
      />
    );

    const thresholdBtn = screen.getByTestId("thresholds-btn-prod-low");
    expect(thresholdBtn).toBeInTheDocument();
    expect(thresholdBtn).toHaveAttribute("title", "Configure Reorder Thresholds");
  });

  it("4. [T033] Hides reorder threshold button when canAdjustStock is false", () => {
    render(
      <InventoryTable
        items={[mockLowStockItem]}
        totalCount={1}
        page={1}
        pageSize={25}
        totalPages={1}
        canViewValuation={false}
        canAdjustStock={false}
        slug="acme"
      />
    );

    expect(screen.queryByTestId("thresholds-btn-prod-low")).not.toBeInTheDocument();
  });

  it("5. [T033] Clicking reorder threshold button triggers onThresholdClick callback with item", () => {
    const onThresholdClick = vi.fn();
    render(
      <InventoryTable
        items={[mockLowStockItem]}
        totalCount={1}
        page={1}
        pageSize={25}
        totalPages={1}
        canViewValuation={false}
        canAdjustStock={true}
        slug="acme"
        onThresholdClick={onThresholdClick}
      />
    );

    const thresholdBtn = screen.getByTestId("thresholds-btn-prod-low");
    fireEvent.click(thresholdBtn);

    expect(onThresholdClick).toHaveBeenCalledWith(mockLowStockItem);
  });
});
