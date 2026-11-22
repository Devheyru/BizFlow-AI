"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  Filter,
  User,
  ShoppingBag,
  Eye,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Receipt,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/inventory/formatters";
import type { PaginatedSalesList, SaleListItem, SaleStatus, PaymentStatus } from "@/types/sales";

export interface SalesHistoryViewProps {
  slug: string;
  initialData: PaginatedSalesList;
  currency: string;
  cashiers?: Array<{ id: string; name: string }>;
}

export function SalesHistoryView({
  slug,
  initialData,
  currency,
  cashiers = [],
}: SalesHistoryViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Read current query params from URL
  const currentSearch = searchParams.get("search") || "";
  const currentStatus = searchParams.get("status") || "all";
  const currentCashierId = searchParams.get("cashierId") || "";
  const currentFromDate = searchParams.get("fromDate") || "";
  const currentToDate = searchParams.get("toDate") || "";
  const currentSortBy = searchParams.get("sortBy") || "created_at";
  const currentSortOrder = searchParams.get("sortOrder") || "desc";
  const currentPage = parseInt(searchParams.get("page") || "1", 10);

  // Local filter states
  const [searchTerm, setSearchTerm] = useState(currentSearch);
  const [status, setStatus] = useState(currentStatus);
  const [cashierId, setCashierId] = useState(currentCashierId);
  const [fromDate, setFromDate] = useState(currentFromDate);
  const [toDate, setToDate] = useState(currentToDate);
  const [sortBy, setSortBy] = useState(currentSortBy);
  const [sortOrder, setSortOrder] = useState(currentSortOrder);

  // Synchronize URL query params
  const applyFilters = (updates?: Partial<{
    search: string;
    status: string;
    cashierId: string;
    fromDate: string;
    toDate: string;
    sortBy: string;
    sortOrder: string;
    page: number;
  }>) => {
    const params = new URLSearchParams(searchParams.toString());

    const newSearch = updates?.search !== undefined ? updates.search : searchTerm;
    const newStatus = updates?.status !== undefined ? updates.status : status;
    const newCashier = updates?.cashierId !== undefined ? updates.cashierId : cashierId;
    const newFrom = updates?.fromDate !== undefined ? updates.fromDate : fromDate;
    const newTo = updates?.toDate !== undefined ? updates.toDate : toDate;
    const newSortBy = updates?.sortBy !== undefined ? updates.sortBy : sortBy;
    const newSortOrder = updates?.sortOrder !== undefined ? updates.sortOrder : sortOrder;
    const newPage = updates?.page !== undefined ? updates.page : 1;

    if (newSearch.trim()) params.set("search", newSearch.trim());
    else params.delete("search");

    if (newStatus && newStatus !== "all") params.set("status", newStatus);
    else params.delete("status");

    if (newCashier) params.set("cashierId", newCashier);
    else params.delete("cashierId");

    if (newFrom) params.set("fromDate", newFrom);
    else params.delete("fromDate");

    if (newTo) params.set("toDate", newTo);
    else params.delete("toDate");

    if (newSortBy && newSortBy !== "created_at") params.set("sortBy", newSortBy);
    else params.delete("sortBy");

    if (newSortOrder && newSortOrder !== "desc") params.set("sortOrder", newSortOrder);
    else params.delete("sortOrder");

    if (newPage > 1) params.set("page", String(newPage));
    else params.delete("page");

    startTransition(() => {
      router.push(`/${slug}/sales?${params.toString()}`);
    });
  };

  const handleReset = () => {
    setSearchTerm("");
    setStatus("all");
    setCashierId("");
    setFromDate("");
    setToDate("");
    setSortBy("created_at");
    setSortOrder("desc");

    startTransition(() => {
      router.push(`/${slug}/sales`);
    });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    applyFilters({ page: 1 });
  };

  // Status badge styling helper
  const renderStatusBadge = (saleStatus: SaleStatus) => {
    switch (saleStatus) {
      case "completed":
        return (
          <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700 ring-1 ring-inset ring-green-600/20 dark:bg-green-950/40 dark:text-green-300">
            Completed
          </span>
        );
      case "voided":
        return (
          <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-600/20 dark:bg-red-950/40 dark:text-red-300">
            Voided
          </span>
        );
      case "partially_returned":
        return (
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300">
            Partially Returned
          </span>
        );
      case "returned":
        return (
          <span className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-700 ring-1 ring-inset ring-purple-600/20 dark:bg-purple-950/40 dark:text-purple-300">
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
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300">
            Paid
          </span>
        );
      case "partially_refunded":
        return (
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300">
            Partially Refunded
          </span>
        );
      case "refunded":
        return (
          <span className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-700 ring-1 ring-inset ring-purple-600/20 dark:bg-purple-950/40 dark:text-purple-300">
            Refunded
          </span>
        );
      default:
        return <span>{payStatus}</span>;
    }
  };

  const totalSales = initialData.totalCount;
  const fromRecord = totalSales === 0 ? 0 : (currentPage - 1) * initialData.pageSize + 1;
  const toRecord = Math.min(currentPage * initialData.pageSize, totalSales);

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Receipt className="h-6 w-6 text-gray-700 dark:text-gray-300" />
            Sales History
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            View, search, filter, and inspect completed customer checkout transactions and thermal receipts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href={`/${slug}/pos`}>
            <Button className="gap-2">
              <ShoppingBag className="h-4 w-4" />
              New Sale (POS)
            </Button>
          </Link>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 space-y-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-col md:flex-row gap-3">
          {/* Sale Number Search Input */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Search by sale number (e.g. SAL-20261121)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>

          <Button type="submit" variant="secondary" className="gap-1.5 shrink-0">
            <Filter className="h-4 w-4" />
            Filter
          </Button>

          <Button
            type="button"
            variant="ghost"
            onClick={handleReset}
            className="gap-1.5 shrink-0 text-gray-500"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
        </form>

        {/* Secondary Filter Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-gray-100 dark:border-gray-800 text-xs">
          {/* Status Dropdown */}
          <div>
            <label className="block text-gray-500 mb-1 font-medium">Sale Status</label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                applyFilters({ status: e.target.value, page: 1 });
              }}
              className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="all">All Statuses</option>
              <option value="completed">Completed</option>
              <option value="voided">Voided</option>
              <option value="partially_returned">Partially Returned</option>
              <option value="returned">Returned</option>
            </select>
          </div>

          {/* Cashier Dropdown */}
          <div>
            <label className="block text-gray-500 mb-1 font-medium">Cashier / Staff</label>
            <select
              value={cashierId}
              onChange={(e) => {
                setCashierId(e.target.value);
                applyFilters({ cashierId: e.target.value, page: 1 });
              }}
              className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="">All Cashiers</option>
              {cashiers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* From Date */}
          <div>
            <label className="block text-gray-500 mb-1 font-medium">From Date</label>
            <Input
              type="date"
              value={fromDate ? fromDate.split("T")[0] : ""}
              onChange={(e) => {
                const val = e.target.value ? new Date(e.target.value).toISOString() : "";
                setFromDate(val);
                applyFilters({ fromDate: val, page: 1 });
              }}
              className="h-8 text-xs py-1"
            />
          </div>

          {/* To Date */}
          <div>
            <label className="block text-gray-500 mb-1 font-medium">To Date</label>
            <Input
              type="date"
              value={toDate ? toDate.split("T")[0] : ""}
              onChange={(e) => {
                const val = e.target.value ? new Date(e.target.value + "T23:59:59.999Z").toISOString() : "";
                setToDate(val);
                applyFilters({ toDate: val, page: 1 });
              }}
              className="h-8 text-xs py-1"
            />
          </div>
        </div>
      </div>

      {/* Transaction Table */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden dark:border-gray-800 dark:bg-gray-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-gray-600 dark:text-gray-400">
            <thead className="bg-gray-50 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:bg-gray-800/60 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
              <tr>
                <th scope="col" className="px-4 py-3">Sale #</th>
                <th scope="col" className="px-4 py-3">Date & Time</th>
                <th scope="col" className="px-4 py-3">Customer</th>
                <th scope="col" className="px-4 py-3">Cashier</th>
                <th scope="col" className="px-4 py-3">Items</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3 text-right">Total Amount</th>
                <th scope="col" className="px-4 py-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {initialData.items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-sm text-gray-500">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <FileText className="h-8 w-8 text-gray-400" />
                      <p className="font-medium text-gray-700 dark:text-gray-300">
                        No sales found
                      </p>
                      <p className="text-xs text-gray-400">
                        Try adjusting your filters, date range, or search criteria.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                initialData.items.map((sale: SaleListItem) => (
                  <tr
                    key={sale.id}
                    className="hover:bg-gray-50/70 transition-colors dark:hover:bg-gray-800/40"
                  >
                    <td className="px-4 py-3 font-mono font-medium text-gray-900 dark:text-gray-100">
                      <Link
                        href={`/${slug}/sales/${sale.id}`}
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {sale.saleNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                      {new Date(sale.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-3 text-gray-900 dark:text-gray-100 font-medium">
                      {sale.customerName ? (
                        <span className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-gray-400" />
                          {sale.customerName}
                        </span>
                      ) : (
                        <span className="text-gray-400 italic">Walk-in</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {sale.cashierName || "Staff"}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {sale.itemsCount} {sale.itemsCount === 1 ? "item" : "items"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1 items-start">
                        {renderStatusBadge(sale.status)}
                        {renderPaymentBadge(sale.paymentStatus)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-gray-100">
                      {formatCurrency(sale.totalAmount, sale.currency || currency)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Link href={`/${slug}/sales/${sale.id}`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
                          title="View sale details"
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          Details
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {initialData.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-800 text-xs">
            <div className="text-gray-500">
              Showing <span className="font-semibold text-gray-900 dark:text-gray-100">{fromRecord}</span> to{" "}
              <span className="font-semibold text-gray-900 dark:text-gray-100">{toRecord}</span> of{" "}
              <span className="font-semibold text-gray-900 dark:text-gray-100">{totalSales}</span> transactions
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1 || isPending}
                onClick={() => applyFilters({ page: currentPage - 1 })}
                className="gap-1 h-8"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <span className="px-2 font-medium text-gray-700 dark:text-gray-300">
                {currentPage} / {initialData.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= initialData.totalPages || isPending}
                onClick={() => applyFilters({ page: currentPage + 1 })}
                className="gap-1 h-8"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
