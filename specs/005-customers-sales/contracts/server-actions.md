# Server Action Contracts: Feature 005 — Customers & Sales

**Branch**: `005-customers-sales` | **Date**: 2026-11-17 | **Spec**: [spec.md](../spec.md)

---

## Common Conventions

- **Pattern**: `"use server"; import "server-only";` — All actions follow the established F004 pattern.
- **Auth**: Every action calls `resolveTenantContext(slug)` → `TenantResolutionResult`.
- **Permission check**: `hasPermission(context, '<permission>')` from `src/lib/auth/permissions.ts`.
- **Return type**: `Promise<ActionResult<T>>` from `src/types/auth.ts`.
- **Validation**: All inputs validated via Zod schemas at the boundary.
- **Error mapping**: Database SQLSTATE errors mapped to domain error codes via `mapSalesError()`.
- **Revalidation**: `revalidatePath(`/${slug}/...`)` after mutations.

---

## File Structure

```text
src/
├── actions/
│   ├── customer-actions.ts        # Customer CRUD actions
│   ├── sales-actions.ts           # Sale checkout, void, return, refund actions
│   └── tax-settings-actions.ts    # Tax settings action
├── lib/
│   ├── validations/
│   │   ├── customers.ts           # Customer Zod schemas
│   │   └── sales.ts               # Sale, payment, return Zod schemas
│   └── sales/
│       ├── error-codes.ts         # SQLSTATE → domain error mapping
│       └── canonical-hash.ts      # Client-side canonical hash (for idempotency key generation)
├── types/
│   ├── customers.ts               # Customer domain types
│   └── sales.ts                   # Sale, payment, return, refund domain types
└── components/
    ├── customers/                 # Customer management UI
    ├── sales/                     # Sales history, receipt, void UI
    └── pos/                       # POS cart, checkout UI
```

---

## 1. Customer Actions (`src/actions/customer-actions.ts`)

### `createCustomerAction(slug: string, input: unknown): Promise<ActionResult<CustomerRecord>>`

| Property | Detail |
|---|---|
| **Permission** | `customers:create` |
| **Zod Schema** | `createCustomerSchema` |
| **RPC Call** | `supabase.rpc('create_customer', { p_org_id, p_name, p_phone, p_email, p_notes })` |
| **Revalidation** | `revalidatePath(/${slug}/customers)` |

### `updateCustomerAction(slug: string, customerId: string, input: unknown): Promise<ActionResult<CustomerRecord>>`

| Property | Detail |
|---|---|
| **Permission** | `customers:update` |
| **Zod Schema** | `updateCustomerSchema` |
| **RPC Call** | `supabase.rpc('update_customer', { p_org_id, p_customer_id, p_name, p_phone, p_email, p_notes })` |
| **Revalidation** | `revalidatePath(/${slug}/customers)` |

### `archiveCustomerAction(slug: string, customerId: string): Promise<ActionResult<{ archived: boolean }>>`

| Property | Detail |
|---|---|
| **Permission** | `customers:archive` |
| **RPC Call** | `supabase.rpc('archive_customer', { p_org_id, p_customer_id })` |
| **Revalidation** | `revalidatePath(/${slug}/customers)` |

### `searchCustomersAction(slug: string, query: unknown): Promise<ActionResult<PaginatedCustomerResult>>`

| Property | Detail |
|---|---|
| **Permission** | `customers:read` |
| **Zod Schema** | `customerSearchSchema` |
| **Query** | PostgREST `.from('customers').select(...)` with `ilike` on name, phone, email |
| **Pagination** | Server-side via `.range()` |

### `getCustomerDetailAction(slug: string, customerId: string): Promise<ActionResult<CustomerDetail>>`

| Property | Detail |
|---|---|
| **Permission** | `customers:read` |
| **Query** | PostgREST `.from('customers').select(...).eq('id', customerId).single()` |
| **Includes** | Purchase count, last purchase date (via aggregated query on `sales`) |

