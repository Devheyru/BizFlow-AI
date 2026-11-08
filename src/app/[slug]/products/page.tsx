import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { ProductFilters, type CategoryOption } from "@/components/products/ProductFilters";
import { ProductTable } from "@/components/products/ProductTable";
import { calculateGrossMargin } from "@/lib/products/margin";
import type { ProductListItem, ProductSortField, SortOrder } from "@/types/product";
import { Plus, FolderTree, ChevronLeft, ChevronRight } from "lucide-react";

interface ProductsPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    q?: string;
    category?: string;
    status?: string;
    sortBy?: string;
    sortOrder?: string;
    page?: string;
    pageSize?: string;
  }>;
}

const ALLOWED_SORT_FIELDS: ProductSortField[] = ["name", "sku", "selling_price", "created_at"];
const ALLOWED_PAGE_SIZES = [10, 20, 50, 100];

/**
 * Product Catalog Server Component (T026, FR-026 to FR-031, FR-039)
 *
 * Implements server-rendered paginated product catalog with:
 * - Authoritative `products:read` guard (serves HTTP 404 to unauthorized users)
 * - Strict role-based cost price confidentiality (zero cost queries or projections for Cashiers)
 * - Prefix search (2 chars) and trigram/substring search (3+ chars)
 * - Category and status filtering (defaulting to active and inactive, hiding archived)
 * - Deterministic sorting and server-side pagination
 */
