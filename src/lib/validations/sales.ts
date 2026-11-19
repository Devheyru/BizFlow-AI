import { z } from "zod";

/**
 * Maximum precision allowed for monetary values and quantities (NUMERIC(14,4))
 */
export const MAX_FINANCIAL_AMOUNT = 999999999.9999;

/**
 * Validates that a number has at most 4 decimal places
 */
export function hasMaxFourDecimals(val: number): boolean {
  const parts = val.toString().split(".");
  return parts.length < 2 || (parts[1]?.length ?? 0) <= 4;
}

/**
 * Payment method enumeration
 */
export const PAYMENT_METHODS = ["cash", "card", "bank_transfer", "other"] as const;

/**
 * Sale status enumeration
 */
export const SALE_STATUSES = [
  "completed",
  "voided",
  "partially_returned",
  "returned",
] as const;

// ============================================================================
// 1. Checkout & Sale Execution Schema (T036, US1, US3)
// ============================================================================
export const saleItemInputSchema = z.object({
  productId: z.string().uuid({ message: "Invalid product ID format" }),
  quantity: z
    .number({ invalid_type_error: "Quantity must be a number" })
    .positive({ message: "Item quantity must be strictly greater than zero" })
    .max(MAX_FINANCIAL_AMOUNT, { message: `Quantity cannot exceed ${MAX_FINANCIAL_AMOUNT}` })
    .refine(hasMaxFourDecimals, { message: "Quantity cannot exceed 4 decimal places" }),
  lineDiscountAmount: z
    .number({ invalid_type_error: "Line discount must be a number" })
    .min(0, { message: "Line discount amount cannot be negative" })
    .max(MAX_FINANCIAL_AMOUNT, { message: `Line discount cannot exceed ${MAX_FINANCIAL_AMOUNT}` })
    .refine(hasMaxFourDecimals, { message: "Line discount cannot exceed 4 decimal places" })
    .default(0),
  expectedVersion: z
    .number({ invalid_type_error: "Expected version must be an integer" })
    .int({ message: "Expected version must be an integer" })
    .nonnegative({ message: "Expected version cannot be negative" })
    .optional()
    .nullable(),
});

export const paymentInputSchema = z
  .object({
    paymentMethod: z.enum(PAYMENT_METHODS, {
      errorMap: () => ({ message: "Invalid payment method" }),
    }),
    amount: z
      .number({ invalid_type_error: "Payment amount must be a number" })
      .positive({ message: "Payment amount must be strictly greater than zero" })
      .max(MAX_FINANCIAL_AMOUNT, { message: `Payment amount cannot exceed ${MAX_FINANCIAL_AMOUNT}` })
      .refine(hasMaxFourDecimals, { message: "Payment amount cannot exceed 4 decimal places" }),
    amountTendered: z
      .number({ invalid_type_error: "Amount tendered must be a number" })
      .min(0, { message: "Amount tendered cannot be negative" })
      .max(MAX_FINANCIAL_AMOUNT, { message: `Amount tendered cannot exceed ${MAX_FINANCIAL_AMOUNT}` })
      .refine(hasMaxFourDecimals, { message: "Amount tendered cannot exceed 4 decimal places" })
      .optional()
      .nullable(),
    changeDue: z
      .number({ invalid_type_error: "Change due must be a number" })
      .min(0, { message: "Change due cannot be negative" })
      .max(MAX_FINANCIAL_AMOUNT, { message: `Change due cannot exceed ${MAX_FINANCIAL_AMOUNT}` })
      .refine(hasMaxFourDecimals, { message: "Change due cannot exceed 4 decimal places" })
      .optional()
      .nullable(),
    referenceNo: z
      .string()
      .trim()
      .max(255, { message: "Payment reference cannot exceed 255 characters" })
      .optional()
      .nullable(),
  })
  .refine(
    (p) => {
      // Non-cash tenders require a non-empty transaction reference (P0057)
      if (p.paymentMethod !== "cash") {
        return typeof p.referenceNo === "string" && p.referenceNo.trim().length > 0;
      }
      return true;
    },
    {
      message: "Transaction reference is required for non-cash payment methods",
      path: ["referenceNo"],
    }
  );