---

## 2. Sales Actions (`src/actions/sales-actions.ts`)

### `executeSaleAction(slug: string, input: unknown): Promise<ActionResult<SaleResult>>`

| Property | Detail |
|---|---|
| **Permission** | `sales:create` |
| **Zod Schema** | `executeSaleSchema` |
| **Idempotency Key** | Client-generated UUID, mandatory |
| **RPC Call** | `supabase.rpc('execute_sale', { p_org_id, p_customer_id, p_items, p_payments, p_order_discount_amount, p_idempotency_key, p_notes })` |
| **Revalidation** | `revalidatePath(/${slug}/sales)`, `revalidatePath(/${slug}/pos)` |
| **Post-processing** | Parse JSONB response, map error codes |

### `voidSaleAction(slug: string, input: unknown): Promise<ActionResult<VoidResult>>`

| Property | Detail |
|---|---|
| **Permission** | `sales:void` |
| **Zod Schema** | `voidSaleSchema` |
| **RPC Call** | `supabase.rpc('void_sale', { p_org_id, p_sale_id, p_void_reason, p_idempotency_key, p_reversal_references })` |
| **Revalidation** | `revalidatePath(/${slug}/sales)` |

### `executeSaleReturnAction(slug: string, input: unknown): Promise<ActionResult<ReturnResult>>`

| Property | Detail |
|---|---|
| **Permission** | `returns:create` |
| **Zod Schema** | `executeSaleReturnSchema` |
| **RPC Call** | `supabase.rpc('execute_sale_return', { p_org_id, p_sale_id, p_return_items, p_refund_method, p_reason, p_idempotency_key, p_reference_no })` |
| **Revalidation** | `revalidatePath(/${slug}/sales)`, `revalidatePath(/${slug}/returns)` |

### `confirmRefundAction(slug: string, input: unknown): Promise<ActionResult<RefundConfirmation>>`

| Property | Detail |
|---|---|
| **Permission** | `refunds:read` AND (`sales:void` OR `returns:create`) |
| **Zod Schema** | `confirmRefundSchema` |
| **RPC Call** | `supabase.rpc('confirm_refund_reimbursement', { p_org_id, p_refund_id, p_external_reference, p_idempotency_key })` |
| **Revalidation** | `revalidatePath(/${slug}/sales)` |

### `recordRefundFailureAction(slug: string, input: unknown): Promise<ActionResult<RefundFailureResult>>`

| Property | Detail |
|---|---|
| **Permission** | `sales:void` OR `returns:create` |
| **Zod Schema** | `recordRefundFailureSchema` |
| **RPC Call** | `supabase.rpc('record_refund_failure', { p_org_id, p_refund_id, p_failure_reason })` |
| **Revalidation** | `revalidatePath(/${slug}/sales)` |

### `issueReplacementRefundAction(slug: string, input: unknown): Promise<ActionResult<ReplacementRefundResult>>`

| Property | Detail |
|---|---|
| **Permission** | `sales:void` OR `returns:create` |
| **Zod Schema** | `issueReplacementRefundSchema` |
| **RPC Call** | `supabase.rpc('issue_replacement_refund', { p_org_id, p_failed_refund_id, p_refund_method, p_idempotency_key, p_reference_no, p_notes })` |
| **Revalidation** | `revalidatePath(/${slug}/sales)` |

### `getSalesListAction(slug: string, query: unknown): Promise<ActionResult<PaginatedSalesList>>`

| Property | Detail |
|---|---|
| **Permission** | `sales:read` |
| **Zod Schema** | `salesListQuerySchema` |
| **Query** | PostgREST `.from('sales').select(...)` with filters: date range, status, customer, cashier, search by sale_number |
| **Cost protection** | Database-enforced: direct SELECT on `sale_items.unit_cost` is revoked from `authenticated` (`42501`). Sales list queries select header and customer summary fields only. |

### `getSaleDetailAction(slug: string, saleId: string): Promise<ActionResult<SaleDetail>>`

