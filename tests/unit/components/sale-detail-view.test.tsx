import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { SaleDetailView } from "@/components/sales/sale-detail-view";
import type { SaleDetail, ReturnHistory } from "@/types/sales";

describe("SaleDetailView Component (T064, US5)", () => {
  const mockSaleDetail: SaleDetail = {
    sale: {
      id: "sale-101",
      organizationId: "org-1",
      saleNumber: "SAL-20261121-0001",
      customerId: "cust-1",
      status: "completed",
      paymentStatus: "paid",
      subtotal: 100.0,
      orderDiscountAmount: 0.0,
      taxableAmount: 100.0,
      taxAmount: 10.0,
      totalAmount: 110.0,
      currency: "USD",
      isTaxInclusive: false,
      taxRate: 10.0,
      taxName: "VAT",
      notes: null,
      createdAt: "2026-11-21T12:00:00Z",
      createdBy: "user-1",
    },
    customer: {
      id: "cust-1",
      name: "Diana Prince",
      phone: "+1987654321",
      email: "diana@amazon.com",
    },
    items: [
      {
        id: "item-1",
        productId: "prod-1",
        productName: "Gaming Headset",
        sku: "SKU-HEAD-01",
        quantity: 1,
        unitPrice: 100.0,
        unitCost: 65.0, // Cost present in data object
        lineDiscountAmount: 0,
        allocatedOrderDisc: 0,
        taxableAmount: 100.0,
        allocatedTaxAmount: 10.0,
        totalPrice: 110.0,
        movementId: "mov-1",
      },
    ],
    payments: [
      {
        id: "pay-1",
        paymentMethod: "card",
        amount: 110.0,
        amountTendered: null,
        changeDue: null,
        referenceNo: "AUTH-9999",
        createdAt: "2026-11-21T12:00:00Z",
      },
    ],
    returns: [],
    refunds: [],
  };

  const mockReturnHistory: ReturnHistory[] = [
    {
      id: "ret-1",
      returnNumber: "RET-20261121-0001",
      saleId: "sale-101",
      refundMethod: "card",
      reason: "Item defective",
      totalRefundAmount: 110.0,
      createdAt: "2026-11-21T13:00:00Z",
      createdBy: "cashier-1",
      items: [
        {
          id: "ret-item-1",
          saleItemId: "item-1",
          productId: "prod-1",
          productName: "Gaming Headset",
          sku: "SKU-HEAD-01",
          quantity: 1,
          refundAmount: 110.0,
          restockToInventory: true,
          movementId: "mov-ret-1",
        },
      ],
      refunds: [
        {
          id: "ref-1",
          obligationRefundId: "ref-1",
          replacesRefundId: null,
          paymentId: null,
          saleReturnId: "ret-1",
          refundMethod: "card",
          amount: 110.0,
          status: "completed",
          referenceNo: "REV-9999",
          externalReference: null,
          failureReason: null,
          createdAt: "2026-11-21T13:00:00Z",
          updatedAt: "2026-11-21T13:00:00Z",
        },
      ],
    },
  ];

  it("renders overview, customer, line items, and totals accurately", () => {
    render(
      <SaleDetailView
        slug="alpha-store"
        saleDetail={mockSaleDetail}
        returnHistory={[]}
        canViewCost={false}
        organizationName="Alpha Store"
      />
    );

    expect(screen.getByText("SAL-20261121-0001")).toBeDefined();
    expect(screen.getByText("Diana Prince")).toBeDefined();
    expect(screen.getByText("Gaming Headset")).toBeDefined();
    expect(screen.getAllByText(/\$110\.00/).length).toBeGreaterThan(0);
  });

  it("hides unit cost column when canViewCost is false", () => {
    render(
      <SaleDetailView
        slug="alpha-store"
        saleDetail={mockSaleDetail}
        returnHistory={[]}
        canViewCost={false}
        organizationName="Alpha Store"
      />
    );

    expect(screen.queryByText("Unit Cost")).toBeNull();
  });

  it("displays unit cost column when canViewCost is true", () => {
    render(
      <SaleDetailView
        slug="alpha-store"
        saleDetail={mockSaleDetail}
        returnHistory={[]}
        canViewCost={true}
        organizationName="Alpha Store"
      />
    );

    expect(screen.getByText("Unit Cost")).toBeDefined();
    expect(screen.getByText("$65.00")).toBeDefined();
  });

  it("switches to payments tab and shows tender information", () => {
    render(
      <SaleDetailView
        slug="alpha-store"
        saleDetail={mockSaleDetail}
        returnHistory={[]}
        canViewCost={false}
        organizationName="Alpha Store"
      />
    );

    const paymentsTab = screen.getByRole("button", { name: /Payments & Tenders/i });
    fireEvent.click(paymentsTab);

    expect(screen.getByText(/card/i)).toBeDefined();
    expect(screen.getByText("AUTH-9999")).toBeDefined();
  });

  it("switches to returns tab and shows returns with restock and refund badges", () => {
    render(
      <SaleDetailView
        slug="alpha-store"
        saleDetail={mockSaleDetail}
        returnHistory={mockReturnHistory}
        canViewCost={false}
        organizationName="Alpha Store"
      />
    );

    const returnsTab = screen.getByRole("button", { name: /Returns & Refunds/i });
    fireEvent.click(returnsTab);

    expect(screen.getByText("RET-20261121-0001")).toBeDefined();
    expect(screen.getByText(/Item defective/i)).toBeDefined();
    expect(screen.getByText("Restocked")).toBeDefined();
    expect(screen.getByText(/REV-9999/)).toBeDefined();
  });

  it("opens thermal receipt dialog when print button is clicked", () => {
    render(
      <SaleDetailView
        slug="alpha-store"
        saleDetail={mockSaleDetail}
        returnHistory={[]}
        canViewCost={false}
        organizationName="Alpha Store"
      />
    );

    const printBtn = screen.getByRole("button", { name: /Print Receipt/i });
    fireEvent.click(printBtn);

    expect(screen.getByText(/Receipt Preview/i)).toBeDefined();
  });
});
