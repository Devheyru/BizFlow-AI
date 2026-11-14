import { describe, it, expect } from "vitest";
import {
  stockMovementInputSchema,
  inventoryThresholdInputSchema,
  inventoryQuerySchema,
  movementHistoryQuerySchema,
} from "@/lib/validations/inventory";

describe("T014: Inventory Validation Schemas", () => {
  const validProductId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const validIdempotencyKey = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";

  describe("1. stockMovementInputSchema", () => {
    it("accepts a valid delta restock input", () => {
      const input = {
        productId: validProductId,
        movementType: "restock",
        quantity: 25.5,
        reason: "Supplier delivery from PO-1024",
        referenceId: "PO-1024",
        idempotencyKey: validIdempotencyKey,
        expectedVersion: 1,
        quantitySemantics: "quantity_delta",
      };

      const result = stockMovementInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.quantity).toBe(25.5);
        expect(result.data.quantitySemantics).toBe("quantity_delta");
      }
    });

    it("defaults quantitySemantics to quantity_delta when omitted", () => {
      const input = {
        productId: validProductId,
        movementType: "restock",
        quantity: 10,
        reason: "Restock items",
      };

      const result = stockMovementInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.quantitySemantics).toBe("quantity_delta");
      }
    });

    it("accepts valid target_physical_count for adjustment movement type", () => {
      const input = {
        productId: validProductId,
        movementType: "adjustment",
        quantity: 50,
        reason: "Quarterly stocktake count",
        quantitySemantics: "target_physical_count",
      };

      const result = stockMovementInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.quantitySemantics).toBe("target_physical_count");
        expect(result.data.quantity).toBe(50);
      }
    });

    it("accepts zero target_physical_count for adjustment (counting zero stock)", () => {
      const input = {
        productId: validProductId,
        movementType: "adjustment",
        quantity: 0,
        reason: "Physical count confirmed empty shelf",
        quantitySemantics: "target_physical_count",
      };

      const result = stockMovementInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("strictly rejects target_physical_count for non-adjustment movement types", () => {
      const invalidTypes = ["initial", "restock", "damage", "loss", "internal_use"];

      for (const mType of invalidTypes) {
        const input = {
          productId: validProductId,
          movementType: mType,
          quantity: 20,
          reason: "Invalid target count attempt",
          quantitySemantics: "target_physical_count",
        };

        const result = stockMovementInputSchema.safeParse(input);
        expect(result.success).toBe(false);
      }
    });

    it("rejects zero or negative quantities for quantity_delta", () => {
      const zeroDelta = {
        productId: validProductId,
        movementType: "restock",
        quantity: 0,
        reason: "Zero restock",
        quantitySemantics: "quantity_delta",
      };

      const negDelta = {
        productId: validProductId,
        movementType: "restock",
        quantity: -5,
        reason: "Negative restock",
        quantitySemantics: "quantity_delta",
      };

      expect(stockMovementInputSchema.safeParse(zeroDelta).success).toBe(false);
      expect(stockMovementInputSchema.safeParse(negDelta).success).toBe(false);
    });

    it("strictly rejects POS movement types sale and return (reserved for Feature 005)", () => {
      const saleInput = {
        productId: validProductId,
        movementType: "sale",
        quantity: 1,
        reason: "POS Sale attempt",
      };

      const returnInput = {
        productId: validProductId,
        movementType: "return",
        quantity: 1,
        reason: "Customer return attempt",
      };

      expect(stockMovementInputSchema.safeParse(saleInput).success).toBe(false);
      expect(stockMovementInputSchema.safeParse(returnInput).success).toBe(false);
    });

    it("enforces whole integer quantities for discrete products when isDiscrete is true", () => {
      const discreteValid = {
        productId: validProductId,
        movementType: "restock",
        quantity: 10,
        reason: "Restock whole units",
        isDiscrete: true,
      };

      const discreteInvalid = {
        productId: validProductId,
        movementType: "restock",
        quantity: 10.5,
        reason: "Fractional unit restock",
        isDiscrete: true,
      };

      expect(stockMovementInputSchema.safeParse(discreteValid).success).toBe(true);
      const invalidRes = stockMovementInputSchema.safeParse(discreteInvalid);
      expect(invalidRes.success).toBe(false);
    });

    it("enforces maximum 4 decimal places for NUMERIC(14,4)", () => {
      const fourDecimals = {
        productId: validProductId,
        movementType: "restock",
        quantity: 12.3456,
        reason: "Bulk ingredient measurement",
      };

      const fiveDecimals = {
        productId: validProductId,
        movementType: "restock",
        quantity: 12.34567,
        reason: "Excess precision ingredient",
      };

      expect(stockMovementInputSchema.safeParse(fourDecimals).success).toBe(true);
      expect(stockMovementInputSchema.safeParse(fiveDecimals).success).toBe(false);
    });

    it("enforces signed-delta API: accepts negative delta and rejects positive magnitude for write-offs", () => {
      const validDamage = {
        productId: validProductId,
        movementType: "damage",
        quantity: -5,
        reason: "Broken mug during transit",
        quantitySemantics: "quantity_delta",
      };
      const validLoss = {
        productId: validProductId,
        movementType: "loss",
        quantity: -2.5,
        reason: "Evaporation loss",
        quantitySemantics: "quantity_delta",
      };
      const validInternalUse = {
        productId: validProductId,
        movementType: "internal_use",
        quantity: -1,
        reason: "Store kitchen allocation",
        quantitySemantics: "quantity_delta",
      };

      expect(stockMovementInputSchema.safeParse(validDamage).success).toBe(true);
      expect(stockMovementInputSchema.safeParse(validLoss).success).toBe(true);
      expect(stockMovementInputSchema.safeParse(validInternalUse).success).toBe(true);

      // Rejects positive magnitude for write-offs
      const positiveDamage = {
        productId: validProductId,
        movementType: "damage",
        quantity: 5,
        reason: "Positive magnitude damage attempt",
        quantitySemantics: "quantity_delta",
      };
      const positiveLoss = {
        productId: validProductId,
        movementType: "loss",
        quantity: 2.5,
        reason: "Positive magnitude loss attempt",
        quantitySemantics: "quantity_delta",
      };
      const positiveInternalUse = {
        productId: validProductId,
        movementType: "internal_use",
        quantity: 1,
        reason: "Positive magnitude internal use attempt",
        quantitySemantics: "quantity_delta",
      };

      expect(stockMovementInputSchema.safeParse(positiveDamage).success).toBe(false);
      expect(stockMovementInputSchema.safeParse(positiveLoss).success).toBe(false);
      expect(stockMovementInputSchema.safeParse(positiveInternalUse).success).toBe(false);
    });

    it("accepts positive and negative deltas for manual adjustments and rejects zero", () => {
      const positiveAdj = {
        productId: validProductId,
        movementType: "adjustment",
        quantity: 4.5,
        reason: "Found surplus inventory",
        quantitySemantics: "quantity_delta",
      };
      const negativeAdj = {
        productId: validProductId,
        movementType: "adjustment",
        quantity: -3,
        reason: "Routine reconciliation deduction",
        quantitySemantics: "quantity_delta",
      };
      const zeroAdj = {
        productId: validProductId,
        movementType: "adjustment",
        quantity: 0,
        reason: "Zero delta adjustment attempt",
        quantitySemantics: "quantity_delta",
      };

      expect(stockMovementInputSchema.safeParse(positiveAdj).success).toBe(true);
      expect(stockMovementInputSchema.safeParse(negativeAdj).success).toBe(true);
      expect(stockMovementInputSchema.safeParse(zeroAdj).success).toBe(false);
    });

    it("enforces reason length bounds (min 3, max 500 characters)", () => {
      const tooShort = {
        productId: validProductId,
        movementType: "restock",
        quantity: 10,
        reason: "ab",
      };

      const tooLong = {
        productId: validProductId,
        movementType: "restock",
        quantity: 10,
        reason: "x".repeat(501),
      };

      expect(stockMovementInputSchema.safeParse(tooShort).success).toBe(false);
      expect(stockMovementInputSchema.safeParse(tooLong).success).toBe(false);
    });

    it("rejects invalid UUIDs", () => {
      const badProduct = {
        productId: "not-a-uuid",
        movementType: "restock",
        quantity: 10,
        reason: "Restock items",
      };

      const badIdempotencyKey = {
        productId: validProductId,
        movementType: "restock",
        quantity: 10,
        reason: "Restock items",
        idempotencyKey: "invalid-uuid",
      };

      expect(stockMovementInputSchema.safeParse(badProduct).success).toBe(false);
      expect(stockMovementInputSchema.safeParse(badIdempotencyKey).success).toBe(false);
    });
  });

  describe("2. inventoryThresholdInputSchema", () => {
    it("accepts valid non-negative threshold values", () => {
      const valid = {
        productId: validProductId,
        reorderPoint: 15,
        reorderQuantity: 50,
        expectedVersion: 2,
      };

      const result = inventoryThresholdInputSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("accepts null/undefined threshold values", () => {
      const withNulls = {
        productId: validProductId,
        reorderPoint: null,
        reorderQuantity: null,
      };

      expect(inventoryThresholdInputSchema.safeParse(withNulls).success).toBe(true);
    });

    it("rejects negative threshold values", () => {
      const negPoint = {
        productId: validProductId,
        reorderPoint: -1,
      };

      const negQuantity = {
        productId: validProductId,
        reorderQuantity: -5,
      };

      expect(inventoryThresholdInputSchema.safeParse(negPoint).success).toBe(false);
      expect(inventoryThresholdInputSchema.safeParse(negQuantity).success).toBe(false);
    });
  });

  describe("3. inventoryQuerySchema", () => {
    it("parses default query options", () => {
      const result = inventoryQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.pageSize).toBe(20);
        expect(result.data.stockStatus).toBe("all");
        expect(result.data.productStatus).toBe("all");
        expect(result.data.includeArchived).toBe(false);
        expect(result.data.sortBy).toBe("stock_status");
        expect(result.data.sortOrder).toBe("asc");
      }
    });

    it("validates pagination bounds", () => {
      expect(inventoryQuerySchema.safeParse({ page: 0 }).success).toBe(false);
      expect(inventoryQuerySchema.safeParse({ pageSize: 0 }).success).toBe(false);
      expect(inventoryQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
      expect(inventoryQuerySchema.safeParse({ pageSize: 100 }).success).toBe(true);
    });
  });

  describe("4. movementHistoryQuerySchema", () => {
    it("parses default movement history query", () => {
      const result = movementHistoryQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.pageSize).toBe(25);
        expect(result.data.movementType).toBe("all");
      }
    });

    it("accepts valid ISO datetime filters", () => {
      const valid = {
        fromDate: "2026-11-01T00:00:00.000Z",
        toDate: "2026-11-10T23:59:59.999Z",
        movementType: "restock",
      };

      expect(movementHistoryQuerySchema.safeParse(valid).success).toBe(true);
    });

    it("rejects invalid date format", () => {
      const invalid = {
        fromDate: "2026-99-99",
      };

      expect(movementHistoryQuerySchema.safeParse(invalid).success).toBe(false);
    });
  });
});

