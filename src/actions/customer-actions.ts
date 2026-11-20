"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import {
  createCustomerSchema,
  updateCustomerSchema,
  customerSearchSchema,
} from "@/lib/validations/customers";
import { mapSalesError } from "@/lib/sales/error-codes";
import type { ActionResult } from "@/types/auth";
import type {
  CustomerRecord,
  CustomerDetail,
  PaginatedCustomerResult,
} from "@/types/customers";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================================
// Feature 005 Customer Database RPC Results (Strict TypeScript, no `any`)
// ============================================================================

export interface CreateCustomerRpcResult {
  success: boolean;
  customer_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: "active" | "archived";
  created_at: string;
}

export interface UpdateCustomerRpcResult {
  success: boolean;
  customer_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: "active" | "archived";
  updated_at: string;
}

export interface ArchiveCustomerRpcResult {
  success: boolean;
  customer_id: string;
  status: "archived";
  is_noop: boolean;
  updated_at: string;
}

export interface CustomerPurchaseHistoryItem {
  id: string;
  saleNumber: string;
  status: string;
  paymentStatus: string;
  subtotal: number;
  orderDiscountAmount: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;
  createdAt: string;
  createdBy: string;
}

// ============================================================================
// 1. createCustomerAction (T039, US2, CUS-001–CUS-004)
// ============================================================================
/**
 * Creates a customer profile scoped to active tenant organization via trusted procedure public.create_customer.
 * Requires `customers:create` permission.
 */
export async function createCustomerAction(
  slug: string,
  rawInput: unknown
): Promise<ActionResult<CustomerRecord>> {
  try {
    // 1. Authoritative Server-Side Tenant Resolution
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
    if (!hasPermission(context, "customers:create")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Unauthorized: missing customers:create permission.",
        },
      };
    }

    // 3. Zod Input Validation
    const parsed = createCustomerSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid customer input.",
          details: parsed.error.flatten().fieldErrors,
        },
      };
    }
    const input = parsed.data;

    // 4. Invoke Trusted Database RPC
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_customer", {
      p_org_id: context.organization.id,
      p_name: input.name,
      p_phone: input.phone ?? null,
      p_email: input.email ?? null,
      p_notes: input.notes ?? null,
    });

    if (error) {
      const mapped = mapSalesError(error);
      return {
        success: false,
        error: {
          code: mapped.code,
          message: mapped.message,
        },
      };
    }

    if (!data) {
      return {
        success: false,
        error: {
          code: "DATABASE_OPERATION_FAILED",
          message: "No data returned from customer creation.",
        },
      };
    }

    const rpcResult = data as unknown as CreateCustomerRpcResult;

    // 5. Revalidate Affected Routes
    revalidatePath(`/${slug}/customers`);

    // 6. Return Structured Contract
    const record: CustomerRecord = {
      id: rpcResult.customer_id,
      organizationId: context.organization.id,
      name: rpcResult.name,
      phone: rpcResult.phone ?? null,
      email: rpcResult.email ?? null,
      notes: input.notes ?? null,
      status: rpcResult.status,
      createdAt: rpcResult.created_at,
      updatedAt: rpcResult.created_at,
    };

    return {
      success: true,
      data: record,
    };
  } catch (err) {
    const mapped = mapSalesError(err);
    return {
      success: false,
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    };
  }
}

// ============================================================================
// 2. updateCustomerAction (T040, US2, CUS-006)
// ============================================================================
/**
 * Updates an active customer profile within the active organization via public.update_customer.
 * Requires `customers:update` permission.
 */
