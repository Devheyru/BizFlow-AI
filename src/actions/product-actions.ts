"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { CreateProductSchema, UpdateProductSchema } from "@/lib/validations/product";
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
  P0009: { code: "INVALID_PARAMETER", message: "Invalid product parameters provided." },
  P0010: { code: "CONCURRENCY_CONFLICT", message: "This product was modified by another user. Please reload the latest data." },
  P0015: { code: "STATE_CONFLICT", message: "This operation conflicts with the current product or category status." },
  P0016: { code: "INVALID_COST_OPERATION", message: "Invalid cost operation specified." },
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

// ============================================================================
// Phase 5 Server Actions (T039, T040, US3)
// ============================================================================

/**
 * Generates dynamic short-lived signed URL for private product images (T039, US3, FR-042, BR-018).
 * Dual URL protocol:
 * - External HTTPS URLs: returned as-is (expiresIn: 0)
 * - Internal Storage relative object paths: validates tenant folder prefix and generates 1-hour signed URL
 */
export async function getSignedProductImageUrlAction(
  slug: string,
  imagePath: string
): Promise<ActionResult<{ signedUrl: string; expiresIn: number }>> {
  try {
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

    if (!hasPermission(context, "products:read")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Unauthorized: missing products:read permission.",
        },
      };
    }

    if (imagePath.startsWith("https://")) {
      return {
        success: true,
        data: {
          signedUrl: imagePath,
          expiresIn: 0,
        },
      };
    }

    // Verify tenant folder prefix matches active organization
    if (!imagePath.startsWith(`${context.organization.id}/`)) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Unauthorized image path: folder prefix must match active organization.",
        },
      };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from("product-images")
      .createSignedUrl(imagePath, 3600);

    if (error || !data?.signedUrl) {
      return {
        success: false,
        error: {
          code: "STORAGE_ERROR",
          message: "Failed to generate signed image URL.",
        },
      };
    }

    return {
      success: true,
      data: {
        signedUrl: data.signedUrl,
        expiresIn: 3600,
      },
    };
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

/**
 * Updates an existing product with OCC version protection and safe image replacement lifecycle (T040, US3).
 */
