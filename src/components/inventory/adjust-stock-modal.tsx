"use client";

import React, { useState, useEffect, useRef, useId } from "react";
import { useForm } from "react-hook-form";
import {
  SlidersHorizontal,
  AlertCircle,
  CheckCircle2,
  Loader2,
  X,
  Package,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Trash2,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { recordStockMovementAction } from "@/actions/inventory-actions";
import { stockMovementInputSchema } from "@/lib/validations/inventory";
import {
  formatStockQuantity,
  formatQuantityWithUom,
} from "@/lib/inventory/formatters";
import {
  saveAdjustmentDraft,
  loadAdjustmentDraft,
  clearAdjustmentDraft,
} from "@/lib/inventory/adjustment-storage";
import type { StockMutationResult } from "@/types/inventory";

export type AdjustmentMovementType = "adjustment" | "damage" | "loss" | "internal_use";

export interface AdjustStockModalProps {
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
  onAdjustmentSuccess?: (result: StockMutationResult) => void;
}

export interface AdjustStockFormData {
  movementType: AdjustmentMovementType;
  adjustmentDirection: "increase" | "decrease";
  quantity: string;
  reason: string;
  referenceId?: string;
}

export function AdjustStockModal({
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
  onAdjustmentSuccess,
}: AdjustStockModalProps) {
  const modalTitleId = useId();
  const modalDescId = useId();

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<StockMutationResult | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const isInactive = productStatus === "inactive";
  const isArchived = productStatus === "archived";

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<AdjustStockFormData>({
    defaultValues: {
      movementType: "adjustment",
      adjustmentDirection: "decrease",
      quantity: "",
      reason: "",
      referenceId: "",
    },
  });

  const selectedMovementType = watch("movementType");
  const selectedDirection = watch("adjustmentDirection");
  const rawQuantity = watch("quantity");

  // Load draft from storage on modal open
  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setErrorCode(null);
      setSuccessResult(null);
      setIdempotencyKey(crypto.randomUUID());

      const draft = loadAdjustmentDraft(slug, productId);
      if (draft) {
        reset({
          movementType: draft.movementType,
          adjustmentDirection: draft.adjustmentDirection,
          quantity: draft.quantity,
          reason: draft.reason,
          referenceId: draft.referenceId || "",
        });
      } else {
        reset({
          movementType: "adjustment",
          adjustmentDirection: "decrease",
          quantity: "",
          reason: "",
          referenceId: "",
        });
      }
    } else {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    }
  }, [isOpen, slug, productId, reset]);

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

  // Auto-save draft on form changes
  useEffect(() => {
    if (isOpen && !successResult) {
      if (rawQuantity || watch("reason") || watch("referenceId")) {
        saveAdjustmentDraft(slug, productId, {
          productId,
          movementType: selectedMovementType,
          adjustmentDirection: selectedDirection,
          quantity: rawQuantity,
          reason: watch("reason"),
          referenceId: watch("referenceId"),
        });
      }
    }
  }, [isOpen, slug, productId, selectedMovementType, selectedDirection, rawQuantity, watch, successResult]);

  // Derived calculation
  const parsedMagnitude = parseFloat(rawQuantity);
  const isValidNumber = !isNaN(parsedMagnitude) && parsedMagnitude > 0;

  let calculatedDelta = 0;
  if (isValidNumber) {
    if (selectedMovementType === "adjustment") {
      calculatedDelta = selectedDirection === "increase" ? parsedMagnitude : -parsedMagnitude;
    } else {
      calculatedDelta = -parsedMagnitude;
    }
  }

  const resultingStock = currentStock + calculatedDelta;
  const isOverdraft = isValidNumber && resultingStock < 0;
  const isDiscreteError = isDiscrete && isValidNumber && !Number.isInteger(parsedMagnitude);
  const isInactiveInternalUseBlocked = isInactive && selectedMovementType === "internal_use";
  const isArchivedPositiveBlocked = isArchived && selectedMovementType === "adjustment" && selectedDirection === "increase";

  const onSubmit = async (formData: AdjustStockFormData) => {
    if (!canAdjustStock) {
      setErrorMessage("Unauthorized: You do not have permission to adjust stock.");
      return;
    }

    if (isInactiveInternalUseBlocked) {
      setErrorCode("PRODUCT_INACTIVE_INTERNAL_USE_BLOCKED");
      setErrorMessage("Internal use is prohibited on inactive products. Please reactivate the product first.");
      return;
    }

    if (isArchivedPositiveBlocked) {
      setErrorCode("PRODUCT_ARCHIVED_STOCK_FORBIDDEN");
      setErrorMessage("Archived products cannot receive positive stock additions.");
      return;
    }

    if (isOverdraft) {
      setErrorCode("INSUFFICIENT_STOCK");
      setErrorMessage("Requested deduction exceeds available stock balance.");
      return;
    }

    if (isDiscreteError) {
      setErrorMessage("This product requires whole integer quantities.");
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    setErrorCode(null);

    try {
      const payload = {
        productId,
        movementType: formData.movementType,
        quantity: calculatedDelta,
        reason: formData.reason.trim(),
        referenceId: formData.referenceId?.trim() || null,
        expectedVersion: currentVersion,
        idempotencyKey,
        quantitySemantics: "quantity_delta" as const,
        isDiscrete,
      };

      const validation = stockMovementInputSchema.safeParse(payload);
      if (!validation.success) {
        const issues = validation.error.flatten().fieldErrors;
        const msg = Object.values(issues).flat().join(". ") || "Invalid input data.";
        setErrorMessage(msg);
        setSubmitting(false);
        return;
      }

      const res = await recordStockMovementAction(slug, payload);

      if (!res.success) {
        setErrorCode(res.error.code);
        setErrorMessage(res.error.message);
        setSubmitting(false);
        return;
      }

      clearAdjustmentDraft(slug, productId);
      setSuccessResult(res.data);
      onAdjustmentSuccess?.(res.data);

      closeTimerRef.current = setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred.";
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby={modalTitleId}
      aria-describedby={modalDescId}
      data-testid="adjust-stock-modal"
    >
      <div className="relative w-full max-w-lg bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/50 rounded-lg text-indigo-600 dark:text-indigo-400">
              <SlidersHorizontal className="h-5 w-5" />
            </div>
            <div>
              <h2 id={modalTitleId} className="text-lg font-semibold text-gray-900 dark:text-white">
                Adjust Stock Balance
              </h2>
              <p id={modalDescId} className="text-xs text-gray-500 dark:text-gray-400">
                Record controlled adjustments, write-offs, or internal allocations
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form wrapping body and footer */}
        <form
          id="adjust-stock-form"
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col flex-1 overflow-hidden"
        >
          {/* Content */}
          <div className="p-6 overflow-y-auto space-y-5 flex-1">
            {/* Permission warning */}
            {!canAdjustStock && (
              <div
                data-testid="adjust-permission-alert"
                className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-200 text-xs flex items-start space-x-2"
              >
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong>Permission Required:</strong> You need the <code className="font-semibold">inventory:adjust</code> permission to adjust stock.
                </div>
              </div>
            )}

            {/* Product context card */}
            <div className="p-3.5 bg-gray-50 dark:bg-gray-800/60 rounded-lg border border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <div className="flex items-center space-x-3 min-w-0">
                <div className="p-2 bg-white dark:bg-gray-700 rounded-md shadow-xs border border-gray-200/60 dark:border-gray-700">
                  <Package className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {productName}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center space-x-2">
                    <span>SKU: <strong className="text-gray-900 dark:text-white">{sku}</strong></span>
                    <span>•</span>
                    <span>UOM: {unitOfMeasure}</span>
                    {isDiscrete && (
                      <span className="px-1.5 py-0.2 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded text-[10px] font-medium">
                        Discrete
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0 pl-3">
                <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">Current Stock</div>
                <div className="text-sm font-bold text-gray-900 dark:text-white">
                  {formatQuantityWithUom(currentStock, unitOfMeasure)}
                </div>
              </div>
            </div>

            {/* Success banner */}
            {successResult && (
              <div
                data-testid="adjust-success-alert"
                className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-emerald-800 dark:text-emerald-200 flex items-start space-x-3 animate-in fade-in"
              >
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <div className="font-semibold">Adjustment successfully recorded!</div>
                  <div className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                    Updated stock balance is now{" "}
                    <strong>{formatQuantityWithUom(successResult.quantityAfter, unitOfMeasure)}</strong>.
                  </div>
                </div>
              </div>
            )}

            {/* Error banner */}
            {errorMessage && (
              <div
                data-testid="adjust-error-alert"
                className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-200 flex items-start space-x-3 animate-in fade-in"
              >
                <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <div className="font-semibold">{errorCode || "Failed to record adjustment"}</div>
                  <div className="text-xs text-red-700 dark:text-red-300 mt-0.5">{errorMessage}</div>
                  {errorCode === "STALE_VERSION_CONFLICT" && (
                    <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                      Tip: The inventory row was modified concurrently. Please close this modal, refresh the page, and retry.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Inputs Section */}
            {!successResult && (
              <div className="space-y-4">
                {/* Movement Type Radio Grid */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-2">
                    Adjustment Type
                  </label>
                  <div className="grid grid-cols-2 gap-2.5">
                    <label
                      data-testid="movement-type-adjustment"
                      className={`flex items-start p-3 border rounded-lg cursor-pointer transition-all ${
                        selectedMovementType === "adjustment"
                          ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/30 dark:border-indigo-500"
                          : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      }`}
                    >
                      <input
                        type="radio"
                        value="adjustment"
                        {...register("movementType")}
                        className="sr-only"
                      />
                      <div className="flex items-center space-x-2">
                        <SlidersHorizontal className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                        <div>
                          <div className="text-xs font-medium text-gray-900 dark:text-white">Manual Delta</div>
                          <div className="text-[11px] text-gray-500">Arbitrary +/- correction</div>
                        </div>
                      </div>
                    </label>

                    <label
                      data-testid="movement-type-damage"
                      className={`flex items-start p-3 border rounded-lg cursor-pointer transition-all ${
                        selectedMovementType === "damage"
                          ? "border-red-600 bg-red-50/50 dark:bg-red-950/30 dark:border-red-500"
                          : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      }`}
                    >
                      <input
                        type="radio"
                        value="damage"
                        {...register("movementType")}
                        className="sr-only"
                      />
                      <div className="flex items-center space-x-2">
                        <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
                        <div>
                          <div className="text-xs font-medium text-gray-900 dark:text-white">Damage Write-off</div>
                          <div className="text-[11px] text-gray-500">Broken or spoiled</div>
                        </div>
                      </div>
                    </label>

                    <label
                      data-testid="movement-type-loss"
                      className={`flex items-start p-3 border rounded-lg cursor-pointer transition-all ${
                        selectedMovementType === "loss"
                          ? "border-amber-600 bg-amber-50/50 dark:bg-amber-950/30 dark:border-amber-500"
                          : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      }`}
                    >
                      <input
                        type="radio"
                        value="loss"
                        {...register("movementType")}
                        className="sr-only"
                      />
                      <div className="flex items-center space-x-2">
                        <TrendingDown className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        <div>
                          <div className="text-xs font-medium text-gray-900 dark:text-white">Loss / Shrinkage</div>
                          <div className="text-[11px] text-gray-500">Theft or unexplained</div>
                        </div>
                      </div>
                    </label>

                    <label
                      data-testid="movement-type-internal_use"
                      className={`flex items-start p-3 border rounded-lg cursor-pointer transition-all ${
                        selectedMovementType === "internal_use"
                          ? "border-blue-600 bg-blue-50/50 dark:bg-blue-950/30 dark:border-blue-500"
                          : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      }`}
                    >
                      <input
                        type="radio"
                        value="internal_use"
                        {...register("movementType")}
                        className="sr-only"
                      />
                      <div className="flex items-center space-x-2">
                        <Layers className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        <div>
                          <div className="text-xs font-medium text-gray-900 dark:text-white">Internal Store Use</div>
                          <div className="text-[11px] text-gray-500">Store display or demo</div>
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Policy alert for Inactive Products & Internal Use */}
                {isInactiveInternalUseBlocked && (
                  <div
                    data-testid="adjust-inactive-internal-use-alert"
                    className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-200 text-xs flex items-start space-x-2"
                  >
                    <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <strong>Policy Restriction (P0023):</strong> Internal use allocations are prohibited for inactive products. Reactivate this product in the catalog before logging internal use.
                    </div>
                  </div>
                )}

                {/* Policy alert for Archived Products & Positive Adjustments */}
                {isArchivedPositiveBlocked && (
                  <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-200 text-xs flex items-start space-x-2">
                    <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <strong>Policy Restriction (P0021):</strong> Positive stock additions cannot be made to archived products. Only write-offs are permitted.
                    </div>
                  </div>
                )}

                {/* Direction selector if Manual Adjustment */}
                {selectedMovementType === "adjustment" && (
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-2">
                      Adjustment Direction
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        data-testid="adjust-direction-increase"
                        onClick={() => setValue("adjustmentDirection", "increase")}
                        className={`flex items-center justify-center space-x-2 py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                          selectedDirection === "increase"
                            ? "border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        <TrendingUp className="h-4 w-4 text-emerald-600" />
                        <span>Increase (+)</span>
                      </button>
                      <button
                        type="button"
                        data-testid="adjust-direction-decrease"
                        onClick={() => setValue("adjustmentDirection", "decrease")}
                        className={`flex items-center justify-center space-x-2 py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                          selectedDirection === "decrease"
                            ? "border-red-600 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                            : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        <TrendingDown className="h-4 w-4 text-red-600" />
                        <span>Decrease (-)</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Quantity input */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label htmlFor="adjust-quantity" className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                      {selectedMovementType === "adjustment"
                        ? selectedDirection === "increase"
                          ? "Quantity to Add"
                          : "Quantity to Deduct"
                        : "Quantity to Deduct (Write-off)"}
                    </label>
                    <span className="text-xs text-gray-500 dark:text-gray-400">Unit: {unitOfMeasure}</span>
                  </div>
                  <div className="relative">
                    <input
                      id="adjust-quantity"
                      type="number"
                      step={isDiscrete ? "1" : "0.0001"}
                      placeholder={isDiscrete ? "e.g. 5" : "e.g. 2.5000"}
                      data-testid="adjust-quantity-input"
                      {...register("quantity", {
                        required: "Quantity is required",
                        validate: (val) => {
                          const num = parseFloat(String(val));
                          if (isNaN(num) || num <= 0) return "Quantity must be greater than zero";
                          if (isDiscrete && !Number.isInteger(num)) return "Discrete products require whole integer quantities";
                          return true;
                        },
                      })}
                      className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  {isDiscreteError && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                      Discrete products require whole integer quantities.
                    </p>
                  )}
                  {errors.quantity && !isDiscreteError && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.quantity.message}</p>
                  )}
                </div>

                {/* Live stock preview calculation */}
                {isValidNumber && (
                  <div
                    data-testid={isOverdraft ? "adjust-overdraft-alert" : undefined}
                    className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
                      isOverdraft
                        ? "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200"
                        : "bg-indigo-50/60 dark:bg-indigo-950/30 border-indigo-100 dark:border-indigo-900 text-indigo-900 dark:text-indigo-200"
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <span>{formatStockQuantity(currentStock)}</span>
                      <span className="font-bold">{calculatedDelta > 0 ? `+${formatStockQuantity(calculatedDelta)}` : formatStockQuantity(calculatedDelta)}</span>
                      <ArrowRight className="h-3.5 w-3.5 mx-1" />
                      <span className="font-semibold">Resulting: {formatQuantityWithUom(resultingStock, unitOfMeasure)}</span>
                    </div>
                    {isOverdraft && (
                      <span className="font-bold text-red-600 dark:text-red-400">
                        Cannot reduce below 0!
                      </span>
                    )}
                  </div>
                )}

                {/* Reason input */}
                <div>
                  <label htmlFor="adjust-reason" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Reason for Adjustment <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    id="adjust-reason"
                    rows={3}
                    placeholder="Provide a detailed explanation for audit compliance (minimum 3 characters)"
                    data-testid="adjust-reason-input"
                    {...register("reason", {
                      required: "Reason is required",
                      minLength: { value: 3, message: "Reason must be at least 3 characters" },
                      maxLength: { value: 500, message: "Reason cannot exceed 500 characters" },
                    })}
                    className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                  {errors.reason && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.reason.message}</p>
                  )}
                </div>

                {/* Reference ID input */}
                <div>
                  <label htmlFor="adjust-reference-id" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Reference Identifier (Optional)
                  </label>
                  <input
                    id="adjust-reference-id"
                    type="text"
                    placeholder="e.g. ADJ-2026-001, INCIDENT-892"
                    data-testid="adjust-reference-input"
                    {...register("referenceId", {
                      maxLength: { value: 100, message: "Reference ID cannot exceed 100 characters" },
                    })}
                    className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                  {errors.referenceId && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.referenceId.message}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3.5 bg-gray-50 dark:bg-gray-800/80 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end space-x-3 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={submitting}
            >
              {successResult ? "Close" : "Cancel"}
            </Button>
            {!successResult && (
              <Button
                type="submit"
                data-testid="adjust-submit-button"
                size="sm"
                disabled={
                  submitting ||
                  !canAdjustStock ||
                  isOverdraft ||
                  isDiscreteError ||
                  isInactiveInternalUseBlocked ||
                  isArchivedPositiveBlocked ||
                  !isValidNumber
                }
                className="bg-indigo-600 hover:bg-indigo-700 text-white min-w-28"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                    <span>Recording...</span>
                  </>
                ) : (
                  "Save Adjustment"
                )}
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