export async function updateCustomerAction(
  slug: string,
  customerId: string,
  rawInput: unknown
): Promise<ActionResult<CustomerRecord>> {
  try {
    // 1. Customer ID UUID validation
    if (!customerId || !UUID_REGEX.test(customerId)) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid customer ID format.",
        },
      };
    }

    // 2. Authoritative Server-Side Tenant Resolution
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

    // 3. Application Permission Guard
    if (!hasPermission(context, "customers:update")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Unauthorized: missing customers:update permission.",
        },
      };
    }

    // 4. Zod Input Validation
    const parsed = updateCustomerSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid customer update input.",
          details: parsed.error.flatten().fieldErrors,
        },
      };
    }
    const input = parsed.data;

    // 5. Retrieve Existing Customer Record
    const supabase = await createClient();
    const { data: existing, error: existingErr } = await supabase
      .from("customers")
      .select("id, organization_id, name, phone, email, notes, status, created_at, updated_at")
      .eq("id", customerId)
      .eq("organization_id", context.organization.id)
      .single();

    if (existingErr || !existing) {
      return {
        success: false,
        error: {
          code: "CUSTOMER_NOT_FOUND",
          message: "Customer not found.",
        },
      };
    }

    if (existing.status === "archived") {
      return {
        success: false,
        error: {
          code: "CUSTOMER_ARCHIVED",
          message: "Archived customer cannot be updated.",
        },
      };
    }

    // Merge partial update with existing values
    const finalName = input.name !== undefined ? input.name : existing.name;
    const finalPhone = input.phone !== undefined ? input.phone : existing.phone;
    const finalEmail = input.email !== undefined ? input.email : existing.email;
    const finalNotes = input.notes !== undefined ? input.notes : existing.notes;

    // 6. Invoke Trusted Database RPC
    const { data, error } = await supabase.rpc("update_customer", {
      p_org_id: context.organization.id,
      p_customer_id: customerId,
      p_name: finalName,
      p_phone: finalPhone ?? null,
      p_email: finalEmail ?? null,
      p_notes: finalNotes ?? null,
    });

    if (error) {
      const mapped = mapSalesError(error);
      return {
        success: false,
        error: {
          code: mapped.code,
          message: mapped.message,
        },
      };
    }

    if (!data) {
      return {
        success: false,
        error: {
          code: "DATABASE_OPERATION_FAILED",
          message: "No data returned from customer update.",
        },
      };
    }

    const rpcResult = data as unknown as UpdateCustomerRpcResult;

    // 7. Revalidate Affected Routes
    revalidatePath(`/${slug}/customers`);
    revalidatePath(`/${slug}/customers/${customerId}`);

    // 8. Return Structured Contract
    const record: CustomerRecord = {
      id: customerId,
      organizationId: context.organization.id,
      name: rpcResult.name,
      phone: rpcResult.phone ?? null,
      email: rpcResult.email ?? null,
      notes: finalNotes ?? null,
      status: rpcResult.status,
      createdAt: existing.created_at,
      updatedAt: rpcResult.updated_at,
    };

    return {
      success: true,
      data: record,
    };
  } catch (err) {
    const mapped = mapSalesError(err);
    return {
      success: false,
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    };
  }
}

// ============================================================================
// 3. archiveCustomerAction (T041, US2, CUS-007, CUS-008)
// ============================================================================
/**
 * Soft-archives a customer record via public.archive_customer. Preserves historical sales.
 * Requires `customers:archive` permission.
 */
export async function archiveCustomerAction(
  slug: string,
  customerId: string
): Promise<ActionResult<{ archived: boolean }>> {
  try {
    // 1. Customer ID UUID validation
    if (!customerId || !UUID_REGEX.test(customerId)) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid customer ID format.",
        },
      };
    }

    // 2. Authoritative Server-Side Tenant Resolution
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

    // 3. Application Permission Guard
    if (!hasPermission(context, "customers:archive")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Unauthorized: missing customers:archive permission.",
        },
      };
    }

    // 4. Invoke Trusted Database RPC
    const supabase = await createClient();
    const { error } = await supabase.rpc("archive_customer", {
      p_org_id: context.organization.id,
      p_customer_id: customerId,
    });

    if (error) {
      const mapped = mapSalesError(error);
      return {
        success: false,
        error: {
          code: mapped.code,
          message: mapped.message,
        },
      };
    }

    // 5. Revalidate Affected Routes
    revalidatePath(`/${slug}/customers`);
    revalidatePath(`/${slug}/customers/${customerId}`);

    return {
      success: true,
      data: { archived: true },
    };
  } catch (err) {
    const mapped = mapSalesError(err);
    return {
      success: false,
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    };
  }
}

