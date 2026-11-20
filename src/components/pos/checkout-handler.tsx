"use client";

import { useState, useRef, useCallback } from "react";
import { executeSaleAction } from "@/actions/sales-actions";
import { computeCanonicalSalePayloadHash } from "@/lib/sales/canonical-hash";
import type { SaleResult } from "@/types/sales";
import type { ExecuteSaleInput } from "@/lib/validations/sales";
import type { ActionResult } from "@/types/auth";

export interface SubmitCheckoutParams {
  customerId?: string | null;
  items: Array<{
    productId: string;
    quantity: number;
    lineDiscountAmount: number;
    expectedVersion?: number | null;
  }>;
  payments: Array<{
    paymentMethod: "cash" | "card" | "bank_transfer" | "other";
    amount: number;
    amountTendered?: number | null;
    changeDue?: number | null;
    referenceNo?: string | null;
  }>;
  orderDiscountAmount: number;
  notes?: string | null;
}

export interface UsePosCheckoutOptions {
  slug: string;
  onSuccess?: (saleResult: SaleResult) => void;
  onError?: (error: { code: string; message: string }) => void;
}

export function usePosCheckout({ slug, onSuccess, onError }: UsePosCheckoutOptions) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastSaleResult, setLastSaleResult] = useState<SaleResult | null>(null);
  const [checkoutError, setCheckoutError] = useState<{
    code: string;
    message: string;
    details?: Record<string, string[]>;
  } | null>(null);

  // Idempotency tracking refs to support safe network retries and distinct transaction keys
  const activeIdempotencyKeyRef = useRef<string | null>(null);
  const lastPayloadHashRef = useRef<string | null>(null);
  const isSubmittingRef = useRef<boolean>(false);

  const clearError = useCallback(() => {
    setCheckoutError(null);
  }, []);

  const resetIdempotency = useCallback(() => {
    activeIdempotencyKeyRef.current = null;
    lastPayloadHashRef.current = null;
  }, []);

  const submitCheckout = useCallback(
    async (params: SubmitCheckoutParams): Promise<ActionResult<SaleResult>> => {
      // In-flight guard against rapid double-clicks
      if (isSubmittingRef.current) {
        return {
          success: false,
          error: {
            code: "TRANSACTION_IN_FLIGHT",
            message: "A checkout transaction is already in progress. Please wait.",
          },
        };
      }

      isSubmittingRef.current = true;
      setIsSubmitting(true);
      setCheckoutError(null);

      try {
        // 1. Calculate canonical payload hash before determining idempotency key
        const canonicalInput: ExecuteSaleInput = {
          customerId: params.customerId ?? null,
          items: params.items.map((it) => ({
            productId: it.productId,
            quantity: it.quantity,
            lineDiscountAmount: it.lineDiscountAmount,
            expectedVersion: it.expectedVersion ?? null,
          })),
          payments: params.payments.map((p) => ({
            paymentMethod: p.paymentMethod,
            amount: p.amount,
            amountTendered: p.amountTendered ?? null,
            changeDue: p.changeDue ?? null,
            referenceNo: p.referenceNo ?? null,
          })),
          orderDiscountAmount: params.orderDiscountAmount,
          idempotencyKey: "00000000-0000-0000-0000-000000000000", // placeholder for hash
          notes: params.notes ?? null,
        };

        const currentHash = await computeCanonicalSalePayloadHash(canonicalInput);

        // 2. Determine Idempotency Key:
        // If hash matches the previous attempt, reuse existing key for safe replay/retry.
        // If hash differs or no key exists, generate a fresh client UUID.
        let keyToUse = activeIdempotencyKeyRef.current;
        if (!keyToUse || lastPayloadHashRef.current !== currentHash) {
          keyToUse = crypto.randomUUID();
          activeIdempotencyKeyRef.current = keyToUse;
          lastPayloadHashRef.current = currentHash;
        }

        const executePayload = {
          ...params,
          idempotencyKey: keyToUse,
        };

        // 3. Invoke Server Action
        const res = await executeSaleAction(slug, executePayload);

        if (res.success && res.data) {
          setLastSaleResult(res.data);
          onSuccess?.(res.data);
          // On successful completed sale, reset idempotency state for next customer
          resetIdempotency();
          return res;
        }

        const err = !res.success
          ? res.error
          : {
              code: "CHECKOUT_FAILED",
              message: "Failed to process checkout transaction.",
            };

        setCheckoutError(err);
        onError?.(err);
        return res;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "An unexpected error occurred.";
        const errorObj = {
          code: "CLIENT_ERROR",
          message,
        };
        setCheckoutError(errorObj);
        onError?.(errorObj);
        return {
          success: false,
          error: errorObj,
        };
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [slug, onSuccess, onError, resetIdempotency]
  );

  return {
    isSubmitting,
    lastSaleResult,
    checkoutError,
    clearError,
    resetIdempotency,
    submitCheckout,
    activeIdempotencyKey: activeIdempotencyKeyRef.current,
  };
}
