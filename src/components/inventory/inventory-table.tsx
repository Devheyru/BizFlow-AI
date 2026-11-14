"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Package,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  PlusCircle,
  PackagePlus,
  SlidersHorizontal,
  Target,
  ClipboardCheck,
} from "lucide-react";
import type { InventoryItemRow } from "@/types/inventory";
import {
  formatStockQuantity,
  formatQuantityWithUom,
  formatCurrency,
  getStockStatusBadge,
} from "@/lib/inventory/formatters";
import { Button } from "@/components/ui/button";
import { RestockModal } from "@/components/inventory/restock-modal";
import { AdjustStockModal } from "@/components/inventory/adjust-stock-modal";
import { StocktakeModal } from "@/components/inventory/stocktake-modal";
import { ReorderThresholdModal } from "@/components/inventory/reorder-threshold-modal";

export type InventorySortField = "name" | "sku" | "quantity" | "stock_status";
export type SortDirection = "asc" | "desc";

export interface InventoryTableProps {
  items: InventoryItemRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /**
   * Server-computed boolean indicating whether the caller holds BOTH
   * `inventory:read_valuation` AND `products:read_cost`.
   * When false, valuation columns are completely omitted from the table DOM.
   */
  canViewValuation: boolean;
  canReceiveStock?: boolean;
  canAdjustStock?: boolean;
  currency?: string;
  sortBy?: InventorySortField;
  sortOrder?: SortDirection;
  slug: string;
  hasActiveFilters?: boolean;
  onRestockClick?: (item: InventoryItemRow) => void;
  onInitialStockClick?: (item: InventoryItemRow) => void;
  onAdjustClick?: (item: InventoryItemRow) => void;
  onStocktakeClick?: (item: InventoryItemRow) => void;
  onThresholdClick?: (item: InventoryItemRow) => void;
}

const PAGE_SIZE_OPTIONS = [10, 20, 25, 50, 100];

/**
 * Inventory Table Component (T022, FR-INV-001, FR-INV-003, FR-INV-020, US1).
 *
 * Implements:
 * - Paginated and sortable inventory table.
 * - Stock status badges: `In Stock`, `Low Stock`, `Out of Stock`, and `[Archived]`.
 * - Deterministic priority sort: `out_of_stock = 1`, `low_stock = 2`, `in_stock = 3`.
 * - Reorder alert row highlighting (amber for low stock, red for out of stock).
 * - Valuation column gating: Unit Cost and Total Value are strictly omitted if canViewValuation is false.
 * - Action triggers for stock movements (ready for Phase 5 integration).
 */
