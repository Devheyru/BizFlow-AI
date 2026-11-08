"use client";

import React, { useState, useEffect, useCallback, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

export interface CategoryOption {
  id: string;
  name: string;
  status?: "active" | "archived";
}

export interface ProductFiltersProps {
  categories: CategoryOption[];
  currentQuery?: string;
  currentCategory?: string;
  currentStatus?: string;
}

const STATUS_TABS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "inactive", label: "Inactive" },
  { id: "archived", label: "Archived" },
] as const;

/**
 * ProductFilters (T024, FR-027, FR-028, FR-029)
 *
 * Provides catalog search with 300ms debounce and minimum 2-character query validation,
 * category filter dropdown (including "Uncategorized"), and status filter tabs
 * (Active, Inactive, Archived, All), synchronizing state via Next.js URL search params.
 */
export function ProductFilters({
  categories,
  currentQuery = "",
  currentCategory = "",
  currentStatus = "all",
}: ProductFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const [searchInput, setSearchInput] = useState(currentQuery);

  // Sync local search input if URL changes externally
  useEffect(() => {
    setSearchInput(currentQuery);
  }, [currentQuery]);

  // Helper to update URL search parameters and reset pagination to page 1
  const updateFilters = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());

      // Reset pagination on filter change
      params.delete("page");

      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "" || (key === "status" && value === "all")) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }

      startTransition(() => {
        const qs = params.toString();
        router.push(qs ? `${pathname}?${qs}` : pathname);
      });
    },
    [searchParams, pathname, router]
  );

  // Debounced search input handler (300ms debounce, min 2-character validation)
  useEffect(() => {
    const trimmed = searchInput.trim();

    // If query hasn't changed compared to URL, no-op
    if (trimmed === currentQuery) {
      return;
    }

    // Minimum 2-character query validation (FR-027):
    // 1-character queries do NOT trigger a search request.
    if (trimmed.length === 1) {
      return;
    }

    const timer = setTimeout(() => {
      if (trimmed.length === 0) {
        updateFilters({ q: null });
      } else if (trimmed.length >= 2) {
        updateFilters({ q: trimmed });
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput, currentQuery, updateFilters]);

  const handleClearSearch = () => {
    setSearchInput("");
    if (currentQuery) {
      updateFilters({ q: null });
    }
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    updateFilters({ category: value ? value : null });
  };

  const handleStatusChange = (statusId: string) => {
    updateFilters({ status: statusId === "all" ? null : statusId });
  };

  const activeStatusKey = currentStatus && ["active", "inactive", "archived"].includes(currentStatus)
    ? currentStatus
    : "all";

  return (
    <div className="space-y-4">
      {/* Top Filter Bar: Search and Category Dropdown */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        {/* Search input with 300ms debounce & min-2 char enforcement */}
        <div className="relative flex-1 max-w-md">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
            <Search className="h-4 w-4" aria-hidden="true" />
          </div>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name, SKU, or barcode..."
            className="w-full pl-9 pr-9 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            aria-label="Search catalog"
          />
          {searchInput && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              aria-label="Clear search query"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Category filter select */}
        <div className="w-full sm:w-64">
          <select
            value={currentCategory}
            onChange={handleCategoryChange}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            aria-label="Filter by category"
          >
            <option value="">All Categories</option>
            <option value="uncategorized">Uncategorized</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
                {cat.status === "archived" ? " [Archived]" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Status Filter Tabs (Active, Inactive, Archived, All) */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 gap-2 sm:gap-6 overflow-x-auto">
        {STATUS_TABS.map((tab) => {
          const isSelected = activeStatusKey === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleStatusChange(tab.id)}
              className={`pb-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap px-1 ${
                isSelected
                  ? "border-blue-600 text-blue-600 dark:text-blue-400 font-semibold"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
              aria-current={isSelected ? "true" : undefined}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

