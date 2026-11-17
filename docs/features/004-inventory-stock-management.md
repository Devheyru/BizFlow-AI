# Feature 004: Inventory & Stock Management — Technical Architecture & API Reference

**Feature Branch:** `004-inventory-stock-management`  
**Status:** Implemented & Verified (Phases 1–13 Complete)  
**Governing Documents:**
- [BizFlow AI Constitution v1.1.0](../../.specify/memory/constitution.md)
- [Feature 004 Specification](../../specs/004-inventory-stock-management/spec.md)
- [Feature 004 Data Model](../../specs/004-inventory-stock-management/data-model.md)
- [Database RPC Contracts](../../specs/004-inventory-stock-management/contracts/database-rpcs.md)
- [Server Actions Contracts](../../specs/004-inventory-stock-management/contracts/server-actions.md)

---

## 1. Architecture Overview

Feature 004 implements the authoritative, tamper-proof Inventory & Stock Management subsystem for BizFlow AI. It delivers real-time stock balances, an immutable movement ledger, physical cycle-count stocktaking, low-stock alerts, and confidential acquisition cost valuation.

### 1.1 Dual-Tier Mutation Architecture
To guarantee ACID invariants and eliminate direct client tampering:
1. **Layer 1: Internal Inventory Core (`public._execute_inventory_mutation_core`)**:
   - `SECURITY DEFINER` function ungranted to all client roles (`PUBLIC`, `authenticated`, `anon`).
   - Atomically acquires row locks (`FOR UPDATE`), evaluates numeric bounds and lifecycle guards, updates `public.inventory`, appends immutable entries to `public.stock_movements`, snapshots costs into `public.stock_movement_costs`, and increments optimistic concurrency counter `version`.
   - Designed for internal reuse by the upcoming Feature 005 POS checkout transaction.
2. **Layer 2: Authenticated Public Wrapper (`public.execute_stock_movement`)**:
   - The secure public API callable by `authenticated`.
   - Enforces authentication, active organization membership, granular RBAC permissions (`inventory:receive`, `inventory:adjust`), explicit `p_quantity_semantics` validation (`P0033`), canonical RFC 8785 SHA-256 idempotency evaluation, zero-delta stocktake persistence in `public.zero_delta_stocktakes`, and delegation to Layer 1.

### 1.2 Immutable Inventory Movement Ledger (Constitution Principle II)
- Every committed balance change MUST have an associated permanent row in `public.stock_movements`.
- Direct client mutations (`INSERT`, `UPDATE`, `DELETE`) on `inventory` and `stock_movements` are unconditionally DENIED via RLS (`WITH CHECK (false)` / `USING (false)`).
- Deferrable foreign keys (`fk_movements_inventory_composite`, `fk_movements_org_product`) are set to `ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED` to enable clean multi-statement tenant purge transactions while preventing individual product deletion when movement history exists.

### 1.3 Confidential Cost Valuation Isolation
- Acquisition costs are isolated in `public.stock_movement_costs`.
- Protected by Row-Level Security requiring dual permissions: `inventory:read_valuation` AND `products:read_cost`.
- Cashiers receive zero cost or valuation figures across database queries, server actions, and UI components.

---

## 2. Database Schema & Invariants

### 2.1 Table: `public.inventory`
Stores physical on-hand stock and reorder thresholds.

```sql
CREATE TABLE public.inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    quantity NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
    reorder_point NUMERIC(14, 4),
    reorder_quantity NUMERIC(14, 4),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT uq_inventory_org_id_product UNIQUE (organization_id, product_id),
    CONSTRAINT uq_inventory_composite UNIQUE (organization_id, id, product_id),
    CONSTRAINT chk_inventory_quantity_non_negative CHECK (quantity >= 0.0000),
    CONSTRAINT chk_inventory_reorder_point_non_negative CHECK (reorder_point IS NULL OR reorder_point >= 0.0000),
    CONSTRAINT chk_inventory_reorder_quantity_positive CHECK (reorder_quantity IS NULL OR reorder_quantity > 0.0000)
);
```

### 2.2 Table: `public.stock_movements`
Immutable audit log recording every inventory transaction.

```sql
CREATE TABLE public.stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    product_id UUID NOT NULL,
    inventory_id UUID NOT NULL,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('initial', 'restock', 'adjustment', 'damage', 'loss', 'internal_use')),
    quantity_delta NUMERIC(14, 4) NOT NULL,
    reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3 AND length(reason) <= 500),
    reference_id TEXT CHECK (reference_id IS NULL OR length(trim(reference_id)) > 0),
    idempotency_key UUID NOT NULL,
    idempotency_payload_hash TEXT NOT NULL,
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
```

