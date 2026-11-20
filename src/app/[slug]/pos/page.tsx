import React from "react";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  PosCartView,
  type PosProduct,
  type PosCategory,
  type PosTaxSettings,
} from "@/components/pos/pos-cart-view";

interface PosPageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Server Component for the POS Checkout & Cart Page (T050, T053, US1, US3)
 * - Authenticates caller and enforces fail-closed `sales:create` permission guard
 * - Loads active sellable products with current on-hand stock and version
 * - Loads organization tax settings (name, default rate, inclusive/exclusive flag)
 * - Loads active categories for instant filtering
 */
export default async function PosPage({ params }: PosPageProps) {
  const { slug } = await params;

  // 1. Authoritative Server-Side Tenant Resolution & Permission Gate
  const context = await getTenantContext(slug);
  if (!hasPermission(context, "sales:create")) {
    notFound();
  }

  const supabase = await createClient();
  const orgId = context.organization.id;
  const currency = context.organization.currency || "USD";
  const organizationName = context.organization.name;
  const cashierName = context.user.email || "Cashier";

  // 2. Fetch Active Sellable Products joined with Inventory stock
  const { data: dbProducts } = await supabase
    .from("products")
    .select(`
      id,
      name,
      sku,
      barcode,
      selling_price,
      unit_of_measure,
      category_id,
      inventory (
        quantity,
        version
      )
    `)
    .eq("organization_id", orgId)
    .eq("status", "active")
    .order("name", { ascending: true });

  const products: PosProduct[] = (dbProducts || []).map((p) => {
    // PostgREST returns inventory as single object or array
    const inv = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
    const stockQty = inv ? parseFloat(String(inv.quantity)) || 0 : 0;
    const version = inv ? inv.version : null;

    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      selling_price: parseFloat(String(p.selling_price)) || 0,
      unit_of_measure: p.unit_of_measure,
      category_id: p.category_id,
      stock_quantity: stockQty,
      expected_version: version,
    };
  });

  // 3. Fetch Organization Tax Settings
  const { data: dbTaxSettings } = await supabase
    .from("organization_tax_settings")
    .select("tax_name, default_tax_rate, is_tax_inclusive")
    .eq("organization_id", orgId)
    .maybeSingle();

  const taxSettings: PosTaxSettings = {
    taxName: dbTaxSettings?.tax_name || "None",
    defaultTaxRate: dbTaxSettings ? parseFloat(String(dbTaxSettings.default_tax_rate)) || 0 : 0,
    isTaxInclusive: dbTaxSettings?.is_tax_inclusive ?? false,
  };

  // 4. Fetch Active Categories for filtering
  const { data: dbCategories } = await supabase
    .from("product_categories")
    .select("id, name")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .order("name", { ascending: true });

  const categories: PosCategory[] = (dbCategories || []).map((c) => ({
    id: c.id,
    name: c.name,
  }));

  return (
    <PosCartView
      slug={slug}
      organizationName={organizationName}
      currency={currency}
      cashierName={cashierName}
      products={products}
      categories={categories}
      taxSettings={taxSettings}
    />
  );
}
