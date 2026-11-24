"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import {
  executeSaleSchema,
  salesListQuerySchema,
  voidSaleSchema,
  executeSaleReturnSchema,
  confirmRefundSchema,
  recordRefundFailureSchema,
  issueReplacementRefundSchema,
} from "@/lib/validations/sales";
import { mapSalesError } from "@/lib/sales/error-codes";
import { formatCanonicalAmount, normalizeReferenceNo } from "@/lib/sales/canonical-hash";
import type { ActionResult } from "@/types/auth";
import type {
  SaleResult,
  SaleStatus,
  PaymentStatus,
  PaymentMethod,
  RefundStatus,
  PaginatedSalesList,
  SaleListItem,
  SaleDetail,
  SaleDetailHeader,
  SaleDetailCustomer,
  SaleItemRecord,
  PaymentRecord,
  ReturnRecord,
  RefundRecord,
  ReturnHistory,
  ReturnItemRecord,
  VoidResult,
  ReturnResult,
  RefundConfirmation,
  RefundFailureResult,
  ReplacementRefundResult,
} from "@/types/sales";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

interface RawSaleDetailRpcResponse {
  sale: {
    id: string;
    organization_id: string;
    sale_number: string;
    customer_id: string | null;
    status: "completed" | "voided" | "partially_returned" | "returned";
    payment_status: "paid" | "partially_refunded" | "refunded";
    subtotal: string | number;
    order_discount_amount: string | number;
    taxable_amount: string | number;
    tax_amount: string | number;
    total_amount: string | number;
    currency: string;
    is_tax_inclusive: boolean;
    tax_rate: string | number;
    tax_name: string;
    notes: string | null;
    created_at: string;
    created_by: string;
  };
  customer: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    status: string;
  } | null;
  items: Array<{
    id: string;
    product_id: string;
    product_name: string;
    sku: string;
    quantity: string | number;
    unit_price: string | number;
    unit_cost: string | number | null;
    line_discount_amount: string | number;
    allocated_order_disc: string | number;
    taxable_amount: string | number;
    allocated_tax_amount: string | number;
    total_price: string | number;
    movement_id: string | null;
  }>;
  payments: Array<{
    id: string;
    payment_method: "cash" | "card" | "bank_transfer" | "other";
    amount: string | number;
    amount_tendered: string | number | null;
    change_due: string | number | null;
    reference_no: string | null;
    created_at: string;
  }>;
  returns: Array<{
    id: string;
    return_number: string;
    reason: string;
    total_refund_amount: string | number;
    created_at: string;
    created_by: string;
  }>;
  refunds: Array<{
    id: string;
    return_id: string | null;
    parent_refund_id: string | null;
    obligation_refund_id: string;
    refund_method: "cash" | "card" | "bank_transfer" | "other";
    amount: string | number;
    reference_no: string | null;
    status: "completed" | "pending" | "failed";
    reason?: string | null;
    created_at: string;
  }>;
}

// ============================================================================
// 1. Execute Sale Action (T048, US1, US3)
// ============================================================================

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

// ============================================================================
// 2. Sales List Action (T060, US5)
// ============================================================================

/**
 * Resolves the IANA timezone offset string (e.g. '+00:00', '-05:00') for a calendar date.
 */
function getTimezoneOffsetString(dateStr: string, timeZone?: string | null): string {
  try {
    const probe = new Date(`${dateStr}T12:00:00Z`);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "UTC",
      timeZoneName: "longOffset",
    }).formatToParts(probe);
    const tzPart = parts.find((p) => p.type === "timeZoneName")?.value;
    if (!tzPart || tzPart === "GMT") return "+00:00";
    return tzPart.replace("GMT", "");
  } catch {
    return "+00:00";
  }
}

/**
 * Normalizes a date query filter into an authoritative UTC ISO string:
 * - Plain calendar dates (YYYY-MM-DD) expand to start-of-day (00:00:00.000) or end-of-day (23:59:59.999)
 *   in the organization's configured IANA timezone (public.organizations.timezone).
 * - Full ISO datetime strings are converted directly to UTC ISO strings.
 */
