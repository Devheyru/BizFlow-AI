# Database RPC Contracts: Feature 005 — Customers & Sales

**Branch**: `005-customers-sales` | **Date**: 2026-11-17 | **Spec**: [spec.md](../spec.md)

---

## Common Conventions

- **Owner**: All RPCs are `OWNER TO postgres`.
- **Security**: All RPCs are `SECURITY DEFINER` with `SET search_path = pg_catalog, public, pg_temp`.
- **Grants**: `REVOKE ALL FROM PUBLIC, anon, service_role; GRANT EXECUTE TO authenticated`.
- **Return type**: All RPCs return `JSONB`.
- **Idempotency**: Advisory lock pattern — `pg_advisory_xact_lock(hashtext(org::text), hashtext(key::text))`.

---

## 1. `public.execute_sale`

**Purpose**: Atomic multi-item POS checkout with inventory deduction, tax calculation, and payment recording.

### Signature

```sql
public.execute_sale(
    p_org_id                UUID,
    p_customer_id           UUID,          -- NULL for walk-in guests
    p_items                 JSONB,         -- [{ product_id, quantity, line_discount_amount, expected_version? }]
    p_payments              JSONB,         -- [{ payment_method, amount, amount_tendered?, change_due?, reference_no? }]
    p_order_discount_amount NUMERIC,       -- 0.0000 if no discount
    p_idempotency_key       UUID,          -- Mandatory client-generated UUID
    p_notes                 TEXT DEFAULT NULL
) RETURNS JSONB
```

### Preconditions

| # | Check | Error |
|---|---|---|
| 1 | `auth.uid() IS NOT NULL` | `08001 UNAUTHENTICATED` |
| 2 | Caller is active member | `P0002 MEMBERSHIP_INACTIVE` |
| 3 | Caller has `sales:create` | `42501 INSUFFICIENT_PERMISSIONS` |
| 4 | `p_idempotency_key IS NOT NULL` | `P0055 IDEMPOTENCY_KEY_REQUIRED` |
| 5 | Idempotency replay (hash match) | Return stored sale (`is_replay = true`) |
| 6 | Idempotency conflict (hash mismatch) | `P0024 IDEMPOTENCY_CONFLICT` |
| 7 | `jsonb_array_length(p_items) > 0` | `P0043 SALE_EMPTY_CART` |
| 8 | No duplicate `product_id` in items | `P0044 DUPLICATE_CART_PRODUCT` |
| 9 | Customer exists (if provided) | `P0040 CUSTOMER_NOT_FOUND` |
| 10 | Customer not archived (if provided) | `P0041 CUSTOMER_ARCHIVED` |
| 11 | Products active, not archived | `P0031` / `P0021` |
| 12 | Quantity > 0, within limits | `P0012` / `P0028` |
| 13 | UOM precision (discrete = integer) | `P0015` / `P0016` |
| 14 | Line discount ≤ line gross | `P0047 DISCOUNT_EXCEEDS_MAXIMUM` |
| 15 | Order discount ≤ subtotal | `P0047 DISCOUNT_EXCEEDS_MAXIMUM` |
| 16 | Payments sum = total_amount | `P0045` / `P0046` |
| 17 | Non-cash: reference required | `P0057 PAYMENT_REFERENCE_REQUIRED` |
| 18 | Sufficient stock per item | `P0011 INSUFFICIENT_STOCK` |

### Return Shape

```json
{
  "success": true,
  "is_replay": false,
  "sale_id": "uuid",
  "sale_number": "SAL-20261117-0001",
  "status": "completed",
  "payment_status": "paid",
  "subtotal": "150.0000",
  "order_discount_amount": "0.0000",
  "tax_amount": "15.0000",
  "total_amount": "165.0000",
  "currency": "USD",
  "items_count": 3,
  "created_at": "2026-11-17T...",
  "created_by": "uuid"
}
```

### Canonical Hash Construction

Items sorted by `product_id ASC`. Payments sorted by `payment_method ASC`, `amount ASC`, `amount_tendered ASC`, `change_due ASC`, `reference_no ASC NULLS LAST`. All numeric fields formatted via `to_char(..., 'FM9999999990.0000')`. Optional `reference_no` normalized via `NULLIF(trim(...), '')`.

---

