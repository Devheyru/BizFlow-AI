import { describe, it, expect } from "vitest";
import {
  calculateReturnRefundPreview,
  roundToCurrency,
} from "@/lib/sales/financial-calc";

describe("Return Refund Calculation & Preview Unit Tests (T070, US4, Gap B)", () => {
  describe("roundToCurrency decimal-safe arithmetic", () => {
    it("avoids IEEE 754 precision drift on half-way values", () => {
      // In JS naive Math.round, 1.005 * 100 = 100.49999999999999, so Math.round(1.005 * 100) / 100 = 1.00 instead of 1.01
      expect(roundToCurrency(1.005, 2)).toBe(1.01);
      expect(roundToCurrency(33.3333333333, 2)).toBe(33.33);
      expect(roundToCurrency(33.335, 2)).toBe(33.34);
    });

    it("implements symmetric round-half-away-from-zero matching PostgreSQL round(numeric, int)", () => {
      // Positive halfway rounding
      expect(roundToCurrency(2.5, 0)).toBe(3);
      expect(roundToCurrency(1.5, 0)).toBe(2);
      expect(roundToCurrency(0.5, 0)).toBe(1);
      expect(roundToCurrency(1.005, 2)).toBe(1.01);
      expect(roundToCurrency(1.015, 2)).toBe(1.02);
      expect(roundToCurrency(33.335, 2)).toBe(33.34);
      expect(roundToCurrency(0.0005, 3)).toBe(0.001);
      expect(roundToCurrency(0.0015, 3)).toBe(0.002);

      // Negative halfway rounding (matches PostgreSQL round(-2.5, 0) = -3, round(-1.005, 2) = -1.01)
      expect(roundToCurrency(-2.5, 0)).toBe(-3);
      expect(roundToCurrency(-1.5, 0)).toBe(-2);
      expect(roundToCurrency(-0.5, 0)).toBe(-1);
      expect(roundToCurrency(-1.005, 2)).toBe(-1.01);
      expect(roundToCurrency(-1.015, 2)).toBe(-1.02);
      expect(roundToCurrency(-33.335, 2)).toBe(-33.34);
      expect(roundToCurrency(-0.0005, 3)).toBe(-0.001);
      expect(roundToCurrency(-0.0015, 3)).toBe(-0.002);
    });

    it("safely handles zero and invalid inputs", () => {
      expect(roundToCurrency(0, 2)).toBe(0);
      expect(roundToCurrency(-0, 2)).toBe(0);
      expect(roundToCurrency(NaN, 2)).toBe(0);
      expect(roundToCurrency(Infinity, 2)).toBe(0);
      expect(roundToCurrency(-Infinity, 2)).toBe(0);
    });

    it("respects currency exponent: JPY (0), USD (2), KWD (3)", () => {
      expect(roundToCurrency(1234.56, 0)).toBe(1235);
      expect(roundToCurrency(1234.56, 2)).toBe(1234.56);
      expect(roundToCurrency(1234.5678, 3)).toBe(1234.568);
    });
  });

  describe("Proportional Refund and Residual Absorption", () => {
    it("absorbs residual discrepancy on final partial return", () => {
      // 3 items sold for total of $100.00 ($33.3333... each)
      // Round 1: Return 1 item -> 100/3 * 1 = 33.33
      const round1 = calculateReturnRefundPreview({
        items: [
          {
            saleItemId: "item-1",
            totalPrice: 100.0,
            soldQuantity: 3,
            remainingReturnableQty: 3,
            previouslyRefundedAmount: 0,
            returnQuantity: 1,
          },
        ],
        saleTotalAmount: 100.0,
        previouslyRefundedTotal: 0,
        refundMethod: "cash",
      });

      expect(round1.totalRefund).toBe(33.33);
      expect(round1.lineBreakdowns[0]!.isResidual).toBe(false);

      // Round 2: Return 1 item -> 100/3 * 1 = 33.33
      const round2 = calculateReturnRefundPreview({
        items: [
          {
            saleItemId: "item-1",
            totalPrice: 100.0,
            soldQuantity: 3,
            remainingReturnableQty: 2,
            previouslyRefundedAmount: 33.33,
            returnQuantity: 1,
          },
        ],
        saleTotalAmount: 100.0,
        previouslyRefundedTotal: 33.33,
        refundMethod: "cash",
      });

      expect(round2.totalRefund).toBe(33.33);
      expect(round2.lineBreakdowns[0]!.isResidual).toBe(false);

      // Round 3 (Final remaining): Return 1 item -> 100.00 - 66.66 = 33.34 (absorbs residual penny!)
      const round3 = calculateReturnRefundPreview({
        items: [
          {
            saleItemId: "item-1",
            totalPrice: 100.0,
            soldQuantity: 3,
            remainingReturnableQty: 1,
            previouslyRefundedAmount: 66.66,
            returnQuantity: 1,
          },
        ],
        saleTotalAmount: 100.0,
        previouslyRefundedTotal: 66.66,
        refundMethod: "cash",
      });

      expect(round3.totalRefund).toBe(33.34);
      expect(round3.lineBreakdowns[0]!.isResidual).toBe(true);
      // Total across all 3 rounds = 33.33 + 33.33 + 33.34 = 100.00 exactly!
      expect(round1.totalRefund + round2.totalRefund + round3.totalRefund).toBe(100.0);
    });

    it("correctly handles items with line discounts, order discounts, and tax", () => {
      // Original item: unit price 50, qty 2. Gross 100.
      // Line discount: 10 -> net 90.
      // Allocated order discount: 5 -> taxable base 85.
      // Tax (10% exclusive): 8.50 -> totalPrice in sale_items = 93.50.
      const preview = calculateReturnRefundPreview({
        items: [
          {
            saleItemId: "item-discounted",
            totalPrice: 93.5,
            soldQuantity: 2,
            remainingReturnableQty: 2,
            previouslyRefundedAmount: 0,
            returnQuantity: 1,
          },
        ],
        saleTotalAmount: 93.5,
        previouslyRefundedTotal: 0,
        refundMethod: "cash",
      });

      // Returning 1 of 2 -> 93.50 / 2 = 46.75
      expect(preview.totalRefund).toBe(46.75);
      expect(preview.isValid).toBe(true);

      // Returning the remaining 1 of 2 -> 93.50 - 46.75 = 46.75
      const finalPreview = calculateReturnRefundPreview({
        items: [
          {
            saleItemId: "item-discounted",
            totalPrice: 93.5,
            soldQuantity: 2,
            remainingReturnableQty: 1,
            previouslyRefundedAmount: 46.75,
            returnQuantity: 1,
          },
        ],
        saleTotalAmount: 93.5,
        previouslyRefundedTotal: 46.75,
        refundMethod: "cash",
      });

      expect(finalPreview.totalRefund).toBe(46.75);
      expect(finalPreview.lineBreakdowns[0]!.isResidual).toBe(true);
    });
  });

  describe("Ceiling Enforcement", () => {
    it("flags cumulative ceiling exceeded when refund exceeds remaining sale balance", () => {
      const preview = calculateReturnRefundPreview({
        items: [
          {
            saleItemId: "item-1",
            totalPrice: 100.0,
            soldQuantity: 1,
            remainingReturnableQty: 1,
            previouslyRefundedAmount: 0,
            returnQuantity: 1,
          },
        ],
        saleTotalAmount: 100.0,
        previouslyRefundedTotal: 50.0, // Only 50 remaining payable
        refundMethod: "cash",
      });

      expect(preview.totalRefund).toBe(100.0);
      expect(preview.remainingCumulativePayable).toBe(50.0);
      expect(preview.isCumulativeCapped).toBe(true);
      expect(preview.isValid).toBe(false);
    });

    it("flags split-tender ceiling exceeded when non-cash refund exceeds method tender", () => {
      // Sale split: $40 Cash, $60 Card. Total $100.
      const preview = calculateReturnRefundPreview({
        items: [
          {
            saleItemId: "item-1",
            totalPrice: 70.0,
            soldQuantity: 1,
            remainingReturnableQty: 1,
            previouslyRefundedAmount: 0,
            returnQuantity: 1,
          },
        ],
        saleTotalAmount: 100.0,
        previouslyRefundedTotal: 0,
        refundMethod: "card",
        originalMethodTenderAmount: 60.0, // Card was only 60.00
        previouslyRefundedMethodAmount: 0,
      });

      expect(preview.totalRefund).toBe(70.0);
      expect(preview.remainingMethodTender).toBe(60.0);
      expect(preview.isSplitTenderCapped).toBe(true);
      expect(preview.isValid).toBe(false);
    });

    it("allows cash refund up to cumulative payable without split-tender restriction", () => {
      // Even if cash was $40 on original sale, cash can refund full remaining payable per specs
      const preview = calculateReturnRefundPreview({
        items: [
          {
            saleItemId: "item-1",
            totalPrice: 70.0,
            soldQuantity: 1,
            remainingReturnableQty: 1,
            previouslyRefundedAmount: 0,
            returnQuantity: 1,
          },
        ],
        saleTotalAmount: 100.0,
        previouslyRefundedTotal: 0,
        refundMethod: "cash",
        originalMethodTenderAmount: 40.0,
      });

      expect(preview.totalRefund).toBe(70.0);
      expect(preview.isSplitTenderCapped).toBe(false);
      expect(preview.isCumulativeCapped).toBe(false);
      expect(preview.isValid).toBe(true);
    });
  });

  describe("Zero decimal currencies (JPY)", () => {
    it("calculates exact integer refund with no fractional precision for JPY", () => {
      const preview = calculateReturnRefundPreview({
        items: [
          {
            saleItemId: "item-jpy",
            totalPrice: 10000,
            soldQuantity: 3,
            remainingReturnableQty: 3,
            previouslyRefundedAmount: 0,
            returnQuantity: 1,
          },
        ],
        saleTotalAmount: 10000,
        previouslyRefundedTotal: 0,
        refundMethod: "cash",
        currency: "JPY",
      });

      // 10000 / 3 = 3333.3333 -> rounds to 3333
      expect(preview.totalRefund).toBe(3333);
      expect(preview.lineBreakdowns[0]!.refundAmount).toBe(3333);

      // Final residual
      const finalPreview = calculateReturnRefundPreview({
        items: [
          {
            saleItemId: "item-jpy",
            totalPrice: 10000,
            soldQuantity: 3,
            remainingReturnableQty: 1,
            previouslyRefundedAmount: 6666,
            returnQuantity: 1,
          },
        ],
        saleTotalAmount: 10000,
        previouslyRefundedTotal: 6666,
        refundMethod: "cash",
        currency: "JPY",
      });

      // 10000 - 6666 = 3334
      expect(finalPreview.totalRefund).toBe(3334);
      expect(finalPreview.lineBreakdowns[0]!.isResidual).toBe(true);
    });
  });

  describe("Three decimal currencies (KWD)", () => {
    it("calculates exact 3-decimal refund precision matching PostgreSQL numeric", () => {
      // 55.555 KWD total for 3 items
      // 55.555 / 3 = 18.51833333... -> round to 3 decimals = 18.518
      const preview = calculateReturnRefundPreview({
        items: [
          {
            saleItemId: "item-kwd",
            totalPrice: 55.555,
            soldQuantity: 3,
            remainingReturnableQty: 3,
            previouslyRefundedAmount: 0,
            returnQuantity: 1,
          },
        ],
        saleTotalAmount: 55.555,
        previouslyRefundedTotal: 0,
        refundMethod: "cash",
        currency: "KWD",
      });

      expect(preview.totalRefund).toBe(18.518);
      expect(preview.lineBreakdowns[0]!.refundAmount).toBe(18.518);

      // Final residual: 55.555 - (18.518 * 2 = 37.036) = 18.519
      const finalPreview = calculateReturnRefundPreview({
        items: [
          {
            saleItemId: "item-kwd",
            totalPrice: 55.555,
            soldQuantity: 3,
            remainingReturnableQty: 1,
            previouslyRefundedAmount: 37.036,
            returnQuantity: 1,
          },
        ],
        saleTotalAmount: 55.555,
        previouslyRefundedTotal: 37.036,
        refundMethod: "cash",
        currency: "KWD",
      });

      expect(finalPreview.totalRefund).toBe(18.519);
      expect(finalPreview.lineBreakdowns[0]!.isResidual).toBe(true);
      expect(37.036 + finalPreview.totalRefund).toBe(55.555);
    });
  });

  describe("Zero-value and Invalid Inputs Handling", () => {
    it("handles empty item list cleanly with zero totals and isValid false", () => {
      const preview = calculateReturnRefundPreview({
        items: [],
        saleTotalAmount: 100,
        previouslyRefundedTotal: 0,
        refundMethod: "cash",
      });

      expect(preview.totalRefund).toBe(0);
      expect(preview.total).toBe(0);
      expect(preview.lineBreakdowns).toHaveLength(0);
      expect(preview.isValid).toBe(false);
    });

    it("ignores zero or negative return quantities without throwing", () => {
      const preview = calculateReturnRefundPreview({
        items: [
          {
            saleItemId: "item-neg",
            totalPrice: 50,
            soldQuantity: 2,
            remainingReturnableQty: 2,
            previouslyRefundedAmount: 0,
            returnQuantity: -1,
          },
          {
            saleItemId: "item-zero",
            totalPrice: 50,
            soldQuantity: 2,
            remainingReturnableQty: 2,
            previouslyRefundedAmount: 0,
            returnQuantity: 0,
          },
        ],
        saleTotalAmount: 100,
        previouslyRefundedTotal: 0,
        refundMethod: "cash",
      });

      expect(preview.totalRefund).toBe(0);
      expect(preview.lineBreakdowns).toHaveLength(0);
      expect(preview.isValid).toBe(false);
    });
  });
});