function parseDateQueryBoundary(
  dateStr: string,
  boundary: "start" | "end",
  timeZone?: string | null
): string {
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const offset = getTimezoneOffsetString(trimmed, timeZone || "UTC");
    const time = boundary === "start" ? "00:00:00.000" : "23:59:59.999";
    return new Date(`${trimmed}T${time}${offset}`).toISOString();
  }
  return new Date(trimmed).toISOString();
}

/**
 * Server action to retrieve a paginated, filterable list of sales (T060, US5).
 * - Requires `sales:read` permission.
 * - Supports filters: date range (fromDate, toDate), status, customer, cashier, search query.
 * - Enforces cost confidentiality: direct SELECT on `sale_items.unit_cost` is never queried.
 * - Deterministic ordering by sortBy and id prevents pagination drift.
 */
export async function getSalesListAction(
  slug: string,
  rawQuery: unknown
): Promise<ActionResult<PaginatedSalesList>> {
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

    // 2. Application Permission Guard (sales:read)
    if (!hasPermission(context, "sales:read")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Insufficient permissions to view sales history.",
        },
      };
    }

    // 3. Validate Query Parameters via Zod
    const parsed = salesListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      const flattened = parsed.error.flatten();
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message:
            flattened.formErrors[0] ||
            Object.values(flattened.fieldErrors)[0]?.[0] ||
            "Invalid sales query parameters.",
          details: flattened.fieldErrors,
        },
      };
    }
    const query = parsed.data;

    // 4. Construct PostgREST Query
    const supabase = await createClient();
    let dbQuery = supabase
      .from("sales")
      .select(
        `
          id,
          sale_number,
          status,
          payment_status,
          customer_id,
          subtotal,
          order_discount_amount,
          tax_amount,
          total_amount,
          currency,
          created_by,
          created_at,
          customers ( id, name )
        `,
        { count: "exact" }
      )
      .eq("organization_id", context.organization.id);

    // Apply Filters
    if (query.search && query.search.trim().length > 0) {
      dbQuery = dbQuery.ilike("sale_number", `%${query.search.trim()}%`);
    }

    if (query.status && query.status !== "all") {
      dbQuery = dbQuery.eq("status", query.status);
    }

    if (query.customerId) {
      dbQuery = dbQuery.eq("customer_id", query.customerId);
    }

    if (query.cashierId) {
      dbQuery = dbQuery.eq("created_by", query.cashierId);
    }

    const orgTimezone = context.organization.timezone || "UTC";

    if (query.fromDate) {
      const fromDateIso = parseDateQueryBoundary(query.fromDate, "start", orgTimezone);
      dbQuery = dbQuery.gte("created_at", fromDateIso);
    }

    if (query.toDate) {
      const toDateIso = parseDateQueryBoundary(query.toDate, "end", orgTimezone);
      dbQuery = dbQuery.lte("created_at", toDateIso);
    }

    // Deterministic Sorting
    const sortAscending = query.sortOrder === "asc";
    dbQuery = dbQuery
      .order(query.sortBy, { ascending: sortAscending })
      .order("id", { ascending: true });

    // Pagination via .range()
    const from = (query.page - 1) * query.pageSize;
    const to = from + query.pageSize - 1;
    dbQuery = dbQuery.range(from, to);

    const { data: salesRows, count, error } = await dbQuery;

    if (error) {
      return {
        success: false,
        error: mapSalesError(error),
      };
    }

    const totalCount = count ?? 0;
    const totalPages = Math.ceil(totalCount / query.pageSize) || 1;

    // 5. Gather item counts and cashier profiles safely without N+1 or cost leakage
    const saleIds = (salesRows || []).map((s) => s.id);
    const itemCountsMap: Record<string, number> = {};
    const cashierMap: Record<string, string> = {};

    if (saleIds.length > 0) {
      // Direct SELECT on safe columns (id, sale_id) of sale_items (unit_cost omitted)
      const { data: itemRows } = await supabase
        .from("sale_items")
        .select("id, sale_id")
        .eq("organization_id", context.organization.id)
        .in("sale_id", saleIds);

      if (itemRows) {
        for (const item of itemRows) {
          itemCountsMap[item.sale_id] = (itemCountsMap[item.sale_id] || 0) + 1;
        }
      }

      // Resolve cashier display names from profiles
      const cashierIds = Array.from(
        new Set((salesRows || []).map((s) => s.created_by).filter(Boolean))
      );
      if (cashierIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, first_name, last_name")
          .in("id", cashierIds);

        if (profiles) {
          for (const p of profiles) {
            cashierMap[p.id] = `${p.first_name} ${p.last_name}`.trim();
          }
        }
      }
    }

    // 6. Map to Domain SaleListItem
    const items: SaleListItem[] = (salesRows || []).map((s) => {
      const cust = s.customers as unknown as { id: string; name: string } | null;
      return {
        id: s.id,
        saleNumber: s.sale_number,
        status: s.status as SaleStatus,
        paymentStatus: s.payment_status as PaymentStatus,
        customerId: s.customer_id,
        customerName: cust?.name ?? null,
        itemsCount: itemCountsMap[s.id] ?? 0,
        subtotal: parseFloat(String(s.subtotal)),
        orderDiscountAmount: parseFloat(String(s.order_discount_amount)),
        taxAmount: parseFloat(String(s.tax_amount)),
        totalAmount: parseFloat(String(s.total_amount)),
        currency: s.currency,
        cashierId: s.created_by,
        cashierName: cashierMap[s.created_by] ?? null,
        createdAt: s.created_at,
      };
    });

    return {
      success: true,
      data: {
        items,
        totalCount,
        page: query.page,
        pageSize: query.pageSize,
        totalPages,
      },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: mapSalesError(err),
    };
  }
}