export async function updateProductAction(
  slug: string,
  productId: string,
  rawInput: unknown
): Promise<ActionResult<ProductDetailResponse>> {
  try {
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

    if (!hasPermission(context, "products:update")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Unauthorized: missing products:update permission.",
        },
      };
    }

    const parsed = UpdateProductSchema.safeParse(rawInput);
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

    // Confidential cost permission guard
    if (input.cost_operation === "set" || input.cost_operation === "clear") {
      if (!hasPermission(context, "products:read_cost")) {
        return {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Unauthorized: modifying cost requires products:read_cost permission.",
          },
        };
      }
    }

    const supabase = await createClient();

    // Query existing image to coordinate safe edit-mode image replacement lifecycle
    const { data: existingProductRecord } = await supabase
      .from("products")
      .select("image_url")
      .eq("id", productId)
      .eq("organization_id", context.organization.id)
      .maybeSingle();

    const previousImagePath = existingProductRecord?.image_url;

    // Execute update_product RPC with OCC version check
    const { data: rawRpcData, error } = await supabase.rpc("update_product", {
      p_org_id: context.organization.id,
      p_product_id: productId,
      p_expected_version: input.expected_version,
      p_name: input.name,
      p_sku: input.sku,
      p_selling_price: input.selling_price,
      p_unit_of_measure: input.unit_of_measure,
      p_barcode: input.barcode ?? undefined,
      p_description: input.description ?? undefined,
      p_category_id: input.category_id ?? undefined,
      p_cost_price: input.cost_price ?? undefined,
      p_cost_operation: input.cost_operation,
      p_image_url: input.image_url ?? undefined,
    });

    if (error) {
      // Rollback cleanup: If newly uploaded storage object was supplied and RPC failed, remove newly uploaded object
      if (
        input.image_url &&
        input.image_url !== previousImagePath &&
        input.image_url.startsWith(`${context.organization.id}/`)
      ) {
        try {
          await supabase.storage.from("product-images").remove([input.image_url]);
        } catch {
          // Non-terminating rollback cleanup failure
        }
      }

      const mapped = KNOWN_ERROR_CODES[error.code] || {
        code: error.code || "RPC_ERROR",
        message: error.message || "Failed to update product.",
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

    const updatedProduct = rpcPayload.data;

    // Post-commit cleanup: If previous image was internal Storage object and was replaced, remove it post-commit
    if (
      previousImagePath &&
      previousImagePath !== input.image_url &&
      previousImagePath.startsWith(`${context.organization.id}/`)
    ) {
      try {
        await supabase.storage.from("product-images").remove([previousImagePath]);
      } catch {
        // Log unreferenced path for maintenance orphan cleanup
      }
    }

    const canReadCost = hasPermission(context, "products:read_cost");
    const sellingPrice = Number(updatedProduct.selling_price);

    const response: ProductDetailResponse = {
      id: updatedProduct.id,
      organization_id: updatedProduct.organization_id,
      name: updatedProduct.name,
      sku: updatedProduct.sku,
      barcode: updatedProduct.barcode ?? null,
      category_id: updatedProduct.category_id ?? null,
      selling_price: sellingPrice,
      unit_of_measure: updatedProduct.unit_of_measure,
      status: updatedProduct.status,
      version: updatedProduct.version,
      image_url: updatedProduct.image_url ?? null,
      created_at: updatedProduct.created_at,
      ...(canReadCost
        ? {
            cost_price:
              updatedProduct.cost_price !== null && updatedProduct.cost_price !== undefined
                ? Number(updatedProduct.cost_price)
                : null,
            gross_margin:
              updatedProduct.cost_price !== null && updatedProduct.cost_price !== undefined
                ? calculateGrossMargin(sellingPrice, Number(updatedProduct.cost_price)).grossMarginPercentage
                : null,
          }
        : {}),
    };

    revalidatePath(`/${slug}/products`, "page");
    revalidatePath(`/${slug}/products/${productId}`, "page");

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

/**
 * Toggles product status between active and inactive with OCC version checking.
 */
export async function toggleProductStatusAction(
  slug: string,
  productId: string,
  expectedVersion: number,
  newStatus: "active" | "inactive"
): Promise<ActionResult<{ id: string; status: "active" | "inactive"; version: number }>> {
  try {
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

    if (!hasPermission(context, "products:update")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Unauthorized: missing products:update permission.",
        },
      };
    }

    const supabase = await createClient();
    const { data: rawRpcData, error } = await supabase.rpc("toggle_product_status", {
      p_org_id: context.organization.id,
      p_product_id: productId,
      p_expected_version: expectedVersion,
      p_new_status: newStatus,
    });

    if (error) {
      const mapped = KNOWN_ERROR_CODES[error.code] || {
        code: error.code || "RPC_ERROR",
        message: error.message || "Failed to update product status.",
      };
      return {
        success: false,
        error: {
          code: mapped.code,
          message: mapped.message,
        },
      };
    }

    const rpcPayload = rawRpcData as { success?: boolean; data?: { id: string; status: "active" | "inactive"; version: number } };
    if (!rpcPayload?.success || !rpcPayload?.data) {
      return {
        success: false,
        error: {
          code: "RPC_ERROR",
          message: "Database returned an invalid response structure.",
        },
      };
    }

    revalidatePath(`/${slug}/products`, "page");
    revalidatePath(`/${slug}/products/${productId}`, "page");

    return { success: true, data: rpcPayload.data };
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

/**
 * Archives a product with OCC version checking.
 */
export async function archiveProductAction(
  slug: string,
  productId: string,
  expectedVersion: number
): Promise<ActionResult<{ id: string; status: "archived"; version: number; archived_at: string }>> {
  try {
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

    if (!hasPermission(context, "products:archive")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Unauthorized: missing products:archive permission.",
        },
      };
    }

    const supabase = await createClient();
    const { data: rawRpcData, error } = await supabase.rpc("archive_product", {
      p_org_id: context.organization.id,
      p_product_id: productId,
      p_expected_version: expectedVersion,
    });

    if (error) {
      const mapped = KNOWN_ERROR_CODES[error.code] || {
        code: error.code || "RPC_ERROR",
        message: error.message || "Failed to archive product.",
      };
      return {
        success: false,
        error: {
          code: mapped.code,
          message: mapped.message,
        },
      };
    }

    const rpcPayload = rawRpcData as {
      success?: boolean;
      data?: { id: string; status: "archived"; version: number; archived_at: string };
    };
    if (!rpcPayload?.success || !rpcPayload?.data) {
      return {
        success: false,
        error: {
          code: "RPC_ERROR",
          message: "Database returned an invalid response structure.",
        },
      };
    }

    revalidatePath(`/${slug}/products`, "page");
    revalidatePath(`/${slug}/products/${productId}`, "page");

    return { success: true, data: rpcPayload.data };
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

/**
 * Restores an archived product to active with OCC version checking.
 */
export async function restoreProductAction(
  slug: string,
  productId: string,
  expectedVersion: number
): Promise<ActionResult<{ id: string; status: "active"; version: number }>> {
  try {
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

    if (!hasPermission(context, "products:archive")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Unauthorized: missing products:archive permission.",
        },
      };
    }

    const supabase = await createClient();
    const { data: rawRpcData, error } = await supabase.rpc("restore_product", {
      p_org_id: context.organization.id,
      p_product_id: productId,
      p_expected_version: expectedVersion,
    });

    if (error) {
      const mapped = KNOWN_ERROR_CODES[error.code] || {
        code: error.code || "RPC_ERROR",
        message: error.message || "Failed to restore product.",
      };
      return {
        success: false,
        error: {
          code: mapped.code,
          message: mapped.message,
        },
      };
    }

    const rpcPayload = rawRpcData as { success?: boolean; data?: { id: string; status: "active"; version: number } };
    if (!rpcPayload?.success || !rpcPayload?.data) {
      return {
        success: false,
        error: {
          code: "RPC_ERROR",
          message: "Database returned an invalid response structure.",
        },
      };
    }

    revalidatePath(`/${slug}/products`, "page");
    revalidatePath(`/${slug}/products/${productId}`, "page");

    return { success: true, data: rpcPayload.data };
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

