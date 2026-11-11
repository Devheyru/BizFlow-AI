"use client";

import React, { useState, useEffect, useCallback, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search, X, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StockStatusFilter, ProductStatusFilter } from "@/types/inventory";

export interface CategoryOption {
  id: string;
  name: string;
  status?: "active" | "archived";
}

export interface InventoryFiltersProps {
  categories: CategoryOption[];
  currentSearch?: string;
  currentCategoryId?: string;
  currentStockStatus?: StockStatusFilter;
  currentProductStatus?: ProductStatusFilter;
  includeArchived?: boolean;
}

const STOCK_STATUS_OPTIONS: { value: StockStatusFilter; label: string }[] = [
  { value: "all", label: "All Stock Levels" },
  { value: "in_stock", label: "In Stock" },
  { value: "low_stock", label: "Low Stock" },
  { value: "out_of_stock", label: "Out of Stock" },
];

const PRODUCT_STATUS_OPTIONS: { value: ProductStatusFilter; label: string }[] = [
  { value: "all", label: "All Product Statuses" },
  { value: "active", label: "Active Only" },
  { value: "inactive", label: "Inactive Only" },
  { value: "archived", label: "Archived Only" },
];

/**
 * Inventory Filters Bar (T021, FR-INV-003, FR-INV-004, US1).
 *
 * Provides multi-criteria filtering and searching:
 * - Real-time debounced search (300ms) by name, SKU, or barcode.
 * - Category filter dropdown.
 * - Stock status filter (`all`, `in_stock`, `low_stock`, `out_of_stock`).
 * - Product lifecycle filter (`all`, `active`, `inactive`, `archived`).
 * - "Include Archived" boolean toggle.
 * - One-click "Reset Filters" action.
 *
 * Emits state exclusively via Next.js URL search params, ensuring shareable,
 * bookmarkable, and server-renderable inventory query state.
 */
export function InventoryFilters({
  categories = [],
  currentSearch = "",
  currentCategoryId = "",
  currentStockStatus = "all",
  currentProductStatus = "all",
  includeArchived = false,
}: InventoryFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [searchInput, setSearchInput] = useState(currentSearch);

  // Synchronize internal search state if URL search query changes externally
  useEffect(() => {
    setSearchInput(currentSearch);
  }, [currentSearch]);

  // Centralized filter update helper (resets pagination to page 1 on filter mutation)
  const updateFilters = useCallback(
    (updates: Record<string, string | boolean | null>) => {
      const params = new URLSearchParams(searchParams.toString());

      // Reset pagination upon any filter modification
      params.delete("page");

      for (const [key, value] of Object.entries(updates)) {
        if (
          value === null ||
          value === "" ||
          value === false ||
          (key === "stockStatus" && value === "all") ||
          (key === "productStatus" && value === "all")
        ) {
          params.delete(key);
        } else {
          params.set(key, String(value));
        }
      }

      startTransition(() => {
        const qs = params.toString();
        router.push(qs ? `${pathname}?${qs}` : pathname);
      });
    },
    [searchParams, pathname, router]
  );

  // Debounced search input handler (300ms debounce)
  useEffect(() => {
    const trimmed = searchInput.trim();

    if (trimmed === currentSearch) {
      return;
    }

    const timer = setTimeout(() => {
      if (trimmed.length === 0) {
        updateFilters({ search: null, q: null });
      } else {
        updateFilters({ search: trimmed, q: null });
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput, currentSearch, updateFilters]);

  const hasActiveFilters =
    Boolean(currentSearch) ||
    Boolean(currentCategoryId) ||
    currentStockStatus !== "all" ||
    currentProductStatus !== "all" ||
    includeArchived;

  const handleResetFilters = () => {
    setSearchInput("");
    updateFilters({
      search: null,
      q: null,
      category: null,
      categoryId: null,
      stockStatus: null,
      productStatus: null,
      includeArchived: null,
    });
  };

  return (
    <div
      className="space-y-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm"
      data-testid="inventory-filters"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {/* Search Input */}
        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Search className="h-4 w-4 text-gray-400" aria-hidden="true" />
          </div>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by product name, SKU, or barcode..."
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 py-2 pl-9 pr-10 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            data-testid="inventory-search-input"
            aria-label="Search inventory by product name, SKU, or barcode"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => {
                setSearchInput("");
                updateFilters({ search: null, q: null });
              }}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              aria-label="Clear search query"
              data-testid="inventory-clear-search-btn"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Filters Group */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Category Dropdown */}
          <div className="min-w-[140px] flex-1 sm:flex-none">
            <select
              value={currentCategoryId}
              onChange={(e) =>
                updateFilters({ categoryId: e.target.value || null, category: null })
              }
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              data-testid="inventory-category-select"
              aria-label="Filter by category"
            >
              <option value="">All Categories</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                  {cat.status === "archived" ? " (Archived)" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Stock Status Dropdown */}
          <div className="min-w-[140px] flex-1 sm:flex-none">
            <select
              value={currentStockStatus}
              onChange={(e) =>
                updateFilters({ stockStatus: e.target.value as StockStatusFilter })
              }
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              data-testid="inventory-stock-status-select"
              aria-label="Filter by stock status"
            >
              {STOCK_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Product Lifecycle Dropdown */}
          <div className="min-w-[140px] flex-1 sm:flex-none">
            <select
              value={currentProductStatus}
              onChange={(e) =>
                updateFilters({ productStatus: e.target.value as ProductStatusFilter })
              }
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              data-testid="inventory-product-status-select"
              aria-label="Filter by product lifecycle status"
            >
              {PRODUCT_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Include Archived Toggle */}
          <label
            className="flex cursor-pointer items-center gap-2 select-none px-2 py-1.5 text-sm text-gray-700 dark:text-gray-300"
            data-testid="inventory-include-archived-label"
          >
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => updateFilters({ includeArchived: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-950"
              data-testid="inventory-include-archived-checkbox"
            />
            <span className="text-xs sm:text-sm">Include Archived</span>
          </label>

          {/* Reset Filters Button */}
          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleResetFilters}
              className="gap-1.5 text-xs text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
              data-testid="inventory-reset-filters-btn"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Reset</span>
            </Button>
          )}
        </div>
      </div>

      {isPending && (
        <div className="h-0.5 w-full bg-blue-100 dark:bg-blue-950 overflow-hidden">
          <div className="h-full w-1/3 bg-blue-600 animate-pulse" />
        </div>
      )}
    </div>
  );
}