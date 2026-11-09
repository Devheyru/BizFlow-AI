import React from "react";
import { notFound, redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { ProductEditForm, type CategorySelectOption } from "@/components/products/ProductEditForm";
import type { Product, UnitOfMeasure, ProductStatus } from "@/types/product";

interface ProductEditPageProps {
  params: Promise<{
    slug: string;
    productId: string;
  }>;
}

/**
 * Product Edit Page Server Component (T042, FR-008, FR-023, BR-016)
 *
 * Implements server-rendered product edit screen with:
 * - Fail-closed authorization (`products:update` required)
 * - Cross-tenant protection (404 for products in other organizations)
 * - Archival guard (redirects archived products with notice)
 * - Active category options resolution
 * - Confidential cost data gating (never exposed or queried for unauthorized roles)
 */
export default async function ProductEditPage({ params }: ProductEditPageProps) {
  const { slug, productId } = await params;

  // 1. Resolve tenant context & enforce fail-closed authorization (FR-008)
  const context = await getTenantContext(slug);
  if (!hasPermission(context, "products:update")) {
    notFound();
  }

  const supabase = await createClient();

  // 2. Fetch product by ID for active organization
  const { data: productRow, error: productError } = await supabase
    .from("products")
    .select(`
      id,
      organization_id,
      name,
      description,
      sku,
      barcode,
      category_id,
      unit_of_measure,
      selling_price,
      image_url,
      status,
      version,
      created_at,
      updated_at,
      created_by,
      updated_by
    `)
    .eq("organization_id", context.organization.id)
    .eq("id", productId)
    .maybeSingle();

  if (productError || !productRow) {
    notFound();
  }

  // 3. Archival Guard (Archived products cannot be updated directly; must restore first)
  if (productRow.status === "archived") {
    redirect(`/${slug}/products/${productId}`);
  }

  // 4. Confidential Cost Fetching (FR-039)
  const canReadCost = hasPermission(context, "products:read_cost");
  let costPrice: number | null | undefined = undefined;

  if (canReadCost) {
    const { data: costRow } = await supabase
      .from("product_costs")
      .select("cost_price")
      .eq("organization_id", context.organization.id)
      .eq("product_id", productId)
      .maybeSingle();

    costPrice = costRow ? Number(costRow.cost_price) : null;
  }

  // 5. Fetch Categories (active categories + current category if archived)
  const { data: categoryRows } = await supabase
    .from("product_categories")
    .select("id, name, status")
    .eq("organization_id", context.organization.id)
    .order("name", { ascending: true });

  const categories: CategorySelectOption[] = (categoryRows || [])
    .filter((cat) => cat.status === "active" || cat.id === productRow.category_id)
    .map((cat) => ({
      id: cat.id,
      name: cat.name,
      status: cat.status as "active" | "archived",
    }));

  const product: Product = {
    id: productRow.id,
    organizationId: productRow.organization_id,
    name: productRow.name,
    description: productRow.description,
    sku: productRow.sku,
    barcode: productRow.barcode,
    categoryId: productRow.category_id,
    sellingPrice: Number(productRow.selling_price),
    costPrice,
    unitOfMeasure: productRow.unit_of_measure as UnitOfMeasure,
    imageUrl: productRow.image_url,
    status: productRow.status as ProductStatus,
    version: productRow.version,
    createdAt: productRow.created_at,
    updatedAt: productRow.updated_at,
    createdBy: productRow.created_by,
    updatedBy: productRow.updated_by,
  };

  return (
    <ProductEditForm
      product={product}
      categories={categories}
      currency={context.organization.currency}
      canReadCost={canReadCost}
      slug={slug}
    />
  );
}

