import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import {
  hasInventoryPermission,
  canViewValuation,
} from "@/lib/inventory/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  getInventoryOverviewAction,
  getInventoryListAction,
} from "@/actions/inventory-actions";
import { InventoryMetricsTiles } from "@/components/inventory/inventory-metrics-tiles";
import {
  InventoryFilters,
  type CategoryOption,
} from "@/components/inventory/inventory-filters";
import {
  InventoryTable,
  type InventorySortField,
  type SortDirection,
} from "@/components/inventory/inventory-table";
import type {
  StockStatusFilter,
  ProductStatusFilter,
} from "@/types/inventory";
import { History, ClipboardCheck, AlertCircle } from "lucide-react";

interface InventoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    search?: string;
    q?: string;
    categoryId?: string;
    stockStatus?: string;
    productStatus?: string;
    includeArchived?: string;
    sortBy?: string;
    sortOrder?: string;
    page?: string;
    pageSize?: string;
  }>;
}

const ALLOWED_SORT_FIELDS: InventorySortField[] = [
  "name",
  "sku",
  "quantity",
  "stock_status",
];

const ALLOWED_PAGE_SIZES = [10, 20, 25, 50, 100];

/**
 * Inventory Overview Server Component (T018, FR-INV-001 to FR-INV-004, FR-INV-020, SEC-INV-004, US1).
 *
 * Implements:
 * - Server-side tenant resolution and fail-closed `inventory:read` authorization guard (notFound).
 * - Server-evaluated dual-permission valuation check (`canViewValuation`: BOTH `inventory:read_valuation` AND `products:read_cost`).
 * - High-level metrics aggregation cards via `getInventoryOverviewAction`.
 * - Multi-criteria filterable and sortable inventory listing via `getInventoryListAction`.
 * - Dynamic category retrieval for filter dropdown.
 * - Integration with Next.js URL search params for bookmarkable, shareable query state.
 */
export default async function InventoryPage({
  params,
  searchParams,
}: InventoryPageProps) {
  const { slug } = await params;
  const resolvedParams = await searchParams;

  // 1. Resolve tenant context & enforce fail-closed authorization (FR-INV-001)
  const context = await getTenantContext(slug);
  if (!hasInventoryPermission(context, "inventory:read")) {
    notFound();
  }

  // 2. Authoritative server permission evaluations
  const canViewValuationProp = canViewValuation(context);
  const canReceive = hasInventoryPermission(context, "inventory:receive");
  const canAdjust = hasInventoryPermission(context, "inventory:adjust");
  const canAudit = hasInventoryPermission(context, "inventory:history");

  // 3. Parse and sanitize query parameters
  const rawSearch = (resolvedParams.search || resolvedParams.q || "").trim();
  const categoryId = resolvedParams.categoryId || undefined;
  const stockStatus = (resolvedParams.stockStatus || "all") as StockStatusFilter;
  const productStatus = (resolvedParams.productStatus || "all") as ProductStatusFilter;
  const includeArchived = resolvedParams.includeArchived === "true";

  const sortBy: InventorySortField = ALLOWED_SORT_FIELDS.includes(
    resolvedParams.sortBy as InventorySortField
  )
    ? (resolvedParams.sortBy as InventorySortField)
    : "stock_status";

  const sortOrder: SortDirection =
    resolvedParams.sortOrder === "desc" ? "desc" : "asc";

  const rawPage = parseInt(resolvedParams.page || "1", 10);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const rawPageSize = parseInt(resolvedParams.pageSize || "20", 10);
  const pageSize = ALLOWED_PAGE_SIZES.includes(rawPageSize) ? rawPageSize : 20;

  // 4. Fetch Active Categories for filter dropdown
  const supabase = await createClient();
  const { data: dbCategories } = await supabase
    .from("product_categories")
    .select("id, name, status")
    .eq("organization_id", context.organization.id)
    .order("name", { ascending: true });

  const categories: CategoryOption[] = (dbCategories || []).map((cat) => ({
    id: cat.id,
    name: cat.name,
    status: cat.status as "active" | "archived",
  }));

  // 5. Execute parallel data fetch for overview metrics and paginated inventory
  const [overviewResult, listResult] = await Promise.all([
    getInventoryOverviewAction(slug, includeArchived),
    getInventoryListAction(slug, {
      search: rawSearch || undefined,
      categoryId,
      stockStatus,
      productStatus,
      includeArchived,
      page,
      pageSize,
      sortBy,
      sortOrder,
    }),
  ]);

  const hasActiveFilters = Boolean(
    rawSearch ||
      categoryId ||
      (stockStatus && stockStatus !== "all") ||
      (productStatus && productStatus !== "all") ||
      includeArchived
  );

  return (
    <div className="space-y-6" data-testid="inventory-page-root">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            Inventory & Stock
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Monitor real-time stock balances, manage stock movements, and track replenishment thresholds.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canAudit && (
            <Link
              href={`/${slug}/inventory/history`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors shadow-sm"
              data-testid="link-movement-history"
            >
              <History className="h-4 w-4" aria-hidden="true" />
              <span>Movement History</span>
            </Link>
          )}

          {canAdjust && (
            <Link
              href={`/${slug}/inventory/stocktake`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors shadow-sm"
              data-testid="link-stocktake"
            >
              <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
              <span>Stocktake</span>
            </Link>
          )}
        </div>
      </div>

      {/* Error Banners if actions failed */}
      {!overviewResult.success && (
        <div
          className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-700 dark:text-red-400 flex items-center gap-3"
          data-testid="overview-error-banner"
        >
          <AlertCircle className="h-5 w-5 shrink-0" />
          <div>
            <span className="font-semibold">Unable to load inventory metrics: </span>
            <span>{overviewResult.error?.message || "An error occurred."}</span>
          </div>
        </div>
      )}

      {!listResult.success && (
        <div
          className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-700 dark:text-red-400 flex items-center gap-3"
          data-testid="list-error-banner"
        >
          <AlertCircle className="h-5 w-5 shrink-0" />
          <div>
            <span className="font-semibold">Unable to load inventory list: </span>
            <span>{listResult.error?.message || "An error occurred."}</span>
          </div>
        </div>
      )}

      {/* 1. Overview Metrics Tiles (T020) */}
      <InventoryMetricsTiles
        data={overviewResult.success ? overviewResult.data : null}
        canViewValuation={canViewValuationProp}
      />

      {/* 2. Inventory Filter Bar (T021) */}
      <InventoryFilters
        categories={categories}
        currentSearch={rawSearch}
        currentCategoryId={categoryId}
        currentStockStatus={stockStatus}
        currentProductStatus={productStatus}
        includeArchived={includeArchived}
      />

      {/* 3. Paginated Inventory Table (T022) */}
      <InventoryTable
        items={listResult.success && listResult.data ? listResult.data.items : []}
        totalCount={
          listResult.success && listResult.data ? listResult.data.totalCount : 0
        }
        page={page}
        pageSize={pageSize}
        totalPages={
          listResult.success && listResult.data ? listResult.data.totalPages : 1
        }
        canViewValuation={canViewValuationProp}
        canReceiveStock={canReceive}
        canAdjustStock={canAdjust}
        currency={context.organization.currency || "USD"}
        sortBy={sortBy}
        sortOrder={sortOrder}
        slug={slug}
        hasActiveFilters={hasActiveFilters}
      />
    </div>
  );
}

