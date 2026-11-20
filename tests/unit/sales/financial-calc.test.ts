import { describe, it, expect } from "vitest";
import { calculatePosTotals } from "@/lib/sales/financial-calc";

describe("calculatePosTotals Financial Utility (T052, US1, PostgreSQL Parity)", () => {
  it("returns zeros for empty items array", () => {
    const res = calculatePosTotals({
      items: [],
      orderDiscountAmount: 10,
      taxRate: 10,
      isTaxInclusive: false,
    });

    expect(res.subtotal).toBe(0);
    expect(res.totalPayable).toBe(0);
    expect(res.totalTax).toBe(0);
    expect(res.effectiveOrderDiscount).toBe(0);
  });

  describe("Single Item & Tax Modes", () => {
    it("calculates single-item tax-exclusive totals accurately", () => {
      const res = calculatePosTotals({
        items: [
          {
            productId: "prod-1",
            unitPrice: 15.0,
            quantity: 2,
            lineDiscountAmount: 0,
          },
        ],
        orderDiscountAmount: 0,
        taxRate: 10,
        isTaxInclusive: false,
        currency: "USD",
      });

      // Subtotal: 30.00
      // Tax (10% exclusive): 3.00
      // Total Payable: 33.00
      expect(res.subtotal).toBe(30.0);
      expect(res.netSubtotal).toBe(30.0);
      expect(res.totalTax).toBe(3.0);
      expect(res.totalPayable).toBe(33.0);
    });

    it("calculates single-item tax-inclusive totals accurately", () => {
      const res = calculatePosTotals({
        items: [
          {
            productId: "prod-1",
            unitPrice: 22.0,
            quantity: 1,
            lineDiscountAmount: 0,
          },
        ],
        orderDiscountAmount: 0,
        taxRate: 10,
        isTaxInclusive: true,
        currency: "USD",
      });

      // Subtotal: 22.00
      // Taxable: 22 / 1.10 = 20.00
      // Tax: 2.00
      // Total Payable: 22.00
      expect(res.subtotal).toBe(22.0);
      expect(res.netSubtotal).toBe(22.0);
      expect(res.totalTax).toBe(2.0);
      expect(res.totalPayable).toBe(22.0);
    });
  });

  describe("Order Discount Distribution & Residual Absorption", () => {
    it("allocates order discount proportionally across lines with residual absorbed by final line", () => {
      const res = calculatePosTotals({
        items: [
          {
            productId: "00000000-0000-4000-a000-000000000001",
            unitPrice: 10.0,
            quantity: 1,
            lineDiscountAmount: 0,
          },
          {
            productId: "00000000-0000-4000-a000-000000000002",
            unitPrice: 20.0,
            quantity: 1,
            lineDiscountAmount: 0,
          },
          {
            productId: "00000000-0000-4000-a000-000000000003",
            unitPrice: 30.0,
            quantity: 1,
            lineDiscountAmount: 0,
          },
        ],
        orderDiscountAmount: 10.0, // $10 total order discount over $60 subtotal
        taxRate: 0,
        isTaxInclusive: false,
        currency: "USD",
      });

      // Line 1: (10 / 60) * 10 = 1.6667 -> round(..., 2) = 1.67
      // Line 2: (20 / 60) * 10 = 3.3333 -> round(..., 2) = 3.33
      // Line 3: 10.00 - (1.67 + 3.33) = 5.00 (absorbs residual exactly!)
      expect(res.lineItems[0]!.allocatedOrderDiscount).toBe(1.67);
      expect(res.lineItems[1]!.allocatedOrderDiscount).toBe(3.33);
      expect(res.lineItems[2]!.allocatedOrderDiscount).toBe(5.0);

      const sumAllocated = res.lineItems.reduce(
        (sum, l) => sum + l.allocatedOrderDiscount,
        0
      );
      expect(sumAllocated).toBe(10.0);
      expect(res.totalPayable).toBe(50.0);
    });

    it("absorbs 1-cent residual on uneven 3-way split", () => {
      // 3 identical $10 items = $30.00 subtotal. Order discount $1.00.
      // Proportional split: 1/3 = 0.3333 -> round(..., 2) = 0.33
      // Line 1: 0.33
      // Line 2: 0.33
      // Line 3 absorbs residual: 1.00 - (0.33 + 0.33) = 0.34!
      const res = calculatePosTotals({
        items: [
          { productId: "p1", unitPrice: 10.0, quantity: 1, lineDiscountAmount: 0 },
          { productId: "p2", unitPrice: 10.0, quantity: 1, lineDiscountAmount: 0 },
          { productId: "p3", unitPrice: 10.0, quantity: 1, lineDiscountAmount: 0 },
        ],
        orderDiscountAmount: 1.0,
        taxRate: 0,
        isTaxInclusive: false,
        currency: "USD",
      });

      expect(res.lineItems[0]!.allocatedOrderDiscount).toBe(0.33);
      expect(res.lineItems[1]!.allocatedOrderDiscount).toBe(0.33);
      expect(res.lineItems[2]!.allocatedOrderDiscount).toBe(0.34);

      const totalAllocated = res.lineItems.reduce((acc, l) => acc + l.allocatedOrderDiscount, 0);
      expect(Math.round(totalAllocated * 100) / 100).toBe(1.0);
    });

    it("enforces order discount cannot exceed net subtotal", () => {
      const res = calculatePosTotals({
        items: [
          {
            productId: "prod-1",
            unitPrice: 25.0,
            quantity: 1,
            lineDiscountAmount: 5.0, // Line net: 20.00
          },
        ],
        orderDiscountAmount: 50.0, // Attempted $50 discount on $20 net
        taxRate: 0,
        isTaxInclusive: false,
      });

      expect(res.effectiveOrderDiscount).toBe(20.0);
      expect(res.totalPayable).toBe(0.0);
    });

    it("clamps line discount to never exceed line gross", () => {
      const res = calculatePosTotals({
        items: [
          {
            productId: "prod-1",
            unitPrice: 10.0,
            quantity: 2, // Gross = 20.00
            lineDiscountAmount: 25.0, // Attempted $25 discount
          },
        ],
        orderDiscountAmount: 0,
        taxRate: 0,
        isTaxInclusive: false,
      });

      expect(res.totalLineDiscounts).toBe(20.0);
      expect(res.netSubtotal).toBe(0.0);
      expect(res.totalPayable).toBe(0.0);
    });
  });

  describe("Decimal Quantities and Fractional Pricing", () => {
    it("handles fractional weights and prices accurately", () => {
      // 2.3750 kg @ $14.99/kg
      // Gross = 2.3750 * 14.99 = 35.60125 -> round 4 dec = 35.6013
      // Line discount = $1.50 -> Net = 34.1013
      // 8.25% exclusive tax = round(34.1013 * 0.0825, 2) = round(2.81335725, 2) = 2.81
      // Line total = 34.10 + 2.81 = 36.91
      const res = calculatePosTotals({
        items: [
          {
            productId: "prod-weighted",
            unitPrice: 14.99,
            quantity: 2.375,
            lineDiscountAmount: 1.5,
          },
        ],
        orderDiscountAmount: 0,
        taxRate: 8.25,
        isTaxInclusive: false,
        currency: "USD",
      });

      expect(res.subtotal).toBe(35.6013);
      expect(res.totalLineDiscounts).toBe(1.5);
      expect(res.totalTax).toBe(2.81);
      expect(res.totalPayable).toBe(36.91);
    });
  });

  describe("Multi-Currency Exponent Handling", () => {
    it("respects 0-decimal currencies like JPY", () => {
      const res = calculatePosTotals({
        items: [
          {
            productId: "prod-1",
            unitPrice: 1000,
            quantity: 1,
            lineDiscountAmount: 0,
          },
        ],
        orderDiscountAmount: 100,
        taxRate: 10,
        isTaxInclusive: false,
        currency: "JPY",
      });

      // Net: 900
      // Tax (10%): 90
      // Total: 990 JPY (whole integers)
      expect(res.subtotal).toBe(1000);
      expect(res.netSubtotal).toBe(1000);
      expect(res.effectiveOrderDiscount).toBe(100);
      expect(res.totalTax).toBe(90);
      expect(res.totalPayable).toBe(990);
    });

    it("respects 3-decimal currencies like BHD/KWD", () => {
      const res = calculatePosTotals({
        items: [
          {
            productId: "prod-1",
            unitPrice: 10.0,
            quantity: 1,
            lineDiscountAmount: 0,
          },
        ],
        orderDiscountAmount: 1.234,
        taxRate: 5,
        isTaxInclusive: false,
        currency: "BHD", // 3 decimals
      });

      // Net subtotal: 10.000
      // Order discount: 1.234
      // Taxable: 8.766
      // Tax (5% on 8.766): 0.4383 -> 0.438
      // Total: 8.766 + 0.438 = 9.204
      expect(res.effectiveOrderDiscount).toBe(1.234);
      expect(res.totalTax).toBe(0.438);
      expect(res.totalPayable).toBe(9.204);
    });
  });

  describe("Multi-Line Complex Aggregation Parity with Database execute_sale", () => {
    it("matches PostgreSQL execute_sale Pass 1 and Pass 2 calculations exactly", () => {
      // 2 lines:
      // Product 1: unitPrice $15.00, qty 2, line discount $1.00 -> Net = $29.00
      // Product 2: unitPrice $25.00, qty 1, line discount $0.00 -> Net = $25.00
      // Subtotal = $54.00, Order discount = $4.00
      // Tax: 10% exclusive
      //
      // Line 1: alloc order disc = round((29 / 54) * 4, 2) = 2.15
      // Line 2: alloc order disc = 4 - 2.15 = 1.85
      // Line 1 discounted = 29.00 - 2.15 = 26.85
      // Line 2 discounted = 25.00 - 1.85 = 23.15
      // Line 1 tax = round(26.85 * 0.10, 2) = 2.69
      // Line 2 tax = round(23.15 * 0.10, 2) = 2.32
      // Total tax = 2.69 + 2.32 = 5.01
      // Line 1 total = 26.85 + 2.69 = 29.54
      // Line 2 total = 23.15 + 2.32 = 25.47
      // Total payable = 29.54 + 25.47 = 55.01
      const res = calculatePosTotals({
        items: [
          { productId: "aaaaaaaa-0000-4000-a000-000000000001", unitPrice: 15.0, quantity: 2, lineDiscountAmount: 1.0 },
          { productId: "bbbbbbbb-0000-4000-a000-000000000002", unitPrice: 25.0, quantity: 1, lineDiscountAmount: 0.0 },
        ],
        orderDiscountAmount: 4.0,
        taxRate: 10.0,
        isTaxInclusive: false,
        currency: "USD",
      });

      expect(res.subtotal).toBe(55.0); // (2*15 + 1*25 = 55 gross)
      expect(res.totalLineDiscounts).toBe(1.0);
      expect(res.netSubtotal).toBe(54.0);
      expect(res.effectiveOrderDiscount).toBe(4.0);
      expect(res.totalTax).toBe(5.01);
      expect(res.totalPayable).toBe(55.01);

      expect(res.lineItems[0]!.allocatedOrderDiscount).toBe(2.15);
      expect(res.lineItems[0]!.allocatedTax).toBe(2.69);
      expect(res.lineItems[0]!.lineTotal).toBe(29.54);

      expect(res.lineItems[1]!.allocatedOrderDiscount).toBe(1.85);
      expect(res.lineItems[1]!.allocatedTax).toBe(2.32);
      expect(res.lineItems[1]!.lineTotal).toBe(25.47);
    });
  });
});
