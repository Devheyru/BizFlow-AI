/**
 * Feature 004 — Inventory & Stock Management Domain Types
 * Authoritative source: specs/004-inventory-stock-management/data-model.md
 * and contracts/database-rpcs.md, contracts/server-actions.md
 * In compliance with BizFlow AI Constitution v1.1.0 (Strict TypeScript, zero `any`)
 */

// ============================================================================
// Movement Types & Semantics Enums
// ============================================================================

export const MOVEMENT_TYPES = Object.freeze([
  "initial",
  "restock",
  "adjustment",
  "damage",
  "loss",
  "internal_use",
  "sale",
  "return",
] as const);

export type MovementType = (typeof MOVEMENT_TYPES)[number];

/**
 * Movement types permitted in direct Feature 004 manual mutation actions.
 * Excludes POS sale and return which are strictly reserved for Feature 005.
 */
export const MANUAL_MOVEMENT_TYPES = Object.freeze([
  "initial",
  "restock",
  "adjustment",
  "damage",
  "loss",
  "internal_use",
] as const);

export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

export const QUANTITY_SEMANTICS = Object.freeze([
  "quantity_delta",
  "target_physical_count",
] as const);

export type QuantitySemantics = (typeof QUANTITY_SEMANTICS)[number];

export const STOCK_STATUSES = Object.freeze([
  "in_stock",
  "low_stock",
  "out_of_stock",
] as const);

export type StockStatus = (typeof STOCK_STATUSES)[number];

export const STOCK_STATUS_FILTERS = Object.freeze([
  "all",
  "in_stock",
  "low_stock",
  "out_of_stock",
] as const);

export type StockStatusFilter = (typeof STOCK_STATUS_FILTERS)[number];

export const PRODUCT_STATUS_FILTERS = Object.freeze([
  "all",
  "active",
  "inactive",
  "archived",
] as const);

export type ProductStatusFilter = (typeof PRODUCT_STATUS_FILTERS)[number];

// ============================================================================
// Database Row Representations (PostgreSQL Tables)
// ============================================================================

/**
 * Representation of a row in `public.inventory`.
 */
export interface InventoryRow {
  id: string;
  organization_id: string;
  product_id: string;
  quantity: number;
  reorder_point: number | null;
  reorder_quantity: number | null;
  version: number;
  created_at: string;
  updated_at: string;
}

/**
 * Representation of a row in `public.stock_movements`.
 */
export interface StockMovementRow {
  id: string;
  organization_id: string;
  product_id: string;
  inventory_id: string;
  movement_type: MovementType;
  quantity_before: number;
  quantity_delta: number;
  quantity_after: number;
  reason: string;
  reference_id: string | null;
  idempotency_key: string | null;
  idempotency_payload_hash: string | null;
  created_by: string;
  created_at: string;
}

/**
 * Representation of a row in `public.stock_movement_costs`.
 */
export interface StockMovementCostRow {
  movement_id: string;
  organization_id: string;
  unit_cost: number;
  currency: string;
  created_at: string;
}

/**
 * Representation of a row in `public.zero_delta_stocktakes`.
 */
export interface ZeroDeltaStocktakeRow {
  id: string;
  organization_id: string;
  product_id: string;
  idempotency_key: string;
  idempotency_payload_hash: string;
  target_physical_count: number;
  created_by: string;
  created_at: string;
}

// ============================================================================
// Error Codes & SQLSTATE Mapping
// ============================================================================

