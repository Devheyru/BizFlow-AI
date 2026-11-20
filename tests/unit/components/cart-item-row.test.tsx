import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { CartItemRow, type CartItem } from "@/components/pos/cart-item-row";

describe("CartItemRow Component (T051, US1)", () => {
  const sampleItem: CartItem = {
    productId: "00000000-0000-4000-a000-000000000001",
    name: "Artisan Coffee Beans",
    sku: "COF-001",
    unitPrice: 15.0,
    quantity: 2,
    lineDiscountAmount: 0,
    unitOfMeasure: "kg",
    stockQuantity: 10,
    expectedVersion: 1,
  };

  const sampleDiscreteItem: CartItem = {
    productId: "00000000-0000-4000-a000-000000000002",
    name: "Ceramic Mug",
    sku: "MUG-001",
    unitPrice: 10.0,
    quantity: 1,
    lineDiscountAmount: 2.0,
    unitOfMeasure: "piece",
    stockQuantity: 3,
    expectedVersion: 2,
  };

  it("renders product name, sku, unit price, and net total accurately", () => {
    render(
      <CartItemRow
        item={sampleItem}
        currency="USD"
        onUpdateQuantity={vi.fn()}
        onUpdateLineDiscount={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(screen.getByText("Artisan Coffee Beans")).toBeDefined();
    expect(screen.getByText(/SKU: COF-001/)).toBeDefined();
    expect(screen.getByText(/USD 15.00/)).toBeDefined();
    // 2 * 15 = 30.00 net
    expect(screen.getByText("USD 30.00")).toBeDefined();
  });

  it("invokes onUpdateQuantity when quantity controls are clicked", () => {
    const onUpdateQuantity = vi.fn();
    render(
      <CartItemRow
        item={sampleItem}
        currency="USD"
        onUpdateQuantity={onUpdateQuantity}
        onUpdateLineDiscount={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    const plusBtn = screen.getByRole("button", { name: /increase quantity/i });
    fireEvent.click(plusBtn);
    expect(onUpdateQuantity).toHaveBeenCalledWith(sampleItem.productId, 3);

    const minusBtn = screen.getByRole("button", { name: /decrease quantity/i });
    fireEvent.click(minusBtn);
    expect(onUpdateQuantity).toHaveBeenCalledWith(sampleItem.productId, 1);
  });

  it("enforces integer quantities for discrete UOM items", () => {
    const onUpdateQuantity = vi.fn();
    render(
      <CartItemRow
        item={sampleDiscreteItem}
        currency="USD"
        onUpdateQuantity={onUpdateQuantity}
        onUpdateLineDiscount={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    const qtyInput = screen.getByRole("spinbutton", { name: /item quantity/i });
    fireEvent.change(qtyInput, { target: { value: "3.7" } });
    // Math.floor(3.7) = 3
    expect(onUpdateQuantity).toHaveBeenCalledWith(sampleDiscreteItem.productId, 3);
  });

  it("caps line discount at line gross value", () => {
    const onUpdateLineDiscount = vi.fn();
    render(
      <CartItemRow
        item={sampleItem}
        currency="USD"
        onUpdateQuantity={vi.fn()}
        onUpdateLineDiscount={onUpdateLineDiscount}
        onRemove={vi.fn()}
      />
    );

    const discInput = screen.getByRole("spinbutton", { name: /line discount amount/i });
    // Line gross is 2 * 15 = 30.00
    fireEvent.change(discInput, { target: { value: "50.00" } });
    expect(onUpdateLineDiscount).toHaveBeenCalledWith(sampleItem.productId, 30.0);
  });

  it("invokes onRemove when trash button is clicked", () => {
    const onRemove = vi.fn();
    render(
      <CartItemRow
        item={sampleItem}
        currency="USD"
        onUpdateQuantity={vi.fn()}
        onUpdateLineDiscount={vi.fn()}
        onRemove={onRemove}
      />
    );

    const removeBtn = screen.getByRole("button", { name: /remove artisan coffee beans from cart/i });
    fireEvent.click(removeBtn);
    expect(onRemove).toHaveBeenCalledWith(sampleItem.productId);
  });

  it("displays Low Stock warning when requested quantity exceeds available stock", () => {
    const overStockItem: CartItem = {
      ...sampleItem,
      quantity: 15,
      stockQuantity: 10,
    };

    render(
      <CartItemRow
        item={overStockItem}
        currency="USD"
        onUpdateQuantity={vi.fn()}
        onUpdateLineDiscount={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(screen.getByText("Low Stock")).toBeDefined();
  });
});
