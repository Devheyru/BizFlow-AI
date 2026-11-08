import { describe, it, expect } from "vitest";
import {
  calculateGrossMargin,
  formatGrossMargin,
  formatCurrency,
} from "@/lib/products/margin";

describe("T021: Gross Profit and Gross Margin Calculation Utility (FR-024, FR-025)", () => {
  describe("calculateGrossMargin()", () => {
    it("calculates standard positive gross profit and margin percentage correctly", () => {
      // Selling price: $10.00, Cost price: $6.00 -> Profit: $4.00, Margin: 40.0%
      const result = calculateGrossMargin(10, 6);

      expect(result.sellingPrice).toBe(10);
      expect(result.costPrice).toBe(6);
      expect(result.grossProfit).toBe(4);
      expect(result.grossMarginPercentage).toBe(40);
      expect(result.hasRecordedCost).toBe(true);
      expect(result.isNegativeMargin).toBe(false);
    });

    it("handles zero acquisition cost ($0.00) correctly as 100% margin", () => {
      // Selling price: $10.00, Cost price: $0.00 (e.g., gift/sample) -> Profit: $10.00, Margin: 100.0%
      const result = calculateGrossMargin(10, 0);

      expect(result.sellingPrice).toBe(10);
      expect(result.costPrice).toBe(0);
      expect(result.grossProfit).toBe(10);
      expect(result.grossMarginPercentage).toBe(100);
      expect(result.hasRecordedCost).toBe(true);
      expect(result.isNegativeMargin).toBe(false);
    });

    it("handles break-even pricing (cost equals selling price) as 0% margin", () => {
      const result = calculateGrossMargin(25.5, 25.5);

      expect(result.sellingPrice).toBe(25.5);
      expect(result.costPrice).toBe(25.5);
      expect(result.grossProfit).toBe(0);
      expect(result.grossMarginPercentage).toBe(0);
      expect(result.hasRecordedCost).toBe(true);
      expect(result.isNegativeMargin).toBe(false);
    });

    it("calculates negative margin and flags isNegativeMargin when cost exceeds selling price", () => {
      // Selling price: $10.00, Cost price: $15.00 -> Profit: -$5.00, Margin: -50.0%
      const result = calculateGrossMargin(10, 15);

      expect(result.sellingPrice).toBe(10);
      expect(result.costPrice).toBe(15);
      expect(result.grossProfit).toBe(-5);
      expect(result.grossMarginPercentage).toBe(-50);
      expect(result.hasRecordedCost).toBe(true);
      expect(result.isNegativeMargin).toBe(true);
    });

    it("handles $0.00 selling price gracefully without division-by-zero or NaN (FR-025)", () => {
      // Selling price: $0.00, Cost price: $5.00 -> Profit: -$5.00, Margin: null (N/A)
      const result = calculateGrossMargin(0, 5);

      expect(result.sellingPrice).toBe(0);
      expect(result.costPrice).toBe(5);
      expect(result.grossProfit).toBe(-5);
      expect(result.grossMarginPercentage).toBeNull();
      expect(result.hasRecordedCost).toBe(true);
      expect(result.isNegativeMargin).toBe(true);
    });

    it("handles $0.00 selling price with $0.00 cost price without division-by-zero (FR-025)", () => {
      const result = calculateGrossMargin(0, 0);

      expect(result.sellingPrice).toBe(0);
      expect(result.costPrice).toBe(0);
      expect(result.grossProfit).toBe(0);
      expect(result.grossMarginPercentage).toBeNull();
      expect(result.hasRecordedCost).toBe(true);
      expect(result.isNegativeMargin).toBe(false);
    });

    it("handles unrecorded cost (null) returning null profit and margin with hasRecordedCost=false (FR-025)", () => {
      // Selling price: $20.00, Cost price: null (no row in product_costs)
      const result = calculateGrossMargin(20, null);

      expect(result.sellingPrice).toBe(20);
      expect(result.costPrice).toBeNull();
      expect(result.grossProfit).toBeNull();
      expect(result.grossMarginPercentage).toBeNull();
      expect(result.hasRecordedCost).toBe(false);
      expect(result.isNegativeMargin).toBe(false);
    });

    it("omits cost-derived properties when caller lacks read_cost permission (costPrice is undefined)", () => {
      // Caller lacks products:read_cost -> costPrice is undefined
      const result = calculateGrossMargin(20, undefined);

      expect(result.sellingPrice).toBe(20);
      expect(result.costPrice).toBeUndefined();
      expect(result.grossProfit).toBeUndefined();
      expect(result.grossMarginPercentage).toBeUndefined();
      expect(result.hasRecordedCost).toBeUndefined();
      expect(result.isNegativeMargin).toBeUndefined();
    });

    it("preserves arithmetic precision and rounds margin percentage to 1 decimal place", () => {
      // Selling: $12.00, Cost: $6.00 -> 50.0%
      const r1 = calculateGrossMargin(12, 6);
      expect(r1.grossMarginPercentage).toBe(50);

      // Selling: $10.00, Cost: $3.33 -> ((10 - 3.33) / 10) * 100 = 66.7%
      const r2 = calculateGrossMargin(10, 3.33);
      expect(r2.grossProfit).toBe(6.67);
      expect(r2.grossMarginPercentage).toBe(66.7);
    });
  });

  describe("formatGrossMargin()", () => {
    it("formats positive margin percentage with percent sign", () => {
      expect(formatGrossMargin(40)).toBe("40.0%");
      expect(formatGrossMargin(66.67)).toBe("66.7%");
    });

    it("formats negative margin percentage correctly", () => {
      expect(formatGrossMargin(-50)).toBe("-50.0%");
    });

    it("formats zero margin percentage correctly", () => {
      expect(formatGrossMargin(0)).toBe("0.0%");
    });

    it("returns '—' (N/A) for null or undefined margin", () => {
      expect(formatGrossMargin(null)).toBe("—");
      expect(formatGrossMargin(undefined)).toBe("—");
    });
  });

  describe("formatCurrency()", () => {
    it("formats USD with 2 decimal places and dollar sign", () => {
      expect(formatCurrency(19.99, "USD")).toBe("$19.99");
      expect(formatCurrency(0, "USD")).toBe("$0.00");
    });

    it("formats JPY with 0 decimal places", () => {
      expect(formatCurrency(1500, "JPY")).toBe("¥1,500");
    });

    it("formats BHD with 3 decimal places", () => {
      expect(formatCurrency(10.5, "BHD")).toBe("BHD 10.500");
    });

    it("defaults to USD if currency is not specified", () => {
      expect(formatCurrency(25)).toBe("$25.00");
    });
  });
});

