"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantContext } from "@/lib/auth/context";
import {
  hasInventoryPermission,
  canViewValuation,
} from "@/lib/inventory/permissions";
import {
  stockMovementInputSchema,
  inventoryThresholdInputSchema,
  inventoryQuerySchema,
  movementHistoryQuerySchema,
} from "@/lib/validations/inventory";
import { computeCanonicalPayloadHash } from "@/lib/inventory/canonical-hash";
import {
  formatCurrency,
  calculateStockStatus,
  getStockStatusPriority,
  isDiscreteUom,
} from "@/lib/inventory/formatters";
import type { ActionResult } from "@/types/auth";
import type {
  InventoryOverviewData,
  PaginatedInventoryResult,
  InventoryItemRow,
  InventoryProductDetail,
  StockMutationResult,
  UpdateThresholdsResult,
  PaginatedMovementHistoryResult,
  MovementHistoryRow,
  MovementType,
  RawStockMutationRpcResult,
} from "@/types/inventory";

// ============================================================================
// Database RPC Error Code Mapping
// ============================================================================
const KNOWN_INVENTORY_ERRORS: Record<string, { code: string; message: string }> = {
  P0001: { code: "ORGANIZATION_INACTIVE", message: "Organization is currently inactive." },
  P0002: { code: "MEMBERSHIP_INACTIVE", message: "Caller is not an active member of this organization." },
  P0003: { code: "PRODUCT_NOT_FOUND", message: "Product was not found in this organization." },
  P0004: { code: "INVENTORY_NOT_FOUND", message: "Inventory record does not exist for this product." },
  P0005: { code: "TENANT_MISMATCH", message: "Organization identifiers do not match across tables." },
  P0011: { code: "INSUFFICIENT_STOCK", message: "Requested reduction exceeds available inventory balance." },
  P0012: { code: "NON_POSITIVE_QUANTITY", message: "Restock quantity must be greater than zero." },
  P0013: { code: "NEGATIVE_QUANTITY_NOT_PERMITTED", message: "Initial opening stock cannot be negative." },
  P0014: { code: "ZERO_QUANTITY_NOT_PERMITTED", message: "Movement quantity delta cannot be zero." },
  P0015: { code: "INTEGER_QUANTITY_REQUIRED", message: "Fractional quantities are not permitted for discrete products." },
  P0016: { code: "DECIMAL_PRECISION_EXCEEDED", message: "Quantity cannot exceed 4 decimal places." },
  P0017: { code: "ADJUSTMENT_REASON_REQUIRED", message: "Adjustment reason is required (minimum 3 characters)." },
  P0018: { code: "ADJUSTMENT_REASON_TOO_LONG", message: "Adjustment reason exceeds maximum length." },
  P0019: { code: "REFERENCE_ID_TOO_LONG", message: "Reference identifier exceeds maximum length." },
  P0020: { code: "INVALID_MOVEMENT_TYPE", message: "Movement type is invalid or restricted." },
  P0021: { code: "PRODUCT_ARCHIVED_STOCK_FORBIDDEN", message: "Stock operations on archived products are restricted to write-offs." },
  P0022: { code: "PRODUCT_INACTIVE_RESTOCK_BLOCKED", message: "Cannot receive stock for inactive products." },
  P0023: { code: "PRODUCT_INACTIVE_INTERNAL_USE_BLOCKED", message: "Cannot deduct internal use stock for inactive products." },
  P0024: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency key already used with a different request payload." },
  P0025: { code: "INITIAL_STOCK_ALREADY_RECORDED", message: "Initial opening stock has already been established for this product." },
  P0026: { code: "INITIAL_STOCK_NOT_PERMITTED_HISTORY_EXISTS", message: "Opening stock cannot be recorded after movement history exists." },
  P0027: { code: "STALE_VERSION_CONFLICT", message: "Inventory record was updated by another transaction. Please reload and retry." },
  P0028: { code: "QUANTITY_EXCEEDS_MAXIMUM", message: "Quantity exceeds maximum allowable system limit." },
  P0029: { code: "UOM_CLASS_MUTATION_RESTRICTED", message: "Unit of measure cannot be modified when stock or history exists." },
  P0033: { code: "INVALID_QUANTITY_SEMANTICS", message: "Invalid quantity semantics submitted for movement type." },
  "42501": { code: "INSUFFICIENT_PERMISSIONS", message: "Insufficient permissions to perform this operation." },
  "08001": { code: "UNAUTHENTICATED", message: "Authentication required." },
};

