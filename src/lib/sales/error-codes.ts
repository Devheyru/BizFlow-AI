import type { ActionError } from "@/types/auth";

export interface SalesErrorDefinition {
  code: string;
  message: string;
  status: number;
}

/**
 * Authoritative Feature 005 Error Code Catalog
 * Sources:
 * - specs/005-customers-sales/spec.md (Error Catalog)
 * - specs/005-customers-sales/contracts/database-rpcs.md
 * - specs/005-customers-sales/contracts/server-actions.md §6
 */
export const KNOWN_SALES_ERRORS: Record<string, SalesErrorDefinition> = {
  // Shared System & Authentication Codes
  "08001": {
    code: "UNAUTHENTICATED",
    message: "Authentication required.",
    status: 401,
  },
  "42501": {
    code: "INSUFFICIENT_PERMISSIONS",
    message: "Insufficient permissions to perform this operation.",
    status: 403,
  },
  P0001: {
    code: "ORGANIZATION_INACTIVE",
    message: "Organization is currently inactive.",
    status: 403,
  },
  P0002: {
    code: "MEMBERSHIP_INACTIVE",
    message: "Caller is not an active member of this organization.",
    status: 403,
  },
  P0003: {
    code: "PRODUCT_NOT_FOUND",
    message: "Product was not found in this organization.",
    status: 404,
  },
  P0004: {
    code: "INVENTORY_NOT_FOUND",
    message: "Inventory record does not exist for this product.",
    status: 404,
  },
  P0007: {
    code: "INVALID_FINANCIAL_AMOUNT",
    message: "Invalid financial amount submitted.",
    status: 422,
  },

  // Feature 004 Stock Movement Constraints applicable to Sales
  P0011: {
    code: "INSUFFICIENT_STOCK",
    message: "Insufficient inventory stock for requested sale quantity.",
    status: 422,
  },
  P0012: {
    code: "NON_POSITIVE_QUANTITY",
    message: "Quantity must be strictly greater than zero.",
    status: 422,
  },
  P0015: {
    code: "INTEGER_QUANTITY_REQUIRED",
    message: "Fractional quantities are not permitted for discrete products.",
    status: 422,
  },
  P0016: {
    code: "DECIMAL_PRECISION_EXCEEDED",
    message: "Amount or quantity cannot exceed 4 decimal places.",
    status: 422,
  },
  P0021: {
    code: "PRODUCT_ARCHIVED_STOCK_FORBIDDEN",
    message: "Product is archived and cannot be sold or restocked.",
    status: 422,
  },
  P0024: {
    code: "IDEMPOTENCY_CONFLICT",
    message: "Idempotency key has already been used with different request parameters.",
    status: 409,
  },
  P0026: {
    code: "INITIAL_STOCK_NOT_PERMITTED_HISTORY_EXISTS",
    message: "Initial opening stock cannot be recorded after movement history exists.",
    status: 422,
  },
  P0027: {
    code: "STALE_VERSION_CONFLICT",
    message: "Inventory record was updated by another transaction. Please reload and retry.",
    status: 409,
  },
  P0028: {
    code: "QUANTITY_EXCEEDS_MAXIMUM",
    message: "Quantity exceeds allowed maximum of 999,999,999.9999.",
    status: 422,
  },
  P0031: {
    code: "PRODUCT_INACTIVE_SALE_BLOCKED",
    message: "Inactive products cannot be sold.",
    status: 422,
  },
  P0032: {
    code: "RESERVED_MOVEMENT_TYPE_BLOCKED",
    message: "Direct client submission of sale or return movements is prohibited.",
    status: 422,
  },
  P0033: {
    code: "INVALID_QUANTITY_SEMANTICS",
    message: "Invalid quantity semantics submitted for movement type.",
    status: 422,
  },

  // Feature 005 Customer Domain Codes (P0040–P0042)
  P0040: {
    code: "CUSTOMER_NOT_FOUND",
    message: "Customer not found.",
    status: 404,
  },
  P0041: {
    code: "CUSTOMER_ARCHIVED",
    message: "Archived customer cannot be attached to a new sale.",
    status: 422,
  },
  P0042: {
    code: "CUSTOMER_HAS_SALES_DELETE_BLOCKED",
    message: "Customer with sales history cannot be deleted.",
    status: 409,
  },

  // Feature 005 POS & Sale Lifecycle Codes (P0043–P0051)
  P0043: {
    code: "SALE_EMPTY_CART",
    message: "Cart must contain at least one item.",
    status: 422,
  },
  P0044: {
    code: "DUPLICATE_CART_PRODUCT",
    message: "Cart contains duplicate entries for the same product.",
    status: 422,
  },
  P0045: {
    code: "PAYMENT_INCOMPLETE",
    message: "Total payments do not cover the sale amount.",
    status: 422,
  },
  P0046: {
    code: "PAYMENT_EXCEEDS_PAYABLE_AMOUNT",
    message: "Non-cash payment exceeds payable amount.",
    status: 422,
  },
  P0047: {
    code: "DISCOUNT_EXCEEDS_MAXIMUM",
    message: "Discount exceeds allowed maximum.",
    status: 422,
  },
  P0048: {
    code: "SALE_NOT_FOUND",
    message: "Sale not found.",
    status: 404,
  },
  P0049: {
    code: "SALE_NOT_COMPLETED",
    message: "Referenced sale is not in completed status.",
    status: 422,
  },
  P0050: {
    code: "SALE_ALREADY_VOIDED",
    message: "Sale has already been voided.",
    status: 422,
  },
  P0051: {
    code: "SALE_VOID_HAS_RETURNS_BLOCKED",
    message: "Sale cannot be voided after returns have been processed.",
    status: 422,
  },

  // Feature 005 Return & Refund Codes (P0052–P0067)
  P0052: {
    code: "RETURN_QUANTITY_EXCEEDS_SOLD",
    message: "Return quantity exceeds remaining unreturned quantity.",
    status: 422,
  },
  P0053: {
    code: "RETURN_REASON_REQUIRED",
    message: "A return reason is required (minimum 3 characters).",
    status: 422,
  },
  P0054: {
    code: "REFUND_EXCEEDS_PAYABLE",
    message: "Cumulative refunds exceed sale total amount.",
    status: 422,
  },
  P0055: {
    code: "IDEMPOTENCY_KEY_REQUIRED",
    message: "A UUID idempotency key is required.",
    status: 422,
  },
  P0056: {
    code: "PRODUCT_INACTIVE_RETURN_BLOCKED",
    message: "Cannot restock inventory for inactive product.",
    status: 422,
  },
  P0057: {
    code: "PAYMENT_REFERENCE_REQUIRED",
    message: "Transaction reference required for non-cash payment.",
    status: 422,
  },
  P0058: {
    code: "REFUND_NOT_FOUND",
    message: "Refund record not found.",
    status: 404,
  },
  P0059: {
    code: "EXTERNAL_REVERSAL_REFERENCE_REQUIRED",
    message: "External provider reference required for confirmation.",
    status: 422,
  },
  P0060: {
    code: "DUPLICATE_RETURN_ITEM",
    message: "Duplicate sale item in return request.",
    status: 422,
  },
  P0061: {
    code: "REFUND_METHOD_EXCEEDS_ORIGINAL_TENDER",
    message: "Refund amount exceeds original tender amount for this payment method.",
    status: 422,
  },
  P0062: {
    code: "REFUND_ALREADY_SETTLED",
    message: "Refund is not in pending status.",
    status: 422,
  },
  P0063: {
    code: "RETURN_NOT_FOUND",
    message: "Return record not found.",
    status: 404,
  },
  P0064: {
    code: "REPLACEMENT_REFUND_ALREADY_EXISTS",
    message: "An active replacement refund already exists for this failed refund.",
    status: 409,
  },
  P0065: {
    code: "REFUND_NOT_FAILED",
    message: "Target refund is not in failed status.",
    status: 422,
  },
  P0067: {
    code: "OBLIGATION_ALREADY_COMPLETED",
    message: "Reimbursement obligation has already been fulfilled.",
    status: 422,
  },

  // PostgreSQL Standard SQLSTATE Codes
  "22012": {
    code: "DIVISION_BY_ZERO",
    message: "Division by zero occurred during financial calculation.",
    status: 422,
  },
  "23503": {
    code: "FOREIGN_KEY_VIOLATION",
    message: "Referenced record does not exist or has active dependencies.",
    status: 409,
  },
  "23505": {
    code: "DUPLICATE_RECORD",
    message: "A record with this identifier already exists.",
    status: 409,
  },
};