export const executeSaleSchema = z.object({
  customerId: z
    .string()
    .uuid({ message: "Invalid customer ID format" })
    .optional()
    .nullable(),
  items: z
    .array(saleItemInputSchema, {
      required_error: "Sale items are required",
      invalid_type_error: "Sale items must be an array",
    })
    .min(1, { message: "Cart must contain at least one item" })
    .refine(
      (items) => {
        const productIds = new Set(items.map((it) => it.productId));
        return productIds.size === items.length;
      },
      {
        message: "Cart contains duplicate entries for the same product",
      }
    ),
  payments: z
    .array(paymentInputSchema, {
      required_error: "Payment tenders are required",
      invalid_type_error: "Payments must be an array",
    })
    .min(1, { message: "At least one payment tender is required" }),
  orderDiscountAmount: z
    .number({ invalid_type_error: "Order discount must be a number" })
    .min(0, { message: "Order discount amount cannot be negative" })
    .max(MAX_FINANCIAL_AMOUNT, { message: `Order discount cannot exceed ${MAX_FINANCIAL_AMOUNT}` })
    .refine(hasMaxFourDecimals, { message: "Order discount cannot exceed 4 decimal places" })
    .default(0),
  idempotencyKey: z
    .string({ required_error: "Idempotency key is required" })
    .uuid({ message: "Idempotency key must be a valid UUID" }),
  notes: z
    .string()
    .trim()
    .max(1000, { message: "Sale notes cannot exceed 1000 characters" })
    .optional()
    .nullable(),
});

export type ExecuteSaleInput = z.infer<typeof executeSaleSchema>;

// ============================================================================
// 2. Void Sale Schema (T036, US6)
// ============================================================================
export const voidReversalReferenceSchema = z.object({
  paymentId: z.string().uuid({ message: "Invalid payment ID format" }),
  referenceNo: z
    .string()
    .trim()
    .min(1, { message: "Reversal reference cannot be empty" })
    .max(255, { message: "Reversal reference cannot exceed 255 characters" }),
});

export const voidSaleSchema = z.object({
  saleId: z
    .string({ required_error: "Sale ID is required" })
    .uuid({ message: "Sale ID must be a valid UUID" }),
  voidReason: z
    .string({ required_error: "Void reason is required" })
    .trim()
    .min(3, { message: "Void reason must be at least 3 characters" })
    .max(500, { message: "Void reason cannot exceed 500 characters" }),
  idempotencyKey: z
    .string({ required_error: "Idempotency key is required" })
    .uuid({ message: "Idempotency key must be a valid UUID" }),
  reversalReferences: z
    .array(voidReversalReferenceSchema)
    .optional()
    .nullable(),
});

export type VoidSaleInput = z.infer<typeof voidSaleSchema>;

// ============================================================================
// 3. Sale Return Schema (T036, US4)
// ============================================================================
export const returnItemInputSchema = z.object({
  saleItemId: z
    .string({ required_error: "Sale item ID is required" })
    .uuid({ message: "Sale item ID must be a valid UUID" }),
  quantity: z
    .number({ invalid_type_error: "Return quantity must be a number" })
    .positive({ message: "Return quantity must be strictly greater than zero" })
    .max(MAX_FINANCIAL_AMOUNT, { message: `Return quantity cannot exceed ${MAX_FINANCIAL_AMOUNT}` })
    .refine(hasMaxFourDecimals, { message: "Return quantity cannot exceed 4 decimal places" }),
  restockToInventory: z.boolean({
    required_error: "Restock to inventory flag is required",
    invalid_type_error: "Restock to inventory must be a boolean",
  }),
});

export const executeSaleReturnSchema = z.object({
  saleId: z
    .string({ required_error: "Sale ID is required" })
    .uuid({ message: "Sale ID must be a valid UUID" }),
  returnItems: z
    .array(returnItemInputSchema, {
      required_error: "Return items are required",
      invalid_type_error: "Return items must be an array",
    })
    .min(1, { message: "At least one item must be returned" })
    .refine(
      (items) => {
        const itemIds = new Set(items.map((it) => it.saleItemId));
        return itemIds.size === items.length;
      },
      {
        message: "Duplicate sale item in return request",
      }
    ),
  refundMethod: z.enum(PAYMENT_METHODS, {
    errorMap: () => ({ message: "Invalid refund method" }),
  }),
  reason: z
    .string({ required_error: "Return reason is required" })
    .trim()
    .min(3, { message: "Return reason must be at least 3 characters" })
    .max(255, { message: "Return reason cannot exceed 255 characters" }),
  idempotencyKey: z
    .string({ required_error: "Idempotency key is required" })
    .uuid({ message: "Idempotency key must be a valid UUID" }),
  referenceNo: z
    .string()
    .trim()
    .max(255, { message: "Reference number cannot exceed 255 characters" })
    .optional()
    .nullable(),
});