function mapDatabaseError(err: { code?: string; message?: string }): { code: string; message: string } {
  if (err.code && KNOWN_INVENTORY_ERRORS[err.code]) {
    return KNOWN_INVENTORY_ERRORS[err.code]!;
  }
  // Check for unique constraint violation on initial stock or naming variations (T025, P0025)
  if (
    err.message?.includes("uq_stock_movements_initial_per_product") ||
    err.message?.includes("INITIAL_STOCK_ALREADY_ESTABLISHED") ||
    err.message?.includes("INITIAL_STOCK_ALREADY_RECORDED") ||
    err.code === "23505"
  ) {
    return KNOWN_INVENTORY_ERRORS.P0025!;
  }
  // Check message substring for known error names
  for (const [, errorDef] of Object.entries(KNOWN_INVENTORY_ERRORS)) {
    if (err.message?.includes(errorDef.code)) {
      return errorDef;
    }
  }
  return {
    code: "DATABASE_OPERATION_FAILED",
    message: err.message || "An unexpected database error occurred.",
  };
}

// ============================================================================
// 1. getInventoryOverviewAction (T017, US1)
// ============================================================================
/**
 * Retrieves high-level inventory metrics for the overview dashboard tiles.
 * - Enforces `inventory:read` permission.
 * - Enforces dual-permission (`inventory:read_valuation` AND `products:read_cost`) for valuation metrics.
 * - When caller lacks either permission, `totalValuation` is strictly `null`.
 */
