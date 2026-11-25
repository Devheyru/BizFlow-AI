import { describe, it, expect } from "vitest";
import { calculatePosTotals } from "@/lib/sales/financial-calc";

describe("T080: POS Discount Allocation Unit Tests", () => {
  const prodA = "00000000-0000-4000-a000-000000000001";
  const prodB = "00000000-0000-4000-a000-000000000002";
  const prodC = "00000000-0000-4000-a000-000000000003";

  describe("Line Discount Rules", () => {
    it("caps line discount at line gross amount", () => {
      const res = calculatePosTotals({
        items: [
          { productId: prodA, unitPrice: 20.0, quantity: 1, lineDiscountAmount: 35.0 }, // Exceeds $20
        ],
        orderDiscountAmount: 0,
        taxRate: 0,
        isTaxInclusive: false,
        currency: "USD",
      });

      // Line gross: 20.00, discount capped at 20.00
      expect(res.subtotal).toBe(20.0);
      expect(res.totalLineDiscounts).toBe(20.0);
      expect(res.netSubtotal).toBe(0);
      expect(res.totalPayable).toBe(0);
      expect(res.lineItems[0]!.lineDiscount).toBe(20.0);
      expect(res.lineItems[0]!.lineNet).toBe(0);
    });

    it("sanitizes negative line discount to zero", () => {
      const res = calculatePosTotals({
        items: [
          { productId: prodA, unitPrice: 20.0, quantity: 1, lineDiscountAmount: -10.0 },
        ],
        orderDiscountAmount: 0,
        taxRate: 0,
        isTaxInclusive: false,
        currency: "USD",
      });

      expect(res.lineItems[0]!.lineDiscount).toBe(0);
      expect(res.netSubtotal).toBe(20.0);
    });
  });

  describe("Order Discount Proportional Allocation & Residual Absorption", () => {
    it("allocates order discount proportionally across lines (sorted by productId ASC)", () => {
      const res = calculatePosTotals({
        items: [
          { productId: prodB, unitPrice: 20.0, quantity: 1, lineDiscountAmount: 0 },
          { productId: prodA, unitPrice: 10.0, quantity: 1, lineDiscountAmount: 0 },
          { productId: prodC, unitPrice: 30.0, quantity: 1, lineDiscountAmount: 0 },
        ],
        orderDiscountAmount: 12.0, // $12 discount on $60 net subtotal (20%)
        taxRate: 0,
        isTaxInclusive: false,
        currency: "USD",
      });

      // Must be sorted A ($10), B ($20), C ($30)
      expect(res.lineItems[0]!.productId).toBe(prodA);
      expect(res.lineItems[1]!.productId).toBe(prodB);
      expect(res.lineItems[2]!.productId).toBe(prodC);

      // Line A: (10 / 60) * 12 = 2.00
      // Line B: (20 / 60) * 12 = 4.00
      // Line C: 12 - (2 + 4) = 6.00
      expect(res.lineItems[0]!.allocatedOrderDiscount).toBe(2.0);
      expect(res.lineItems[1]!.allocatedOrderDiscount).toBe(4.0);
      expect(res.lineItems[2]!.allocatedOrderDiscount).toBe(6.0);

      const sumAllocated = res.lineItems.reduce((acc, l) => acc + l.allocatedOrderDiscount, 0);
      expect(sumAllocated).toBe(12.0);
      expect(res.totalPayable).toBe(48.0);
    });

    it("absorbs 1-cent residual on uneven 3-way split on final line item", () => {
      const res = calculatePosTotals({
        items: [
          { productId: prodA, unitPrice: 10.0, quantity: 1, lineDiscountAmount: 0 },
          { productId: prodB, unitPrice: 10.0, quantity: 1, lineDiscountAmount: 0 },
          { productId: prodC, unitPrice: 10.0, quantity: 1, lineDiscountAmount: 0 },
        ],
        orderDiscountAmount: 1.0, // $1.00 split 3 ways across identical $10 items
        taxRate: 0,
        isTaxInclusive: false,
        currency: "USD",
      });

      // Line 1: round((10/30) * 1, 2) = 0.33
      // Line 2: round((10/30) * 1, 2) = 0.33
      // Line 3 absorbs residual: 1.00 - (0.33 + 0.33) = 0.34
      expect(res.lineItems[0]!.allocatedOrderDiscount).toBe(0.33);
      expect(res.lineItems[1]!.allocatedOrderDiscount).toBe(0.33);
      expect(res.lineItems[2]!.allocatedOrderDiscount).toBe(0.34);

      const sumAllocated = res.lineItems.reduce((acc, l) => acc + l.allocatedOrderDiscount, 0);
      expect(Math.round(sumAllocated * 100) / 100).toBe(1.0);
      expect(res.totalPayable).toBe(29.0);
    });

    it("caps order discount at net subtotal if order discount exceeds subtotal", () => {
      const res = calculatePosTotals({
        items: [
          { productId: prodA, unitPrice: 15.0, quantity: 1, lineDiscountAmount: 5.0 }, // Line net: 10.00
          { productId: prodB, unitPrice: 10.0, quantity: 1, lineDiscountAmount: 0 },   // Line net: 10.00
        ],
        orderDiscountAmount: 50.0, // Total net subtotal is 20.00
        taxRate: 0,
        isTaxInclusive: false,
        currency: "USD",
      });

      expect(res.netSubtotal).toBe(20.0);
      expect(res.effectiveOrderDiscount).toBe(20.0);
      expect(res.totalPayable).toBe(0);
      expect(res.lineItems[0]!.allocatedOrderDiscount).toBe(10.0);
      expect(res.lineItems[1]!.allocatedOrderDiscount).toBe(10.0);
    });
  });

  describe("Zero-Subtotal Guard", () => {
    it("handles zero net subtotal without division by zero errors", () => {
      const res = calculatePosTotals({
        items: [
          { productId: prodA, unitPrice: 10.0, quantity: 1, lineDiscountAmount: 10.0 }, // 100% line discount
        ],
        orderDiscountAmount: 5.0,
        taxRate: 10,
        isTaxInclusive: false,
        currency: "USD",
      });

      expect(res.subtotal).toBe(10.0);
      expect(res.totalLineDiscounts).toBe(10.0);
      expect(res.netSubtotal).toBe(0);
      expect(res.effectiveOrderDiscount).toBe(0);
      expect(res.lineItems[0]!.allocatedOrderDiscount).toBe(0);
      expect(res.totalTax).toBe(0);
      expect(res.totalPayable).toBe(0);
    });

    it("handles negative order discount input safely", () => {
      const res = calculatePosTotals({
        items: [{ productId: prodA, unitPrice: 20.0, quantity: 1, lineDiscountAmount: 0 }],
        orderDiscountAmount: -5.0,
        taxRate: 0,
        isTaxInclusive: false,
        currency: "USD",
      });

      expect(res.effectiveOrderDiscount).toBe(0);
      expect(res.totalPayable).toBe(20.0);
    });
  });
});