## 2. `public.void_sale`

**Purpose**: Cancel a completed sale, restore inventory, and create reversal refund records.

### Signature

```sql
public.void_sale(
    p_org_id               UUID,
    p_sale_id              UUID,
    p_void_reason          TEXT,
    p_idempotency_key      UUID,
    p_reversal_references  JSONB DEFAULT NULL  -- [{ payment_id, reference_no }]
) RETURNS JSONB
```

### Preconditions

| # | Check | Error |
|---|---|---|
| 1 | Auth + membership | `08001` / `P0002` |
| 2 | Caller has `sales:void` | `42501` |
| 3 | `p_idempotency_key IS NOT NULL` | `P0055` |
| 4 | Idempotency replay/conflict | replay / `P0024` |
| 5 | Sale exists | `P0048 SALE_NOT_FOUND` |
| 6 | Sale not already voided | `P0050 SALE_ALREADY_VOIDED` |
| 7 | Sale status = `completed` | `P0049 SALE_NOT_COMPLETED` |
| 8 | No existing returns | `P0051 SALE_VOID_HAS_RETURNS_BLOCKED` |

### Key Behavior

- Acquires ascending `product_id` inventory locks for deadlock prevention
- Calls `_execute_inventory_mutation_core` per item with `movement_type = 'return'`, `reference_id = 'void:{sale_id}'`
- Creates one `refunds` row per original payment: `'completed'` for cash, `'pending'` for external methods
- Sets `obligation_refund_id = id` (self-referencing) on each refund; constraint `fk_refunds_org_obligation` is `DEFERRABLE INITIALLY DEFERRED` so validation validates at transaction COMMIT
- Uses F005-039 reconciled calculation for `payment_status`
- External reversal references are trace data only (F005-038), never proof of reimbursement

---

## 3. `public.execute_sale_return`

**Purpose**: Process line-item returns with optional inventory restock and refund disbursement.

### Signature

```sql
public.execute_sale_return(
    p_org_id          UUID,
    p_sale_id         UUID,
    p_return_items    JSONB,    -- [{ sale_item_id, quantity, restock_to_inventory }]
    p_refund_method   TEXT,     -- 'cash', 'card', 'bank_transfer', 'other'
    p_reason          TEXT,
    p_idempotency_key UUID,
    p_reference_no    TEXT DEFAULT NULL
) RETURNS JSONB
```

### Preconditions

| # | Check | Error |
|---|---|---|
| 1 | Auth + membership | `08001` / `P0002` |
| 2 | Caller has `returns:create` | `42501` |
| 3 | `p_idempotency_key IS NOT NULL` | `P0055` |
| 4 | Idempotency replay/conflict | replay / `P0024` |
| 5 | Reason length 3–255 chars | `P0053 RETURN_REASON_REQUIRED` |
| 6 | No duplicate `sale_item_id` | `P0060 DUPLICATE_RETURN_ITEM` |
| 7 | Sale exists | `P0048` |
| 8 | Sale not voided | `P0050` |
| 9 | Sale completed or partially returned | `P0049` |
| 10 | Return qty ≤ remaining unreturned qty | `P0052 RETURN_QUANTITY_EXCEEDS_SOLD` |
| 11 | Product active if restock=true | `P0056 PRODUCT_INACTIVE_RETURN_BLOCKED` |
| 12 | Non-cash refund ≤ original tender for method | `P0061` |
| 13 | Cumulative refunds ≤ sale total | `P0054 REFUND_EXCEEDS_PAYABLE` |

### Key Behavior

- Generates `RET-YYYYMMDD-XXXX` via `sale_sequences`
- Proportional refund: `v_item_refund = round((total_price / quantity) * ret_qty, decimals)`. Final remaining quantity absorbs rounding residual.
- Calls `_execute_inventory_mutation_core` with `movement_type = 'return'`, `reference_id = 'return:{return_id}'` for restock items
- Creates single `refunds` row: `'completed'` for cash, `'pending'` for external
- Sets `obligation_refund_id = id` (self-referencing); constraint `fk_refunds_org_obligation` is `DEFERRABLE INITIALLY DEFERRED` so validation validates at transaction COMMIT
- Cash refunds permitted regardless of original payment method
- Uses F005-039 reconciled calculation for sale status/payment_status update

