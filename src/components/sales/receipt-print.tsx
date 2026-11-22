"use client";

import React, { useState } from "react";
import { Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/inventory/formatters";
import type {
  SaleDetailHeader,
  SaleDetailCustomer,
  SaleItemRecord,
  PaymentRecord,
} from "@/types/sales";

export interface ReceiptPrintProps {
  sale: SaleDetailHeader;
  customer?: SaleDetailCustomer | null;
  items: SaleItemRecord[];
  payments: PaymentRecord[];
  organizationName: string;
  cashierName?: string | null;
  onClose?: () => void;
  initialPaperWidth?: "80mm" | "58mm";
}

/**
 * Printable Thermal Receipt Component (T065, US5).
 * - Supports 80mm standard and 58mm compact thermal receipt layouts.
 * - Displays snapshot sale numbers, dates, line items, subtotal, discounts, tax, and payments.
 * - Enforces cost confidentiality (unit_cost and margins are strictly omitted).
 * - Print-only CSS isolates receipt content and hides surrounding navigation and buttons.
 */
export function ReceiptPrint({
  sale,
  customer,
  items,
  payments,
  organizationName,
  cashierName,
  onClose,
  initialPaperWidth = "80mm",
}: ReceiptPrintProps) {
  const [paperWidth, setPaperWidth] = useState<"80mm" | "58mm">(initialPaperWidth);

  const handlePrint = () => {
    window.print();
  };

  const currency = sale.currency || "USD";

  // Formatted date and time
  const formattedDate = new Date(sale.createdAt).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="receipt-dialog-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 print:p-0 print:bg-white print:static print:inset-auto">
      {/* Container Dialog */}
      <div className="receipt-dialog-content relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl dark:bg-gray-900 print:shadow-none print:max-w-none print:w-auto print:max-h-none print:h-auto print:rounded-none">
        {/* Modal Controls (Hidden in Print) */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-800 print:hidden">
          <div className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-gray-700 dark:text-gray-300" />
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              Receipt Preview ({paperWidth})
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Paper Width Selector */}
            <div className="flex items-center rounded-lg border border-gray-300 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-800">
              <button
                type="button"
                onClick={() => setPaperWidth("80mm")}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-all ${
                  paperWidth === "80mm"
                    ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100"
                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                80mm
              </button>
              <button
                type="button"
                onClick={() => setPaperWidth("58mm")}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-all ${
                  paperWidth === "58mm"
                    ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100"
                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                58mm
              </button>
            </div>

            <Button size="sm" onClick={handlePrint} className="gap-1.5 ml-2">
              <Printer className="h-4 w-4" />
              Print
            </Button>

            {onClose && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                aria-label="Close receipt"
                className="h-8 w-8 p-0 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Scrollable Receipt Area */}
        <div className="receipt-scroll-container flex-1 overflow-y-auto p-6 bg-gray-100 dark:bg-gray-950 flex justify-center print:p-0 print:bg-white print:overflow-visible">
          {/* Thermal Receipt Content Container */}
          <div
            id="thermal-receipt-print-area"
            className={`bg-white text-black p-4 font-mono shadow-md print:shadow-none print:p-2 ${
              paperWidth === "80mm"
                ? "w-[300px] print:w-[80mm] print:max-w-[80mm] text-[13px] leading-tight"
                : "w-[220px] print:w-[58mm] print:max-w-[58mm] text-[11px] leading-snug"
            }`}
          >
            {/* Header: Store Name & Details */}
            <div className="receipt-header text-center space-y-1 mb-3">
              <div className="font-bold text-base tracking-tight uppercase">
                {organizationName}
              </div>
              <div className="text-xs text-gray-600 print:text-black">
                Customer Sales Receipt
              </div>
            </div>

            {/* Receipt Meta */}
            <div className="receipt-meta border-t border-b border-dashed border-gray-400 py-2 space-y-1 my-2 text-xs">
              <div className="flex justify-between">
                <span>Receipt #:</span>
                <span className="font-semibold">{sale.saleNumber}</span>
              </div>
              <div className="flex justify-between">
                <span>Date:</span>
                <span>{formattedDate}</span>
              </div>
              <div className="flex justify-between">
                <span>Cashier:</span>
                <span>{cashierName || "Staff"}</span>
              </div>
              {customer && (
                <div className="flex justify-between items-start gap-2">
                  <span>Customer:</span>
                  <div className="text-right max-w-[180px]">
                    <div className="font-medium break-words">{customer.name}</div>
                    {customer.phone && (
                      <div className="text-[10px] text-gray-500 print:text-black">{customer.phone}</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Line Items Table */}
            <div className="py-2">
              <div className="flex justify-between text-xs font-bold border-b border-gray-300 pb-1 mb-1">
                <span>Item</span>
                <span>Total</span>
              </div>

              <div className="space-y-1.5">
                {items.map((it) => (
                  <div key={it.id} className="receipt-line-item text-xs">
                    <div className="font-medium break-words">{it.productName}</div>
                    <div className="flex justify-between text-gray-600 print:text-black text-[11px]">
                      <span>
                        {it.quantity} x {formatCurrency(it.unitPrice, currency)}
                        {it.lineDiscountAmount > 0 && (
                          <span className="text-gray-500">
                            {" "}
                            (-{formatCurrency(it.lineDiscountAmount, currency)})
                          </span>
                        )}
                      </span>
                      <span className="font-semibold text-black">
                        {formatCurrency(it.totalPrice, currency)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Financial Summary */}
            <div className="receipt-summary border-t border-dashed border-gray-400 pt-2 space-y-1 text-xs">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>{formatCurrency(sale.subtotal, currency)}</span>
              </div>

              {sale.orderDiscountAmount > 0 && (
                <div className="flex justify-between text-red-600 print:text-black">
                  <span>Order Discount:</span>
                  <span>-{formatCurrency(sale.orderDiscountAmount, currency)}</span>
                </div>
              )}

              <div className="flex justify-between">
                <span>
                  {sale.taxName} ({Number(sale.taxRate).toFixed(2)}%
                  {sale.isTaxInclusive ? " incl." : " added"}):
                </span>
                <span>{formatCurrency(sale.taxAmount, currency)}</span>
              </div>

              <div className="border-t border-black pt-1.5 flex justify-between font-bold text-sm">
                <span>TOTAL:</span>
                <span>{formatCurrency(sale.totalAmount, currency)}</span>
              </div>
            </div>

            {/* Payment Breakdown */}
            <div className="receipt-payments border-t border-dashed border-gray-400 py-2 my-2 space-y-1 text-xs">
              <div className="font-bold text-[11px] uppercase tracking-wider mb-1">
                Payment Details
              </div>
              {payments.map((p) => (
                <div key={p.id} className="space-y-0.5">
                  <div className="flex justify-between font-medium">
                    <span className="capitalize">{p.paymentMethod.replace("_", " ")}:</span>
                    <span>{formatCurrency(p.amount, currency)}</span>
                  </div>
                  {p.referenceNo && (
                    <div className="text-[10px] text-gray-500 print:text-black">
                      Ref: {p.referenceNo}
                    </div>
                  )}
                  {p.paymentMethod === "cash" && p.amountTendered != null && (
                    <div className="flex justify-between text-[11px] text-gray-600 print:text-black">
                      <span>Tendered:</span>
                      <span>{formatCurrency(p.amountTendered, currency)}</span>
                    </div>
                  )}
                  {p.paymentMethod === "cash" && p.changeDue != null && p.changeDue > 0 && (
                    <div className="flex justify-between text-[11px] text-gray-600 print:text-black font-semibold">
                      <span>Change:</span>
                      <span>{formatCurrency(p.changeDue, currency)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Footer & Return Policy */}
            <div className="receipt-footer border-t border-dashed border-gray-400 pt-3 text-center space-y-1.5 text-[10px] text-gray-600 print:text-black">
              <p className="font-semibold text-black">
                Thank you for your business!
              </p>
              <p className="leading-tight">
                Items in original condition may be returned within 14 days with original receipt.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Dedicated Print Media Styles */}
      <style jsx global>{`
        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
            height: auto !important;
            overflow: visible !important;
          }
          header, nav, aside, footer {
            display: none !important;
          }
          main {
            padding: 0 !important;
            margin: 0 !important;
            max-width: none !important;
            width: 100% !important;
          }
          .receipt-dialog-overlay,
          .receipt-dialog-content,
          .receipt-scroll-container {
            position: static !important;
            display: block !important;
            max-height: none !important;
            height: auto !important;
            overflow: visible !important;
            padding: 0 !important;
            margin: 0 !important;
            width: 100% !important;
          }
          #thermal-receipt-print-area {
            position: static !important;
            display: block !important;
            margin: 0 auto;
            padding: 4px;
            box-shadow: none !important;
            break-inside: auto;
            page-break-inside: auto;
          }
          .receipt-line-item,
          .receipt-header,
          .receipt-meta,
          .receipt-summary,
          .receipt-payments,
          .receipt-footer {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          @page {
            margin: 0;
            size: auto;
          }
        }
      `}</style>
    </div>
  );
}
