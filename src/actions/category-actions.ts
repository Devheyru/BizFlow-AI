"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { CreateCategorySchema, UpdateCategorySchema } from "@/lib/validations/category";
import type { ActionResult } from "@/types/auth";
import type { CategoryStatus } from "@/types/product";

// ============================================================================
// Types & Contracts (specs/003-products-categories/contracts/server-actions.md)
// ============================================================================

export interface CategoryResponse {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  status: CategoryStatus;
  created_at?: string;
  updated_at?: string;
  archived_at?: string | null;
}

interface RpcCategoryData {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  status: CategoryStatus;
  created_at?: string;
  updated_at?: string;
  archived_at?: string | null;
}

const KNOWN_ERROR_CODES: Record<string, { code: string; message: string }> = {
  P0001: { code: "EMAIL_UNVERIFIED", message: "Email verification required." },
  P0002: { code: "RESOURCE_NOT_FOUND", message: "Target category was not found in this organization." },
  P0003: { code: "UNAUTHENTICATED", message: "Authentication required." },
  P0004: { code: "UNAUTHORIZED_MEMBERSHIP", message: "Caller is not an active member of this organization." },
  P0005: { code: "FORBIDDEN", message: "Insufficient permissions to perform this action." },
  P0006: { code: "IDENTIFIER_EXISTS", message: "A category with this name already exists in this organization." },
  P0009: { code: "VALIDATION_ERROR", message: "Invalid category parameters provided." },
  P0015: { code: "STATE_CONFLICT", message: "This operation conflicts with the current category status." },
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================================
// Category Server Actions
// ============================================================================

/**
 * Creates a new active product category within the organization (T046, US4).
 * Requires `categories:create` permission (Owner, Admin, Manager).
 */
export async function createCategoryAction(
  slug: string,
  rawInput: unknown
): Promise<ActionResult<CategoryResponse>> {
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

    // 2. Application Permission Guard
    if (!hasPermission(context, "categories:create")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Unauthorized: missing categories:create permission.",
        },
      };
    }

    // 3. Zod Input Validation
    const parsed = CreateCategorySchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid category parameters provided.",
          details: parsed.error.flatten().fieldErrors,
        },
      };
    }
    const input = parsed.data;

    // 4. Database RPC Invocation
    const supabase = await createClient();
    const { data: rawRpcData, error } = await supabase.rpc("create_product_category", {
      p_org_id: context.organization.id,
      p_name: input.name,
      p_description: input.description ?? undefined,
    });

    if (error) {
      const mapped = KNOWN_ERROR_CODES[error.code] || {
        code: error.code || "RPC_ERROR",
        message: error.message || "Failed to create category.",
      };
      return {
        success: false,
        error: {
          code: mapped.code,
          message: mapped.message,
        },
      };
    }

    const rpcPayload = rawRpcData as { success?: boolean; data?: RpcCategoryData };
    if (!rpcPayload?.success || !rpcPayload?.data) {
      return {
        success: false,
        error: {
          code: "RPC_ERROR",
          message: "Database returned an invalid response structure.",
        },
      };
    }

    const created = rpcPayload.data;
    const response: CategoryResponse = {
      id: created.id,
      organization_id: created.organization_id,
      name: created.name,
      description: created.description,
      status: created.status,
      created_at: created.created_at,
    };

    // 5. Cache Invalidation
    revalidatePath(`/${slug}/products`, "layout");
    revalidatePath(`/${slug}/products/categories`, "page");

    return {
      success: true,
      data: response,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "An unexpected server error occurred.";
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
 * Updates an active product category name and/or description (T046, US4).
 * Requires `categories:update` permission (Owner, Admin, Manager).
 */
export async function updateCategoryAction(
  slug: string,
  categoryId: string,
  rawInput: unknown
): Promise<ActionResult<CategoryResponse>> {
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

    // 2. Application Permission Guard
    if (!hasPermission(context, "categories:update")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Unauthorized: missing categories:update permission.",
        },
      };
    }

    // 3. ID Validation
    if (!categoryId || !UUID_REGEX.test(categoryId)) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid category ID provided.",
        },
      };
    }

    // 4. Zod Input Validation
    const parsed = UpdateCategorySchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid category parameters provided.",
          details: parsed.error.flatten().fieldErrors,
        },
      };
    }
    const input = parsed.data;

    // 5. Database RPC Invocation
    const supabase = await createClient();
    const { data: rawRpcData, error } = await supabase.rpc("update_product_category", {
      p_org_id: context.organization.id,
      p_category_id: categoryId,
      p_name: input.name,
      p_description: input.description ?? undefined,
    });

    if (error) {
      const mapped = KNOWN_ERROR_CODES[error.code] || {
        code: error.code || "RPC_ERROR",
        message: error.message || "Failed to update category.",
      };
      return {
        success: false,
        error: {
          code: mapped.code,
          message: mapped.message,
        },
      };
    }

    const rpcPayload = rawRpcData as { success?: boolean; data?: RpcCategoryData };
    if (!rpcPayload?.success || !rpcPayload?.data) {
      return {
        success: false,
        error: {
          code: "RPC_ERROR",
          message: "Database returned an invalid response structure.",
        },
      };
    }

    const updated = rpcPayload.data;
    const response: CategoryResponse = {
      id: updated.id,
      organization_id: updated.organization_id,
      name: updated.name,
      description: updated.description,
      status: updated.status,
      updated_at: updated.updated_at,
    };

    // 6. Cache Invalidation
    revalidatePath(`/${slug}/products`, "layout");
    revalidatePath(`/${slug}/products/categories`, "page");

    return {
      success: true,
      data: response,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "An unexpected server error occurred.";
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
 * Soft-deletes / archives a product category (T046, US4).
 * Requires `categories:archive` permission (Owner, Admin only; Manager is denied).
 * Invariant: Products assigned to this category retain their category_id reference.
 */
export async function archiveCategoryAction(
  slug: string,
  categoryId: string
): Promise<ActionResult<{ id: string; status: "archived"; archived_at: string }>> {
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

    // 2. Application Permission Guard
    if (!hasPermission(context, "categories:archive")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Unauthorized: missing categories:archive permission.",
        },
      };
    }

    // 3. ID Validation
    if (!categoryId || !UUID_REGEX.test(categoryId)) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid category ID provided.",
        },
      };
    }

    // 4. Database RPC Invocation
    const supabase = await createClient();
    const { data: rawRpcData, error } = await supabase.rpc("archive_product_category", {
      p_org_id: context.organization.id,
      p_category_id: categoryId,
    });

    if (error) {
      const mapped = KNOWN_ERROR_CODES[error.code] || {
        code: error.code || "RPC_ERROR",
        message: error.message || "Failed to archive category.",
      };
      return {
        success: false,
        error: {
          code: mapped.code,
          message: mapped.message,
        },
      };
    }

    const rpcPayload = rawRpcData as { success?: boolean; data?: RpcCategoryData };
    if (!rpcPayload?.success || !rpcPayload?.data) {
      return {
        success: false,
        error: {
          code: "RPC_ERROR",
          message: "Database returned an invalid response structure.",
        },
      };
    }

    const archived = rpcPayload.data;

    // 5. Cache Invalidation
    revalidatePath(`/${slug}/products`, "layout");
    revalidatePath(`/${slug}/products/categories`, "page");

    return {
      success: true,
      data: {
        id: archived.id,
        status: "archived",
        archived_at: archived.archived_at || new Date().toISOString(),
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "An unexpected server error occurred.";
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
 * Restores an archived category back to active status (T046, US4).
 * Requires `categories:archive` permission (Owner, Admin only).
 */
export async function restoreCategoryAction(
  slug: string,
  categoryId: string
): Promise<ActionResult<{ id: string; status: "active"; archived_at: null }>> {
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

    // 2. Application Permission Guard
    if (!hasPermission(context, "categories:archive")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Unauthorized: missing categories:archive permission.",
        },
      };
    }

    // 3. ID Validation
    if (!categoryId || !UUID_REGEX.test(categoryId)) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid category ID provided.",
        },
      };
    }

    // 4. Database RPC Invocation
    const supabase = await createClient();
    const { data: rawRpcData, error } = await supabase.rpc("restore_product_category", {
      p_org_id: context.organization.id,
      p_category_id: categoryId,
    });

    if (error) {
      const mapped = KNOWN_ERROR_CODES[error.code] || {
        code: error.code || "RPC_ERROR",
        message: error.message || "Failed to restore category.",
      };
      return {
        success: false,
        error: {
          code: mapped.code,
          message: mapped.message,
        },
      };
    }

    const rpcPayload = rawRpcData as { success?: boolean; data?: RpcCategoryData };
    if (!rpcPayload?.success || !rpcPayload?.data) {
      return {
        success: false,
        error: {
          code: "RPC_ERROR",
          message: "Database returned an invalid response structure.",
        },
      };
    }

    const restored = rpcPayload.data;

    // 5. Cache Invalidation
    revalidatePath(`/${slug}/products`, "layout");
    revalidatePath(`/${slug}/products/categories`, "page");

    return {
      success: true,
      data: {
        id: restored.id,
        status: "active",
        archived_at: null,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "An unexpected server error occurred.";
    return {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message,
      },
    };
  }
}

