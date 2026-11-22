import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReceiptPrint } from "@/components/sales/receipt-print";
import type { SaleDetailHeader, SaleItemRecord, PaymentRecord } from "@/types/sales";

describe("ReceiptPrint Component (T065, US5)", () => {
  const mockSale: SaleDetailHeader = {
    id: "sale-1",
    organizationId: "org-1",
    saleNumber: "SAL-20261121-0001",
    customerId: "cust-1",
    status: "completed",
    paymentStatus: "paid",
    subtotal: 100.0,
    orderDiscountAmount: 5.0,
    taxableAmount: 95.0,
    taxAmount: 9.5,
    totalAmount: 104.5,
    currency: "USD",
    isTaxInclusive: false,
    taxRate: 10.0,
    taxName: "Sales Tax",
    notes: "Thanks",
    createdAt: "2026-11-21T10:00:00Z",
    createdBy: "cashier-1",
  };

  const mockCustomer = {
    id: "cust-1",
    name: "Alice Smith",
    phone: "+1234567890",
    email: "alice@example.com",
  };

  const mockItems: SaleItemRecord[] = [
    {
      id: "item-1",
      productId: "prod-1",
      productName: "Wireless Keyboard",
      sku: "SKU-KEY-01",
      quantity: 2,
      unitPrice: 50.0,
      unitCost: null,
      lineDiscountAmount: 0,
      allocatedOrderDisc: 5.0,
      taxableAmount: 95.0,
      allocatedTaxAmount: 9.5,
      totalPrice: 104.5,
      movementId: "mov-1",
    },
  ];

  const mockPayments: PaymentRecord[] = [
    {
      id: "pay-1",
      paymentMethod: "cash",
      amount: 104.5,
      amountTendered: 110.0,
      changeDue: 5.5,
      referenceNo: null,
      createdAt: "2026-11-21T10:00:00Z",
    },
  ];

  it("renders complete receipt header, lines, totals, and return policy notice", () => {
    render(
      <ReceiptPrint
        sale={mockSale}
        customer={mockCustomer}
        items={mockItems}
        payments={mockPayments}
        organizationName="Downtown Retail Store"
        cashierName="John Cashier"
      />
    );

    // Header & Meta
    expect(screen.getByText("Downtown Retail Store")).toBeDefined();
    expect(screen.getByText("SAL-20261121-0001")).toBeDefined();
    expect(screen.getByText("John Cashier")).toBeDefined();
    expect(screen.getByText("Alice Smith")).toBeDefined();

    // Items
    expect(screen.getByText("Wireless Keyboard")).toBeDefined();

    // Totals
    expect(screen.getByText(/^TOTAL:/)).toBeDefined();
    expect(screen.getAllByText(/\$104\.50/).length).toBeGreaterThan(0);

    // Cash Change Due
    expect(screen.getByText("Change:")).toBeDefined();
    expect(screen.getByText("$5.50")).toBeDefined();

    // Policy notice
    expect(screen.getByText(/Items in original condition may be returned within 14 days/i)).toBeDefined();
  });

  it("switches paper width to 58mm when toggled", () => {
    render(
      <ReceiptPrint
        sale={mockSale}
        customer={mockCustomer}
        items={mockItems}
        payments={mockPayments}
        organizationName="Downtown Retail Store"
      />
    );

    const btn58 = screen.getByRole("button", { name: "58mm" });
    fireEvent.click(btn58);

    const printArea = document.getElementById("thermal-receipt-print-area");
    expect(printArea?.className).toContain("w-[220px]");
  });

  it("triggers window.print when print button is clicked", () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});

    render(
      <ReceiptPrint
        sale={mockSale}
        customer={mockCustomer}
        items={mockItems}
        payments={mockPayments}
        organizationName="Downtown Retail Store"
      />
    );

    const printBtn = screen.getByRole("button", { name: /^Print$/i });
    fireEvent.click(printBtn);

    expect(printSpy).toHaveBeenCalled();
    printSpy.mockRestore();
  });

  it("does not expose cost prices or margin calculations", () => {
    render(
      <ReceiptPrint
        sale={mockSale}
        customer={mockCustomer}
        items={mockItems}
        payments={mockPayments}
        organizationName="Downtown Retail Store"
      />
    );

    expect(screen.queryByText(/Cost/i)).toBeNull();
    expect(screen.queryByText(/Margin/i)).toBeNull();
  });
});
