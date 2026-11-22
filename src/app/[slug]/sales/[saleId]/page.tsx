import React from "react";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { getSaleDetailAction, getReturnHistoryAction } from "@/actions/sales-actions";
import { SaleDetailView } from "@/components/sales/sale-detail-view";

interface SaleDetailPageProps {
  params: Promise<{
    slug: string;
    saleId: string;
  }>;
}

/**
 * Server Component for Sale Detail Breakdown (T064, US5).
 * - Enforces fail-closed `sales:read` permission.
 * - Retrieves full sale detail through public.get_sale_detail RPC via getSaleDetailAction.
 * - Database-enforced cost protection: unit_cost is only visible if caller holds BOTH
 *   `inventory:read_valuation` AND `products:read_cost`.
 * - Retrieves return and refund lifecycle records via getReturnHistoryAction.
 */
export default async function SaleDetailPage({ params }: SaleDetailPageProps) {
  const { slug, saleId } = await params;

  // 1. Authoritative Server-Side Tenant Resolution & Permission Guard
  const context = await getTenantContext(slug);
  if (!hasPermission(context, "sales:read")) {
    notFound();
  }

  // 2. Fetch Sale Details via Protected Action (RPC get_sale_detail)
  const saleRes = await getSaleDetailAction(slug, saleId);
  if (!saleRes.success || !saleRes.data) {
    notFound();
  }

  // 3. Fetch Return & Refund History
  const returnRes = await getReturnHistoryAction(slug, saleId);
  const returnHistory = returnRes.success ? returnRes.data : [];

  // 4. Dual-Permission Cost Masking Evaluation
  const canViewCost =
    hasPermission(context, "inventory:read_valuation") &&
    hasPermission(context, "products:read_cost");

  return (
    <SaleDetailView
      slug={slug}
      saleDetail={saleRes.data}
      returnHistory={returnHistory}
      canViewCost={canViewCost}
      organizationName={context.organization.name}
    />
  );
}