| Property | Detail |
|---|---|
| **Permission** | `sales:read` |
| **RPC Call** | `supabase.rpc('get_sale_detail', { p_org_id: org.id, p_sale_id: saleId })` |
| **Cost protection** | Database-enforced: `get_sale_detail` RPC evaluates `inventory:read_valuation` AND `products:read_cost` server-side in PostgreSQL. `unit_cost` is returned as `null` whenever either or both permissions are absent. |
| **Direct bypass prevention** | Direct PostgREST table SELECT on `sale_items.unit_cost` is revoked at the database privilege layer (`42501`). All detail reads MUST use `get_sale_detail`. |

### `getReturnHistoryAction(slug: string, saleId: string): Promise<ActionResult<ReturnHistory[]>>`

| Property | Detail |
|---|---|
| **Permission** | `returns:read` |
| **Query** | Returns with return items and refund records for a sale |

---

## 3. Tax Settings Action (`src/actions/tax-settings-actions.ts`)

### `updateTaxSettingsAction(slug: string, input: unknown): Promise<ActionResult<TaxSettings>>`

| Property | Detail |
|---|---|
| **Permission** | `tax_settings:update` (Owner, Admin only) |
| **Zod Schema** | `updateTaxSettingsSchema` |
| **RPC Call** | `supabase.rpc('update_tax_settings', { p_org_id, p_tax_name, p_default_tax_rate, p_is_tax_inclusive })` |
| **Revalidation** | `revalidatePath(/${slug}/settings)` |

### `getTaxSettingsAction(slug: string): Promise<ActionResult<TaxSettings | null>>`

| Property | Detail |
|---|---|
| **Permission** | `sales:read` or `is_org_member` |
| **Query** | PostgREST `.from('organization_tax_settings').select(...).eq('organization_id', orgId).maybeSingle()` |

---

## 4. Zod Validation Schemas

### `src/lib/validations/customers.ts`

```typescript
// createCustomerSchema
{
  name: z.string().trim().min(1).max(255),
  phone: z.string().trim().regex(/^\+[1-9]\d{6,14}$/).optional().nullable(),
  email: z.string().trim().email().optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
}

// updateCustomerSchema — same fields as create

// customerSearchSchema
{
  search: z.string().trim().optional(),
  status: z.enum(['all', 'active', 'archived']).default('active'),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
}
```

### `src/lib/validations/sales.ts`

