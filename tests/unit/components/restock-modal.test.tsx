import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { RestockModal } from "@/components/inventory/restock-modal";
import * as inventoryActions from "@/actions/inventory-actions";

vi.mock("@/actions/inventory-actions", () => ({
  recordStockMovementAction: vi.fn(),
}));

describe("RestockModal Component (T023, US2, FR-INV-005, FR-INV-006, SEC-INV-005)", () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    slug: "acme-corp",
    productId: "a0000000-0000-0000-0000-000000000001",
    productName: "Arabica Coffee Beans 1kg",
    sku: "CF-ARA-001",
    currentStock: 20,
    currentVersion: 1,
    unitOfMeasure: "bag",
    isDiscrete: true,
    productStatus: "active" as const,
    canReceiveStock: true,
    onRestockSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. Renders nothing when isOpen is false", () => {
    render(<RestockModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByTestId("restock-modal")).toBeNull();
  });

  it("2. Renders modal with dialog role, title, product snapshot, and initial stock", () => {
    render(<RestockModal {...defaultProps} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Receive Stock")).toBeInTheDocument();
    expect(screen.getByText("Arabica Coffee Beans 1kg")).toBeInTheDocument();
    expect(screen.getByText("CF-ARA-001")).toBeInTheDocument();
    expect(screen.getByText(/Current Stock:/)).toBeInTheDocument();
    expect(screen.getByText("20 bag")).toBeInTheDocument();
  });

  it("3. Displays live projected balance as user inputs quantity", () => {
    render(<RestockModal {...defaultProps} />);

    const quantityInput = screen.getByTestId("restock-quantity-input");
    fireEvent.change(quantityInput, { target: { value: "15" } });

    expect(screen.getByText(/Projected:/)).toBeInTheDocument();
    expect(screen.getByText("35 bag")).toBeInTheDocument();
  });

  it("4. Enforces whole integer validation for discrete products", async () => {
    render(<RestockModal {...defaultProps} isDiscrete={true} unitOfMeasure="piece" />);

    const quantityInput = screen.getByTestId("restock-quantity-input");
    const reasonInput = screen.getByTestId("restock-reason-input");
    const submitBtn = screen.getByTestId("restock-submit-btn");

    fireEvent.change(quantityInput, { target: { value: "3.5" } });
    fireEvent.blur(quantityInput);
    fireEvent.change(reasonInput, { target: { value: "Restock from shipment" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Discrete products require whole integer quantities/i)).toBeInTheDocument();
    });
    expect(inventoryActions.recordStockMovementAction).not.toHaveBeenCalled();
  });

  it("5. Allows decimal quantities for continuous products", async () => {
    vi.mocked(inventoryActions.recordStockMovementAction).mockResolvedValueOnce({
      success: true,
      data: {
        success: true,
        isReplay: false,
        status: "committed",
        movementId: "mov-001",
        productId: "a0000000-0000-0000-0000-000000000001",
        quantityBefore: 20.0,
        quantityDelta: 12.75,
        quantityAfter: 32.75,
        currentStock: 32.75,
        version: 2,
      },
    });

    render(
      <RestockModal
        {...defaultProps}
        isDiscrete={false}
        unitOfMeasure="kg"
        currentStock={20.0}
      />
    );

    const quantityInput = screen.getByTestId("restock-quantity-input");
    const reasonInput = screen.getByTestId("restock-reason-input");
    const submitBtn = screen.getByTestId("restock-submit-btn");

    fireEvent.change(quantityInput, { target: { value: "12.75" } });
    fireEvent.change(reasonInput, { target: { value: "Bulk green coffee delivery" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(inventoryActions.recordStockMovementAction).toHaveBeenCalledWith("acme-corp", {
        productId: "a0000000-0000-0000-0000-000000000001",
        movementType: "restock",
        quantity: 12.75,
        quantitySemantics: "quantity_delta",
        reason: "Bulk green coffee delivery",
        referenceId: null,
        expectedVersion: 1,
        idempotencyKey: expect.any(String),
        isDiscrete: false,
      });
    });
  });

  it("6. Blocks restock when user lacks inventory:receive permission", async () => {
    render(<RestockModal {...defaultProps} canReceiveStock={false} />);

    const quantityInput = screen.getByTestId("restock-quantity-input");
    const reasonInput = screen.getByTestId("restock-reason-input");
    const submitBtn = screen.getByTestId("restock-submit-btn");

    fireEvent.change(quantityInput, { target: { value: "10" } });
    fireEvent.change(reasonInput, { target: { value: "Delivery receipt" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId("restock-error-banner")).toBeInTheDocument();
      expect(screen.getByText("FORBIDDEN")).toBeInTheDocument();
      expect(screen.getByText(/Unauthorized: You do not have permission to receive stock/i)).toBeInTheDocument();
    });
    expect(inventoryActions.recordStockMovementAction).not.toHaveBeenCalled();
  });

  it("7. Blocks restock on inactive product (PRODUCT_INACTIVE_RESTOCK_BLOCKED)", async () => {
    render(<RestockModal {...defaultProps} productStatus="inactive" />);

    const quantityInput = screen.getByTestId("restock-quantity-input");
    const reasonInput = screen.getByTestId("restock-reason-input");
    const submitBtn = screen.getByTestId("restock-submit-btn");

    fireEvent.change(quantityInput, { target: { value: "10" } });
    fireEvent.change(reasonInput, { target: { value: "Attempt delivery on inactive" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId("restock-error-banner")).toBeInTheDocument();
      expect(screen.getByText("PRODUCT_INACTIVE_RESTOCK_BLOCKED")).toBeInTheDocument();
      expect(screen.getByText(/Cannot receive stock for inactive products/i)).toBeInTheDocument();
    });
    expect(inventoryActions.recordStockMovementAction).not.toHaveBeenCalled();
  });

  it("8. Blocks restock on archived product (PRODUCT_ARCHIVED_STOCK_FORBIDDEN)", async () => {
    render(<RestockModal {...defaultProps} productStatus="archived" />);

    const quantityInput = screen.getByTestId("restock-quantity-input");
    const reasonInput = screen.getByTestId("restock-reason-input");
    const submitBtn = screen.getByTestId("restock-submit-btn");

    fireEvent.change(quantityInput, { target: { value: "10" } });
    fireEvent.change(reasonInput, { target: { value: "Attempt delivery on archived" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId("restock-error-banner")).toBeInTheDocument();
      expect(screen.getByText("PRODUCT_ARCHIVED_STOCK_FORBIDDEN")).toBeInTheDocument();
      expect(screen.getByText(/Cannot receive stock for archived products/i)).toBeInTheDocument();
    });
    expect(inventoryActions.recordStockMovementAction).not.toHaveBeenCalled();
  });

  it("9. Submits valid payload, displays success banner, and invokes callback", async () => {
    const onRestockSuccess = vi.fn();
    vi.mocked(inventoryActions.recordStockMovementAction).mockResolvedValueOnce({
      success: true,
      data: {
        success: true,
        isReplay: false,
        status: "committed",
        movementId: "mov-999",
        productId: "a0000000-0000-0000-0000-000000000001",
        quantityBefore: 20,
        quantityDelta: 25,
        quantityAfter: 45,
        currentStock: 45,
        version: 2,
      },
    });

    render(
      <RestockModal
        {...defaultProps}
        onRestockSuccess={onRestockSuccess}
      />
    );

    const quantityInput = screen.getByTestId("restock-quantity-input");
    const referenceInput = screen.getByTestId("restock-reference-input");
    const reasonInput = screen.getByTestId("restock-reason-input");
    const submitBtn = screen.getByTestId("restock-submit-btn");

    fireEvent.change(quantityInput, { target: { value: "25" } });
    fireEvent.change(referenceInput, { target: { value: "PO-2026-009" } });
    fireEvent.change(reasonInput, { target: { value: "Scheduled weekly replenishment shipment" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(inventoryActions.recordStockMovementAction).toHaveBeenCalledWith("acme-corp", {
        productId: "a0000000-0000-0000-0000-000000000001",
        movementType: "restock",
        quantity: 25,
        quantitySemantics: "quantity_delta",
        reason: "Scheduled weekly replenishment shipment",
        referenceId: "PO-2026-009",
        expectedVersion: 1,
        idempotencyKey: expect.any(String),
        isDiscrete: true,
      });
    });

    await waitFor(() => {
      const banner = screen.getByTestId("restock-success-banner");
      expect(banner).toBeInTheDocument();
      expect(within(banner).getByText(/Stock received successfully!/i)).toBeInTheDocument();
      expect(within(banner).getByText(/Added \+25 bag/i)).toBeInTheDocument();
      expect(within(banner).getByText(/45 bag/i)).toBeInTheDocument();
    });

    expect(onRestockSuccess).toHaveBeenCalledWith({
      success: true,
      isReplay: false,
      status: "committed",
      movementId: "mov-999",
      productId: "a0000000-0000-0000-0000-000000000001",
      quantityBefore: 20,
      quantityDelta: 25,
      quantityAfter: 45,
      currentStock: 45,
      version: 2,
    });
  });

  it("10. Displays error banner when server action fails with error code", async () => {
    vi.mocked(inventoryActions.recordStockMovementAction).mockResolvedValueOnce({
      success: false,
      error: {
        code: "STALE_VERSION_CONFLICT",
        message: "Version conflict: the inventory record has been modified by another transaction.",
      },
    });

    render(<RestockModal {...defaultProps} />);

    const quantityInput = screen.getByTestId("restock-quantity-input");
    const reasonInput = screen.getByTestId("restock-reason-input");
    const submitBtn = screen.getByTestId("restock-submit-btn");

    fireEvent.change(quantityInput, { target: { value: "10" } });
    fireEvent.change(reasonInput, { target: { value: "Supplier arrival" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId("restock-error-banner")).toBeInTheDocument();
      expect(screen.getByText("STALE_VERSION_CONFLICT")).toBeInTheDocument();
      expect(screen.getByText(/the inventory record has been modified by another transaction/i)).toBeInTheDocument();
    });
  });

  it("11. Handles unexpected action rejection gracefully", async () => {
    vi.mocked(inventoryActions.recordStockMovementAction).mockRejectedValueOnce(
      new Error("Network connection dropped")
    );

    render(<RestockModal {...defaultProps} />);

    const quantityInput = screen.getByTestId("restock-quantity-input");
    const reasonInput = screen.getByTestId("restock-reason-input");
    const submitBtn = screen.getByTestId("restock-submit-btn");

    fireEvent.change(quantityInput, { target: { value: "10" } });
    fireEvent.change(reasonInput, { target: { value: "Supplier arrival" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId("restock-error-banner")).toBeInTheDocument();
      expect(screen.getByText("UNEXPECTED_ERROR")).toBeInTheDocument();
      expect(screen.getByText("Network connection dropped")).toBeInTheDocument();
    });
  });

  it("12. Triggers onClose when Cancel button or Escape key is pressed", () => {
    const onClose = vi.fn();
    render(<RestockModal {...defaultProps} onClose={onClose} />);

    // Cancel button click
    const cancelBtn = screen.getByTestId("restock-cancel-btn");
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalledTimes(1);

    // Escape key press
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("13. Stable Idempotency Key: Retrying submission after network error preserves the exact same idempotencyKey (FINDING-P5-002)", async () => {
    // First call rejects with network drop
    vi.mocked(inventoryActions.recordStockMovementAction).mockRejectedValueOnce(
      new Error("ETIMEDOUT")
    );

    render(<RestockModal {...defaultProps} />);

    const quantityInput = screen.getByTestId("restock-quantity-input");
    const reasonInput = screen.getByTestId("restock-reason-input");
    const submitBtn = screen.getByTestId("restock-submit-btn");

    fireEvent.change(quantityInput, { target: { value: "15" } });
    fireEvent.change(reasonInput, { target: { value: "Shipment retry test" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId("restock-error-banner")).toBeInTheDocument();
      expect(screen.getByText("ETIMEDOUT")).toBeInTheDocument();
    });

    expect(inventoryActions.recordStockMovementAction).toHaveBeenCalledTimes(1);
    const firstCallPayload = vi.mocked(inventoryActions.recordStockMovementAction).mock.calls[0]![1] as {
      idempotencyKey?: string;
    };
    const firstKey = firstCallPayload.idempotencyKey;
    expect(firstKey).toBeDefined();

    // Second call (retry by user clicking Confirm Restock again) resolves successfully
    vi.mocked(inventoryActions.recordStockMovementAction).mockResolvedValueOnce({
      success: true,
      data: {
        success: true,
        isReplay: false,
        status: "committed",
        movementId: "mov-retry-123",
        productId: "a0000000-0000-0000-0000-000000000001",
        quantityBefore: 20,
        quantityDelta: 15,
        quantityAfter: 35,
        currentStock: 35,
        version: 2,
      },
    });

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(inventoryActions.recordStockMovementAction).toHaveBeenCalledTimes(2);
    });

    const secondCallPayload = vi.mocked(inventoryActions.recordStockMovementAction).mock.calls[1]![1] as {
      idempotencyKey?: string;
    };
    const secondKey = secondCallPayload.idempotencyKey;

    // Must be identical key to prevent double-restock
    expect(secondKey).toBe(firstKey);
  });

  it("14. Preserves exact same idempotencyKey across modal close and reopen when response is interrupted (Verification C)", async () => {
    // 1. First submission attempts restock but network drops
    vi.mocked(inventoryActions.recordStockMovementAction).mockRejectedValueOnce(
      new Error("Network connection lost after commit")
    );

    const { rerender } = render(<RestockModal {...defaultProps} isOpen={true} />);

    const quantityInput = screen.getByTestId("restock-quantity-input");
    const reasonInput = screen.getByTestId("restock-reason-input");
    const submitBtn = screen.getByTestId("restock-submit-btn");

    fireEvent.change(quantityInput, { target: { value: "25" } });
    fireEvent.change(reasonInput, { target: { value: "Delivery batch #104" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId("restock-error-banner")).toBeInTheDocument();
    });

    const firstCallPayload = vi.mocked(inventoryActions.recordStockMovementAction).mock.calls[0]![1] as {
      idempotencyKey?: string;
    };
    const firstKey = firstCallPayload.idempotencyKey;
    expect(firstKey).toBeDefined();

    // 2. User closes modal (e.g. unmounts)
    rerender(<RestockModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByTestId("restock-modal")).toBeNull();

    // 3. User reopens modal for the same product to retry
    rerender(<RestockModal {...defaultProps} isOpen={true} />);
    expect(screen.getByTestId("restock-modal")).toBeInTheDocument();

    // Verification C requirement: Recovery banner displayed with pending values prefilled
    expect(screen.getByTestId("restock-recovery-banner")).toBeInTheDocument();
    expect(screen.getByText(/Unconfirmed Restock Recovered/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("25")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Delivery batch #104")).toBeInTheDocument();

    // 4. User confirms retry with recovered submission
    vi.mocked(inventoryActions.recordStockMovementAction).mockResolvedValueOnce({
      success: true,
      data: {
        success: true,
        isReplay: true,
        status: "committed",
        movementId: "mov-rec-001",
        productId: defaultProps.productId,
        quantityBefore: 20,
        quantityDelta: 25,
        quantityAfter: 45,
        currentStock: 45,
        version: 2,
      },
    });

    const retrySubmitBtn = screen.getByTestId("restock-submit-btn");
    fireEvent.click(retrySubmitBtn);

    await waitFor(() => {
      expect(inventoryActions.recordStockMovementAction).toHaveBeenCalledTimes(2);
    });

    const secondCallPayload = vi.mocked(inventoryActions.recordStockMovementAction).mock.calls[1]![1] as {
      idempotencyKey?: string;
    };
    // Must match firstKey exactly across close & reopen
    expect(secondCallPayload.idempotencyKey).toBe(firstKey);
  });

  it("15. Clicking 'Start Fresh' discards pending session, resets inputs, and generates a new idempotencyKey", async () => {
    // 1. Initial interrupted submission
    vi.mocked(inventoryActions.recordStockMovementAction).mockRejectedValueOnce(
      new Error("Timeout")
    );

    const { rerender } = render(<RestockModal {...defaultProps} isOpen={true} />);

    const quantityInput = screen.getByTestId("restock-quantity-input");
    const reasonInput = screen.getByTestId("restock-reason-input");
    const submitBtn = screen.getByTestId("restock-submit-btn");

    fireEvent.change(quantityInput, { target: { value: "30" } });
    fireEvent.change(reasonInput, { target: { value: "First attempt" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId("restock-error-banner")).toBeInTheDocument();
    });

    const firstKey = (vi.mocked(inventoryActions.recordStockMovementAction).mock.calls[0]![1] as any).idempotencyKey;

    // 2. Reopen modal
    rerender(<RestockModal {...defaultProps} isOpen={false} />);
    rerender(<RestockModal {...defaultProps} isOpen={true} />);

    expect(screen.getByTestId("restock-recovery-banner")).toBeInTheDocument();

    // 3. Click "Start Fresh"
    const startFreshBtn = screen.getByTestId("restock-start-fresh-btn");
    fireEvent.click(startFreshBtn);

    // Banner removed and inputs cleared
    expect(screen.queryByTestId("restock-recovery-banner")).toBeNull();
    const qtyInputAfter = screen.getByTestId("restock-quantity-input") as HTMLInputElement;
    expect(qtyInputAfter.value).toBe("");

    // 4. Submit new restock
    vi.mocked(inventoryActions.recordStockMovementAction).mockResolvedValueOnce({
      success: true,
      data: {
        success: true,
        isReplay: false,
        status: "committed",
        movementId: "mov-fresh-002",
        productId: defaultProps.productId,
        quantityBefore: 20,
        quantityDelta: 50,
        quantityAfter: 70,
        currentStock: 70,
        version: 2,
      },
    });

    fireEvent.change(screen.getByTestId("restock-quantity-input"), { target: { value: "50" } });
    fireEvent.change(screen.getByTestId("restock-reason-input"), { target: { value: "Completely new delivery" } });
    fireEvent.click(screen.getByTestId("restock-submit-btn"));

    await waitFor(() => {
      expect(inventoryActions.recordStockMovementAction).toHaveBeenCalledTimes(2);
    });

    const newKey = (vi.mocked(inventoryActions.recordStockMovementAction).mock.calls[1]![1] as any).idempotencyKey;
    expect(newKey).not.toBe(firstKey);
  });

  it("16. Altering quantity from recovered pending session generates a new idempotencyKey (different logical mutation)", async () => {
    vi.mocked(inventoryActions.recordStockMovementAction).mockRejectedValueOnce(
      new Error("Timeout")
    );

    const { rerender } = render(<RestockModal {...defaultProps} isOpen={true} />);

    fireEvent.change(screen.getByTestId("restock-quantity-input"), { target: { value: "10" } });
    fireEvent.change(screen.getByTestId("restock-reason-input"), { target: { value: "Initial count" } });
    fireEvent.click(screen.getByTestId("restock-submit-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("restock-error-banner")).toBeInTheDocument();
    });

    const firstKey = (vi.mocked(inventoryActions.recordStockMovementAction).mock.calls[0]![1] as any).idempotencyKey;

    // Reopen modal: recovered
    rerender(<RestockModal {...defaultProps} isOpen={false} />);
    rerender(<RestockModal {...defaultProps} isOpen={true} />);

    // User edits quantity from 10 to 12 (different physical delivery)
    fireEvent.change(screen.getByTestId("restock-quantity-input"), { target: { value: "12" } });

    vi.mocked(inventoryActions.recordStockMovementAction).mockResolvedValueOnce({
      success: true,
      data: {
        success: true,
        isReplay: false,
        status: "committed",
        movementId: "mov-alt-003",
        productId: defaultProps.productId,
        quantityBefore: 20,
        quantityDelta: 12,
        quantityAfter: 32,
        currentStock: 32,
        version: 2,
      },
    });

    fireEvent.click(screen.getByTestId("restock-submit-btn"));

    await waitFor(() => {
      expect(inventoryActions.recordStockMovementAction).toHaveBeenCalledTimes(2);
    });

    const secondKey = (vi.mocked(inventoryActions.recordStockMovementAction).mock.calls[1]![1] as any).idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
  });

  // ============================================================================
  // T025: Initial Opening Stock Mode Tests (US3)
  // ============================================================================
  describe("T025: Initial Opening Stock Mode (US3)", () => {
    const initialProps = {
      ...defaultProps,
      currentStock: 0,
      mode: "initial" as const,
    };

    it("17. Initial mode displays Opening Stock in title, labels, and confirm button", () => {
      render(<RestockModal {...initialProps} />);

      expect(screen.getByRole("heading", { name: "Opening Stock" })).toBeInTheDocument();
      expect(screen.getByText(/Record initial baseline inventory/i)).toBeInTheDocument();
      expect(screen.getByText(/Opening Quantity/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /confirm opening stock/i })).toBeInTheDocument();
    });

    it("18. Initial mode submits movementType = 'initial' to recordStockMovementAction", async () => {
      vi.mocked(inventoryActions.recordStockMovementAction).mockResolvedValueOnce({
        success: true,
        data: {
          success: true,
          isReplay: false,
          status: "committed",
          movementId: "mov-init-001",
          productId: initialProps.productId,
          quantityBefore: 0,
          quantityDelta: 25,
          quantityAfter: 25,
          currentStock: 25,
          version: 2,
        },
      });

      render(<RestockModal {...initialProps} />);

      fireEvent.change(screen.getByTestId("restock-quantity-input"), { target: { value: "25" } });
      fireEvent.change(screen.getByTestId("restock-reason-input"), {
        target: { value: "Initial opening stock at store launch" },
      });
      fireEvent.change(screen.getByTestId("restock-reference-input"), {
        target: { value: "COUNT-2026-001" },
      });
      fireEvent.click(screen.getByTestId("restock-submit-btn"));

      await waitFor(() => {
        expect(inventoryActions.recordStockMovementAction).toHaveBeenCalledTimes(1);
      });

      const [slugArg, payloadArg] = vi.mocked(inventoryActions.recordStockMovementAction).mock.calls[0]!;
      expect(slugArg).toBe("acme-corp");
      expect(payloadArg).toMatchObject({
        productId: initialProps.productId,
        movementType: "initial",
        quantity: 25,
        reason: "Initial opening stock at store launch",
        referenceId: "COUNT-2026-001",
        quantitySemantics: "quantity_delta",
      });

      // Shows initial opening stock confirmation banner
      await waitFor(() => {
        expect(screen.getByTestId("restock-success-banner")).toBeInTheDocument();
        expect(screen.getByText(/Opening stock recorded successfully!/i)).toBeInTheDocument();
      });
    });

    it("19. Restock mode still submits movementType = 'restock' (preserves Phase 5)", async () => {
      vi.mocked(inventoryActions.recordStockMovementAction).mockResolvedValueOnce({
        success: true,
        data: {
          success: true,
          isReplay: false,
          status: "committed",
          movementId: "mov-restock-999",
          productId: defaultProps.productId,
          quantityBefore: 20,
          quantityDelta: 10,
          quantityAfter: 30,
          currentStock: 30,
          version: 2,
        },
      });

      render(<RestockModal {...defaultProps} mode="restock" />);

      expect(screen.getByRole("heading", { name: "Receive Stock" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /confirm restock/i })).toBeInTheDocument();

      fireEvent.change(screen.getByTestId("restock-quantity-input"), { target: { value: "10" } });
      fireEvent.change(screen.getByTestId("restock-reason-input"), { target: { value: "Regular weekly shipment" } });
      fireEvent.click(screen.getByTestId("restock-submit-btn"));

      await waitFor(() => {
        expect(inventoryActions.recordStockMovementAction).toHaveBeenCalledTimes(1);
      });

      const [, payloadArg] = vi.mocked(inventoryActions.recordStockMovementAction).mock.calls[0]!;
      expect(payloadArg).toMatchObject({
        movementType: "restock",
        quantity: 10,
      });
    });

    it("20. Initial mode enforces integer quantity validation for discrete products", async () => {
      render(<RestockModal {...initialProps} isDiscrete={true} unitOfMeasure="piece" />);

      fireEvent.change(screen.getByTestId("restock-quantity-input"), { target: { value: "12.75" } });
      fireEvent.change(screen.getByTestId("restock-reason-input"), { target: { value: "Opening count fractional test" } });
      fireEvent.click(screen.getByTestId("restock-submit-btn"));

      await waitFor(() => {
        expect(screen.getByText(/Discrete products require whole integer quantities/i)).toBeInTheDocument();
      });
      expect(inventoryActions.recordStockMovementAction).not.toHaveBeenCalled();
    });

    it("21. Initial mode permits fractional quantities for continuous products", async () => {
      vi.mocked(inventoryActions.recordStockMovementAction).mockResolvedValueOnce({
        success: true,
        data: {
          success: true,
          isReplay: false,
          status: "committed",
          movementId: "mov-init-cont-01",
          productId: initialProps.productId,
          quantityBefore: 0,
          quantityDelta: 45.75,
          quantityAfter: 45.75,
          currentStock: 45.75,
          version: 2,
        },
      });

      render(<RestockModal {...initialProps} isDiscrete={false} unitOfMeasure="kg" />);

      fireEvent.change(screen.getByTestId("restock-quantity-input"), { target: { value: "45.75" } });
      fireEvent.change(screen.getByTestId("restock-reason-input"), { target: { value: "Opening bulk beans in kg" } });
      fireEvent.click(screen.getByTestId("restock-submit-btn"));

      await waitFor(() => {
        expect(inventoryActions.recordStockMovementAction).toHaveBeenCalledWith(
          "acme-corp",
          expect.objectContaining({
            movementType: "initial",
            quantity: 45.75,
          })
        );
      });
    });

    it("22. Initial mode restores unconfirmed session from sessionStorage across modal close/reopen", async () => {
      vi.mocked(inventoryActions.recordStockMovementAction).mockRejectedValueOnce(
        new Error("Network connection dropped")
      );

      const { rerender } = render(<RestockModal {...initialProps} isOpen={true} />);

      fireEvent.change(screen.getByTestId("restock-quantity-input"), { target: { value: "100" } });
      fireEvent.change(screen.getByTestId("restock-reason-input"), { target: { value: "Opening stock attempt 1" } });
      fireEvent.change(screen.getByTestId("restock-reference-input"), { target: { value: "AUDIT-001" } });
      fireEvent.click(screen.getByTestId("restock-submit-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("restock-error-banner")).toBeInTheDocument();
      });

      const initialKey = (vi.mocked(inventoryActions.recordStockMovementAction).mock.calls[0]![1] as any).idempotencyKey;

      // Close modal
      rerender(<RestockModal {...initialProps} isOpen={false} />);
      expect(screen.queryByTestId("restock-modal")).toBeNull();

      // Reopen modal in initial mode
      rerender(<RestockModal {...initialProps} isOpen={true} />);

      // Recovery banner displayed
      expect(screen.getByTestId("restock-recovery-banner")).toBeInTheDocument();
      expect(screen.getByText(/Unconfirmed Opening Stock Recovered/i)).toBeInTheDocument();

      // Form values preserved
      expect((screen.getByTestId("restock-quantity-input") as HTMLInputElement).value).toBe("100");
      expect((screen.getByTestId("restock-reason-input") as HTMLTextAreaElement).value).toBe("Opening stock attempt 1");
      expect((screen.getByTestId("restock-reference-input") as HTMLInputElement).value).toBe("AUDIT-001");

      // Retry submission uses identical stable idempotency key
      vi.mocked(inventoryActions.recordStockMovementAction).mockResolvedValueOnce({
        success: true,
        data: {
          success: true,
          isReplay: false,
          status: "committed",
          movementId: "mov-init-retry",
          productId: initialProps.productId,
          quantityBefore: 0,
          quantityDelta: 100,
          quantityAfter: 100,
          currentStock: 100,
          version: 2,
        },
      });

      fireEvent.click(screen.getByTestId("restock-submit-btn"));

      await waitFor(() => {
        expect(inventoryActions.recordStockMovementAction).toHaveBeenCalledTimes(2);
      });

      const retryKey = (vi.mocked(inventoryActions.recordStockMovementAction).mock.calls[1]![1] as any).idempotencyKey;
      expect(retryKey).toBe(initialKey);
    });

    it("23. Initial mode handles OCC STALE_VERSION_CONFLICT error from server action", async () => {
      vi.mocked(inventoryActions.recordStockMovementAction).mockResolvedValueOnce({
        success: false,
        error: {
          code: "STALE_VERSION_CONFLICT",
          message: "Inventory record was updated by another transaction. Please reload and retry.",
        },
      });

      render(<RestockModal {...initialProps} />);

      fireEvent.change(screen.getByTestId("restock-quantity-input"), { target: { value: "30" } });
      fireEvent.change(screen.getByTestId("restock-reason-input"), { target: { value: "Opening baseline" } });
      fireEvent.click(screen.getByTestId("restock-submit-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("restock-error-banner")).toBeInTheDocument();
        expect(screen.getByText("STALE_VERSION_CONFLICT")).toBeInTheDocument();
        expect(screen.getByText(/Inventory record was updated by another transaction/i)).toBeInTheDocument();
      });
    });

    it("24. P0025: Surfaces INITIAL_STOCK_ALREADY_RECORDED error when initial stock already exists", async () => {
      vi.mocked(inventoryActions.recordStockMovementAction).mockResolvedValueOnce({
        success: false,
        error: {
          code: "INITIAL_STOCK_ALREADY_RECORDED",
          message: "Initial opening stock has already been established for this product.",
        },
      });

      render(<RestockModal {...initialProps} />);

      fireEvent.change(screen.getByTestId("restock-quantity-input"), { target: { value: "15" } });
      fireEvent.change(screen.getByTestId("restock-reason-input"), { target: { value: "Duplicate opening stock attempt" } });
      fireEvent.click(screen.getByTestId("restock-submit-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("restock-error-banner")).toBeInTheDocument();
        expect(screen.getByText("INITIAL_STOCK_ALREADY_RECORDED")).toBeInTheDocument();
        expect(screen.getByText(/Initial opening stock has already been established/i)).toBeInTheDocument();
      });

      // Reopening should NOT show recovery banner because INITIAL_STOCK_ALREADY_RECORDED is fatal
      const { rerender } = render(<RestockModal {...initialProps} isOpen={false} />);
      rerender(<RestockModal {...initialProps} isOpen={true} />);
      expect(screen.queryByTestId("restock-recovery-banner")).toBeNull();
    });
  });
});
