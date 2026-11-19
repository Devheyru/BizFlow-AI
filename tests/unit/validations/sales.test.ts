import { describe, it, expect } from "vitest";
import {
  executeSaleSchema,
  voidSaleSchema,
  executeSaleReturnSchema,
  confirmRefundSchema,
  recordRefundFailureSchema,
  issueReplacementRefundSchema,
  salesListQuerySchema,
  updateTaxSettingsSchema,
  hasMaxFourDecimals,
} from "@/lib/validations/sales";

describe("T036: Sales & Financial Validation Schemas", () => {
  const validUuid1 = "11111111-1111-4111-8111-111111111111";
  const validUuid2 = "22222222-2222-4222-8222-222222222222";
  const validIdemKey = "33333333-3333-4333-8333-333333333333";

  it("exports hasMaxFourDecimals helper correctly", () => {
    expect(hasMaxFourDecimals(1.2345)).toBe(true);
    expect(hasMaxFourDecimals(1.23456)).toBe(false);
  });

  describe("executeSaleSchema", () => {
    it("validates a complete valid multi-item, split-tender checkout payload", () => {
      const payload = {
        customerId: validUuid1,
        items: [
          { productId: validUuid1, quantity: 2.5, lineDiscountAmount: 1.0, expectedVersion: 3 },
          { productId: validUuid2, quantity: 1, lineDiscountAmount: 0 },
        ],
        payments: [
          { paymentMethod: "cash", amount: 50, amountTendered: 60, changeDue: 10 },
          { paymentMethod: "card", amount: 100, referenceNo: "AUTH-9999" },
        ],
        orderDiscountAmount: 5.0,
        idempotencyKey: validIdemKey,
        notes: "Split payment sale",
      };

      const result = executeSaleSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items).toHaveLength(2);
        expect(result.data.payments).toHaveLength(2);
        expect(result.data.orderDiscountAmount).toBe(5.0);
      }
    });

    it("accepts walk-in guest sale (null customerId)", () => {
      const payload = {
        customerId: null,
        items: [{ productId: validUuid1, quantity: 1, lineDiscountAmount: 0 }],
        payments: [{ paymentMethod: "cash", amount: 20 }],
        idempotencyKey: validIdemKey,
      };
      expect(executeSaleSchema.safeParse(payload).success).toBe(true);
    });

    it("rejects empty cart items array", () => {
      const payload = {
        items: [],
        payments: [{ paymentMethod: "cash", amount: 20 }],
        idempotencyKey: validIdemKey,
      };
      const res = executeSaleSchema.safeParse(payload);
      expect(res.success).toBe(false);
    });

    it("rejects duplicate product IDs in the cart (P0044)", () => {
      const payload = {
        items: [
          { productId: validUuid1, quantity: 1, lineDiscountAmount: 0 },
          { productId: validUuid1, quantity: 2, lineDiscountAmount: 0 },
        ],
        payments: [{ paymentMethod: "cash", amount: 50 }],
        idempotencyKey: validIdemKey,
      };
      const res = executeSaleSchema.safeParse(payload);
      expect(res.success).toBe(false);
    });

    it("rejects non-positive quantities and zero quantity", () => {
      expect(
        executeSaleSchema.safeParse({
          items: [{ productId: validUuid1, quantity: 0, lineDiscountAmount: 0 }],
          payments: [{ paymentMethod: "cash", amount: 20 }],
          idempotencyKey: validIdemKey,
        }).success
      ).toBe(false);

      expect(
        executeSaleSchema.safeParse({
          items: [{ productId: validUuid1, quantity: -1, lineDiscountAmount: 0 }],
          payments: [{ paymentMethod: "cash", amount: 20 }],
          idempotencyKey: validIdemKey,
        }).success
      ).toBe(false);
    });

    it("enforces maximum 4 decimal places on financial quantities and amounts", () => {
      // 4 decimals is valid
      expect(
        executeSaleSchema.safeParse({
          items: [{ productId: validUuid1, quantity: 1.2345, lineDiscountAmount: 0.1234 }],
          payments: [{ paymentMethod: "cash", amount: 20.5555 }],
          orderDiscountAmount: 2.1111,
          idempotencyKey: validIdemKey,
        }).success
      ).toBe(true);

      // 5 decimals is invalid
      expect(
        executeSaleSchema.safeParse({
          items: [{ productId: validUuid1, quantity: 1.23456, lineDiscountAmount: 0 }],
          payments: [{ paymentMethod: "cash", amount: 20 }],
          idempotencyKey: validIdemKey,
        }).success
      ).toBe(false);

      expect(
        executeSaleSchema.safeParse({
          items: [{ productId: validUuid1, quantity: 1, lineDiscountAmount: 0 }],
          payments: [{ paymentMethod: "cash", amount: 20.12345 }],
          idempotencyKey: validIdemKey,
        }).success
      ).toBe(false);
    });

    it("requires transaction reference for non-cash tenders (P0057)", () => {
      // Card with reference is valid
      expect(
        executeSaleSchema.safeParse({
          items: [{ productId: validUuid1, quantity: 1, lineDiscountAmount: 0 }],
          payments: [{ paymentMethod: "card", amount: 20, referenceNo: "CARD-1234" }],
          idempotencyKey: validIdemKey,
        }).success
      ).toBe(true);

      // Card without reference is invalid
      expect(
        executeSaleSchema.safeParse({
          items: [{ productId: validUuid1, quantity: 1, lineDiscountAmount: 0 }],
          payments: [{ paymentMethod: "card", amount: 20 }],
          idempotencyKey: validIdemKey,
        }).success
      ).toBe(false);

      // Bank transfer with empty reference is invalid
      expect(
        executeSaleSchema.safeParse({
          items: [{ productId: validUuid1, quantity: 1, lineDiscountAmount: 0 }],
          payments: [{ paymentMethod: "bank_transfer", amount: 20, referenceNo: "   " }],
          idempotencyKey: validIdemKey,
        }).success
      ).toBe(false);
    });

    it("rejects invalid idempotency key UUID", () => {
      expect(
        executeSaleSchema.safeParse({
          items: [{ productId: validUuid1, quantity: 1, lineDiscountAmount: 0 }],
          payments: [{ paymentMethod: "cash", amount: 20 }],
          idempotencyKey: "not-a-uuid",
        }).success
      ).toBe(false);
    });
  });

  describe("voidSaleSchema", () => {
    it("validates valid void request", () => {
      const res = voidSaleSchema.safeParse({
        saleId: validUuid1,
        voidReason: "Customer requested cancellation before fulfillment",
        idempotencyKey: validIdemKey,
      });
      expect(res.success).toBe(true);
    });

    it("rejects void reason shorter than 3 characters", () => {
      expect(
        voidSaleSchema.safeParse({
          saleId: validUuid1,
          voidReason: "No",
          idempotencyKey: validIdemKey,
        }).success
      ).toBe(false);
    });

    it("validates optional reversal references", () => {
      const res = voidSaleSchema.safeParse({
        saleId: validUuid1,
        voidReason: "Accidental scan",
        idempotencyKey: validIdemKey,
        reversalReferences: [{ paymentId: validUuid2, referenceNo: "REV-123" }],
      });
      expect(res.success).toBe(true);
    });
  });

  describe("executeSaleReturnSchema", () => {
    it("validates valid return with restocking", () => {
      const res = executeSaleReturnSchema.safeParse({
        saleId: validUuid1,
        returnItems: [
          { saleItemId: validUuid2, quantity: 2, restockToInventory: true },
        ],
        refundMethod: "cash",
        reason: "Customer changed mind",
        idempotencyKey: validIdemKey,
      });
      expect(res.success).toBe(true);
    });

    it("rejects duplicate sale items in return (P0060)", () => {
      const res = executeSaleReturnSchema.safeParse({
        saleId: validUuid1,
        returnItems: [
          { saleItemId: validUuid2, quantity: 1, restockToInventory: true },
          { saleItemId: validUuid2, quantity: 1, restockToInventory: false },
        ],
        refundMethod: "cash",
        reason: "Wrong size ordered",
        idempotencyKey: validIdemKey,
      });
      expect(res.success).toBe(false);
    });

    it("rejects empty return items array", () => {
      expect(
        executeSaleReturnSchema.safeParse({
          saleId: validUuid1,
          returnItems: [],
          refundMethod: "cash",
          reason: "Item returned",
          idempotencyKey: validIdemKey,
        }).success
      ).toBe(false);
    });
  });

  describe("confirmRefundSchema", () => {
    it("validates valid refund confirmation payload", () => {
      const res = confirmRefundSchema.safeParse({
        refundId: validUuid1,
        externalReference: "STRIPE-REF-48201",
        idempotencyKey: validIdemKey,
      });
      expect(res.success).toBe(true);
    });

    it("rejects empty external reference", () => {
      expect(
        confirmRefundSchema.safeParse({
          refundId: validUuid1,
          externalReference: "   ",
          idempotencyKey: validIdemKey,
        }).success
      ).toBe(false);
    });
  });

  describe("recordRefundFailureSchema", () => {
    it("validates failure reason", () => {
      expect(
        recordRefundFailureSchema.safeParse({
          refundId: validUuid1,
          failureReason: "Card declined by issuing bank",
        }).success
      ).toBe(true);

      expect(
        recordRefundFailureSchema.safeParse({
          refundId: validUuid1,
          failureReason: "Ab",
        }).success
      ).toBe(false);
    });
  });

  describe("issueReplacementRefundSchema", () => {
    it("validates replacement refund request", () => {
      const res = issueReplacementRefundSchema.safeParse({
        failedRefundId: validUuid1,
        refundMethod: "cash",
        idempotencyKey: validIdemKey,
        notes: "Replaced failed card refund with cash payout",
      });
      expect(res.success).toBe(true);
    });
  });

  describe("salesListQuerySchema", () => {
    it("applies default filters", () => {
      const res = salesListQuerySchema.safeParse({});
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.status).toBe("all");
        expect(res.data.page).toBe(1);
        expect(res.data.pageSize).toBe(20);
        expect(res.data.sortBy).toBe("created_at");
        expect(res.data.sortOrder).toBe("desc");
      }
    });

    it("validates status and pagination constraints", () => {
      expect(salesListQuerySchema.safeParse({ status: "completed" }).success).toBe(true);
      expect(salesListQuerySchema.safeParse({ status: "invalid_status" }).success).toBe(false);
      expect(salesListQuerySchema.safeParse({ page: 0 }).success).toBe(false);
      expect(salesListQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    });
  });

  describe("updateTaxSettingsSchema", () => {
    it("validates valid tax settings (0–100% tax rate)", () => {
      expect(
        updateTaxSettingsSchema.safeParse({
          taxName: "Standard VAT",
          defaultTaxRate: 15.0,
          isTaxInclusive: false,
        }).success
      ).toBe(true);

      expect(
        updateTaxSettingsSchema.safeParse({
          taxName: "Zero VAT",
          defaultTaxRate: 0.0,
          isTaxInclusive: false,
        }).success
      ).toBe(true);

      expect(
        updateTaxSettingsSchema.safeParse({
          taxName: "Max VAT",
          defaultTaxRate: 100.0,
          isTaxInclusive: true,
        }).success
      ).toBe(true);
    });

    it("rejects negative tax rate or tax rate exceeding 100", () => {
      expect(
        updateTaxSettingsSchema.safeParse({
          taxName: "Invalid VAT",
          defaultTaxRate: -0.01,
          isTaxInclusive: false,
        }).success
      ).toBe(false);

      expect(
        updateTaxSettingsSchema.safeParse({
          taxName: "Invalid VAT",
          defaultTaxRate: 100.0001,
          isTaxInclusive: false,
        }).success
      ).toBe(false);
    });

    it("rejects empty tax name", () => {
      expect(
        updateTaxSettingsSchema.safeParse({
          taxName: "   ",
          defaultTaxRate: 10,
          isTaxInclusive: false,
        }).success
      ).toBe(false);
    });
  });
});
