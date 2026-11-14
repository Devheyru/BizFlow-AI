import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { canViewValuation } from "@/lib/inventory/permissions";
import { getInventoryValuationSummaryAction } from "@/actions/inventory-actions";
import { ValuationSummaryCards } from "@/components/inventory/valuation-summary-cards";
import {
  formatCurrency,
  formatStockQuantity,
  getStockStatusBadge,
} from "@/lib/inventory/formatters";
import { ArrowLeft, DollarSign, AlertCircle, AlertTriangle } from "lucide-react";

interface ValuationPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    includeArchived?: string;
  }>;
}

/**
 * Inventory Valuation Summary Page (T034, Phase 9).
 *
 * Implements:
 * - Server-side tenant resolution and fail-closed authorization guard.
 * - Dual-permission requirement: requires BOTH `inventory:read_valuation` AND `products:read_cost`.
 *   If either permission is missing, immediately fails closed with `notFound()`.
 * - Aggregates organization-scoped valuation data using full-precision line math
 *   and single aggregate currency rounding.
 * - Displays ValuationSummaryCards (T033) and complete line-item breakdown.
 * - Reports unvalued items without fabricated or defaulted zero figures.
 */
export default async function InventoryValuationPage({
  params,
  searchParams,
}: ValuationPageProps) {
  const { slug } = await params;
  const resolvedParams = await searchParams;

  // 1. Resolve tenant context & enforce dual-permission valuation guard
  const context = await getTenantContext(slug);
  if (!canViewValuation(context)) {
    notFound();
  }

  const includeArchived = resolvedParams.includeArchived === "true";

  // 2. Query valuation summary dataset via server action
  const result = await getInventoryValuationSummaryAction(slug, includeArchived);

  const currency = context.organization.currency || "USD";
  const data = result.success && result.data ? result.data : null;

  return (
    <div className="space-y-6" data-testid="inventory-valuation-page-root">
      {/* Page Header */}
      <div className="border-b border-gray-200 dark:border-gray-800 pb-5">
        <div className="mb-2">
          <Link
            href={`/${slug}/inventory`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 transition-colors"
            data-testid="link-back-to-inventory"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Inventory</span>
          </Link>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
                <DollarSign className="h-5 w-5" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
                Inventory Valuation Summary
              </h1>
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Total asset valuation based on current catalog replacement costs in {currency}.
            </p>
          </div>
        </div>
      </div>

      {/* Error Banner if query failed */}
      {!result.success && (
        <div
          className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-700 dark:text-red-400 flex items-center gap-3"
          data-testid="valuation-error-banner"
        >
          <AlertCircle className="h-5 w-5 shrink-0" />
          <div>
            <span className="font-semibold">Unable to load valuation summary: </span>
            <span>{result.error?.message || "An unexpected error occurred."}</span>
          </div>
        </div>
      )}

      {/* Valuation Summary Metric Cards */}
      {data && (
        <ValuationSummaryCards
          totalValuation={data.totalValuation}
          totalTrackedProducts={data.totalTrackedProducts}
          valuedProductsCount={data.valuedProductsCount}
          unvaluedProductsCount={data.unvaluedProductsCount}
          zeroStockValuedProductsCount={data.zeroStockValuedProductsCount}
          currency={currency}
        />
      )}

      {/* Unvalued Items Warning Notice */}
      {data && data.unvaluedProductsCount > 0 && (
        <div
          className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-3"
          data-testid="unvalued-items-notice"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div>
            <p className="font-semibold">
              {data.unvaluedProductsCount} product{data.unvaluedProductsCount > 1 ? "s have" : " has"} no recorded acquisition cost
            </p>
            <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
              In accordance with financial compliance standards, items without an active cost record in product costs are omitted from monetary totals (never defaulted to zero). Configure cost prices in the product catalog to achieve 100% valuation coverage.
            </p>
          </div>
        </div>
      )}

      {/* Detailed Line-Item Valuation Breakdown Table */}
      {data && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Line-Item Valuation Breakdown
            </h2>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {data.items.length} line items
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
            <table
              className="min-w-full divide-y divide-gray-200 dark:divide-gray-800 text-left text-sm"
              data-testid="valuation-table"
            >
              <thead className="bg-gray-50 dark:bg-gray-950/70 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                <tr>
                  <th scope="col" className="py-3.5 pl-4 pr-3 sm:pl-6">
                    Product
                  </th>
                  <th scope="col" className="px-3 py-3.5">
                    Category
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-right">
                    On-Hand Stock
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-right">
                    Unit Cost
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-right">
                    Line Total
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-center pr-4 sm:pr-6">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {data.items.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-12 text-center text-sm text-gray-500 dark:text-gray-400"
                    >
                      No inventory records found.
                    </td>
                  </tr>
                ) : (
                  data.items.map((item) => {
                    const badge = getStockStatusBadge(item.stockStatus);
                    return (
                      <tr
                        key={item.productId}
                        className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors"
                        data-testid={`valuation-row-${item.productId}`}
                      >
                        {/* Product Name & SKU */}
                        <td className="py-4 pl-4 pr-3 sm:pl-6">
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            {item.productName}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                            {item.sku}
                          </div>
                        </td>

                        {/* Category */}
                        <td className="px-3 py-4 text-xs text-gray-600 dark:text-gray-400">
                          {item.categoryName || (
                            <span className="italic text-gray-400">Uncategorized</span>
                          )}
                        </td>

                        {/* Quantity */}
                        <td className="px-3 py-4 text-right text-xs font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">
                          {formatStockQuantity(item.quantity, item.isDiscrete)}{" "}
                          <span className="text-gray-500 dark:text-gray-400 font-normal">
                            {item.unitOfMeasure}
                          </span>
                        </td>

                        {/* Unit Cost */}
                        <td className="px-3 py-4 text-right text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">
                          {item.costPrice !== null
                            ? formatCurrency(item.costPrice, currency)
                            : (
                              <span className="italic text-amber-600 dark:text-amber-400">
                                Unknown
                              </span>
                            )}
                        </td>

                        {/* Line Total */}
                        <td className="px-3 py-4 text-right text-xs font-semibold whitespace-nowrap">
                          {item.lineValuation !== null ? (
                            <span className="text-gray-900 dark:text-gray-100">
                              {formatCurrency(item.lineValuation, currency)}
                            </span>
                          ) : (
                            <span className="text-gray-400 italic font-normal">—</span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-3 py-4 text-center whitespace-nowrap pr-4 sm:pr-6">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                              badge.variant === "destructive"
                                ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800"
                                : badge.variant === "warning"
                                ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800"
                                : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800"
                            }`}
                          >
                            {badge.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
