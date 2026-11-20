import { describe, it, expect } from "vitest";
import {
  formatCanonicalAmount,
  normalizeReferenceNo,
  sortSaleItems,
  sortSalePayments,
  buildCanonicalSalePayloadString,
  computeCanonicalSalePayloadHash,
  computeCanonicalSalePayloadHashSync,
} from "@/lib/sales/canonical-hash";
import type { ExecuteSaleInput } from "@/lib/validations/sales";

describe("Feature 005 — Canonical Hash Utility (T049, US1, PAY-010)", () => {
  describe("formatCanonicalAmount", () => {
    it("formats integers to 4 decimal places", () => {
      expect(formatCanonicalAmount(10)).toBe("10.0000");
      expect(formatCanonicalAmount("10")).toBe("10.0000");
    });

    it("formats fractional values strictly to 4 decimal places", () => {
      expect(formatCanonicalAmount(12.3456)).toBe("12.3456");
      expect(formatCanonicalAmount(12.3)).toBe("12.3000");
      expect(formatCanonicalAmount("99.9999")).toBe("99.9999");
    });

    it("strictly eliminates negative zero (-0 -> '0.0000')", () => {
      expect(formatCanonicalAmount(-0)).toBe("0.0000");
      expect(formatCanonicalAmount(0)).toBe("0.0000");
      expect(formatCanonicalAmount("0")).toBe("0.0000");
      expect(formatCanonicalAmount("-0.0000")).toBe("0.0000");
    });

    it("handles boundary values correctly (0.0001 and maximum bounds)", () => {
      expect(formatCanonicalAmount(0.0001)).toBe("0.0001");
      expect(formatCanonicalAmount(999999999.9999)).toBe("999999999.9999");
    });

    it("handles negative amounts correctly", () => {
      expect(formatCanonicalAmount(-5.5)).toBe("-5.5000");
    });

    it("throws an error for non-finite numeric input", () => {
      expect(() => formatCanonicalAmount(NaN)).toThrow(/Invalid numeric amount/);
      expect(() => formatCanonicalAmount(Infinity)).toThrow(/Invalid numeric amount/);
      expect(() => formatCanonicalAmount("invalid")).toThrow(/Invalid numeric amount/);
    });
  });

  describe("normalizeReferenceNo", () => {
    it("normalizes undefined or null to null", () => {
      expect(normalizeReferenceNo(undefined)).toBeNull();
      expect(normalizeReferenceNo(null)).toBeNull();
    });

    it("normalizes empty string or whitespace to null", () => {
      expect(normalizeReferenceNo("")).toBeNull();
      expect(normalizeReferenceNo("   ")).toBeNull();
      expect(normalizeReferenceNo("\t\n")).toBeNull();
    });

    it("trims non-empty reference strings", () => {
      expect(normalizeReferenceNo("  REF-12345  ")).toBe("REF-12345");
      expect(normalizeReferenceNo("CARD-AUTH-999")).toBe("CARD-AUTH-999");
    });
  });

  describe("sortSaleItems", () => {
    it("deterministically sorts items by productId ASC", () => {
      const items = [
        { productId: "bbbbbbbb-0000-4000-a000-000000000002", quantity: 2, lineDiscountAmount: 0 },
        { productId: "aaaaaaaa-0000-4000-a000-000000000001", quantity: 1, lineDiscountAmount: 5 },
        { productId: "cccccccc-0000-4000-a000-000000000003", quantity: 3, lineDiscountAmount: 1 },
      ];

      const sorted = sortSaleItems(items);
      expect(sorted[0]!.productId).toBe("aaaaaaaa-0000-4000-a000-000000000001");
      expect(sorted[1]!.productId).toBe("bbbbbbbb-0000-4000-a000-000000000002");
      expect(sorted[2]!.productId).toBe("cccccccc-0000-4000-a000-000000000003");
    });
  });

  describe("sortSalePayments", () => {
    it("sorts by method ASC, amount ASC, amount_tendered ASC NULLS LAST, change_due ASC NULLS LAST, reference_no ASC NULLS LAST", () => {
      const payments = [
        { paymentMethod: "card", amount: 50, referenceNo: "AUTH-2" },
        { paymentMethod: "cash", amount: 20, amountTendered: 30, changeDue: 10 },
        { paymentMethod: "card", amount: 30, referenceNo: "AUTH-1" },
        { paymentMethod: "cash", amount: 10, amountTendered: 10, changeDue: 0 },
        { paymentMethod: "bank_transfer", amount: 100, referenceNo: "WIRE-99" },
      ];

      const sorted = sortSalePayments(payments);
      // 'bank_transfer' < 'card' < 'cash'
      expect(sorted[0]!.paymentMethod).toBe("bank_transfer");
      expect(sorted[1]!.paymentMethod).toBe("card");
      expect(sorted[1]!.amount).toBe(30);
      expect(sorted[2]!.paymentMethod).toBe("card");
      expect(sorted[2]!.amount).toBe(50);
      expect(sorted[3]!.paymentMethod).toBe("cash");
      expect(sorted[3]!.amount).toBe(10);
      expect(sorted[4]!.paymentMethod).toBe("cash");
      expect(sorted[4]!.amount).toBe(20);
    });

    it("tie-breaks equal sorting values with amount_tendered, change_due, and reference_no", () => {
      const payments = [
        { paymentMethod: "card", amount: 50, referenceNo: "REF-Z" },
        { paymentMethod: "card", amount: 50, referenceNo: "REF-A" },
        { paymentMethod: "card", amount: 50, referenceNo: null },
      ];
      const sorted = sortSalePayments(payments);
      expect(sorted[0]!.referenceNo).toBe("REF-A");
      expect(sorted[1]!.referenceNo).toBe("REF-Z");
      expect(sorted[2]!.referenceNo).toBeNull();
    });

    it("places nulls last for tenders, change, and references", () => {
      const payments = [
        { paymentMethod: "card", amount: 50, referenceNo: null },
        { paymentMethod: "card", amount: 50, referenceNo: "REF-A" },
      ];
      const sorted = sortSalePayments(payments);
      expect(sorted[0]!.referenceNo).toBe("REF-A");
      expect(sorted[1]!.referenceNo).toBeNull();
    });
  });

  describe("buildCanonicalSalePayloadString and computeCanonicalSalePayloadHash", () => {
    const sampleInput: ExecuteSaleInput = {
      customerId: "00000000-0000-4000-a000-000000000001",
      items: [
        {
          productId: "bbbbbbbb-0000-4000-a000-000000000002",
          quantity: 2,
          lineDiscountAmount: 0,
        },
        {
          productId: "aaaaaaaa-0000-4000-a000-000000000001",
          quantity: 1.5,
          lineDiscountAmount: 1,
        },
      ],
      payments: [
        {
          paymentMethod: "card",
          amount: 50,
          referenceNo: "  TXN-999  ",
        },
        {
          paymentMethod: "cash",
          amount: 25,
          amountTendered: 30,
          changeDue: 5,
        },
      ],
      orderDiscountAmount: 5,
      idempotencyKey: "11111111-1111-4111-a111-111111111111",
      notes: "Customer express sale",
    };

    it("generates deterministic canonical string regardless of item or payment insertion order", () => {
      const reorderedInput: ExecuteSaleInput = {
        ...sampleInput,
        items: [...sampleInput.items].reverse(),
        payments: [...sampleInput.payments].reverse(),
      };

      const str1 = buildCanonicalSalePayloadString(sampleInput);
      const str2 = buildCanonicalSalePayloadString(reorderedInput);

      expect(str1).toBe(str2);

      const parsed = JSON.parse(str1);
      expect(parsed.items[0].product_id).toBe("aaaaaaaa-0000-4000-a000-000000000001");
      expect(parsed.items[0].quantity).toBe("1.5000");
      expect(parsed.items[0].line_discount_amount).toBe("1.0000");
      expect(parsed.payments[0].payment_method).toBe("card");
      expect(parsed.payments[0].reference_no).toBe("TXN-999");
      expect(parsed.order_discount_amount).toBe("5.0000");
    });

    it("normalizes null, undefined, empty, and whitespace-only references to produce identical hash", () => {
      const inputNullRef: ExecuteSaleInput = {
        ...sampleInput,
        payments: [{ paymentMethod: "cash", amount: 75, referenceNo: null }],
      };
      const inputUndefinedRef: ExecuteSaleInput = {
        ...sampleInput,
        payments: [{ paymentMethod: "cash", amount: 75, referenceNo: undefined }],
      };
      const inputEmptyRef: ExecuteSaleInput = {
        ...sampleInput,
        payments: [{ paymentMethod: "cash", amount: 75, referenceNo: "" }],
      };
      const inputWhitespaceRef: ExecuteSaleInput = {
        ...sampleInput,
        payments: [{ paymentMethod: "cash", amount: 75, referenceNo: "   \t  " }],
      };

      const hashNull = computeCanonicalSalePayloadHashSync(inputNullRef);
      const hashUndefined = computeCanonicalSalePayloadHashSync(inputUndefinedRef);
      const hashEmpty = computeCanonicalSalePayloadHashSync(inputEmptyRef);
      const hashWhitespace = computeCanonicalSalePayloadHashSync(inputWhitespaceRef);

      expect(hashNull).toBe(hashUndefined);
      expect(hashNull).toBe(hashEmpty);
      expect(hashNull).toBe(hashWhitespace);
    });

    it("computes matching async and sync hashes", async () => {
      const asyncHash = await computeCanonicalSalePayloadHash(sampleInput);
      const syncHash = computeCanonicalSalePayloadHashSync(sampleInput);

      expect(asyncHash).toHaveLength(64);
      expect(asyncHash).toMatch(/^[0-9a-f]{64}$/);
      expect(asyncHash).toBe(syncHash);
    });

    it("generates distinct hashes when any financial or item value changes", async () => {
      const baseHash = await computeCanonicalSalePayloadHash(sampleInput);

      const changedQtyHash = await computeCanonicalSalePayloadHash({
        ...sampleInput,
        items: [
          sampleInput.items[0]!,
          { ...sampleInput.items[1]!, quantity: 1.5001 },
        ],
      });
      expect(changedQtyHash).not.toBe(baseHash);

      const changedCustomerHash = await computeCanonicalSalePayloadHash({
        ...sampleInput,
        customerId: null,
      });
      expect(changedCustomerHash).not.toBe(baseHash);

      const changedDiscountHash = await computeCanonicalSalePayloadHash({
        ...sampleInput,
        orderDiscountAmount: 5.01,
      });
      expect(changedDiscountHash).not.toBe(baseHash);
    });

    it("matches exact PostgreSQL database-generated canonical hashes byte-for-byte across multiple fixtures", () => {
      // PostgreSQL Fixture 1: Multi-item payload with split cash & card payments and null customer
      // Verified live in PostgreSQL 17: SELECT encode(sha256(convert_to(jsonb_build_object(...)::text, 'UTF8')), 'hex');
      const fixture1: ExecuteSaleInput = {
        customerId: null,
        items: [
          {
            productId: "aaaaaaaa-0000-4000-a000-000000000001",
            quantity: 1,
            lineDiscountAmount: 0,
          },
          {
            productId: "bbbbbbbb-0000-4000-a000-000000000002",
            quantity: 3,
            lineDiscountAmount: 2.5,
          },
        ],
        payments: [
          {
            paymentMethod: "cash",
            amount: 10,
            amountTendered: 15,
            changeDue: 5,
            referenceNo: null,
          },
          {
            paymentMethod: "card",
            amount: 25,
            amountTendered: null,
            changeDue: null,
            referenceNo: "REF-101",
          },
        ],
        orderDiscountAmount: 5,
        idempotencyKey: "00000000-0000-0000-0000-000000000000",
      };

      const hash1 = computeCanonicalSalePayloadHashSync(fixture1);
      expect(hash1).toBe("284a1922d6bde50090d4ddadf652be7e457cd652df801b4be95974ba0d2365de");

      // PostgreSQL Fixture 2: Single-item payload with customer ID
      const fixture2: ExecuteSaleInput = {
        customerId: "00000000-0000-4000-a000-000000000001",
        items: [
          {
            productId: "aaaaaaaa-0000-4000-a000-000000000001",
            quantity: 1,
            lineDiscountAmount: 0,
          },
        ],
        payments: [
          {
            paymentMethod: "cash",
            amount: 10,
            amountTendered: null,
            changeDue: null,
            referenceNo: null,
          },
        ],
        orderDiscountAmount: 0,
        idempotencyKey: "00000000-0000-0000-0000-000000000000",
      };

      const hash2 = computeCanonicalSalePayloadHashSync(fixture2);
      expect(hash2).toBe("323b76ec55a1500c0bfd4f7185c4a05ec1ef4bc32a90b84d59c21ec09d4685cb");

      // PostgreSQL Fixture 3: 3 items, 3 payment methods (bank_transfer, card, cash), customer ID, and decimals
      const fixture3: ExecuteSaleInput = {
        customerId: "99999999-9999-4000-a000-000000000009",
        items: [
          {
            productId: "22222222-2222-4000-a000-000000000002",
            quantity: 2,
            lineDiscountAmount: 0,
          },
          {
            productId: "11111111-1111-4000-a000-000000000001",
            quantity: 1.5,
            lineDiscountAmount: 0.5,
          },
          {
            productId: "33333333-3333-4000-a000-000000000003",
            quantity: 0.25,
            lineDiscountAmount: 1.25,
          },
        ],
        payments: [
          {
            paymentMethod: "cash",
            amount: 20,
            amountTendered: 25,
            changeDue: 5,
            referenceNo: null,
          },
          {
            paymentMethod: "bank_transfer",
            amount: 50,
            amountTendered: null,
            changeDue: null,
            referenceNo: "WIRE-777",
          },
          {
            paymentMethod: "card",
            amount: 30,
            amountTendered: null,
            changeDue: null,
            referenceNo: "CARD-888",
          },
        ],
        orderDiscountAmount: 2.5,
        idempotencyKey: "00000000-0000-0000-0000-000000000000",
      };

      const hash3 = computeCanonicalSalePayloadHashSync(fixture3);
      expect(hash3).toBe("71853a5ece9fe4e5c5c7129d082a4e81569e0a17917ef748d9a6c68ef4e4177f");
    });
  });
});
