import React from "react";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { ProductDetailView, type AuditEventItem } from "@/components/products/ProductDetailView";
import { getSignedProductImageUrlAction } from "@/actions/product-actions";
import type { Product, UnitOfMeasure, ProductStatus } from "@/types/product";

interface ProductDetailPageProps {
  params: Promise<{
    slug: string;
    productId: string;
  }>;
}

/**
 * Product Detail Page Server Component (T042, FR-008, FR-024, FR-025, FR-039, FR-041)
 *
 * Implements server-rendered product detail screen with:
 * - Fail-closed tenant authorization (`products:read` required; 404 for unauthorized)
 * - Cross-tenant existence denial (404 for products in other organizations)
 * - Strict role-based cost price confidentiality (zero queries or projections for Cashiers)
 * - Dual-protocol dynamic image signing
 * - Chronological audit timeline integration
 */
export default async function ProductDetailPage({ params }: ProductDetailPageProps) {
  const { slug, productId } = await params;

  // 1. Resolve tenant context & enforce fail-closed authorization (FR-026, FR-039)
  const context = await getTenantContext(slug);
  if (!hasPermission(context, "products:read")) {
    notFound();
  }

  const supabase = await createClient();

  // 2. Fetch product by ID for the active organization (cross-tenant protection)
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

  // 3. Confidential Cost Fetching (FR-039)
  // Strictly gated by products:read_cost. Cashiers NEVER query product_costs.
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

  // 4. Fetch Category metadata if assigned
  let category = null;
  if (productRow.category_id) {
    const { data: categoryRow } = await supabase
      .from("product_categories")
      .select("id, organization_id, name, description, status, created_at, updated_at")
      .eq("organization_id", context.organization.id)
      .eq("id", productRow.category_id)
      .maybeSingle();

    if (categoryRow) {
      category = {
        id: categoryRow.id,
        organizationId: categoryRow.organization_id,
        name: categoryRow.name,
        description: categoryRow.description,
        status: categoryRow.status as "active" | "archived",
        createdAt: categoryRow.created_at,
        updatedAt: categoryRow.updated_at,
      };
    }
  }

  // 5. Dynamic Image Signing (Dual Protocol: HTTPS direct or Storage signed)
  let signedImageUrl: string | null = null;
  if (productRow.image_url) {
    const imageRes = await getSignedProductImageUrlAction(slug, productRow.image_url);
    if (imageRes.success && imageRes.data?.signedUrl) {
      signedImageUrl = imageRes.data.signedUrl;
    }
  }

  // 6. Fetch Product Audit Timeline (FR-041)
  let auditEvents: AuditEventItem[] = [];
  try {
    const { data: auditRows } = await supabase
      .from("organization_audit_events")
      .select(`
        id,
        event_type,
        metadata,
        created_at,
        actor_id,
        actor:profiles(first_name, last_name)
      `)
      .eq("organization_id", context.organization.id)
      .contains("metadata", { product_id: productId })
      .order("created_at", { ascending: false });

    if (auditRows) {
      auditEvents = auditRows.map((row: any) => ({
        id: row.id,
        eventType: row.event_type,
        metadata: (row.metadata || {}) as Record<string, unknown>,
        createdAt: row.created_at,
        actor: row.actor
          ? {
              firstName: row.actor.first_name,
              lastName: row.actor.last_name,
            }
          : null,
      }));
    }
  } catch {
    // If audit_events cannot be read (e.g. non-admin role per RLS), fail gracefully to empty list
    auditEvents = [];
  }

  const canUpdate = hasPermission(context, "products:update");

  const product: Product = {
    id: productRow.id,
    organizationId: productRow.organization_id,
    name: productRow.name,
    description: productRow.description,
    sku: productRow.sku,
    barcode: productRow.barcode,
    categoryId: productRow.category_id,
    category,
    sellingPrice: Number(productRow.selling_price),
    costPrice,
    unitOfMeasure: productRow.unit_of_measure as UnitOfMeasure,
    imageUrl: productRow.image_url,
    signedImageUrl,
    status: productRow.status as ProductStatus,
    version: productRow.version,
    createdAt: productRow.created_at,
    updatedAt: productRow.updated_at,
    createdBy: productRow.created_by,
    updatedBy: productRow.updated_by,
  };

  return (
    <ProductDetailView
      product={product}
      currency={context.organization.currency}
      canReadCost={canReadCost}
      canUpdate={canUpdate}
      slug={slug}
      auditEvents={auditEvents}
    />
  );
}