// ============================================================================
// 3. Sale Detail Action (T061, US5)
// ============================================================================

/**
 * Server action to retrieve complete sale detail breakdown via public.get_sale_detail RPC (T061, US5).
 * - Requires `sales:read` permission.
 * - Database-enforced cost masking: unit_cost is NULL unless caller holds BOTH
 *   `inventory:read_valuation` AND `products:read_cost`.
 * - Retrieves line items, payment tenders, return records, and refund allocations.
 */
export async function getSaleDetailAction(
  slug: string,
  saleId: string
): Promise<ActionResult<SaleDetail>> {
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
    if (!hasPermission(context, "sales:read")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Insufficient permissions to view sale details.",
        },
      };
    }

    // 3. Validate Sale Identifier
    if (!saleId || !UUID_REGEX.test(saleId)) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid sale ID format.",
        },
      };
    }

    // 4. Call Authoritative Database RPC
    const supabase = await createClient();
    const { data: rawRpcData, error } = await supabase.rpc("get_sale_detail", {
      p_org_id: context.organization.id,
      p_sale_id: saleId,
    });

    if (error) {
      return {
        success: false,
        error: mapSalesError(error),
      };
    }

    const payload = rawRpcData as unknown as RawSaleDetailRpcResponse | null;
    if (!payload || !payload.sale) {
      return {
        success: false,
        error: {
          code: "SALE_NOT_FOUND",
          message: "Sale not found.",
        },
      };
    }

    // 5. Transform to strongly-typed domain SaleDetail
    const saleHeader: SaleDetailHeader = {
      id: payload.sale.id,
      organizationId: payload.sale.organization_id,
      saleNumber: payload.sale.sale_number,
      customerId: payload.sale.customer_id,
      status: payload.sale.status,
      paymentStatus: payload.sale.payment_status,
      subtotal: parseFloat(String(payload.sale.subtotal)),
      orderDiscountAmount: parseFloat(String(payload.sale.order_discount_amount)),
      taxableAmount: parseFloat(String(payload.sale.taxable_amount)),
      taxAmount: parseFloat(String(payload.sale.tax_amount)),
      totalAmount: parseFloat(String(payload.sale.total_amount)),
      currency: payload.sale.currency,
      isTaxInclusive: Boolean(payload.sale.is_tax_inclusive),
      taxRate: parseFloat(String(payload.sale.tax_rate)),
      taxName: payload.sale.tax_name,
      notes: payload.sale.notes,
      createdAt: payload.sale.created_at,
      createdBy: payload.sale.created_by,
    };

    const customer: SaleDetailCustomer | null = payload.customer
      ? {
          id: payload.customer.id,
          name: payload.customer.name,
          phone: payload.customer.phone,
          email: payload.customer.email,
        }
      : null;

    const items: SaleItemRecord[] = (payload.items || []).map((it) => ({
      id: it.id,
      productId: it.product_id,
      productName: it.product_name,
      sku: it.sku,
      quantity: parseFloat(String(it.quantity)),
      unitPrice: parseFloat(String(it.unit_price)),
      unitCost: it.unit_cost != null ? parseFloat(String(it.unit_cost)) : null,
      lineDiscountAmount: parseFloat(String(it.line_discount_amount)),
      allocatedOrderDisc: parseFloat(String(it.allocated_order_disc)),
      taxableAmount: parseFloat(String(it.taxable_amount)),
      allocatedTaxAmount: parseFloat(String(it.allocated_tax_amount)),
      totalPrice: parseFloat(String(it.total_price)),
      movementId: it.movement_id,
    }));

    const payments: PaymentRecord[] = (payload.payments || []).map((pm) => ({
      id: pm.id,
      paymentMethod: pm.payment_method,
      amount: parseFloat(String(pm.amount)),
      amountTendered:
        pm.amount_tendered != null ? parseFloat(String(pm.amount_tendered)) : null,
      changeDue: pm.change_due != null ? parseFloat(String(pm.change_due)) : null,
      referenceNo: pm.reference_no,
      createdAt: pm.created_at,
    }));

    const returns: ReturnRecord[] = (payload.returns || []).map((rt) => ({
      id: rt.id,
      returnNumber: rt.return_number,
      saleId: payload.sale.id,
      refundMethod: "cash", // Header stores default; items have detail
      reason: rt.reason,
      totalRefundAmount: parseFloat(String(rt.total_refund_amount)),
      createdAt: rt.created_at,
      createdBy: rt.created_by,
    }));

    const refunds: RefundRecord[] = (payload.refunds || []).map((rf) => ({
      id: rf.id,
      obligationRefundId: rf.obligation_refund_id,
      replacesRefundId: rf.parent_refund_id,
      paymentId: null,
      saleReturnId: rf.return_id,
      refundMethod: rf.refund_method,
      amount: parseFloat(String(rf.amount)),
      status: rf.status,
      referenceNo: rf.reference_no,
      externalReference: null,
      failureReason: rf.reason ?? null,
      createdAt: rf.created_at,
      updatedAt: rf.created_at,
    }));

    return {
      success: true,
      data: {
        sale: saleHeader,
        customer,
        items,
        payments,
        returns,
        refunds,
      },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: mapSalesError(err),
    };
  }
}

