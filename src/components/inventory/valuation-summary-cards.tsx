import React from "react";
import {
  DollarSign,
  PackageCheck,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";
import { formatCurrency } from "@/lib/inventory/formatters";

export interface ValuationSummaryCardsProps {
  totalValuation: {
    amount: number;
    currency: string;
    formatted: string;
  };
  totalTrackedProducts: number;
  valuedProductsCount: number;
  unvaluedProductsCount: number;
  zeroStockValuedProductsCount?: number;
  currency?: string;
}

/**
 * Inventory Valuation Summary Cards (T033, Phase 9).
 *
 * Implements:
 * - Confidential financial metric cards for authorized staff (holding BOTH
 *   `inventory:read_valuation` AND `products:read_cost`).
 * - Card 1: Total Inventory Valuation (sum of quantity * cost_price, formatted).
 * - Card 2: Valued Products Coverage (count and percentage of products with active cost records).
 * - Card 3: Unvalued Products Alert (products missing costs, excluded from monetary totals per spec).
 * - Card 4: Average Item Valuation (mean monetary value across valued products).
 * - Full accessible semantics, responsive grid, and dark mode support.
 */
export function ValuationSummaryCards({
  totalValuation,
  totalTrackedProducts,
  valuedProductsCount,
  unvaluedProductsCount,
  currency = "USD",
}: ValuationSummaryCardsProps) {
  const coveragePercent =
    totalTrackedProducts > 0
      ? Math.round((valuedProductsCount / totalTrackedProducts) * 100)
      : 0;

  const averageValuation =
    valuedProductsCount > 0
      ? totalValuation.amount / valuedProductsCount
      : 0;

  return (
    <section
      aria-label="Inventory Valuation Summary"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      data-testid="valuation-summary-cards"
    >
      {/* 1. Total Valuation */}
      <div
        className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm transition-shadow hover:shadow-md"
        data-testid="card-total-valuation"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Total Valuation
          </span>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
            <DollarSign className="h-5 w-5" aria-hidden="true" />
          </div>
        </div>
        <div className="mt-3">
          <span
            className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400"
            data-testid="value-total-valuation"
          >
            {totalValuation.formatted}
          </span>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {totalValuation.currency} on-hand asset value
          </p>
        </div>
      </div>

      {/* 2. Valued Products Coverage */}
      <div
        className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm transition-shadow hover:shadow-md"
        data-testid="card-valued-coverage"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Valued Coverage
          </span>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
            <PackageCheck className="h-5 w-5" aria-hidden="true" />
          </div>
        </div>
        <div className="mt-3">
          <span
            className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100"
            data-testid="value-valued-coverage"
          >
            {valuedProductsCount.toLocaleString()} / {totalTrackedProducts.toLocaleString()}
          </span>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {coveragePercent}% products with cost records
          </p>
        </div>
      </div>

      {/* 3. Unvalued Products Alert */}
      <div
        className={`rounded-xl border ${
          unvaluedProductsCount > 0
            ? "border-amber-300 dark:border-amber-800/80 bg-amber-50/30 dark:bg-amber-950/10"
            : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
        } p-5 shadow-sm transition-shadow hover:shadow-md`}
        data-testid="card-unvalued-products"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Unvalued Items
          </span>
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-lg ${
              unvaluedProductsCount > 0
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
              unvaluedProductsCount > 0
                ? "text-amber-600 dark:text-amber-400"
                : "text-gray-900 dark:text-gray-100"
            }`}
            data-testid="value-unvalued-products"
          >
            {unvaluedProductsCount.toLocaleString()}
          </span>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Excluded from monetary totals (cost missing)
          </p>
        </div>
      </div>

      {/* 4. Average Valuation per Valued Product */}
      <div
        className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm transition-shadow hover:shadow-md"
        data-testid="card-average-valuation"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Avg Product Value
          </span>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-950/50 dark:text-purple-400">
            <TrendingUp className="h-5 w-5" aria-hidden="true" />
          </div>
        </div>
        <div className="mt-3">
          <span
            className="text-2xl font-bold tracking-tight text-purple-600 dark:text-purple-400"
            data-testid="value-average-valuation"
          >
            {formatCurrency(averageValuation, currency)}
          </span>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Average per valued line item
          </p>
        </div>
      </div>
    </section>
  );
}
