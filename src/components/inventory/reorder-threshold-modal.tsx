"use client";

import React, { useState, useEffect, useRef, useId } from "react";
import { useForm } from "react-hook-form";
import {
  BellRing,
  AlertCircle,
  CheckCircle2,
  Loader2,
  X,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateInventoryThresholdsAction } from "@/actions/inventory-actions";
import { inventoryThresholdInputSchema } from "@/lib/validations/inventory";
import { formatStockQuantity, formatQuantityWithUom } from "@/lib/inventory/formatters";
import type { UpdateThresholdsResult } from "@/types/inventory";

export interface ReorderThresholdModalProps {
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
  currentReorderPoint?: number | null;
  currentReorderQuantity?: number | null;
  canAdjustStock: boolean;
  onThresholdsSuccess?: (result: UpdateThresholdsResult) => void;
}

export interface ReorderThresholdFormData {
  reorderPoint: string;
  reorderQuantity: string;
}

/**
 * Reorder Threshold Modal Component (T029, US4, US6, Phase 7)
 *
 * Implements:
 * - Reorder point and replenishment quantity configuration.
 * - Non-negative validation and maximum 4 decimal precision.
 * - Optimistic Concurrency Control (OCC) using expectedVersion.
 * - Surfaces STALE_VERSION_CONFLICT (P0027) on concurrent modifications.
 * - Enforces inventory:adjust authorization.
 */
