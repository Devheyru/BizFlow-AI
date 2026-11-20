import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { PosCartView, type PosProduct } from "@/components/pos/pos-cart-view";

vi.mock("@/actions/customer-actions", () => ({
  searchCustomersAction: vi.fn().mockResolvedValue({
    success: true,
    data: { items: [], total: 0, page: 1, pageSize: 5 },
  }),
  createCustomerAction: vi.fn(),
  updateCustomerAction: vi.fn(),
}));

vi.mock("@/actions/sales-actions", () => ({
  executeSaleAction: vi.fn(),
}));

describe("PosCartView Component (T050, T053, US1, US3)", () => {
  const sampleProducts: PosProduct[] = [
    {
      id: "prod-1",
      name: "Organic Coffee 1kg",
      sku: "COF-001",
      barcode: "123456789012",
      selling_price: 20.0,
      unit_of_measure: "kg",
      category_id: "cat-1",
      stock_quantity: 15,
      expected_version: 1,
    },
    {
      id: "prod-2",
      name: "Ceramic Mug",
      sku: "MUG-001",
      barcode: null,
      selling_price: 8.5,
      unit_of_measure: "piece",
      category_id: "cat-2",
      stock_quantity: 5,
      expected_version: 1,
    },
  ];

  const sampleCategories = [
    { id: "cat-1", name: "Beverages" },
    { id: "cat-2", name: "Merchandise" },
  ];

  const sampleTaxSettings = {
    taxName: "VAT",
    defaultTaxRate: 10,
    isTaxInclusive: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders POS register header, catalog products, and initial empty cart", () => {
    render(
      <PosCartView
        slug="test-store"
        organizationName="Metro Roasters"
        currency="USD"
        cashierName="Alex"
        products={sampleProducts}
        categories={sampleCategories}
        taxSettings={sampleTaxSettings}
      />
    );

    expect(screen.getByText("POS Register")).toBeDefined();
    expect(screen.getByText(/Cashier:/)).toBeDefined();
    expect(screen.getByText("Organic Coffee 1kg")).toBeDefined();
    expect(screen.getByText("Ceramic Mug")).toBeDefined();
    expect(screen.getByText("Cart is empty")).toBeDefined();
  });

  it("adds product to cart when clicked and increments quantity on subsequent clicks", () => {
    render(
      <PosCartView
        slug="test-store"
        organizationName="Metro Roasters"
        currency="USD"
        cashierName="Alex"
        products={sampleProducts}
        categories={sampleCategories}
        taxSettings={sampleTaxSettings}
      />
    );

    const productCard = screen.getByText("Organic Coffee 1kg").closest("button");
    expect(productCard).toBeDefined();

    // First click -> adds to cart with qty 1
    fireEvent.click(productCard!);
    expect(screen.getByText(/Active Cart \(1 item\)/)).toBeDefined();
    expect(screen.getByTestId("cart-item-row-prod-1")).toBeDefined();

    // Second click -> increments to qty 2 without adding duplicate row
    fireEvent.click(productCard!);
    expect(screen.getByText(/Active Cart \(1 item\)/)).toBeDefined();
    const qtyInput = screen.getByRole("spinbutton", { name: /item quantity/i });
    expect((qtyInput as HTMLInputElement).value).toBe("2");
  });

  it("filters products by search input (name, SKU, barcode)", () => {
    render(
      <PosCartView
        slug="test-store"
        organizationName="Metro Roasters"
        currency="USD"
        cashierName="Alex"
        products={sampleProducts}
        categories={sampleCategories}
        taxSettings={sampleTaxSettings}
      />
    );

    const searchInput = screen.getByLabelText("Product search");
    fireEvent.change(searchInput, { target: { value: "MUG" } });

    expect(screen.getByText("Ceramic Mug")).toBeDefined();
    expect(screen.queryByText("Organic Coffee 1kg")).toBeNull();
  });

  it("clears cart when Clear button is clicked", () => {
    render(
      <PosCartView
        slug="test-store"
        organizationName="Metro Roasters"
        currency="USD"
        cashierName="Alex"
        products={sampleProducts}
        categories={sampleCategories}
        taxSettings={sampleTaxSettings}
      />
    );

    // Add product
    const productCard = screen.getByText("Organic Coffee 1kg").closest("button");
    fireEvent.click(productCard!);
    expect(screen.getByText(/Active Cart \(1 item\)/)).toBeDefined();

    // Clear cart
    const clearBtn = screen.getByRole("button", { name: /clear/i });
    fireEvent.click(clearBtn);

    expect(screen.getByText("Cart is empty")).toBeDefined();
  });

  it("opens payment modal when Proceed to Payment is clicked", () => {
    render(
      <PosCartView
        slug="test-store"
        organizationName="Metro Roasters"
        currency="USD"
        cashierName="Alex"
        products={sampleProducts}
        categories={sampleCategories}
        taxSettings={sampleTaxSettings}
      />
    );

    // Add product
    const productCard = screen.getByText("Organic Coffee 1kg").closest("button");
    fireEvent.click(productCard!);

    const proceedBtn = screen.getByRole("button", { name: /proceed to payment/i });
    expect(proceedBtn).toBeDefined();
    fireEvent.click(proceedBtn);

    expect(screen.getByRole("heading", { name: /process payment/i })).toBeDefined();
  });
});
