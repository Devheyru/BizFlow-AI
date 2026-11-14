"use client";

import React, { useState, useEffect, useCallback, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  History,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  User,
  ArrowRight,
} from "lucide-react";
import type { MovementHistoryRow, MovementType } from "@/types/inventory";
import {
  formatStockQuantity,
  formatCurrency,
} from "@/lib/inventory/formatters";
import { Button } from "@/components/ui/button";

export interface ProductOption {
  id: string;
  name: string;
  sku: string;
}

export interface MovementHistoryFilters {
  productId?: string;
  movementType?: string;
  fromDate?: string;
  toDate?: string;
}

export interface MovementHistoryTableProps {
  items: MovementHistoryRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /**
   * Server-computed boolean indicating whether the caller holds BOTH
   * `inventory:read_valuation` AND `products:read_cost`.
   * Component NEVER re-evaluates permissions.
   * When false, valuation columns are completely omitted from the table DOM.
   */
  canViewValuation: boolean;
  currency?: string;
  products?: ProductOption[];
  currentFilters?: MovementHistoryFilters;
  slug: string;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const MOVEMENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All Movement Types" },
  { value: "initial", label: "Opening Stock" },
  { value: "restock", label: "Restock" },
  { value: "adjustment", label: "Stock Adjustment" },
  { value: "damage", label: "Damage Write-off" },
  { value: "loss", label: "Loss / Theft" },
  { value: "internal_use", label: "Internal Use" },
  { value: "sale", label: "Sale" },
  { value: "return", label: "Customer Return" },
];

function getMovementTypeBadge(type: MovementType): { label: string; className: string } {
  switch (type) {
    case "initial":
      return {
        label: "Opening Stock",
        className:
          "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-800",
      };
    case "restock":
      return {
        label: "Restock",
        className:
          "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800",
      };
    case "adjustment":
      return {
        label: "Adjustment",
        className:
          "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-400 dark:border-sky-800",
      };
    case "damage":
      return {
        label: "Damage",
        className:
          "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800",
      };
    case "loss":
      return {
        label: "Loss / Theft",
        className:
          "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800",
      };
    case "internal_use":
      return {
        label: "Internal Use",
        className:
          "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800",
      };
    case "sale":
      return {
        label: "Sale",
        className:
          "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-400 dark:border-teal-800",
      };
    case "return":
      return {
        label: "Return",
        className:
          "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-400 dark:border-cyan-800",
      };
    default:
      return {
        label: type,
        className:
          "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700",
      };
  }
}

function formatDateTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return isoString;
  }
}

/**
 * Filterable Movement History Audit Ledger Table (T032, US5, Phase 8).
 *
 * Implements:
 * - Reverse-chronological audit trail of all inventory stock movements.
 * - Multi-criteria filter controls (Product, Movement Type, From Date, To Date).
 * - Full server-synced URL search parameter state.
 * - Protected acquisition cost columns: Unit Cost and Total Cost are completely
 *   omitted from the DOM when `canViewValuation` prop is false.
 * - Visual badges for movement types and color-coded signed quantity deltas.
 * - Balance progression indicator (before -> after).
 * - Pagination controls (previous/next buttons, page size selector).
 * - Empty state with filter reset action.
 */