export function ReorderThresholdModal({
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
  currentReorderPoint = null,
  currentReorderQuantity = null,
  canAdjustStock,
  onThresholdsSuccess,
}: ReorderThresholdModalProps) {
  const modalTitleId = useId();
  const modalDescId = useId();

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<UpdateThresholdsResult | null>(null);
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ReorderThresholdFormData>({
    defaultValues: {
      reorderPoint:
        currentReorderPoint !== null && currentReorderPoint !== undefined
          ? String(currentReorderPoint)
          : "",
      reorderQuantity:
        currentReorderQuantity !== null && currentReorderQuantity !== undefined
          ? String(currentReorderQuantity)
          : "",
    },
  });

  // Reset form when modal opens or initial values change
  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setErrorCode(null);
      setSuccessResult(null);
      reset({
        reorderPoint:
          currentReorderPoint !== null && currentReorderPoint !== undefined
            ? String(currentReorderPoint)
            : "",
        reorderQuantity:
          currentReorderQuantity !== null && currentReorderQuantity !== undefined
            ? String(currentReorderQuantity)
            : "",
      });
    } else {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    }
  }, [isOpen, currentReorderPoint, currentReorderQuantity, reset]);

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

  const onSubmit = async (data: ReorderThresholdFormData) => {
    setErrorMessage(null);
    setErrorCode(null);

    if (!canAdjustStock) {
      setErrorMessage("You do not have permission to configure inventory thresholds (requires inventory:adjust).");
      setErrorCode("FORBIDDEN");
      return;
    }

    const parsedReorderPoint =
      data.reorderPoint.trim() !== "" ? parseFloat(data.reorderPoint) : null;
    const parsedReorderQuantity =
      data.reorderQuantity.trim() !== "" ? parseFloat(data.reorderQuantity) : null;

    if (parsedReorderPoint !== null && (isNaN(parsedReorderPoint) || parsedReorderPoint < 0)) {
      setErrorMessage("Reorder point must be a valid non-negative number.");
      return;
    }

    if (
      parsedReorderQuantity !== null &&
      (isNaN(parsedReorderQuantity) || parsedReorderQuantity < 0)
    ) {
      setErrorMessage("Reorder quantity must be a valid non-negative number.");
      return;
    }

    if (isDiscrete) {
      if (parsedReorderPoint !== null && !Number.isInteger(parsedReorderPoint)) {
        setErrorMessage("Discrete products require whole integer threshold values.");
        return;
      }
      if (parsedReorderQuantity !== null && !Number.isInteger(parsedReorderQuantity)) {
        setErrorMessage("Discrete products require whole integer threshold values.");
        return;
      }
    }

    const payload = {
      productId,
      reorderPoint: parsedReorderPoint,
      reorderQuantity: parsedReorderQuantity,
      expectedVersion: currentVersion,
    };

    const clientValidation = inventoryThresholdInputSchema.safeParse(payload);
    if (!clientValidation.success) {
      const firstError =
        clientValidation.error.errors[0]?.message || "Validation failed.";
      setErrorMessage(firstError);
      return;
    }

    setSubmitting(true);

    try {
      const res = await updateInventoryThresholdsAction(slug, payload);

      if (!res.success) {
        setErrorCode(res.error?.code || "ERROR");
        setErrorMessage(
          res.error?.message || "Failed to update thresholds. Please try again."
        );
        setSubmitting(false);
        return;
      }

      setSuccessResult(res.data);
      onThresholdsSuccess?.(res.data);

      closeTimerRef.current = setTimeout(() => {
        onClose();
      }, 1200);
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
      data-testid="reorder-threshold-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in-0 duration-200"
    >
      <div className="relative w-full max-w-md bg-card rounded-xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <BellRing className="w-5 h-5" />
            </div>
            <div>
              <h2 id={modalTitleId} className="text-lg font-semibold text-foreground">
                Reorder Thresholds
              </h2>
              <p id={modalDescId} className="text-xs text-muted-foreground">
                Configure low-stock alert points and replenishment batch quantities
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="reorder-threshold-close-button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form wrapping inputs & footer buttons */}
        <form
          id="reorder-threshold-form"
          noValidate
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col flex-1 overflow-hidden"
        >
          {/* Content Body */}
          <div className="p-6 space-y-5 overflow-y-auto flex-1">
            {/* Permission warning */}
            {!canAdjustStock && (
              <div
                data-testid="reorder-threshold-permission-alert"
                className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-sm flex items-start gap-2.5"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Permission Required</p>
                  <p className="text-xs mt-0.5">
                    You need the <code className="font-semibold">inventory:adjust</code> permission to configure reorder thresholds.
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
                    <span>UOM: <strong className="text-foreground">{unitOfMeasure}</strong></span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 border-t text-sm">
                <div>
                  <span className="text-xs text-muted-foreground block">Current On-Hand</span>
                  <span className="font-mono font-bold text-foreground">
                    {formatQuantityWithUom(currentStock, unitOfMeasure)}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Record Version</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    v{currentVersion}
                  </span>
                </div>
              </div>
            </div>

            {/* Success Result View */}
            {successResult && (
              <div
                data-testid="reorder-threshold-success-alert"
                className="p-4 rounded-xl border bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300 flex items-start gap-3"
              >
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                <div className="space-y-1 text-sm">
                  <p className="font-semibold">Thresholds Updated!</p>
                  <p className="text-xs opacity-90">
                    Reorder Point:{" "}
                    <strong>
                      {successResult.reorderPoint !== null
                        ? `${formatStockQuantity(successResult.reorderPoint)} ${unitOfMeasure}`
                        : "None"}
                    </strong>{" "}
                    • Target Replenishment:{" "}
                    <strong>
                      {successResult.reorderQuantity !== null
                        ? `${formatStockQuantity(successResult.reorderQuantity)} ${unitOfMeasure}`
                        : "None"}
                    </strong>
                  </p>
                </div>
              </div>
            )}

            {/* Error Alert */}
            {errorMessage && (
              <div
                data-testid="reorder-threshold-error-alert"
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

            {/* Reorder Point Input */}
            <div className="space-y-1.5">
              <label
                htmlFor="reorderPoint"
                className="text-xs font-semibold text-foreground uppercase tracking-wider block"
              >
                Low Stock Alert Threshold (Reorder Point)
              </label>
              <div className="relative">
                <input
                  id="reorderPoint"
                  type="number"
                  step={isDiscrete ? "1" : "0.0001"}
                  min="0"
                  disabled={submitting || !canAdjustStock}
                  placeholder={isDiscrete ? "e.g. 10" : "e.g. 10.0000"}
                  data-testid="reorder-point-input"
                  {...register("reorderPoint", {
                    validate: {
                      nonNegative: (v) =>
                        v === "" || parseFloat(v) >= 0 || "Reorder point cannot be negative",
                      integerOnly: (v) =>
                        v === "" ||
                        !isDiscrete ||
                        Number.isInteger(parseFloat(v)) ||
                        "Discrete products require whole integer values",
                    },
                  })}
                  className="w-full h-10 px-3 py-2 rounded-lg border bg-background font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 disabled:bg-muted"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                When on-hand stock falls to or below this level, a Low Stock alert is triggered. Leave blank to disable.
              </p>
              {errors.reorderPoint && (
                <p className="text-xs text-destructive mt-1 font-medium">
                  {errors.reorderPoint.message}
                </p>
              )}
            </div>

            {/* Reorder Quantity Input */}
            <div className="space-y-1.5">
              <label
                htmlFor="reorderQuantity"
                className="text-xs font-semibold text-foreground uppercase tracking-wider block"
              >
                Suggested Replenishment Quantity
              </label>
              <div className="relative">
                <input
                  id="reorderQuantity"
                  type="number"
                  step={isDiscrete ? "1" : "0.0001"}
                  min="0"
                  disabled={submitting || !canAdjustStock}
                  placeholder={isDiscrete ? "e.g. 50" : "e.g. 50.0000"}
                  data-testid="reorder-quantity-input"
                  {...register("reorderQuantity", {
                    validate: {
                      nonNegative: (v) =>
                        v === "" || parseFloat(v) >= 0 || "Reorder quantity cannot be negative",
                      integerOnly: (v) =>
                        v === "" ||
                        !isDiscrete ||
                        Number.isInteger(parseFloat(v)) ||
                        "Discrete products require whole integer values",
                    },
                  })}
                  className="w-full h-10 px-3 py-2 rounded-lg border bg-background font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 disabled:bg-muted"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Default suggested batch quantity when ordering replenishment stock.
              </p>
              {errors.reorderQuantity && (
                <p className="text-xs text-destructive mt-1 font-medium">
                  {errors.reorderQuantity.message}
                </p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-muted/20 shrink-0">
            <Button
              type="button"
              variant="outline"
              data-testid="reorder-threshold-cancel-button"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              data-testid="reorder-threshold-submit-button"
              disabled={submitting || !canAdjustStock}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <BellRing className="w-4 h-4 mr-2" />
                  Save Thresholds
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
