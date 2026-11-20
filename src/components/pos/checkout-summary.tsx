"use client";

import React from "react";
import { Tag, Receipt } from "lucide-react";
import { Input } from "@/components/ui/input";

export interface CheckoutSummaryProps {
  currency: string;
  subtotal: number;
  totalLineDiscounts: number;
  orderDiscountAmount: number;
  onUpdateOrderDiscount: (discount: number) => void;
  taxName: string;
  taxRate: number;
  isTaxInclusive: boolean;
  taxAmount: number;
  totalPayable: number;
  disabled?: boolean;
}

export function CheckoutSummary({
  currency,
  subtotal,
  totalLineDiscounts,
  orderDiscountAmount,
  onUpdateOrderDiscount,
  taxName,
  taxRate,
  isTaxInclusive,
  taxAmount,
  totalPayable,
  disabled = false,
}: CheckoutSummaryProps) {
  const netSubtotal = Math.max(0, subtotal - totalLineDiscounts);

  const handleDiscountChange = (valStr: string) => {
    const parsed = parseFloat(valStr);
    if (isNaN(parsed) || parsed < 0) {
      onUpdateOrderDiscount(0);
      return;
    }
    // Cap order discount at net subtotal
    const clamped = Math.min(netSubtotal, Math.round(parsed * 10000) / 10000);
    onUpdateOrderDiscount(clamped);
  };

  return (
    <div className="bg-gray-50/80 rounded-xl p-4 border border-gray-200/80 space-y-3">
      {/* Gross Subtotal */}
      <div className="flex justify-between items-center text-sm text-gray-600">
        <span>Items Subtotal</span>
        <span className="font-medium text-gray-900">
          {currency} {subtotal.toFixed(2)}
        </span>
      </div>

      {/* Line Discounts Summary */}
      {totalLineDiscounts > 0 && (
        <div className="flex justify-between items-center text-sm text-emerald-700">
          <span>Line Discounts</span>
          <span className="font-medium">
            - {currency} {totalLineDiscounts.toFixed(2)}
          </span>
        </div>
      )}

      {/* Order-Level Discount Input */}
      <div className="flex justify-between items-center text-sm gap-2">
        <label
          htmlFor="order-discount-input"
          className="flex items-center gap-1.5 text-gray-700 font-medium"
        >
          <Tag className="w-4 h-4 text-gray-500" />
          <span>Order Discount</span>
        </label>
        <div className="flex items-center gap-1">
          <span className="text-gray-400 text-sm">- {currency}</span>
          <Input
            id="order-discount-input"
            type="number"
            step="0.01"
            min="0"
            max={netSubtotal}
            value={orderDiscountAmount || ""}
            placeholder="0.00"
            onChange={(e) => handleDiscountChange(e.target.value)}
            disabled={disabled || netSubtotal === 0}
            className="h-8 w-24 text-right px-2 text-sm bg-white"
            aria-label="Order discount amount"
          />
        </div>
      </div>

      {/* Tax Breakdown */}
      <div className="flex justify-between items-center text-sm text-gray-600 pt-1 border-t border-gray-200/60">
        <span className="flex items-center gap-1.5">
          <Receipt className="w-4 h-4 text-gray-400" />
          <span>
            {taxName} ({taxRate.toFixed(2)}%)
          </span>
          <span className="text-xs text-gray-400">
            {isTaxInclusive ? "(Included)" : "(Added)"}
          </span>
        </span>
        <span className="font-medium text-gray-700">
          {currency} {taxAmount.toFixed(2)}
        </span>
      </div>

      {/* Final Total Payable */}
      <div className="flex justify-between items-baseline pt-2 border-t-2 border-gray-300">
        <span className="text-base font-bold text-gray-900">Total Payable</span>
        <div className="text-right">
          <span className="text-2xl font-black text-gray-900 tracking-tight">
            {currency} {totalPayable.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}