---

## 4. `public.confirm_refund_reimbursement`

**Purpose**: Confirm external refund disbursement completion with idempotency protection.

### Signature

```sql
public.confirm_refund_reimbursement(
    p_org_id             UUID,
    p_refund_id          UUID,
    p_external_reference TEXT,
    p_idempotency_key    UUID
) RETURNS JSONB
```

### Preconditions

| # | Check | Error |
|---|---|---|
| 1 | Auth + membership | `08001` / `P0002` |
| 2 | Caller has `refunds:read` AND (`sales:void` OR `returns:create`) | `42501` |
| 3 | `p_idempotency_key IS NOT NULL` | `P0055` |
| 4 | Refund exists | `P0058 REFUND_NOT_FOUND` |
| 5 | **Case C**: Cross-refund key conflict | `P0024 IDEMPOTENCY_CONFLICT` |
| 6 | **Case A**: Same key+refund, same hash → replay | Return stored (`is_replay = true`) |
| 7 | **Case B**: Same key+refund, different hash | `P0024 IDEMPOTENCY_CONFLICT` |
| 8 | **Case D**: Refund already settled | `P0062 REFUND_ALREADY_SETTLED` |
| 9 | External reference required | `P0059 EXTERNAL_REVERSAL_REFERENCE_REQUIRED` |

### Key Behavior (F005-046)

- Advisory lock serializes concurrent confirmations (Case E)
- Cross-refund key collision checked BEFORE row-level replay (Case C) to prevent raw 23505
- Transitions refund `status` → `'completed'`, sets `reference_no`, stores confirmation idempotency key/hash
- Recalculates sale `payment_status` using F005-039 reconciled formula

---

## 5. `public.record_refund_failure`

**Purpose**: Mark a pending external refund as failed, enabling replacement workflow.

### Signature

```sql
public.record_refund_failure(
    p_org_id         UUID,
    p_refund_id      UUID,
    p_failure_reason TEXT
) RETURNS JSONB
```

### Preconditions

| # | Check | Error |
|---|---|---|
| 1 | Auth + membership | `08001` / `P0002` |
| 2 | Caller has `sales:void` OR `returns:create` | `42501` |
| 3 | Failure reason length ≥ 3 chars | `P0053` |
| 4 | Refund exists | `P0058` |
| 5 | Refund status = `pending` | `P0062 REFUND_ALREADY_SETTLED` |

### Key Behavior

- Transitions refund `status` → `'failed'`, appends failure reason
- Failed refunds are NEVER counted as completed reimbursement (F005-039)
- Recalculates sale `payment_status` using reconciled formula
- Does NOT create inventory movements or return items

---

## 6. `public.issue_replacement_refund`

**Purpose**: Issue a replacement reimbursement for a failed refund with obligation tracking.

### Signature

```sql
public.issue_replacement_refund(
    p_org_id           UUID,
    p_failed_refund_id UUID,
    p_refund_method    TEXT,          -- 'cash', 'card', 'bank_transfer', 'other'
    p_idempotency_key  UUID,
    p_reference_no     TEXT DEFAULT NULL,
    p_notes            TEXT DEFAULT NULL
) RETURNS JSONB
```

### Preconditions

| # | Check | Error |
|---|---|---|
| 1 | Auth + membership | `08001` / `P0002` |
| 2 | Caller has `sales:void` OR `returns:create` | `42501` |
| 3 | `p_idempotency_key IS NOT NULL` | `P0055` |
| 4 | Idempotency replay/conflict | replay / `P0024` |
| 5 | Failed refund exists | `P0058` |
| 6 | Failed refund status = `failed` | `P0065 REFUND_NOT_FAILED` |
| 7 | No active attempt for obligation (pending) | `P0064 REPLACEMENT_REFUND_ALREADY_EXISTS` |
| 8 | No completed attempt for obligation | `P0067 OBLIGATION_ALREADY_COMPLETED` |
| 9 | Non-cash: method ≤ original tender ceiling | `P0061` |
| 10 | Cumulative unfailed ≤ sale total | `P0054` |

### Key Behavior (F005-044)

