import { describe, it, expect } from "vitest";
import {
  stockMovementInputSchema,
  inventoryThresholdInputSchema,
  inventoryQuerySchema,
  inventoryFilterSchema,
  movementHistoryQuerySchema,
} from "@/lib/validations/inventory";
import {
  MANUAL_MOVEMENT_TYPES,
  MOVEMENT_TYPES,
  QUANTITY_SEMANTICS,
  STOCK_STATUS_FILTERS,
  PRODUCT_STATUS_FILTERS,
} from "@/types/inventory";

describe("T036: Inventory Zod Validation Schemas", () => {
  const validProductId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const validIdempotencyKey = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";

  // ==========================================================================
  // 1. stockMovementInputSchema
  // ==========================================================================
  describe("1. stockMovementInputSchema", () => {
    // ------------------------------------------------------------------------
    // A. Quantity Bounds & Precision
    // ------------------------------------------------------------------------
    describe("Quantity Bounds & Decimal Precision", () => {
      it("accepts minimum valid positive quantity (0.0001) for restock", () => {
        const input = {
          productId: validProductId,
          movementType: "restock",
          quantity: 0.0001,
          reason: "Min positive delivery",
        };
        const result = stockMovementInputSchema.safeParse(input);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.quantity).toBe(0.0001);
        }
      });

      it("accepts maximum valid quantity (999,999,999.9999)", () => {
        const input = {
          productId: validProductId,
          movementType: "restock",
          quantity: 999999999.9999,
          reason: "Max capacity restock",
        };
        const result = stockMovementInputSchema.safeParse(input);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.quantity).toBe(999999999.9999);
        }
      });

      it("rejects quantity exceeding maximum bound (1,000,000,000)", () => {
        const input = {
          productId: validProductId,
          movementType: "restock",
          quantity: 1000000000,
          reason: "Exceeds max restock",
        };
        const result = stockMovementInputSchema.safeParse(input);
        expect(result.success).toBe(false);
      });

      it("rejects quantity below minimum negative bound (-1,000,000,000)", () => {
        const input = {
          productId: validProductId,
          movementType: "damage",
          quantity: -1000000000,
          reason: "Exceeds max write-off",
        };
        const result = stockMovementInputSchema.safeParse(input);
        expect(result.success).toBe(false);
      });

      it("enforces maximum 4 decimal places (accepts 4, rejects 5 decimals)", () => {
        const validFourDecimals = {
          productId: validProductId,
          movementType: "restock",
          quantity: 12.3456,
          reason: "Acceptable 4 decimal precision",
        };
        const invalidFiveDecimals = {
          productId: validProductId,
          movementType: "restock",
          quantity: 12.34567,
          reason: "Unacceptable 5 decimal precision",
        };

        expect(stockMovementInputSchema.safeParse(validFourDecimals).success).toBe(true);
        expect(stockMovementInputSchema.safeParse(invalidFiveDecimals).success).toBe(false);
      });

      it("enforces whole integer quantities for discrete products when isDiscrete is true", () => {
        const discreteValid = {
          productId: validProductId,
          movementType: "restock",
          quantity: 10,
          reason: "Whole units restock",
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
        const result = stockMovementInputSchema.safeParse(discreteInvalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.flatten().fieldErrors.quantity).toContain(
            "Discrete products require whole integer quantities"
          );
        }
      });

      it("accepts fractional numbers for continuous products (isDiscrete false or omitted)", () => {
        const continuous = {
          productId: validProductId,
          movementType: "restock",
          quantity: 15.75,
          reason: "Continuous bulk restock",
          isDiscrete: false,
        };
        expect(stockMovementInputSchema.safeParse(continuous).success).toBe(true);
      });
    });

    // ------------------------------------------------------------------------
    // B. Movement Type & Quantity Semantics Compatibility
    // ------------------------------------------------------------------------
    describe("Movement Types & Quantity Semantics Compatibility", () => {
      it("accepts all permitted manual movement types", () => {
        for (const mType of MANUAL_MOVEMENT_TYPES) {
          const qty =
            mType === "damage" || mType === "loss" || mType === "internal_use"
              ? -5
              : 10;
          const input = {
            productId: validProductId,
            movementType: mType,
            quantity: qty,
            reason: `Valid test for ${mType}`,
          };
          const res = stockMovementInputSchema.safeParse(input);
          expect(res.success).toBe(true);
        }
      });

      it("strictly rejects POS movement types sale and return (reserved for Feature 005)", () => {
        const sale = {
          productId: validProductId,
          movementType: "sale",
          quantity: 1,
          reason: "POS sale attempt",
        };
        const ret = {
          productId: validProductId,
          movementType: "return",
          quantity: 1,
          reason: "POS return attempt",
        };
        expect(stockMovementInputSchema.safeParse(sale).success).toBe(false);
        expect(stockMovementInputSchema.safeParse(ret).success).toBe(false);
      });

      it("rejects unknown movement types", () => {
        const unknown = {
          productId: validProductId,
          movementType: "teleportation",
          quantity: 10,
          reason: "Invalid movement type",
        };
        expect(stockMovementInputSchema.safeParse(unknown).success).toBe(false);
      });

      it("accepts valid quantitySemantics enum values (quantity_delta, target_physical_count)", () => {
        for (const sem of QUANTITY_SEMANTICS) {
          const input = {
            productId: validProductId,
            movementType: "adjustment",
            quantity: sem === "quantity_delta" ? 5 : 20,
            reason: `Testing semantics ${sem}`,
            quantitySemantics: sem,
          };
          expect(stockMovementInputSchema.safeParse(input).success).toBe(true);
        }
      });

      it("rejects invalid quantitySemantics", () => {
        const badSemantics = {
          productId: validProductId,
          movementType: "adjustment",
          quantity: 10,
          reason: "Bad semantics test",
          quantitySemantics: "arbitrary_count",
        };
        expect(stockMovementInputSchema.safeParse(badSemantics).success).toBe(false);
      });

      it("permits target_physical_count ONLY for adjustment and requires non-negative count", () => {
        const validCount = {
          productId: validProductId,
          movementType: "adjustment",
          quantity: 0,
          reason: "Shelf verified empty",
          quantitySemantics: "target_physical_count",
        };
        expect(stockMovementInputSchema.safeParse(validCount).success).toBe(true);

        const negativeCount = {
          productId: validProductId,
          movementType: "adjustment",
          quantity: -1,
          reason: "Physical count cannot be negative",
          quantitySemantics: "target_physical_count",
        };
        expect(stockMovementInputSchema.safeParse(negativeCount).success).toBe(false);

        // Rejects target_physical_count for all other movement types
        const prohibitedTypes = ["initial", "restock", "damage", "loss", "internal_use"];
        for (const pType of prohibitedTypes) {
          const attempt = {
            productId: validProductId,
            movementType: pType,
            quantity: 50,
            reason: "Prohibited target count",
            quantitySemantics: "target_physical_count",
          };
          expect(stockMovementInputSchema.safeParse(attempt).success).toBe(false);
        }
      });

      it("enforces signed-delta API: write-offs (damage, loss, internal_use) require negative delta", () => {
        const writeOffTypes = ["damage", "loss", "internal_use"] as const;

        for (const wType of writeOffTypes) {
          // Negative delta: valid
          expect(
            stockMovementInputSchema.safeParse({
              productId: validProductId,
              movementType: wType,
              quantity: -2.5,
              reason: `Legitimate ${wType} reduction`,
            }).success
          ).toBe(true);

          // Positive delta: invalid
          expect(
            stockMovementInputSchema.safeParse({
              productId: validProductId,
              movementType: wType,
              quantity: 2.5,
              reason: `Invalid positive ${wType}`,
            }).success
          ).toBe(false);

          // Zero delta: invalid
          expect(
            stockMovementInputSchema.safeParse({
              productId: validProductId,
              movementType: wType,
              quantity: 0,
              reason: `Zero ${wType} attempt`,
            }).success
          ).toBe(false);
        }
      });

      it("enforces restock requires positive delta (> 0)", () => {
        expect(
          stockMovementInputSchema.safeParse({
            productId: validProductId,
            movementType: "restock",
            quantity: 10,
            reason: "Valid delivery",
          }).success
        ).toBe(true);

        expect(
          stockMovementInputSchema.safeParse({
            productId: validProductId,
            movementType: "restock",
            quantity: 0,
            reason: "Zero restock",
          }).success
        ).toBe(false);

        expect(
          stockMovementInputSchema.safeParse({
            productId: validProductId,
            movementType: "restock",
            quantity: -5,
            reason: "Negative restock",
          }).success
        ).toBe(false);
      });

      it("accepts positive and negative deltas for manual adjustments and rejects zero delta", () => {
        expect(
          stockMovementInputSchema.safeParse({
            productId: validProductId,
            movementType: "adjustment",
            quantity: 4.5,
            reason: "Found surplus inventory",
            quantitySemantics: "quantity_delta",
          }).success
        ).toBe(true);

        expect(
          stockMovementInputSchema.safeParse({
            productId: validProductId,
            movementType: "adjustment",
            quantity: -3,
            reason: "Shrinkage correction",
            quantitySemantics: "quantity_delta",
          }).success
        ).toBe(true);

        expect(
          stockMovementInputSchema.safeParse({
            productId: validProductId,
            movementType: "adjustment",
            quantity: 0,
            reason: "Zero delta adjustment attempt",
            quantitySemantics: "quantity_delta",
          }).success
        ).toBe(false);
      });
    });

    // ------------------------------------------------------------------------
    // C. Reason & Reference Validation
    // ------------------------------------------------------------------------
    describe("Reason and Reference Boundaries", () => {
      it("rejects reason shorter than 3 characters after trimming", () => {
        expect(
          stockMovementInputSchema.safeParse({
            productId: validProductId,
            movementType: "restock",
            quantity: 10,
            reason: "  ab  ",
          }).success
        ).toBe(false);
      });

      it("accepts reason of exactly 500 characters", () => {
        const exact500 = "x".repeat(500);
        const result = stockMovementInputSchema.safeParse({
          productId: validProductId,
          movementType: "restock",
          quantity: 10,
          reason: exact500,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.reason.length).toBe(500);
        }
      });

      it("rejects reason exceeding 500 characters (501 characters)", () => {
        const over500 = "x".repeat(501);
        expect(
          stockMovementInputSchema.safeParse({
            productId: validProductId,
            movementType: "restock",
            quantity: 10,
            reason: over500,
          }).success
        ).toBe(false);
      });

      it("accepts valid referenceId up to 100 characters and trims whitespace", () => {
        const res = stockMovementInputSchema.safeParse({
          productId: validProductId,
          movementType: "restock",
          quantity: 10,
          reason: "Valid delivery",
          referenceId: "  PO-99482-A  ",
        });
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.data.referenceId).toBe("PO-99482-A");
        }
      });

      it("rejects referenceId exceeding 100 characters", () => {
        expect(
          stockMovementInputSchema.safeParse({
            productId: validProductId,
            movementType: "restock",
            quantity: 10,
            reason: "Valid delivery",
            referenceId: "R".repeat(101),
          }).success
        ).toBe(false);
      });
    });

    // ------------------------------------------------------------------------
    // D. OCC & Version Validation
    // ------------------------------------------------------------------------
    describe("OCC & Idempotency Validation", () => {
      it("accepts expectedVersion = 0 for initial movement type", () => {
        const res = stockMovementInputSchema.safeParse({
          productId: validProductId,
          movementType: "initial",
          quantity: 10,
          reason: "Initial opening stock",
          expectedVersion: 0,
        });
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.data.expectedVersion).toBe(0);
        }
      });

      it("rejects expectedVersion = 0 for non-initial movement types", () => {
        const res = stockMovementInputSchema.safeParse({
          productId: validProductId,
          movementType: "restock",
          quantity: 10,
          reason: "Restock items",
          expectedVersion: 0,
        });
        expect(res.success).toBe(false);
      });

      it("accepts positive expectedVersion", () => {
        const res = stockMovementInputSchema.safeParse({
          productId: validProductId,
          movementType: "restock",
          quantity: 10,
          reason: "Restock items",
          expectedVersion: 3,
        });
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.data.expectedVersion).toBe(3);
        }
      });

      it("rejects negative expectedVersion", () => {
        expect(
          stockMovementInputSchema.safeParse({
            productId: validProductId,
            movementType: "restock",
            quantity: 10,
            reason: "Restock items",
            expectedVersion: -1,
          }).success
        ).toBe(false);
      });

      it("accepts valid UUID idempotencyKey and rejects malformed UUID", () => {
        expect(
          stockMovementInputSchema.safeParse({
            productId: validProductId,
            movementType: "restock",
            quantity: 10,
            reason: "Restock items",
            idempotencyKey: validIdempotencyKey,
          }).success
        ).toBe(true);

        expect(
          stockMovementInputSchema.safeParse({
            productId: validProductId,
            movementType: "restock",
            quantity: 10,
            reason: "Restock items",
            idempotencyKey: "not-a-valid-uuid",
          }).success
        ).toBe(false);
      });
    });
  });

  // ==========================================================================
  // 2. inventoryThresholdInputSchema
  // ==========================================================================
  describe("2. inventoryThresholdInputSchema", () => {
    it("accepts valid reorder point and quantity", () => {
      const input = {
        productId: validProductId,
        reorderPoint: 25.5,
        reorderQuantity: 100,
        expectedVersion: 1,
      };
      const result = inventoryThresholdInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.reorderPoint).toBe(25.5);
        expect(result.data.reorderQuantity).toBe(100);
      }
    });

    it("accepts zero for reorderPoint and reorderQuantity", () => {
      const input = {
        productId: validProductId,
        reorderPoint: 0,
        reorderQuantity: 0,
      };
      expect(inventoryThresholdInputSchema.safeParse(input).success).toBe(true);
    });

    it("accepts null/undefined values for thresholds", () => {
      const input = {
        productId: validProductId,
        reorderPoint: null,
        reorderQuantity: null,
      };
      expect(inventoryThresholdInputSchema.safeParse(input).success).toBe(true);
    });

    it("rejects negative reorderPoint or reorderQuantity", () => {
      expect(
        inventoryThresholdInputSchema.safeParse({
          productId: validProductId,
          reorderPoint: -1,
        }).success
      ).toBe(false);

      expect(
        inventoryThresholdInputSchema.safeParse({
          productId: validProductId,
          reorderQuantity: -0.0001,
        }).success
      ).toBe(false);
    });

    it("rejects values exceeding maximum limit", () => {
      expect(
        inventoryThresholdInputSchema.safeParse({
          productId: validProductId,
          reorderPoint: 1000000000,
        }).success
      ).toBe(false);
    });

    it("rejects precision exceeding 4 decimal places", () => {
      expect(
        inventoryThresholdInputSchema.safeParse({
          productId: validProductId,
          reorderPoint: 10.12345,
        }).success
      ).toBe(false);
    });

    it("rejects expectedVersion = 0 and negative, accepts positive expectedVersion", () => {
      expect(
        inventoryThresholdInputSchema.safeParse({
          productId: validProductId,
          expectedVersion: 0,
        }).success
      ).toBe(false);

      expect(
        inventoryThresholdInputSchema.safeParse({
          productId: validProductId,
          expectedVersion: 1,
        }).success
      ).toBe(true);

      expect(
        inventoryThresholdInputSchema.safeParse({
          productId: validProductId,
          expectedVersion: 5,
        }).success
      ).toBe(true);

      expect(
        inventoryThresholdInputSchema.safeParse({
          productId: validProductId,
          expectedVersion: -2,
        }).success
      ).toBe(false);
    });
  });

  // ==========================================================================
  // 3. inventoryQuerySchema & inventoryFilterSchema
  // ==========================================================================
  describe("3. inventoryQuerySchema & inventoryFilterSchema", () => {
    it("exports inventoryFilterSchema as identical alias to inventoryQuerySchema", () => {
      expect(inventoryFilterSchema).toBe(inventoryQuerySchema);
      const queryResult = inventoryQuerySchema.safeParse({});
      const filterResult = inventoryFilterSchema.safeParse({});
      expect(queryResult.success).toBe(true);
      expect(filterResult.success).toBe(true);
      if (queryResult.success && filterResult.success) {
        expect(filterResult.data).toEqual(queryResult.data);
      }
    });
    it("applies default values when empty object is passed", () => {
      const res = inventoryQuerySchema.safeParse({});
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.page).toBe(1);
        expect(res.data.pageSize).toBe(20);
        expect(res.data.stockStatus).toBe("all");
        expect(res.data.productStatus).toBe("all");
        expect(res.data.includeArchived).toBe(false);
        expect(res.data.sortBy).toBe("stock_status");
        expect(res.data.sortOrder).toBe("asc");
      }
    });

    it("accepts all valid stockStatus filters", () => {
      for (const filter of STOCK_STATUS_FILTERS) {
        const res = inventoryQuerySchema.safeParse({ stockStatus: filter });
        expect(res.success).toBe(true);
      }
    });

    it("rejects invalid stockStatus filter", () => {
      expect(
        inventoryQuerySchema.safeParse({ stockStatus: "unknown_status" }).success
      ).toBe(false);
    });

    it("accepts all valid productStatus filters", () => {
      for (const filter of PRODUCT_STATUS_FILTERS) {
        const res = inventoryQuerySchema.safeParse({ productStatus: filter });
        expect(res.success).toBe(true);
      }
    });

    it("validates pagination boundaries", () => {
      expect(inventoryQuerySchema.safeParse({ page: 1, pageSize: 1 }).success).toBe(true);
      expect(inventoryQuerySchema.safeParse({ page: 100, pageSize: 100 }).success).toBe(true);

      expect(inventoryQuerySchema.safeParse({ page: 0 }).success).toBe(false);
      expect(inventoryQuerySchema.safeParse({ page: -1 }).success).toBe(false);
      expect(inventoryQuerySchema.safeParse({ pageSize: 0 }).success).toBe(false);
      expect(inventoryQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    });

    it("validates sort columns and orders", () => {
      const validCols = ["name", "sku", "quantity", "stock_status"];
      for (const col of validCols) {
        expect(inventoryQuerySchema.safeParse({ sortBy: col }).success).toBe(true);
      }
      expect(inventoryQuerySchema.safeParse({ sortBy: "illegal_column" }).success).toBe(false);

      expect(inventoryQuerySchema.safeParse({ sortOrder: "asc" }).success).toBe(true);
      expect(inventoryQuerySchema.safeParse({ sortOrder: "desc" }).success).toBe(true);
      expect(inventoryQuerySchema.safeParse({ sortOrder: "diagonal" }).success).toBe(false);
    });
  });

  // ==========================================================================
  // 4. movementHistoryQuerySchema
  // ==========================================================================
  describe("4. movementHistoryQuerySchema", () => {
    it("applies default values when empty object is passed", () => {
      const res = movementHistoryQuerySchema.safeParse({});
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.page).toBe(1);
        expect(res.data.pageSize).toBe(25);
        expect(res.data.movementType).toBe("all");
      }
    });

    it("accepts all movement types including POS types for historical ledger auditing", () => {
      const allTypes = ["all", ...MOVEMENT_TYPES];
      for (const t of allTypes) {
        expect(movementHistoryQuerySchema.safeParse({ movementType: t }).success).toBe(true);
      }
    });

    it("rejects unknown movement type in history query", () => {
      expect(
        movementHistoryQuerySchema.safeParse({ movementType: "non_existent" }).success
      ).toBe(false);
    });

    it("accepts valid ISO datetime strings for fromDate and toDate", () => {
      const res = movementHistoryQuerySchema.safeParse({
        fromDate: "2026-11-01T00:00:00.000Z",
        toDate: "2026-11-15T23:59:59.999Z",
      });
      expect(res.success).toBe(true);
    });

    it("rejects malformed datetime strings", () => {
      expect(
        movementHistoryQuerySchema.safeParse({ fromDate: "2026-11-01" }).success
      ).toBe(false);
      expect(
        movementHistoryQuerySchema.safeParse({ toDate: "not-a-datetime" }).success
      ).toBe(false);
    });

    it("validates pagination limits (min 1, max 100)", () => {
      expect(movementHistoryQuerySchema.safeParse({ page: 1, pageSize: 1 }).success).toBe(true);
      expect(movementHistoryQuerySchema.safeParse({ page: 1, pageSize: 100 }).success).toBe(true);

      expect(movementHistoryQuerySchema.safeParse({ page: 0 }).success).toBe(false);
      expect(movementHistoryQuerySchema.safeParse({ pageSize: 0 }).success).toBe(false);
      expect(movementHistoryQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    });
  });
});
