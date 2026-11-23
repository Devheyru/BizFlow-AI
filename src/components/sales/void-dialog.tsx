"use client";

import React, { useState, useEffect, useId } from "react";
import {
  AlertTriangle,
  AlertCircle,
  Loader2,
  X,
  CreditCard,
  Banknote,
  Building2,
  HelpCircle,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { voidSaleAction } from "@/actions/sales-actions";
import { formatCurrency } from "@/lib/inventory/formatters";
import type { PaymentRecord, VoidResult } from "@/types/sales";

export interface VoidDialogProps {
  isOpen: boolean;
  onClose: () => void;
  slug: string;
  saleId: string;
  saleNumber: string;
  totalAmount: number;
  currency: string;
  payments: PaymentRecord[];
  onSuccess?: (result: VoidResult) => void;
}

export function VoidDialog({
  isOpen,
  onClose,
  slug,
  saleId,
  saleNumber,
  totalAmount,
  currency,
  payments,
  onSuccess,
}: VoidDialogProps) {
  const reasonId = useId();
  const [voidReason, setVoidReason] = useState("");
  const [reversalRefs, setReversalRefs] = useState<Record<string, string>>({});
  const [idempotencyKey, setIdempotencyKey] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<VoidResult | null>(null);

  // Initialize or reset form state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setVoidReason("");
      setReversalRefs({});
      setErrorMessage(null);
      setValidationError(null);
      setSuccessResult(null);
      setIsSubmitting(false);
      // Generate a single UUID for this void intent session
      if (typeof window !== "undefined" && window.crypto && window.crypto.randomUUID) {
        setIdempotencyKey(window.crypto.randomUUID());
      } else {
        // Fallback UUID v4
        setIdempotencyKey(
          "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
            const r = (Math.random() * 16) | 0;
            const v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          })
        );
      }
    }
  }, [isOpen]);

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

  if (!isOpen) return null;

  const nonCashPayments = payments.filter((p) => p.paymentMethod !== "cash");
  const hasNonCash = nonCashPayments.length > 0;

  const handleReferenceChange = (paymentId: string, val: string) => {
    setReversalRefs((prev) => ({
      ...prev,
      [paymentId]: val,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setValidationError(null);

    const cleanReason = voidReason.trim();
    if (cleanReason.length < 3) {
      setValidationError("Void reason must be at least 3 characters long.");
      return;
    }
    if (cleanReason.length > 500) {
      setValidationError("Void reason cannot exceed 500 characters.");
      return;
    }

    setIsSubmitting(true);

    try {
      // Build reversal references array for non-cash payments where reference is provided
      const reversalReferences: Array<{ paymentId: string; referenceNo: string }> = [];
      for (const [pmtId, ref] of Object.entries(reversalRefs)) {
        const trimmed = ref.trim();
        if (trimmed.length > 0) {
          reversalReferences.push({
            paymentId: pmtId,
            referenceNo: trimmed,
          });
        }
      }

      const res = await voidSaleAction(slug, {
        saleId,
        voidReason: cleanReason,
        idempotencyKey,
        reversalReferences: reversalReferences.length > 0 ? reversalReferences : undefined,
      });

      if (!res.success) {
        setErrorMessage(res.error.message || "Failed to void sale. Please try again.");
        setIsSubmitting(false);
        return;
      }

      setSuccessResult(res.data);
      if (onSuccess) {
        onSuccess(res.data);
      }

      // Auto close after brief confirmation
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : "An unexpected error occurred while voiding sale."
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
        return <HelpCircle className="h-4 w-4 text-gray-500" />;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="void-dialog-title"
      aria-describedby="void-dialog-description"
    >
      <div className="relative w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-900 border border-gray-200 dark:border-gray-800 space-y-5">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          aria-label="Close dialog"
          className="absolute right-4 top-4 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200 disabled:opacity-50 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Title & Warning Header */}
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-red-100 p-2.5 dark:bg-red-950/60 text-red-600 dark:text-red-400 shrink-0">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h2
              id="void-dialog-title"
              className="text-lg font-bold text-gray-900 dark:text-gray-100"
            >
              Void Sale {saleNumber}
            </h2>
            <p id="void-dialog-description" className="text-xs text-gray-500 dark:text-gray-400">
              Total Amount:{" "}
              <span className="font-semibold text-gray-800 dark:text-gray-200 font-mono">
                {formatCurrency(totalAmount, currency)}
              </span>
            </p>
          </div>
        </div>

        {/* Success State Notification */}
        {successResult && (
          <div className="rounded-lg bg-green-50 p-4 border border-green-200 dark:bg-green-950/40 dark:border-green-800 text-green-800 dark:text-green-200 text-sm flex items-center gap-2.5">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
            <div>
              <p className="font-semibold">Sale voided successfully!</p>
              <p className="text-xs opacity-90">
                Inventory has been restored. Updating records...
              </p>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div className="rounded-lg bg-red-50 p-3.5 border border-red-200 dark:bg-red-950/40 dark:border-red-800 text-red-800 dark:text-red-200 text-xs flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-semibold">Unable to void sale:</span>
              <p>{errorMessage}</p>
            </div>
          </div>
        )}

        {!successResult && (
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Warning Message */}
            <div className="rounded-lg bg-amber-50 p-3 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs leading-relaxed">
              <span className="font-semibold">Permanent Transaction Reversal:</span> All sold line
              items will be atomically returned to inventory with an immutable audit record.
              This operation cannot be undone.
            </div>

            {/* Original Payment Tenders & Reimbursement Status */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                Payment Tender Reimbursement Breakdown
              </label>

              <div className="divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/40 text-xs">
                {payments.map((p) => {
                  const isCash = p.paymentMethod === "cash";
                  return (
                    <div key={p.id} className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {renderPaymentIcon(p.paymentMethod)}
                          <span className="font-medium text-gray-900 dark:text-gray-100 capitalize">
                            {p.paymentMethod.replace("_", " ")}
                          </span>
                          {p.referenceNo && (
                            <span className="text-[11px] text-gray-500 font-mono">
                              ({p.referenceNo})
                            </span>
                          )}
                        </div>
                        <span className="font-semibold text-gray-900 dark:text-gray-100 font-mono">
                          {formatCurrency(p.amount, currency)}
                        </span>
                      </div>

                      {/* Reimbursement policy note */}
                      <div className="flex items-center justify-between text-[11px]">
                        {isCash ? (
                          <span className="inline-flex items-center rounded-sm bg-emerald-50 px-2 py-0.5 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300 font-medium">
                            Immediate Cash Refund (Settled at counter)
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-sm bg-amber-50 px-2 py-0.5 text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300 font-medium">
                            Pending External Reimbursement (F005-038)
                          </span>
                        )}
                      </div>

                      {/* Reversal Reference Input for Non-Cash */}
                      {!isCash && (
                        <div className="pt-1.5 space-y-1">
                          <label
                            htmlFor={`ref-${p.id}`}
                            className="text-[11px] font-medium text-gray-600 dark:text-gray-400"
                          >
                            Reversal Reference / Auth Code{" "}
                            <span className="text-gray-400 font-normal">(Optional)</span>
                          </label>
                          <input
                            id={`ref-${p.id}`}
                            type="text"
                            placeholder="e.g. REV-AUTH-12345"
                            value={reversalRefs[p.id] || ""}
                            onChange={(e) => handleReferenceChange(p.id, e.target.value)}
                            disabled={isSubmitting}
                            className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-hidden dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* External reimbursement rule clarification */}
              {hasNonCash && (
                <p className="text-[11px] text-gray-500 dark:text-gray-400 italic">
                  Note: Supplying an external reference code records audit trace information.
                  Per accounting policy F005-038, the reimbursement remains{" "}
                  <span className="font-semibold text-gray-700 dark:text-gray-300">pending</span>{" "}
                  until confirmed via the reimbursement settlement procedure.
                </p>
              )}
            </div>

            {/* Mandatory Void Reason */}
            <div className="space-y-1.5">
              <label
                htmlFor={reasonId}
                className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center justify-between"
              >
                <span>
                  Reason for Voiding <span className="text-red-500">*</span>
                </span>
                <span className="text-[11px] font-normal text-gray-400">
                  {voidReason.length}/500 chars (min 3)
                </span>
              </label>
              <textarea
                id={reasonId}
                rows={3}
                required
                disabled={isSubmitting}
                placeholder="Enter the business justification for voiding this sale (e.g. Customer walked away before tender completed)..."
                value={voidReason}
                onChange={(e) => {
                  setVoidReason(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                className={`w-full rounded-md border px-3 py-2 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-hidden dark:text-gray-100 dark:placeholder:text-gray-500 ${
                  validationError
                    ? "border-red-500 focus:border-red-500 bg-red-50/20 dark:bg-red-950/20"
                    : "border-gray-300 focus:border-gray-900 bg-white dark:border-gray-700 dark:bg-gray-800"
                }`}
              />
              {validationError && (
                <p className="text-[11px] text-red-600 dark:text-red-400 font-medium">
                  {validationError}
                </p>
              )}
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
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
                variant="destructive"
                disabled={isSubmitting || voidReason.trim().length < 3}
                className="text-xs gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Voiding Sale...
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Confirm Void
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