export async function getInventoryOverviewAction(
  slug: string,
  includeArchived: boolean = false
): Promise<ActionResult<InventoryOverviewData>> {
  try {
    const tenantRes = await resolveTenantContext(slug);
    if (!tenantRes.ok) {
      return {
        success: false,
        error: { code: tenantRes.error.toUpperCase(), message: "Organization not found or access denied." },
      };
    }
    const { context } = tenantRes;

    if (!hasInventoryPermission(context, "inventory:read")) {
      return {
        success: false,
        error: { code: "FORBIDDEN", message: "Unauthorized: missing inventory:read permission." },
      };
    }

    const allowValuation = canViewValuation(context);
    const supabase = await createClient();

    // Query inventory rows with joined product status and cost price (if authorized)
    const selectFields = allowValuation
      ? `
        quantity,
        reorder_point,
        products!inner (
          id,
          status,
          product_costs (
            cost_price
          )
        )
      `
      : `
        quantity,
        reorder_point,
        products!inner (
          id,
          status
        )
      `;

    let query = supabase
      .from("inventory")
      .select(selectFields)
      .eq("organization_id", context.organization.id);

    if (!includeArchived) {
      query = query.neq("products.status", "archived");
    }

    const { data: rows, error } = await query;

    if (error) {
      return { success: false, error: mapDatabaseError(error) };
    }

    let inStockCount = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let totalValuationAmount = 0;

    for (const row of rows || []) {
      const qty = parseFloat(String(row.quantity)) || 0;
      const status = calculateStockStatus(qty, row.reorder_point);

      if (status === "in_stock") {
        inStockCount++;
      } else if (status === "low_stock") {
        lowStockCount++;
      } else {
        outOfStockCount++;
      }

      if (allowValuation && qty > 0) {
        // Safe access to nested cost_price
        const p = row.products as unknown as { product_costs?: { cost_price: number | string } | { cost_price: number | string }[] };
        let costPrice = 0;
        if (p?.product_costs) {
          if (Array.isArray(p.product_costs) && p.product_costs.length > 0) {
            costPrice = parseFloat(String(p.product_costs[0]?.cost_price)) || 0;
          } else if (!Array.isArray(p.product_costs)) {
            costPrice = parseFloat(String(p.product_costs.cost_price)) || 0;
          }
        }
        totalValuationAmount += qty * costPrice;
      }
    }

    const currency = context.organization.currency || "USD";

    return {
      success: true,
      data: {
        totalTrackedProducts: (rows || []).length,
        inStockCount,
        lowStockCount,
        outOfStockCount,
        totalValuation: allowValuation
          ? {
              amount: totalValuationAmount,
              currency,
              formatted: formatCurrency(totalValuationAmount, currency),
            }
          : null,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error occurred.";
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

/**
 * Detects whether an RPC failure is genuinely due to the function not being deployed
 * or missing from PostgREST schema cache (as opposed to permission/auth/timeout/db errors).
 */
export function isRpcUnavailableError(error: any): boolean {
  if (!error) return false;
  // PGRST202: PostgREST schema cache function not found
  if (error.code === "PGRST202") return true;
  // 42883: PostgreSQL undefined_function
  if (error.code === "42883") return true;
  const msg = typeof error.message === "string" ? error.message.toLowerCase() : "";
  if (
    msg.includes("could not find the function") ||
    msg.includes("schema cache") ||
    (msg.includes("function") && msg.includes("does not exist"))
  ) {
    return true;
  }
  return false;
}

/**
 * Retrieves the set of product IDs with recorded stock movements for the tenant.
 * - Prioritizes the server-side RPC `get_products_with_movement_history` (SELECT DISTINCT inside PostgreSQL).
 * - Falls back to complete, paginated PostgREST retrieval (using .order("id") and .range(from, to) with PAGE_SIZE = 1000)
 *   ONLY when the RPC is confirmed unavailable in the schema cache (e.g. PGRST202 / 42883).
 *   The unique UUID primary key ordering provides deterministic pagination over a stable result set.
 *   If concurrent inserts occur during pagination, the database mutation's authoritative P0026 check
 *   guarantees that initial opening stock cannot be recorded on a product with history.
 * - Security & Authorization Guard: Authorization failures (42501), inactive membership (P0002),
 *   inactive organization (P0001), statement timeouts (57014), and database connection errors
 *   FAIL CLOSED immediately and NEVER trigger fallback.
 * - Fails closed: if any query fails, returns { success: false, error } to prevent invalid Initial Opening Stock exposure.
 */
export async function fetchMovementHistoryProductIds(
  supabase: any,
  organizationId: string,
  candidateProductIds?: string[]
): Promise<{ success: true; movementProductIds: Set<string> } | { success: false; error: any }> {
  let shouldFallback = typeof supabase.rpc !== "function";

  // 1. Try server-side RPC first (guaranteed DISTINCT, zero PostgREST truncation risk)
  if (typeof supabase.rpc === "function") {
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "get_products_with_movement_history",
        {
          p_org_id: organizationId,
          p_product_ids: candidateProductIds && candidateProductIds.length > 0 ? candidateProductIds : null,
        }
      );

      if (!rpcError) {
        if (Array.isArray(rpcData)) {
          const set = new Set<string>();
          for (const item of rpcData) {
            const pid = typeof item === "string" ? item : item?.product_id;
            if (pid) set.add(pid);
          }
          return { success: true, movementProductIds: set };
        }
        return { success: false, error: new Error("RPC returned invalid payload") };
      }

      // RPC returned an error: ONLY genuine missing-function/schema-cache errors may trigger fallback
      if (isRpcUnavailableError(rpcError)) {
        shouldFallback = true;
      } else {
        // Authorization (42501), inactive org/membership (P0001/P0002), database errors:
        // FAIL CLOSED immediately. Do NOT bypass security via fallback.
        return { success: false, error: rpcError };
      }
    } catch (err: any) {
      if (isRpcUnavailableError(err)) {
        shouldFallback = true;
      } else {
        return { success: false, error: err };
      }
    }
  }

  if (!shouldFallback) {
    return { success: false, error: new Error("RPC execution failed") };
  }

  // 2. Complete, paginated PostgREST query (handles > 1000 movements across multiple pages)
  const PAGE_SIZE = 1000;
  let from = 0;
  let hasMore = true;
  const movementProductIds = new Set<string>();

  while (hasMore) {
    let query = supabase
      .from("stock_movements")
      .select("product_id")
      .eq("organization_id", organizationId);

    if (candidateProductIds && candidateProductIds.length > 0) {
      if (typeof query.in === "function") {
        query = query.in("product_id", candidateProductIds);
      }
    }

    // Deterministic sort ordering using unique UUID primary key id.
    // Note: id is a unique UUID primary key (not a monotonic counter).
    // Unique ordering guarantees deterministic traversal over a stable result set.
    // Offset-based pagination does not guarantee an immutable snapshot across concurrent
    // inserts; however, the database RPC's P0026 validation remains authoritative
    // and will reject any mutation if history is introduced after this check.
    if (typeof query.order === "function") {
      query = query.order("id", { ascending: true });
    }

    const hasRange = typeof query.range === "function";
    if (hasRange) {
      query = query.range(from, from + PAGE_SIZE - 1);
    }

    const { data, error } = await query;
    if (error) {
      // FAIL CLOSED: Never assume no history when the database query fails!
      return { success: false, error };
    }

    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      for (const row of data) {
        if (row.product_id) movementProductIds.add(row.product_id);
      }

      // Early exit only if candidateProductIds is specified, non-empty, and EVERY candidate
      // has been found in movementProductIds.
      if (
        candidateProductIds &&
        candidateProductIds.length > 0 &&
        candidateProductIds.every((id) => movementProductIds.has(id))
      ) {
        hasMore = false;
        break;
      }

      // If query does not support pagination (e.g. basic unit test mock) or returned fewer than PAGE_SIZE, we are done
      if (!hasRange || data.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        from += PAGE_SIZE;
      }
    }
  }

  return { success: true, movementProductIds };
}

// ============================================================================
// 2. getInventoryListAction (T017, US1)
// ============================================================================
/**
 * Fetches paginated, filterable, and sortable inventory items for the primary table.
 * - Enforces `inventory:read` permission.
 * - Enforces dual-permission (`inventory:read_valuation` AND `products:read_cost`) on `unitCost` and `totalValue`.
 * - When unauthorized, valuation columns are strictly `null`.
 */
export async function getInventoryListAction(
  slug: string,
  rawQuery: unknown
): Promise<ActionResult<PaginatedInventoryResult>> {
  try {
    const tenantRes = await resolveTenantContext(slug);
    if (!tenantRes.ok) {
      return {
        success: false,
        error: { code: tenantRes.error.toUpperCase(), message: "Organization not found or access denied." },
      };
    }
    const { context } = tenantRes;

    if (!hasInventoryPermission(context, "inventory:read")) {
      return {
        success: false,
        error: { code: "FORBIDDEN", message: "Unauthorized: missing inventory:read permission." },
      };
    }

    const parsedQuery = inventoryQuerySchema.safeParse(rawQuery);
    if (!parsedQuery.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid inventory query parameters.",
          details: parsedQuery.error.flatten().fieldErrors as Record<string, string[]>,
        },
      };
    }
    const query = parsedQuery.data;

    const allowValuation = canViewValuation(context);
    const supabase = await createClient();

    const selectFields = allowValuation
      ? `
        product_id,
        quantity,
        reorder_point,
        reorder_quantity,
        version,
        products!inner (
          id,
          name,
          sku,
          barcode,
          status,
          unit_of_measure,
          category_id,
          product_categories (
            name
          ),
          product_costs (
            cost_price
          )
        )
      `
      : `
        product_id,
        quantity,
        reorder_point,
        reorder_quantity,
        version,
        products!inner (
          id,
          name,
          sku,
          barcode,
          status,
          unit_of_measure,
          category_id,
          product_categories (
            name
          )
        )
      `;

    let dbQuery = supabase
      .from("inventory")
      .select(selectFields)
      .eq("organization_id", context.organization.id);

    // Apply product status / archived filters
    if (query.productStatus !== "all") {
      dbQuery = dbQuery.eq("products.status", query.productStatus);
    } else if (!query.includeArchived) {
      dbQuery = dbQuery.neq("products.status", "archived");
    }

    // Category filter
    if (query.categoryId) {
      dbQuery = dbQuery.eq("products.category_id", query.categoryId);
    }

    const { data: rows, error } = await dbQuery;

    if (error) {
      return { success: false, error: mapDatabaseError(error) };
    }

    // Identify zero-stock candidate products that could be eligible for Initial Opening Stock
    const candidateProductIds = (rows || [])
      .filter((r) => (parseFloat(String(r.quantity)) || 0) === 0)
      .map((r) => r.product_id);

    const historyRes = await fetchMovementHistoryProductIds(
      supabase,
      context.organization.id,
      candidateProductIds
    );

    if (!historyRes.success) {
      // FAIL CLOSED: If movement history query fails, do not expose inaccurate Initial Opening Stock eligibility
      return { success: false, error: mapDatabaseError(historyRes.error) };
    }

    const movementProductIds = historyRes.movementProductIds;

    const currency = context.organization.currency || "USD";

    // Map and calculate derived attributes
    let items: InventoryItemRow[] = (rows || []).map((row) => {
      const p = row.products as unknown as {
        id: string;
        name: string;
        sku: string;
        barcode: string | null;
        status: "active" | "inactive" | "archived";
        unit_of_measure: string;
        category_id: string | null;
        product_categories?: { name: string } | { name: string }[];
        product_costs?: { cost_price: number | string } | { cost_price: number | string }[];
      };

      const categoryName = p?.product_categories
        ? Array.isArray(p.product_categories)
          ? p.product_categories[0]?.name || null
          : p.product_categories.name || null
        : null;

      let costPrice: number | null = null;
      if (allowValuation && p?.product_costs) {
        if (Array.isArray(p.product_costs) && p.product_costs.length > 0) {
          costPrice = parseFloat(String(p.product_costs[0]?.cost_price));
        } else if (!Array.isArray(p.product_costs)) {
          costPrice = parseFloat(String(p.product_costs.cost_price));
        }
      }

      const qty = parseFloat(String(row.quantity)) || 0;
      const stockStatus = calculateStockStatus(qty, row.reorder_point);
      const isDiscrete = isDiscreteUom(p?.unit_of_measure);

      return {
        productId: row.product_id,
        productName: p?.name || "Unknown Product",
        sku: p?.sku || "",
        barcode: p?.barcode || null,
        categoryName,
        productStatus: p?.status || "active",
        unitOfMeasure: p?.unit_of_measure || "piece",
        isDiscrete,
        quantity: qty,
        reorderPoint: row.reorder_point !== null ? parseFloat(String(row.reorder_point)) : null,
        reorderQuantity: row.reorder_quantity !== null ? parseFloat(String(row.reorder_quantity)) : null,
        stockStatus,
        version: row.version,
        hasInitialMovement: qty > 0 || movementProductIds.has(row.product_id),
        unitCost: allowValuation && costPrice !== null && !isNaN(costPrice) ? costPrice : null,
        totalValue:
          allowValuation && costPrice !== null && !isNaN(costPrice)
            ? Math.max(0, qty) * costPrice
            : null,
        currency: allowValuation ? currency : null,
      };
    });

    // Client-side search filtering (name, sku, barcode)
    if (query.search) {
      const s = query.search.toLowerCase();
      items = items.filter(
        (it) =>
          it.productName.toLowerCase().includes(s) ||
          it.sku.toLowerCase().includes(s) ||
          (it.barcode && it.barcode.toLowerCase().includes(s))
      );
    }

    // Filter by calculated stock status
    if (query.stockStatus !== "all") {
      items = items.filter((it) => it.stockStatus === query.stockStatus);
    }

    // Deterministic Sorting with Stable Tie-Breakers (P4-R03)
    items.sort((a, b) => {
      let cmp = 0;
      if (query.sortBy === "stock_status") {
        cmp = getStockStatusPriority(a.stockStatus) - getStockStatusPriority(b.stockStatus);
      } else if (query.sortBy === "name") {
        cmp = a.productName.localeCompare(b.productName);
      } else if (query.sortBy === "sku") {
        cmp = a.sku.localeCompare(b.sku);
      } else if (query.sortBy === "quantity") {
        cmp = a.quantity - b.quantity;
      }

      // Apply primary sort direction
      if (query.sortOrder === "desc") {
        cmp = -cmp;
      }

      // Secondary stable tie-breaker by product name (if not already primary)
      if (cmp === 0 && query.sortBy !== "name") {
        cmp = a.productName.localeCompare(b.productName);
      }

      // Tertiary stable tie-breaker by product ID to guarantee 100% determinism across pages
      if (cmp === 0) {
        cmp = a.productId.localeCompare(b.productId);
      }

      return cmp;
    });

    // Pagination
    const totalCount = items.length;
    const totalPages = Math.ceil(totalCount / query.pageSize) || 1;
    const startIndex = (query.page - 1) * query.pageSize;
    const paginatedItems = items.slice(startIndex, startIndex + query.pageSize);

    return {
      success: true,
      data: {
        items: paginatedItems,
        totalCount,
        page: query.page,
        pageSize: query.pageSize,
        totalPages,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error occurred.";
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

// ============================================================================
// 3. getInventoryProductAction (T017, US1)
// ============================================================================
/**
 * Retrieves single product inventory balance, thresholds, and last movement timestamp.
 * - Enforces `inventory:read` permission.
 * - Enforces dual-permission (`inventory:read_valuation` AND `products:read_cost`) for valuation fields.
 */
export async function getInventoryProductAction(
  slug: string,
  productId: string
): Promise<ActionResult<InventoryProductDetail>> {
  try {
    const tenantRes = await resolveTenantContext(slug);
    if (!tenantRes.ok) {
      return {
        success: false,
        error: { code: tenantRes.error.toUpperCase(), message: "Organization not found or access denied." },
      };
    }
    const { context } = tenantRes;

    if (!hasInventoryPermission(context, "inventory:read")) {
      return {
        success: false,
        error: { code: "FORBIDDEN", message: "Unauthorized: missing inventory:read permission." },
      };
    }

    if (!productId || typeof productId !== "string") {
      return {
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Product ID is required." },
      };
    }

    const allowValuation = canViewValuation(context);
    const supabase = await createClient();

    const selectFields = allowValuation
      ? `
        quantity,
        reorder_point,
        reorder_quantity,
        version,
        products!inner (
          id,
          name,
          sku,
          barcode,
          status,
          unit_of_measure,
          product_costs (
            cost_price
          )
        )
      `
      : `
        quantity,
        reorder_point,
        reorder_quantity,
        version,
        products!inner (
          id,
          name,
          sku,
          barcode,
          status,
          unit_of_measure
        )
      `;

    const { data: invRow, error: invError } = await supabase
      .from("inventory")
      .select(selectFields)
      .eq("organization_id", context.organization.id)
      .eq("product_id", productId)
      .maybeSingle();

    if (invError) {
      return { success: false, error: mapDatabaseError(invError) };
    }

    if (!invRow) {
      return {
        success: false,
        error: { code: "INVENTORY_NOT_FOUND", message: "Inventory record not found for product." },
      };
    }

    // Get last movement timestamp (fails closed on error)
    const { data: lastMv, error: lastMvError } = await supabase
      .from("stock_movements")
      .select("created_at")
      .eq("organization_id", context.organization.id)
      .eq("product_id", productId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastMvError) {
      return { success: false, error: mapDatabaseError(lastMvError) };
    }

    // Check if initial opening stock movement exists (T025, US3)
    const { data: initialMv, error: initialMvError } = await supabase
      .from("stock_movements")
      .select("id")
      .eq("organization_id", context.organization.id)
      .eq("product_id", productId)
      .eq("movement_type", "initial")
      .maybeSingle();

    if (initialMvError) {
      return { success: false, error: mapDatabaseError(initialMvError) };
    }

    const p = invRow.products as unknown as {
      id: string;
      name: string;
      sku: string;
      barcode: string | null;
      status: "active" | "inactive" | "archived";
      unit_of_measure: string;
      product_costs?: { cost_price: number | string } | { cost_price: number | string }[];
    };

    let costPrice: number | null = null;
    if (allowValuation && p?.product_costs) {
      if (Array.isArray(p.product_costs) && p.product_costs.length > 0) {
        costPrice = parseFloat(String(p.product_costs[0]?.cost_price));
      } else if (!Array.isArray(p.product_costs)) {
        costPrice = parseFloat(String(p.product_costs.cost_price));
      }
    }

    const qty = parseFloat(String(invRow.quantity)) || 0;
    const isDiscrete = isDiscreteUom(p?.unit_of_measure);
    const stockStatus = calculateStockStatus(qty, invRow.reorder_point);
    const currency = context.organization.currency || "USD";

    return {
      success: true,
      data: {
        productId: p?.id || productId,
        productName: p?.name || "Unknown Product",
        sku: p?.sku || "",
        barcode: p?.barcode || null,
        unitOfMeasure: p?.unit_of_measure || "piece",
        isDiscrete,
        productStatus: p?.status || "active",
        quantity: qty,
        reorderPoint: invRow.reorder_point !== null ? parseFloat(String(invRow.reorder_point)) : null,
        reorderQuantity: invRow.reorder_quantity !== null ? parseFloat(String(invRow.reorder_quantity)) : null,
        stockStatus,
        version: invRow.version,
        lastMovementAt: lastMv?.created_at || null,
        hasInitialMovement: qty > 0 || Boolean(lastMv || initialMv),
        unitCost: allowValuation && costPrice !== null && !isNaN(costPrice) ? costPrice : null,
        totalValue:
          allowValuation && costPrice !== null && !isNaN(costPrice)
            ? Math.max(0, qty) * costPrice
            : null,
        currency: allowValuation ? currency : null,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error occurred.";
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

// ============================================================================
// 4. recordStockMovementAction (T017, US2, US3, US4, US5)
// ============================================================================
/**
 * Primary mutation action: records restock, opening stock, adjustments, damage, loss, internal use.
 * - Authenticates session and resolves tenant context server-side.
 * - Validates input with `stockMovementInputSchema`.
 * - Enforces required granular permission based on movement type:
 *   - 'initial', 'restock': `inventory:receive`
 *   - 'adjustment', 'damage', 'loss', 'internal_use': `inventory:adjust`
 * - Generates/preserves idempotency key.
 * - Computes canonical SHA-256 payload hash in TypeScript.
 * - Dispatches to Layer 2 PostgreSQL stored procedure `execute_stock_movement`.
 * - Revalidates router cache paths.
 * - Returns typed `StockMutationResult`.
 */
export async function recordStockMovementAction(
  slug: string,
  rawInput: unknown
): Promise<ActionResult<StockMutationResult>> {
  try {
    const tenantRes = await resolveTenantContext(slug);
    if (!tenantRes.ok) {
      return {
        success: false,
        error: { code: tenantRes.error.toUpperCase(), message: "Organization not found or access denied." },
      };
    }
    const { context } = tenantRes;

    const parsedInput = stockMovementInputSchema.safeParse(rawInput);
    if (!parsedInput.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid stock movement parameters.",
          details: parsedInput.error.flatten().fieldErrors as Record<string, string[]>,
        },
      };
    }
    const input = parsedInput.data;

    // Granular Permission Guard (Principle IV)
    const requiredPermission =
      input.movementType === "initial" || input.movementType === "restock"
        ? "inventory:receive"
        : "inventory:adjust";

    if (!hasInventoryPermission(context, requiredPermission)) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: `Unauthorized: recording '${input.movementType}' movement requires '${requiredPermission}' permission.`,
        },
      };
    }

    const idempotencyKey = input.idempotencyKey || crypto.randomUUID();

    // Compute canonical SHA-256 payload hash for verification & audit
    const canonicalHash = computeCanonicalPayloadHash({
      organizationId: context.organization.id,
      productId: input.productId,
      movementType: input.movementType,
      quantity: input.quantity,
      quantitySemantics: input.quantitySemantics || "quantity_delta",
      reason: input.reason,
      referenceId: input.referenceId || null,
    });
    void canonicalHash;

    const supabase = await createClient();

    // Authoritative Server-Side Discrete UOM Verification (FINDING-P5-001)
    if (typeof supabase.from === "function") {
      const { data: productRow } = await supabase
        .from("products")
        .select("unit_of_measure")
        .eq("id", input.productId)
        .eq("organization_id", context.organization.id)
        .maybeSingle();

      if (productRow && isDiscreteUom(productRow.unit_of_measure)) {
        if (!Number.isInteger(input.quantity)) {
          return {
            success: false,
            error: {
              code: "INTEGER_QUANTITY_REQUIRED",
              message: "Discrete products require whole integer quantities.",
            },
          };
        }
      }
    }

    // Call Layer 2 Public Mutation Stored Procedure
    const { data: rawData, error } = await supabase.rpc("execute_stock_movement", {
      p_org_id: context.organization.id,
      p_product_id: input.productId,
      p_movement_type: input.movementType,
      p_quantity: input.quantity,
      p_reason: input.reason,
      p_reference_id: input.referenceId ?? undefined,
      p_idempotency_key: idempotencyKey,
      p_expected_version: input.expectedVersion ?? undefined,
      p_quantity_semantics: input.quantitySemantics || "quantity_delta",
    });

    if (error) {
      return { success: false, error: mapDatabaseError(error) };
    }

    const res = rawData as unknown as RawStockMutationRpcResult;

    // Revalidate affected route paths
    revalidatePath(`/[slug]/inventory`, "page");
    revalidatePath(`/[slug]/products`, "page");
    revalidatePath(`/[slug]/products/${input.productId}`, "page");

    return {
      success: true,
      data: {
        success: res.success ?? true,
        isReplay: res.is_replay ?? false,
        status: res.status ?? "committed",
        movementId: res.movement_id,
        productId: res.product_id || input.productId,
        quantityBefore: parseFloat(String(res.quantity_before ?? 0)),
        quantityDelta: parseFloat(String(res.quantity_delta ?? 0)),
        quantityAfter: parseFloat(String(res.quantity_after ?? 0)),
        currentStock: parseFloat(String(res.current_stock ?? 0)),
        matchedQuantity: res.matched_quantity !== undefined ? parseFloat(String(res.matched_quantity)) : undefined,
        version: res.version,
        message: res.message,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error occurred.";
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

// ============================================================================
// 5. updateInventoryThresholdsAction (T017, US6)
// ============================================================================
/**
 * Updates inventory reorder thresholds with optimistic concurrency control.
 * - Enforces `inventory:adjust` permission.
 * - Invokes Layer 2 RPC `update_inventory_thresholds`.
 * - Surfaces `STALE_VERSION_CONFLICT` on version mismatch.
 */
export async function updateInventoryThresholdsAction(
  slug: string,
  rawInput: unknown
): Promise<ActionResult<UpdateThresholdsResult>> {
  try {
    const tenantRes = await resolveTenantContext(slug);
    if (!tenantRes.ok) {
      return {
        success: false,
        error: { code: tenantRes.error.toUpperCase(), message: "Organization not found or access denied." },
      };
    }
    const { context } = tenantRes;

    if (!hasInventoryPermission(context, "inventory:adjust")) {
      return {
        success: false,
        error: { code: "FORBIDDEN", message: "Unauthorized: updating inventory thresholds requires inventory:adjust permission." },
      };
    }

    const parsedInput = inventoryThresholdInputSchema.safeParse(rawInput);
    if (!parsedInput.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid inventory threshold parameters.",
          details: parsedInput.error.flatten().fieldErrors as Record<string, string[]>,
        },
      };
    }
    const input = parsedInput.data;

    const supabase = await createClient();

    const { data: rawData, error } = await supabase.rpc("update_inventory_thresholds", {
      p_org_id: context.organization.id,
      p_product_id: input.productId,
      p_reorder_point: (input.reorderPoint ?? null) as unknown as number,
      p_reorder_quantity: (input.reorderQuantity ?? null) as unknown as number,
      p_expected_version: input.expectedVersion ?? undefined,
    });

    if (error) {
      return { success: false, error: mapDatabaseError(error) };
    }

    const res = rawData as unknown as {
      success: boolean;
      product_id: string;
      reorder_point: number | null;
      reorder_quantity: number | null;
      version: number;
    };

    revalidatePath(`/[slug]/inventory`, "page");
    revalidatePath(`/[slug]/products/${input.productId}`, "page");

    return {
      success: true,
      data: {
        success: res.success ?? true,
        productId: res.product_id || input.productId,
        reorderPoint: res.reorder_point,
        reorderQuantity: res.reorder_quantity,
        version: res.version,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error occurred.";
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

// ============================================================================
// 6. getMovementHistoryAction (T017, US7)
// ============================================================================
/**
 * Queries the immutable audit ledger.
 * - Enforces `inventory:history` permission.
 * - Enforces dual-permission (`inventory:read_valuation` AND `products:read_cost`) on acquisition cost data.
 * - When unauthorized, `unitCost` and `currency` are strictly `null`.
 */
export async function getMovementHistoryAction(
  slug: string,
  rawQuery: unknown
): Promise<ActionResult<PaginatedMovementHistoryResult>> {
  try {
    const tenantRes = await resolveTenantContext(slug);
    if (!tenantRes.ok) {
      return {
        success: false,
        error: { code: tenantRes.error.toUpperCase(), message: "Organization not found or access denied." },
      };
    }
    const { context } = tenantRes;

    if (!hasInventoryPermission(context, "inventory:history")) {
      return {
        success: false,
        error: { code: "FORBIDDEN", message: "Unauthorized: missing inventory:history permission." },
      };
    }

    const parsedQuery = movementHistoryQuerySchema.safeParse(rawQuery);
    if (!parsedQuery.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid movement history query parameters.",
          details: parsedQuery.error.flatten().fieldErrors as Record<string, string[]>,
        },
      };
    }
    const query = parsedQuery.data;

    const allowValuation = canViewValuation(context);
    const supabase = await createClient();

    // Select query conditionally joining costs if authorized
    const selectFields = allowValuation
      ? `
        id,
        product_id,
        movement_type,
        quantity_before,
        quantity_delta,
        quantity_after,
        reason,
        reference_id,
        created_by,
        created_at,
        products (
          name,
          sku
        ),
        profiles (
          id,
          first_name,
          last_name
        ),
        stock_movement_costs (
          unit_cost,
          currency
        )
      `
      : `
        id,
        product_id,
        movement_type,
        quantity_before,
        quantity_delta,
        quantity_after,
        reason,
        reference_id,
        created_by,
        created_at,
        products (
          name,
          sku
        ),
        profiles (
          id,
          first_name,
          last_name
        )
      `;

    let dbQuery = supabase
      .from("stock_movements")
      .select(selectFields, { count: "exact" })
      .eq("organization_id", context.organization.id);

    if (query.productId) {
      dbQuery = dbQuery.eq("product_id", query.productId);
    }

    if (query.movementType !== "all") {
      dbQuery = dbQuery.eq("movement_type", query.movementType);
    }

    if (query.fromDate) {
      dbQuery = dbQuery.gte("created_at", query.fromDate);
    }

    if (query.toDate) {
      dbQuery = dbQuery.lte("created_at", query.toDate);
    }

    dbQuery = dbQuery.order("created_at", { ascending: false });

    // Pagination
    const startIndex = (query.page - 1) * query.pageSize;
    dbQuery = dbQuery.range(startIndex, startIndex + query.pageSize - 1);

    const { data, count, error } = await dbQuery;

    if (error) {
      return { success: false, error: mapDatabaseError(error) };
    }

    interface MovementDbRow {
      id: string;
      product_id: string;
      movement_type: string;
      quantity_before: number | string;
      quantity_delta: number | string;
      quantity_after: number | string;
      reason: string;
      reference_id: string | null;
      created_by: string;
      created_at: string;
      products?: { name?: string; sku?: string } | null;
      profiles?: { id?: string; first_name?: string | null; last_name?: string | null } | null;
      stock_movement_costs?: { unit_cost?: number | string; currency?: string }[] | { unit_cost?: number | string; currency?: string } | null;
    }

    const rows = (data || []) as unknown as MovementDbRow[];

    const items: MovementHistoryRow[] = rows.map((row) => {
      const p = row.products;
      const prof = row.profiles;
      const cost = allowValuation ? row.stock_movement_costs : null;

      let unitCost: number | null = null;
      let currency: string | null = null;

      if (allowValuation && cost) {
        if (Array.isArray(cost) && cost.length > 0) {
          unitCost = parseFloat(String(cost[0]?.unit_cost)) || null;
          currency = cost[0]?.currency || null;
        } else if (!Array.isArray(cost)) {
          unitCost = parseFloat(String(cost.unit_cost)) || null;
          currency = cost.currency || null;
        }
      }

      const fullName = prof
        ? [prof.first_name, prof.last_name].filter(Boolean).join(" ") || null
        : null;

      return {
        id: row.id,
        productId: row.product_id,
        productName: p?.name || "Unknown Product",
        sku: p?.sku || "",
        movementType: row.movement_type as MovementType,
        quantityBefore: parseFloat(String(row.quantity_before)) || 0,
        quantityDelta: parseFloat(String(row.quantity_delta)) || 0,
        quantityAfter: parseFloat(String(row.quantity_after)) || 0,
        reason: row.reason,
        referenceId: row.reference_id,
        unitCost,
        currency,
        performedBy: {
          id: prof?.id || row.created_by,
          fullName,
          email: "", // Masked for privacy
        },
        createdAt: row.created_at,
      };
    });

    const totalCount = count ?? items.length;
    const totalPages = Math.ceil(totalCount / query.pageSize) || 1;

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
    const message = err instanceof Error ? err.message : "Internal server error occurred.";
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