// ============================================================================
// 4. Return History Action (T062, US5)
// ============================================================================

/**
 * Server action to retrieve return and refund lifecycle records for a sale (T062, US5).
 * - Requires `returns:read` permission.
 * - Scoped strictly to the active organization.
 * - Resolves partial returns, restock status, and pending/completed/failed refunds.
 */
export async function getReturnHistoryAction(
  slug: string,
  saleId: string
): Promise<ActionResult<ReturnHistory[]>> {
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
    if (!hasPermission(context, "returns:read")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Insufficient permissions to view return history.",
        },
      };
    }

    // 3. Validate Sale Identifier
    if (!saleId || !UUID_REGEX.test(saleId)) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid sale ID format.",
        },
      };
    }

    // 4. Query Sale Returns for this Sale
    const supabase = await createClient();
    const { data: returnRows, error: returnErr } = await supabase
      .from("sale_returns")
      .select(
        `
          id,
          return_number,
          sale_id,
          reason,
          total_refund_amount,
          created_at,
          created_by
        `
      )
      .eq("organization_id", context.organization.id)
      .eq("sale_id", saleId)
      .order("created_at", { ascending: true });

    if (returnErr) {
      return {
        success: false,
        error: mapSalesError(returnErr),
      };
    }

    if (!returnRows || returnRows.length === 0) {
      return {
        success: true,
        data: [],
      };
    }

    const returnIds = returnRows.map((r) => r.id);
    const itemsByReturnId: Record<string, ReturnItemRecord[]> = {};
    const refundsByReturnId: Record<string, RefundRecord[]> = {};

    // 5. Query Return Items
    const { data: itemRows, error: itemsErr } = await supabase
      .from("sale_return_items")
      .select(
        `
          id,
          sale_item_id,
          product_id,
          quantity,
          refund_amount,
          restock_to_inventory,
          movement_id,
          return_id
        `
      )
      .eq("organization_id", context.organization.id)
      .in("return_id", returnIds);

    if (itemsErr) {
      return {
        success: false,
        error: mapSalesError(itemsErr),
      };
    }

    const productMap: Record<string, { name: string; sku: string }> = {};
    if (itemRows && itemRows.length > 0) {
      const productIds = Array.from(new Set(itemRows.map((i) => i.product_id).filter(Boolean)));
      if (productIds.length > 0) {
        const { data: prodRows } = await supabase
          .from("products")
          .select("id, name, sku")
          .eq("organization_id", context.organization.id)
          .in("id", productIds);

        if (prodRows) {
          for (const p of prodRows) {
            productMap[p.id] = { name: p.name, sku: p.sku };
          }
        }
      }

      for (const item of itemRows) {
        const prod = productMap[item.product_id];
        const list = itemsByReturnId[item.return_id] || [];
        list.push({
          id: item.id,
          saleItemId: item.sale_item_id,
          productId: item.product_id,
          productName: prod?.name,
          sku: prod?.sku,
          quantity: parseFloat(String(item.quantity)),
          refundAmount: parseFloat(String(item.refund_amount)),
          restockToInventory: Boolean(item.restock_to_inventory),
          movementId: item.movement_id,
        });
        itemsByReturnId[item.return_id] = list;
      }
    }

    // 6. Query Associated Refunds
    const { data: refundRows, error: refundErr } = await supabase
      .from("refunds")
      .select(
        `
          id,
          obligation_refund_id,
          parent_refund_id,
          return_id,
          refund_method,
          amount,
          status,
          reference_no,
          reason,
          created_at,
          updated_at
        `
      )
      .eq("organization_id", context.organization.id)
      .in("return_id", returnIds);

    if (refundErr) {
      return {
        success: false,
        error: mapSalesError(refundErr),
      };
    }

    if (refundRows) {
      for (const rf of refundRows) {
        if (rf.return_id) {
          const list = refundsByReturnId[rf.return_id] || [];
          list.push({
            id: rf.id,
            obligationRefundId: rf.obligation_refund_id,
            replacesRefundId: rf.parent_refund_id,
            paymentId: null,
            saleReturnId: rf.return_id,
            refundMethod: rf.refund_method as PaymentMethod,
            amount: parseFloat(String(rf.amount)),
            status: rf.status as RefundStatus,
            referenceNo: rf.reference_no,
            externalReference: null,
            failureReason: rf.reason ?? null,
            createdAt: rf.created_at,
            updatedAt: rf.updated_at,
          });
          refundsByReturnId[rf.return_id] = list;
        }
      }
    }

    // 7. Assemble Structured ReturnHistory[]
    const returnHistoryList: ReturnHistory[] = returnRows.map((r) => {
      const returnRefunds = refundsByReturnId[r.id] || [];
      const primaryRefundMethod = (returnRefunds[0]?.refundMethod ?? "cash") as PaymentMethod;
      return {
        id: r.id,
        returnNumber: r.return_number,
        saleId: r.sale_id,
        refundMethod: primaryRefundMethod,
        reason: r.reason,
        totalRefundAmount: parseFloat(String(r.total_refund_amount)),
        createdAt: r.created_at,
        createdBy: r.created_by,
        items: itemsByReturnId[r.id] || [],
        refunds: returnRefunds,
      };
    });

    return {
      success: true,
      data: returnHistoryList,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: mapSalesError(err),
    };
  }
}

