import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ReturnDialog } from "@/components/sales/return-dialog";
import * as salesActions from "@/actions/sales-actions";
import type { SaleDetail, ReturnHistory, SaleItemRecord } from "@/types/sales";

vi.mock("@/actions/sales-actions", () => ({
  executeSaleReturnAction: vi.fn(),
}));

describe("ReturnDialog Component (T070, US4)", () => {
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();

  const mockSaleDetail: SaleDetail = {
    sale: {
      id: "sale-101",
      organizationId: "org-1",
      saleNumber: "SAL-001",
      customerId: "cust-1",
      status: "completed",
      paymentStatus: "paid",
      subtotal: 200.0,
      orderDiscountAmount: 0.0,
      taxableAmount: 200.0,
      taxAmount: 20.0,
      totalAmount: 220.0,
      currency: "USD",
      isTaxInclusive: false,
      taxRate: 10.0,
      taxName: "VAT",
      notes: null,
      createdAt: "2026-11-23T10:00:00Z",
      createdBy: "cashier-1",
    },
    customer: {
      id: "cust-1",
      name: "Diana Prince",
      phone: "+1234567890",
      email: "diana@amazon.com",
    },
    items: [
      {
        id: "item-1",
        productId: "prod-1",
        productName: "Headphones",
        sku: "SKU-HP",
        quantity: 2,
        unitPrice: 50.0,
        unitCost: 30.0,
        lineDiscountAmount: 0,
        allocatedOrderDisc: 0,
        taxableAmount: 100.0,
        allocatedTaxAmount: 10.0,
        totalPrice: 110.0,
        movementId: "mov-1",
      },
      {
        id: "item-2",
        productId: "prod-2",
        productName: "Keyboard",
        sku: "SKU-KB",
        quantity: 1,
        unitPrice: 100.0,
        unitCost: 60.0,
        lineDiscountAmount: 0,
        allocatedOrderDisc: 0,
        taxableAmount: 100.0,
        allocatedTaxAmount: 10.0,
        totalPrice: 110.0,
        movementId: "mov-2",
      },
    ],
    payments: [
      {
        id: "pay-1",
        paymentMethod: "card",
        amount: 220.0,
        amountTendered: null,
        changeDue: null,
        referenceNo: "AUTH-1001",
        createdAt: "2026-11-23T10:00:00Z",
      },
    ],
    returns: [],
    refunds: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <ReturnDialog
        isOpen={false}
        onClose={mockOnClose}
        slug="alpha-store"
        saleDetail={mockSaleDetail}
        returnHistory={[]}
        onSuccess={mockOnSuccess}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders line items, tender selector, reason, and estimated refund", () => {
    render(
      <ReturnDialog
        isOpen={true}
        onClose={mockOnClose}
        slug="alpha-store"
        saleDetail={mockSaleDetail}
        returnHistory={[]}
        onSuccess={mockOnSuccess}
      />
    );

    expect(screen.getByText(/Process Return for SAL-001/i)).toBeDefined();
    expect(screen.getByText("Headphones")).toBeDefined();
    expect(screen.getByText("Keyboard")).toBeDefined();
    expect(screen.getAllByText(/Refund Tender Method/i).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Reason for Return/i)).toBeDefined();
  });

  it("disables confirm button when reason has less than 3 characters", () => {
    render(
      <ReturnDialog
        isOpen={true}
        onClose={mockOnClose}
        slug="alpha-store"
        saleDetail={mockSaleDetail}
        returnHistory={[]}
        onSuccess={mockOnSuccess}
      />
    );

    const submitBtn = screen.getByRole("button", { name: /Confirm Return/i });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);

    const reasonInput = screen.getByLabelText(/Reason for Return/i);
    fireEvent.change(reasonInput, { target: { value: "ab" } });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(reasonInput, { target: { value: "abc" } });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("calculates remaining returnable quantity correctly when prior returns exist", () => {
    const priorReturn: ReturnHistory = {
      id: "ret-prev-1",
      returnNumber: "RET-0001",
      saleId: "sale-101",
      refundMethod: "card",
      reason: "Prior return of 1 headphone",
      totalRefundAmount: 55.0,
      createdAt: "2026-11-23T10:15:00Z",
      createdBy: "cashier-1",
      items: [
        {
          id: "ret-it-1",
          saleItemId: "item-1",
          productId: "prod-1",
          productName: "Headphones",
          sku: "SKU-HP",
          quantity: 1, // 1 returned already out of 2
          refundAmount: 55.0,
          restockToInventory: true,
          movementId: "mov-ret-1",
        },
      ],
      refunds: [],
    };

    render(
      <ReturnDialog
        isOpen={true}
        onClose={mockOnClose}
        slug="alpha-store"
        saleDetail={mockSaleDetail}
        returnHistory={[priorReturn]}
        onSuccess={mockOnSuccess}
      />
    );

    // Headphone had 2 qty, 1 returned, so 1 remaining
    expect(screen.getByText(/Remaining: 1 \/ 2/i)).toBeDefined();
    // Keyboard had 1 qty, 0 returned, so 1 remaining
    expect(screen.getByText(/Remaining: 1 \/ 1/i)).toBeDefined();
  });

  it("submits executeSaleReturnAction with correct payload and calls onSuccess upon success", async () => {
    vi.mocked(salesActions.executeSaleReturnAction).mockResolvedValue({
      success: true,
      data: {
        success: true,
        isReplay: false,
        returnId: "ret-new-1",
        returnNumber: "RET-20261123-0001",
        saleId: "sale-101",
        totalRefundAmount: 110.0,
        refundId: "ref-new-1",
        refundStatus: "completed",
        saleStatus: "partially_returned",
        paymentStatus: "partially_refunded",
      },
    });

    const { unmount } = render(
      <ReturnDialog
        isOpen={true}
        onClose={mockOnClose}
        slug="alpha-store"
        saleDetail={mockSaleDetail}
        returnHistory={[]}
        onSuccess={mockOnSuccess}
      />
    );

    // Unselect the second item (Keyboard)
    const item2Checkbox = screen.getByRole("checkbox", { name: "Keyboard" });
    fireEvent.click(item2Checkbox);

    // Set quantity of item 1 to 2
    const qtyInputs = screen.getAllByLabelText(/Return Qty:/i);
    const qtyInput = qtyInputs[0];
    expect(qtyInput).toBeDefined();
    fireEvent.change(qtyInput!, { target: { value: "2" } });

    // Fill reason
    const reasonInput = screen.getByLabelText(/Reason for Return/i);
    fireEvent.change(reasonInput, { target: { value: "Customer return headphone only" } });

    // Submit
    const submitBtn = screen.getByRole("button", { name: /Confirm Return/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(salesActions.executeSaleReturnAction).toHaveBeenCalledWith(
        "alpha-store",
        expect.objectContaining({
          saleId: "sale-101",
          refundMethod: "cash",
          reason: "Customer return headphone only",
          returnItems: [
            {
              saleItemId: "item-1",
              quantity: 2,
              restockToInventory: true,
            },
          ],
        })
      );
      expect(mockOnSuccess).toHaveBeenCalledTimes(1);
    });

    unmount();
  });

  it("displays error message when executeSaleReturnAction returns an error", async () => {
    vi.mocked(salesActions.executeSaleReturnAction).mockResolvedValue({
      success: false,
      error: {
        code: "P0052",
        message: "Return quantity exceeds available returnable quantity for item",
      },
    });

    render(
      <ReturnDialog
        isOpen={true}
        onClose={mockOnClose}
        slug="alpha-store"
        saleDetail={mockSaleDetail}
        returnHistory={[]}
        onSuccess={mockOnSuccess}
      />
    );

    const reasonInput = screen.getByLabelText(/Reason for Return/i);
    fireEvent.change(reasonInput, { target: { value: "Defective piece return" } });

    const submitBtn = screen.getByRole("button", { name: /Confirm Return/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Return quantity exceeds available returnable quantity/i)).toBeDefined();
    });

    expect(mockOnSuccess).not.toHaveBeenCalled();
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("validates and rejects fractional quantities for discrete UOM items", async () => {
    const discreteSaleDetail: SaleDetail = {
      ...mockSaleDetail,
      items: [
        {
          ...(mockSaleDetail.items[0] as SaleItemRecord),
          unitOfMeasure: "piece",
        },
      ],
    };

    render(
      <ReturnDialog
        isOpen={true}
        onClose={mockOnClose}
        slug="alpha-store"
        saleDetail={discreteSaleDetail}
        returnHistory={[]}
        onSuccess={mockOnSuccess}
      />
    );

    const qtyInputs = screen.getAllByLabelText(/Return Qty:/i);
    expect(qtyInputs[0]).toBeDefined();
    fireEvent.change(qtyInputs[0]!, { target: { value: "1.5" } });

    const reasonInput = screen.getByPlaceholderText(/Enter customer return reason/i);
    fireEvent.change(reasonInput, { target: { value: "Returning fractional pieces" } });

    const submitBtn = screen.getByRole("button", { name: /Confirm Return/i });
    expect(submitBtn).toBeEnabled();
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Fractional quantities are not permitted for discrete product/i)
      ).toBeDefined();
    });
    expect(salesActions.executeSaleReturnAction).not.toHaveBeenCalled();
  });

  it("renders ceiling warning and disables submission when split-tender ceiling is exceeded", async () => {
    const splitSaleDetail: SaleDetail = {
      ...mockSaleDetail,
      sale: {
        ...mockSaleDetail.sale,
        totalAmount: 100,
      },
      items: [
        {
          ...(mockSaleDetail.items[0] as SaleItemRecord),
          totalPrice: 100,
          quantity: 1,
        },
      ],
      payments: [
        {
          id: "pay-card-1",
          paymentMethod: "card" as const,
          amount: 40, // Card was only 40 out of 100
          amountTendered: 40,
          changeDue: 0,
          referenceNo: "CARD-REF-1",
          createdAt: new Date().toISOString(),
        },
      ],
    };

    render(
      <ReturnDialog
        isOpen={true}
        onClose={mockOnClose}
        slug="alpha-store"
        saleDetail={splitSaleDetail}
        returnHistory={[]}
        onSuccess={mockOnSuccess}
      />
    );

    // Switch tender to Card
    const cardBtn = screen.getByRole("button", { name: /^Card$/i });
    fireEvent.click(cardBtn);

    const reasonInput = screen.getByPlaceholderText(/Enter customer return reason/i);
    fireEvent.change(reasonInput, { target: { value: "Return full item via card" } });

    // Warning alert should be visible
    expect(screen.getByText(/Refund exceeds original card payment/i)).toBeDefined();

    // Confirm button should be disabled
    const submitBtn = screen.getByRole("button", { name: /Confirm Return/i });
    expect(submitBtn).toBeDisabled();
  });
});