```typescript
// executeSaleSchema
{
  customerId: z.string().uuid().optional().nullable(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().positive().max(999999999.9999)
      .refine(hasMaxFourDecimals),
    lineDiscountAmount: z.number().min(0).max(999999999.9999)
      .refine(hasMaxFourDecimals).default(0),
    expectedVersion: z.number().int().nonnegative().optional().nullable(),
  })).min(1),
  payments: z.array(z.object({
    paymentMethod: z.enum(['cash', 'card', 'bank_transfer', 'other']),
    amount: z.number().positive().max(999999999.9999),
    amountTendered: z.number().min(0).optional().nullable(),
    changeDue: z.number().min(0).optional().nullable(),
    referenceNo: z.string().trim().max(255).optional().nullable(),
  })),
  orderDiscountAmount: z.number().min(0).max(999999999.9999).default(0),
  idempotencyKey: z.string().uuid(),
  notes: z.string().trim().max(1000).optional().nullable(),
}

// voidSaleSchema
{
  saleId: z.string().uuid(),
  voidReason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().uuid(),
  reversalReferences: z.array(z.object({
    paymentId: z.string().uuid(),
    referenceNo: z.string().trim().max(255),
  })).optional().nullable(),
}

// executeSaleReturnSchema
{
  saleId: z.string().uuid(),
  returnItems: z.array(z.object({
    saleItemId: z.string().uuid(),
    quantity: z.number().positive().max(999999999.9999)
      .refine(hasMaxFourDecimals),
    restockToInventory: z.boolean(),
  })).min(1),
  refundMethod: z.enum(['cash', 'card', 'bank_transfer', 'other']),
  reason: z.string().trim().min(3).max(255),
  idempotencyKey: z.string().uuid(),
  referenceNo: z.string().trim().max(255).optional().nullable(),
}

// confirmRefundSchema
{
  refundId: z.string().uuid(),
  externalReference: z.string().trim().min(1).max(255),
  idempotencyKey: z.string().uuid(),
}

// recordRefundFailureSchema
{
  refundId: z.string().uuid(),
  failureReason: z.string().trim().min(3).max(500),
}

// issueReplacementRefundSchema
{
  failedRefundId: z.string().uuid(),
  refundMethod: z.enum(['cash', 'card', 'bank_transfer', 'other']),
  idempotencyKey: z.string().uuid(),
  referenceNo: z.string().trim().max(255).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
}

// salesListQuerySchema
{
  search: z.string().trim().optional(),
  status: z.enum(['all', 'completed', 'voided', 'partially_returned', 'returned']).default('all'),
  customerId: z.string().uuid().optional().nullable(),
  cashierId: z.string().uuid().optional().nullable(),
  fromDate: z.string().datetime().optional().nullable(),
  toDate: z.string().datetime().optional().nullable(),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['created_at', 'sale_number', 'total_amount']).default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
}

// updateTaxSettingsSchema
{
  taxName: z.string().trim().min(1).max(100),
  defaultTaxRate: z.number().min(0).max(100).refine(hasMaxFourDecimals),
  isTaxInclusive: z.boolean(),
}
```

---

## 5. Domain Types

### `src/types/customers.ts`

```typescript
export type CustomerStatus = 'active' | 'archived';

export interface CustomerRecord {
  id: string;
  organizationId: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: CustomerStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerDetail extends CustomerRecord {
  purchaseCount: number;
  lastPurchaseAt: string | null;
  totalSpent: number;
}

export interface PaginatedCustomerResult {
  items: CustomerRecord[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
```

### `src/types/sales.ts`

```typescript
export type SaleStatus = 'completed' | 'voided' | 'partially_returned' | 'returned';
export type PaymentStatus = 'paid' | 'partially_refunded' | 'refunded';
export type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'other';
export type RefundStatus = 'completed' | 'pending' | 'failed';

export interface SaleResult {
  success: boolean;
  isReplay: boolean;
  saleId: string;
  saleNumber: string;
  status: SaleStatus;
  paymentStatus: PaymentStatus;
  subtotal: number;
  orderDiscountAmount: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;
  itemsCount: number;
  createdAt: string;
  createdBy: string;
}

export interface SaleListItem { /* condensed sale row for list view */ }
export interface SaleDetail { /* full sale with items, payments, returns, refunds */ }
export interface SaleItemRecord { /* snapshotted line item */ }
export interface PaymentRecord { /* payment tender */ }
export interface ReturnRecord { /* return header */ }
export interface ReturnItemRecord { /* return line item */ }
export interface RefundRecord { /* refund with obligation tracking */ }
export interface VoidResult { /* void confirmation */ }
export interface ReturnResult { /* return confirmation */ }
export interface RefundConfirmation { /* confirmation result */ }
export interface RefundFailureResult { /* failure result */ }
export interface ReplacementRefundResult { /* replacement result */ }
export interface PaginatedSalesList { /* paginated sales */ }
export interface TaxSettings { /* org tax config */ }
```

---

## 6. Error Code Mapping (`src/lib/sales/error-codes.ts`)