/**
 * Voids an existing completed sale, restores inventory atomically,
 * and creates reversal refund records via public.void_sale RPC.
 *
 * Permission required: 'sales:void' (Owner, Admin, Manager)
 * Authoritative Source: specs/005-customers-sales/contracts/server-actions.md §2, database-rpcs.md §2
 */
export async function voidSaleAction(
  slug: string,
  input: unknown
): Promise<ActionResult<VoidResult>> {
  try {
    // 1. Resolve Tenant Context
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

    // 2. Permission Check: sales:void (Owner, Admin, Manager)
    if (!hasPermission(context, "sales:void")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "You do not have permission to void sales.",
        },
      };
    }

    // 3. Validate Input with voidSaleSchema
    const parseResult = voidSaleSchema.safeParse(input);
    if (!parseResult.success) {
      const firstErr = parseResult.error.errors[0];
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: firstErr?.message || "Invalid void parameters.",
        },
      };
    }

    const { saleId, voidReason, idempotencyKey, reversalReferences } = parseResult.data;

    // 4. Transform reversal references to database parameter format if present
    const formattedReversals =
      reversalReferences && reversalReferences.length > 0
        ? reversalReferences.map((r) => ({
            payment_id: r.paymentId,
            reference_no: r.referenceNo.trim(),
          }))
        : null;

    // 5. Invoke SECURITY DEFINER RPC public.void_sale
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("void_sale", {
      p_org_id: context.organization.id,
      p_sale_id: saleId,
      p_void_reason: voidReason.trim(),
      p_idempotency_key: idempotencyKey,
      p_reversal_references: formattedReversals,
    });

    if (error) {
      return {
        success: false,
        error: mapSalesError(error),
      };
    }

    const raw = data as {
      success: boolean;
      is_replay: boolean;
      sale_id: string;
      sale_number: string;
      status: SaleStatus;
      payment_status: PaymentStatus;
      voided_at: string;
      voided_by?: string;
    };

    // 6. Revalidate relevant paths
    revalidatePath(`/${slug}/sales`);
    revalidatePath(`/${slug}/sales/${saleId}`);

    return {
      success: true,
      data: {
        success: true,
        isReplay: Boolean(raw.is_replay),
        saleId: raw.sale_id,
        saleNumber: raw.sale_number,
        status: raw.status,
        paymentStatus: raw.payment_status,
        voidedAt: raw.voided_at,
        voidedBy: raw.voided_by,
      },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: mapSalesError(err),
    };
  }
}
/**
 * Processes a line-item customer return against an existing completed sale,
 * optionally restores restocked quantities to inventory via Feature 004 core,
 * and records refunds via public.execute_sale_return RPC.
 *
 * Permission required: 'returns:create' (Owner, Admin, Manager)
 * Authoritative Source: specs/005-customers-sales/contracts/server-actions.md §2, database-rpcs.md §3
 */
