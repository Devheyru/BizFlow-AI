import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StocktakeModal } from "@/components/inventory/stocktake-modal";
import * as inventoryActions from "@/actions/inventory-actions";

vi.mock("@/actions/inventory-actions", () => ({
  recordStockMovementAction: vi.fn(),
}));

describe("StocktakeModal Component (T027, US4, Phase 7)", () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    slug: "acme-corp",
    productId: "b0000000-0000-0000-0000-000000000001",
    productName: "Premium Arabica Coffee",
    sku: "COF-ARA-001",
    currentStock: 50,
    currentVersion: 4,
    unitOfMeasure: "bag",
    isDiscrete: true,
    productStatus: "active",
    canAdjustStock: true,
    onStocktakeSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. Renders nothing when isOpen is false", () => {
    render(<StocktakeModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByTestId("stocktake-modal")).toBeNull();
  });

  it("2. Renders modal dialog with product details, system stock, and count input", () => {
    render(<StocktakeModal {...defaultProps} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Stocktake / Physical Count")).toBeInTheDocument();
    expect(screen.getByText("Premium Arabica Coffee")).toBeInTheDocument();
    expect(screen.getByText("COF-ARA-001")).toBeInTheDocument();
    expect(screen.getByText(/50 bag/)).toBeInTheDocument();
    expect(screen.getByTestId("stocktake-physical-count-input")).toBeInTheDocument();
  });

  it("3. Calculates and displays live variance correctly for match, surplus, and shortage", () => {
    render(<StocktakeModal {...defaultProps} currentStock={50} />);

    const countInput = screen.getByTestId("stocktake-physical-count-input");

    // Exact Match (50 counted vs 50 system -> 0 variance)
    fireEvent.change(countInput, { target: { value: "50" } });
    expect(screen.getByTestId("stocktake-variance-display")).toBeInTheDocument();
    expect(screen.getByText("Zero Discrepancy (Match)")).toBeInTheDocument();

    // Surplus (55 counted vs 50 system -> +5 variance)
    fireEvent.change(countInput, { target: { value: "55" } });
    expect(screen.getByText("Surplus Detected (Increase)")).toBeInTheDocument();
    expect(screen.getByText(/\+5/)).toBeInTheDocument();

    // Shortage (42 counted vs 50 system -> -8 variance)
    fireEvent.change(countInput, { target: { value: "42" } });
    expect(screen.getByText("Shortage Detected (Decrease)")).toBeInTheDocument();
    expect(screen.getByText(/-8/)).toBeInTheDocument();
  });

  it("4. Enforces whole integer validation for discrete products", () => {
    render(<StocktakeModal {...defaultProps} isDiscrete={true} />);

    const countInput = screen.getByTestId("stocktake-physical-count-input");
    fireEvent.change(countInput, { target: { value: "12.5" } });

    expect(
      screen.getByText(/Discrete products require whole integer quantities/i)
    ).toBeInTheDocument();
    expect(screen.getByTestId("stocktake-submit-button")).toBeDisabled();
  });

  it("5. Submits stocktake with target_physical_count semantics and handles committed response", async () => {
    const mockRecord = vi.mocked(inventoryActions.recordStockMovementAction).mockResolvedValue({
      success: true,
      data: {
        success: true,
        isReplay: false,
        status: "committed",
        movementId: "mv-adj-001",
        productId: defaultProps.productId,
        quantityBefore: 50,
        quantityDelta: -5,
        quantityAfter: 45,
        currentStock: 45,
        version: 5,
      },
    });

    render(<StocktakeModal {...defaultProps} />);

    fireEvent.change(screen.getByTestId("stocktake-physical-count-input"), {
      target: { value: "45" },
    });
    fireEvent.change(screen.getByTestId("stocktake-reason-input"), {
      target: { value: "End of month physical cycle count" },
    });

    fireEvent.click(screen.getByTestId("stocktake-submit-button"));

    await waitFor(() => {
      expect(mockRecord).toHaveBeenCalledWith(
        defaultProps.slug,
        expect.objectContaining({
          productId: defaultProps.productId,
          movementType: "adjustment",
          quantity: 45,
          quantitySemantics: "target_physical_count",
          reason: "End of month physical cycle count",
          expectedVersion: defaultProps.currentVersion,
        })
      );
    });

    expect(await screen.findByTestId("stocktake-success-committed")).toBeInTheDocument();
    expect(defaultProps.onStocktakeSuccess).toHaveBeenCalled();
  });

  it("6. Handles zero-delta matched response gracefully displaying zero-delta notification", async () => {
    vi.mocked(inventoryActions.recordStockMovementAction).mockResolvedValue({
      success: true,
      data: {
        success: true,
        isReplay: false,
        status: "matched",
        productId: defaultProps.productId,
        quantityBefore: 50,
        quantityDelta: 0,
        quantityAfter: 50,
        currentStock: 50,
        matchedQuantity: 50,
        version: 4,
      },
    });

    render(<StocktakeModal {...defaultProps} />);

    fireEvent.change(screen.getByTestId("stocktake-physical-count-input"), {
      target: { value: "50" },
    });
    fireEvent.change(screen.getByTestId("stocktake-reason-input"), {
      target: { value: "Cycle count verification" },
    });

    fireEvent.click(screen.getByTestId("stocktake-submit-button"));

    expect(await screen.findByTestId("stocktake-success-matched")).toBeInTheDocument();
    expect(screen.getByText(/Stock Count Verified & Matched!/i)).toBeInTheDocument();
    expect(defaultProps.onStocktakeSuccess).toHaveBeenCalled();
  });

  it("7. Gated by permission: disables submission when canAdjustStock is false", () => {
    render(<StocktakeModal {...defaultProps} canAdjustStock={false} />);

    expect(screen.getByTestId("stocktake-permission-alert")).toBeInTheDocument();
    expect(screen.getByTestId("stocktake-submit-button")).toBeDisabled();
  });

  it("8. Blocks stocktake on archived products", () => {
    render(<StocktakeModal {...defaultProps} productStatus="archived" />);

    expect(screen.getByTestId("stocktake-archived-alert")).toBeInTheDocument();
    expect(screen.getByTestId("stocktake-submit-button")).toBeDisabled();
  });
});
