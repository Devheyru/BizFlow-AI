import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, PackagePlus } from "lucide-react";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { ProductForm, type CategoryOption } from "@/components/products/ProductForm";

interface NewProductPageProps {
  params: Promise<{
    slug: string;
  }>;
}

export const metadata = {
  title: "Register Product | BizFlow AI",
  description: "Register a new product in your retail catalog.",
};

/**
 * Product Registration Page Server Component (T034, FR-001 - FR-016, FR-040)
 *
 * Implements server-rendered product creation screen with:
 * - Fail-closed authorization: requires `products:create` on server (serves 404 to unauthorized callers)
 * - Strict multi-tenant isolation: validates tenant context and queries only active tenant categories
 * - Cost confidentiality: gates `canReadCost` so unauthorized roles never receive or submit cost data
 * - Clean Next.js App Router breadcrumbs and accessible page layout
 */
export default async function NewProductPage({ params }: NewProductPageProps) {
  const { slug } = await params;

  // 1. Authoritative Server-Side Tenant Resolution & Permission Guard (FR-001, FR-040)
  const context = await getTenantContext(slug);
  if (!hasPermission(context, "products:create")) {
    notFound();
  }

  // 2. Cost Confidentiality Guard (FR-039)
  const canReadCost = hasPermission(context, "products:read_cost");

  // 3. Fetch Active Categories for this organization only (FR-002, FR-037)
  const supabase = await createClient();
  const { data: categoryRows, error: catError } = await supabase
    .from("product_categories")
    .select("id, name")
    .eq("organization_id", context.organization.id)
    .eq("status", "active")
    .order("name", { ascending: true });

  if (catError) {
    console.error("Failed to load active product categories:", catError);
    throw new Error("Failed to load product categories for this organization.");
  }

  const categories: CategoryOption[] = (categoryRows || []).map((cat) => ({
    id: cat.id,
    name: cat.name,
  }));

  const currency = context.organization.currency || "USD";

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Navigation Breadcrumb */}
      <nav aria-label="Breadcrumb">
        <Link
          href={`/${slug}/products`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Products</span>
        </Link>
      </nav>

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded-lg">
              <PackagePlus className="h-5 w-5" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              Register New Product
            </h1>
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Add a new retail item, pricing, and media to {context.organization.name}&apos;s catalog.
          </p>
        </div>
      </div>

      {/* Product Registration Form */}
      <ProductForm
        slug={slug}
        organizationId={context.organization.id}
        currency={currency}
        canReadCost={canReadCost}
        categories={categories}
      />
    </div>
  );
}

