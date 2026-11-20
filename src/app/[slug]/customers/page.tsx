import React from "react";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { searchCustomersAction } from "@/actions/customer-actions";
import { CustomerListView } from "@/components/customers/customer-list-view";
import type { PaginatedCustomerResult } from "@/types/customers";

interface CustomersPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    q?: string;
    status?: string;
    page?: string;
    pageSize?: string;
  }>;
}

export default async function CustomersPage({
  params,
  searchParams,
}: CustomersPageProps) {
  const { slug } = await params;
  const resolvedParams = await searchParams;

  // 1. Resolve tenant context & enforce fail-closed authorization (CUS-001, Principle IV)
  const context = await getTenantContext(slug);
  if (!hasPermission(context, "customers:read")) {
    notFound();
  }

  // 2. Authoritative permission checks
  const canCreate = hasPermission(context, "customers:create");
  const canUpdate = hasPermission(context, "customers:update");
  const canArchive = hasPermission(context, "customers:archive");

  // 3. Parse and sanitize query parameters
  const searchQuery = resolvedParams.q ? resolvedParams.q.trim() : "";
  const rawStatus = resolvedParams.status;
  const currentStatus: "all" | "active" | "archived" =
    rawStatus === "all" || rawStatus === "archived" ? rawStatus : "active";

  const rawPage = parseInt(resolvedParams.page || "1", 10);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const rawPageSize = parseInt(resolvedParams.pageSize || "20", 10);
  const pageSize = Number.isInteger(rawPageSize) && rawPageSize > 0 ? rawPageSize : 20;

  // 4. Fetch customer data via tenant-scoped server action
  const res = await searchCustomersAction(slug, {
    search: searchQuery || undefined,
    status: currentStatus,
    page,
    pageSize,
  });

  const initialData: PaginatedCustomerResult = res.success
    ? res.data
    : {
        items: [],
        totalCount: 0,
        page,
        pageSize,
        totalPages: 0,
      };

  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl">
      <CustomerListView
        slug={slug}
        initialData={initialData}
        searchQuery={searchQuery}
        currentStatus={currentStatus}
        canCreate={canCreate}
        canUpdate={canUpdate}
        canArchive={canArchive}
      />
    </div>
  );
}
