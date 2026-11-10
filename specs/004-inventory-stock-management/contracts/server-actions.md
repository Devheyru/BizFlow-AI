# Server Actions Contract: Feature 004 — Inventory & Stock Management

**Feature Branch**: `004-inventory-stock-management`  
**Date**: 2026-11-10  
**Status**: Authoritative Application Contract  
**Governing Documents**:
- [BizFlow AI Constitution v1.1.0](.specify/memory/constitution.md)
- [Feature 004 Specification](specs/004-inventory-stock-management/spec.md)
- [Feature 004 Data Model](specs/004-inventory-stock-management/data-model.md)
- [Feature 004 Database RPCs](specs/004-inventory-stock-management/contracts/database-rpcs.md)

---

## 1. Architecture & Security Conventions

All Server Actions follow standard BizFlow AI conventions:
1. **Server Boundary**: Annotated with `'use server'`.
2. **Tenant Revalidation**: Server resolves active tenant from authenticated session and verified membership. Client-supplied organization IDs are never trusted.
3. **Zod Validation**: All arguments are validated using runtime Zod schemas before database interaction.
4. **Error Handling**: Standardized `ActionResult<T>` envelope:
   ```typescript
   export type ActionResult<T> =
     | { success: true; data: T; error?: never }
     | { success: false; error: { code: string; message: string; details?: unknown }; data?: never };
   ```
5. **Cache Invalidation**: Successful mutations revalidate Next.js cache paths (`revalidatePath('/[slug]/inventory', 'page')`, `revalidatePath('/[slug]/products/[productId]', 'page')`).

---

## 2. Zod Validation Schemas

Located in `src/lib/validations/inventory.ts`:

```typescript
import { z } from 'zod';

export const MOVEMENT_TYPES = [
  'initial',
  'restock',
  'adjustment',
  'damage',
  'loss',
  'internal_use',
] as const;

export const QUANTITY_SEMANTICS = [
  'quantity_delta',
  'target_physical_count',
] as const;

export const STOCK_STATUS_FILTER = [
  'all',
  'in_stock',
  'low_stock',
  'out_of_stock',
] as const;

export const PRODUCT_STATUS_FILTER = [
  'all',
  'active',
  'inactive',
  'archived',
] as const;

// 1. Stock Mutation Input Schema
export const stockMovementInputSchema = z.object({
  productId: z.string().uuid({ message: 'Valid product ID is required' }),
  movementType: z.enum(MOVEMENT_TYPES, {
    errorMap: () => ({ message: 'Invalid stock movement type' }),
  }),
  quantity: z
    .number({ invalid_type_error: 'Quantity must be a valid number' })
    .max(999999999.9999, { message: 'Quantity exceeds maximum limit' }),
  reason: z
    .string()
    .trim()
    .min(3, { message: 'Reason must be at least 3 characters' })
    .max(250, { message: 'Reason cannot exceed 250 characters' }),
  referenceId: z
    .string()
    .trim()
    .max(100, { message: 'Reference ID cannot exceed 100 characters' })
    .optional()
    .nullable(),
  idempotencyKey: z.string().uuid().optional().nullable(),
  expectedVersion: z.number().int().positive().optional().nullable(),
  quantitySemantics: z
    .enum(QUANTITY_SEMANTICS)
    .default('quantity_delta'),
}).refine(
  (data) => {
    if (data.quantitySemantics === 'target_physical_count') {
      return data.movementType === 'adjustment' && data.quantity >= 0;
    }
    return true;
  },
  {
    message: 'Target physical count is permitted only for adjustments and must be non-negative',
    path: ['quantitySemantics'],
  }
);

export type StockMovementInput = z.infer<typeof stockMovementInputSchema>;

// 2. Inventory Threshold Input Schema
export const inventoryThresholdInputSchema = z.object({
  productId: z.string().uuid({ message: 'Valid product ID is required' }),
  reorderPoint: z
    .number()
    .min(0, { message: 'Reorder point cannot be negative' })
    .max(999999999.9999)
    .optional()
    .nullable(),
  reorderQuantity: z
    .number()
    .positive({ message: 'Reorder quantity must be positive' })
    .max(999999999.9999)
    .optional()
    .nullable(),
  expectedVersion: z.number().int().positive().optional().nullable(),
});

export type InventoryThresholdInput = z.infer<typeof inventoryThresholdInputSchema>;

// 3. Inventory Query Schema
export const inventoryQuerySchema = z.object({
  search: z.string().trim().optional(),
  categoryId: z.string().uuid().optional().nullable(),
  stockStatus: z.enum(STOCK_STATUS_FILTER).default('all'),
  productStatus: z.enum(PRODUCT_STATUS_FILTER).default('all'),
  includeArchived: z.boolean().default(false),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['name', 'sku', 'quantity', 'stock_status']).default('stock_status'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export type InventoryQueryInput = z.infer<typeof inventoryQuerySchema>;

// 4. Movement History Query Schema
export const movementHistoryQuerySchema = z.object({
  productId: z.string().uuid().optional().nullable(),
  movementType: z.enum(['all', ...MOVEMENT_TYPES, 'sale', 'return']).default('all'),
  fromDate: z.string().datetime().optional().nullable(),
  toDate: z.string().datetime().optional().nullable(),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});

export type MovementHistoryQueryInput = z.infer<typeof movementHistoryQuerySchema>;
```

