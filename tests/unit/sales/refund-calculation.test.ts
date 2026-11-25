import { describe, it, expect } from "vitest";
import {
  calculateReturnRefundPreview,
  roundToCurrency,
  type ReturnRefundLineInput,
} from "@/lib/sales/financial-calc";

describe("T082: Return & Refund Calculation Unit Tests", () => {
  const item1Id = "11111111-1111-4000-a000-000000000001";

  describe("roundToCurrency decimal parity", () => {
    it("matches PostgreSQL numeric symmetric rounding on positive boundaries", () => {
      expect(roundToCurrency(1.005, 2)).toBe(1.01);
      expect(roundToCurrency(1.004, 2)).toBe(1.0);
      expect(roundToCurrency(2.5, 0)).toBe(3);
    });

    it("matches PostgreSQL numeric symmetric rounding on negative boundaries", () => {
      expect(roundToCurrency(-1.005, 2)).toBe(-1.01);
      expect(roundToCurrency(-1.004, 2)).toBe(-1.0);
    });

    it("handles 0 and invalid inputs", () => {
      expect(roundToCurrency(0, 2)).toBe(0);
      expect(roundToCurrency(NaN, 2)).toBe(0);
      expect(roundToCurrency(Infinity, 2)).toBe(0);
    });
  });

  describe("Proportional Refund & Residual Absorption", () => {
    it("calculates exact proportional refund on partial return", () => {
      // 3 items bought for $30 total ($10/ea)
      // Return 1 item -> $10.00 refund
      const items: ReturnRefundLineInput[] = [
        {
          saleItemId: item1Id,
          totalPrice: 30.0,
          soldQuantity: 3,
          remainingReturnableQty: 3,
          previouslyRefundedAmount: 0,
          returnQuantity: 1,
        },
      ];

      const res = calculateReturnRefundPreview({
        items,
        saleTotalAmount: 30.0,
        previouslyRefundedTotal: 0,
        refundMethod: "cash",
        currency: "USD",
      });

      expect(res.isValid).toBe(true);
      expect(res.totalRefund).toBe(10.0);
      expect(res.lineBreakdowns[0]!.refundAmount).toBe(10.0);
      expect(res.lineBreakdowns[0]!.isResidual).toBe(false);
    });

    it("absorbs residual rounding difference when returning final remaining quantity", () => {
      // 3 items bought for $10.00 total ($3.3333/ea)
      // Return 1: round((10/3)*1, 2) = 3.33, previously refunded: 3.33
      // Return 2: round((10/3)*1, 2) = 3.33, previously refunded: 6.66
      // Return 3 (final): 10.00 - 6.66 = 3.34 (residual absorbed!)
      const items: ReturnRefundLineInput[] = [
        {
          saleItemId: item1Id,
          totalPrice: 10.0,
          soldQuantity: 3,
          remainingReturnableQty: 1, // Final 1 remaining!
          previouslyRefundedAmount: 6.66,
          returnQuantity: 1,
        },
      ];

      const res = calculateReturnRefundPreview({
        items,
        saleTotalAmount: 10.0,
        previouslyRefundedTotal: 6.66,
        refundMethod: "cash",
        currency: "USD",
      });

      expect(res.isValid).toBe(true);
      expect(res.totalRefund).toBe(3.34);
      expect(res.lineBreakdowns[0]!.refundAmount).toBe(3.34);
      expect(res.lineBreakdowns[0]!.isResidual).toBe(true);
    });
  });

  describe("Cumulative Cap & Split-Tender Ceilings", () => {
    it("flags isCumulativeCapped if total refund would exceed remaining sale balance", () => {
      const items: ReturnRefundLineInput[] = [
        {
          saleItemId: item1Id,
          totalPrice: 100.0,
          soldQuantity: 1,
          remainingReturnableQty: 1,
          previouslyRefundedAmount: 0,
          returnQuantity: 1,
        },
      ];

      // Prior refunds already amounted to $90 on a $100 sale
      // New return wants $100 -> exceeds remaining $10
      const res = calculateReturnRefundPreview({
        items,
        saleTotalAmount: 100.0,
        previouslyRefundedTotal: 90.0,
        refundMethod: "cash",
        currency: "USD",
      });

      expect(res.remainingCumulativePayable).toBe(10.0);
      expect(res.isCumulativeCapped).toBe(true);
      expect(res.isValid).toBe(false);
    });

    it("enforces split-tender ceiling for non-cash refund methods", () => {
      const items: ReturnRefundLineInput[] = [
        {
          saleItemId: item1Id,
          totalPrice: 50.0,
          soldQuantity: 1,
          remainingReturnableQty: 1,
          previouslyRefundedAmount: 0,
          returnQuantity: 1,
        },
      ];

      // Original card tender was only $30 (sale was split $30 card + $20 cash)
      // Attempting to refund $50 to card exceeds card tender ceiling!
      const res = calculateReturnRefundPreview({
        items,
        saleTotalAmount: 50.0,
        previouslyRefundedTotal: 0,
        refundMethod: "card",
        originalMethodTenderAmount: 30.0,
        previouslyRefundedMethodAmount: 0,
        currency: "USD",
      });

      expect(res.totalRefund).toBe(50.0);
      expect(res.remainingMethodTender).toBe(30.0);
      expect(res.isSplitTenderCapped).toBe(true);
      expect(res.isValid).toBe(false);
    });

    it("allows non-cash refund within original tender ceiling", () => {
      const items: ReturnRefundLineInput[] = [
        {
          saleItemId: item1Id,
          totalPrice: 50.0,
          soldQuantity: 2,
          remainingReturnableQty: 2,
          previouslyRefundedAmount: 0,
          returnQuantity: 1, // $25 refund
        },
      ];

      const res = calculateReturnRefundPreview({
        items,
        saleTotalAmount: 50.0,
        previouslyRefundedTotal: 0,
        refundMethod: "card",
        originalMethodTenderAmount: 30.0,
        previouslyRefundedMethodAmount: 0,
        currency: "USD",
      });

      expect(res.totalRefund).toBe(25.0);
      expect(res.remainingMethodTender).toBe(30.0);
      expect(res.isSplitTenderCapped).toBe(false);
      expect(res.isValid).toBe(true);
    });
  });

  describe("Multi-Currency Exponents", () => {
    it("calculates integer refund amounts for JPY (exponent 0)", () => {
      const items: ReturnRefundLineInput[] = [
        {
          saleItemId: item1Id,
          totalPrice: 1000,
          soldQuantity: 3,
          remainingReturnableQty: 3,
          previouslyRefundedAmount: 0,
          returnQuantity: 1, // 1000 / 3 = 333.333 -> 333
        },
      ];

      const res = calculateReturnRefundPreview({
        items,
        saleTotalAmount: 1000,
        previouslyRefundedTotal: 0,
        refundMethod: "cash",
        currency: "JPY",
      });

      expect(res.totalRefund).toBe(333);
      expect(res.lineBreakdowns[0]!.refundAmount).toBe(333);
    });

    it("calculates 3-decimal refund amounts for KWD (exponent 3)", () => {
      const items: ReturnRefundLineInput[] = [
        {
          saleItemId: item1Id,
          totalPrice: 10.0,
          soldQuantity: 3,
          remainingReturnableQty: 3,
          previouslyRefundedAmount: 0,
          returnQuantity: 1, // 10 / 3 = 3.3333... -> 3.333
        },
      ];

      const res = calculateReturnRefundPreview({
        items,
        saleTotalAmount: 10.0,
        previouslyRefundedTotal: 0,
        refundMethod: "cash",
        currency: "KWD",
      });

      expect(res.totalRefund).toBe(3.333);
      expect(res.lineBreakdowns[0]!.refundAmount).toBe(3.333);
    });
  });
});