export interface MappedSalesError extends ActionError {
  status: number;
}

/**
 * Maps PostgreSQL SQLSTATE or database error payloads to client-safe domain ActionError objects.
 * Never exposes raw SQL queries, table schemas, or internal server stack traces to clients.
 */
export function mapSalesError(error: unknown): MappedSalesError {
  if (!error || typeof error !== "object") {
    return {
      code: "INTERNAL_ERROR",
      message: "An unexpected database error occurred.",
      status: 500,
    };
  }

  const err = error as {
    code?: string;
    message?: string;
    details?: string;
    hint?: string;
  };

  const code = typeof err.code === "string" ? err.code.trim() : "";
  const rawMessage = typeof err.message === "string" ? err.message : "";

  // 1. Direct SQLSTATE code lookup
  if (code && KNOWN_SALES_ERRORS[code]) {
    const def = KNOWN_SALES_ERRORS[code]!;

    // Specialized unique constraint parsing for 23505
    if (code === "23505") {
      if (
        rawMessage.includes("uq_customers_org_phone") ||
        rawMessage.includes("CUSTOMER_PHONE_EXISTS")
      ) {
        return {
          code: "CUSTOMER_PHONE_EXISTS",
          message: "A customer with this phone number already exists in your organization.",
          status: 409,
        };
      }
      if (
        rawMessage.includes("uq_customers_org_email") ||
        rawMessage.includes("CUSTOMER_EMAIL_EXISTS")
      ) {
        return {
          code: "CUSTOMER_EMAIL_EXISTS",
          message: "A customer with this email address already exists in your organization.",
          status: 409,
        };
      }
      if (rawMessage.includes("PAYMENT_REFERENCE_EXISTS")) {
        return {
          code: "PAYMENT_REFERENCE_EXISTS",
          message: "A payment with this reference number already exists in your organization.",
          status: 409,
        };
      }
    }

    return {
      code: def.code,
      message: def.message,
      status: def.status,
    };
  }

  // 2. Fallback: Check if message contains known domain error name (e.g. from PL/pgSQL RAISE EXCEPTION)
  for (const [, def] of Object.entries(KNOWN_SALES_ERRORS)) {
    if (rawMessage.includes(def.code)) {
      return {
        code: def.code,
        message: def.message,
        status: def.status,
      };
    }
  }

  // 3. Fallback: Safe generic database error (prevent raw detail leak)
  return {
    code: "DATABASE_OPERATION_FAILED",
    message: "The requested sales operation could not be completed.",
    status: 500,
  };
}
