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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-gray-100 flex flex-col max-h-[95vh]">
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
        <div id="printable-receipt" className="p-6 overflow-y-auto space-y-4 text-xs font-mono text-gray-800">
          {/* Header */}
          <div className="text-center space-y-1 border-b border-dashed border-gray-300 pb-3">
            <div className="font-bold text-sm tracking-wide uppercase text-gray-900">
              {organizationName}
            </div>
            <div className="text-gray-500">Receipt #{saleResult.saleNumber}</div>
            <div className="text-gray-500">{formattedDate}</div>
            <div className="text-gray-500">
              Customer: {customer ? customer.name : "Walk-in Guest"}
            </div>
          </div>

          {/* Line Items */}
          <div className="border-b border-dashed border-gray-300 pb-3 space-y-2">
            <div className="grid grid-cols-12 font-bold text-gray-600">
              <span className="col-span-6">Item</span>
              <span className="col-span-2 text-center">Qty</span>
              <span className="col-span-2 text-right">Price</span>
              <span className="col-span-2 text-right">Total</span>
            </div>

            {items.map((it) => {
              const lineTotal = it.quantity * it.unitPrice - it.lineDiscountAmount;
              return (
                <div key={it.productId} className="grid grid-cols-12 text-gray-800">
                  <div className="col-span-6 truncate pr-1">
                    <div>{it.name}</div>
                    <div className="text-[10px] text-gray-400">SKU: {it.sku}</div>
                  </div>
                  <div className="col-span-2 text-center">{it.quantity}</div>
                  <div className="col-span-2 text-right">{it.unitPrice.toFixed(2)}</div>
                  <div className="col-span-2 text-right font-medium">{lineTotal.toFixed(2)}</div>
                </div>
              );
            })}
          </div>

          {/* Financial Totals */}
          <div className="space-y-1.5 border-b border-dashed border-gray-300 pb-3">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span>
                {saleResult.currency} {saleResult.subtotal.toFixed(2)}
              </span>
            </div>

            {saleResult.orderDiscountAmount > 0 && (
              <div className="flex justify-between text-emerald-700">
                <span>Order Discount:</span>
                <span>
                  - {saleResult.currency} {saleResult.orderDiscountAmount.toFixed(2)}
                </span>
              </div>
            )}

            <div className="flex justify-between">
              <span>Tax:</span>
              <span>
                {saleResult.currency} {saleResult.taxAmount.toFixed(2)}
              </span>
            </div>

            <div className="flex justify-between text-sm font-bold pt-1 border-t border-gray-200">
              <span>Total:</span>
              <span>
                {saleResult.currency} {saleResult.totalAmount.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Payments Breakdown */}
          <div className="space-y-1 border-b border-dashed border-gray-300 pb-3">
            <span className="font-bold text-gray-700 block">Payments:</span>
            {payments.map((p, idx) => (
              <div key={idx} className="flex justify-between">
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
              <div className="flex justify-between font-bold text-emerald-800 pt-1">
                <span>Change Given:</span>
                <span>
                  {saleResult.currency} {totalChange.toFixed(2)}
                </span>
              </div>
            )}
          </div>

          {/* Footer Note */}
          <div className="text-center text-[10px] text-gray-400 pt-1">
            Thank you for your business!
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between gap-3">
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
            className="flex-1 flex items-center justify-center gap-1.5 h-10 font-bold bg-primary text-white"
          >
            <PlusCircle className="w-4 h-4" />
            <span>New Sale</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
