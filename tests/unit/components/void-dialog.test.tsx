import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VoidDialog } from "@/components/sales/void-dialog";
import * as salesActions from "@/actions/sales-actions";
import type { PaymentRecord } from "@/types/sales";

vi.mock("@/actions/sales-actions", () => ({
  voidSaleAction: vi.fn(),
}));

describe("VoidDialog Component (T067, US6)", () => {
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();

  const mockPayments: PaymentRecord[] = [
    {
      id: "pay-cash-1",
      paymentMethod: "cash",
      amount: 40.0,
      amountTendered: 50.0,
      changeDue: 10.0,
      referenceNo: null,
      createdAt: "2026-11-21T12:00:00Z",
    },
    {
      id: "pay-card-2",
      paymentMethod: "card",
      amount: 60.0,
      amountTendered: null,
      changeDue: null,
      referenceNo: "AUTH-8888",
      createdAt: "2026-11-21T12:00:00Z",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <VoidDialog
        isOpen={false}
        onClose={mockOnClose}
        slug="alpha-store"
        saleId="sale-101"
        saleNumber="SAL-001"
        totalAmount={100.0}
        currency="USD"
        payments={mockPayments}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders title, warning notice, and payment breakdown when isOpen is true", () => {
    render(
      <VoidDialog
        isOpen={true}
        onClose={mockOnClose}
        slug="alpha-store"
        saleId="sale-101"
        saleNumber="SAL-001"
        totalAmount={100.0}
        currency="USD"
        payments={mockPayments}
      />
    );

    expect(screen.getByText(/Void Sale SAL-001/i)).toBeDefined();
    expect(screen.getByText(/Permanent Transaction Reversal/i)).toBeDefined();
    expect(screen.getByText(/Payment Tender Reimbursement Breakdown/i)).toBeDefined();
    expect(screen.getByText(/Immediate Cash Refund/i)).toBeDefined();
    expect(screen.getByText(/Pending External Reimbursement/i)).toBeDefined();
  });

  it("shows optional reference input for non-cash payment tender", () => {
    render(
      <VoidDialog
        isOpen={true}
        onClose={mockOnClose}
        slug="alpha-store"
        saleId="sale-101"
        saleNumber="SAL-001"
        totalAmount={100.0}
        currency="USD"
        payments={mockPayments}
      />
    );

    const refInput = screen.getByPlaceholderText(/e\.g\. REV-AUTH-12345/i);
    expect(refInput).toBeDefined();

    fireEvent.change(refInput, { target: { value: "TERM-REV-1234" } });
    expect((refInput as HTMLInputElement).value).toBe("TERM-REV-1234");
  });

  it("disables confirm button when reason has less than 3 characters", () => {
    render(
      <VoidDialog
        isOpen={true}
        onClose={mockOnClose}
        slug="alpha-store"
        saleId="sale-101"
        saleNumber="SAL-001"
        totalAmount={100.0}
        currency="USD"
        payments={mockPayments}
      />
    );

    const reasonInput = screen.getByPlaceholderText(/Enter the business justification for voiding this sale/i);
    const submitBtn = screen.getByRole("button", { name: /Confirm Void/i });

    // Initially empty -> disabled
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);

    // 2 chars -> disabled
    fireEvent.change(reasonInput, { target: { value: "ab" } });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);

    // 3 chars -> enabled
    fireEvent.change(reasonInput, { target: { value: "abc" } });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("submits voidSaleAction with correct payload and calls onSuccess upon success", async () => {
    vi.mocked(salesActions.voidSaleAction).mockResolvedValue({
      success: true,
      data: {
        success: true,
        isReplay: false,
        saleId: "sale-101",
        saleNumber: "SAL-001",
        status: "voided",
        paymentStatus: "partially_refunded",
        voidedAt: "2026-11-21T12:05:00Z",
      },
    });

    render(
      <VoidDialog
        isOpen={true}
        onClose={mockOnClose}
        slug="alpha-store"
        saleId="sale-101"
        saleNumber="SAL-001"
        totalAmount={100.0}
        currency="USD"
        payments={mockPayments}
        onSuccess={mockOnSuccess}
      />
    );

    const reasonInput = screen.getByPlaceholderText(/Enter the business justification for voiding this sale/i);
    const refInput = screen.getByPlaceholderText(/e\.g\. REV-AUTH-12345/i);
    const submitBtn = screen.getByRole("button", { name: /Confirm Void/i });

    fireEvent.change(reasonInput, { target: { value: "Customer payment card declined at counter" } });
    fireEvent.change(refInput, { target: { value: "REV-AUTH-9912" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(salesActions.voidSaleAction).toHaveBeenCalledTimes(1);
    });

    const callArgs = vi.mocked(salesActions.voidSaleAction).mock.calls[0];
    expect(callArgs).toBeDefined();
    if (!callArgs) throw new Error("Expected callArgs to be defined");
    expect(callArgs[0]).toBe("alpha-store");
    const inputArg = callArgs[1] as any;
    expect(inputArg.saleId).toBe("sale-101");
    expect(inputArg.voidReason).toBe("Customer payment card declined at counter");
    expect(inputArg.idempotencyKey).toBeDefined();
    expect(inputArg.reversalReferences).toEqual([
      { paymentId: "pay-card-2", referenceNo: "REV-AUTH-9912" },
    ]);

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalledTimes(1);
    });
  });

  it("displays server error message when voidSaleAction fails", async () => {
    vi.mocked(salesActions.voidSaleAction).mockResolvedValue({
      success: false,
      error: {
        code: "SALE_VOID_HAS_RETURNS_BLOCKED",
        message: "Sale cannot be voided after returns have been processed.",
      },
    });

    render(
      <VoidDialog
        isOpen={true}
        onClose={mockOnClose}
        slug="alpha-store"
        saleId="sale-101"
        saleNumber="SAL-001"
        totalAmount={100.0}
        currency="USD"
        payments={mockPayments}
      />
    );

    const reasonInput = screen.getByPlaceholderText(/Enter the business justification for voiding this sale/i);
    const submitBtn = screen.getByRole("button", { name: /Confirm Void/i });

    fireEvent.change(reasonInput, { target: { value: "Duplicate transaction rung up" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText("Sale cannot be voided after returns have been processed.")
      ).toBeDefined();
    });
  });

  it("calls onClose when Cancel button or escape key is pressed", () => {
    render(
      <VoidDialog
        isOpen={true}
        onClose={mockOnClose}
        slug="alpha-store"
        saleId="sale-101"
        saleNumber="SAL-001"
        totalAmount={100.0}
        currency="USD"
        payments={mockPayments}
      />
    );

    const cancelBtn = screen.getByRole("button", { name: /Cancel/i });
    fireEvent.click(cancelBtn);

    expect(mockOnClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(mockOnClose).toHaveBeenCalledTimes(2);
  });
});