### 2.3 Table: `public.stock_movement_costs`
Dedicated 1:1 cost snapshot isolated from regular movement queries.

```sql
CREATE TABLE public.stock_movement_costs (
    movement_id UUID PRIMARY KEY REFERENCES public.stock_movements(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    unit_cost NUMERIC(14, 4) NOT NULL CHECK (unit_cost >= 0.0000),
    currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
```

### 2.4 Table: `public.zero_delta_stocktakes`
Audit trail for cycle-count reconciliations where physical count equaled recorded inventory (zero-delta confirmation).

```sql
CREATE TABLE public.zero_delta_stocktakes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    idempotency_key UUID NOT NULL,
    idempotency_payload_hash TEXT NOT NULL,
    target_physical_count NUMERIC(14, 4) NOT NULL,
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_zero_delta_stocktake_idempotency UNIQUE (organization_id, idempotency_key)
);
```

---

## 3. Stored Procedures & Mutation Engine

| Procedure | Security | Scope | Description |
|---|---|---|---|
| `_execute_inventory_mutation_core` | `SECURITY DEFINER` (Owner: `postgres`) | Internal only | Low-level core engine; row locks `inventory`, checks negative stock, updates balance, inserts ledger row, snapshots cost, increments `version`. |
| `execute_stock_movement` | `SECURITY DEFINER` (Owner: `postgres`) | Authenticated API | Public mutation gateway; validates permissions, checks `p_quantity_semantics` (`P0033`), advisory locking, idempotency replay, lifecycle rules, delegates to core. |
| `update_inventory_thresholds` | `SECURITY DEFINER` (Owner: `postgres`) | Authenticated API | Updates reorder point and quantity with OCC `expected_version` validation (`P0027`). |
| `get_products_with_movement_history` | `SECURITY DEFINER` (Owner: `postgres`) | Authenticated API | Retrieves distinct product IDs with movement history to accurately gate initial stock eligibility without PostgREST row truncation. |

---

## 4. Next.js Server Actions (`src/actions/inventory-actions.ts`)

- `getInventoryOverviewAction(slug, includeArchived)`: Aggregate inventory metrics; respects valuation permissions.
- `getInventoryListAction(slug, query)`: Multi-filter, sortable, paginated inventory listing with `hasInitialMovement` history detection.
- `getInventoryProductAction(slug, productId)`: Single product inventory details for summary cards and modals.
- `recordStockMovementAction(slug, payload)`: Validates Zod schema, generates canonical RFC 8785 hash, dispatches to `execute_stock_movement`, revalidates router paths.
- `updateInventoryThresholdsAction(slug, payload)`: OCC threshold update via `update_inventory_thresholds`.
- `getMovementHistoryAction(slug, query)`: Filterable audit ledger; automatically strips cost fields if caller lacks dual permissions.

---

## 5. Granular RBAC Permissions Catalog

| Permission | Description | Assigned Roles |
|---|---|---|
| `inventory:read` | View inventory table, stock balances, overview metrics | Owner, Admin, Manager, Cashier |
| `inventory:receive` | Receive inbound deliveries (`restock`) and record `initial` stock | Owner, Admin, Manager |
| `inventory:adjust` | Submit cycle-count stocktakes, damage, loss, internal use, thresholds | Owner, Admin, Manager |
| `inventory:history` | View chronological movement audit ledger | Owner, Admin, Manager |
| `inventory:read_valuation` | View inventory monetary valuation (requires `products:read_cost`) | Owner, Admin, Manager |

---

## 6. Integration Contract for Feature 005 (POS Sales & Returns)

When Feature 005 executes a sale:
1. The POS sales stored procedure (`public.execute_sale`) runs as `SECURITY DEFINER`.
2. It acquires product locks in ascending `product_id` order to eliminate ABBA deadlocks.
3. For each line item, it directly invokes `public._execute_inventory_mutation_core(p_org_id, item.product_id, 'sale', -item.quantity, ...)` within the same PostgreSQL transaction.
4. Stock reduction and sale record insertion are guaranteed atomic: if any item has insufficient stock (`INSUFFICIENT_STOCK`, `P0011`), the entire sale transaction rolls back cleanly.