export async function executeSaleReturnAction(
  slug: string,
  input: unknown
): Promise<ActionResult<ReturnResult>> {
  try {
    // 1. Resolve Tenant Context
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

    // 2. Permission Check: returns:create (Owner, Admin, Manager)
    if (!hasPermission(context, "returns:create")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "You do not have permission to process returns.",
        },
      };
    }

    // 3. Validate Input with executeSaleReturnSchema
    const parseResult = executeSaleReturnSchema.safeParse(input);
    if (!parseResult.success) {
      const firstErr = parseResult.error.errors[0];
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: firstErr?.message || "Invalid return parameters.",
        },
      };
    }

    const {
      saleId,
      returnItems,
      refundMethod,
      reason,
      idempotencyKey,
      referenceNo,
    } = parseResult.data;

    // 4. Transform return items to RPC JSON parameter format
    const formattedReturnItems = returnItems.map((item) => ({
      sale_item_id: item.saleItemId,
      quantity: item.quantity,
      restock_to_inventory: item.restockToInventory,
    }));

    // 5. Invoke SECURITY DEFINER RPC public.execute_sale_return
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("execute_sale_return", {
      p_org_id: context.organization.id,
      p_sale_id: saleId,
      p_return_items: formattedReturnItems,
      p_refund_method: refundMethod,
      p_reason: reason.trim(),
      p_idempotency_key: idempotencyKey,
      p_reference_no: referenceNo && referenceNo.trim().length > 0 ? referenceNo.trim() : null,
    });

    if (error) {
      return {
        success: false,
        error: mapSalesError(error),
      };
    }

    const raw = data as {
      success: boolean;
      is_replay: boolean;
      return_id: string;
      return_number: string;
      sale_id: string;
      total_refund_amount: string | number;
      refund_id: string;
      refund_status: RefundStatus;
      sale_status: SaleStatus;
      payment_status: PaymentStatus;
    };

    // 6. Revalidate relevant paths
    revalidatePath(`/${slug}/sales`);
    revalidatePath(`/${slug}/sales/${saleId}`);
    revalidatePath(`/${slug}/inventory`);

    return {
      success: true,
      data: {
        success: true,
        isReplay: Boolean(raw.is_replay),
        returnId: raw.return_id,
        returnNumber: raw.return_number,
        saleId: raw.sale_id,
        refundId: raw.refund_id,
        refundStatus: raw.refund_status,
        totalRefundAmount: parseFloat(String(raw.total_refund_amount)),
        saleStatus: raw.sale_status,
        paymentStatus: raw.payment_status,
      },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: mapSalesError(err),
    };
  }
}
/**
 * Confirms a pending refund reimbursement with an external provider reference (T072, US7).
 *
 * Permission required: 'refunds:read' AND ('sales:void' OR 'returns:create')
 * Authoritative Source: specs/005-customers-sales/contracts/server-actions.md §2
 */