export default async function ProductsPage({ params, searchParams }: ProductsPageProps) {
  const { slug } = await params;
  const resolvedParams = await searchParams;

  // 1. Resolve tenant context & enforce fail-closed authorization (FR-026)
  const context = await getTenantContext(slug);
  if (!hasPermission(context, "products:read")) {
    notFound();
  }

  // 2. Authoritative permission checks
  const canReadCost = hasPermission(context, "products:read_cost");
  const canCreate = hasPermission(context, "products:create");
  const canManageCategories = hasPermission(context, "categories:read");

  // 3. Parse and sanitize query parameters
  const rawQ = resolvedParams.q ? resolvedParams.q.trim() : "";
  const query = rawQ.length >= 2 ? rawQ : "";
  const categoryFilter = resolvedParams.category || "";
  const statusFilter = resolvedParams.status || "";

  const sortBy: ProductSortField = ALLOWED_SORT_FIELDS.includes(resolvedParams.sortBy as ProductSortField)
    ? (resolvedParams.sortBy as ProductSortField)
    : "name";
  const sortOrder: SortOrder = resolvedParams.sortOrder === "desc" ? "desc" : "asc";

  const rawPage = parseInt(resolvedParams.page || "1", 10);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const rawPageSize = parseInt(resolvedParams.pageSize || "20", 10);
  const pageSize = ALLOWED_PAGE_SIZES.includes(rawPageSize) ? rawPageSize : 20;

  const supabase = await createClient();

  // 4. Fetch Active Categories for filter dropdown
  const { data: dbCategories } = await supabase
    .from("product_categories")
    .select("id, name, status")
    .eq("organization_id", context.organization.id)
    .order("name", { ascending: true });

  const categoryOptions: CategoryOption[] = (dbCategories || []).map((cat) => ({
    id: cat.id,
    name: cat.name,
    status: cat.status as "active" | "archived",
  }));

  // 5. Construct Product Query with Cost Confidentiality Enforcement (FR-039)
  // When caller lacks products:read_cost, product_costs is NOT joined or queried at all.
  let queryBuilder = canReadCost
    ? supabase
        .from("products")
        .select(
          `
          id,
          organization_id,
          name,
          description,
          sku,
          barcode,
          category_id,
          selling_price,
          unit_of_measure,
          image_url,
          status,
          version,
          created_at,
          updated_at,
          category:product_categories(id, name, status),
          cost:product_costs(cost_price)
        `,
          { count: "exact" }
        )
    : supabase
        .from("products")
        .select(
          `
          id,
          organization_id,
          name,
          description,
          sku,
          barcode,
          category_id,
          selling_price,
          unit_of_measure,
          image_url,
          status,
          version,
          created_at,
          updated_at,
          category:product_categories(id, name, status)
        `,
          { count: "exact" }
        );

  queryBuilder = queryBuilder.eq("organization_id", context.organization.id);

  // Search Filter: 2 chars = prefix; 3+ chars = trigram / substring (FR-027)
  if (query) {
    if (query.length === 2) {
      queryBuilder = queryBuilder.or(
        `name.ilike.${query}%,sku.ilike.%${query}%,barcode.ilike.%${query}%`
      );
    } else {
      queryBuilder = queryBuilder.or(
        `name.ilike.%${query}%,sku.ilike.%${query}%,barcode.ilike.%${query}%`
      );
    }
  }

  // Category Filter (FR-028)
  if (categoryFilter === "uncategorized") {
    queryBuilder = queryBuilder.is("category_id", null);
  } else if (categoryFilter) {
    queryBuilder = queryBuilder.eq("category_id", categoryFilter);
  }

  // Status Filter: default view displays active and inactive, hiding archived (FR-029)
  if (statusFilter === "active") {
    queryBuilder = queryBuilder.eq("status", "active");
  } else if (statusFilter === "inactive") {
    queryBuilder = queryBuilder.eq("status", "inactive");
  } else if (statusFilter === "archived") {
    queryBuilder = queryBuilder.eq("status", "archived");
  } else if (statusFilter === "all") {
    // Show all statuses including archived
  } else {
    // Default view when status parameter is omitted
    queryBuilder = queryBuilder.in("status", ["active", "inactive"]);
  }

  // Sorting with deterministic tie-breaker (FR-030)
  queryBuilder = queryBuilder
    .order(sortBy, { ascending: sortOrder === "asc" })
    .order("id", { ascending: true });

  // Pagination (FR-031)
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  queryBuilder = queryBuilder.range(from, to);

  const { data: dbProducts, count, error } = await queryBuilder;

  if (error) {
    console.error("Failed to fetch product catalog:", error);
  }

  const totalCount = count || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  // Process rows into strongly typed ProductListItem models
  const products: ProductListItem[] = (dbProducts || []).map((row: any) => {
    const categoryRel = Array.isArray(row.category) ? row.category[0] : row.category;
    let categoryName: string | null = null;
    if (categoryRel) {
      categoryName = categoryRel.name + (categoryRel.status === "archived" ? " [Archived]" : "");
    }

    const item: ProductListItem = {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      description: row.description,
      sku: row.sku,
      barcode: row.barcode,
      categoryId: row.category_id,
      categoryName,
      sellingPrice: Number(row.selling_price),
      unitOfMeasure: row.unit_of_measure,
      imageUrl: row.image_url,
      status: row.status,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    if (canReadCost) {
      const costRel = Array.isArray(row.cost) ? row.cost[0] : row.cost;
      const rawCostPrice = costRel?.cost_price ?? null;
      const parsedCost = rawCostPrice !== null ? Number(rawCostPrice) : null;
      const marginMetrics = calculateGrossMargin(item.sellingPrice, parsedCost);

      item.costPrice = marginMetrics.costPrice;
      item.grossMargin = marginMetrics.grossMarginPercentage;
    }

    return item;
  });

  const hasActiveFilters = Boolean(query || categoryFilter || (statusFilter && statusFilter !== "all"));

  // Build pagination URLs
  const createPageUrl = (targetPage: number) => {
    const sp = new URLSearchParams();
    if (resolvedParams.q) sp.set("q", resolvedParams.q);
    if (resolvedParams.category) sp.set("category", resolvedParams.category);
    if (resolvedParams.status) sp.set("status", resolvedParams.status);
    if (resolvedParams.sortBy) sp.set("sortBy", resolvedParams.sortBy);
    if (resolvedParams.sortOrder) sp.set("sortOrder", resolvedParams.sortOrder);
    if (targetPage > 1) sp.set("page", String(targetPage));
    if (pageSize !== 20) sp.set("pageSize", String(pageSize));
    const qs = sp.toString();
    return qs ? `/${slug}/products?${qs}` : `/${slug}/products`;
  };

  const startRecord = totalCount > 0 ? from + 1 : 0;
  const endRecord = Math.min(to + 1, totalCount);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            Products
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage your retail catalog, pricing, and categories for {context.organization.name}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManageCategories && (
            <Link
              href={`/${slug}/products/categories`}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors"
            >
              <FolderTree className="h-4 w-4" aria-hidden="true" />
              <span>Categories</span>
            </Link>
          )}

          {canCreate && (
            <Link
              href={`/${slug}/products/new`}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Register Product</span>
            </Link>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <ProductFilters
        categories={categoryOptions}
        currentQuery={rawQ}
        currentCategory={categoryFilter}
        currentStatus={statusFilter}
      />

      {/* Products Table */}
      <ProductTable
        products={products}
        canReadCost={canReadCost}
        canCreate={canCreate}
        currency={context.organization.currency}
        sortBy={sortBy}
        sortOrder={sortOrder}
        slug={slug}
        hasActiveFilters={hasActiveFilters}
      />

      {/* Pagination Controls */}
      {totalCount > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Showing <span className="font-semibold text-gray-900 dark:text-gray-100">{startRecord}</span> to{" "}
            <span className="font-semibold text-gray-900 dark:text-gray-100">{endRecord}</span> of{" "}
            <span className="font-semibold text-gray-900 dark:text-gray-100">{totalCount}</span> products
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Link
                href={createPageUrl(page - 1)}
                className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-700 transition-colors ${
                  page <= 1
                    ? "pointer-events-none opacity-40 text-gray-400"
                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
                aria-disabled={page <= 1}
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Previous</span>
              </Link>

              <span className="text-xs text-gray-600 dark:text-gray-400 px-2">
                Page {page} of {totalPages}
              </span>

              <Link
                href={createPageUrl(page + 1)}
                className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-700 transition-colors ${
                  page >= totalPages
                    ? "pointer-events-none opacity-40 text-gray-400"
                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
                aria-disabled={page >= totalPages}
              >
                <span>Next</span>
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

