import { describe, it, expect } from "vitest";
import { mapSalesError, KNOWN_SALES_ERRORS } from "@/lib/sales/error-codes";

describe("T037: Sales & Financial Error Code Mapper", () => {
  it("exports KNOWN_SALES_ERRORS catalog with all documented error codes", () => {
    expect(Object.keys(KNOWN_SALES_ERRORS).length).toBeGreaterThan(30);
    expect(KNOWN_SALES_ERRORS.P0040?.code).toBe("CUSTOMER_NOT_FOUND");
  });

  describe("Direct SQLSTATE Code Mapping", () => {
    it("maps all documented Feature 005 customer domain errors (P0040–P0042)", () => {
      expect(mapSalesError({ code: "P0040" })).toEqual({
        code: "CUSTOMER_NOT_FOUND",
        message: "Customer not found.",
        status: 404,
      });

      expect(mapSalesError({ code: "P0041" })).toEqual({
        code: "CUSTOMER_ARCHIVED",
        message: "Archived customer cannot be attached to a new sale.",
        status: 422,
      });

      expect(mapSalesError({ code: "P0042" })).toEqual({
        code: "CUSTOMER_HAS_SALES_DELETE_BLOCKED",
        message: "Customer with sales history cannot be deleted.",
        status: 409,
      });
    });

    it("maps POS cart and checkout errors (P0043–P0047)", () => {
      expect(mapSalesError({ code: "P0043" })).toEqual({
        code: "SALE_EMPTY_CART",
        message: "Cart must contain at least one item.",
        status: 422,
      });

      expect(mapSalesError({ code: "P0044" })).toEqual({
        code: "DUPLICATE_CART_PRODUCT",
        message: "Cart contains duplicate entries for the same product.",
        status: 422,
      });

      expect(mapSalesError({ code: "P0045" })).toEqual({
        code: "PAYMENT_INCOMPLETE",
        message: "Total payments do not cover the sale amount.",
        status: 422,
      });

      expect(mapSalesError({ code: "P0046" })).toEqual({
        code: "PAYMENT_EXCEEDS_PAYABLE_AMOUNT",
        message: "Non-cash payment exceeds payable amount.",
        status: 422,
      });

      expect(mapSalesError({ code: "P0047" })).toEqual({
        code: "DISCOUNT_EXCEEDS_MAXIMUM",
        message: "Discount exceeds allowed maximum.",
        status: 422,
      });
    });

    it("maps sale lifecycle and void errors (P0048–P0051)", () => {
      expect(mapSalesError({ code: "P0048" })).toEqual({
        code: "SALE_NOT_FOUND",
        message: "Sale not found.",
        status: 404,
      });

      expect(mapSalesError({ code: "P0049" })).toEqual({
        code: "SALE_NOT_COMPLETED",
        message: "Referenced sale is not in completed status.",
        status: 422,
      });

      expect(mapSalesError({ code: "P0050" })).toEqual({
        code: "SALE_ALREADY_VOIDED",
        message: "Sale has already been voided.",
        status: 422,
      });

      expect(mapSalesError({ code: "P0051" })).toEqual({
        code: "SALE_VOID_HAS_RETURNS_BLOCKED",
        message: "Sale cannot be voided after returns have been processed.",
        status: 422,
      });
    });

    it("maps return and refund lifecycle errors (P0052–P0067)", () => {
      expect(mapSalesError({ code: "P0052" })).toEqual({
        code: "RETURN_QUANTITY_EXCEEDS_SOLD",
        message: "Return quantity exceeds remaining unreturned quantity.",
        status: 422,
      });

      expect(mapSalesError({ code: "P0053" })).toEqual({
        code: "RETURN_REASON_REQUIRED",
        message: "A return reason is required (minimum 3 characters).",
        status: 422,
      });

      expect(mapSalesError({ code: "P0054" })).toEqual({
        code: "REFUND_EXCEEDS_PAYABLE",
        message: "Cumulative refunds exceed sale total amount.",
        status: 422,
      });

      expect(mapSalesError({ code: "P0055" })).toEqual({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "A UUID idempotency key is required.",
        status: 422,
      });

      expect(mapSalesError({ code: "P0056" })).toEqual({
        code: "PRODUCT_INACTIVE_RETURN_BLOCKED",
        message: "Cannot restock inventory for inactive product.",
        status: 422,
      });

      expect(mapSalesError({ code: "P0057" })).toEqual({
        code: "PAYMENT_REFERENCE_REQUIRED",
        message: "Transaction reference required for non-cash payment.",
        status: 422,
      });

      expect(mapSalesError({ code: "P0058" })).toEqual({
        code: "REFUND_NOT_FOUND",
        message: "Refund record not found.",
        status: 404,
      });

      expect(mapSalesError({ code: "P0059" })).toEqual({
        code: "EXTERNAL_REVERSAL_REFERENCE_REQUIRED",
        message: "External provider reference required for confirmation.",
        status: 422,
      });

      expect(mapSalesError({ code: "P0060" })).toEqual({
        code: "DUPLICATE_RETURN_ITEM",
        message: "Duplicate sale item in return request.",
        status: 422,
      });

      expect(mapSalesError({ code: "P0061" })).toEqual({
        code: "REFUND_METHOD_EXCEEDS_ORIGINAL_TENDER",
        message: "Refund amount exceeds original tender amount for this payment method.",
        status: 422,
      });

      expect(mapSalesError({ code: "P0062" })).toEqual({
        code: "REFUND_ALREADY_SETTLED",
        message: "Refund is not in pending status.",
        status: 422,
      });

      expect(mapSalesError({ code: "P0063" })).toEqual({
        code: "RETURN_NOT_FOUND",
        message: "Return record not found.",
        status: 404,
      });

      expect(mapSalesError({ code: "P0064" })).toEqual({
        code: "REPLACEMENT_REFUND_ALREADY_EXISTS",
        message: "An active replacement refund already exists for this failed refund.",
        status: 409,
      });

      expect(mapSalesError({ code: "P0065" })).toEqual({
        code: "REFUND_NOT_FAILED",
        message: "Target refund is not in failed status.",
        status: 422,
      });

      expect(mapSalesError({ code: "P0067" })).toEqual({
        code: "OBLIGATION_ALREADY_COMPLETED",
        message: "Reimbursement obligation has already been fulfilled.",
        status: 422,
      });
    });

    it("maps inventory stock constraints (P0011, P0021, P0024, P0026, P0027, P0028, P0031, P0032, P0033)", () => {
      expect(mapSalesError({ code: "P0011" })).toEqual({
        code: "INSUFFICIENT_STOCK",
        message: "Insufficient inventory stock for requested sale quantity.",
        status: 422,
      });
      expect(mapSalesError({ code: "P0021" })).toEqual({
        code: "PRODUCT_ARCHIVED_STOCK_FORBIDDEN",
        message: "Product is archived and cannot be sold or restocked.",
        status: 422,
      });
      expect(mapSalesError({ code: "P0024" })).toEqual({
        code: "IDEMPOTENCY_CONFLICT",
        message: "Idempotency key has already been used with different request parameters.",
        status: 409,
      });
      expect(mapSalesError({ code: "P0026" })).toEqual({
        code: "INITIAL_STOCK_NOT_PERMITTED_HISTORY_EXISTS",
        message: "Initial opening stock cannot be recorded after movement history exists.",
        status: 422,
      });
      expect(mapSalesError({ code: "P0027" })).toEqual({
        code: "STALE_VERSION_CONFLICT",
        message: "Inventory record was updated by another transaction. Please reload and retry.",
        status: 409,
      });
      expect(mapSalesError({ code: "P0028" })).toEqual({
        code: "QUANTITY_EXCEEDS_MAXIMUM",
        message: "Quantity exceeds allowed maximum of 999,999,999.9999.",
        status: 422,
      });
      expect(mapSalesError({ code: "P0031" })).toEqual({
        code: "PRODUCT_INACTIVE_SALE_BLOCKED",
        message: "Inactive products cannot be sold.",
        status: 422,
      });
      expect(mapSalesError({ code: "P0032" })).toEqual({
        code: "RESERVED_MOVEMENT_TYPE_BLOCKED",
        message: "Direct client submission of sale or return movements is prohibited.",
        status: 422,
      });
      expect(mapSalesError({ code: "P0033" })).toEqual({
        code: "INVALID_QUANTITY_SEMANTICS",
        message: "Invalid quantity semantics submitted for movement type.",
        status: 422,
      });
    });

    it("maps auth and organization codes (08001, 42501, P0001, P0002)", () => {
      expect(mapSalesError({ code: "08001" })).toEqual({
        code: "UNAUTHENTICATED",
        message: "Authentication required.",
        status: 401,
      });

      expect(mapSalesError({ code: "42501" })).toEqual({
        code: "INSUFFICIENT_PERMISSIONS",
        message: "Insufficient permissions to perform this operation.",
        status: 403,
      });

      expect(mapSalesError({ code: "P0001" })).toEqual({
        code: "ORGANIZATION_INACTIVE",
        message: "Organization is currently inactive.",
        status: 403,
      });

      expect(mapSalesError({ code: "P0002" })).toEqual({
        code: "MEMBERSHIP_INACTIVE",
        message: "Caller is not an active member of this organization.",
        status: 403,
      });
    });

    it("maps PostgreSQL standard SQLSTATEs (23503, 23505, 22012)", () => {
      expect(mapSalesError({ code: "23503" })).toEqual({
        code: "FOREIGN_KEY_VIOLATION",
        message: "Referenced record does not exist or has active dependencies.",
        status: 409,
      });

      expect(mapSalesError({ code: "22012" })).toEqual({
        code: "DIVISION_BY_ZERO",
        message: "Division by zero occurred during financial calculation.",
        status: 422,
      });

      // Generic 23505
      expect(mapSalesError({ code: "23505" })).toEqual({
        code: "DUPLICATE_RECORD",
        message: "A record with this identifier already exists.",
        status: 409,
      });

      // Specialized 23505 for customer phone
      expect(
        mapSalesError({
          code: "23505",
          message: 'duplicate key value violates unique constraint "uq_customers_org_phone"',
        })
      ).toEqual({
        code: "CUSTOMER_PHONE_EXISTS",
        message: "A customer with this phone number already exists in your organization.",
        status: 409,
      });

      // Specialized 23505 for customer email
      expect(
        mapSalesError({
          code: "23505",
          message: 'duplicate key value violates unique constraint "uq_customers_org_email"',
        })
      ).toEqual({
        code: "CUSTOMER_EMAIL_EXISTS",
        message: "A customer with this email address already exists in your organization.",
        status: 409,
      });

      // Specialized 23505 for payment reference
      expect(
        mapSalesError({
          code: "23505",
          message: "PAYMENT_REFERENCE_EXISTS",
        })
      ).toEqual({
        code: "PAYMENT_REFERENCE_EXISTS",
        message: "A payment with this reference number already exists in your organization.",
        status: 409,
      });
    });
  });

  describe("Fallback and Message Substring Mapping", () => {
    it("maps PL/pgSQL RAISE EXCEPTION message containing domain code", () => {
      const err = new Error("P0045: PAYMENT_INCOMPLETE in execute_sale");
      const mapped = mapSalesError(err);
      expect(mapped.code).toBe("PAYMENT_INCOMPLETE");
      expect(mapped.status).toBe(422);
    });

    it("safely handles unknown SQLSTATE codes without leaking internal details", () => {
      const internalErr = {
        code: "42P01",
        message: 'relation "secret_table" does not exist at line 42 SELECT * FROM secrets',
      };
      const mapped = mapSalesError(internalErr);
      expect(mapped.code).toBe("DATABASE_OPERATION_FAILED");
      expect(mapped.message).toBe("The requested sales operation could not be completed.");
      expect(mapped.status).toBe(500);
      expect(mapped.message).not.toContain("secret_table");
      expect(mapped.message).not.toContain("SELECT");
    });

    it("safely handles null, undefined, or non-object errors", () => {
      expect(mapSalesError(null)).toEqual({
        code: "INTERNAL_ERROR",
        message: "An unexpected database error occurred.",
        status: 500,
      });

      expect(mapSalesError("string error")).toEqual({
        code: "INTERNAL_ERROR",
        message: "An unexpected database error occurred.",
        status: 500,
      });
    });
  });
});