export const INVENTORY_ERROR_CODES = Object.freeze({
  UNAUTHENTICATED: "UNAUTHENTICATED",
  INSUFFICIENT_PERMISSIONS: "INSUFFICIENT_PERMISSIONS",
  ORGANIZATION_INACTIVE: "ORGANIZATION_INACTIVE",
  MEMBERSHIP_INACTIVE: "MEMBERSHIP_INACTIVE",
  PRODUCT_NOT_FOUND: "PRODUCT_NOT_FOUND",
  INVENTORY_NOT_FOUND: "INVENTORY_NOT_FOUND",
  TENANT_MISMATCH: "TENANT_MISMATCH",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  NON_POSITIVE_QUANTITY: "NON_POSITIVE_QUANTITY",
  NEGATIVE_QUANTITY_NOT_PERMITTED: "NEGATIVE_QUANTITY_NOT_PERMITTED",
  ZERO_QUANTITY_NOT_PERMITTED: "ZERO_QUANTITY_NOT_PERMITTED",
  INTEGER_QUANTITY_REQUIRED: "INTEGER_QUANTITY_REQUIRED",
  DECIMAL_PRECISION_EXCEEDED: "DECIMAL_PRECISION_EXCEEDED",
  ADJUSTMENT_REASON_REQUIRED: "ADJUSTMENT_REASON_REQUIRED",
  ADJUSTMENT_REASON_TOO_LONG: "ADJUSTMENT_REASON_TOO_LONG",
  REFERENCE_ID_TOO_LONG: "REFERENCE_ID_TOO_LONG",
  INVALID_MOVEMENT_TYPE: "INVALID_MOVEMENT_TYPE",
  PRODUCT_ARCHIVED_STOCK_FORBIDDEN: "PRODUCT_ARCHIVED_STOCK_FORBIDDEN",
  PRODUCT_INACTIVE_RESTOCK_BLOCKED: "PRODUCT_INACTIVE_RESTOCK_BLOCKED",
  PRODUCT_INACTIVE_INTERNAL_USE_BLOCKED: "PRODUCT_INACTIVE_INTERNAL_USE_BLOCKED",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  INITIAL_STOCK_ALREADY_RECORDED: "INITIAL_STOCK_ALREADY_RECORDED",
  INITIAL_STOCK_ALREADY_ESTABLISHED: "INITIAL_STOCK_ALREADY_ESTABLISHED",
  INITIAL_STOCK_NOT_PERMITTED_HISTORY_EXISTS: "INITIAL_STOCK_NOT_PERMITTED_HISTORY_EXISTS",
  STALE_VERSION_CONFLICT: "STALE_VERSION_CONFLICT",
  QUANTITY_EXCEEDS_MAXIMUM: "QUANTITY_EXCEEDS_MAXIMUM",
  UOM_CLASS_MUTATION_RESTRICTED: "UOM_CLASS_MUTATION_RESTRICTED",
  ORGANIZATION_DELETION_FAILED: "ORGANIZATION_DELETION_FAILED",
  PRODUCT_INACTIVE_SALE_BLOCKED: "PRODUCT_INACTIVE_SALE_BLOCKED",
  PRODUCT_INACTIVE_RETURN_BLOCKED: "PRODUCT_INACTIVE_RETURN_BLOCKED",
  INVALID_QUANTITY_SEMANTICS: "INVALID_QUANTITY_SEMANTICS",
  REORDER_POINT_CANNOT_BE_NEGATIVE: "REORDER_POINT_CANNOT_BE_NEGATIVE",
  REORDER_QUANTITY_MUST_BE_POSITIVE: "REORDER_QUANTITY_MUST_BE_POSITIVE",
} as const);

export type InventoryErrorCode =
  (typeof INVENTORY_ERROR_CODES)[keyof typeof INVENTORY_ERROR_CODES];

// ============================================================================
// Application & Server Action Domain Interfaces
// ============================================================================

/**
 * Result shape returned by `recordStockMovementAction` and Layer 2 RPC.
 */
export interface StockMutationResult {
  success: boolean;
  isReplay: boolean;
  status: "committed" | "replayed" | "matched";
  movementId?: string;
  productId: string;
  quantityBefore: number;
  quantityDelta: number;
  quantityAfter: number;
  currentStock: number;
  /**
   * Original verified physical count recorded at stocktake execution.
   * Present when `status === 'matched'`.
   */
  matchedQuantity?: number;
  version?: number;
  message?: string;
}

/**
 * Raw JSONB return payload from `public.execute_stock_movement` RPC.
 */
export interface RawStockMutationRpcResult {
  success?: boolean;
  is_replay?: boolean;
  status?: "committed" | "replayed" | "matched";
  movement_id?: string;
  product_id?: string;
  quantity_before?: string | number;
  quantity_delta?: string | number;
  quantity_after?: string | number;
  current_stock?: string | number;
  matched_quantity?: string | number;
  version?: number;
  message?: string;
}

