"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  CreditCard,
  Banknote,
  Building,
  Layers,
  Trash2,
  Plus,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PaymentMethod } from "@/types/sales";

export interface TenderItem {
  id: string;
  paymentMethod: PaymentMethod;
  amount: number;
  amountTendered: number | null;
  changeDue: number | null;
  referenceNo: string | null;
}

export interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  currency: string;
  totalPayable: number;
  onConfirmPayments: (tenders: TenderItem[]) => void;
  isSubmitting?: boolean;
}

const PAYMENT_METHOD_CONFIG: Record<
  PaymentMethod,
  { label: string; icon: React.ElementType; color: string }
> = {
  cash: { label: "Cash", icon: Banknote, color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  card: { label: "Card", icon: CreditCard, color: "text-blue-600 bg-blue-50 border-blue-200" },
  bank_transfer: { label: "Bank Transfer", icon: Building, color: "text-purple-600 bg-purple-50 border-purple-200" },
  other: { label: "Other", icon: Layers, color: "text-amber-600 bg-amber-50 border-amber-200" },
};

export function PaymentModal({
  isOpen,
  onClose,
  currency,
  totalPayable,
  onConfirmPayments,
  isSubmitting = false,
}: PaymentModalProps) {
  const [tenders, setTenders] = useState<TenderItem[]>([]);
  const [activeMethod, setActiveMethod] = useState<PaymentMethod>("cash");
  const [inputAmount, setInputAmount] = useState<string>("");
  const [cashTendered, setCashTendered] = useState<string>("");
  const [referenceNo, setReferenceNo] = useState<string>("");
  const [validationError, setValidationError] = useState<string | null>(null);

  // Calculate totals
  const totalPaid = Math.round(tenders.reduce((sum, t) => sum + t.amount, 0) * 10000) / 10000;
  const remainingBalance = Math.max(0, Math.round((totalPayable - totalPaid) * 10000) / 10000);
  const totalChangeDue = tenders
    .filter((t) => t.paymentMethod === "cash" && t.changeDue != null)
    .reduce((sum, t) => sum + (t.changeDue ?? 0), 0);

  // Initialize tender state on modal open
  useEffect(() => {
    if (isOpen) {
      setTenders([]);
      setActiveMethod("cash");
      setInputAmount(totalPayable.toFixed(2));
      setCashTendered(totalPayable.toFixed(2));
      setReferenceNo("");
      setValidationError(null);
    }
  }, [isOpen, totalPayable]);

  // Update suggested input amount whenever tenders change
  useEffect(() => {
    if (remainingBalance > 0) {
      setInputAmount(remainingBalance.toFixed(2));
      if (activeMethod === "cash") {
        setCashTendered(remainingBalance.toFixed(2));
      }
    } else {
      setInputAmount("");
      setCashTendered("");
    }
  }, [remainingBalance, activeMethod]);

  if (!isOpen) return null;

  const handleAddTender = () => {
    setValidationError(null);
    const parsedAmount = parseFloat(inputAmount);

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setValidationError("Payment amount must be greater than zero.");
      return;
    }

    if (parsedAmount > remainingBalance + 0.0001) {
      if (activeMethod !== "cash") {
        setValidationError(
          `Non-cash payments cannot exceed remaining balance of ${currency} ${remainingBalance.toFixed(2)}.`
        );
        return;
      }
    }

    const tenderAmount = Math.min(parsedAmount, remainingBalance);

    if (activeMethod !== "cash") {
      if (!referenceNo.trim()) {
        setValidationError(`Transaction reference is required for ${PAYMENT_METHOD_CONFIG[activeMethod].label}.`);
        return;
      }
    }

    let computedTendered: number | null = null;
    let computedChange: number | null = null;

    if (activeMethod === "cash") {
      const parsedTendered = parseFloat(cashTendered || inputAmount);
      computedTendered = isNaN(parsedTendered) ? tenderAmount : parsedTendered;
      if (computedTendered < tenderAmount) {
        setValidationError("Amount tendered cannot be less than the payment amount.");
        return;
      }
      computedChange = Math.max(0, Math.round((computedTendered - tenderAmount) * 10000) / 10000);
    }

    const newTender: TenderItem = {
      id: crypto.randomUUID(),
      paymentMethod: activeMethod,
      amount: Math.round(tenderAmount * 10000) / 10000,
      amountTendered: computedTendered != null ? Math.round(computedTendered * 10000) / 10000 : null,
      changeDue: computedChange != null ? Math.round(computedChange * 10000) / 10000 : null,
      referenceNo: activeMethod !== "cash" ? referenceNo.trim() : null,
    };

    setTenders([...tenders, newTender]);
    setReferenceNo("");
    setValidationError(null);
  };

  const handleRemoveTender = (id: string) => {
    setTenders(tenders.filter((t) => t.id !== id));
  };

  const handleQuickCashTender = (extra: number) => {
    const base = remainingBalance;
    const target = Math.ceil(base / extra) * extra || extra;
    setCashTendered(target.toFixed(2));
    setInputAmount(base.toFixed(2));
  };

  const handleExactCash = () => {
    setCashTendered(remainingBalance.toFixed(2));
    setInputAmount(remainingBalance.toFixed(2));
  };

  const isComplete = Math.abs(totalPayable - totalPaid) < 0.0001 && totalPayable > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-gray-100 dark:border-gray-800 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/80">
          <div>
            <h3 id="payment-modal-title" className="font-bold text-lg text-gray-900 dark:text-gray-100">
              Process Payment
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Select payment methods to complete sale
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isSubmitting}
            className="h-8 w-8 p-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-5">
          {/* Payable vs Running Balance Banner */}
          <div className="grid grid-cols-3 gap-3 bg-gray-50 dark:bg-gray-800/60 p-3.5 rounded-xl border border-gray-200/70 dark:border-gray-800 text-center">
            <div>
              <span className="text-xs text-gray-500 dark:text-gray-400">Payable Total</span>
              <div className="font-bold text-gray-900 dark:text-gray-100 text-base mt-0.5">
                {currency} {totalPayable.toFixed(2)}
              </div>
            </div>
            <div>
              <span className="text-xs text-gray-500 dark:text-gray-400">Total Tendered</span>
              <div className="font-bold text-emerald-600 dark:text-emerald-400 text-base mt-0.5">
                {currency} {totalPaid.toFixed(2)}
              </div>
            </div>
            <div>
              <span className="text-xs text-gray-500 dark:text-gray-400">Balance Due</span>
              <div
                className={`font-bold text-base mt-0.5 ${
                  remainingBalance === 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-600 dark:text-amber-400"
                }`}
              >
                {currency} {remainingBalance.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Existing Tenders List */}
          {tenders.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Recorded Payments ({tenders.length})
              </span>
              <div className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-200/80 dark:border-gray-800 rounded-xl overflow-hidden bg-white dark:bg-gray-900">
                {tenders.map((tender) => {
                  const config = PAYMENT_METHOD_CONFIG[tender.paymentMethod];
                  const Icon = config.icon;
                  return (
                    <div
                      key={tender.id}
                      className="flex items-center justify-between p-3 text-sm hover:bg-gray-50/50 dark:hover:bg-gray-800/40"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className={`p-1.5 rounded-lg border ${config.color}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="font-medium text-gray-900 dark:text-gray-100">{config.label}</span>
                          {tender.referenceNo && (
                            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2 font-mono">
                              Ref: {tender.referenceNo}
                            </span>
                          )}
                          {tender.paymentMethod === "cash" &&
                            tender.changeDue != null &&
                            tender.changeDue > 0 && (
                              <div className="text-xs text-emerald-600 dark:text-emerald-400">
                                Tendered: {currency} {tender.amountTendered?.toFixed(2)} | Change:{" "}
                                {currency} {tender.changeDue.toFixed(2)}
                              </div>
                            )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-gray-900 dark:text-gray-100">
                          {currency} {tender.amount.toFixed(2)}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveTender(tender.id)}
                          disabled={isSubmitting}
                          className="h-7 w-7 p-0 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                          aria-label="Remove payment tender"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add Tender Form (only when remaining balance > 0) */}
          {remainingBalance > 0 && (
            <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 bg-white dark:bg-gray-900 space-y-4 shadow-sm">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
                Add Tender Method
              </span>

              {/* Payment Method Selector Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(Object.keys(PAYMENT_METHOD_CONFIG) as PaymentMethod[]).map((method) => {
                  const cfg = PAYMENT_METHOD_CONFIG[method];
                  const Icon = cfg.icon;
                  const isSelected = activeMethod === method;
                  return (
                    <button
                      key={method}
                      type="button"
                      onClick={() => {
                        setActiveMethod(method);
                        setValidationError(null);
                      }}
                      className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-medium transition-all ${
                        isSelected
                          ? "border-blue-600 bg-blue-50 text-blue-700 ring-2 ring-blue-500/20 font-semibold dark:border-blue-500 dark:bg-blue-950/50 dark:text-blue-300"
                          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                      }`}
                    >
                      <Icon className="w-4 h-4 mb-1" />
                      <span>{cfg.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Amount Inputs */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="tender-amount-input" className="text-xs text-gray-600 dark:text-gray-400">
                      Payment Amount
                    </Label>
                    <Input
                      id="tender-amount-input"
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={remainingBalance}
                      value={inputAmount}
                      onChange={(e) => setInputAmount(e.target.value)}
                      placeholder="0.00"
                      className="mt-1"
                    />
                  </div>

                  {activeMethod === "cash" ? (
                    <div>
                      <Label htmlFor="cash-tendered-input" className="text-xs text-gray-600 dark:text-gray-400">
                        Cash Received
                      </Label>
                      <Input
                        id="cash-tendered-input"
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={cashTendered}
                        onChange={(e) => setCashTendered(e.target.value)}
                        placeholder="0.00"
                        className="mt-1"
                      />
                    </div>
                  ) : (
                    <div>
                      <Label htmlFor="tender-ref-input" className="text-xs text-gray-600 dark:text-gray-400">
                        Transaction Reference *
                      </Label>
                      <Input
                        id="tender-ref-input"
                        type="text"
                        value={referenceNo}
                        onChange={(e) => setReferenceNo(e.target.value)}
                        placeholder="Auth code / TXN ID"
                        className="mt-1"
                        maxLength={255}
                      />
                    </div>
                  )}
                </div>

                {/* Quick Cash Buttons */}
                {activeMethod === "cash" && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleExactCash}
                      className="text-xs h-7 px-2"
                    >
                      Exact ({currency} {remainingBalance.toFixed(2)})
                    </Button>
                    {[10, 20, 50, 100].map((val) => (
                      <Button
                        key={val}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleQuickCashTender(val)}
                        className="text-xs h-7 px-2"
                      >
                        +{currency}
                        {val}
                      </Button>
                    ))}
                  </div>
                )}

                {/* Cash Change Preview */}
                {activeMethod === "cash" && (
                  <div className="flex justify-between items-center text-xs p-2 bg-emerald-50 dark:bg-emerald-950/50 rounded-lg text-emerald-800 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-900">
                    <span>Change Due:</span>
                    <span className="font-bold text-sm">
                      {currency}{" "}
                      {Math.max(
                        0,
                        (parseFloat(cashTendered || inputAmount) || 0) -
                          (parseFloat(inputAmount) || 0)
                      ).toFixed(2)}
                    </span>
                  </div>
                )}
              </div>

              {/* Validation Error Message */}
              {validationError && (
                <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 p-2 rounded-lg border border-red-200 dark:border-red-900">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{validationError}</span>
                </div>
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddTender}
                className="w-full h-9 flex items-center justify-center gap-1.5 font-medium"
              >
                <Plus className="w-4 h-4" />
                <span>Add Tender</span>
              </Button>
            </div>
          )}

          {/* Change Due Summary Banner when sale is balanced */}
          {isComplete && totalChangeDue > 0 && (
            <div className="bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 rounded-xl p-3 flex justify-between items-center">
              <div>
                <span className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">
                  Customer Change Due
                </span>
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  Return to customer from cash drawer
                </p>
              </div>
              <span className="text-xl font-black text-emerald-800 dark:text-emerald-200">
                {currency} {totalChangeDue.toFixed(2)}
              </span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/80 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-gray-600 dark:text-gray-300"
          >
            Cancel
          </Button>

          <Button
            type="button"
            onClick={() => onConfirmPayments(tenders)}
            disabled={!isComplete || isSubmitting}
            className="px-6 h-10 font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md disabled:bg-gray-200 disabled:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-500 disabled:opacity-100"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">Processing Sale...</span>
            ) : (
              <span className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                Complete Checkout ({currency} {totalPaid.toFixed(2)})
              </span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
