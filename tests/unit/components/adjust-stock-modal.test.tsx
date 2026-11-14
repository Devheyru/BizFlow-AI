import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdjustStockModal } from "@/components/inventory/adjust-stock-modal";
import * as inventoryActions from "@/actions/inventory-actions";

vi.mock("@/actions/inventory-actions", () => ({
  recordStockMovementAction: vi.fn(),
}));

describe("AdjustStockModal Component (T026, US4, Phase 7)", () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    slug: "acme-corp",
    productId: "a0000000-0000-0000-0000-000000000001",
    productName: "Espresso Beans 1kg",
    sku: "CF-ESP-001",
    currentStock: 25,
    currentVersion: 2,
    unitOfMeasure: "bag",
    isDiscrete: true,
    productStatus: "active",
    canAdjustStock: true,
    onAdjustmentSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it("1. Renders nothing when isOpen is false", () => {
    render(<AdjustStockModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByTestId("adjust-stock-modal")).toBeNull();
  });

  it("2. Renders modal dialog with product details, stock snapshot, and movement type options", () => {
    render(<AdjustStockModal {...defaultProps} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Adjust Stock Balance")).toBeInTheDocument();
    expect(screen.getByText("Espresso Beans 1kg")).toBeInTheDocument();
    expect(screen.getByText("CF-ESP-001")).toBeInTheDocument();
    expect(screen.getByText(/25 bag/)).toBeInTheDocument();

    // Verify all 4 movement type options exist
    expect(screen.getByTestId("movement-type-adjustment")).toBeInTheDocument();
    expect(screen.getByTestId("movement-type-damage")).toBeInTheDocument();
    expect(screen.getByTestId("movement-type-loss")).toBeInTheDocument();
    expect(screen.getByTestId("movement-type-internal_use")).toBeInTheDocument();
  });

  it("3. Write-off (damage): entering positive quantity converts to negative delta on submission", async () => {
    const mockRecord = vi.mocked(inventoryActions.recordStockMovementAction).mockResolvedValue({
      success: true,
      data: {
        success: true,
        isReplay: false,
        status: "committed",
        movementId: "m-001",
        productId: defaultProps.productId,
        quantityBefore: 25,
        quantityDelta: -5,
        quantityAfter: 20,
        currentStock: 20,
        version: 3,
      },
    });

    render(<AdjustStockModal {...defaultProps} />);

    // Select damage
    fireEvent.click(screen.getByTestId("movement-type-damage"));

    // Enter positive human-friendly quantity (5)
    fireEvent.change(screen.getByTestId("adjust-quantity-input"), {
      target: { value: "5" },
    });

    // Enter reason
    fireEvent.change(screen.getByTestId("adjust-reason-input"), {
      target: { value: "Water leak in storage aisle 4" },
    });

    // Submit form
    fireEvent.click(screen.getByTestId("adjust-submit-button"));

    await waitFor(() => {
      expect(mockRecord).toHaveBeenCalledWith(
        defaultProps.slug,
        expect.objectContaining({
          productId: defaultProps.productId,
          movementType: "damage",
          quantity: -5, // Signed negative delta!
          quantitySemantics: "quantity_delta",
          reason: "Water leak in storage aisle 4",
        })
      );
    });

    // Success banner displays
    expect(await screen.findByTestId("adjust-success-alert")).toBeInTheDocument();
    expect(defaultProps.onAdjustmentSuccess).toHaveBeenCalled();
  });

  it("4. Manual adjustment increase: passes positive delta", async () => {
    const mockRecord = vi.mocked(inventoryActions.recordStockMovementAction).mockResolvedValue({
      success: true,
      data: {
        success: true,
        isReplay: false,
        status: "committed",
        movementId: "m-002",
        productId: defaultProps.productId,
        quantityBefore: 25,
        quantityDelta: 10,
        quantityAfter: 35,
        currentStock: 35,
        version: 3,
      },
    });

    render(<AdjustStockModal {...defaultProps} />);

    // Direction: increase
    fireEvent.click(screen.getByTestId("adjust-direction-increase"));

    fireEvent.change(screen.getByTestId("adjust-quantity-input"), {
      target: { value: "10" },
    });

    fireEvent.change(screen.getByTestId("adjust-reason-input"), {
      target: { value: "Found unrecorded carton" },
    });

    fireEvent.click(screen.getByTestId("adjust-submit-button"));

    await waitFor(() => {
      expect(mockRecord).toHaveBeenCalledWith(
        defaultProps.slug,
        expect.objectContaining({
          movementType: "adjustment",
          quantity: 10,
          quantitySemantics: "quantity_delta",
        })
      );
    });
  });

  it("5. Overdraft guard blocks submission when deduction exceeds available balance", () => {
    render(<AdjustStockModal {...defaultProps} currentStock={10} />);

    fireEvent.click(screen.getByTestId("movement-type-loss"));
    fireEvent.change(screen.getByTestId("adjust-quantity-input"), {
      target: { value: "15" }, // 10 - 15 = -5 (overdraft!)
    });

    expect(screen.getByTestId("adjust-overdraft-alert")).toBeInTheDocument();
    expect(screen.getByTestId("adjust-submit-button")).toBeDisabled();
  });

  it("6. Discrete product rejects fractional input", () => {
    render(<AdjustStockModal {...defaultProps} isDiscrete={true} />);

    fireEvent.change(screen.getByTestId("adjust-quantity-input"), {
      target: { value: "2.5" },
    });

    expect(
      screen.getByText(/Discrete products require whole integer quantities/i)
    ).toBeInTheDocument();
    expect(screen.getByTestId("adjust-submit-button")).toBeDisabled();
  });

  it("7. Inactive product blocks internal_use with PRODUCT_INACTIVE_INTERNAL_USE_BLOCKED alert", () => {
    render(
      <AdjustStockModal
        {...defaultProps}
        productStatus="inactive"
      />
    );

    // Select internal_use
    fireEvent.click(screen.getByTestId("movement-type-internal_use"));

    expect(
      screen.getByTestId("adjust-inactive-internal-use-alert")
    ).toBeInTheDocument();
    expect(screen.getByTestId("adjust-submit-button")).toBeDisabled();
  });

  it("8. Unauthorized user cannot submit adjustment", () => {
    render(<AdjustStockModal {...defaultProps} canAdjustStock={false} />);

    expect(screen.getByTestId("adjust-permission-alert")).toBeInTheDocument();
    expect(screen.getByTestId("adjust-submit-button")).toBeDisabled();
  });

  it("9. Handles server error (e.g. STALE_VERSION_CONFLICT / P0027)", async () => {
    vi.mocked(inventoryActions.recordStockMovementAction).mockResolvedValue({
      success: false,
      error: {
        code: "STALE_VERSION_CONFLICT",
        message: "Inventory record was updated by another transaction.",
      },
    });

    render(<AdjustStockModal {...defaultProps} />);

    fireEvent.change(screen.getByTestId("adjust-quantity-input"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByTestId("adjust-reason-input"), {
      target: { value: "Correction of count" },
    });

    fireEvent.click(screen.getByTestId("adjust-submit-button"));

    expect(await screen.findByTestId("adjust-error-alert")).toBeInTheDocument();
    expect(screen.getByText("STALE_VERSION_CONFLICT")).toBeInTheDocument();
  });
});