/**
 * High-level inventory overview metrics for dashboard cards.
 */
export interface InventoryOverviewData {
  totalTrackedProducts: number;
  inStockCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  totalValuation: {
    amount: number;
    currency: string;
    formatted: string;
  } | null;
}

export type InventoryOverview = InventoryOverviewData;

/**
 * Single item row in the paginated inventory table.
 */
export interface InventoryItemRow {
  productId: string;
  productName: string;
  sku: string;
  barcode: string | null;
  categoryName: string | null;
  productStatus: "active" | "inactive" | "archived";
  unitOfMeasure: string;
  isDiscrete: boolean;
  quantity: number;
  reorderPoint: number | null;
  reorderQuantity: number | null;
  stockStatus: StockStatus;
  version: number;
  unitCost: number | null; // Protected: requires inventory:read_valuation AND products:read_cost
  totalValue: number | null; // Protected: requires inventory:read_valuation AND products:read_cost
  currency: string | null;
}

/**
 * Paginated result container for inventory list queries.
 */
export interface PaginatedInventoryResult {
  items: InventoryItemRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Detailed inventory state for a single product (used in modals and product details summary card).
 */
export interface InventoryProductDetail {
  productId: string;
  productName: string;
  sku: string;
  barcode: string | null;
  unitOfMeasure: string;
  isDiscrete: boolean;
  productStatus: "active" | "inactive" | "archived";
  quantity: number;
  reorderPoint: number | null;
  reorderQuantity: number | null;
  stockStatus: StockStatus;
  version: number;
  lastMovementAt: string | null;
  unitCost?: number | null;
  totalValue?: number | null;
  currency?: string | null;
}

/**
 * Actor profile snapshot attached to movement history records.
 */
export interface MovementActor {
  id: string;
  fullName: string | null;
  email: string;
}

/**
 * Single historical record in the movement audit ledger.
 */
export interface MovementHistoryRow {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  movementType: MovementType;
  quantityBefore: number;
  quantityDelta: number;
  quantityAfter: number;
  reason: string;
  referenceId: string | null;
  unitCost: number | null; // Protected: requires inventory:read_valuation AND products:read_cost
  currency: string | null; // Protected
  performedBy: MovementActor;
  createdAt: string;
}

/**
 * Paginated result container for movement history ledger queries.
 */
export interface PaginatedMovementHistoryResult {
  items: MovementHistoryRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Result shape returned by threshold update operations.
 */
export interface UpdateThresholdsResult {
  success: boolean;
  productId: string;
  reorderPoint: number | null;
  reorderQuantity: number | null;
  version: number;
}

/**
 * Input payload for recording stock movements.
 */
export interface StockMovementInput {
  productId: string;
  movementType: ManualMovementType;
  quantity: number;
  reason: string;
  referenceId?: string | null;
  idempotencyKey?: string | null;
  expectedVersion?: number | null;
  quantitySemantics?: QuantitySemantics;
}

/**
 * Input payload for updating inventory thresholds.
 */
export interface InventoryThresholdInput {
  productId: string;
  reorderPoint?: number | null;
  reorderQuantity?: number | null;
  expectedVersion?: number | null;
}

/**
 * Query filters for the inventory list view.
 */
export interface InventoryQueryFilters {
  search?: string;
  categoryId?: string | null;
  stockStatus?: StockStatusFilter;
  productStatus?: ProductStatusFilter;
  includeArchived?: boolean;
  page?: number;
  pageSize?: number;
  sortBy?: "name" | "sku" | "quantity" | "stock_status";
  sortOrder?: "asc" | "desc";
}

export type InventoryQueryInput = InventoryQueryFilters;

/**
 * Query filters for the movement history audit ledger.
 */
export interface MovementHistoryQueryFilters {
  productId?: string | null;
  movementType?: "all" | MovementType;
  fromDate?: string | null;
  toDate?: string | null;
  page?: number;
  pageSize?: number;
}

export type MovementHistoryQueryInput = MovementHistoryQueryFilters;

