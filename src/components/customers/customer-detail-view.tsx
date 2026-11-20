"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Edit2,
  Archive,
  Phone,
  Mail,
  Calendar,
  ShoppingBag,
  CreditCard,
  Clock,
  AlertTriangle,
  User,
  FileText,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CustomerForm } from "@/components/customers/customer-form";
import { archiveCustomerAction } from "@/actions/customer-actions";
import type { CustomerDetail } from "@/types/customers";
import type { CustomerPurchaseHistoryItem } from "@/actions/customer-actions";

export interface CustomerDetailViewProps {
  slug: string;
  customer: CustomerDetail;
  purchaseHistory: CustomerPurchaseHistoryItem[];
  canUpdate: boolean;
  canArchive: boolean;
  canViewSales: boolean;
}

export function CustomerDetailView({
  slug,
  customer,
  purchaseHistory,
  canUpdate,
  canArchive,
  canViewSales,
}: CustomerDetailViewProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [activeTab, setActiveTab] = useState<"info" | "history">("info");
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isArchivingOpen, setIsArchivingOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const isActive = customer.status === "active";

  const handleArchiveConfirm = async () => {
    if (isArchiving) return;
    setIsArchiving(true);
    setArchiveError(null);

    try {
      const res = await archiveCustomerAction(slug, customer.id);
      if (!res.success) {
        setArchiveError(res.error.message || "Failed to archive customer.");
        setIsArchiving(false);
        return;
      }

      setIsArchivingOpen(false);
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setArchiveError("An unexpected error occurred while archiving.");
    } finally {
      setIsArchiving(false);
    }
  };

  const formattedCreated = new Date(customer.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const formattedLastPurchase = customer.lastPurchaseAt
    ? new Date(customer.lastPurchaseAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "No purchases yet";

  return (
    <div className="space-y-6">
      {/* Back Link */}
      <div>
        <Link
          href={`/${slug}/customers`}
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Customers</span>
        </Link>
      </div>

      {/* Profile Header Card */}
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xl font-bold shrink-0">
              {customer.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {customer.name}
                </h1>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    isActive
                      ? "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300"
                      : "bg-gray-100 text-gray-800 dark:bg-zinc-800 dark:text-gray-400"
                  }`}
                >
                  {isActive ? "Active Customer" : "Archived Customer"}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
                {customer.phone && (
                  <span className="flex items-center gap-1">
                    <Phone className="h-3.5 w-3.5 text-gray-400" />
                    <a href={`tel:${customer.phone}`} className="hover:underline">
                      {customer.phone}
                    </a>
                  </span>
                )}
                {customer.email && (
                  <span className="flex items-center gap-1">
                    <Mail className="h-3.5 w-3.5 text-gray-400" />
                    <a href={`mailto:${customer.email}`} className="hover:underline">
                      {customer.email}
                    </a>
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 text-gray-400" />
                  <span>Member since {formattedCreated}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {canUpdate && isActive && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditOpen(true)}
                className="gap-1.5"
              >
                <Edit2 className="h-3.5 w-3.5" />
                <span>Edit Profile</span>
              </Button>
            )}

            {canArchive && isActive && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsArchivingOpen(true);
                  setArchiveError(null);
                }}
                className="gap-1.5 text-red-600 hover:text-red-700 dark:text-red-400"
              >
                <Archive className="h-3.5 w-3.5" />
                <span>Archive</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Total Purchases */}
        <div className="bg-white dark:bg-zinc-900 p-5 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded-lg">
            <ShoppingBag className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
              Total Purchases
            </p>
            {customer.salesMetricsRestricted || customer.purchaseCount === null ? (
              <div className="flex items-center gap-1.5 mt-0.5">
                <Lock className="h-4 w-4 text-gray-400" />
                <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                  Restricted
                </span>
              </div>
            ) : (
              <p className="text-xl font-bold text-gray-900 dark:text-gray-100 mt-0.5">
                {customer.purchaseCount}
              </p>
            )}
          </div>
        </div>

        {/* Total Spent */}
        <div className="bg-white dark:bg-zinc-900 p-5 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-green-50 dark:bg-green-950/50 text-green-600 dark:text-green-400 rounded-lg">
            <CreditCard className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
              Total Spent
            </p>
            {customer.salesMetricsRestricted || customer.totalSpent === null ? (
              <div className="flex items-center gap-1.5 mt-0.5">
                <Lock className="h-4 w-4 text-gray-400" />
                <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                  Restricted
                </span>
              </div>
            ) : (
              <p className="text-xl font-bold text-gray-900 dark:text-gray-100 mt-0.5">
                ${customer.totalSpent.toFixed(2)}
              </p>
            )}
          </div>
        </div>

        {/* Last Purchase */}
        <div className="bg-white dark:bg-zinc-900 p-5 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 rounded-lg">
            <Clock className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
              Last Purchase
            </p>
            {customer.salesMetricsRestricted ? (
              <div className="flex items-center gap-1.5 mt-0.5">
                <Lock className="h-4 w-4 text-gray-400" />
                <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                  Restricted
                </span>
              </div>
            ) : (
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-0.5">
                {formattedLastPurchase}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-200 dark:border-zinc-800 px-6">
          <button
            type="button"
            onClick={() => setActiveTab("info")}
            className={`py-3.5 px-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === "info"
                ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            <User className="h-4 w-4" />
            <span>Profile Information</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("history")}
            className={`py-3.5 px-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === "history"
                ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            <FileText className="h-4 w-4" />
            <span>Purchase History</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-400">
              {purchaseHistory.length}
            </span>
          </button>
        </div>

        {/* Tab 1: Profile Information */}
        {activeTab === "info" && (
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Full Legal Name
                </h4>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-1">
                  {customer.name}
                </p>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Customer Status
                </h4>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-1 capitalize">
                  {customer.status}
                </p>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Phone Number
                </h4>
                <p className="text-sm text-gray-900 dark:text-gray-100 mt-1">
                  {customer.phone || "No phone number provided"}
                </p>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Email Address
                </h4>
                <p className="text-sm text-gray-900 dark:text-gray-100 mt-1">
                  {customer.email || "No email address provided"}
                </p>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Internal Remarks & Notes
              </h4>
              <p className="text-sm text-gray-700 dark:text-gray-300 mt-1 p-3 bg-gray-50 dark:bg-zinc-800/50 rounded-lg border border-gray-100 dark:border-zinc-800 min-h-[4rem] whitespace-pre-wrap">
                {customer.notes || "No notes recorded for this customer."}
              </p>
            </div>

            <div className="pt-4 border-t border-gray-100 dark:border-zinc-800 text-xs text-gray-400 flex flex-wrap gap-4">
              <span>Customer ID: <span className="font-mono">{customer.id}</span></span>
              <span>Updated: {new Date(customer.updatedAt).toLocaleString()}</span>
            </div>
          </div>
        )}

        {/* Tab 2: Purchase History */}
        {activeTab === "history" && (
          <div>
            {!canViewSales ? (
              <div className="py-12 px-4 text-center">
                <Lock className="mx-auto h-8 w-8 text-gray-400 mb-2" />
                <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Access Restricted
                </h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  You need the sales:read permission to view purchase transactions.
                </p>
              </div>
            ) : purchaseHistory.length === 0 ? (
              <div className="py-12 px-4 text-center">
                <ShoppingBag className="mx-auto h-8 w-8 text-gray-300 dark:text-zinc-600 mb-2" />
                <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  No purchases recorded
                </h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  This customer has not completed any sales transactions yet.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 dark:bg-zinc-800/60 border-b border-gray-200 dark:border-zinc-800 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    <tr>
                      <th scope="col" className="px-6 py-3">
                        Sale Number
                      </th>
                      <th scope="col" className="px-6 py-3">
                        Date
                      </th>
                      <th scope="col" className="px-6 py-3">
                        Subtotal
                      </th>
                      <th scope="col" className="px-6 py-3">
                        Discount
                      </th>
                      <th scope="col" className="px-6 py-3">
                        Tax
                      </th>
                      <th scope="col" className="px-6 py-3">
                        Total
                      </th>
                      <th scope="col" className="px-6 py-3">
                        Payment Status
                      </th>
                      <th scope="col" className="px-6 py-3">
                        Sale Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-zinc-800">
                    {purchaseHistory.map((sale) => {
                      const saleDate = new Date(sale.createdAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      });

                      return (
                        <tr
                          key={sale.id}
                          className="hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors"
                        >
                          <td className="px-6 py-3.5 font-mono text-xs font-medium text-gray-900 dark:text-gray-100">
                            {sale.saleNumber}
                          </td>
                          <td className="px-6 py-3.5 text-xs text-gray-500 dark:text-gray-400">
                            {saleDate}
                          </td>
                          <td className="px-6 py-3.5 text-xs text-gray-700 dark:text-gray-300">
                            ${sale.subtotal.toFixed(2)}
                          </td>
                          <td className="px-6 py-3.5 text-xs text-gray-500 dark:text-gray-400">
                            {sale.orderDiscountAmount > 0 ? `-$${sale.orderDiscountAmount.toFixed(2)}` : "—"}
                          </td>
                          <td className="px-6 py-3.5 text-xs text-gray-500 dark:text-gray-400">
                            ${sale.taxAmount.toFixed(2)}
                          </td>
                          <td className="px-6 py-3.5 text-xs font-semibold text-gray-900 dark:text-gray-100">
                            ${sale.totalAmount.toFixed(2)}
                          </td>
                          <td className="px-6 py-3.5">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 capitalize">
                              {sale.paymentStatus.replace("_", " ")}
                            </span>
                          </td>
                          <td className="px-6 py-3.5">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${
                                sale.status === "completed"
                                  ? "bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-300"
                                  : "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                              }`}
                            >
                              {sale.status.replace("_", " ")}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit Customer Modal */}
      {isEditOpen && (
        <CustomerForm
          isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)}
          slug={slug}
          customer={customer}
          onSuccess={() => {
            startTransition(() => {
              router.refresh();
            });
          }}
        />
      )}

      {/* Archive Confirmation Dialog */}
      {isArchivingOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="detail-archive-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
        >
          <div
            className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-gray-200 dark:border-zinc-800 p-6 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="p-2 bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 rounded-lg shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3
                  id="detail-archive-title"
                  className="text-base font-semibold text-gray-900 dark:text-gray-100"
                >
                  Archive Customer Profile
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Are you sure you want to archive <strong>{customer.name}</strong>?
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Archived customers cannot be selected for new sales, but all historical purchase records remain intact.
                </p>
              </div>
            </div>

            {archiveError && (
              <div
                role="alert"
                className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 p-2.5 rounded-lg border border-red-200 dark:border-red-900"
              >
                {archiveError}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="outline"
                disabled={isArchiving}
                onClick={() => setIsArchivingOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={isArchiving}
                onClick={handleArchiveConfirm}
                isLoading={isArchiving}
              >
                {isArchiving ? "Archiving..." : "Archive Customer"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