- **Unconditional obligation advisory lock**: `pg_advisory_xact_lock(hashtext(org::text), hashtext(obligation_refund_id::text))` — acquired for EVERY replacement, including requests targeting the original refund
- Sets `parent_refund_id = p_failed_refund_id` (immediate parent)
- Sets `obligation_refund_id = v_failed_refund.obligation_refund_id` (inherited root)
- Cash replacements → `'completed'`; external → `'pending'`
- Does NOT call inventory mutation engine (stock already restored during original void/return)
- Uses F005-039 reconciled calculation for sale `payment_status`

---

## 7. `public.create_customer`

### Signature

```sql
public.create_customer(
    p_org_id UUID,
    p_name   TEXT,
    p_phone  TEXT DEFAULT NULL,
    p_email  TEXT DEFAULT NULL,
    p_notes  TEXT DEFAULT NULL
) RETURNS JSONB
```

### Preconditions

| # | Check | Error |
|---|---|---|
| 1 | Auth + membership | `08001` / `P0002` |
| 2 | Caller has `customers:create` | `42501` |
| 3 | Name 1–255 chars (trimmed) | `23514 CHECK_VIOLATION` |
| 4 | Phone E.164 format (if provided) | `23514` |
| 5 | Email valid format (if provided) | `23514` |
| 6 | Phone unique among active customers | `23505 CUSTOMER_PHONE_EXISTS` |
| 7 | Email unique among active customers | `23505 CUSTOMER_EMAIL_EXISTS` |

### Key Behavior

- Normalizes: `email → lower(trim(email))`, `phone → trim(phone)`, `name → trim(name)`
- Inserts with `status = 'active'`
- Returns new customer JSON

---

## 8. `public.update_customer`

### Signature

```sql
public.update_customer(
    p_org_id       UUID,
    p_customer_id  UUID,
    p_name         TEXT,
    p_phone        TEXT DEFAULT NULL,
    p_email        TEXT DEFAULT NULL,
    p_notes        TEXT DEFAULT NULL
) RETURNS JSONB
```

### Preconditions

| # | Check | Error |
|---|---|---|
| 1 | Auth + membership | `08001` / `P0002` |
| 2 | Caller has `customers:update` | `42501` |
| 3 | Customer exists in org | `P0040 CUSTOMER_NOT_FOUND` |
| 4 | Customer not archived | `P0041 CUSTOMER_ARCHIVED` |
| 5 | Phone/email collision with other active | `23505` |

---

## 9. `public.archive_customer`

### Signature

```sql
public.archive_customer(
    p_org_id      UUID,
    p_customer_id UUID
) RETURNS JSONB
```

### Preconditions

| # | Check | Error |
|---|---|---|
| 1 | Auth + membership | `08001` / `P0002` |
| 2 | Caller has `customers:archive` | `42501` |
| 3 | Customer exists | `P0040` |
| 4 | Already archived → idempotent success | — |

### Key Behavior

- Sets `status = 'archived'`, releases phone/email partial uniqueness
- Hard delete blocked by composite FK from `sales.customer_id` → `P0042`

---

## 10. `public.update_tax_settings`

### Signature

```sql
public.update_tax_settings(
    p_org_id            UUID,
    p_tax_name          TEXT,
    p_default_tax_rate  NUMERIC,
    p_is_tax_inclusive  BOOLEAN
) RETURNS JSONB
```

### Preconditions

| # | Check | Error |
|---|---|---|
| 1 | Auth + membership | `08001` / `P0002` |
| 2 | Caller is Owner/Admin or has `tax_settings:update` | `42501` |
| 3 | Tax name ≥ 1 char | `23514` |
| 4 | Tax rate 0–100 | `23514` |

### Key Behavior

- Upsert via `INSERT ... ON CONFLICT (organization_id) DO UPDATE`
- Historical sales retain snapshotted parameters; changes apply to future checkouts only

---

## 11. `public.get_sale_detail`

**Purpose**: Retrieve full sale details (header, line items, payments, returns, refunds) with database-enforced cost column protection.

### Signature

```sql
public.get_sale_detail(
    p_org_id  UUID,
    p_sale_id UUID
) RETURNS JSONB
```

### Security & Privileges

