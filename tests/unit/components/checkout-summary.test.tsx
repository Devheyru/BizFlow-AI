import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { CheckoutSummary } from "@/components/pos/checkout-summary";

describe("CheckoutSummary Component (T052, US1)", () => {
  it("renders subtotal, tax preview, and payable totals correctly", () => {
    render(
      <CheckoutSummary
        currency="USD"
        subtotal={100}
        totalLineDiscounts={10}
        orderDiscountAmount={5}
        onUpdateOrderDiscount={vi.fn()}
        taxName="VAT"
        taxRate={10}
        isTaxInclusive={false}
        taxAmount={8.5}
        totalPayable={93.5}
      />
    );

    expect(screen.getByText("USD 100.00")).toBeDefined();
    expect(screen.getByText("- USD 10.00")).toBeDefined();
    expect(screen.getByText(/VAT \(10.00%\)/)).toBeDefined();
    expect(screen.getByText("(Added)")).toBeDefined();
    expect(screen.getByText("USD 8.50")).toBeDefined();
    expect(screen.getByText("USD 93.50")).toBeDefined();
  });

  it("displays included indicator when tax is inclusive", () => {
    render(
      <CheckoutSummary
        currency="USD"
        subtotal={50}
        totalLineDiscounts={0}
        orderDiscountAmount={0}
        onUpdateOrderDiscount={vi.fn()}
        taxName="Sales Tax"
        taxRate={5}
        isTaxInclusive={true}
        taxAmount={2.38}
        totalPayable={50.0}
      />
    );

    expect(screen.getByText("(Included)")).toBeDefined();
  });

  it("handles order discount changes and enforces maximum limit", () => {
    const onUpdateOrderDiscount = vi.fn();
    render(
      <CheckoutSummary
        currency="USD"
        subtotal={100}
        totalLineDiscounts={20}
        orderDiscountAmount={0}
        onUpdateOrderDiscount={onUpdateOrderDiscount}
        taxName="VAT"
        taxRate={10}
        isTaxInclusive={false}
        taxAmount={8.0}
        totalPayable={88.0}
      />
    );

    const discInput = screen.getByRole("spinbutton", { name: /order discount amount/i });
    // Subtotal 100 - Line Disc 20 = 80 max allowable
    fireEvent.change(discInput, { target: { value: "100" } });
    expect(onUpdateOrderDiscount).toHaveBeenCalledWith(80);

    fireEvent.change(discInput, { target: { value: "15.50" } });
    expect(onUpdateOrderDiscount).toHaveBeenCalledWith(15.5);
  });
});
