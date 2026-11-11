import { describe, it, expect } from "vitest";
import {
  formatStockQuantity,
  formatQuantityWithUom,
  formatCurrency,
  calculateStockStatus,
  getStockStatusPriority,
  getStockStatusBadge,
} from "@/lib/inventory/formatters";

describe("T016: Inventory Formatters", () => {
  describe("formatStockQuantity", () => {
    it("formats discrete quantities as integers with separators", () => {
      expect(formatStockQuantity(1250, true)).toBe("1,250");
      expect(formatStockQuantity(10.0, true)).toBe("10");
      expect(formatStockQuantity(0, true)).toBe("0");
    });

    it("formats continuous quantities preserving decimal precision up to 4 places", () => {
      expect(formatStockQuantity(12.5, false)).toBe("12.5");
      expect(formatStockQuantity(10.1234, false)).toBe("10.1234");
      expect(formatStockQuantity(0, false)).toBe("0");
    });

    it("handles null and undefined gracefully", () => {
      expect(formatStockQuantity(null)).toBe("0");
      expect(formatStockQuantity(undefined)).toBe("0");
    });
  });

  describe("formatQuantityWithUom", () => {
    it("formats quantity with unit of measure", () => {
      expect(formatQuantityWithUom(10, "pcs", true)).toBe("10 pcs");
      expect(formatQuantityWithUom(12.5, "kg", false)).toBe("12.5 kg");
      expect(formatQuantityWithUom(null, "unit")).toBe("0 unit");
    });
  });

  describe("formatCurrency", () => {
    it("formats amounts in USD by default", () => {
      expect(formatCurrency(1250.5)).toBe("$1,250.50");
      expect(formatCurrency(0)).toBe("$0.00");
    });

    it("handles custom currencies", () => {
      expect(formatCurrency(100, "EUR")).toContain("100.00");
    });

    it("handles null and undefined gracefully", () => {
      expect(formatCurrency(null)).toBe("$0.00");
      expect(formatCurrency(undefined)).toBe("$0.00");
    });
  });

  describe("calculateStockStatus", () => {
    it("returns out_of_stock when quantity is 0 or negative", () => {
      expect(calculateStockStatus(0, 10)).toBe("out_of_stock");
      expect(calculateStockStatus(-5, 10)).toBe("out_of_stock");
    });

    it("returns low_stock when quantity is positive but at or below reorder point", () => {
      expect(calculateStockStatus(10, 10)).toBe("low_stock");
      expect(calculateStockStatus(5, 10)).toBe("low_stock");
    });

    it("returns in_stock when quantity is strictly above reorder point", () => {
      expect(calculateStockStatus(11, 10)).toBe("in_stock");
      expect(calculateStockStatus(100, 10)).toBe("in_stock");
    });

    it("returns in_stock when reorder point is null or zero and quantity > 0", () => {
      expect(calculateStockStatus(5, null)).toBe("in_stock");
      expect(calculateStockStatus(5, 0)).toBe("in_stock");
    });
  });

  describe("getStockStatusPriority & Badges", () => {
    it("assigns highest priority (1) to out_of_stock", () => {
      expect(getStockStatusPriority("out_of_stock")).toBe(1);
      expect(getStockStatusPriority("low_stock")).toBe(2);
      expect(getStockStatusPriority("in_stock")).toBe(3);
    });

    it("provides correct visual badge variants", () => {
      expect(getStockStatusBadge("out_of_stock")).toEqual({
        label: "Out of Stock",
        variant: "destructive",
      });
      expect(getStockStatusBadge("low_stock")).toEqual({
        label: "Low Stock",
        variant: "warning",
      });
      expect(getStockStatusBadge("in_stock")).toEqual({
        label: "In Stock",
        variant: "default",
      });
    });
  });
});

