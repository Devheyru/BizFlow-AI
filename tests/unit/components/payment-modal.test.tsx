import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { PaymentModal } from "@/components/pos/payment-modal";

describe("PaymentModal Component (T054, US1, US3)", () => {
  it("renders total payable and balance due correctly", () => {
    render(
      <PaymentModal
        isOpen={true}
        onClose={vi.fn()}
        currency="USD"
        totalPayable={100}
        onConfirmPayments={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: /process payment/i })).toBeDefined();
    expect(screen.getAllByText("USD 100.00").length).toBeGreaterThan(0);
  });

  it("supports single cash payment with change calculation", () => {
    const onConfirmPayments = vi.fn();
    render(
      <PaymentModal
        isOpen={true}
        onClose={vi.fn()}
        currency="USD"
        totalPayable={43.5}
        onConfirmPayments={onConfirmPayments}
      />
    );

    // Enter cash tender of 50.00
    const cashInput = screen.getByLabelText(/cash received/i);
    fireEvent.change(cashInput, { target: { value: "50.00" } });

    // Add tender
    const addTenderBtn = screen.getByRole("button", { name: /add tender/i });
    fireEvent.click(addTenderBtn);

    // Verify change due is displayed
    expect(screen.getByText("Customer Change Due")).toBeDefined();
    expect(screen.getByText("USD 6.50")).toBeDefined();

    // Complete Checkout button should be enabled
    const completeBtn = screen.getByRole("button", { name: /complete checkout/i });
    expect(completeBtn).toBeDefined();
    fireEvent.click(completeBtn);

    expect(onConfirmPayments).toHaveBeenCalledWith([
      expect.objectContaining({
        paymentMethod: "cash",
        amount: 43.5,
        amountTendered: 50,
        changeDue: 6.5,
      }),
    ]);
  });

  it("enforces mandatory transaction reference for non-cash tenders (P0057)", () => {
    render(
      <PaymentModal
        isOpen={true}
        onClose={vi.fn()}
        currency="USD"
        totalPayable={100}
        onConfirmPayments={vi.fn()}
      />
    );

    // Select Card
    const cardBtn = screen.getByRole("button", { name: /card/i });
    fireEvent.click(cardBtn);

    // Attempt to add tender without reference
    const addTenderBtn = screen.getByRole("button", { name: /add tender/i });
    fireEvent.click(addTenderBtn);

    expect(screen.getByText(/transaction reference is required/i)).toBeDefined();

    // Enter reference and add tender
    const refInput = screen.getByLabelText(/transaction reference/i);
    fireEvent.change(refInput, { target: { value: "AUTH-12345" } });
    fireEvent.click(addTenderBtn);

    expect(screen.getByText(/ref: auth-12345/i)).toBeDefined();
  });

  it("supports split tenders across card and cash", () => {
    const onConfirmPayments = vi.fn();
    render(
      <PaymentModal
        isOpen={true}
        onClose={vi.fn()}
        currency="USD"
        totalPayable={100}
        onConfirmPayments={onConfirmPayments}
      />
    );

    // Tender 1: Card 40.00
    const cardBtn = screen.getByRole("button", { name: /card/i });
    fireEvent.click(cardBtn);
    const amountInput = screen.getByLabelText(/payment amount/i);
    fireEvent.change(amountInput, { target: { value: "40.00" } });
    const refInput = screen.getByLabelText(/transaction reference/i);
    fireEvent.change(refInput, { target: { value: "CARD-AUTH-99" } });
    fireEvent.click(screen.getByRole("button", { name: /add tender/i }));

    // Tender 2: Cash 60.00 with 70.00 received
    const cashBtn = screen.getByRole("button", { name: /cash/i });
    fireEvent.click(cashBtn);
    const cashReceivedInput = screen.getByLabelText(/cash received/i);
    fireEvent.change(cashReceivedInput, { target: { value: "70.00" } });
    fireEvent.click(screen.getByRole("button", { name: /add tender/i }));

    // Confirm payments
    const completeBtn = screen.getByRole("button", { name: /complete checkout/i });
    fireEvent.click(completeBtn);

    expect(onConfirmPayments).toHaveBeenCalledWith([
      expect.objectContaining({
        paymentMethod: "card",
        amount: 40,
        referenceNo: "CARD-AUTH-99",
      }),
      expect.objectContaining({
        paymentMethod: "cash",
        amount: 60,
        amountTendered: 70,
        changeDue: 10,
      }),
    ]);
  });
});
