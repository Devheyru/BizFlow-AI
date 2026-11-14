import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReorderThresholdModal } from "@/components/inventory/reorder-threshold-modal";
import * as inventoryActions from "@/actions/inventory-actions";

vi.mock("@/actions/inventory-actions", () => ({
  updateInventoryThresholdsAction: vi.fn(),
}));

describe("ReorderThresholdModal Component (T029, US4, US6, Phase 7)", () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    slug: "acme-corp",
    productId: "c0000000-0000-0000-0000-000000000002",
    productName: "Classic Milk Chocolate 100g",
    sku: "CHOC-MLK-001",
    currentStock: 30,
    currentVersion: 3,
    unitOfMeasure: "bar",
    isDiscrete: true,
    currentReorderPoint: 10,
    currentReorderQuantity: 50,
    canAdjustStock: true,
    onThresholdsSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. Renders nothing when isOpen is false", () => {
    render(<ReorderThresholdModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByTestId("reorder-threshold-modal")).toBeNull();
  });

  it("2. Pre-populates existing reorder point and quantity", () => {
    render(<ReorderThresholdModal {...defaultProps} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Reorder Thresholds")).toBeInTheDocument();
    expect(screen.getByText("Classic Milk Chocolate 100g")).toBeInTheDocument();

    const pointInput = screen.getByTestId("reorder-point-input") as HTMLInputElement;
    const qtyInput = screen.getByTestId("reorder-quantity-input") as HTMLInputElement;

    expect(pointInput.value).toBe("10");
    expect(qtyInput.value).toBe("50");
  });

  it("3. Submits updated thresholds with expectedVersion for OCC", async () => {
    const mockUpdate = vi.mocked(inventoryActions.updateInventoryThresholdsAction).mockResolvedValue({
      success: true,
      data: {
        success: true,
        productId: defaultProps.productId,
        reorderPoint: 15,
        reorderQuantity: 60,
        version: 4,
      },
    });

    render(<ReorderThresholdModal {...defaultProps} />);

    fireEvent.change(screen.getByTestId("reorder-point-input"), {
      target: { value: "15" },
    });
    fireEvent.change(screen.getByTestId("reorder-quantity-input"), {
      target: { value: "60" },
    });

    fireEvent.click(screen.getByTestId("reorder-threshold-submit-button"));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(defaultProps.slug, {
        productId: defaultProps.productId,
        reorderPoint: 15,
        reorderQuantity: 60,
        expectedVersion: 3,
      });
    });

    expect(await screen.findByTestId("reorder-threshold-success-alert")).toBeInTheDocument();
    expect(defaultProps.onThresholdsSuccess).toHaveBeenCalled();
  });

  it("4. Rejects negative values", async () => {
    render(<ReorderThresholdModal {...defaultProps} />);

    fireEvent.change(screen.getByTestId("reorder-point-input"), {
      target: { value: "-5" },
    });

    fireEvent.click(screen.getByTestId("reorder-threshold-submit-button"));

    expect(await screen.findByText(/Reorder point cannot be negative/i)).toBeInTheDocument();
  });

  it("5. Rejects fractional threshold values for discrete products", async () => {
    render(<ReorderThresholdModal {...defaultProps} isDiscrete={true} />);

    fireEvent.change(screen.getByTestId("reorder-point-input"), {
      target: { value: "4.5" },
    });

    fireEvent.click(screen.getByTestId("reorder-threshold-submit-button"));

    expect(await screen.findByText(/Discrete products require whole integer values/i)).toBeInTheDocument();
  });

  it("6. Handles STALE_VERSION_CONFLICT / P0027 on concurrent modification", async () => {
    vi.mocked(inventoryActions.updateInventoryThresholdsAction).mockResolvedValue({
      success: false,
      error: {
        code: "STALE_VERSION_CONFLICT",
        message: "Inventory record was updated by another transaction. Please reload and retry.",
      },
    });

    render(<ReorderThresholdModal {...defaultProps} />);

    fireEvent.change(screen.getByTestId("reorder-point-input"), {
      target: { value: "20" },
    });

    fireEvent.click(screen.getByTestId("reorder-threshold-submit-button"));

    expect(await screen.findByTestId("reorder-threshold-error-alert")).toBeInTheDocument();
    expect(screen.getByText("STALE_VERSION_CONFLICT")).toBeInTheDocument();
  });

  it("7. Gated by permission: disables button when canAdjustStock is false", () => {
    render(<ReorderThresholdModal {...defaultProps} canAdjustStock={false} />);

    expect(screen.getByTestId("reorder-threshold-permission-alert")).toBeInTheDocument();
    expect(screen.getByTestId("reorder-threshold-submit-button")).toBeDisabled();
  });
});