---

## 3. Server Action Specifications

Located in `src/actions/inventory-actions.ts`:

### 3.1 `getInventoryOverviewAction`

Retrieves high-level inventory metrics for the overview dashboard tiles.

- **Signature**:
  ```typescript
  export async function getInventoryOverviewAction(
    orgSlug: string,
    includeArchived: boolean = false
  ): Promise<ActionResult<InventoryOverviewData>>
  ```
- **Permission Required**: `inventory:read`
- **Valuation Permission**: If caller holds `inventory:read_valuation`, calculates monetary total; otherwise returns `null` for valuation fields.
- **Return Data Structure**:
  ```typescript
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
  ```

---

### 3.2 `getInventoryListAction`

Fetches paginated, filterable inventory items for the primary inventory table.

- **Signature**:
  ```typescript
  export async function getInventoryListAction(
    orgSlug: string,
    query: InventoryQueryInput
  ): Promise<ActionResult<PaginatedInventoryResult>>
  ```
- **Permission Required**: `inventory:read`
- **Valuation Field**: Unit cost and total value included only if caller has `inventory:read_valuation` AND `products:read_cost`.
- **Return Data Structure**:
  ```typescript
  export interface InventoryItemRow {
    productId: string;
    productName: string;
    sku: string;
    barcode: string | null;
    categoryName: string | null;
    productStatus: 'active' | 'inactive' | 'archived';
    unitOfMeasure: string;
    isDiscrete: boolean;
    quantity: number;
    reorderPoint: number | null;
    reorderQuantity: number | null;
    stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock';
    version: number;
    unitCost: number | null; // Protected
    totalValue: number | null; // Protected
    currency: string | null;
  }

  export interface PaginatedInventoryResult {
    items: InventoryItemRow[];
    totalCount: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }
  ```

---

### 3.3 `getInventoryProductAction`

Retrieves current inventory balance, threshold parameters, and product metadata for a single product (used on Product Details page and mutation modals).

- **Signature**:
  ```typescript
  export async function getInventoryProductAction(
    orgSlug: string,
    productId: string
  ): Promise<ActionResult<InventoryProductDetail>>
  ```
- **Permission Required**: `inventory:read`

---

### 3.4 `recordStockMovementAction`

The primary mutation action. Orchestrates validation, canonical idempotency hashing, and invokes the `execute_stock_movement` stored procedure.

- **Signature**:
  ```typescript
  export async function recordStockMovementAction(
    orgSlug: string,
    input: StockMovementInput
  ): Promise<ActionResult<StockMutationResult>>
  ```
- **Permissions Required**:
  - `inventory:receive` for `initial`, `restock`
  - `inventory:adjust` for `adjustment`, `damage`, `loss`, `internal_use`
- **Execution Steps**:
  1. Authenticates session and resolves tenant from `orgSlug`.
  2. Validates `input` with `stockMovementInputSchema`.
  3. Verifies required granular permission.
  4. Generates client `idempotencyKey` if not supplied.
  5. Computes canonical SHA-256 payload hash in TypeScript for client traceability.
  6. Calls Supabase RPC `execute_stock_movement`.
  7. Revalidates Next.js router cache paths.
  8. Returns typed `ActionResult<StockMutationResult>`.
- **Return Data Structure**:
  ```typescript
  export interface StockMutationResult {
    success: boolean;
    isReplay: boolean;
    status: 'committed' | 'replayed' | 'matched';
    movementId?: string;
    productId: string;
    quantityBefore: number;
    quantityDelta: number;
    quantityAfter: number;
    currentStock: number;
    matchedQuantity?: number; // Original confirmed physical count for status === 'matched'
    version?: number;
    message?: string;
  }
  ```

---

### 3.5 `updateInventoryThresholdsAction`

Updates reorder point thresholds without appending to movement ledger.

- **Signature**:
  ```typescript
  export async function updateInventoryThresholdsAction(
    orgSlug: string,
    input: InventoryThresholdInput
  ): Promise<ActionResult<{ success: boolean; version: number }>>
  ```
- **Permission Required**: `inventory:adjust`
- **RPC Invoked**: `public.update_inventory_thresholds`.

---

### 3.6 `getMovementHistoryAction`

Queries the immutable audit ledger.

- **Signature**:
  ```typescript
  export async function getMovementHistoryAction(
    orgSlug: string,
    query: MovementHistoryQueryInput
  ): Promise<ActionResult<PaginatedMovementHistoryResult>>
  ```
- **Permission Required**: `inventory:history`
- **Valuation Protection**: Automatically joins `public.stock_movement_costs` via Supabase RLS. Unauthorized users receive `null` for unit cost and currency.
- **Return Data Structure**:
  ```typescript
  export interface MovementHistoryRow {
    id: string;
    productId: string;
    productName: string;
    sku: string;
    movementType: string;
    quantityBefore: number;
    quantityDelta: number;
    quantityAfter: number;
    reason: string;
    referenceId: string | null;
    unitCost: number | null; // Protected
    currency: string | null; // Protected
    performedBy: {
      id: string;
      fullName: string | null;
      email: string;
    };
    createdAt: string;
  }
  ```