```typescript
export const KNOWN_SALES_ERRORS: Record<string, { code: string; message: string }> = {
  P0040: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found.' },
  P0041: { code: 'CUSTOMER_ARCHIVED', message: 'Customer is archived.' },
  P0042: { code: 'CUSTOMER_HAS_SALES_DELETE_BLOCKED', message: 'Cannot delete customer with sales history.' },
  P0043: { code: 'SALE_EMPTY_CART', message: 'Cart must contain at least one item.' },
  P0044: { code: 'DUPLICATE_CART_PRODUCT', message: 'Duplicate product in cart.' },
  P0045: { code: 'PAYMENT_INCOMPLETE', message: 'Total payments do not cover sale amount.' },
  P0046: { code: 'PAYMENT_EXCEEDS_PAYABLE_AMOUNT', message: 'Non-cash payment exceeds payable amount.' },
  P0047: { code: 'DISCOUNT_EXCEEDS_MAXIMUM', message: 'Discount exceeds allowed maximum.' },
  P0048: { code: 'SALE_NOT_FOUND', message: 'Sale not found.' },
  P0049: { code: 'SALE_NOT_COMPLETED', message: 'Sale is not in completed status.' },
  P0050: { code: 'SALE_ALREADY_VOIDED', message: 'Sale has already been voided.' },
  P0051: { code: 'SALE_VOID_HAS_RETURNS_BLOCKED', message: 'Cannot void a sale with existing returns.' },
  P0052: { code: 'RETURN_QUANTITY_EXCEEDS_SOLD', message: 'Return quantity exceeds remaining unreturned quantity.' },
  P0053: { code: 'RETURN_REASON_REQUIRED', message: 'A return reason is required (minimum 3 characters).' },
  P0054: { code: 'REFUND_EXCEEDS_PAYABLE', message: 'Cumulative refunds exceed sale total.' },
  P0055: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'A UUID idempotency key is required.' },
  P0056: { code: 'PRODUCT_INACTIVE_RETURN_BLOCKED', message: 'Cannot restock to inventory for inactive product.' },
  P0057: { code: 'PAYMENT_REFERENCE_REQUIRED', message: 'Transaction reference required for non-cash payment.' },
  P0058: { code: 'REFUND_NOT_FOUND', message: 'Refund record not found.' },
  P0059: { code: 'EXTERNAL_REVERSAL_REFERENCE_REQUIRED', message: 'External reference required for confirmation.' },
  P0060: { code: 'DUPLICATE_RETURN_ITEM', message: 'Duplicate sale item in return.' },
  P0061: { code: 'REFUND_METHOD_EXCEEDS_ORIGINAL_TENDER', message: 'Refund exceeds original tender for this method.' },
  P0062: { code: 'REFUND_ALREADY_SETTLED', message: 'Refund is not in pending status.' },
  P0064: { code: 'REPLACEMENT_REFUND_ALREADY_EXISTS', message: 'An active replacement already exists.' },
  P0065: { code: 'REFUND_NOT_FAILED', message: 'Target refund is not in failed status.' },
  P0067: { code: 'OBLIGATION_ALREADY_COMPLETED', message: 'Reimbursement obligation already fulfilled.' },
  // Shared error codes from F001–F004
  P0001: { code: 'ORGANIZATION_INACTIVE', message: 'Organization is inactive.' },
  P0002: { code: 'MEMBERSHIP_INACTIVE', message: 'Not an active member.' },
  P0003: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' },
  P0007: { code: 'INVALID_FINANCIAL_AMOUNT', message: 'Invalid financial amount.' },
  P0011: { code: 'INSUFFICIENT_STOCK', message: 'Insufficient inventory stock.' },
  P0021: { code: 'PRODUCT_ARCHIVED_STOCK_FORBIDDEN', message: 'Product is archived.' },
  P0024: { code: 'IDEMPOTENCY_CONFLICT', message: 'Idempotency key reused with different payload.' },
  P0027: { code: 'STALE_VERSION_CONFLICT', message: 'Inventory version conflict.' },
  P0031: { code: 'PRODUCT_INACTIVE_SALE_BLOCKED', message: 'Product is inactive.' },
  '42501': { code: 'INSUFFICIENT_PERMISSIONS', message: 'Insufficient permissions.' },
  '08001': { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
};
```
