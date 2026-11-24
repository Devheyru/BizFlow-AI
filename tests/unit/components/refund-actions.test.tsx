import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  RefundActions,
  ConfirmRefundDialog,
  RecordRefundFailureDialog,
  IssueReplacementRefundDialog,
} from "@/components/sales/refund-actions";
import * as salesActions from "@/actions/sales-actions";
import type { RefundRecord, PaymentRecord } from "@/types/sales";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

vi.mock("@/actions/sales-actions", () => ({
  confirmRefundAction: vi.fn(),
  recordRefundFailureAction: vi.fn(),
  issueReplacementRefundAction: vi.fn(),
}));

describe("Refund Lifecycle Components Unit Tests (T075, US7)", () => {
  const mockSlug = "alpha-store";
  const mockPayments: PaymentRecord[] = [
    {
      id: "pay-1",
      paymentMethod: "card",
      amount: 100.0,
      amountTendered: null,
      changeDue: null,
      referenceNo: "CARD-101",
      createdAt: "2026-11-23T12:00:00Z",
    },
    {
      id: "pay-2",
      paymentMethod: "cash",
      amount: 50.0,
      amountTendered: 50.0,
      changeDue: 0.0,
      referenceNo: null,
      createdAt: "2026-11-23T12:00:00Z",
    },
  ];

  const pendingRefund: RefundRecord = {
    id: "ref-pending-1",
    obligationRefundId: "ob-1",
    replacesRefundId: null,
    paymentId: "pay-1",
    saleReturnId: null,
    refundMethod: "card",
    amount: 100.0,
    status: "pending",
    referenceNo: null,
    externalReference: null,
    failureReason: null,
    createdAt: "2026-11-23T12:30:00Z",
    updatedAt: "2026-11-23T12:30:00Z",
  };

  const failedRefund: RefundRecord = {
    id: "ref-failed-1",
    obligationRefundId: "ob-2",
    replacesRefundId: null,
    paymentId: "pay-1",
    saleReturnId: null,
    refundMethod: "card",
    amount: 50.0,
    status: "failed",
    referenceNo: null,
    externalReference: null,
    failureReason: "Card expired on gateway",
    createdAt: "2026-11-23T13:00:00Z",
    updatedAt: "2026-11-23T13:05:00Z",
  };

  const completedRefund: RefundRecord = {
    id: "ref-completed-1",
    obligationRefundId: "ob-3",
    replacesRefundId: null,
    paymentId: "pay-2",
    saleReturnId: null,
    refundMethod: "cash",
    amount: 30.0,
    status: "completed",
    referenceNo: "CASH-PAID",
    externalReference: null,
    failureReason: null,
    createdAt: "2026-11-23T14:00:00Z",
    updatedAt: "2026-11-23T14:00:00Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // 1. RefundActions Container Tests
  // ==========================================================================
  describe("RefundActions Container", () => {
    it("renders empty notice when refunds list is empty", () => {
      render(
        <RefundActions
          slug={mockSlug}
          refunds={[]}
          payments={mockPayments}
          canConfirm={true}
          canFail={true}
          canReplace={true}
        />
      );

      expect(screen.getByText(/No refund disbursements recorded for this sale/i)).toBeDefined();
    });

    it("renders refund items with status badges and action buttons", () => {
      render(
        <RefundActions
          slug={mockSlug}
          refunds={[pendingRefund, failedRefund, completedRefund]}
          payments={mockPayments}
          canConfirm={true}
          canFail={true}
          canReplace={true}
        />
      );

      // Pending refund
      expect(screen.getByText(/Pending Confirmation/i)).toBeDefined();
      expect(screen.getByRole("button", { name: /confirm/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /fail/i })).toBeDefined();

      // Failed refund
      expect(screen.getByText(/Card expired on gateway/i)).toBeDefined();
      expect(screen.getByRole("button", { name: /replace/i })).toBeDefined();

      // Completed refund
      expect(screen.getByText(/Completed/i)).toBeDefined();
    });

    it("hides action buttons when user lacks permissions", () => {
      render(
        <RefundActions
          slug={mockSlug}
          refunds={[pendingRefund, failedRefund]}
          payments={mockPayments}
          canConfirm={false}
          canFail={false}
          canReplace={false}
        />
      );

      expect(screen.queryByRole("button", { name: /confirm/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /fail/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /replace/i })).toBeNull();
    });

    it("shows 'Replacement already active' and hides Replace button when active replacement exists", () => {
      const activeReplacement: RefundRecord = {
        id: "ref-replacement-1",
        obligationRefundId: failedRefund.obligationRefundId, // Same obligation
        replacesRefundId: failedRefund.id,
        paymentId: null,
        saleReturnId: null,
        refundMethod: "card",
        amount: failedRefund.amount,
        status: "pending", // active attempt exists!
        referenceNo: null,
        externalReference: null,
        failureReason: null,
        createdAt: "2026-11-23T13:10:00Z",
        updatedAt: "2026-11-23T13:10:00Z",
      };

      render(
        <RefundActions
          slug={mockSlug}
          refunds={[failedRefund, activeReplacement]}
          payments={mockPayments}
          canConfirm={true}
          canFail={true}
          canReplace={true}
        />
      );

      expect(screen.getByText(/Replacement already active/i)).toBeDefined();
      expect(screen.queryByRole("button", { name: /replace/i })).toBeNull();
    });
  });

  // ==========================================================================
  // 2. ConfirmRefundDialog Tests
  // ==========================================================================
  describe("ConfirmRefundDialog", () => {
    const mockOnClose = vi.fn();
    const mockOnSuccess = vi.fn();

    it("does not render when isOpen is false", () => {
      const { container } = render(
        <ConfirmRefundDialog
          isOpen={false}
          onClose={mockOnClose}
          slug={mockSlug}
          refund={pendingRefund}
        />
      );

      expect(container.firstChild).toBeNull();
    });

    it("renders modal details when open", () => {
      render(
        <ConfirmRefundDialog
          isOpen={true}
          onClose={mockOnClose}
          slug={mockSlug}
          refund={pendingRefund}
        />
      );

      expect(screen.getByText(/Confirm Refund Reimbursement/i)).toBeDefined();
      expect(screen.getByPlaceholderText(/e\.g\. REV-CARD/i)).toBeDefined();
    });

    it("shows validation error when submitted with empty reference", () => {
      render(
        <ConfirmRefundDialog
          isOpen={true}
          onClose={mockOnClose}
          slug={mockSlug}
          refund={pendingRefund}
        />
      );

      const submitBtn = screen.getByRole("button", { name: /Confirm Reimbursement/i });
      fireEvent.click(submitBtn);

      expect(screen.getByText(/External reversal reference is required/i)).toBeDefined();
      expect(salesActions.confirmRefundAction).not.toHaveBeenCalled();
    });

    it("submits action with trimmed reference and invokes onSuccess", async () => {
      vi.mocked(salesActions.confirmRefundAction).mockResolvedValue({
        success: true,
        data: {
          success: true,
          isReplay: false,
          refundId: pendingRefund.id,
          status: "completed",
          externalReference: "REV-99988",
          confirmedAt: "2026-11-23T14:00:00Z",
        },
      });

      render(
        <ConfirmRefundDialog
          isOpen={true}
          onClose={mockOnClose}
          slug={mockSlug}
          refund={pendingRefund}
          onSuccess={mockOnSuccess}
        />
      );

      const input = screen.getByPlaceholderText(/e\.g\. REV-CARD/i);
      fireEvent.change(input, { target: { value: "   REV-99988   " } });

      const submitBtn = screen.getByRole("button", { name: /Confirm Reimbursement/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(salesActions.confirmRefundAction).toHaveBeenCalledWith(
          mockSlug,
          expect.objectContaining({
            refundId: pendingRefund.id,
            externalReference: "REV-99988",
          })
        );
        expect(mockOnSuccess).toHaveBeenCalled();
        expect(mockOnClose).toHaveBeenCalled();
      });
    });

    it("displays error message when action returns error", async () => {
      vi.mocked(salesActions.confirmRefundAction).mockResolvedValue({
        success: false,
        error: { code: "P0024", message: "Idempotency key collision detected." },
      });

      render(
        <ConfirmRefundDialog
          isOpen={true}
          onClose={mockOnClose}
          slug={mockSlug}
          refund={pendingRefund}
        />
      );

      const input = screen.getByPlaceholderText(/e\.g\. REV-CARD/i);
      fireEvent.change(input, { target: { value: "REV-101" } });

      const submitBtn = screen.getByRole("button", { name: /Confirm Reimbursement/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText(/Idempotency key collision detected/i)).toBeDefined();
      });
    });
  });

  // ==========================================================================
  // 3. RecordRefundFailureDialog Tests
  // ==========================================================================
  describe("RecordRefundFailureDialog", () => {
    const mockOnClose = vi.fn();
    const mockOnSuccess = vi.fn();

    it("shows validation error if failure reason has fewer than 3 characters", () => {
      render(
        <RecordRefundFailureDialog
          isOpen={true}
          onClose={mockOnClose}
          slug={mockSlug}
          refund={pendingRefund}
        />
      );

      const input = screen.getByPlaceholderText(/e\.g\. Card expired/i);
      fireEvent.change(input, { target: { value: "no" } });

      const submitBtn = screen.getByRole("button", { name: /Record Failure/i });
      fireEvent.click(submitBtn);

      expect(screen.getByText(/minimum 3 characters/i)).toBeDefined();
      expect(salesActions.recordRefundFailureAction).not.toHaveBeenCalled();
    });

    it("submits action with reason and invokes onSuccess", async () => {
      vi.mocked(salesActions.recordRefundFailureAction).mockResolvedValue({
        success: true,
        data: {
          success: true,
          refundId: pendingRefund.id,
          status: "failed",
          failureReason: "Gateway transaction timeout",
          failedAt: "2026-11-23T14:05:00Z",
        },
      });

      render(
        <RecordRefundFailureDialog
          isOpen={true}
          onClose={mockOnClose}
          slug={mockSlug}
          refund={pendingRefund}
          onSuccess={mockOnSuccess}
        />
      );

      const input = screen.getByPlaceholderText(/e\.g\. Card expired/i);
      fireEvent.change(input, { target: { value: "Gateway transaction timeout" } });

      const submitBtn = screen.getByRole("button", { name: /Record Failure/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(salesActions.recordRefundFailureAction).toHaveBeenCalledWith(
          mockSlug,
          expect.objectContaining({
            refundId: pendingRefund.id,
            failureReason: "Gateway transaction timeout",
          })
        );
        expect(mockOnSuccess).toHaveBeenCalled();
        expect(mockOnClose).toHaveBeenCalled();
      });
    });
  });

  // ==========================================================================
  // 4. IssueReplacementRefundDialog Tests
  // ==========================================================================
  describe("IssueReplacementRefundDialog", () => {
    const mockOnClose = vi.fn();
    const mockOnSuccess = vi.fn();

    it("renders method selector and allows selecting available payment methods", () => {
      render(
        <IssueReplacementRefundDialog
          isOpen={true}
          onClose={mockOnClose}
          slug={mockSlug}
          refund={failedRefund}
          payments={mockPayments}
        />
      );

      expect(screen.getByText(/Issue Replacement Reimbursement/i)).toBeDefined();
      const methodSelect = screen.getByLabelText(/Replacement Refund Method/i);
      expect(methodSelect).toBeDefined();

      // Card option should be enabled because payments had card
      // Bank transfer should be disabled because payments lacked bank_transfer
      const bankOption = screen.getByRole("option", { name: /Bank Transfer \(Not used in sale\)/i });
      expect((bankOption as HTMLOptionElement).disabled).toBe(true);
    });

    it("submits replacement refund action with selected method and reference", async () => {
      vi.mocked(salesActions.issueReplacementRefundAction).mockResolvedValue({
        success: true,
        data: {
          success: true,
          isReplay: false,
          replacementRefundId: "rep-101",
          obligationRefundId: failedRefund.obligationRefundId,
          failedRefundId: failedRefund.id,
          status: "completed",
          refundMethod: "cash",
          amount: 50.0,
          createdAt: "2026-11-23T14:15:00Z",
        },
      });

      render(
        <IssueReplacementRefundDialog
          isOpen={true}
          onClose={mockOnClose}
          slug={mockSlug}
          refund={failedRefund}
          payments={mockPayments}
          onSuccess={mockOnSuccess}
        />
      );

      const notesInput = screen.getByPlaceholderText(/Auditable reason/i);
      fireEvent.change(notesInput, { target: { value: "Customer opted for cash payout" } });

      const submitBtn = screen.getByRole("button", { name: /Issue Replacement/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(salesActions.issueReplacementRefundAction).toHaveBeenCalledWith(
          mockSlug,
          expect.objectContaining({
            failedRefundId: failedRefund.id,
            refundMethod: "cash",
            notes: "Customer opted for cash payout",
          })
        );
        expect(mockOnSuccess).toHaveBeenCalled();
        expect(mockOnClose).toHaveBeenCalled();
      });
    });

    it("displays error message if server returns P0064 REPLACEMENT_REFUND_ALREADY_EXISTS", async () => {
      vi.mocked(salesActions.issueReplacementRefundAction).mockResolvedValue({
        success: false,
        error: { code: "P0064", message: "An active replacement refund already exists for this failed refund." },
      });

      render(
        <IssueReplacementRefundDialog
          isOpen={true}
          onClose={mockOnClose}
          slug={mockSlug}
          refund={failedRefund}
          payments={mockPayments}
        />
      );

      const submitBtn = screen.getByRole("button", { name: /Issue Replacement/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText(/An active replacement refund already exists/i)).toBeDefined();
      });
    });
  });
});
