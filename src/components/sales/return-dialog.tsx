"use client";

import React, { useState, useEffect, useId, useMemo } from "react";
import {
  RotateCcw,
  AlertCircle,
  Loader2,
  X,
  CreditCard,
  Banknote,
  Building2,
  HelpCircle,
  CheckCircle2,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { executeSaleReturnAction } from "@/actions/sales-actions";
import { formatCurrency } from "@/lib/inventory/formatters";
import {
  calculateReturnRefundPreview,
  type ReturnRefundLineInput,
} from "@/lib/sales/financial-calc";
import type {
  SaleDetail,
  SaleDetailHeader,
  SaleItemRecord,
  PaymentRecord,
  ReturnHistory,
  PaymentMethod,
  ReturnResult,
} from "@/types/sales";

export interface ReturnDialogProps {
  isOpen: boolean;
  onClose: () => void;
  slug: string;
  sale?: SaleDetailHeader;
  items?: SaleItemRecord[];
  payments?: PaymentRecord[];
  saleDetail?: SaleDetail;
  returnHistory?: ReturnHistory[];
  currency?: string;
  onSuccess?: (result: ReturnResult) => void;
}

interface ItemReturnState {
  selected: boolean;
  quantity: number;
  restockToInventory: boolean;
}

const DISCRETE_UOMS = new Set(["piece", "unit", "box", "pack", "pair", "set"]);
export function isDiscreteUom(uom?: string): boolean {
  if (!uom) return false;
  return DISCRETE_UOMS.has(uom.toLowerCase().trim());
}

export function ReturnDialog(props: ReturnDialogProps) {
  const {
    isOpen,
    onClose,
    slug,
    onSuccess,
  } = props;
  const sale = props.sale || props.saleDetail?.sale;
  const rawItems = props.items || props.saleDetail?.items;
  const items = useMemo(() => rawItems || [], [rawItems]);
  const rawPayments = props.payments || props.saleDetail?.payments;
  const payments = useMemo(() => rawPayments || [], [rawPayments]);
  const rawReturnHistory = props.returnHistory || props.saleDetail?.returns;
  const returnHistory = useMemo(() => rawReturnHistory || [], [rawReturnHistory]);
  const currency = props.currency || sale?.currency || "USD";

  const reasonId = useId();
  const refundMethodId = useId();
  const refNoId = useId();

  // State
  const [itemStates, setItemStates] = useState<Record<string, ItemReturnState>>({});
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>("cash");
  const [referenceNo, setReferenceNo] = useState("");
  const [reason, setReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<ReturnResult | null>(null);
  const autoCloseTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current);
      }
    };
  }, []);

  // Compute unreturned remaining quantity and prior refunds for each item
  const itemReturnStats = useMemo(() => {
    const stats: Record<
      string,
      {
        previouslyReturnedQty: number;
        previouslyRefundedAmount: number;
        remainingReturnableQty: number;
      }
    > = {};

    for (const item of items) {
      let prevQty = 0;
      let prevRefund = 0;

      for (const ret of returnHistory) {
        for (const retItem of ret.items || []) {
          if (retItem.saleItemId === item.id) {
            prevQty += Number(retItem.quantity);
            prevRefund += Number(retItem.refundAmount);
          }
        }
      }

      const remainingQty = Math.max(0, Number(item.quantity) - prevQty);
      stats[item.id] = {
        previouslyReturnedQty: prevQty,
        previouslyRefundedAmount: prevRefund,
        remainingReturnableQty: remainingQty,
      };
    }

    return stats;
  }, [items, returnHistory]);

  // Initialize or reset form state when dialog opens
  useEffect(() => {
    if (isOpen) {
      const initialStates: Record<string, ItemReturnState> = {};
      for (const item of items) {
        const stats = itemReturnStats[item.id];
        const remaining = stats ? stats.remainingReturnableQty : item.quantity;
        initialStates[item.id] = {
          selected: remaining > 0,
          quantity: remaining > 0 ? (remaining >= 1 ? 1 : remaining) : 0,
          restockToInventory: true,
        };
      }

      setItemStates(initialStates);
      setRefundMethod("cash");
      setReferenceNo("");
      setReason("");
      setErrorMessage(null);
      setValidationError(null);
      setSuccessResult(null);
      setIsSubmitting(false);

      if (typeof crypto !== "undefined" && crypto.randomUUID) {
        setIdempotencyKey(crypto.randomUUID());
      } else {
        setIdempotencyKey(
          "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          })
        );
      }
    }
  }, [isOpen, items, itemReturnStats]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  // Prior refund totals and tender breakdown for ceiling checks
  const priorRefundStats = useMemo(() => {
    let previouslyRefundedTotal = 0;
    const methodRefunds: Record<string, number> = {};

    for (const ret of returnHistory) {
      previouslyRefundedTotal += Number(ret.totalRefundAmount || 0);
    }

    const refundsList = props.saleDetail?.refunds || [];
    for (const ref of refundsList) {
      if (ref.status === "completed" || ref.status === "pending") {
        const m = ref.refundMethod || "cash";
        methodRefunds[m] = (methodRefunds[m] || 0) + Number(ref.amount || 0);
      }
    }

    const originalMethodTenders: Record<string, number> = {};
    for (const pay of payments) {
      originalMethodTenders[pay.paymentMethod] =
        (originalMethodTenders[pay.paymentMethod] || 0) + Number(pay.amount || 0);
    }

    return {
      previouslyRefundedTotal,
      methodRefunds,
      originalMethodTenders,
    };
  }, [returnHistory, props.saleDetail?.refunds, payments]);

  // Proportional refund calculation preview using authoritative decimal-safe utility
  const refundPreview = useMemo(() => {
    const previewInputs: ReturnRefundLineInput[] = [];

    for (const item of items) {
      const state = itemStates[item.id];
      const stats = itemReturnStats[item.id];
      if (!state || !state.selected || state.quantity <= 0 || !stats) continue;

      previewInputs.push({
        saleItemId: item.id,
        totalPrice: Number(item.totalPrice),
        soldQuantity: Number(item.quantity),
        remainingReturnableQty: stats.remainingReturnableQty,
        previouslyRefundedAmount: stats.previouslyRefundedAmount,
        returnQuantity: state.quantity,
      });
    }

    return calculateReturnRefundPreview({
      items: previewInputs,
      saleTotalAmount: Number(sale?.totalAmount || 0),
      previouslyRefundedTotal: priorRefundStats.previouslyRefundedTotal,
      refundMethod,
      originalMethodTenderAmount: priorRefundStats.originalMethodTenders[refundMethod] || 0,
      previouslyRefundedMethodAmount: priorRefundStats.methodRefunds[refundMethod] || 0,
      currency,
    });
  }, [
    items,
    itemStates,
    itemReturnStats,
    sale?.totalAmount,
    priorRefundStats,
    refundMethod,
    currency,
  ]);

  if (!isOpen || !sale) return null;

  const handleItemToggle = (itemId: string) => {
    setItemStates((prev) => {
      const current = prev[itemId];
      if (!current) return prev;
      return {
        ...prev,
        [itemId]: {
          ...current,
          selected: !current.selected,
        },
      };
    });
  };

  const handleQuantityChange = (itemId: string, val: string) => {
    const num = parseFloat(val);
    setItemStates((prev) => {
      const current = prev[itemId];
      if (!current) return prev;
      return {
        ...prev,
        [itemId]: {
          ...current,
          quantity: isNaN(num) ? 0 : num,
        },
      };
    });
  };

  const handleRestockToggle = (itemId: string) => {
    setItemStates((prev) => {
      const current = prev[itemId];
      if (!current) return prev;
      return {
        ...prev,
        [itemId]: {
          ...current,
          restockToInventory: !current.restockToInventory,
        },
      };
    });
  };

  const selectedCount = Object.values(itemStates).filter((s) => s.selected).length;
  const isReasonValid = reason.trim().length >= 3 && reason.trim().length <= 255;
  const isCeilingExceeded =
    refundPreview.isCumulativeCapped || refundPreview.isSplitTenderCapped;
  const isSubmitDisabled =
    isSubmitting ||
    selectedCount === 0 ||
    !isReasonValid ||
    isCeilingExceeded ||
    !refundPreview.isValid;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setValidationError(null);

    const cleanReason = reason.trim();
    if (cleanReason.length < 3) {
      setValidationError("Return reason must be at least 3 characters long.");
      return;
    }
    if (cleanReason.length > 255) {
      setValidationError("Return reason cannot exceed 255 characters.");
      return;
    }

    if (refundPreview.isCumulativeCapped) {
      setValidationError(
        `Total refund amount exceeds remaining payable amount for this sale (${formatCurrency(
          refundPreview.remainingCumulativePayable,
          currency
        )} remaining).`
      );
      return;
    }

    if (refundPreview.isSplitTenderCapped) {
      setValidationError(
        `Refund amount exceeds original ${refundMethod} tender amount (${formatCurrency(
          refundPreview.remainingMethodTender,
          currency
        )} available).`
      );
      return;
    }

    const returnItemsPayload: Array<{
      saleItemId: string;
      quantity: number;
      restockToInventory: boolean;
    }> = [];

    for (const item of items) {
      const state = itemStates[item.id];
      const stats = itemReturnStats[item.id];
      if (state && state.selected) {
        if (state.quantity <= 0) {
          setValidationError(`Quantity for "${item.productName}" must be greater than zero.`);
          return;
        }
        if (stats && state.quantity > stats.remainingReturnableQty) {
          setValidationError(
            `Quantity for "${item.productName}" exceeds remaining unreturned quantity (${stats.remainingReturnableQty}).`
          );
          return;
        }

        if (isDiscreteUom(item.unitOfMeasure) && !Number.isInteger(state.quantity)) {
          setValidationError(
            `Fractional quantities are not permitted for discrete product "${item.productName}".`
          );
          return;
        }

        returnItemsPayload.push({
          saleItemId: item.id,
          quantity: state.quantity,
          restockToInventory: state.restockToInventory,
        });
      }
    }

    if (returnItemsPayload.length === 0) {
      setValidationError("Please select at least one line item to return.");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await executeSaleReturnAction(slug, {
        saleId: sale.id,
        returnItems: returnItemsPayload,
        refundMethod,
        reason: cleanReason,
        idempotencyKey,
        referenceNo: referenceNo.trim() ? referenceNo.trim() : null,
      });

      if (!res.success) {
        setErrorMessage(res.error.message || "Failed to process return. Please try again.");
        setIsSubmitting(false);
        return;
      }

      setSuccessResult(res.data);
      if (onSuccess) {
        onSuccess(res.data);
      }

      // Auto close after brief confirmation
      autoCloseTimerRef.current = setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : "An unexpected error occurred while processing return."
      );
      setIsSubmitting(false);
    }
  };

  const renderPaymentIcon = (method: string) => {
    switch (method) {
      case "cash":
        return <Banknote className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />;
      case "card":
        return <CreditCard className="h-4 w-4 text-blue-600 dark:text-blue-400" />;
      case "bank_transfer":
        return <Building2 className="h-4 w-4 text-purple-600 dark:text-purple-400" />;
      default:
        return <HelpCircle className="h-4 w-4 text-gray-600 dark:text-gray-400" />;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="return-dialog-title"
      aria-describedby="return-dialog-description"
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-gray-900 shadow-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-100 dark:border-gray-800 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              <h2
                id="return-dialog-title"
                className="text-lg font-bold text-gray-900 dark:text-gray-100"
              >
                Process Return for {sale.saleNumber}
              </h2>
            </div>
            <p id="return-dialog-description" className="text-xs text-gray-500 dark:text-gray-400">
              Select line items, return quantities, restock disposition, and refund tender method.
            </p>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isSubmitting}
            className="h-8 w-8 p-0 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Success State Notification */}
        {successResult && (
          <div className="rounded-lg bg-green-50 p-4 border border-green-200 dark:bg-green-950/40 dark:border-green-800 text-green-800 dark:text-green-200 text-sm flex items-center gap-2.5">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
            <div>
              <p className="font-semibold">Return processed successfully!</p>
              <p className="text-xs opacity-90">
                Return #{successResult.returnNumber} recorded. Total refund:{" "}
                <span className="font-mono font-semibold">
                  {formatCurrency(successResult.totalRefundAmount, currency)}
                </span>
                . Refreshing records...
              </p>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div className="rounded-lg bg-red-50 p-3.5 border border-red-200 dark:bg-red-950/40 dark:border-red-800 text-red-800 dark:text-red-200 text-xs flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-semibold">Unable to process return:</span>
              <p>{errorMessage}</p>
            </div>
          </div>
        )}

        {!successResult && (
          <form noValidate onSubmit={handleSubmit} className="space-y-5">
            {/* Line Items Selection Table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                  Sale Line Items
                </label>
                <span className="text-xs text-gray-500">
                  {selectedCount} item{selectedCount === 1 ? "" : "s"} selected
                </span>
              </div>

              <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden divide-y divide-gray-100 dark:divide-gray-800 text-xs">
                {items.map((item) => {
                  const stats = itemReturnStats[item.id] || {
                    previouslyReturnedQty: 0,
                    previouslyRefundedAmount: 0,
                    remainingReturnableQty: Number(item.quantity),
                  };
                  const state = itemStates[item.id] || {
                    selected: false,
                    quantity: 1,
                    restockToInventory: true,
                  };
                  const isEligible = stats.remainingReturnableQty > 0;

                  return (
                    <div
                      key={item.id}
                      className={`p-3 transition-colors ${state.selected
                        ? "bg-purple-50/40 dark:bg-purple-950/20"
                        : isEligible
                          ? "bg-white dark:bg-gray-900"
                          : "bg-gray-50 dark:bg-gray-800/40 opacity-60"
                        }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          id={`item-checkbox-${item.id}`}
                          checked={state.selected}
                          disabled={!isEligible || isSubmitting}
                          onChange={() => handleItemToggle(item.id)}
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer disabled:cursor-not-allowed"
                        />

                        <div className="flex-1 space-y-1">
                          <div className="flex items-center justify-between">
                            <label
                              htmlFor={`item-checkbox-${item.id}`}
                              className="font-semibold text-gray-900 dark:text-gray-100 cursor-pointer"
                            >
                              {item.productName}
                            </label>
                            <span className="font-mono text-gray-700 dark:text-gray-300 font-medium">
                              {formatCurrency(item.totalPrice, currency)}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-500 text-[11px]">
                            <span>SKU: {item.sku}</span>
                            <span>Sold: {item.quantity}</span>
                            <span>Prev. Returned: {stats.previouslyReturnedQty}</span>
                            <span className="font-semibold text-purple-700 dark:text-purple-300">
                              Remaining: {stats.remainingReturnableQty} / {item.quantity}
                            </span>
                          </div>

                          {/* Selected item controls */}
                          {state.selected && isEligible && (
                            <div className="pt-2.5 mt-2 border-t border-purple-100 dark:border-purple-900/30 flex flex-wrap items-center gap-4">
                              <div className="flex items-center gap-2">
                                <label
                                  htmlFor={`item-qty-${item.id}`}
                                  className="text-[11px] font-medium text-gray-700 dark:text-gray-300"
                                >
                                  Return Qty:
                                </label>
                                <input
                                  type="number"
                                  id={`item-qty-${item.id}`}
                                  min="0.0001"
                                  max={stats.remainingReturnableQty}
                                  step="any"
                                  value={state.quantity}
                                  disabled={isSubmitting}
                                  onChange={(e) => handleQuantityChange(item.id, e.target.value)}
                                  className="w-20 px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-purple-500"
                                />
                              </div>

                              <label className="flex items-center gap-2 cursor-pointer text-[11px] text-gray-700 dark:text-gray-300">
                                <input
                                  type="checkbox"
                                  checked={state.restockToInventory}
                                  disabled={isSubmitting}
                                  onChange={() => handleRestockToggle(item.id)}
                                  className="h-3.5 w-3.5 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                />
                                <Package className="h-3.5 w-3.5 text-gray-500" />
                                <span>Restock to inventory</span>
                              </label>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Refund Tender Method Selection */}
            <div className="space-y-3 pt-2">
              <label
                htmlFor={refundMethodId}
                className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider block"
              >
                Refund Tender Method
              </label>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(["cash", "card", "bank_transfer", "other"] as PaymentMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setRefundMethod(m)}
                    disabled={isSubmitting}
                    className={`p-2.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-2 transition-colors ${refundMethod === m
                      ? "border-purple-600 bg-purple-50 text-purple-900 dark:bg-purple-950/40 dark:text-purple-200 dark:border-purple-500"
                      : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                      }`}
                  >
                    {renderPaymentIcon(m)}
                    <span className="capitalize">{m.replace("_", " ")}</span>
                  </button>
                ))}
              </div>

              {/* Original Payments Tender Reference Information */}
              <div className="rounded-lg bg-gray-50 dark:bg-gray-800/40 p-2.5 text-[11px] text-gray-500 space-y-1">
                <span className="font-semibold text-gray-700 dark:text-gray-300">
                  Original Payments Tendered:
                </span>
                <div className="flex flex-wrap gap-x-4">
                  {payments.map((p) => (
                    <span key={p.id} className="capitalize">
                      {p.paymentMethod}: {formatCurrency(p.amount, currency)}
                      {p.referenceNo ? ` (${p.referenceNo})` : ""}
                    </span>
                  ))}
                </div>
              </div>

              {/* Optional External Reference Number */}
              {refundMethod !== "cash" && (
                <div className="space-y-1">
                  <label
                    htmlFor={refNoId}
                    className="text-xs font-medium text-gray-700 dark:text-gray-300"
                  >
                    External Reversal Reference (Optional)
                  </label>
                  <input
                    type="text"
                    id={refNoId}
                    placeholder="e.g. REV-AUTH-12345 or Gateway trace ID"
                    value={referenceNo}
                    disabled={isSubmitting}
                    onChange={(e) => setReferenceNo(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <p className="text-[11px] text-gray-400">
                    Non-cash refunds remain pending until reconciled with payment processor.
                  </p>
                </div>
              )}
            </div>

            {/* Return Reason Input */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label
                  htmlFor={reasonId}
                  className="text-xs font-semibold text-gray-700 dark:text-gray-300"
                >
                  Reason for Return <span className="text-red-500">*</span>
                </label>
                <span
                  className={`text-[11px] font-mono ${reason.trim().length < 3 || reason.trim().length > 255
                    ? "text-red-500"
                    : "text-gray-400"
                    }`}
                >
                  {reason.trim().length}/255
                </span>
              </div>
              <textarea
                id={reasonId}
                rows={2}
                disabled={isSubmitting}
                placeholder="Enter customer return reason (3 to 255 characters)..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
              />
            </div>

            {/* Refund Financial Calculation Preview */}
            <div className="rounded-lg bg-purple-50 dark:bg-purple-950/30 p-3.5 border border-purple-200 dark:border-purple-900/50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-purple-900 dark:text-purple-200">
                  Calculated Refund Amount (Preview):
                </span>
                <span className="text-base font-bold font-mono text-purple-900 dark:text-purple-100">
                  {formatCurrency(refundPreview.total, currency)}
                </span>
              </div>

              {refundPreview.lineBreakdowns.length > 0 && (
                <div className="text-[11px] text-purple-800 dark:text-purple-300/80 space-y-0.5 pt-1 border-t border-purple-200/60 dark:border-purple-900/40">
                  {refundPreview.lineBreakdowns.map((lb) => {
                    const item = items.find((i) => i.id === lb.saleItemId);
                    return (
                      <div key={lb.saleItemId} className="flex justify-between">
                        <span>
                          {item?.productName} ({lb.quantity}x)
                          {lb.isResidual && " [final residual absorbed]"}
                        </span>
                        <span className="font-mono">{formatCurrency(lb.refundAmount, currency)}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {refundPreview.isCumulativeCapped && (
                <div className="rounded bg-red-100 dark:bg-red-950/60 p-2 text-[11px] text-red-800 dark:text-red-300 flex items-center gap-1.5 font-medium">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
                  <span>
                    Refund exceeds remaining sale balance (Max:{" "}
                    {formatCurrency(refundPreview.remainingCumulativePayable, currency)}).
                  </span>
                </div>
              )}

              {refundPreview.isSplitTenderCapped && (
                <div className="rounded bg-red-100 dark:bg-red-950/60 p-2 text-[11px] text-red-800 dark:text-red-300 flex items-center gap-1.5 font-medium">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
                  <span>
                    Refund exceeds original {refundMethod} payment (Max:{" "}
                    {formatCurrency(refundPreview.remainingMethodTender, currency)}).
                  </span>
                </div>
              )}
            </div>

            {/* Validation Error Banner */}
            {validationError && (
              <div className="rounded-lg bg-amber-50 p-3 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>{validationError}</span>
              </div>
            )}

            {/* Dialog Footer Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isSubmitting}
                className="text-xs"
              >
                Cancel
              </Button>

              <Button
                type="submit"
                disabled={isSubmitDisabled}
                className="bg-purple-600 hover:bg-purple-700 text-white text-xs gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Processing Return...</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Confirm Return ({formatCurrency(refundPreview.total, currency)})</span>
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
