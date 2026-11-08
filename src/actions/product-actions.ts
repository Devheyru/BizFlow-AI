"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { CreateProductSchema } from "@/lib/validations/product";
import { calculateGrossMargin } from "@/lib/products/margin";
import type { ActionResult } from "@/types/auth";
import type { ProductStatus, UnitOfMeasure } from "@/types/product";

// ============================================================================
// Types & Contracts (specs/003-products-categories/contracts/server-actions.md)
// ============================================================================

export interface ProductDetailResponse {
  id: string;
  organization_id: string;
  name: string;
  sku: string;
  barcode: string | null;
  category_id: string | null;
  selling_price: number;
  unit_of_measure: UnitOfMeasure;
  status: ProductStatus;
  version: number;
  image_url: string | null;
  created_at: string;
  /**
   * Acquisition cost price:
   * - `number`: Nonzero or zero recorded cost.
   * - `null`: Unrecorded cost record.
   * - `undefined` (omitted property): Caller lacks `products:read_cost` permission (FR-038).
   */
  cost_price?: number | null;
  /**
   * Gross profit margin percentage:
   * - `number`: Margin computed from selling price and recorded cost price.
   * - `null`: Uncalculated because cost is unrecorded or selling price is zero.
   * - `undefined` (omitted property): Caller lacks `products:read_cost` permission (FR-038).
   */
  gross_margin?: number | null;
}

interface RpcProductData {
  id: string;
  organization_id: string;
  name: string;
  sku: string;
  barcode: string | null;
  category_id: string | null;
  selling_price: number | string;
  unit_of_measure: UnitOfMeasure;
  status: ProductStatus;
  version: number;
  image_url: string | null;
  created_at: string;
  cost_price?: number | string | null;
}

const KNOWN_ERROR_CODES: Record<string, { code: string; message: string }> = {
  P0001: { code: "EMAIL_UNVERIFIED", message: "Email verification required." },
  P0002: { code: "RESOURCE_NOT_FOUND", message: "Target category was not found in this organization." },
  P0003: { code: "UNAUTHENTICATED", message: "Authentication required." },
  P0004: { code: "UNAUTHORIZED_MEMBERSHIP", message: "Caller is not an active member of this organization." },
  P0005: { code: "FORBIDDEN", message: "Insufficient permissions to perform this action." },
  P0006: { code: "IDENTIFIER_EXISTS", message: "A product with this SKU or barcode already exists in this organization." },
  P0007: { code: "NEGATIVE_PRICE", message: "Selling price and cost price cannot be negative." },
  P0008: { code: "MISSING_REQUIRED_PRICE", message: "Cost price is required for this operation." },
  P0009: { code: "VALIDATION_ERROR", message: "Invalid product parameters or decimal precision exceeded for organization currency." },
  P0010: { code: "CONCURRENCY_CONFLICT", message: "Stale update conflict: version mismatch." },
  P0015: { code: "STATE_CONFLICT", message: "Conflict with current item or category state." },
  P0016: { code: "INVALID_COST_OPERATION", message: "Invalid cost operation." },
};

// ============================================================================
// RBAC Invariant Documentation (FR-040, US2, US3)
// ============================================================================
/**
 * In BizFlow AI, every organizational role granted `products:create` ('owner', 'admin', 'manager')
 * also possesses `products:update` in ROLE_PERMISSIONS and public.role_permissions.
 * This guarantees that when a product is created with a staged local file upload,
 * the subsequent post-creation image association via updateProductAction is guaranteed
 * to be authorized for the exact same creator without privilege discrepancy.
 */

// ============================================================================
// Server Actions
// ============================================================================

/**
 * Registers a new product in the tenant catalog with atomic confidential cost persistence (T032, US2).
 */
export async function createProductAction(
  slug: string,
  rawInput: unknown
): Promise<ActionResult<ProductDetailResponse>> {
  try {
    // 1. Authoritative Tenant Resolution
    const tenantRes = await resolveTenantContext(slug);
    if (!tenantRes.ok) {
      return {
        success: false,
        error: {
          code: tenantRes.error.toUpperCase(),
          message: "Organization not found or access denied.",
        },
      };
    }
    const { context } = tenantRes;

    // 2. Application Permission Guard for Product Creation
    if (!hasPermission(context, "products:create")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Unauthorized: missing products:create permission.",
        },
      };
    }

    // 3. Input Validation via CreateProductSchema (without cost_operation)
    const parsed = CreateProductSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid product parameters provided.",
          details: parsed.error.flatten().fieldErrors,
        },
      };
    }
    const input = parsed.data;

    // 4. Confidential Cost Permission Guard
    if (input.cost_price !== undefined && input.cost_price !== null) {
      if (!hasPermission(context, "products:read_cost")) {
        return {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Unauthorized: setting product cost requires products:read_cost permission.",
          },
        };
      }
    }

    // 5. Database RPC Invocation (with explicit initial status 'active')
    const supabase = await createClient();
    const { data: rawRpcData, error } = await supabase.rpc("create_product", {
      p_org_id: context.organization.id,
      p_name: input.name,
      p_sku: input.sku,
      p_selling_price: input.selling_price,
      p_unit_of_measure: input.unit_of_measure,
      p_status: "active",
      p_barcode: input.barcode ?? undefined,
      p_description: input.description ?? undefined,
      p_category_id: input.category_id ?? undefined,
      p_cost_price: input.cost_price ?? undefined,
      p_image_url: input.image_url ?? undefined,
    });

    if (error) {
      const mapped = KNOWN_ERROR_CODES[error.code] || {
        code: error.code || "RPC_ERROR",
        message: error.message || "Failed to create product.",
      };
      return {
        success: false,
        error: {
          code: mapped.code,
          message: mapped.message,
        },
      };
    }

    const rpcPayload = rawRpcData as { success?: boolean; data?: RpcProductData };
    if (!rpcPayload?.success || !rpcPayload?.data) {
      return {
        success: false,
        error: {
          code: "RPC_ERROR",
          message: "Database returned an invalid response structure.",
        },
      };
    }

    const createdProduct = rpcPayload.data;

    // 6. Confidential Projection Stripping (FR-038)
    const canReadCost = hasPermission(context, "products:read_cost");
    const sellingPrice = Number(createdProduct.selling_price);

    const response: ProductDetailResponse = {
      id: createdProduct.id,
      organization_id: createdProduct.organization_id,
      name: createdProduct.name,
      sku: createdProduct.sku,
      barcode: createdProduct.barcode ?? null,
      category_id: createdProduct.category_id ?? null,
      selling_price: sellingPrice,
      unit_of_measure: createdProduct.unit_of_measure,
      status: createdProduct.status,
      version: createdProduct.version,
      image_url: createdProduct.image_url ?? null,
      created_at: createdProduct.created_at,
      ...(canReadCost
        ? {
            cost_price:
              createdProduct.cost_price !== null && createdProduct.cost_price !== undefined
                ? Number(createdProduct.cost_price)
                : null,
            gross_margin:
              createdProduct.cost_price !== null && createdProduct.cost_price !== undefined
                ? calculateGrossMargin(sellingPrice, Number(createdProduct.cost_price)).grossMarginPercentage
                : null,
          }
        : {}),
    };

    // 7. Cache Invalidation
    revalidatePath(`/${slug}/products`, "page");

    return { success: true, data: response };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    return {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message,
      },
    };
  }
}

