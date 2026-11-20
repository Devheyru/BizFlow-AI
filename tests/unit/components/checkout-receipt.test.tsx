import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { CheckoutReceipt } from "@/components/pos/checkout-receipt";
import type { SaleResult } from "@/types/sales";

describe("CheckoutReceipt Component (T056, US1)", () => {
  const sampleSaleResult: SaleResult = {
    success: true,
    isReplay: false,
    saleId: "00000000-0000-4000-a000-000000000001",
    saleNumber: "S-202611-0001",
    status: "completed",
    paymentStatus: "paid",
    subtotal: 50.0,
    orderDiscountAmount: 5.0,
    taxAmount: 4.5,
    totalAmount: 49.5,
    currency: "USD",
    itemsCount: 1,
    createdAt: "2026-11-20T12:00:00Z",
    createdBy: "cashier-1",
  };

  const sampleItems = [
    {
      productId: "prod-1",
      name: "Espresso Beans",
      sku: "ESP-001",
      unitPrice: 25.0,
      quantity: 2,
      lineDiscountAmount: 0,
      stockQuantity: 10,
    },
  ];

  const samplePayments = [
    {
      id: "pay-1",
      paymentMethod: "cash" as const,
      amount: 49.5,
      amountTendered: 50.0,
      changeDue: 0.5,
      referenceNo: null,
    },
  ];

  it("renders sale number, line items, and totals accurately", () => {
    render(
      <CheckoutReceipt
        isOpen={true}
        onClose={vi.fn()}
        saleResult={sampleSaleResult}
        items={sampleItems}
        payments={samplePayments}
        customer={null}
        organizationName="Corner Bistro"
        onNewSale={vi.fn()}
      />
    );

    expect(screen.getByText("Sale Completed!")).toBeDefined();
    expect(screen.getAllByText(/S-202611-0001/).length).toBeGreaterThan(0);
    expect(screen.getByText("Corner Bistro")).toBeDefined();
    expect(screen.getByText("Espresso Beans")).toBeDefined();
    expect(screen.getByText(/Customer:\s*Walk-in Guest/)).toBeDefined();
    expect(screen.getAllByText("USD 49.50").length).toBeGreaterThan(0);
    expect(screen.getByText("USD 0.50")).toBeDefined();
  });

  it("calls window.print when print button is clicked", () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});

    render(
      <CheckoutReceipt
        isOpen={true}
        onClose={vi.fn()}
        saleResult={sampleSaleResult}
        items={sampleItems}
        payments={samplePayments}
        customer={null}
        organizationName="Corner Bistro"
        onNewSale={vi.fn()}
      />
    );

    const printBtn = screen.getByRole("button", { name: /print receipt/i });
    fireEvent.click(printBtn);
    expect(printSpy).toHaveBeenCalled();

    printSpy.mockRestore();
  });

  it("calls onNewSale when new sale button is clicked", () => {
    const onNewSale = vi.fn();
    render(
      <CheckoutReceipt
        isOpen={true}
        onClose={vi.fn()}
        saleResult={sampleSaleResult}
        items={sampleItems}
        payments={samplePayments}
        customer={null}
        organizationName="Corner Bistro"
        onNewSale={onNewSale}
      />
    );

    const newSaleBtn = screen.getByRole("button", { name: /new sale/i });
    fireEvent.click(newSaleBtn);
    expect(onNewSale).toHaveBeenCalled();
  });
});
