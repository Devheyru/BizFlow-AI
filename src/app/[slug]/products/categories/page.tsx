import React from "react";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { CategoryPageClient, type CategoryPageItem } from "@/components/products/CategoryPageClient";

interface CategoriesPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    tab?: string;
  }>;
}

/**
 * Category Management Page Server Component (T048, FR-030 to FR-037)
 *
 * Implements dedicated category management screen with:
 * - Fail-closed authorization: requires `categories:read`, serves 404 to unauthorized callers
 * - Active & Archived tabs with aggregated product counts
 * - Cross-tenant referential integrity & isolation
 * - Role-based permissions passed down to client actions
 */
export default async function CategoriesPage({ params, searchParams }: CategoriesPageProps) {
  const { slug } = await params;
  const resolvedSearchParams = await searchParams;

  // 1. Resolve tenant context & enforce fail-closed authorization (FR-030 to FR-037, FR-040)
  const context = await getTenantContext(slug);
  if (!hasPermission(context, "categories:read")) {
    notFound();
  }

  // 2. Authoritative permission checks
  const canCreate = hasPermission(context, "categories:create");
  const canUpdate = hasPermission(context, "categories:update");
  const canArchive = hasPermission(context, "categories:archive");

  // 3. Fetch categories for this organization
  const supabase = await createClient();
  const { data: categoryRows, error: catError } = await supabase
    .from("product_categories")
    .select("id, organization_id, name, description, status, created_at, updated_at, archived_at")
    .eq("organization_id", context.organization.id)
    .order("name", { ascending: true });

  if (catError) {
    throw new Error(`Failed to load categories: ${catError.message}`);
  }

  // 4. Fetch active product counts per category (FR-037)
  const { data: countRows, error: countError } = await supabase
    .from("products")
    .select("category_id")
    .eq("organization_id", context.organization.id)
    .eq("status", "active")
    .not("category_id", "is", null);

  if (countError) {
    throw new Error(`Failed to aggregate product counts: ${countError.message}`);
  }

  const productCounts: Record<string, number> = {};
  countRows?.forEach((row) => {
    if (row.category_id) {
      productCounts[row.category_id] = (productCounts[row.category_id] || 0) + 1;
    }
  });

  const categories: CategoryPageItem[] = (categoryRows || []).map((cat) => ({
    id: cat.id,
    organization_id: cat.organization_id,
    name: cat.name,
    description: cat.description,
    status: cat.status as "active" | "archived",
    productCount: productCounts[cat.id] || 0,
    created_at: cat.created_at,
    updated_at: cat.updated_at,
    archived_at: cat.archived_at,
  }));

  const initialTab = resolvedSearchParams.tab === "archived" ? "archived" : "active";

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <CategoryPageClient
        slug={slug}
        organizationName={context.organization.name}
        categories={categories}
        canCreate={canCreate}
        canUpdate={canUpdate}
        canArchive={canArchive}
        initialTab={initialTab}
      />
    </div>
  );
}

