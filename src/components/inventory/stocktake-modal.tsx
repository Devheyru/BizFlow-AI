"use client";

import React, { useState, useEffect, useRef, useId } from "react";
import { useForm } from "react-hook-form";
import {
  ClipboardCheck,
  AlertCircle,
  CheckCircle2,
  Loader2,
  X,
  Package,
  TrendingUp,
  TrendingDown,
  Equal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { recordStockMovementAction } from "@/actions/inventory-actions";
import { stockMovementInputSchema } from "@/lib/validations/inventory";
import {
  formatStockQuantity,
  formatQuantityWithUom,
} from "@/lib/inventory/formatters";
import type { StockMutationResult } from "@/types/inventory";

export interface StocktakeModalProps {
  isOpen: boolean;
  onClose: () => void;
  slug: string;
  productId: string;
  productName: string;
  sku: string;
  currentStock: number;
  currentVersion: number;
  unitOfMeasure: string;
  isDiscrete?: boolean;
  productStatus?: string;
  canAdjustStock: boolean;
  onStocktakeSuccess?: (result: StockMutationResult) => void;
}

export interface StocktakeFormData {
  physicalCount: string;
  reason: string;
  referenceId?: string;
}

/**
 * Stocktake Modal Component (T027, US4, Phase 7)
 *
 * Implements:
 * - Physical count input with live variance preview (variance = physicalCount - currentStock).
 * - Semantics: movement_type = 'adjustment', quantity_semantics = 'target_physical_count'.
 * - Discrete UOM integer enforcement and maximum 4 decimal precision.
 * - Handles both zero-delta ('matched') and adjustment ('committed') responses.
 * - Surfaces STALE_VERSION_CONFLICT, INSUFFICIENT_STOCK, and PRODUCT_ARCHIVED_STOCK_FORBIDDEN.
 * - Enforces inventory:adjust permission gating.
 */
export function StocktakeModal({
  isOpen,
  onClose,
  slug,
  productId,
  productName,
  sku,
  currentStock,
  currentVersion,
  unitOfMeasure,
  isDiscrete = false,
  productStatus = "active",
  canAdjustStock,
  onStocktakeSuccess,
}: StocktakeModalProps) {
  const modalTitleId = useId();
  const modalDescId = useId();

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<StockMutationResult | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const isArchived = productStatus === "archived";

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<StocktakeFormData>({
    defaultValues: {
      physicalCount: "",
      reason: "Cycle count physical inventory reconciliation",
      referenceId: "",
    },
  });

  const rawPhysicalCount = watch("physicalCount");
  const parsedPhysicalCount =
    rawPhysicalCount !== "" && !isNaN(Number(rawPhysicalCount))
      ? Number(rawPhysicalCount)
      : null;

  // Live variance calculation: variance = physicalCount - currentStock
  const variance =
    parsedPhysicalCount !== null ? parsedPhysicalCount - currentStock : null;

  // Discrete precision validation check
  const isFractionalOnDiscrete =
    isDiscrete && parsedPhysicalCount !== null && !Number.isInteger(parsedPhysicalCount);

  // Negative count check
  const isNegativeCount = parsedPhysicalCount !== null && parsedPhysicalCount < 0;

  // Reset modal state when opened/closed
  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setErrorCode(null);
      setSuccessResult(null);
      setIdempotencyKey(crypto.randomUUID());
      reset({
        physicalCount: "",
        reason: "Cycle count physical inventory reconciliation",
        referenceId: "",
      });
    } else {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    }
  }, [isOpen, reset]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !submitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, submitting, onClose]);

  if (!isOpen) {
    return null;
  }

  const onSubmit = async (data: StocktakeFormData) => {
    setErrorMessage(null);
    setErrorCode(null);

    if (!canAdjustStock) {
      setErrorMessage("You do not have permission to adjust inventory (requires inventory:adjust).");
      setErrorCode("FORBIDDEN");
      return;
    }

    if (isArchived) {
      setErrorMessage("Stock operations on archived products are restricted.");
      setErrorCode("PRODUCT_ARCHIVED_STOCK_FORBIDDEN");
      return;
    }

    const countNum = parseFloat(data.physicalCount);
    if (isNaN(countNum) || countNum < 0) {
      setErrorMessage("Please enter a valid non-negative physical count.");
      return;
    }

    if (isDiscrete && !Number.isInteger(countNum)) {
      setErrorMessage("Discrete products require whole integer quantities.");
      return;
    }

    // Client-side schema pre-validation
    const clientValidation = stockMovementInputSchema.safeParse({
      productId,
      movementType: "adjustment",
      quantity: countNum,
      quantitySemantics: "target_physical_count",
      reason: data.reason.trim(),
      referenceId: data.referenceId?.trim() || null,
      idempotencyKey,
      expectedVersion: currentVersion,
      isDiscrete,
    });

    if (!clientValidation.success) {
      const firstError =
        clientValidation.error.errors[0]?.message || "Validation failed.";
      setErrorMessage(firstError);
      return;
    }

    setSubmitting(true);

    try {
      const res = await recordStockMovementAction(slug, {
        productId,
        movementType: "adjustment",
        quantity: countNum,
        quantitySemantics: "target_physical_count",
        reason: data.reason.trim(),
        referenceId: data.referenceId?.trim() || null,
        idempotencyKey,
        expectedVersion: currentVersion,
        isDiscrete,
      });

      if (!res.success) {
        setErrorCode(res.error?.code || "ERROR");
        setErrorMessage(
          res.error?.message || "Failed to record stocktake. Please try again."
        );
        setSubmitting(false);
        return;
      }

      setSuccessResult(res.data);
      onStocktakeSuccess?.(res.data);

      // Auto-close modal after brief delay
      closeTimerRef.current = setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred.";
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={modalTitleId}
      aria-describedby={modalDescId}
      data-testid="stocktake-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in-0 duration-200"
    >
      <div className="relative w-full max-w-lg bg-card rounded-xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <ClipboardCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 id={modalTitleId} className="text-lg font-semibold text-foreground">
                Stocktake / Physical Count
              </h2>
              <p id={modalDescId} className="text-xs text-muted-foreground">
                Reconcile physical on-hand stock with the system inventory ledger
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="stocktake-close-button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form wrapping body & footer */}
        <form
          id="stocktake-form"
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col flex-1 overflow-hidden"
        >
          {/* Content Body */}
          <div className="p-6 space-y-5 overflow-y-auto flex-1">
            {/* Permission warning */}
            {!canAdjustStock && (
              <div
                data-testid="stocktake-permission-alert"
                className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-sm flex items-start gap-2.5"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Permission Required</p>
                  <p className="text-xs mt-0.5">
                    You need the <code className="font-semibold">inventory:adjust</code> permission to perform stocktakes.
                  </p>
                </div>
              </div>
            )}

            {/* Archived warning */}
            {isArchived && (
              <div
                data-testid="stocktake-archived-alert"
                className="p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-sm flex items-start gap-2.5"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Product Archived</p>
                  <p className="text-xs mt-0.5">
                    Archived products have frozen inventory and cannot undergo stocktake adjustments.
                  </p>
                </div>
              </div>
            )}

            {/* Product Snapshot Card */}
            <div className="p-4 rounded-xl border bg-muted/20 space-y-3">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-muted-foreground" />
                    <span className="font-semibold text-foreground text-sm">
                      {productName}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>SKU: <strong className="text-foreground">{sku}</strong></span>
                    <span>•</span>
                    <span>UOM: <strong className="text-foreground">{unitOfMeasure}</strong> {isDiscrete && <span className="text-xs text-muted-foreground">(Discrete)</span>}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 border-t text-sm">
                <div>
                  <span className="text-xs text-muted-foreground block">System Current Stock</span>
                  <span className="font-mono font-bold text-base text-foreground">
                    {formatQuantityWithUom(currentStock, unitOfMeasure)}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Current Version</span>
                  <span className="font-mono text-sm text-muted-foreground">
                    v{currentVersion}
                  </span>
                </div>
              </div>
            </div>

            {/* Success Result View */}
            {successResult && (
              <div
                data-testid={
                  successResult.status === "matched"
                    ? "stocktake-success-matched"
                    : "stocktake-success-committed"
                }
                className={`p-4 rounded-xl border flex items-start gap-3 ${
                  successResult.status === "matched"
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
                    : "bg-blue-500/10 border-blue-500/30 text-blue-800 dark:text-blue-300"
                }`}
              >
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                <div className="space-y-1 text-sm">
                  <p className="font-semibold">
                    {successResult.status === "matched"
                      ? "Stock Count Verified & Matched!"
                      : "Stocktake Adjustment Committed!"}
                  </p>
                  <p className="text-xs opacity-90">
                    {successResult.status === "matched"
                      ? `Physical count matches system balance (${formatQuantityWithUom(
                          successResult.matchedQuantity ?? currentStock,
                          unitOfMeasure
                        )}). Zero delta logged.`
                      : `Adjusted by ${formatStockQuantity(
                          successResult.quantityDelta
                        )} ${unitOfMeasure}. New Balance: ${formatQuantityWithUom(
                          successResult.quantityAfter,
                          unitOfMeasure
                        )}.`}
                  </p>
                </div>
              </div>
            )}

            {/* Error Alert */}
            {errorMessage && (
              <div
                data-testid="stocktake-error-alert"
                className="p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-sm flex items-start gap-2.5"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="space-y-0.5">
                  {errorCode && (
                    <p className="font-mono text-xs font-semibold uppercase">{errorCode}</p>
                  )}
                  <p className="text-xs">{errorMessage}</p>
                </div>
              </div>
            )}

            {/* Physical Count Input */}
            <div className="space-y-1.5">
              <label
                htmlFor="physicalCount"
                className="text-xs font-semibold text-foreground uppercase tracking-wider block"
              >
                Actual Physical Count ({unitOfMeasure}) <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <input
                  id="physicalCount"
                  type="number"
                  step={isDiscrete ? "1" : "0.0001"}
                  min="0"
                  disabled={submitting || !canAdjustStock || isArchived}
                  placeholder={isDiscrete ? "0" : "0.0000"}
                  data-testid="stocktake-physical-count-input"
                  {...register("physicalCount", {
                    required: "Physical count is required",
                    validate: {
                      nonNegative: (v) =>
                        parseFloat(v) >= 0 || "Physical count cannot be negative",
                      integerOnly: (v) =>
                        !isDiscrete ||
                        Number.isInteger(parseFloat(v)) ||
                        "Discrete products require whole integer quantities",
                    },
                  })}
                  className="w-full h-11 px-3 py-2 rounded-lg border bg-background font-mono text-base focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 disabled:bg-muted"
                />
              </div>
              {errors.physicalCount && (
                <p className="text-xs text-destructive mt-1 font-medium">
                  {errors.physicalCount.message}
                </p>
              )}
              {isFractionalOnDiscrete && !errors.physicalCount && (
                <p className="text-xs text-destructive mt-1 font-medium">
                  Discrete products require whole integer quantities.
                </p>
              )}
              {isNegativeCount && !errors.physicalCount && (
                <p className="text-xs text-destructive mt-1 font-medium">
                  Physical count cannot be negative.
                </p>
              )}
            </div>

            {/* Live Variance Calculation Display */}
            {variance !== null && !isNaN(variance) && (
              <div
                data-testid="stocktake-variance-display"
                className={`p-3 rounded-lg border flex items-center justify-between text-sm ${
                  variance === 0
                    ? "bg-muted/40 border-muted-foreground/20 text-muted-foreground"
                    : variance > 0
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
                    : "bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300"
                }`}
              >
                <div className="flex items-center gap-2">
                  {variance === 0 && <Equal className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
                  {variance > 0 && <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
                  {variance < 0 && <TrendingDown className="w-4 h-4 text-amber-600 dark:text-amber-400" />}
                  <span className="font-medium text-xs">
                    {variance === 0
                      ? "Zero Discrepancy (Match)"
                      : variance > 0
                      ? "Surplus Detected (Increase)"
                      : "Shortage Detected (Decrease)"}
                  </span>
                </div>
                <div className="font-mono font-bold">
                  {variance > 0 ? `+${formatStockQuantity(variance)}` : formatStockQuantity(variance)}{" "}
                  {unitOfMeasure}
                </div>
              </div>
            )}

            {/* Reason Field */}
            <div className="space-y-1.5">
              <label
                htmlFor="reason"
                className="text-xs font-semibold text-foreground uppercase tracking-wider block"
              >
                Stocktake Reason / Notes <span className="text-destructive">*</span>
              </label>
              <textarea
                id="reason"
                rows={2}
                disabled={submitting || !canAdjustStock || isArchived}
                placeholder="e.g. End of month physical inventory cycle count"
                data-testid="stocktake-reason-input"
                {...register("reason", {
                  required: "Reason is required (min 3 chars)",
                  minLength: { value: 3, message: "Reason must be at least 3 characters" },
                  maxLength: { value: 500, message: "Reason cannot exceed 500 characters" },
                })}
                className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 disabled:bg-muted resize-none"
              />
              {errors.reason && (
                <p className="text-xs text-destructive mt-1 font-medium">
                  {errors.reason.message}
                </p>
              )}
            </div>

            {/* Reference ID (Optional) */}
            <div className="space-y-1.5">
              <label
                htmlFor="referenceId"
                className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block"
              >
                Audit / Sheet Reference <span className="text-xs font-normal lowercase">(optional)</span>
              </label>
              <input
                id="referenceId"
                type="text"
                disabled={submitting || !canAdjustStock || isArchived}
                placeholder="e.g. COUNT-SHEET-2026-11-A"
                data-testid="stocktake-reference-input"
                {...register("referenceId", {
                  maxLength: { value: 100, message: "Reference ID cannot exceed 100 characters" },
                })}
                className="w-full h-9 px-3 py-1.5 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 disabled:bg-muted"
              />
              {errors.referenceId && (
                <p className="text-xs text-destructive mt-1 font-medium">
                  {errors.referenceId.message}
                </p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-muted/20 shrink-0">
            <Button
              type="button"
              variant="outline"
              data-testid="stocktake-cancel-button"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              data-testid="stocktake-submit-button"
              disabled={
                submitting ||
                !canAdjustStock ||
                isArchived ||
                parsedPhysicalCount === null ||
                isNegativeCount ||
                Boolean(isFractionalOnDiscrete)
              }
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Recording Count...
                </>
              ) : (
                <>
                  <ClipboardCheck className="w-4 h-4 mr-2" />
                  Record Stocktake
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