export function InventoryTable({
  items,
  totalCount,
  page,
  pageSize,
  totalPages,
  canViewValuation,
  canReceiveStock = false,
  canAdjustStock = false,
  currency = "USD",
  sortBy = "stock_status",
  sortOrder = "asc",
  slug,
  hasActiveFilters = false,
  onRestockClick,
  onInitialStockClick,
  onAdjustClick,
  onStocktakeClick,
  onThresholdClick,
}: InventoryTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [restockItem, setRestockItem] = useState<InventoryItemRow | null>(null);
  const [adjustItem, setAdjustItem] = useState<InventoryItemRow | null>(null);
  const [stocktakeItem, setStocktakeItem] = useState<InventoryItemRow | null>(null);
  const [thresholdItem, setThresholdItem] = useState<InventoryItemRow | null>(null);
  const [modalMode, setModalMode] = useState<"restock" | "initial">("restock");

  // Handle column header sorting
  const handleSort = (field: InventorySortField) => {
    const params = new URLSearchParams(searchParams.toString());
    const isCurrentField = sortBy === field;
    const nextOrder: SortDirection =
      isCurrentField && sortOrder === "asc" ? "desc" : "asc";

    params.set("sortBy", field);
    params.set("sortOrder", nextOrder);
    params.delete("page"); // Reset to page 1 on sort change

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  // Handle page navigation
  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages || newPage === page) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(newPage));

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  // Handle page size change
  const handlePageSizeChange = (newPageSize: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("pageSize", String(newPageSize));
    params.delete("page"); // Reset to page 1

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  // Handle clearing active filters
  const handleClearFilters = () => {
    startTransition(() => {
      router.push(pathname);
    });
  };

  const renderSortIcon = (field: InventorySortField) => {
    if (sortBy !== field) {
      return (
        <ArrowUpDown className="h-3.5 w-3.5 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300" />
      );
    }
    return sortOrder === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
    );
  };

  // Helper for row background highlight
  const getRowHighlightClass = (item: InventoryItemRow) => {
    if (item.productStatus === "archived") {
      return "opacity-70 bg-gray-50/50 dark:bg-gray-900/30 border-l-4 border-l-gray-300 dark:border-l-gray-700";
    }
    if (item.stockStatus === "out_of_stock") {
      return "bg-red-50/30 dark:bg-red-950/15 border-l-4 border-l-red-500";
    }
    if (item.stockStatus === "low_stock") {
      return "bg-amber-50/25 dark:bg-amber-950/10 border-l-4 border-l-amber-500";
    }
    return "border-l-4 border-l-transparent";
  };

  // Helper for stock status badge rendering
  const renderStockStatusBadge = (item: InventoryItemRow) => {
    if (item.productStatus === "archived") {
      return (
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700"
          data-testid={`stock-status-badge-${item.productId}`}
        >
          [Archived]
        </span>
      );
    }

    const { label, variant } = getStockStatusBadge(item.stockStatus);
    const colorClasses =
      variant === "destructive"
        ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800"
        : variant === "warning"
        ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800"
        : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800";

    return (
      <span
        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${colorClasses}`}
        data-testid={`stock-status-badge-${item.productId}`}
      >
        {variant === "destructive" && (
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        )}
        {variant === "warning" && (
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        )}
        {variant === "default" && (
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        )}
        <span>{label}</span>
      </span>
    );
  };

  // Empty state handling
  if (items.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-16 px-4 text-center rounded-xl border border-dashed border-gray-300 dark:border-gray-800 bg-white dark:bg-gray-900/50"
        data-testid="inventory-empty-state"
      >
        <div className="h-12 w-12 rounded-full bg-blue-50 dark:bg-blue-950/60 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-4">
          <Package className="h-6 w-6" aria-hidden="true" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {hasActiveFilters ? "No matching inventory" : "No inventory tracked"}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm">
          {hasActiveFilters
            ? "No inventory items match your current search and filter criteria. Try adjusting your query or resetting filters."
            : "No inventory records are currently tracked in this organization. Catalog products will automatically appear here."}
        </p>
        {hasActiveFilters && (
          <div className="mt-5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClearFilters}
              data-testid="inventory-clear-filters-btn"
            >
              Reset Filters
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Calculate pagination record range
  const startRecord = (page - 1) * pageSize + 1;
  const endRecord = Math.min(page * pageSize, totalCount);

  return (
    <div className="space-y-4" data-testid="inventory-table-container">
      {/* Table Container */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
        <table
          className="min-w-full divide-y divide-gray-200 dark:divide-gray-800 text-left text-sm"
          data-testid="inventory-table"
        >
          <thead className="bg-gray-50 dark:bg-gray-950/70 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
            <tr>
              {/* Product Column */}
              <th scope="col" className="py-3.5 pl-4 pr-3 sm:pl-6">
                <button
                  type="button"
                  onClick={() => handleSort("name")}
                  className="group inline-flex items-center gap-1.5 focus:outline-none"
                  data-testid="sort-by-name-btn"
                >
                  <span>Product</span>
                  {renderSortIcon("name")}
                </button>
              </th>

              {/* SKU Column */}
              <th scope="col" className="px-3 py-3.5">
                <button
                  type="button"
                  onClick={() => handleSort("sku")}
                  className="group inline-flex items-center gap-1.5 focus:outline-none"
                  data-testid="sort-by-sku-btn"
                >
                  <span>SKU</span>
                  {renderSortIcon("sku")}
                </button>
              </th>

              {/* Barcode (hidden on mobile) */}
              <th scope="col" className="px-3 py-3.5 hidden md:table-cell">
                Barcode
              </th>

              {/* Category */}
              <th scope="col" className="px-3 py-3.5 hidden sm:table-cell">
                Category
              </th>

              {/* Status */}
              <th scope="col" className="px-3 py-3.5">
                Status
              </th>

              {/* Stock Status (Priority Sorted) */}
              <th scope="col" className="px-3 py-3.5 text-center">
                <button
                  type="button"
                  onClick={() => handleSort("stock_status")}
                  className="group inline-flex items-center gap-1.5 focus:outline-none justify-center w-full"
                  data-testid="sort-by-stock-status-btn"
                >
                  <span>Stock Status</span>
                  {renderSortIcon("stock_status")}
                </button>
              </th>

              {/* On-Hand Quantity */}
              <th scope="col" className="px-3 py-3.5 text-right">
                <button
                  type="button"
                  onClick={() => handleSort("quantity")}
                  className="group inline-flex items-center gap-1.5 focus:outline-none justify-end w-full"
                  data-testid="sort-by-quantity-btn"
                >
                  <span>On Hand</span>
                  {renderSortIcon("quantity")}
                </button>
              </th>

              {/* Reorder Thresholds */}
              <th scope="col" className="px-3 py-3.5 text-right hidden lg:table-cell">
                Reorder Point
              </th>
              <th scope="col" className="px-3 py-3.5 text-right hidden xl:table-cell">
                Reorder Qty
              </th>

              {/* Protected Valuation Columns (strictly gated by canViewValuation) */}
              {canViewValuation && (
                <>
                  <th
                    scope="col"
                    className="px-3 py-3.5 text-right"
                    data-testid="valuation-th-unit-cost"
                  >
                    Unit Cost
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-3.5 text-right"
                    data-testid="valuation-th-total-value"
                  >
                    Total Value
                  </th>
                </>
              )}

              {/* Actions Column */}
              <th scope="col" className="py-3.5 pl-3 pr-4 sm:pr-6 text-right">
                Actions
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
            {items.map((item) => {
              const highlightClass = getRowHighlightClass(item);

              return (
                <tr
                  key={item.productId}
                  className={`hover:bg-gray-50/80 dark:hover:bg-gray-800/40 transition-colors ${highlightClass}`}
                  data-testid={`inventory-row-${item.productId}`}
                >
                  {/* Product Name */}
                  <td className="py-3.5 pl-4 pr-3 sm:pl-6">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 shrink-0 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center">
                        <Package className="h-4.5 w-4.5 text-gray-400" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <Link
                          href={`/${slug}/products/${item.productId}`}
                          className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors truncate block max-w-xs"
                          data-testid={`product-link-${item.productId}`}
                        >
                          {item.productName}
                        </Link>
                        <span className="text-xs text-gray-500 dark:text-gray-400 block sm:hidden">
                          {item.sku}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* SKU */}
                  <td className="px-3 py-3.5 whitespace-nowrap font-mono text-xs font-semibold text-gray-700 dark:text-gray-300">
                    {item.sku}
                  </td>

                  {/* Barcode */}
                  <td className="px-3 py-3.5 whitespace-nowrap font-mono text-xs text-gray-500 dark:text-gray-400 hidden md:table-cell">
                    {item.barcode || "—"}
                  </td>

                  {/* Category */}
                  <td className="px-3 py-3.5 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300 hidden sm:table-cell">
                    {item.categoryName ? (
                      <span>{item.categoryName}</span>
                    ) : (
                      <span className="italic text-gray-400 dark:text-gray-500">
                        Uncategorized
                      </span>
                    )}
                  </td>

                  {/* Product Lifecycle Status */}
                  <td className="px-3 py-3.5 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize border ${
                        item.productStatus === "active"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800"
                          : item.productStatus === "inactive"
                          ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800"
                          : "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700"
                      }`}
                    >
                      {item.productStatus}
                    </span>
                  </td>

                  {/* Stock Status Badge */}
                  <td className="px-3 py-3.5 whitespace-nowrap text-center">
                    {renderStockStatusBadge(item)}
                  </td>

                  {/* On-Hand Quantity */}
                  <td className="px-3 py-3.5 whitespace-nowrap text-right font-medium">
                    <div
                      className={`font-semibold ${
                        item.quantity <= 0
                          ? "text-red-600 dark:text-red-400"
                          : item.stockStatus === "low_stock"
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-gray-900 dark:text-gray-100"
                      }`}
                      data-testid={`inventory-quantity-${item.productId}`}
                    >
                      {formatStockQuantity(item.quantity, item.isDiscrete)}{" "}
                      <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                        {item.unitOfMeasure}
                      </span>
                    </div>
                  </td>

                  {/* Reorder Point */}
                  <td className="px-3 py-3.5 whitespace-nowrap text-right text-xs text-gray-600 dark:text-gray-400 hidden lg:table-cell">
                    {item.reorderPoint !== null
                      ? formatQuantityWithUom(
                          item.reorderPoint,
                          item.unitOfMeasure,
                          item.isDiscrete
                        )
                      : "—"}
                  </td>

                  {/* Reorder Quantity */}
                  <td className="px-3 py-3.5 whitespace-nowrap text-right text-xs text-gray-600 dark:text-gray-400 hidden xl:table-cell">
                    {item.reorderQuantity !== null
                      ? formatQuantityWithUom(
                          item.reorderQuantity,
                          item.unitOfMeasure,
                          item.isDiscrete
                        )
                      : "—"}
                  </td>

                  {/* Protected Unit Cost (gated by canViewValuation) */}
                  {canViewValuation && (
                    <td
                      className="px-3 py-3.5 whitespace-nowrap text-right text-xs font-mono text-gray-600 dark:text-gray-400"
                      data-testid={`valuation-td-unit-cost-${item.productId}`}
                    >
                      {item.unitCost !== null
                        ? formatCurrency(item.unitCost, item.currency || currency)
                        : "—"}
                    </td>
                  )}

                  {/* Protected Total Value (gated by canViewValuation) */}
                  {canViewValuation && (
                    <td
                      className="px-3 py-3.5 whitespace-nowrap text-right text-xs font-semibold text-gray-900 dark:text-gray-100"
                      data-testid={`valuation-td-total-value-${item.productId}`}
                    >
                      {item.totalValue !== null
                        ? formatCurrency(item.totalValue, item.currency || currency)
                        : "—"}
                    </td>
                  )}

                  {/* Action Buttons */}
                  <td className="py-3.5 pl-3 pr-4 sm:pr-6 whitespace-nowrap text-right text-xs">
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Initial Stock trigger slot (T025, US3) */}
                      {canReceiveStock &&
                        item.productStatus === "active" &&
                        item.quantity === 0 &&
                        !item.hasInitialMovement && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                            onClick={() => {
                              setModalMode("initial");
                              setRestockItem(item);
                              onInitialStockClick?.(item);
                            }}
                            title="Opening Stock"
                            data-testid={`initial-stock-btn-${item.productId}`}
                          >
                            <PackagePlus className="h-4 w-4" />
                            <span className="hidden md:inline ml-1 text-xs">Opening Stock</span>
                          </Button>
                        )}

                      {/* Restock trigger slot (T024, US2) */}
                      {canReceiveStock && item.productStatus === "active" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                          onClick={() => {
                            setModalMode("restock");
                            setRestockItem(item);
                            onRestockClick?.(item);
                          }}
                          title="Receive Stock"
                          data-testid={`restock-btn-${item.productId}`}
                        >
                          <PlusCircle className="h-4 w-4" />
                          <span className="hidden md:inline ml-1 text-xs">Restock</span>
                        </Button>
                      )}

                      {/* Adjust trigger slot (T026, T030, US4) */}
                      {canAdjustStock && item.productStatus !== "archived" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                          onClick={() => {
                            setAdjustItem(item);
                            onAdjustClick?.(item);
                          }}
                          title="Adjust Stock"
                          data-testid={`adjust-btn-${item.productId}`}
                        >
                          <SlidersHorizontal className="h-4 w-4" />
                          <span className="hidden md:inline ml-1 text-xs">Adjust</span>
                        </Button>
                      )}

                      {/* Stocktake trigger slot (T027, T030, US4) */}
                      {canAdjustStock && item.productStatus !== "archived" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                          onClick={() => {
                            setStocktakeItem(item);
                            onStocktakeClick?.(item);
                          }}
                          title="Cycle Count / Stocktake"
                          data-testid={`stocktake-btn-${item.productId}`}
                        >
                          <ClipboardCheck className="h-4 w-4" />
                          <span className="hidden md:inline ml-1 text-xs">Count</span>
                        </Button>
                      )}

                      {/* Thresholds trigger slot (T029, T030, US4) */}
                      {canAdjustStock && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
                          onClick={() => {
                            setThresholdItem(item);
                            onThresholdClick?.(item);
                          }}
                          title="Configure Reorder Thresholds"
                          data-testid={`thresholds-btn-${item.productId}`}
                        >
                          <Target className="h-4 w-4" />
                        </Button>
                      )}

                      {/* View Product Details link */}
                      <Link
                        href={`/${slug}/products/${item.productId}`}
                        className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-800 transition-colors"
                        title="View Product Details"
                        data-testid={`view-product-btn-${item.productId}`}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {totalCount > 0 && (
        <div
          className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 px-1"
          data-testid="inventory-pagination"
        >
          {/* Record range counter */}
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Showing{" "}
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              {startRecord}
            </span>{" "}
            to{" "}
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              {endRecord}
            </span>{" "}
            of{" "}
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              {totalCount}
            </span>{" "}
            products
          </div>

          {/* Page controls and Page Size selector */}
          <div className="flex items-center gap-3">
            {/* Page Size Selector */}
            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <label htmlFor="inventory-page-size-select">Per page:</label>
              <select
                id="inventory-page-size-select"
                value={pageSize}
                onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                className="h-8 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                data-testid="inventory-page-size-select"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>

            {/* Navigation Buttons */}
            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page <= 1 || isPending}
                  className="h-8 px-2.5 text-xs"
                  data-testid="inventory-prev-page-btn"
                >
                  Previous
                </Button>

                <span
                  className="text-xs text-gray-600 dark:text-gray-400 px-2"
                  data-testid="inventory-page-indicator"
                >
                  Page {page} of {totalPages}
                </span>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= totalPages || isPending}
                  className="h-8 px-2.5 text-xs"
                  data-testid="inventory-next-page-btn"
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Restock Modal (T024, US2) */}
      {restockItem && (
        <RestockModal
          isOpen={Boolean(restockItem)}
          onClose={() => setRestockItem(null)}
          slug={slug}
          productId={restockItem.productId}
          productName={restockItem.productName}
          sku={restockItem.sku}
          currentStock={restockItem.quantity}
          currentVersion={restockItem.version}
          unitOfMeasure={restockItem.unitOfMeasure}
          isDiscrete={restockItem.isDiscrete}
          productStatus={restockItem.productStatus}
          canReceiveStock={canReceiveStock}
          mode={modalMode}
          onRestockSuccess={(_result) => {
            startTransition(() => {
              router.refresh();
            });
          }}
        />
      )}

      {/* Adjust Stock Modal (T026, T030, US4) */}
      {adjustItem && (
        <AdjustStockModal
          isOpen={Boolean(adjustItem)}
          onClose={() => setAdjustItem(null)}
          slug={slug}
          productId={adjustItem.productId}
          productName={adjustItem.productName}
          sku={adjustItem.sku}
          currentStock={adjustItem.quantity}
          currentVersion={adjustItem.version}
          unitOfMeasure={adjustItem.unitOfMeasure}
          isDiscrete={adjustItem.isDiscrete}
          productStatus={adjustItem.productStatus}
          canAdjustStock={canAdjustStock}
          onAdjustmentSuccess={(_result) => {
            startTransition(() => {
              router.refresh();
            });
          }}
        />
      )}

      {/* Stocktake Modal (T027, T030, US4) */}
      {stocktakeItem && (
        <StocktakeModal
          isOpen={Boolean(stocktakeItem)}
          onClose={() => setStocktakeItem(null)}
          slug={slug}
          productId={stocktakeItem.productId}
          productName={stocktakeItem.productName}
          sku={stocktakeItem.sku}
          currentStock={stocktakeItem.quantity}
          currentVersion={stocktakeItem.version}
          unitOfMeasure={stocktakeItem.unitOfMeasure}
          isDiscrete={stocktakeItem.isDiscrete}
          productStatus={stocktakeItem.productStatus}
          canAdjustStock={canAdjustStock}
          onStocktakeSuccess={(_result) => {
            startTransition(() => {
              router.refresh();
            });
          }}
        />
      )}

      {/* Reorder Threshold Modal (T029, T030, US4) */}
      {thresholdItem && (
        <ReorderThresholdModal
          isOpen={Boolean(thresholdItem)}
          onClose={() => setThresholdItem(null)}
          slug={slug}
          productId={thresholdItem.productId}
          productName={thresholdItem.productName}
          sku={thresholdItem.sku}
          currentStock={thresholdItem.quantity}
          currentVersion={thresholdItem.version}
          unitOfMeasure={thresholdItem.unitOfMeasure}
          isDiscrete={thresholdItem.isDiscrete}
          currentReorderPoint={thresholdItem.reorderPoint}
          currentReorderQuantity={thresholdItem.reorderQuantity}
          canAdjustStock={canAdjustStock}
          onThresholdsSuccess={(_result) => {
            startTransition(() => {
              router.refresh();
            });
          }}
        />
      )}
    </div>
  );
}