export function MovementHistoryTable({
  items,
  totalCount,
  page,
  pageSize,
  totalPages,
  canViewValuation,
  currency = "USD",
  products = [],
  currentFilters = {},
  slug: _slug,
}: MovementHistoryTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [selectedProductId, setSelectedProductId] = useState(
    currentFilters.productId || "all"
  );
  const [selectedMovementType, setSelectedMovementType] = useState(
    currentFilters.movementType || "all"
  );
  const [fromDateInput, setFromDateInput] = useState(
    currentFilters.fromDate || ""
  );
  const [toDateInput, setToDateInput] = useState(
    currentFilters.toDate || ""
  );

  // Sync internal state if URL parameters change externally
  useEffect(() => {
    setSelectedProductId(currentFilters.productId || "all");
    setSelectedMovementType(currentFilters.movementType || "all");
    setFromDateInput(currentFilters.fromDate || "");
    setToDateInput(currentFilters.toDate || "");
  }, [
    currentFilters.productId,
    currentFilters.movementType,
    currentFilters.fromDate,
    currentFilters.toDate,
  ]);

  // Centralized filter update helper
  const updateFilters = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());

      // Reset to page 1 on filter modification
      params.delete("page");

      for (const [key, value] of Object.entries(updates)) {
        if (!value || value === "all" || value.trim() === "") {
          params.delete(key);
        } else {
          params.set(key, value.trim());
        }
      }

      startTransition(() => {
        const qs = params.toString();
        router.push(qs ? `${pathname}?${qs}` : pathname);
      });
    },
    [searchParams, pathname, router]
  );

  const handleProductChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedProductId(val);
    updateFilters({ productId: val });
  };

  const handleMovementTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedMovementType(val);
    updateFilters({ movementType: val });
  };

  const handleFromDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setFromDateInput(val);
    updateFilters({ fromDate: val });
  };

  const handleToDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setToDateInput(val);
    updateFilters({ toDate: val });
  };

  const handleClearFilters = () => {
    setSelectedProductId("all");
    setSelectedMovementType("all");
    setFromDateInput("");
    setToDateInput("");
    startTransition(() => {
      router.push(pathname);
    });
  };

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(newPage));
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const handlePageSizeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newPageSize = e.target.value;
    const params = new URLSearchParams(searchParams.toString());
    params.set("pageSize", newPageSize);
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const hasActiveFilters = Boolean(
    (currentFilters.productId && currentFilters.productId !== "all") ||
      (currentFilters.movementType && currentFilters.movementType !== "all") ||
      currentFilters.fromDate ||
      currentFilters.toDate
  );

  const startRecord = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRecord = Math.min(page * pageSize, totalCount);

  return (
    <div className="space-y-4" data-testid="movement-history-table-container">
      {/* Filter Toolbar */}
      <div
        className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 shadow-sm"
        data-testid="movement-history-filters"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Product Filter */}
          <div>
            <label
              htmlFor="filter-product-select"
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Product
            </label>
            <select
              id="filter-product-select"
              value={selectedProductId}
              onChange={handleProductChange}
              disabled={isPending}
              className="w-full text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              data-testid="filter-product-select"
            >
              <option value="all">All Products</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku})
                </option>
              ))}
            </select>
          </div>

          {/* Movement Type Filter */}
          <div>
            <label
              htmlFor="filter-type-select"
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Movement Type
            </label>
            <select
              id="filter-type-select"
              value={selectedMovementType}
              onChange={handleMovementTypeChange}
              disabled={isPending}
              className="w-full text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              data-testid="filter-type-select"
            >
              {MOVEMENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Date From Filter */}
          <div>
            <label
              htmlFor="filter-from-date"
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              From Date
            </label>
            <input
              type="date"
              id="filter-from-date"
              value={fromDateInput}
              onChange={handleFromDateChange}
              disabled={isPending}
              className="w-full text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              data-testid="filter-from-date"
            />
          </div>

          {/* Date To Filter */}
          <div>
            <label
              htmlFor="filter-to-date"
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              To Date
            </label>
            <input
              type="date"
              id="filter-to-date"
              value={toDateInput}
              onChange={handleToDateChange}
              disabled={isPending}
              className="w-full text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              data-testid="filter-to-date"
            />
          </div>
        </div>

        {/* Clear Filters Toolbar Row */}
        {hasActiveFilters && (
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearFilters}
              disabled={isPending}
              className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
              data-testid="filter-reset-btn"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Reset Filters
            </Button>
          </div>
        )}
      </div>

      {/* Main Table or Empty State */}
      {items.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-16 px-4 text-center rounded-xl border border-dashed border-gray-300 dark:border-gray-800 bg-white dark:bg-gray-900/50"
          data-testid="movement-history-empty-state"
        >
          <div className="h-12 w-12 rounded-full bg-blue-50 dark:bg-blue-950/60 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-4">
            <History className="h-6 w-6" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {hasActiveFilters
              ? "No matching movement history"
              : "No stock movements recorded"}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm">
            {hasActiveFilters
              ? "No stock movements match your selected filter criteria. Try adjusting your product, movement type, or date range."
              : "No stock movements have been recorded yet. Restocks, adjustments, and initial opening stock will appear here."}
          </p>
          {hasActiveFilters && (
            <div className="mt-5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClearFilters}
                data-testid="empty-clear-filters-btn"
              >
                Reset Filters
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
          <table
            className="min-w-full divide-y divide-gray-200 dark:divide-gray-800 text-left text-sm"
            data-testid="movement-history-table"
          >
            <thead className="bg-gray-50 dark:bg-gray-950/70 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              <tr>
                <th scope="col" className="py-3.5 pl-4 pr-3 sm:pl-6">
                  Date & Time
                </th>
                <th scope="col" className="px-3 py-3.5">
                  Product
                </th>
                <th scope="col" className="px-3 py-3.5">
                  Type
                </th>
                <th scope="col" className="px-3 py-3.5 text-right">
                  Delta
                </th>
                <th scope="col" className="px-3 py-3.5 text-center">
                  Balance
                </th>
                {canViewValuation && (
                  <>
                    <th
                      scope="col"
                      className="px-3 py-3.5 text-right"
                      data-testid="col-unit-cost"
                    >
                      Unit Cost
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-3.5 text-right"
                      data-testid="col-total-cost"
                    >
                      Total Cost
                    </th>
                  </>
                )}
                <th scope="col" className="px-3 py-3.5">
                  Reason
                </th>
                <th scope="col" className="px-3 py-3.5">
                  Reference
                </th>
                <th scope="col" className="px-3 py-3.5 pr-4 sm:pr-6">
                  Performed By
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200">
              {items.map((row) => {
                const badge = getMovementTypeBadge(row.movementType);
                const hasCost = canViewValuation && row.unitCost !== null;
                const totalCost = hasCost
                  ? Math.abs(row.quantityDelta) * (row.unitCost ?? 0)
                  : null;

                return (
                  <tr
                    key={row.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                    data-testid={`history-row-${row.id}`}
                  >
                    {/* Date & Time */}
                    <td className="whitespace-nowrap py-4 pl-4 pr-3 sm:pl-6 text-xs text-gray-600 dark:text-gray-400">
                      <span title={row.createdAt}>
                        {formatDateTime(row.createdAt)}
                      </span>
                    </td>

                    {/* Product Name & SKU */}
                    <td className="whitespace-nowrap px-3 py-4">
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {row.productName}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        SKU: {row.sku}
                      </div>
                    </td>

                    {/* Movement Type Badge */}
                    <td className="whitespace-nowrap px-3 py-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${badge.className}`}
                        data-testid={`movement-type-badge-${row.id}`}
                      >
                        {badge.label}
                      </span>
                    </td>

                    {/* Quantity Delta */}
                    <td
                      className="whitespace-nowrap px-3 py-4 text-right text-xs"
                      data-testid={`quantity-delta-${row.id}`}
                    >
                      {row.quantityDelta > 0 ? (
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          +{formatStockQuantity(row.quantityDelta)}
                        </span>
                      ) : row.quantityDelta < 0 ? (
                        <span className="font-semibold text-red-600 dark:text-red-400">
                          {formatStockQuantity(row.quantityDelta)}
                        </span>
                      ) : (
                        <span className="font-medium text-gray-500 dark:text-gray-400">
                          {formatStockQuantity(row.quantityDelta)}
                        </span>
                      )}
                    </td>

                    {/* Balance Before -> After */}
                    <td className="whitespace-nowrap px-3 py-4 text-center text-xs text-gray-500 dark:text-gray-400">
                      <span className="inline-flex items-center gap-1 font-mono">
                        <span>{formatStockQuantity(row.quantityBefore)}</span>
                        <ArrowRight className="h-3 w-3 text-gray-400" />
                        <span className="font-semibold text-gray-800 dark:text-gray-200">
                          {formatStockQuantity(row.quantityAfter)}
                        </span>
                      </span>
                    </td>

                    {/* Unit Cost & Total Cost (Gated by canViewValuation) */}
                    {canViewValuation && (
                      <>
                        <td
                          className="whitespace-nowrap px-3 py-4 text-right text-xs text-gray-700 dark:text-gray-300"
                          data-testid={`unit-cost-${row.id}`}
                        >
                          {row.unitCost !== null
                            ? formatCurrency(row.unitCost, row.currency || currency)
                            : "—"}
                        </td>
                        <td
                          className="whitespace-nowrap px-3 py-4 text-right text-xs font-medium text-gray-900 dark:text-gray-100"
                          data-testid={`total-cost-${row.id}`}
                        >
                          {totalCost !== null
                            ? formatCurrency(totalCost, row.currency || currency)
                            : "—"}
                        </td>
                      </>
                    )}

                    {/* Reason */}
                    <td className="px-3 py-4 text-xs text-gray-600 dark:text-gray-300 max-w-xs truncate" title={row.reason}>
                      {row.reason}
                    </td>

                    {/* Reference ID */}
                    <td className="whitespace-nowrap px-3 py-4 text-xs">
                      {row.referenceId ? (
                        <span className="font-mono text-xs text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700">
                          {row.referenceId}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>

                    {/* Performed By */}
                    <td className="whitespace-nowrap px-3 py-4 pr-4 sm:pr-6 text-xs text-gray-600 dark:text-gray-300">
                      <div className="inline-flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                        <span>{row.performedBy.fullName || "System"}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Controls */}
      {items.length > 0 && (
        <div
          className="flex flex-col sm:flex-row items-center justify-between gap-4 py-3 px-2 text-xs text-gray-600 dark:text-gray-400"
          data-testid="movement-history-pagination"
        >
          {/* Record range */}
          <div>
            Showing <span className="font-medium text-gray-900 dark:text-gray-100">{startRecord}</span> to{" "}
            <span className="font-medium text-gray-900 dark:text-gray-100">{endRecord}</span> of{" "}
            <span className="font-medium text-gray-900 dark:text-gray-100">{totalCount}</span> movements
          </div>

          <div className="flex items-center gap-4">
            {/* Page Size Selector */}
            <div className="flex items-center gap-2">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={handlePageSizeChange}
                disabled={isPending}
                className="rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                data-testid="pagination-page-size-select"
              >
                {PAGE_SIZE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            {/* Page indicator & Next/Prev buttons */}
            <div className="flex items-center gap-1">
              <span className="mr-2">
                Page <span className="font-medium">{page}</span> of{" "}
                <span className="font-medium">{totalPages}</span>
              </span>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1 || isPending}
                className="h-8 w-8 p-0"
                data-testid="pagination-prev-btn"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages || isPending}
                className="h-8 w-8 p-0"
                data-testid="pagination-next-btn"
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