- **Owner**: `postgres`
- **Security**: `SECURITY DEFINER`
- **Search Path**: `SET search_path = pg_catalog, public, pg_temp`
- **Grants**: `REVOKE ALL ON FUNCTION public.get_sale_detail(UUID, UUID) FROM PUBLIC, anon, service_role;`
- `GRANT EXECUTE ON FUNCTION public.get_sale_detail(UUID, UUID) TO authenticated;`

### Preconditions

| # | Check | Error |
|---|---|---|
| 1 | `auth.uid() IS NOT NULL` | `08001 UNAUTHENTICATED` |
| 2 | Caller is active member in org (`is_org_member(p_org_id, auth.uid())`) | `P0002 MEMBERSHIP_INACTIVE` |
| 3 | Caller has `sales:read` (`check_user_permission(p_org_id, auth.uid(), 'sales:read')`) | `42501 INSUFFICIENT_PERMISSIONS` |
| 4 | Sale exists and belongs to org (`organization_id = p_org_id AND id = p_sale_id`) | `P0048 SALE_NOT_FOUND` |

### Database-Enforced Cost Protection Architecture

1. **Direct PostgREST Denial**: Table-level SELECT on `public.sale_items` is revoked. Direct column-level SELECT is granted to `authenticated` only on safe non-cost columns (`id`, `organization_id`, `sale_id`, `product_id`, `quantity`, `unit_price`, `line_discount_amount`, `allocated_order_disc`, `taxable_amount`, `allocated_tax_amount`, `total_price`, `movement_id`, `created_at`). Any direct PostgREST request querying `unit_cost` (e.g. `GET /sale_items?select=unit_cost` or `GET /sale_items?select=*`) is rejected by PostgreSQL at the parser boundary with `42501 permission_denied for column unit_cost`.
2. **Protected RPC Gateway**: `get_sale_detail` runs as `SECURITY DEFINER` (executing as table owner `postgres`), allowing it to read `sale_items.unit_cost`.
3. **Server-Side Dual-Permission Evaluation**: Inside `get_sale_detail`, caller authorization for cost visibility is strictly evaluated:
   ```sql
   v_can_view_cost := check_user_permission(p_org_id, auth.uid(), 'inventory:read_valuation')
                  AND check_user_permission(p_org_id, auth.uid(), 'products:read_cost');
   ```
4. **Conditional Projection**:
   - When `v_can_view_cost` is **TRUE** (caller has BOTH permissions): `unit_cost` is projected with its stored numerical value.
   - When `v_can_view_cost` is **FALSE** (caller lacks either or both permissions, including cashiers, valuation-only, or product-cost-only): `unit_cost` is strictly projected as `NULL`.

### Return Shape

```json
{
  "sale": {
    "id": "uuid",
    "organization_id": "uuid",
    "sale_number": "SAL-20261117-0001",
    "customer_id": "uuid | null",
    "status": "completed",
    "payment_status": "paid",
    "subtotal": "150.0000",
    "order_discount_amount": "0.0000",
    "taxable_amount": "150.0000",
    "tax_amount": "15.0000",
    "total_amount": "165.0000",
    "currency": "USD",
    "is_tax_inclusive": false,
    "tax_rate": "10.0000",
    "tax_name": "Standard VAT",
    "notes": null,
    "created_at": "2026-11-17T...",
    "created_by": "uuid"
  },
  "customer": {
    "id": "uuid",
    "name": "Jane Doe",
    "phone": "+1234567890",
    "email": "jane@example.com"
  },
  "items": [
    {
      "id": "uuid",
      "product_id": "uuid",
      "product_name": "Widget A",
      "sku": "WGT-001",
      "quantity": "2.0000",
      "unit_price": "75.0000",
      "unit_cost": "45.0000",
      "line_discount_amount": "0.0000",
      "allocated_order_disc": "0.0000",
      "taxable_amount": "150.0000",
      "allocated_tax_amount": "15.0000",
      "total_price": "165.0000",
      "movement_id": "uuid"
    }
  ],
  "payments": [
    {
      "id": "uuid",
      "payment_method": "card",
      "amount": "165.0000",
      "amount_tendered": "165.0000",
      "change_due": "0.0000",
      "reference_no": "AUTH-123456",
      "created_at": "2026-11-17T..."
    }
  ],
  "returns": [],
  "refunds": []
}
```
*(Note: When `v_can_view_cost` is false, `"unit_cost"` in the `items` array is `null`)*
