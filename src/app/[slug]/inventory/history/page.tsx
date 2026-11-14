import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import {
  hasInventoryPermission,
  canViewValuation,
} from "@/lib/inventory/permissions";
import { createClient } from "@/lib/supabase/server";
import { getMovementHistoryAction } from "@/actions/inventory-actions";
import {
  MovementHistoryTable,
  type ProductOption,
} from "@/components/inventory/movement-history-table";
import { ArrowLeft, History, AlertCircle } from "lucide-react";

interface MovementHistoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    productId?: string;
    movementType?: string;
    fromDate?: string;
    toDate?: string;
    page?: string;
    pageSize?: string;
  }>;
}

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];

/**
 * Stock Movement History Page (T031, US5, Phase 8).
 *
 * Implements:
 * - Server-side tenant resolution and fail-closed authorization guard (`inventory:history`).
 * - Server-evaluated valuation dual-permission check (`canViewValuation`: BOTH `inventory:read_valuation` AND `products:read_cost`).
 * - Note: `getMovementHistoryAction` automatically strips acquisition costs from the response
 *   payload when caller lacks valuation permissions, guaranteeing cost data never leaves the server boundary.
 * - Multi-criteria filterable and paginated movement history ledger via `MovementHistoryTable`.
 * - Integration with Next.js URL search params for bookmarkable, shareable history queries.
 */
export default async function MovementHistoryPage({
  params,
  searchParams,
}: MovementHistoryPageProps) {
  const { slug } = await params;
  const resolvedParams = await searchParams;

  // 1. Resolve tenant context & enforce fail-closed authorization (inventory:history)
  const context = await getTenantContext(slug);
  if (!hasInventoryPermission(context, "inventory:history")) {
    notFound();
    return null;
  }

  // 2. Authoritative server permission evaluation for valuation (BOTH inventory:read_valuation AND products:read_cost)
  const canViewValuationProp = canViewValuation(context);

  // 3. Parse and sanitize query parameters
  const rawPage = parseInt(resolvedParams.page || "1", 10);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const rawPageSize = parseInt(resolvedParams.pageSize || "25", 10);
  const pageSize = ALLOWED_PAGE_SIZES.includes(rawPageSize) ? rawPageSize : 25;

  const rawProductId = resolvedParams.productId?.trim();
  const productId =
    rawProductId && rawProductId !== "all" && rawProductId !== ""
      ? rawProductId
      : undefined;

  const rawMovementType = resolvedParams.movementType?.trim();
  const movementType =
    rawMovementType && rawMovementType !== "all" && rawMovementType !== ""
      ? (rawMovementType as any)
      : "all";

  // Convert date inputs (YYYY-MM-DD) to ISO format with start/end of day
  let fromDateIso: string | undefined = undefined;
  if (resolvedParams.fromDate) {
    const rawFrom = resolvedParams.fromDate.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawFrom)) {
      fromDateIso = new Date(`${rawFrom}T00:00:00.000Z`).toISOString();
    } else {
      const d = new Date(rawFrom);
      if (!isNaN(d.getTime())) {
        fromDateIso = d.toISOString();
      }
    }
  }

  let toDateIso: string | undefined = undefined;
  if (resolvedParams.toDate) {
    const rawTo = resolvedParams.toDate.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawTo)) {
      toDateIso = new Date(`${rawTo}T23:59:59.999Z`).toISOString();
    } else {
      const d = new Date(rawTo);
      if (!isNaN(d.getTime())) {
        toDateIso = d.toISOString();
      }
    }
  }

  // 4. Create server supabase client to fetch products for filter dropdown
  const supabase = await createClient();

  // 5. Fetch history and product list in parallel
  const [historyResult, { data: dbProducts }] = await Promise.all([
    getMovementHistoryAction(slug, {
      page,
      pageSize,
      productId,
      movementType,
      fromDate: fromDateIso,
      toDate: toDateIso,
    }),
    supabase
      .from("products")
      .select("id, name, sku")
      .eq("organization_id", context.organization.id)
      .order("name", { ascending: true }),
  ]);

  const products: ProductOption[] = (dbProducts || []).map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
  }));

  const items = historyResult.success && historyResult.data ? historyResult.data.items : [];
  const totalCount =
    historyResult.success && historyResult.data ? historyResult.data.totalCount : 0;
  const totalPages =
    historyResult.success && historyResult.data ? historyResult.data.totalPages : 1;

  const currentFilters = {
    productId: resolvedParams.productId,
    movementType: resolvedParams.movementType,
    fromDate: resolvedParams.fromDate,
    toDate: resolvedParams.toDate,
  };

  return (
    <div className="space-y-6" data-testid="movement-history-page-root">
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
              <History className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
                Stock Movement History
              </h1>
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Audit trail of all inventory transactions, opening stock, restocks, adjustments, and write-offs.
            </p>
          </div>
        </div>
      </div>

      {/* Error Banner if history query failed */}
      {!historyResult.success && (
        <div
          className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-700 dark:text-red-400 flex items-center gap-3"
          data-testid="history-error-banner"
        >
          <AlertCircle className="h-5 w-5 shrink-0" />
          <div>
            <span className="font-semibold">Unable to load movement history: </span>
            <span>{historyResult.error?.message || "An error occurred."}</span>
          </div>
        </div>
      )}

      {/* Movement History Table */}
      <MovementHistoryTable
        items={items}
        totalCount={totalCount}
        page={page}
        pageSize={pageSize}
        totalPages={totalPages}
        canViewValuation={canViewValuationProp}
        currency={context.organization.currency || "USD"}
        products={products}
        currentFilters={currentFilters}
        slug={slug}
      />
    </div>
  );
}