// ============================================================================
// 4. searchCustomersAction (T042, US2, CUS-005)
// ============================================================================
/**
 * Searches and paginates customers by name, phone, or email within the active organization.
 * Requires `customers:read` permission.
 */
export async function searchCustomersAction(
  slug: string,
  rawQuery: unknown
): Promise<ActionResult<PaginatedCustomerResult>> {
  try {
    // 1. Authoritative Server-Side Tenant Resolution
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
    if (!hasPermission(context, "customers:read")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Unauthorized: missing customers:read permission.",
        },
      };
    }

    // 3. Zod Input Validation
    const parsed = customerSearchSchema.safeParse(rawQuery ?? {});
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid customer search parameters.",
          details: parsed.error.flatten().fieldErrors,
        },
      };
    }
    const input = parsed.data;

    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // 4. PostgREST Tenant-Scoped Query
    const supabase = await createClient();
    let query = supabase
      .from("customers")
      .select("id, organization_id, name, phone, email, notes, status, created_at, updated_at", {
        count: "exact",
      })
      .eq("organization_id", context.organization.id);

    if (input.status && input.status !== "all") {
      query = query.eq("status", input.status);
    }

    if (input.search) {
      // Sanitize search string to prevent PostgREST expression injection
      const sanitized = input.search.replace(/[,()\\%]/g, "").trim();
      if (sanitized) {
        query = query.or(
          `name.ilike.%${sanitized}%,phone.ilike.%${sanitized}%,email.ilike.%${sanitized}%`
        );
      }
    }

    // Deterministic sorting: by name asc, then created_at desc
    query = query.order("name", { ascending: true }).order("created_at", { ascending: false });
    query = query.range(from, to);

    const { data, count, error } = await query;

    if (error) {
      const mapped = mapSalesError(error);
      return {
        success: false,
        error: {
          code: mapped.code,
          message: mapped.message,
        },
      };
    }

    const items: CustomerRecord[] = (data || []).map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      notes: row.notes,
      status: row.status as "active" | "archived",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    const totalCount = count ?? 0;
    const totalPages = Math.ceil(totalCount / pageSize);

    return {
      success: true,
      data: {
        items,
        totalCount,
        page,
        pageSize,
        totalPages,
      },
    };
  } catch (err) {
    const mapped = mapSalesError(err);
    return {
      success: false,
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    };
  }
}

// ============================================================================
// 5. getCustomerDetailAction (T043, US2)
// ============================================================================
/**
 * Retrieves full customer detail including aggregated lifetime purchase count, last purchase date, and total spent.
 * Requires `customers:read` permission.
 */
export async function getCustomerDetailAction(
  slug: string,
  customerId: string
): Promise<ActionResult<CustomerDetail>> {
  try {
    // 1. Customer ID UUID validation
    if (!customerId || !UUID_REGEX.test(customerId)) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid customer ID format.",
        },
      };
    }

    // 2. Authoritative Server-Side Tenant Resolution
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

    // 3. Application Permission Guard
    if (!hasPermission(context, "customers:read")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Unauthorized: missing customers:read permission.",
        },
      };
    }

    // 4. Retrieve Customer Record
    const supabase = await createClient();
    const { data: customer, error: customerErr } = await supabase
      .from("customers")
      .select("id, organization_id, name, phone, email, notes, status, created_at, updated_at")
      .eq("id", customerId)
      .eq("organization_id", context.organization.id)
      .single();

    if (customerErr || !customer) {
      return {
        success: false,
        error: {
          code: "CUSTOMER_NOT_FOUND",
          message: "Customer not found.",
        },
      };
    }

    // 5. Retrieve Aggregated Purchase Metrics from sales if user has sales:read permission
    const canReadSales = hasPermission(context, "sales:read");
    let purchaseCount: number | null = null;
    let lastPurchaseAt: string | null = null;
    let totalSpent: number | null = null;

    if (canReadSales) {
      const { data: sales, error: salesErr } = await supabase
        .from("sales")
        .select("id, total_amount, created_at, status")
        .eq("organization_id", context.organization.id)
        .eq("customer_id", customerId)
        .in("status", ["completed", "partially_returned", "returned"])
        .order("created_at", { ascending: false });

      if (salesErr) {
        const mapped = mapSalesError(salesErr);
        return {
          success: false,
          error: {
            code: mapped.code,
            message: mapped.message,
          },
        };
      }

      purchaseCount = sales ? sales.length : 0;
      lastPurchaseAt = sales && sales.length > 0 && sales[0] ? sales[0].created_at : null;
      const rawTotalSpent = sales ? sales.reduce((sum, s) => sum + Number(s.total_amount), 0) : 0;
      totalSpent = Number(rawTotalSpent.toFixed(2));
    }

    const detail: CustomerDetail = {
      id: customer.id,
      organizationId: customer.organization_id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      notes: customer.notes,
      status: customer.status as "active" | "archived",
      createdAt: customer.created_at,
      updatedAt: customer.updated_at,
      purchaseCount,
      lastPurchaseAt,
      totalSpent,
      salesMetricsRestricted: !canReadSales,
    };

    return {
      success: true,
      data: detail,
    };
  } catch (err) {
    const mapped = mapSalesError(err);
    return {
      success: false,
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    };
  }
}

