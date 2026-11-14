import React from "react";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import {
  hasInventoryPermission,
  canViewValuation,
} from "@/lib/inventory/permissions";
import { getInventoryListAction } from "@/actions/inventory-actions";
import { StocktakeWorkflow } from "@/components/inventory/stocktake-workflow";

interface StocktakePageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Stocktake / Cycle Count Workflow Page (T028, US4, Phase 7)
 *
 * Implements:
 * - Server-side tenant resolution and fail-closed inventory:read authorization guard.
 * - Retrieves active organization's inventory stock items for physical cycle counts.
 * - Integrates StocktakeWorkflow client component with embedded stocktake modals.
 */
export default async function StocktakePage({ params }: StocktakePageProps) {
  const { slug } = await params;

  // 1. Resolve tenant context & enforce fail-closed authorization
  const context = await getTenantContext(slug);
  if (!hasInventoryPermission(context, "inventory:read")) {
    notFound();
    return null;
  }

  // 2. Authoritative server permission evaluations
  const canAdjust = hasInventoryPermission(context, "inventory:adjust");
  const canViewValuationProp = canViewValuation(context);

  // 3. Fetch inventory items for stocktake workflow (fetch up to 100 items sorted alphabetically)
  const listResult = await getInventoryListAction(slug, {
    page: 1,
    pageSize: 100,
    sortBy: "name",
    sortOrder: "asc",
    includeArchived: false,
  });

  const items = listResult.success && listResult.data ? listResult.data.items : [];
  const totalCount = listResult.success && listResult.data ? listResult.data.totalCount : 0;

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <StocktakeWorkflow
        slug={slug}
        items={items}
        totalCount={totalCount}
        canAdjustStock={canAdjust}
        canViewValuation={canViewValuationProp}
        currency={context.organization.currency || "USD"}
      />
    </div>
  );
}
