"use client";

import React from "react";
import { AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface CheckoutErrorsProps {
  error: {
    code?: string;
    message?: string;
    details?: Record<string, string[]>;
  } | null;
  onDismiss: () => void;
}

const ERROR_GUIDANCE_MAP: Record<string, { title: string; guidance: string }> = {
  INSUFFICIENT_STOCK: {
    title: "Insufficient Inventory Stock",
    guidance: "One or more items in the cart exceed available on-hand stock. Please adjust quantities or remove out-of-stock items before retrying.",
  },
  PAYMENT_INCOMPLETE: {
    title: "Incomplete Payment",
    guidance: "The total payment tenders do not cover the full payable amount. Please add additional tenders to complete the balance.",
  },
  PAYMENT_EXCEEDS_PAYABLE_AMOUNT: {
    title: "Non-Cash Payment Exceeds Total",
    guidance: "Card, Bank Transfer, or Other non-cash payment methods cannot exceed the remaining balance. Overpayment is only permitted for Cash tenders.",
  },
  PAYMENT_REFERENCE_REQUIRED: {
    title: "Transaction Reference Required",
    guidance: "All non-cash payments (Card, Bank Transfer, Other) require an external transaction reference or terminal authorization number.",
  },
  PRODUCT_INACTIVE_SALE_BLOCKED: {
    title: "Inactive Product in Cart",
    guidance: "One or more products have been marked inactive and cannot be sold. Please remove them from the cart.",
  },
  PRODUCT_ARCHIVED_STOCK_FORBIDDEN: {
    title: "Archived Product in Cart",
    guidance: "One or more products have been archived. Please remove archived items from the cart.",
  },
  CUSTOMER_ARCHIVED: {
    title: "Customer Profile Archived",
    guidance: "The attached customer is archived and cannot be used for new sales. Please select an active customer or checkout as Walk-in Guest.",
  },
  IDEMPOTENCY_CONFLICT: {
    title: "Transaction Changed",
    guidance: "The sale parameters were modified during checkout submission. A fresh transaction key has been generated; please submit again.",
  },
  DISCOUNT_EXCEEDS_MAXIMUM: {
    title: "Discount Exceeds Maximum",
    guidance: "Line discount or order discount exceeds the permitted order value.",
  },
  STALE_VERSION_CONFLICT: {
    title: "Product Stock Updated",
    guidance: "Inventory was updated by another cashier or stock movement. Please review cart quantities and retry.",
  },
};

export function CheckoutErrors({ error, onDismiss }: CheckoutErrorsProps) {
  if (!error) return null;

  const errorMeta = error.code ? ERROR_GUIDANCE_MAP[error.code] : null;
  const title = errorMeta?.title || "Checkout Error";
  const guidance = errorMeta?.guidance || error.message || "An unexpected error occurred during checkout.";

  return (
    <div
      role="alert"
      data-testid="checkout-error-banner"
      className="bg-red-50 border border-red-200 text-red-900 rounded-xl p-4 shadow-sm relative animate-in fade-in-50 duration-200"
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
        <div className="flex-1 pr-6">
          <h4 className="font-semibold text-sm text-red-900">{title}</h4>
          <p className="text-sm text-red-700 mt-0.5 leading-relaxed">{guidance}</p>

          {/* Validation field details if present */}
          {error.details && Object.keys(error.details).length > 0 && (
            <ul className="mt-2 text-xs text-red-600 list-disc list-inside space-y-0.5">
              {Object.entries(error.details).map(([field, msgs]) =>
                msgs.map((m, idx) => (
                  <li key={`${field}-${idx}`}>
                    <span className="font-medium capitalize">{field}:</span> {m}
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          className="absolute top-2 right-2 h-7 w-7 p-0 text-red-400 hover:text-red-700 hover:bg-red-100"
          aria-label="Dismiss error"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
