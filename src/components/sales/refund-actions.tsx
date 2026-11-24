"use client";

import React, { useState, useEffect, useId, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Loader2,
  X,
  CreditCard,
  Banknote,
  Building2,
  HelpCircle,
  RefreshCw,
  Clock,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  confirmRefundAction,
  recordRefundFailureAction,
  issueReplacementRefundAction,
} from "@/actions/sales-actions";
import { formatCurrency } from "@/lib/inventory/formatters";
import type {
  RefundRecord,
  PaymentRecord,
  PaymentMethod,
  RefundStatus,
  RefundConfirmation,
  RefundFailureResult,
  ReplacementRefundResult,
} from "@/types/sales";

function getMethodIcon(method: PaymentMethod) {
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
}

function renderStatusBadge(status: RefundStatus) {
  switch (status) {
    case "completed":
      return (
        <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700 ring-1 ring-inset ring-green-600/20 dark:bg-green-950/40 dark:text-green-300">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Completed
        </span>
      );
    case "pending":
      return (
        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300">
          <Clock className="mr-1 h-3 w-3" />
          Pending Confirmation
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-600/20 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="mr-1 h-3 w-3" />
          Failed
        </span>
      );
    default:
      return <span>{status}</span>;
  }
}

// ============================================================================
// 1. Confirm Reimbursement Dialog
// ============================================================================
export interface ConfirmRefundDialogProps {
  isOpen: boolean;
  onClose: () => void;
  slug: string;
  refund: RefundRecord | null;
  currency?: string;
  onSuccess?: (result: RefundConfirmation) => void;
}

