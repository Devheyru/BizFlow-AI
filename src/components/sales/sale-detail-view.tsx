"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Printer,
  Calendar,
  User,
  RotateCcw,
  Receipt,
  FileText,
  DollarSign,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { formatCurrency } from "@/lib/inventory/formatters";
import { ReceiptPrint } from "@/components/sales/receipt-print";
import { VoidDialog } from "@/components/sales/void-dialog";
import { ReturnDialog } from "@/components/sales/return-dialog";
import type {
  SaleDetail,
  ReturnHistory,
  SaleStatus,
  PaymentStatus,
  RefundStatus,
} from "@/types/sales";

export interface SaleDetailViewProps {
  slug: string;
  saleDetail: SaleDetail;
  returnHistory: ReturnHistory[];
  canViewCost: boolean;
  canVoid?: boolean;
  canReturn?: boolean;
  organizationName: string;
}

export function SaleDetailView({
  slug,
  saleDetail,
  returnHistory,
  canViewCost,
  canVoid = false,
  canReturn = false,
  organizationName,
}: SaleDetailViewProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"items" | "payments" | "returns">("items");
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isVoidModalOpen, setIsVoidModalOpen] = useState(false);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);

  const { sale, customer, items, payments, refunds } = saleDetail;
  const currency = sale.currency || "USD";

  const formattedDate = new Date(sale.createdAt).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const canShowVoid =
    Boolean(canVoid) &&
    sale.status === "completed" &&
    returnHistory.length === 0;

  const canShowReturn =
    Boolean(canReturn) &&
    (sale.status === "completed" || sale.status === "partially_returned");

  // Status badge styling
  const renderStatusBadge = (saleStatus: SaleStatus) => {
    switch (saleStatus) {
      case "completed":
        return (
          <span className="inline-flex items-center rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-700 ring-1 ring-inset ring-green-600/20 dark:bg-green-950/40 dark:text-green-300">
            Completed
          </span>
        );
      case "voided":
        return (
          <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-600/20 dark:bg-red-950/40 dark:text-red-300">
            Voided
          </span>
        );
      case "partially_returned":
        return (
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300">
            Partially Returned
          </span>
        );
      case "returned":
        return (
          <span className="inline-flex items-center rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-semibold text-purple-700 ring-1 ring-inset ring-purple-600/20 dark:bg-purple-950/40 dark:text-purple-300">
            Returned
          </span>
        );
      default:
        return <span>{saleStatus}</span>;
    }
  };

  const renderPaymentBadge = (payStatus: PaymentStatus) => {
    switch (payStatus) {
      case "paid":
        return (
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300">
            Paid
          </span>
        );
      case "partially_refunded":
        return (
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300">
            Partially Refunded
          </span>
        );
      case "refunded":
        return (
          <span className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 ring-1 ring-inset ring-purple-600/20 dark:bg-purple-950/40 dark:text-purple-300">
            Refunded
          </span>
        );
      default:
        return <span>{payStatus}</span>;
    }
  };

  const renderRefundStatusBadge = (refStatus: RefundStatus) => {
    switch (refStatus) {
      case "completed":
        return (
          <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700 ring-1 ring-inset ring-green-600/20 dark:bg-green-950/40 dark:text-green-300">
            Completed
          </span>
        );
      case "pending":
        return (
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300">
            Pending Confirmation
          </span>
        );
      case "failed":
        return (
          <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-600/20 dark:bg-red-950/40 dark:text-red-300">
            Failed
          </span>
        );
      default:
        return <span>{refStatus}</span>;
    }
  };

  return (
    <>
      <div className="space-y-6 print:hidden">
        {/* Back Link and Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <Link
            href={`/${slug}/sales`}
            className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Sales History
          </Link>

          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 font-mono">
              {sale.saleNumber}
            </h1>
            <div className="flex items-center gap-1.5">
              {renderStatusBadge(sale.status)}
              {renderPaymentBadge(sale.paymentStatus)}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <Calendar className="h-3.5 w-3.5" />
            <span>{formattedDate}</span>
            <span>•</span>
            <span>Staff ID: {sale.createdBy.slice(0, 8)}...</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canShowReturn && (
            <Button
              variant="outline"
              onClick={() => setIsReturnModalOpen(true)}
              className="gap-2 border-purple-200 text-purple-700 hover:bg-purple-50 hover:text-purple-800 dark:border-purple-800 dark:text-purple-300 dark:hover:bg-purple-950/40"
            >
              <RotateCcw className="h-4 w-4" />
              Process Return
            </Button>
          )}
          {canShowVoid && (
            <Button
              variant="destructive"
              onClick={() => setIsVoidModalOpen(true)}
              className="gap-2"
            >
              <AlertTriangle className="h-4 w-4" />
              Void Sale
            </Button>
          )}
          <Button
            onClick={() => setIsPrintModalOpen(true)}
            className="gap-2"
          >
            <Printer className="h-4 w-4" />
            Print Receipt
          </Button>
        </div>
      </div>

      {/* Sale Voided Notice Banner */}
      {sale.status === "voided" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" />
          <div>
            <span className="font-semibold">This sale was voided.</span> All line item quantities have been restored to inventory.
          </div>
        </div>
      )}

      {/* Meta Cards: Customer, Tax, and Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Customer Card */}
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-gray-700 dark:text-gray-300">
              <User className="h-4 w-4" />
              Customer Information
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0 text-xs space-y-1">
            {customer ? (
              <>
                <div className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
                  {customer.name}
                </div>
                {customer.phone && (
                  <div className="text-gray-500">Phone: {customer.phone}</div>
                )}
                {customer.email && (
                  <div className="text-gray-500">Email: {customer.email}</div>
                )}
              </>
            ) : (
              <div className="text-gray-400 italic">
                Walk-in Customer (No profile attached)
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tax Parameters Card */}
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-gray-700 dark:text-gray-300">
              <Receipt className="h-4 w-4" />
              Tax Snapshot
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-500">Tax Name:</span>
              <span className="font-medium">{sale.taxName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Applied Rate:</span>
              <span className="font-medium">{Number(sale.taxRate).toFixed(4)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Mode:</span>
              <span className="font-medium">
                {sale.isTaxInclusive ? "Tax-Inclusive (Built-in)" : "Tax-Exclusive (Added)"}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Financial Overview Card */}
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-gray-700 dark:text-gray-300">
              <DollarSign className="h-4 w-4" />
              Financial Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-500">Subtotal:</span>
              <span>{formatCurrency(sale.subtotal, currency)}</span>
            </div>
            {sale.orderDiscountAmount > 0 && (
              <div className="flex justify-between text-red-600 dark:text-red-400">
                <span>Order Discount:</span>
                <span>-{formatCurrency(sale.orderDiscountAmount, currency)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">Tax Amount:</span>
              <span>{formatCurrency(sale.taxAmount, currency)}</span>
            </div>
            <div className="flex justify-between font-bold text-gray-900 dark:text-gray-100 text-sm border-t border-gray-100 dark:border-gray-800 pt-1">
              <span>Total Amount:</span>
              <span>{formatCurrency(sale.totalAmount, currency)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-800">
        <nav className="flex space-x-6 text-sm">
          <button
            type="button"
            onClick={() => setActiveTab("items")}
            className={`pb-3 font-medium transition-colors border-b-2 ${
              activeTab === "items"
                ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            Line Items ({items.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("payments")}
            className={`pb-3 font-medium transition-colors border-b-2 ${
              activeTab === "payments"
                ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            Payments & Tenders ({payments.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("returns")}
            className={`pb-3 font-medium transition-colors border-b-2 ${
              activeTab === "returns"
                ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            Returns & Refunds ({returnHistory.length})
          </button>
        </nav>
      </div>

      {/* Tab 1: Line Items Table */}
      {activeTab === "items" && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden dark:border-gray-800 dark:bg-gray-900">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-gray-600 dark:text-gray-400">
              <thead className="bg-gray-50 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:bg-gray-800/60 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
                <tr>
                  <th scope="col" className="px-4 py-3">Product</th>
                  <th scope="col" className="px-4 py-3">SKU</th>
                  <th scope="col" className="px-4 py-3 text-right">Qty</th>
                  <th scope="col" className="px-4 py-3 text-right">Unit Price</th>
                  {canViewCost && (
                    <th scope="col" className="px-4 py-3 text-right text-amber-700 dark:text-amber-400">
                      Unit Cost
                    </th>
                  )}
                  <th scope="col" className="px-4 py-3 text-right">Line Disc</th>
                  <th scope="col" className="px-4 py-3 text-right">Order Disc</th>
                  <th scope="col" className="px-4 py-3 text-right">Tax</th>
                  <th scope="col" className="px-4 py-3 text-right">Total Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {items.map((it) => (
                  <tr key={it.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/40">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                      {it.productName}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-500">{it.sku}</td>
                    <td className="px-4 py-3 text-right font-medium">{it.quantity}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(it.unitPrice, currency)}</td>
                    {canViewCost && (
                      <td className="px-4 py-3 text-right font-mono text-amber-700 dark:text-amber-400">
                        {it.unitCost != null ? formatCurrency(it.unitCost, currency) : "—"}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right text-gray-500">
                      {it.lineDiscountAmount > 0
                        ? `-${formatCurrency(it.lineDiscountAmount, currency)}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {it.allocatedOrderDisc > 0
                        ? `-${formatCurrency(it.allocatedOrderDisc, currency)}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {formatCurrency(it.allocatedTaxAmount, currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-gray-100">
                      {formatCurrency(it.totalPrice, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Payments Breakdown */}
      {activeTab === "payments" && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden dark:border-gray-800 dark:bg-gray-900">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-gray-600 dark:text-gray-400">
              <thead className="bg-gray-50 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:bg-gray-800/60 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
                <tr>
                  <th scope="col" className="px-4 py-3">Method</th>
                  <th scope="col" className="px-4 py-3 text-right">Amount</th>
                  <th scope="col" className="px-4 py-3">Reference #</th>
                  <th scope="col" className="px-4 py-3 text-right">Tendered</th>
                  <th scope="col" className="px-4 py-3 text-right">Change Due</th>
                  <th scope="col" className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-medium capitalize text-gray-900 dark:text-gray-100">
                      {p.paymentMethod.replace("_", " ")}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-gray-100">
                      {formatCurrency(p.amount, currency)}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-500">
                      {p.referenceNo || "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {p.amountTendered != null ? formatCurrency(p.amountTendered, currency) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {p.changeDue != null ? formatCurrency(p.changeDue, currency) : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(p.createdAt).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Return & Refund History */}
      {activeTab === "returns" && (
        <div className="space-y-4">
          {returnHistory.length === 0 && refunds.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900">
              <FileText className="mx-auto h-8 w-8 text-gray-400" />
              <p className="mt-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                No returns or refunds
              </p>
              <p className="text-xs text-gray-500 mt-1">
                This transaction has not experienced any partial or full returns.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Void Refunds (if any exist without a returnId) */}
              {refunds.filter((rf) => !rf.saleReturnId).length > 0 && (
                <Card className="border-red-200 dark:border-red-900/50">
                  <CardHeader className="py-3 px-4 bg-red-50/50 dark:bg-red-950/20 border-b border-red-200 dark:border-red-900/50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                        <CardTitle className="text-sm font-semibold">
                          Void Reversal Reimbursements
                        </CardTitle>
                      </div>
                      <span className="text-xs font-semibold text-red-700 dark:text-red-300">
                        {sale.status === "voided" ? "Sale Voided" : "Reversal Refunds"}
                      </span>
                    </div>
                    <CardDescription className="text-xs">
                      Automatic reversal refunds generated upon voiding this sale.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 space-y-2">
                    <div className="space-y-1.5 text-xs">
                      {refunds
                        .filter((rf) => !rf.saleReturnId)
                        .map((rf) => (
                          <div
                            key={rf.id}
                            className="flex items-center justify-between p-2 rounded-md bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-medium capitalize">
                                {rf.refundMethod.replace("_", " ")}
                              </span>
                              {rf.referenceNo && (
                                <span className="text-gray-500 font-mono text-[11px]">
                                  (Ref: {rf.referenceNo})
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              {renderRefundStatusBadge(rf.status)}
                              <span className="font-semibold">
                                {formatCurrency(rf.amount, currency)}
                              </span>
                            </div>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Returns List */}
              {returnHistory.map((ret) => (
                <Card key={ret.id}>
                  <CardHeader className="py-3 px-4 bg-gray-50/50 dark:bg-gray-800/40 border-b border-gray-200 dark:border-gray-800">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <RotateCcw className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                        <CardTitle className="text-sm font-semibold font-mono">
                          {ret.returnNumber}
                        </CardTitle>
                      </div>
                      <span className="font-semibold text-sm text-purple-700 dark:text-purple-300">
                        Refund: {formatCurrency(ret.totalRefundAmount, currency)}
                      </span>
                    </div>
                    <CardDescription className="text-xs">
                      Reason: &ldquo;{ret.reason}&rdquo; • Processed on{" "}
                      {new Date(ret.createdAt).toLocaleString()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 space-y-3">
                    {/* Return items */}
                    <div>
                      <div className="text-xs font-semibold text-gray-500 mb-1.5 uppercase">
                        Returned Line Items:
                      </div>
                      <div className="divide-y divide-gray-100 dark:divide-gray-800 border rounded-lg overflow-hidden text-xs">
                        {ret.items.map((item) => (
                          <div
                            key={item.id}
                            className="p-2.5 flex items-center justify-between"
                          >
                            <div>
                              <span className="font-medium text-gray-900 dark:text-gray-100">
                                {item.productName || "Product"}
                              </span>
                              <span className="text-gray-500 ml-2 font-mono">
                                ({item.sku || item.productId.slice(0, 8)})
                              </span>
                            </div>
                            <div className="flex items-center gap-4">
                              <span>Qty: {item.quantity}</span>
                              <span className="font-semibold">
                                {formatCurrency(item.refundAmount, currency)}
                              </span>
                              {item.restockToInventory ? (
                                <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                                  Restocked
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                  No Restock
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Associated refunds */}
                    {ret.refunds.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-gray-500 mb-1.5 uppercase">
                          Disbursed Refunds:
                        </div>
                        <div className="space-y-1.5 text-xs">
                          {ret.refunds.map((rf) => (
                            <div
                              key={rf.id}
                              className="flex items-center justify-between p-2 rounded-md bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-medium capitalize">
                                  {rf.refundMethod.replace("_", " ")}
                                </span>
                                {rf.referenceNo && (
                                  <span className="text-gray-500 font-mono text-[11px]">
                                    (Ref: {rf.referenceNo})
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3">
                                {renderRefundStatusBadge(rf.status)}
                                <span className="font-semibold">
                                  {formatCurrency(rf.amount, currency)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      </div>

      {/* Printable Thermal Receipt Modal */}
      {isPrintModalOpen && (
        <ReceiptPrint
          sale={sale}
          customer={customer}
          items={items}
          payments={payments}
          organizationName={organizationName}
          onClose={() => setIsPrintModalOpen(false)}
        />
      )}

      {/* Sale Void Dialog Modal (T067, T068, US6) */}
      {isVoidModalOpen && (
        <VoidDialog
          isOpen={isVoidModalOpen}
          onClose={() => setIsVoidModalOpen(false)}
          slug={slug}
          saleId={sale.id}
          saleNumber={sale.saleNumber}
          totalAmount={sale.totalAmount}
          currency={currency}
          payments={payments}
          onSuccess={() => {
            router.refresh();
          }}
        />
      )}

      {/* Sale Return Dialog Modal (T070, T071, US4) */}
      {isReturnModalOpen && (
        <ReturnDialog
          isOpen={isReturnModalOpen}
          onClose={() => setIsReturnModalOpen(false)}
          slug={slug}
          saleDetail={saleDetail}
          returnHistory={returnHistory}
          onSuccess={() => {
            router.refresh();
          }}
        />
      )}
    </>
  );
}
