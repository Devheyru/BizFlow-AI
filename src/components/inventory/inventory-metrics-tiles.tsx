import React from "react";
import { Package, CheckCircle2, AlertTriangle, XCircle, DollarSign } from "lucide-react";
import type { InventoryOverviewData } from "@/types/inventory";

export interface InventoryMetricsTilesProps {
  data: InventoryOverviewData | null;
  /**
   * Server-computed boolean indicating whether the current caller holds BOTH
   * `inventory:read_valuation` AND `products:read_cost`.
   * The component NEVER re-evaluates or circumvents this prop.
   */
  canViewValuation: boolean;
}

/**
 * Inventory Overview Metric Tiles (T020, FR-INV-002, US1).
 *
 * Displays high-level inventory balance aggregates:
 * 1. Total Tracked Products (count)
 * 2. In-Stock Products (count, healthy green badge)
 * 3. Low-Stock Items (count, warning amber badge)
 * 4. Out-of-Stock Items (count, destructive red badge)
 * 5. Total Inventory Valuation (protected: conditionally rendered ONLY when canViewValuation is true)
 */
export function InventoryMetricsTiles({
  data,
  canViewValuation,
}: InventoryMetricsTilesProps) {
  const totalProducts = data?.totalTrackedProducts ?? 0;
  const inStock = data?.inStockCount ?? 0;
  const lowStock = data?.lowStockCount ?? 0;
  const outOfStock = data?.outOfStockCount ?? 0;
  const valuation = data?.totalValuation ?? null;

  // Show 5th tile ONLY if the server authorized valuation AND data is present
  const showValuationTile = canViewValuation === true && valuation !== null;

  return (
    <section
      aria-label="Inventory Overview Metrics"
      className={`grid grid-cols-1 sm:grid-cols-2 ${
        showValuationTile ? "lg:grid-cols-5" : "lg:grid-cols-4"
      } gap-4`}
      data-testid="inventory-metrics-tiles"
    >
      {/* 1. Total Tracked Products */}
      <div
        className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm transition-shadow hover:shadow-md"
        data-testid="metric-total-products"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Total Products
          </span>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
            <Package className="h-5 w-5" aria-hidden="true" />
          </div>
        </div>
        <div className="mt-3">
          <span className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {totalProducts.toLocaleString()}
          </span>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Tracked in catalog
          </p>
        </div>
      </div>

      {/* 2. In-Stock Products */}
      <div
        className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm transition-shadow hover:shadow-md"
        data-testid="metric-in-stock"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            In Stock
          </span>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          </div>
        </div>
        <div className="mt-3">
          <span className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {inStock.toLocaleString()}
          </span>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Healthy availability
          </p>
        </div>
      </div>

      {/* 3. Low-Stock Items */}
      <div
        className={`rounded-xl border ${
          lowStock > 0
            ? "border-amber-300 dark:border-amber-800/80 bg-amber-50/30 dark:bg-amber-950/10"
            : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
        } p-5 shadow-sm transition-shadow hover:shadow-md`}
        data-testid="metric-low-stock"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Low Stock
          </span>
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-lg ${
              lowStock > 0
                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400"
                : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
            }`}
          >
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </div>
        </div>
        <div className="mt-3">
          <span
            className={`text-2xl font-bold tracking-tight ${
              lowStock > 0
                ? "text-amber-600 dark:text-amber-400"
                : "text-gray-900 dark:text-gray-100"
            }`}
          >
            {lowStock.toLocaleString()}
          </span>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {lowStock > 0 ? "Requires reordering" : "No replenishment needed"}
          </p>
        </div>
      </div>

      {/* 4. Out-of-Stock Items */}
      <div
        className={`rounded-xl border ${
          outOfStock > 0
            ? "border-red-300 dark:border-red-800/80 bg-red-50/30 dark:bg-red-950/10"
            : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
        } p-5 shadow-sm transition-shadow hover:shadow-md`}
        data-testid="metric-out-of-stock"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Out of Stock
          </span>
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-lg ${
              outOfStock > 0
                ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400"
                : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
            }`}
          >
            <XCircle className="h-5 w-5" aria-hidden="true" />
          </div>
        </div>
        <div className="mt-3">
          <span
            className={`text-2xl font-bold tracking-tight ${
              outOfStock > 0
                ? "text-red-600 dark:text-red-400"
                : "text-gray-900 dark:text-gray-100"
            }`}
          >
            {outOfStock.toLocaleString()}
          </span>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {outOfStock > 0 ? "Depleted inventory" : "Fully stocked"}
          </p>
        </div>
      </div>

      {/* 5. Total Valuation (Restricted to Authorized Financial Roles) */}
      {showValuationTile && (
        <div
          className="rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-gradient-to-br from-emerald-50/50 via-white to-white dark:from-emerald-950/20 dark:via-gray-900 dark:to-gray-900 p-5 shadow-sm transition-shadow hover:shadow-md"
          data-testid="metric-total-valuation"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-400">
              Total Valuation
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
              <DollarSign className="h-5 w-5" aria-hidden="true" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between gap-2">
            <div>
              <span className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
                {valuation.formatted}
              </span>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Based on unit cost
              </p>
            </div>
            {/* Sparkline visualization */}
            <div
              className="h-8 w-16 shrink-0 opacity-80"
              aria-hidden="true"
              title="Valuation trend indicator"
            >
              <svg
                viewBox="0 0 64 28"
                className="h-full w-full overflow-visible text-emerald-500"
                fill="none"
              >
                <path
                  d="M 2 22 L 14 18 L 26 20 L 38 12 L 50 14 L 62 4"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="62" cy="4" r="2.5" fill="currentColor" />
              </svg>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

