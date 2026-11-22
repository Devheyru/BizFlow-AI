import React from "react";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getSalesListAction } from "@/actions/sales-actions";
import { SalesHistoryView } from "@/components/sales/sales-history-view";
import type { PaginatedSalesList } from "@/types/sales";

interface SalesPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    search?: string;
    q?: string;
    status?: string;
    customerId?: string;
    cashierId?: string;
    fromDate?: string;
    toDate?: string;
    sortBy?: "created_at" | "sale_number" | "total_amount";
    sortOrder?: "asc" | "desc";
    page?: string;
    pageSize?: string;
  }>;
}

/**
 * Server Component for Sales Transaction History (T063, US5).
 * - Enforces fail-closed `sales:read` permission.
 * - Resolves active organization tenant context.
 * - Extracts filter parameters from URL query string.
 * - Invokes getSalesListAction to perform tenant-scoped PostgREST query.
 * - Cost confidentiality: unit_cost is never exposed.
 */
export default async function SalesPage({
  params,
  searchParams,
}: SalesPageProps) {
  const { slug } = await params;
  const resolvedParams = await searchParams;

  // 1. Authoritative Server-Side Tenant Resolution & Permission Guard
  const context = await getTenantContext(slug);
  if (!hasPermission(context, "sales:read")) {
    notFound();
  }

  // 2. Parse and normalize query parameters
  const searchQuery = (resolvedParams.search || resolvedParams.q || "").trim();
  const rawStatus = resolvedParams.status;
  const status =
    rawStatus && ["completed", "voided", "partially_returned", "returned"].includes(rawStatus)
      ? (rawStatus as "completed" | "voided" | "partially_returned" | "returned")
      : "all";

  const rawPage = parseInt(resolvedParams.page || "1", 10);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const rawPageSize = parseInt(resolvedParams.pageSize || "20", 10);
  const pageSize = Number.isInteger(rawPageSize) && rawPageSize > 0 ? rawPageSize : 20;

  const sortBy =
    resolvedParams.sortBy && ["created_at", "sale_number", "total_amount"].includes(resolvedParams.sortBy)
      ? resolvedParams.sortBy
      : "created_at";

  const sortOrder = resolvedParams.sortOrder === "asc" ? "asc" : "desc";

  // 3. Fetch Sales via Server Action
  const res = await getSalesListAction(slug, {
    search: searchQuery || undefined,
    status,
    customerId: resolvedParams.customerId || undefined,
    cashierId: resolvedParams.cashierId || undefined,
    fromDate: resolvedParams.fromDate || undefined,
    toDate: resolvedParams.toDate || undefined,
    sortBy,
    sortOrder,
    page,
    pageSize,
  });

  const initialData: PaginatedSalesList = res.success
    ? res.data
    : {
        items: [],
        totalCount: 0,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      };

  // 4. Resolve Active Cashier / Staff Profiles for the filter dropdown
  const supabase = await createClient();
  const { data: cashierRows } = await supabase
    .from("organization_memberships")
    .select("user_id, profiles ( id, first_name, last_name )")
    .eq("organization_id", context.organization.id)
    .eq("status", "active");

  const cashiers = (cashierRows || []).map((m) => {
    const p = m.profiles as unknown as { first_name?: string; last_name?: string } | null;
    const name = p ? `${p.first_name || ""} ${p.last_name || ""}`.trim() : "Staff";
    return { id: m.user_id, name: name || "Staff" };
  });

  return (
    <SalesHistoryView
      slug={slug}
      initialData={initialData}
      currency={context.organization.currency || "USD"}
      cashiers={cashiers}
    />
  );
}
