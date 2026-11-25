"use client";

import React from "react";
import { CheckCircle2, Printer, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SaleResult } from "@/types/sales";
import type { CartItem } from "@/components/pos/cart-item-row";
import type { TenderItem } from "@/components/pos/payment-modal";
import type { CustomerRecord } from "@/types/customers";

export interface CheckoutReceiptProps {
  isOpen: boolean;
  onClose: () => void;
  saleResult: SaleResult | null;
  items: CartItem[];
  payments: TenderItem[];
  customer: CustomerRecord | null;
  organizationName: string;
  onNewSale: () => void;
}

export function CheckoutReceipt({
  isOpen,
  saleResult,
  items,
  payments,
  customer,
  organizationName,
  onNewSale,
}: CheckoutReceiptProps) {
  if (!isOpen || !saleResult) return null;

  const handlePrint = () => {
    window.print();
  };

  const formattedDate = new Date(saleResult.createdAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const totalChange = payments
    .filter((p) => p.paymentMethod === "cash" && p.changeDue != null)
    .reduce((sum, p) => sum + (p.changeDue ?? 0), 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="receipt-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-gray-100 dark:border-gray-800 flex flex-col max-h-[95vh]">
        {/* Success Banner */}
        <div className="bg-emerald-600 text-white p-5 text-center flex flex-col items-center">
          <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mb-2">
            <CheckCircle2 className="w-7 h-7 text-white" />
          </div>
          <h3 id="receipt-dialog-title" className="text-xl font-bold">
            {saleResult.isReplay ? "Sale Confirmed (Replayed)" : "Sale Completed!"}
          </h3>
          <p className="text-emerald-100 text-xs mt-0.5">
            Sale #{saleResult.saleNumber}
          </p>
        </div>

        {/* Printable Receipt Content */}
        <div
          id="printable-receipt"
          className="p-6 overflow-y-auto space-y-4 text-xs font-mono text-gray-800 dark:text-gray-200 print:bg-white print:text-black"
        >
          {/* Header */}
          <div className="text-center space-y-1 border-b border-dashed border-gray-300 dark:border-gray-700 pb-3">
            <div className="font-bold text-sm tracking-wide uppercase text-gray-900 dark:text-gray-100 print:text-black">
              {organizationName}
            </div>
            <div className="text-gray-500 dark:text-gray-400">Receipt #{saleResult.saleNumber}</div>
            <div className="text-gray-500 dark:text-gray-400">{formattedDate}</div>
            <div className="text-gray-500 dark:text-gray-400">
              Customer: {customer ? customer.name : "Walk-in Guest"}
            </div>
          </div>

          {/* Line Items */}
          <div className="border-b border-dashed border-gray-300 dark:border-gray-700 pb-3 space-y-2">
            <div className="grid grid-cols-12 font-bold text-gray-600 dark:text-gray-400">
              <span className="col-span-6">Item</span>
              <span className="col-span-2 text-center">Qty</span>
              <span className="col-span-2 text-right">Price</span>
              <span className="col-span-2 text-right">Total</span>
            </div>

            {items.map((it) => {
              const lineTotal = it.quantity * it.unitPrice - it.lineDiscountAmount;
              return (
                <div key={it.productId} className="grid grid-cols-12 text-gray-800 dark:text-gray-200">
                  <div className="col-span-6 pr-2 min-w-0">
                    <div className="break-words">{it.name}</div>
                    <div className="text-[10px] text-gray-500 dark:text-gray-400">SKU: {it.sku}</div>
                    {it.lineDiscountAmount > 0 && (
                      <div className="text-[10px] text-emerald-700 dark:text-emerald-400">
                        Disc: -{saleResult.currency} {it.lineDiscountAmount.toFixed(2)}
                      </div>
                    )}
                  </div>
                  <div className="col-span-2 text-center">{it.quantity}</div>
                  <div className="col-span-2 text-right">{it.unitPrice.toFixed(2)}</div>
                  <div className="col-span-2 text-right font-medium text-gray-900 dark:text-gray-100">
                    {lineTotal.toFixed(2)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Financial Totals */}
          <div className="space-y-1.5 border-b border-dashed border-gray-300 dark:border-gray-700 pb-3">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Subtotal:</span>
              <span>
                {saleResult.currency} {saleResult.subtotal.toFixed(2)}
              </span>
            </div>

            {saleResult.orderDiscountAmount > 0 && (
              <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                <span>Order Discount:</span>
                <span>
                  - {saleResult.currency} {saleResult.orderDiscountAmount.toFixed(2)}
                </span>
              </div>
            )}

            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Tax:</span>
              <span>
                {saleResult.currency} {saleResult.taxAmount.toFixed(2)}
              </span>
            </div>

            <div className="flex justify-between text-sm font-bold text-gray-900 dark:text-gray-100 pt-1.5 border-t border-gray-200 dark:border-gray-700">
              <span>Total:</span>
              <span>
                {saleResult.currency} {saleResult.totalAmount.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Payments Breakdown */}
          <div className="space-y-1 border-b border-dashed border-gray-300 dark:border-gray-700 pb-3">
            <span className="font-bold text-gray-700 dark:text-gray-300 block">Payments:</span>
            {payments.map((p, idx) => (
              <div key={idx} className="flex justify-between text-gray-800 dark:text-gray-200">
                <span className="capitalize">
                  {p.paymentMethod.replace("_", " ")}
                  {p.referenceNo ? ` (${p.referenceNo})` : ""}
                </span>
                <span>
                  {saleResult.currency} {p.amount.toFixed(2)}
                </span>
              </div>
            ))}

            {totalChange > 0 && (
              <div className="flex justify-between font-bold text-emerald-800 dark:text-emerald-300 pt-1">
                <span>Change Given:</span>
                <span>
                  {saleResult.currency} {totalChange.toFixed(2)}
                </span>
              </div>
            )}
          </div>

          {/* Footer Note */}
          <div className="text-center text-[10px] text-gray-500 dark:text-gray-400 pt-1">
            Thank you for your business!
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/80 flex items-center justify-between gap-3 print:hidden">
          <Button
            type="button"
            variant="outline"
            onClick={handlePrint}
            className="flex-1 flex items-center justify-center gap-1.5 h-10 font-medium"
          >
            <Printer className="w-4 h-4" />
            <span>Print Receipt</span>
          </Button>

          <Button
            type="button"
            onClick={onNewSale}
            className="flex-1 flex items-center justify-center gap-1.5 h-10 font-bold bg-blue-600 hover:bg-blue-700 text-white"
          >
            <PlusCircle className="w-4 h-4" />
            <span>New Sale</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