export function ConfirmRefundDialog({
  isOpen,
  onClose,
  slug,
  refund,
  currency = "USD",
  onSuccess,
}: ConfirmRefundDialogProps) {
  const refId = useId();
  const [externalReference, setExternalReference] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setExternalReference("");
      setErrorMessage(null);
      setValidationError(null);
      setIsSubmitting(false);
      if (typeof window !== "undefined" && window.crypto && window.crypto.randomUUID) {
        setIdempotencyKey(window.crypto.randomUUID());
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
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen || !refund) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setValidationError(null);

    const cleanRef = externalReference.trim();
    if (!cleanRef) {
      setValidationError("External reversal reference is required (P0059).");
      return;
    }
    if (cleanRef.length > 255) {
      setValidationError("External reference cannot exceed 255 characters.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await confirmRefundAction(slug, {
        refundId: refund.id,
        externalReference: cleanRef,
        idempotencyKey,
      });

      if (!res.success) {
        setErrorMessage(res.error?.message || "Failed to confirm refund reimbursement.");
        setIsSubmitting(false);
        return;
      }

      onSuccess?.(res.data);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-refund-title"
    >
      <div className="relative w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-800 dark:bg-gray-900">
        <button
          onClick={onClose}
          disabled={isSubmitting}
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          aria-label="Close dialog"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <div className="rounded-full bg-emerald-100 p-2 dark:bg-emerald-950/50">
            <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h2 id="confirm-refund-title" className="text-lg font-bold text-gray-900 dark:text-gray-100">
              Confirm Refund Reimbursement
            </h2>
            <p className="text-xs text-gray-500">Record external gateway reversal reference</p>
          </div>
        </div>

        <div className="mb-4 rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-800/50 space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-500">Refund Amount:</span>
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              {formatCurrency(refund.amount, currency)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Disbursement Method:</span>
            <span className="font-medium capitalize">{refund.refundMethod.replace("_", " ")}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Refund ID:</span>
            <span className="font-mono text-[11px] text-gray-600 dark:text-gray-400">
              {refund.id.slice(0, 13)}...
            </span>
          </div>
        </div>

        {errorMessage && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor={refId} className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              External Reversal Reference <span className="text-red-500">*</span>
            </label>
            <input
              id={refId}
              type="text"
              value={externalReference}
              onChange={(e) => {
                setExternalReference(e.target.value);
                setValidationError(null);
              }}
              disabled={isSubmitting}
              placeholder="e.g. REV-CARD-883912 or Gateway Ref #"
              className={`w-full rounded-md border px-3 py-2 text-xs text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100 ${
                validationError ? "border-red-500" : "border-gray-300 dark:border-gray-700"
              }`}
            />
            {validationError && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{validationError}</p>
            )}
            <p className="mt-1 text-[11px] text-gray-500">
              Required by audit policy to reconcile non-cash gateway reimbursements.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Confirming...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Confirm Reimbursement
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// 2. Record Refund Failure Dialog
// ============================================================================
export interface RecordRefundFailureDialogProps {
  isOpen: boolean;
  onClose: () => void;
  slug: string;
  refund: RefundRecord | null;
  currency?: string;
  onSuccess?: (result: RefundFailureResult) => void;
}

export function RecordRefundFailureDialog({
  isOpen,
  onClose,
  slug,
  refund,
  currency = "USD",
  onSuccess,
}: RecordRefundFailureDialogProps) {
  const reasonId = useId();
  const [failureReason, setFailureReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setFailureReason("");
      setErrorMessage(null);
      setValidationError(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen || !refund) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setValidationError(null);

    const cleanReason = failureReason.trim();
    if (!cleanReason || cleanReason.length < 3) {
      setValidationError("A failure reason is required (minimum 3 characters, P0053).");
      return;
    }
    if (cleanReason.length > 500) {
      setValidationError("Failure reason cannot exceed 500 characters.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await recordRefundFailureAction(slug, {
        refundId: refund.id,
        failureReason: cleanReason,
      });

      if (!res.success) {
        setErrorMessage(res.error?.message || "Failed to record refund failure.");
        setIsSubmitting(false);
        return;
      }

      onSuccess?.(res.data);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="record-failure-title"
    >
      <div className="relative w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-800 dark:bg-gray-900">
        <button
          onClick={onClose}
          disabled={isSubmitting}
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          aria-label="Close dialog"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <div className="rounded-full bg-red-100 p-2 dark:bg-red-950/50">
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h2 id="record-failure-title" className="text-lg font-bold text-gray-900 dark:text-gray-100">
              Record Reimbursement Failure
            </h2>
            <p className="text-xs text-gray-500">Mark gateway rejection or disbursement failure</p>
          </div>
        </div>

        <div className="mb-4 rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-800/50 space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-500">Failed Amount:</span>
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              {formatCurrency(refund.amount, currency)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Method:</span>
            <span className="font-medium capitalize">{refund.refundMethod.replace("_", " ")}</span>
          </div>
          <p className="text-[11px] text-amber-700 dark:text-amber-400 pt-1">
            Marking this refund as failed will release the obligation so an operator can issue a replacement reimbursement.
          </p>
        </div>

        {errorMessage && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor={reasonId} className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Failure Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              id={reasonId}
              rows={3}
              value={failureReason}
              onChange={(e) => {
                setFailureReason(e.target.value);
                setValidationError(null);
              }}
              disabled={isSubmitting}
              placeholder="e.g. Card expired, gateway timeout, or customer account closed"
              className={`w-full rounded-md border px-3 py-2 text-xs text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500 dark:bg-gray-800 dark:text-gray-100 ${
                validationError ? "border-red-500" : "border-gray-300 dark:border-gray-700"
              }`}
            />
            {validationError && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{validationError}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="gap-2 bg-red-600 hover:bg-red-700 text-white"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Recording...
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4" />
                  Record Failure
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// 3. Issue Replacement Refund Dialog
// ============================================================================
export interface IssueReplacementRefundDialogProps {
  isOpen: boolean;
  onClose: () => void;
  slug: string;
  refund: RefundRecord | null;
  payments: PaymentRecord[];
  currency?: string;
  onSuccess?: (result: ReplacementRefundResult) => void;
}

export function IssueReplacementRefundDialog({
  isOpen,
  onClose,
  slug,
  refund,
  payments,
  currency = "USD",
  onSuccess,
}: IssueReplacementRefundDialogProps) {
  const methodId = useId();
  const refId = useId();
  const notesId = useId();

  const [refundMethod, setRefundMethod] = useState<PaymentMethod>("cash");
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Compute available tender amounts for each payment method from original sale
  const tenderCeilings = useMemo(() => {
    const ceilings: Record<PaymentMethod, number> = {
      cash: Infinity, // Cash refund is always permissible
      card: 0,
      bank_transfer: 0,
      other: 0,
    };
    payments.forEach((p) => {
      ceilings[p.paymentMethod] = (ceilings[p.paymentMethod] === Infinity ? 0 : ceilings[p.paymentMethod]) + p.amount;
    });
    return ceilings;
  }, [payments]);

  useEffect(() => {
    if (isOpen) {
      setRefundMethod("cash");
      setReferenceNo("");
      setNotes("");
      setErrorMessage(null);
      setIsSubmitting(false);
      if (typeof window !== "undefined" && window.crypto && window.crypto.randomUUID) {
        setIdempotencyKey(window.crypto.randomUUID());
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
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen || !refund) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // If method is not cash, check if method tender was present
    if (refundMethod !== "cash" && tenderCeilings[refundMethod] <= 0) {
      setErrorMessage(
        `Original sale has no tender for ${refundMethod.replace("_", " ")}. Choose Cash or a tender used in the sale (P0061).`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await issueReplacementRefundAction(slug, {
        failedRefundId: refund.id,
        refundMethod,
        idempotencyKey,
        referenceNo: referenceNo.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      if (!res.success) {
        setErrorMessage(res.error?.message || "Failed to issue replacement refund.");
        setIsSubmitting(false);
        return;
      }

      onSuccess?.(res.data);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="replacement-refund-title"
    >
      <div className="relative w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-800 dark:bg-gray-900">
        <button
          onClick={onClose}
          disabled={isSubmitting}
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          aria-label="Close dialog"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <div className="rounded-full bg-blue-100 p-2 dark:bg-blue-950/50">
            <RefreshCw className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h2 id="replacement-refund-title" className="text-lg font-bold text-gray-900 dark:text-gray-100">
              Issue Replacement Reimbursement
            </h2>
            <p className="text-xs text-gray-500">Fulfill outstanding reimbursement obligation</p>
          </div>
        </div>

        <div className="mb-4 rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-800/50 space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-500">Reimbursement Amount:</span>
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              {formatCurrency(refund.amount, currency)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Failed Refund ID:</span>
            <span className="font-mono text-[11px] text-gray-600 dark:text-gray-400">
              {refund.id.slice(0, 13)}...
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Obligation ID:</span>
            <span className="font-mono text-[11px] text-gray-600 dark:text-gray-400">
              {refund.obligationRefundId.slice(0, 13)}...
            </span>
          </div>
        </div>

        {errorMessage && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor={methodId} className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Replacement Refund Method <span className="text-red-500">*</span>
            </label>
            <select
              id={methodId}
              value={refundMethod}
              onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}
              disabled={isSubmitting}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-xs text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="cash">Cash (Instant settlement)</option>
              <option
                value="card"
                disabled={tenderCeilings.card <= 0}
              >
                Card {tenderCeilings.card > 0 ? `(Tendered: ${formatCurrency(tenderCeilings.card, currency)})` : "(Not used in sale)"}
              </option>
              <option
                value="bank_transfer"
                disabled={tenderCeilings.bank_transfer <= 0}
              >
                Bank Transfer {tenderCeilings.bank_transfer > 0 ? `(Tendered: ${formatCurrency(tenderCeilings.bank_transfer, currency)})` : "(Not used in sale)"}
              </option>
              <option
                value="other"
                disabled={tenderCeilings.other <= 0}
              >
                Other {tenderCeilings.other > 0 ? `(Tendered: ${formatCurrency(tenderCeilings.other, currency)})` : "(Not used in sale)"}
              </option>
            </select>
            <p className="mt-1 text-[11px] text-gray-500">
              Cash replacements settle immediately as completed. Non-cash replacements create a pending refund requiring confirmation.
            </p>
          </div>

          <div>
            <label htmlFor={refId} className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Reference Number (Optional)
            </label>
            <input
              id={refId}
              type="text"
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
              disabled={isSubmitting}
              placeholder="e.g. Receipt or voucher reference"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>

          <div>
            <label htmlFor={notesId} className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Replacement Notes (Optional)
            </label>
            <textarea
              id={notesId}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isSubmitting}
              placeholder="Auditable reason for replacing failed disbursement..."
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Issuing...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Issue Replacement
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// 4. RefundActions Main Container Component
// ============================================================================
export interface RefundActionsProps {
  slug: string;
  saleId?: string;
  refunds: RefundRecord[];
  payments: PaymentRecord[];
  currency?: string;
  canConfirm?: boolean;
  canFail?: boolean;
  canReplace?: boolean;
  onSuccess?: () => void;
}

export function RefundActions({
  slug,
  refunds,
  payments,
  currency = "USD",
  canConfirm = false,
  canFail = false,
  canReplace = false,
  onSuccess,
}: RefundActionsProps) {
  const router = useRouter();
  const [selectedRefundForConfirm, setSelectedRefundForConfirm] = useState<RefundRecord | null>(null);
  const [selectedRefundForFailure, setSelectedRefundForFailure] = useState<RefundRecord | null>(null);
  const [selectedRefundForReplacement, setSelectedRefundForReplacement] = useState<RefundRecord | null>(null);

  const handleActionSuccess = () => {
    router.refresh();
    onSuccess?.();
  };

  if (!refunds || refunds.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
        No refund disbursements recorded for this sale.
      </div>
    );
  }

  // Determine which failed refunds have active replacements
  const activeObligations = new Set(
    refunds
      .filter((r) => r.status === "pending" || r.status === "completed")
      .map((r) => r.obligationRefundId)
  );

  return (
    <div className="space-y-3">
      {refunds.map((rf) => {
        const hasActiveAttempt = activeObligations.has(rf.obligationRefundId);
        const isFailed = rf.status === "failed";
        const isPending = rf.status === "pending";

        return (
          <div
            key={rf.id}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 text-xs shadow-sm"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                {getMethodIcon(rf.refundMethod)}
                <span className="font-semibold capitalize text-gray-900 dark:text-gray-100">
                  {rf.refundMethod.replace("_", " ")} Refund
                </span>
                {renderStatusBadge(rf.status)}
                {rf.replacesRefundId && (
                  <span className="inline-flex items-center rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                    Replacement
                  </span>
                )}
              </div>

              <div className="text-[11px] text-gray-500 space-x-2">
                <span>Amount: <strong className="text-gray-900 dark:text-gray-100">{formatCurrency(rf.amount, currency)}</strong></span>
                <span>•</span>
                <span>ID: <code className="font-mono">{rf.id.slice(0, 8)}</code></span>
                {rf.referenceNo && (
                  <>
                    <span>•</span>
                    <span>Ref: <code className="font-mono">{rf.referenceNo}</code></span>
                  </>
                )}
              </div>

              {isFailed && rf.failureReason && (
                <div className="mt-1 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:bg-red-950/30 dark:text-red-400">
                  <strong>Failure:</strong> {rf.failureReason}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 self-end sm:self-center">
              {isPending && canConfirm && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedRefundForConfirm(rf)}
                  className="h-8 gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Confirm
                </Button>
              )}

              {isPending && canFail && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedRefundForFailure(rf)}
                  className="h-8 gap-1 border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300"
                >
                  <AlertCircle className="h-3.5 w-3.5" />
                  Fail
                </Button>
              )}

              {isFailed && canReplace && !hasActiveAttempt && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedRefundForReplacement(rf)}
                  className="h-8 gap-1 border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Replace
                </Button>
              )}

              {isFailed && hasActiveAttempt && (
                <span className="text-[11px] italic text-gray-400">
                  Replacement already active
                </span>
              )}
            </div>
          </div>
        );
      })}

      {/* Confirm Reimbursement Modal */}
      <ConfirmRefundDialog
        isOpen={Boolean(selectedRefundForConfirm)}
        onClose={() => setSelectedRefundForConfirm(null)}
        slug={slug}
        refund={selectedRefundForConfirm}
        currency={currency}
        onSuccess={handleActionSuccess}
      />

      {/* Record Failure Modal */}
      <RecordRefundFailureDialog
        isOpen={Boolean(selectedRefundForFailure)}
        onClose={() => setSelectedRefundForFailure(null)}
        slug={slug}
        refund={selectedRefundForFailure}
        currency={currency}
        onSuccess={handleActionSuccess}
      />

      {/* Issue Replacement Modal */}
      <IssueReplacementRefundDialog
        isOpen={Boolean(selectedRefundForReplacement)}
        onClose={() => setSelectedRefundForReplacement(null)}
        slug={slug}
        refund={selectedRefundForReplacement}
        payments={payments}
        currency={currency}
        onSuccess={handleActionSuccess}
      />
    </div>
  );
}
