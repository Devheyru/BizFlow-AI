import React from "react";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import {
  getCustomerDetailAction,
  getCustomerPurchaseHistoryAction,
} from "@/actions/customer-actions";
import { CustomerDetailView } from "@/components/customers/customer-detail-view";
import type { CustomerPurchaseHistoryItem } from "@/actions/customer-actions";

interface CustomerDetailPageProps {
  params: Promise<{
    slug: string;
    customerId: string;
  }>;
}

export default async function CustomerDetailPage({
  params,
}: CustomerDetailPageProps) {
  const { slug, customerId } = await params;

  // 1. Resolve tenant context & enforce fail-closed authorization (CUS-001, Principle IV)
  const context = await getTenantContext(slug);
  if (!hasPermission(context, "customers:read")) {
    notFound();
  }

  // 2. Authoritative permission checks
  const canUpdate = hasPermission(context, "customers:update");
  const canArchive = hasPermission(context, "customers:archive");
  const canViewSales = hasPermission(context, "sales:read");

  // 3. Fetch Customer Detail
  const customerRes = await getCustomerDetailAction(slug, customerId);
  if (!customerRes.success) {
    notFound();
  }

  // 4. Fetch Purchase History if authorized
  let purchaseHistory: CustomerPurchaseHistoryItem[] = [];
  if (canViewSales) {
    const histRes = await getCustomerPurchaseHistoryAction(slug, customerId);
    if (histRes.success) {
      purchaseHistory = histRes.data;
    }
  }

  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl">
      <CustomerDetailView
        slug={slug}
        customer={customerRes.data}
        purchaseHistory={purchaseHistory}
        canUpdate={canUpdate}
        canArchive={canArchive}
        canViewSales={canViewSales}
      />
    </div>
  );
}