// ============================================================================
// 6. getCustomerPurchaseHistoryAction (T046 Purchase History Tab)
// ============================================================================
/**
 * Retrieves historical completed transactions linked to a customer for the Purchase History tab.
 * Requires `customers:read` AND `sales:read` permissions.
 * Does NOT expose cost, valuation, or profit data.
 */
export async function getCustomerPurchaseHistoryAction(
  slug: string,
  customerId: string
): Promise<ActionResult<CustomerPurchaseHistoryItem[]>> {
  try {
    // 1. Customer ID UUID validation
    if (!customerId || !UUID_REGEX.test(customerId)) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid customer ID format.",
        },
      };
    }

    // 2. Authoritative Server-Side Tenant Resolution
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

    // 3. Permission Guards: Requires both customers:read and sales:read
    if (!hasPermission(context, "customers:read")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Unauthorized: missing customers:read permission.",
        },
      };
    }

    if (!hasPermission(context, "sales:read")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Unauthorized: missing sales:read permission to view purchase history.",
        },
      };
    }

    // 4. Verify Customer Existence for this Organization
    const supabase = await createClient();
    const { data: customerRow, error: customerErr } = await supabase
      .from("customers")
      .select("id")
      .eq("id", customerId)
      .eq("organization_id", context.organization.id)
      .single();

    if (customerErr || !customerRow) {
      return {
        success: false,
        error: {
          code: "CUSTOMER_NOT_FOUND",
          message: "Customer not found.",
        },
      };
    }

    // 5. Query Historical Completed Sales
    const { data: sales, error: salesErr } = await supabase
      .from("sales")
      .select(
        "id, sale_number, status, payment_status, subtotal, order_discount_amount, tax_amount, total_amount, currency, created_at, created_by"
      )
      .eq("organization_id", context.organization.id)
      .eq("customer_id", customerId)
      .in("status", ["completed", "partially_returned", "returned"])
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (salesErr) {
      const mapped = mapSalesError(salesErr);
      return {
        success: false,
        error: {
          code: mapped.code,
          message: mapped.message,
        },
      };
    }

    const items: CustomerPurchaseHistoryItem[] = (sales || []).map((s) => ({
      id: s.id,
      saleNumber: s.sale_number,
      status: s.status,
      paymentStatus: s.payment_status,
      subtotal: Number(s.subtotal),
      orderDiscountAmount: Number(s.order_discount_amount),
      taxAmount: Number(s.tax_amount),
      totalAmount: Number(s.total_amount),
      currency: s.currency,
      createdAt: s.created_at,
      createdBy: s.created_by,
    }));

    return {
      success: true,
      data: items,
    };
  } catch (err) {
    const mapped = mapSalesError(err);
    return {
      success: false,
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    };
  }
}
