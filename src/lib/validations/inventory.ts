import { z } from "zod";
import {
  MANUAL_MOVEMENT_TYPES,
  MOVEMENT_TYPES,
  QUANTITY_SEMANTICS,
  STOCK_STATUS_FILTERS,
  PRODUCT_STATUS_FILTERS,
} from "@/types/inventory";

// Maximum decimal precision allowed by NUMERIC(14,4)
const MAX_QUANTITY = 999999999.9999;
const MIN_POSITIVE_QUANTITY = 0.0001;

/**
 * Validates maximum 4 decimal places for NUMERIC(14,4)
 */
function hasMaxFourDecimals(val: number): boolean {
  const parts = val.toString().split(".");
  return parts.length < 2 || (parts[1]?.length ?? 0) <= 4;
}

// ============================================================================
// 1. Stock Movement Input Schema (T014)
// ============================================================================
export const stockMovementInputSchema = z
  .object({
    productId: z.string().uuid({ message: "Valid product ID is required" }),
    movementType: z.enum(MANUAL_MOVEMENT_TYPES, {
      errorMap: () => ({ message: "Invalid stock movement type" }),
    }),
    quantity: z
      .number({ invalid_type_error: "Quantity must be a valid number" })
      .finite({ message: "Quantity must be a finite number" })
      .min(-MAX_QUANTITY, { message: `Quantity cannot be less than -${MAX_QUANTITY}` })
      .max(MAX_QUANTITY, { message: `Quantity cannot exceed ${MAX_QUANTITY}` })
      .refine((val) => hasMaxFourDecimals(Math.abs(val)), {
        message: "Quantity cannot exceed 4 decimal places",
      }),
    reason: z
      .string()
      .trim()
      .min(3, { message: "Reason must be at least 3 characters" })
      .max(500, { message: "Reason cannot exceed 500 characters" }),
    referenceId: z
      .string()
      .trim()
      .max(100, { message: "Reference ID cannot exceed 100 characters" })
      .optional()
      .nullable(),
    idempotencyKey: z.string().uuid().optional().nullable(),
    expectedVersion: z.number().int().positive().optional().nullable(),
    quantitySemantics: z
      .enum(QUANTITY_SEMANTICS)
      .default("quantity_delta"),
    isDiscrete: z.boolean().optional(),
  })
  .refine(
    (data) => {
      // Discrete products check (pieces, units, sets, etc.)
      if (data.isDiscrete) {
        return Number.isInteger(data.quantity);
      }
      return true;
    },
    {
      message: "Discrete products require whole integer quantities",
      path: ["quantity"],
    }
  )
  .refine(
    (data) => {
      // Semantics: target_physical_count must be non-negative and is ONLY allowed for 'adjustment'
      if (data.quantitySemantics === "target_physical_count") {
        return data.movementType === "adjustment" && data.quantity >= 0;
      }
      // Semantics: quantity_delta rules per movement type
      if (data.movementType === "restock") {
        return data.quantity >= MIN_POSITIVE_QUANTITY;
      }
      if (data.movementType === "initial") {
        return data.quantity >= 0;
      }
      if (data.movementType === "adjustment") {
        return data.quantity !== 0;
      }
      // For damage, loss, internal_use: single unambiguous signed-delta API requires negative delta (< 0)
      if (
        data.movementType === "damage" ||
        data.movementType === "loss" ||
        data.movementType === "internal_use"
      ) {
        return data.quantity <= -MIN_POSITIVE_QUANTITY;
      }
      return false;
    },
    {
      message:
        "Target physical count is permitted only for adjustments and must be non-negative; write-offs (damage, loss, internal use) require a negative quantity delta; restock requires a positive delta; adjustments cannot be zero",
      path: ["quantitySemantics"],
    }
  );

export type StockMovementInputParsed = z.infer<typeof stockMovementInputSchema>;

// ============================================================================
// 2. Inventory Threshold Input Schema (T014)
// ============================================================================
export const inventoryThresholdInputSchema = z.object({
  productId: z.string().uuid({ message: "Valid product ID is required" }),
  reorderPoint: z
    .number({ invalid_type_error: "Reorder point must be a valid number" })
    .finite({ message: "Reorder point must be a finite number" })
    .min(0, { message: "Reorder point cannot be negative" })
    .max(MAX_QUANTITY, { message: `Reorder point cannot exceed ${MAX_QUANTITY}` })
    .refine(hasMaxFourDecimals, {
      message: "Reorder point cannot exceed 4 decimal places",
    })
    .optional()
    .nullable(),
  reorderQuantity: z
    .number({ invalid_type_error: "Reorder quantity must be a valid number" })
    .finite({ message: "Reorder quantity must be a finite number" })
    .min(0, { message: "Reorder quantity cannot be negative" })
    .max(MAX_QUANTITY, { message: `Reorder quantity cannot exceed ${MAX_QUANTITY}` })
    .refine(hasMaxFourDecimals, {
      message: "Reorder quantity cannot exceed 4 decimal places",
    })
    .optional()
    .nullable(),
  expectedVersion: z.number().int().positive().optional().nullable(),
});

export type InventoryThresholdInputParsed = z.infer<
  typeof inventoryThresholdInputSchema
>;

// ============================================================================
// 3. Inventory Query Schema (T014)
// ============================================================================
export const inventoryQuerySchema = z.object({
  search: z.string().trim().optional(),
  categoryId: z.string().uuid().optional().nullable(),
  stockStatus: z.enum(STOCK_STATUS_FILTERS).default("all"),
  productStatus: z.enum(PRODUCT_STATUS_FILTERS).default("all"),
  includeArchived: z.boolean().default(false),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["name", "sku", "quantity", "stock_status"]).default("stock_status"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

export type InventoryQueryInputParsed = z.infer<typeof inventoryQuerySchema>;

// ============================================================================
// 4. Movement History Query Schema (T014)
// ============================================================================
export const movementHistoryQuerySchema = z.object({
  productId: z.string().uuid().optional().nullable(),
  movementType: z.enum(["all", ...MOVEMENT_TYPES]).default("all"),
  fromDate: z.string().datetime().optional().nullable(),
  toDate: z.string().datetime().optional().nullable(),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});

export type MovementHistoryQueryInputParsed = z.infer<
  typeof movementHistoryQuerySchema
>;

