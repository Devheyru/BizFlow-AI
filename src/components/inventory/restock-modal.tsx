"use client";

import React, { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import {
  PlusCircle,
  AlertCircle,
  CheckCircle2,
  Loader2,
  X,
  Package,
  ArrowRight,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { recordStockMovementAction } from "@/actions/inventory-actions";
import { stockMovementInputSchema } from "@/lib/validations/inventory";
import {
  formatStockQuantity,
  formatQuantityWithUom,
} from "@/lib/inventory/formatters";
import {
  savePendingRestock,
  loadPendingRestock,
  clearPendingRestock,
  type PendingRestockSession,
} from "@/lib/inventory/restock-storage";
import type { StockMutationResult } from "@/types/inventory";

export interface RestockModalProps {
  isOpen: boolean;
  onClose: () => void;
  slug: string;
  productId: string;
  productName: string;
  sku: string;
  currentStock: number;
  currentVersion: number;
  unitOfMeasure: string;
  isDiscrete: boolean;
  productStatus: "active" | "inactive" | "archived";
  canReceiveStock: boolean;
  /**
   * Movement mode: 'restock' for regular replenishments, 'initial' for recording opening stock (T025, US3).
   * Defaults to 'restock'.
   */
  mode?: "restock" | "initial";
  onRestockSuccess?: (result: StockMutationResult) => void;
}

export interface RestockFormData {
  quantity: number | string;
  reason: string;
  referenceId?: string;
}

/**
 * Restock Modal Component (T023, US2, FR-INV-005, FR-INV-006, SEC-INV-005).
 *
 * Implements:
 * - Inbound delivery / replenishment recording for catalog products.
 * - Enforces `inventory:receive` authorization.
 * - Client and server UOM integer enforcement for discrete products.
 * - Blocks on inactive (`PRODUCT_INACTIVE_RESTOCK_BLOCKED`) or archived (`PRODUCT_ARCHIVED_STOCK_FORBIDDEN`) products.
 * - Optimistic concurrency control via `expectedVersion`.
 * - In-modal and toast confirmation on successful balance update.
 */
export function RestockModal({
  isOpen,
  onClose,
  slug,
  productId,
  productName,
  sku,
  currentStock,
  currentVersion,
  unitOfMeasure,
  isDiscrete,
  productStatus,
  canReceiveStock,
  mode = "restock",
  onRestockSuccess,
}: RestockModalProps) {
  const isInitial = mode === "initial";
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<StockMutationResult | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());
  const [pendingRecovery, setPendingRecovery] = useState<PendingRestockSession | null>(null);
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<RestockFormData>({
    defaultValues: {
      quantity: "",
      reason: "",
      referenceId: "",
    },
    mode: "all",
  });

  // Check for in-flight unconfirmed submission or initialize clean state
  useEffect(() => {
    if (isOpen) {
      const pending = loadPendingRestock(slug, productId, mode);
      if (pending) {
        setIdempotencyKey(pending.idempotencyKey);
        setPendingRecovery(pending);
        reset({
          quantity: pending.quantity,
          reason: pending.reason,
          referenceId: pending.referenceId ?? "",
        });
      } else {
        setIdempotencyKey(crypto.randomUUID());
        setPendingRecovery(null);
        reset({
          quantity: "",
          reason: "",
          referenceId: "",
        });
      }
      setErrorMessage(null);
      setErrorCode(null);
      setSuccessResult(null);
    }
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, [isOpen, slug, productId, mode, reset]);

  // Allows discarding an unconfirmed session to start fresh with a new UUID
  const handleStartFresh = () => {
    clearPendingRestock(slug, productId, mode);
    setPendingRecovery(null);
    setIdempotencyKey(crypto.randomUUID());
    reset({
      quantity: "",
      reason: "",
      referenceId: "",
    });
    setErrorMessage(null);
    setErrorCode(null);
  };

  // Handle escape key navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !submitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, submitting, onClose]);

  if (!isOpen) return null;

  // Watch quantity for live projected balance calculation
  const watchedQuantity = watch("quantity");
  const parsedQty = parseFloat(String(watchedQuantity));
  const isValidNumber = !isNaN(parsedQty) && parsedQty > 0;
  const projectedStock = isValidNumber ? currentStock + parsedQty : currentStock;

  // Form submission handler
  const onSubmit = async (data: RestockFormData) => {
    setErrorMessage(null);
    setErrorCode(null);
    setSuccessResult(null);

    // 1. Permission guard
    if (!canReceiveStock) {
      setErrorMessage(
        isInitial
          ? "Unauthorized: You do not have permission to record opening stock."
          : "Unauthorized: You do not have permission to receive stock."
      );
      setErrorCode("FORBIDDEN");
      return;
    }

    // 2. Lifecycle pre-checks
    if (productStatus === "archived") {
      setErrorMessage(
        isInitial
          ? "Cannot record opening stock for archived products."
          : "Cannot receive stock for archived products. Stock operations are restricted to write-offs."
      );
      setErrorCode("PRODUCT_ARCHIVED_STOCK_FORBIDDEN");
      return;
    }

    if (productStatus === "inactive") {
      setErrorMessage(
        isInitial
          ? "Cannot record opening stock for inactive products. Product must be activated first."
          : "Cannot receive stock for inactive products. Product must be activated first."
      );
      setErrorCode("PRODUCT_INACTIVE_RESTOCK_BLOCKED");
      return;
    }

    // 3. Numeric conversion & UOM discrete enforcement
    const rawNum = typeof data.quantity === "string" ? parseFloat(data.quantity) : data.quantity;
    if (isNaN(rawNum) || rawNum <= 0) {
      setErrorMessage(
        isInitial
          ? "Opening stock quantity must be a positive number greater than zero."
          : "Restock quantity must be a positive number greater than zero."
      );
      setErrorCode("NON_POSITIVE_QUANTITY");
      return;
    }

    if (isDiscrete && !Number.isInteger(rawNum)) {
      setErrorMessage("Fractional quantities are not permitted for discrete products.");
      setErrorCode("INTEGER_QUANTITY_REQUIRED");
      return;
    }

    // 4. Stable Idempotency Key Preservation & Payload Alteration Detection
    let activeKey = idempotencyKey;
    if (pendingRecovery) {
      const isSamePayload =
        pendingRecovery.quantity === rawNum &&
        pendingRecovery.reason.trim() === data.reason.trim() &&
        (pendingRecovery.referenceId ?? "") === (data.referenceId?.trim() ?? "");
      if (!isSamePayload) {
        // User modified details — start fresh logical operation with new key
        activeKey = crypto.randomUUID();
        setIdempotencyKey(activeKey);
        setPendingRecovery(null);
      }
    }

    // Record in-flight submission to session storage to survive modal close / route navigation
    savePendingRestock({
      idempotencyKey: activeKey,
      slug,
      productId,
      quantity: rawNum,
      reason: data.reason.trim(),
      referenceId: data.referenceId?.trim() || null,
      expectedVersion: currentVersion,
      createdAt: Date.now(),
      mode,
    });

    // 5. Validate payload with canonical Zod schema
    const payload = {
      productId,
      movementType: isInitial ? ("initial" as const) : ("restock" as const),
      quantity: rawNum,
      quantitySemantics: "quantity_delta" as const,
      reason: data.reason.trim(),
      referenceId: data.referenceId?.trim() || null,
      expectedVersion: currentVersion,
      idempotencyKey: activeKey,
      isDiscrete,
    };

    const validation = stockMovementInputSchema.safeParse(payload);
    if (!validation.success) {
      const issue = validation.error.errors[0]?.message || "Validation failed";
      setErrorMessage(issue);
      setErrorCode("VALIDATION_ERROR");
      return;
    }

    // 6. Invoke Server Action
    setSubmitting(true);
    try {
      const res = await recordStockMovementAction(slug, payload);

      if (!res.success) {
        // Clear pending storage only for fatal authorization/lifecycle/singularity rejections
        if (
          res.error.code === "FORBIDDEN" ||
          res.error.code === "PRODUCT_ARCHIVED_STOCK_FORBIDDEN" ||
          res.error.code === "PRODUCT_INACTIVE_RESTOCK_BLOCKED" ||
          res.error.code === "INTEGER_QUANTITY_REQUIRED" ||
          res.error.code === "INITIAL_STOCK_ALREADY_RECORDED" ||
          res.error.code === "INITIAL_STOCK_ALREADY_ESTABLISHED" ||
          res.error.code === "INITIAL_STOCK_NOT_PERMITTED_HISTORY_EXISTS"
        ) {
          clearPendingRestock(slug, productId, mode);
          setPendingRecovery(null);
        }
        setErrorMessage(res.error.message);
        setErrorCode(res.error.code);
        return;
      }

      // Successful mutation: clear pending tracking
      clearPendingRestock(slug, productId, mode);
      setPendingRecovery(null);
      setSuccessResult(res.data);
      onRestockSuccess?.(res.data);

      // Auto-close modal after brief visual confirmation (with timer cleanup)
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
      closeTimerRef.current = setTimeout(() => {
        onClose();
      }, 1400);
    } catch (err: unknown) {
      // Network drop or unexpected client crash: keep pending session so user can safely retry on reopen
      const msg = err instanceof Error ? err.message : "An unexpected network error occurred.";
      setErrorMessage(msg);
      setErrorCode("UNEXPECTED_ERROR");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="restock-modal-title"
      data-testid="restock-modal"
    >
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl p-6 space-y-5">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                isInitial
                  ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400"
                  : "bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400"
              }`}
            >
              <PlusCircle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="restock-modal-title"
                className="text-lg font-semibold text-gray-900 dark:text-gray-100"
              >
                {isInitial ? "Opening Stock" : "Receive Stock"}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {isInitial
                  ? "Record initial baseline inventory to establish on-hand balance."
                  : "Record inbound inventory delivery to update on-hand balance."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1"
            aria-label="Close dialog"
            data-testid="restock-close-btn"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Product Snapshot Card */}
        <div className="rounded-lg bg-gray-50 dark:bg-gray-950/60 p-3.5 border border-gray-200 dark:border-gray-800 text-sm space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <Package className="h-4 w-4 text-gray-400 shrink-0" />
              <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                {productName}
              </span>
            </div>
            <span className="font-mono text-xs text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-800 px-2 py-0.5 rounded">
              {sku}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs pt-1 border-t border-gray-200 dark:border-gray-800/80">
            <span className="text-gray-500 dark:text-gray-400">
              Current Stock:{" "}
              <strong className="text-gray-900 dark:text-gray-100">
                {formatQuantityWithUom(currentStock, unitOfMeasure, isDiscrete)}
              </strong>
            </span>

            {isValidNumber && (
              <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                <span>Projected:</span>
                <ArrowRight className="h-3 w-3" />
                <strong>
                  {formatQuantityWithUom(projectedStock, unitOfMeasure, isDiscrete)}
                </strong>
                <span className="text-[10px] text-gray-400 dark:text-gray-500 font-normal ml-0.5">
                  (estimate)
                </span>
              </span>
            )}
          </div>
        </div>

        {/* Success Confirmation Banner */}
        {successResult && (
          <div
            className="flex items-start gap-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 p-4 text-xs text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 animate-in fade-in"
            data-testid="restock-success-banner"
          >
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-emerald-900 dark:text-emerald-200">
                {isInitial ? "Opening stock recorded successfully!" : "Stock received successfully!"}
              </p>
              <p className="mt-0.5">
                {isInitial
                  ? `Initial balance established at ${formatStockQuantity(successResult.quantityAfter, isDiscrete)} ${unitOfMeasure}.`
                  : `Added +${formatStockQuantity(successResult.quantityDelta, isDiscrete)} ${unitOfMeasure}. New balance is ${formatStockQuantity(successResult.quantityAfter, isDiscrete)} ${unitOfMeasure}.`}
              </p>
            </div>
          </div>
        )}

        {/* Pending Recovery Banner */}
        {pendingRecovery && !successResult && (
          <div
            className="flex items-start justify-between gap-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 p-3.5 text-xs text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800 animate-in fade-in"
            data-testid="restock-recovery-banner"
          >
            <div className="flex items-start gap-2">
              <RotateCcw className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">
                  {isInitial ? "Unconfirmed Opening Stock Recovered" : "Unconfirmed Restock Recovered"}
                </p>
                <p className="mt-0.5 text-amber-800 dark:text-amber-300">
                  {isInitial
                    ? `A previous opening stock of ${pendingRecovery.quantity} ${unitOfMeasure} was submitted but its confirmation was interrupted. Retrying with this form will safely check completion without duplicating stock.`
                    : `A previous restock of ${pendingRecovery.quantity} ${unitOfMeasure} was submitted but its confirmation was interrupted. Retrying with this form will safely check completion without duplicating stock.`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleStartFresh}
              className="text-amber-700 dark:text-amber-300 underline hover:no-underline font-medium text-xs whitespace-nowrap self-start ml-2"
              data-testid="restock-start-fresh-btn"
            >
              Start Fresh
            </button>
          </div>
        )}

        {/* Error Feedback Banner */}
        {errorMessage && (
          <div
            className="flex items-start gap-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 p-3.5 text-xs text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
            data-testid="restock-error-banner"
          >
            <AlertCircle className="h-4.5 w-4.5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              {errorCode && (
                <span className="font-mono font-semibold block uppercase">
                  {errorCode}
                </span>
              )}
              <span>{errorMessage}</span>
            </div>
          </div>
        )}

        {/* Restock / Opening Stock Form */}
        {!successResult && (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {/* Quantity Input */}
            <div>
              <label
                htmlFor="restock-quantity"
                className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1"
              >
                {isInitial ? `Opening Quantity (${unitOfMeasure})` : `Received Quantity (${unitOfMeasure})`}{" "}
                <span className="text-red-500">*</span>
              </label>
              <input
                id="restock-quantity"
                type="number"
                step={isDiscrete ? "1" : "0.0001"}
                min={isDiscrete ? "1" : "0.0001"}
                max="999999999.9999"
                placeholder={isDiscrete ? "e.g. 25" : "e.g. 12.5000"}
                autoFocus
                disabled={submitting}
                {...register("quantity", {
                  required: isInitial ? "Opening quantity is required" : "Received quantity is required",
                  validate: (val) => {
                    const num = typeof val === "string" ? parseFloat(val) : val;
                    if (isNaN(num) || num <= 0) {
                      return "Quantity must be greater than zero";
                    }
                    if (isDiscrete && !Number.isInteger(num)) {
                      return "Discrete products require whole integer quantities";
                    }
                    return true;
                  },
                })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                data-testid="restock-quantity-input"
              />
              {errors.quantity && (
                <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                  {errors.quantity.message}
                </p>
              )}
            </div>

            {/* Supplier / PO Reference */}
            <div>
              <label
                htmlFor="restock-reference"
                className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1"
              >
                {isInitial ? "Reference / Document" : "Supplier / PO Reference"}{" "}
                <span className="text-gray-400 font-normal normal-case">(optional)</span>
              </label>
              <input
                id="restock-reference"
                type="text"
                placeholder={isInitial ? "e.g. Audit Count Sheet, SETUP-001" : "e.g. PO-8812, INV-2026-004"}
                maxLength={100}
                disabled={submitting}
                {...register("referenceId", {
                  maxLength: {
                    value: 100,
                    message: "Reference ID cannot exceed 100 characters",
                  },
                })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                data-testid="restock-reference-input"
              />
              {errors.referenceId && (
                <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                  {errors.referenceId.message}
                </p>
              )}
            </div>

            {/* Reason / Notes */}
            <div>
              <label
                htmlFor="restock-reason"
                className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1"
              >
                Reason / Note <span className="text-red-500">*</span>
              </label>
              <textarea
                id="restock-reason"
                rows={3}
                placeholder={
                  isInitial
                    ? "e.g. Initial inventory count at store launch"
                    : "e.g. Weekly replenishment shipment from primary distributor"
                }
                disabled={submitting}
                {...register("reason", {
                  required: "Reason is required (min 3 characters)",
                  minLength: {
                    value: 3,
                    message: "Reason must be at least 3 characters",
                  },
                  maxLength: {
                    value: 500,
                    message: "Reason cannot exceed 500 characters",
                  },
                })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                data-testid="restock-reason-input"
              />
              {errors.reason && (
                <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                  {errors.reason.message}
                </p>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={submitting}
                data-testid="restock-cancel-btn"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className={
                  isInitial
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                    : "bg-blue-600 hover:bg-blue-700 text-white"
                }
                data-testid="restock-submit-btn"
              >
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {isInitial ? "Confirm Opening Stock" : "Confirm Restock"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
