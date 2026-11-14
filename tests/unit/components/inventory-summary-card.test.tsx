import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  InventorySummaryCard,
  InventorySummaryCardView,
  InventorySummaryCardSkeleton,
} from "@/app/[slug]/products/[productId]/components/inventory-summary-card";
import * as inventoryActions from "@/actions/inventory-actions";
import type { InventoryProductDetail } from "@/types/inventory";

// Mock server actions
vi.mock("@/actions/inventory-actions", () => ({
  getInventoryProductAction: vi.fn(),
}));

describe("InventorySummaryCard Component (T035, Phase 10)", () => {
  const mockSlug = "retail-hub";
  const mockProductId = "prod-1111-2222-3333";

  const baseInventoryData: InventoryProductDetail = {
    productId: mockProductId,
    productName: "Espresso Beans Medium Roast",
    sku: "COF-ESP-001",
    barcode: "8901234567890",
    unitOfMeasure: "kg",
    isDiscrete: false,
    productStatus: "active",
    quantity: 42.5,
    reorderPoint: 10.0,
    reorderQuantity: 50.0,
    stockStatus: "in_stock",
    version: 3,
    lastMovementAt: "2026-11-14T10:30:00.000Z",
    hasInitialMovement: true,
    unitCost: 12.5,
    totalValue: 531.25,
    currency: "USD",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Authorized user sees the inventory summary
  it("1. Authorized user sees the inventory summary card when inventory data is available", async () => {
    vi.mocked(inventoryActions.getInventoryProductAction).mockResolvedValueOnce({
      success: true,
      data: baseInventoryData,
    });

    const jsx = await InventorySummaryCard({
      slug: mockSlug,
      productId: mockProductId,
    });

    expect(jsx).not.toBeNull();
    render(jsx!);

    expect(screen.getByTestId("inventory-summary-card")).toBeInTheDocument();
    expect(screen.getByText("Inventory & Stock Summary")).toBeInTheDocument();
    expect(
      screen.getByText(/Real-time stock balance, movement, and reorder status/i)
    ).toBeInTheDocument();
  });

  // 2. Current quantity is rendered correctly
  it("2. Current quantity is rendered correctly with formatted unit of measure", () => {
    render(
      <InventorySummaryCardView
        inventory={baseInventoryData}
        slug={mockSlug}
      />
    );

    const qtyElem = screen.getByTestId("inventory-current-quantity");
    expect(qtyElem).toBeInTheDocument();
    expect(qtyElem).toHaveTextContent("42.5 kg");
  });

  // 3. Correct stock status is displayed (In Stock, Low Stock, Out of Stock, [Archived])
  it("3a. Displays 'In Stock' badge with emerald styling when quantity exceeds threshold", () => {
    render(
      <InventorySummaryCardView
        inventory={{
          ...baseInventoryData,
          quantity: 25,
          reorderPoint: 10,
          stockStatus: "in_stock",
        }}
      />
    );

    const badge = screen.getByTestId("inventory-stock-status-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("In Stock");
    expect(badge).toHaveClass("text-emerald-700");
  });

  it("3b. Displays 'Low Stock' badge with warning styling when quantity is at or below threshold", () => {
    render(
      <InventorySummaryCardView
        inventory={{
          ...baseInventoryData,
          quantity: 8,
          reorderPoint: 10,
          stockStatus: "low_stock",
        }}
      />
    );

    const badge = screen.getByTestId("inventory-stock-status-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Low Stock");
    expect(badge).toHaveClass("text-amber-700");
  });

  it("3c. Displays 'Out of Stock' badge with destructive styling when quantity is zero or negative", () => {
    render(
      <InventorySummaryCardView
        inventory={{
          ...baseInventoryData,
          quantity: 0,
          reorderPoint: 10,
          stockStatus: "out_of_stock",
        }}
      />
    );

    const badge = screen.getByTestId("inventory-stock-status-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Out of Stock");
    expect(badge).toHaveClass("text-red-700");
  });

  it("3d. Displays '[Archived]' badge when product status is archived", () => {
    render(
      <InventorySummaryCardView
        inventory={{
          ...baseInventoryData,
          productStatus: "archived",
        }}
      />
    );

    const badge = screen.getByTestId("inventory-stock-status-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("[Archived]");
  });

  // 4. Configured reorder threshold is displayed
  it("4. Configured reorder threshold is displayed with formatted unit of measure", () => {
    render(
      <InventorySummaryCardView
        inventory={{
          ...baseInventoryData,
          reorderPoint: 15.0,
          unitOfMeasure: "kg",
        }}
      />
    );

    const thresholdElem = screen.getByTestId("inventory-reorder-threshold");
    expect(thresholdElem).toBeInTheDocument();
    expect(thresholdElem).toHaveTextContent("15 kg");
  });

  // 5. Missing reorder threshold is handled correctly (never 0)
  it("5. Missing reorder threshold displays 'Not configured' and never interprets null as zero", () => {
    render(
      <InventorySummaryCardView
        inventory={{
          ...baseInventoryData,
          reorderPoint: null,
        }}
      />
    );

    const thresholdElem = screen.getByTestId("inventory-reorder-threshold");
    expect(thresholdElem).toBeInTheDocument();
    expect(thresholdElem).toHaveTextContent("Not configured");
    expect(thresholdElem).not.toHaveTextContent("0");
    expect(
      screen.getByText(/No minimum replenishment point set/i)
    ).toBeInTheDocument();
  });

  it("5b. Explicit zero reorder threshold displays '0 [uom]' rather than 'Not configured'", () => {
    render(
      <InventorySummaryCardView
        inventory={{
          ...baseInventoryData,
          reorderPoint: 0,
          unitOfMeasure: "box",
          isDiscrete: true,
        }}
      />
    );

    const thresholdElem = screen.getByTestId("inventory-reorder-threshold");
    expect(thresholdElem).toHaveTextContent("0 box");
  });

  // 6. Last movement date is displayed correctly
  it("6. Last movement date is displayed with localized timestamp formatting", () => {
    render(
      <InventorySummaryCardView
        inventory={{
          ...baseInventoryData,
          lastMovementAt: "2026-11-14T10:30:00.000Z",
        }}
      />
    );

    const movementElem = screen.getByTestId("inventory-last-movement");
    expect(movementElem).toBeInTheDocument();
    expect(movementElem).toHaveTextContent(/2026/);
    expect(screen.getByText("Audited ledger activity")).toBeInTheDocument();
  });

  // 7. No movement history is handled correctly
  it("7. Gracefully handles products with no movement history recorded", () => {
    render(
      <InventorySummaryCardView
        inventory={{
          ...baseInventoryData,
          lastMovementAt: null,
        }}
      />
    );

    const movementElem = screen.getByTestId("inventory-last-movement");
    expect(movementElem).toBeInTheDocument();
    expect(movementElem).toHaveTextContent("No stock movements recorded");
  });

  // 8. Unauthorized inventory users do not see the card
  it("8. Unauthorized user (FORBIDDEN) causes the card to gracefully return null", async () => {
    vi.mocked(inventoryActions.getInventoryProductAction).mockResolvedValueOnce({
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "Unauthorized: missing inventory:read permission.",
      },
    });

    const jsx = await InventorySummaryCard({
      slug: mockSlug,
      productId: mockProductId,
    });

    expect(jsx).toBeNull();
  });

  // 9. Valuation is visible with both required permissions
  it("9. Valuation section is visible when server provides unitCost and totalValue", () => {
    render(
      <InventorySummaryCardView
        inventory={{
          ...baseInventoryData,
          unitCost: 12.5,
          totalValue: 531.25,
          currency: "USD",
        }}
      />
    );

    expect(screen.getByTestId("inventory-valuation-section")).toBeInTheDocument();
    expect(screen.getByText("Stock Asset Valuation")).toBeInTheDocument();
    expect(screen.getByText("Confidential")).toBeInTheDocument();

    const unitCost = screen.getByTestId("inventory-unit-cost");
    expect(unitCost).toHaveTextContent("$12.50");

    const totalVal = screen.getByTestId("inventory-total-value");
    expect(totalVal).toHaveTextContent("$531.25");
  });

  // 10. Valuation is absent when either permission is missing (unitCost is null)
  it("10. Valuation section is strictly omitted from the DOM when unitCost and totalValue are null", () => {
    render(
      <InventorySummaryCardView
        inventory={{
          ...baseInventoryData,
          unitCost: null,
          totalValue: null,
          currency: null,
        }}
      />
    );

    expect(screen.queryByTestId("inventory-valuation-section")).toBeNull();
    expect(screen.queryByTestId("inventory-unit-cost")).toBeNull();
    expect(screen.queryByTestId("inventory-total-value")).toBeNull();
    expect(screen.queryByText("Stock Asset Valuation")).toBeNull();
  });

  // 11. Null or unavailable inventory data does not crash rendering
  it("11. Null or unavailable inventory data returns null without crashing", async () => {
    const jsxNull = await InventorySummaryCard({
      inventory: null,
    });
    expect(jsxNull).toBeNull();

    const jsxMissing = await InventorySummaryCard({
      slug: undefined,
      productId: undefined,
    });
    expect(jsxMissing).toBeNull();
  });

  // 12. Discrete UOM integer formatting
  it("12. Correctly formats whole integer quantities for discrete units of measure", () => {
    render(
      <InventorySummaryCardView
        inventory={{
          ...baseInventoryData,
          quantity: 150,
          reorderPoint: 25,
          unitOfMeasure: "piece",
          isDiscrete: true,
        }}
      />
    );

    expect(screen.getByTestId("inventory-current-quantity")).toHaveTextContent(
      "150 piece"
    );
    expect(screen.getByTestId("inventory-reorder-threshold")).toHaveTextContent(
      "25 piece"
    );
  });

  // 13. Skeleton component renders properly
  it("13. Renders skeleton loading state with pulse animation", () => {
    render(<InventorySummaryCardSkeleton />);

    const skeleton = screen.getByTestId("inventory-summary-skeleton");
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveClass("animate-pulse");
  });
});