export type ExecuteSaleReturnInput = z.infer<typeof executeSaleReturnSchema>;

// ============================================================================
// 4. Refund Confirmation & Lifecycle Schemas (T036, US7)
// ============================================================================
export const confirmRefundSchema = z.object({
  refundId: z
    .string({ required_error: "Refund ID is required" })
    .uuid({ message: "Refund ID must be a valid UUID" }),
  externalReference: z
    .string({ required_error: "External reference is required" })
    .trim()
    .min(1, { message: "External reversal reference is required" })
    .max(255, { message: "External reference cannot exceed 255 characters" }),
  idempotencyKey: z
    .string({ required_error: "Idempotency key is required" })
    .uuid({ message: "Idempotency key must be a valid UUID" }),
});

export type ConfirmRefundInput = z.infer<typeof confirmRefundSchema>;

export const recordRefundFailureSchema = z.object({
  refundId: z
    .string({ required_error: "Refund ID is required" })
    .uuid({ message: "Refund ID must be a valid UUID" }),
  failureReason: z
    .string({ required_error: "Failure reason is required" })
    .trim()
    .min(3, { message: "Failure reason must be at least 3 characters" })
    .max(500, { message: "Failure reason cannot exceed 500 characters" }),
});

export type RecordRefundFailureInput = z.infer<typeof recordRefundFailureSchema>;

export const issueReplacementRefundSchema = z.object({
  failedRefundId: z
    .string({ required_error: "Failed refund ID is required" })
    .uuid({ message: "Failed refund ID must be a valid UUID" }),
  refundMethod: z.enum(PAYMENT_METHODS, {
    errorMap: () => ({ message: "Invalid refund method" }),
  }),
  idempotencyKey: z
    .string({ required_error: "Idempotency key is required" })
    .uuid({ message: "Idempotency key must be a valid UUID" }),
  referenceNo: z
    .string()
    .trim()
    .max(255, { message: "Reference number cannot exceed 255 characters" })
    .optional()
    .nullable(),
  notes: z
    .string()
    .trim()
    .max(500, { message: "Replacement refund notes cannot exceed 500 characters" })
    .optional()
    .nullable(),
});

export type IssueReplacementRefundInput = z.infer<typeof issueReplacementRefundSchema>;

// ============================================================================
// 5. Sales List Query Schema (T036, US5)
// ============================================================================
export const salesListQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z
    .enum(["all", ...SALE_STATUSES], {
      errorMap: () => ({ message: "Invalid sale status filter" }),
    })
    .default("all"),
  customerId: z
    .string()
    .uuid({ message: "Invalid customer ID format" })
    .optional()
    .nullable(),
  cashierId: z
    .string()
    .uuid({ message: "Invalid cashier ID format" })
    .optional()
    .nullable(),
  fromDate: z.string().datetime({ message: "Invalid fromDate ISO format" }).optional().nullable(),
  toDate: z.string().datetime({ message: "Invalid toDate ISO format" }).optional().nullable(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["created_at", "sale_number", "total_amount"]).default("created_at"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type SalesListQueryInput = z.infer<typeof salesListQuerySchema>;

// ============================================================================
// 6. Organization Tax Settings Schema (T036, US8)
// ============================================================================
export const updateTaxSettingsSchema = z.object({
  taxName: z
    .string({ required_error: "Tax name is required" })
    .trim()
    .min(1, { message: "Tax name is required" })
    .max(100, { message: "Tax name cannot exceed 100 characters" }),
  defaultTaxRate: z
    .number({ invalid_type_error: "Tax rate must be a number" })
    .min(0, { message: "Tax rate cannot be negative" })
    .max(100, { message: "Tax rate cannot exceed 100%" })
    .refine(hasMaxFourDecimals, { message: "Tax rate cannot exceed 4 decimal places" }),
  isTaxInclusive: z.boolean({
    required_error: "Tax inclusion mode is required",
    invalid_type_error: "isTaxInclusive must be a boolean",
  }),
});

export type UpdateTaxSettingsInput = z.infer<typeof updateTaxSettingsSchema>;