export async function confirmRefundAction(
  slug: string,
  input: unknown
): Promise<ActionResult<RefundConfirmation>> {
  try {
    // 1. Resolve Tenant Context
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

    // 2. Permission Check: refunds:read AND (sales:void OR returns:create)
    const hasRefundsRead = hasPermission(context, "refunds:read");
    const hasVoidOrReturn =
      hasPermission(context, "sales:void") || hasPermission(context, "returns:create");

    if (!hasRefundsRead || !hasVoidOrReturn) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "You do not have permission to confirm refund reimbursements.",
        },
      };
    }

    // 3. Validate Input with confirmRefundSchema
    const parseResult = confirmRefundSchema.safeParse(input);
    if (!parseResult.success) {
      const firstErr = parseResult.error.errors[0];
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: firstErr?.message || "Invalid refund confirmation parameters.",
        },
      };
    }

    const { refundId, externalReference, idempotencyKey } = parseResult.data;

    // 4. Invoke SECURITY DEFINER RPC public.confirm_refund_reimbursement
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("confirm_refund_reimbursement", {
      p_org_id: context.organization.id,
      p_refund_id: refundId,
      p_external_reference: externalReference.trim(),
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      return {
        success: false,
        error: mapSalesError(error),
      };
    }

    const raw = data as {
      success: boolean;
      is_replay: boolean;
      refund_id: string;
      sale_id?: string;
      status: RefundStatus;
      external_reference?: string;
      reference_no?: string;
      amount: string | number;
      confirmed_at: string;
    };

    // 5. Revalidate relevant paths
    revalidatePath(`/${slug}/sales`);
    if (raw.sale_id) {
      revalidatePath(`/${slug}/sales/${raw.sale_id}`);
    }

    return {
      success: true,
      data: {
        success: true,
        isReplay: Boolean(raw.is_replay),
        refundId: raw.refund_id,
        status: raw.status,
        externalReference: raw.external_reference || raw.reference_no || externalReference.trim(),
        confirmedAt: raw.confirmed_at,
      },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: mapSalesError(err),
    };
  }
}
/**
 * Records a failure on a pending refund reimbursement (T073, US7).
 *
 * Permission required: 'sales:void' OR 'returns:create'
 * Authoritative Source: specs/005-customers-sales/contracts/server-actions.md §2
 */
