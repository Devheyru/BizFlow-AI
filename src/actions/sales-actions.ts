"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { executeSaleSchema } from "@/lib/validations/sales";
import { mapSalesError } from "@/lib/sales/error-codes";
import { formatCanonicalAmount, normalizeReferenceNo } from "@/lib/sales/canonical-hash";
import type { ActionResult } from "@/types/auth";
import type { SaleResult } from "@/types/sales";

interface ExecuteSaleRpcResponse {
  success: boolean;
  is_replay: boolean;
  sale_id: string;
  sale_number: string;
  status: "completed" | "voided" | "partially_returned" | "returned";
  payment_status: "paid" | "partially_refunded" | "refunded";
  subtotal: string | number;
  order_discount_amount: string | number;
  tax_amount: string | number;
  total_amount: string | number;
  currency: string;
  items_count: number;
  created_at: string;
  created_by: string;
}

/**
 * Server action to execute an atomic multi-item POS checkout transaction via public.execute_sale RPC.
 * - Requires `sales:create` permission.
 * - Idempotency is enforced server-side using client-supplied idempotency key.
 * - Snapshots unit prices, records tax allocations, validates payments, and creates stock movements.
 */
export async function executeSaleAction(
  slug: string,
  rawInput: unknown
): Promise<ActionResult<SaleResult>> {
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
    if (!hasPermission(context, "sales:create")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Unauthorized: missing sales:create permission.",
        },
      };
    }

    // 3. Zod Input Validation
    const parsed = executeSaleSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.errors[0]?.message || "Invalid sale checkout parameters.",
          details: parsed.error.flatten().fieldErrors,
        },
      };
    }
    const input = parsed.data;

    // 4. Transform payload for PostgreSQL execute_sale RPC
    const p_items = input.items.map((it) => ({
      product_id: it.productId,
      quantity: formatCanonicalAmount(it.quantity),
      line_discount_amount: formatCanonicalAmount(it.lineDiscountAmount),
      expected_version: it.expectedVersion ?? null,
    }));

    const p_payments = input.payments.map((pm) => ({
      payment_method: pm.paymentMethod,
      amount: formatCanonicalAmount(pm.amount),
      amount_tendered:
        pm.amountTendered != null ? formatCanonicalAmount(pm.amountTendered) : null,
      change_due: pm.changeDue != null ? formatCanonicalAmount(pm.changeDue) : null,
      reference_no: normalizeReferenceNo(pm.referenceNo),
    }));

    // 5. Invoke Authoritative Database RPC
    const supabase = await createClient();
    const { data: rawRpcData, error } = await supabase.rpc("execute_sale", {
      p_org_id: context.organization.id,
      p_customer_id: input.customerId ?? null,
      p_items,
      p_payments,
      p_order_discount_amount: input.orderDiscountAmount,
      p_idempotency_key: input.idempotencyKey,
      p_notes: input.notes ? input.notes.trim() : null,
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

    const rpcPayload = rawRpcData as unknown as ExecuteSaleRpcResponse | null;
    if (!rpcPayload || !rpcPayload.success) {
      return {
        success: false,
        error: {
          code: "SALE_EXECUTION_FAILED",
          message: "Failed to complete sale transaction.",
        },
      };
    }

    // 6. Cache Revalidation across POS, Sales, and Inventory
    revalidatePath(`/${slug}/sales`);
    revalidatePath(`/${slug}/pos`);
    revalidatePath(`/${slug}/inventory`);

    // 7. Format Result
    const saleResult: SaleResult = {
      success: true,
      isReplay: Boolean(rpcPayload.is_replay),
      saleId: rpcPayload.sale_id,
      saleNumber: rpcPayload.sale_number,
      status: rpcPayload.status,
      paymentStatus: rpcPayload.payment_status,
      subtotal: parseFloat(String(rpcPayload.subtotal)),
      orderDiscountAmount: parseFloat(String(rpcPayload.order_discount_amount)),
      taxAmount: parseFloat(String(rpcPayload.tax_amount)),
      totalAmount: parseFloat(String(rpcPayload.total_amount)),
      currency: rpcPayload.currency,
      itemsCount: Number(rpcPayload.items_count),
      createdAt: rpcPayload.created_at,
      createdBy: rpcPayload.created_by,
    };

    return {
      success: true,
      data: saleResult,
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
