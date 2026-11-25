import { describe, it, expect } from "vitest";
import { calculatePosTotals } from "@/lib/sales/financial-calc";

describe("T079: POS Tax Calculation Unit Tests", () => {
  const prodA = "11111111-1111-4000-a000-000000000001";
  const prodB = "22222222-2222-4000-a000-000000000002";

  describe("Tax-Exclusive Mode", () => {
    it("calculates exact tax-exclusive amounts for single item (USD)", () => {
      const res = calculatePosTotals({
        items: [{ productId: prodA, unitPrice: 100.0, quantity: 1, lineDiscountAmount: 0 }],
        orderDiscountAmount: 0,
        taxRate: 8.25,
        isTaxInclusive: false,
        currency: "USD",
      });

      // Subtotal: 100.00
      // Tax: round(100 * 0.0825, 2) = 8.25
      // Total Payable: 108.25
      expect(res.subtotal).toBe(100.0);
      expect(res.netSubtotal).toBe(100.0);
      expect(res.taxableBase).toBe(100.0);
      expect(res.totalTax).toBe(8.25);
      expect(res.totalPayable).toBe(108.25);
      expect(res.lineItems[0]!.taxableAmount).toBe(100.0);
      expect(res.lineItems[0]!.allocatedTax).toBe(8.25);
      expect(res.lineItems[0]!.lineTotal).toBe(108.25);
    });

    it("calculates multi-item tax-exclusive line-by-line rounding parity with PostgreSQL", () => {
      const res = calculatePosTotals({
        items: [
          { productId: prodA, unitPrice: 10.33, quantity: 1, lineDiscountAmount: 0 },
          { productId: prodB, unitPrice: 20.66, quantity: 1, lineDiscountAmount: 0 },
        ],
        orderDiscountAmount: 0,
        taxRate: 7.5,
        isTaxInclusive: false,
        currency: "USD",
      });

      // Item A: 10.33 * 0.075 = 0.77475 -> 0.77, lineTotal = 11.10
      // Item B: 20.66 * 0.075 = 1.5495 -> 1.55, lineTotal = 22.21
      // Sum Tax = 0.77 + 1.55 = 2.32
      // Total Payable = 11.10 + 22.21 = 33.31
      expect(res.lineItems[0]!.allocatedTax).toBe(0.77);
      expect(res.lineItems[0]!.lineTotal).toBe(11.1);
      expect(res.lineItems[1]!.allocatedTax).toBe(1.55);
      expect(res.lineItems[1]!.lineTotal).toBe(22.21);
      expect(res.totalTax).toBe(2.32);
      expect(res.totalPayable).toBe(33.31);
    });
  });

  describe("Tax-Inclusive Mode", () => {
    it("extracts embedded tax accurately for single item (USD)", () => {
      const res = calculatePosTotals({
        items: [{ productId: prodA, unitPrice: 110.0, quantity: 1, lineDiscountAmount: 0 }],
        orderDiscountAmount: 0,
        taxRate: 10.0,
        isTaxInclusive: true,
        currency: "USD",
      });

      // Subtotal: 110.00
      // Taxable: round(110 / 1.10, 2) = 100.00
      // Tax: 110.00 - 100.00 = 10.00
      // Total Payable: 110.00
      expect(res.subtotal).toBe(110.0);
      expect(res.lineItems[0]!.taxableAmount).toBe(100.0);
      expect(res.lineItems[0]!.allocatedTax).toBe(10.0);
      expect(res.lineItems[0]!.lineTotal).toBe(110.0);
      expect(res.totalTax).toBe(10.0);
      expect(res.totalPayable).toBe(110.0);
    });

    it("extracts embedded tax with fractional rounding", () => {
      const res = calculatePosTotals({
        items: [{ productId: prodA, unitPrice: 19.99, quantity: 1, lineDiscountAmount: 0 }],
        orderDiscountAmount: 0,
        taxRate: 15.0,
        isTaxInclusive: true,
        currency: "USD",
      });

      // 19.99 / 1.15 = 17.382608... -> 17.38
      // Tax: 19.99 - 17.38 = 2.61
      // LineTotal: 19.99
      expect(res.lineItems[0]!.taxableAmount).toBe(17.38);
      expect(res.lineItems[0]!.allocatedTax).toBe(2.61);
      expect(res.lineItems[0]!.lineTotal).toBe(19.99);
      expect(res.totalTax).toBe(2.61);
      expect(res.totalPayable).toBe(19.99);
    });
  });

  describe("Zero-Rate Tax (0%)", () => {
    it("handles zero tax rate without alteration of line amounts (exclusive)", () => {
      const res = calculatePosTotals({
        items: [{ productId: prodA, unitPrice: 49.99, quantity: 2, lineDiscountAmount: 5.0 }],
        orderDiscountAmount: 0,
        taxRate: 0,
        isTaxInclusive: false,
        currency: "USD",
      });

      expect(res.subtotal).toBe(99.98);
      expect(res.netSubtotal).toBe(94.98);
      expect(res.totalTax).toBe(0);
      expect(res.totalPayable).toBe(94.98);
      expect(res.lineItems[0]!.allocatedTax).toBe(0);
      expect(res.lineItems[0]!.lineTotal).toBe(94.98);
    });

    it("handles zero tax rate without alteration of line amounts (inclusive)", () => {
      const res = calculatePosTotals({
        items: [{ productId: prodA, unitPrice: 50.0, quantity: 1, lineDiscountAmount: 0 }],
        orderDiscountAmount: 0,
        taxRate: 0,
        isTaxInclusive: true,
        currency: "USD",
      });

      expect(res.totalTax).toBe(0);
      expect(res.totalPayable).toBe(50.0);
      expect(res.lineItems[0]!.taxableAmount).toBe(50.0);
      expect(res.lineItems[0]!.allocatedTax).toBe(0);
      expect(res.lineItems[0]!.lineTotal).toBe(50.0);
    });
  });

  describe("Currency Exponent Support", () => {
    it("calculates whole integer amounts for JPY (exponent 0)", () => {
      const res = calculatePosTotals({
        items: [{ productId: prodA, unitPrice: 1550, quantity: 1, lineDiscountAmount: 0 }],
        orderDiscountAmount: 0,
        taxRate: 10.0,
        isTaxInclusive: false,
        currency: "JPY",
      });

      // 1550 * 0.10 = 155 (integer)
      // Total payable: 1550 + 155 = 1705
      expect(res.subtotal).toBe(1550);
      expect(res.totalTax).toBe(155);
      expect(res.totalPayable).toBe(1705);
      expect(res.lineItems[0]!.lineTotal).toBe(1705);
    });

    it("calculates 3 decimal places for KWD (Kuwaiti Dinar, exponent 3)", () => {
      const res = calculatePosTotals({
        items: [{ productId: prodA, unitPrice: 12.345, quantity: 1, lineDiscountAmount: 0 }],
        orderDiscountAmount: 0,
        taxRate: 5.0,
        isTaxInclusive: false,
        currency: "KWD",
      });

      // 12.345 * 0.05 = 0.61725 -> 0.617
      // Total: 12.345 + 0.617 = 12.962
      expect(res.totalTax).toBe(0.617);
      expect(res.totalPayable).toBe(12.962);
      expect(res.lineItems[0]!.allocatedTax).toBe(0.617);
      expect(res.lineItems[0]!.lineTotal).toBe(12.962);
    });
  });

  describe("Empty items or zero cart guard", () => {
    it("returns zero totals when items list is empty", () => {
      const res = calculatePosTotals({
        items: [],
        orderDiscountAmount: 10,
        taxRate: 15,
        isTaxInclusive: false,
        currency: "USD",
      });

      expect(res.subtotal).toBe(0);
      expect(res.totalLineDiscounts).toBe(0);
      expect(res.netSubtotal).toBe(0);
      expect(res.effectiveOrderDiscount).toBe(0);
      expect(res.taxableBase).toBe(0);
      expect(res.totalTax).toBe(0);
      expect(res.totalPayable).toBe(0);
      expect(res.lineItems).toHaveLength(0);
    });
  });
});