export async function recordRefundFailureAction(
  slug: string,
  input: unknown
): Promise<ActionResult<RefundFailureResult>> {
  try {
    // 1. Resolve Tenant Context
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

    // 2. Permission Check: sales:void OR returns:create
    if (!hasPermission(context, "sales:void") && !hasPermission(context, "returns:create")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "You do not have permission to record refund failures.",
        },
      };
    }

    // 3. Validate Input with recordRefundFailureSchema
    const parseResult = recordRefundFailureSchema.safeParse(input);
    if (!parseResult.success) {
      const firstErr = parseResult.error.errors[0];
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: firstErr?.message || "Invalid refund failure parameters.",
        },
      };
    }

    const { refundId, failureReason } = parseResult.data;

    // 4. Invoke SECURITY DEFINER RPC public.record_refund_failure
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("record_refund_failure", {
      p_org_id: context.organization.id,
      p_refund_id: refundId,
      p_failure_reason: failureReason.trim(),
    });

    if (error) {
      return {
        success: false,
        error: mapSalesError(error),
      };
    }

    const raw = data as {
      success: boolean;
      refund_id: string;
      sale_id?: string;
      status: RefundStatus;
      failure_reason: string;
      failed_at: string;
    };

    // 5. Revalidate relevant paths
    revalidatePath(`/${slug}/sales`);
    if (raw.sale_id) {
      revalidatePath(`/${slug}/sales/${raw.sale_id}`);
    }

    return {
      success: true,
      data: {
        success: true,
        refundId: raw.refund_id,
        status: raw.status,
        failureReason: raw.failure_reason,
        failedAt: raw.failed_at,
      },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: mapSalesError(err),
    };
  }
}
/**
 * Issues a replacement refund for a failed refund attempt (T074, US7).
 *
 * Permission required: 'sales:void' OR 'returns:create'
 * Authoritative Source: specs/005-customers-sales/contracts/server-actions.md §2
 */
export async function issueReplacementRefundAction(
  slug: string,
  input: unknown
): Promise<ActionResult<ReplacementRefundResult>> {
  try {
    // 1. Resolve Tenant Context
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

    // 2. Permission Check: sales:void OR returns:create
    if (!hasPermission(context, "sales:void") && !hasPermission(context, "returns:create")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "You do not have permission to issue replacement refunds.",
        },
      };
    }

    // 3. Validate Input with issueReplacementRefundSchema
    const parseResult = issueReplacementRefundSchema.safeParse(input);
    if (!parseResult.success) {
      const firstErr = parseResult.error.errors[0];
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: firstErr?.message || "Invalid replacement refund parameters.",
        },
      };
    }

    const { failedRefundId, refundMethod, idempotencyKey, referenceNo, notes } =
      parseResult.data;

    // 4. Invoke SECURITY DEFINER RPC public.issue_replacement_refund
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("issue_replacement_refund", {
      p_org_id: context.organization.id,
      p_failed_refund_id: failedRefundId,
      p_refund_method: refundMethod,
      p_idempotency_key: idempotencyKey,
      p_reference_no: referenceNo && referenceNo.trim().length > 0 ? referenceNo.trim() : null,
      p_notes: notes && notes.trim().length > 0 ? notes.trim() : null,
    });

    if (error) {
      return {
        success: false,
        error: mapSalesError(error),
      };
    }

    const raw = data as {
      success: boolean;
      is_replay: boolean;
      replacement_refund_id?: string;
      refund_id: string;
      sale_id?: string;
      obligation_refund_id: string;
      failed_refund_id?: string;
      parent_refund_id?: string;
      status: RefundStatus;
      refund_method: PaymentMethod;
      amount: string | number;
      created_at: string;
    };

    // 5. Revalidate relevant paths
    revalidatePath(`/${slug}/sales`);
    if (raw.sale_id) {
      revalidatePath(`/${slug}/sales/${raw.sale_id}`);
    }

    return {
      success: true,
      data: {
        success: true,
        isReplay: Boolean(raw.is_replay),
        replacementRefundId: raw.replacement_refund_id || raw.refund_id,
        obligationRefundId: raw.obligation_refund_id,
        failedRefundId: raw.failed_refund_id || raw.parent_refund_id || failedRefundId,
        status: raw.status,
        refundMethod: raw.refund_method,
        amount: parseFloat(String(raw.amount)),
        createdAt: raw.created_at,
      },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: mapSalesError(err),
    };
  }
}
