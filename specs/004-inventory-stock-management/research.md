# Technical Research: Feature 004 — Inventory & Stock Management

**Feature Branch**: `004-inventory-stock-management`  
**Date**: 2026-11-10  
**Status**: Completed & Authoritative  
**Governing Documents**:
- [BizFlow AI Constitution v1.1.0](.specify/memory/constitution.md)
- [Feature 004 Specification](specs/004-inventory-stock-management/spec.md)
- [Feature 004 Specification Checklist](specs/004-inventory-stock-management/checklists/requirements.md)

---

## 1. Research 1: Dual-Tier Mutation Engine vs. Direct Client DML

### Context & Problem
In traditional CRUD architectures, inventory balance adjustments issue direct SQL `UPDATE inventory SET quantity = ...` statements from client applications or server actions. In retail inventory systems, this causes severe issues:
1. Lost updates and race conditions during concurrent transactions (e.g. sales, restocks, stocktakes).
2. Historical opacity: unable to reconstruct who changed stock, when, why, or by how much.
3. Inventory shrinkage concealment: shrinkage and theft can be hidden by silently editing balance rows.
4. Broken audit trails and financial reporting discrepancies.

### Decision
Implement an authoritative dual-tier PostgreSQL stored function architecture:
- **Layer 1: Internal Inventory Core (`public._execute_inventory_mutation_core`)**:
  - `SECURITY DEFINER`, owned by `postgres`, `SET search_path = pg_catalog, public, pg_temp`.
  - Strictly ungranted to `PUBLIC`, `authenticated`, and `anon` (`REVOKE ALL`).
  - Acquires row-level lock (`FOR UPDATE`) on `public.inventory`.
  - Atomically validates boundaries, applies signed deltas, updates `public.inventory`, writes immutable records to `public.stock_movements`, snapshots costs into `public.stock_movement_costs`, and increments optimistic concurrency counter `version`.
- **Layer 2: Authenticated Public Wrapper (`public.execute_stock_movement`)**:
  - `SECURITY DEFINER`, owned by `postgres`, fixed `search_path`.
  - Granted exclusively to `authenticated`; revoked from `anon, PUBLIC`.
  - Authenticates caller session (`auth.uid()`), verifies tenant membership and status, evaluates granular permissions (`inventory:receive`, `inventory:adjust`), performs explicit PL/pgSQL validation on movement types and `p_quantity_semantics`, binds deterministic creator identity, computes canonical idempotency hash, and delegates to Layer 1.

### Rationale
1. **Constitution Principle II Compliance**: Mandates atomic transactions and an immutable movement ledger.
2. **PostgreSQL Row-Level Concurrency**: Explicit `FOR UPDATE` locking inside the stored procedure serializes mutations on individual product balances, preventing race conditions.
3. **Future Feature 005 Sales Integration**: Allows Feature 005 POS checkout procedures to invoke Layer 1 directly within the sale transaction, eliminating external dependencies or message queues.

### Alternatives Considered
- *Direct Table Updates with Trigger-Based Ledger*: Discarded because triggers cannot easily enforce caller permission checks, idempotency replay caching, or custom client parameter binding (e.g. reason, reference ID, target count).
- *Application-Level Multi-Query Transactions (Prisma / Supabase JS)*: Discarded because client network disconnects mid-transaction leave hanging locks or uncommitted partial state, and cannot guarantee database-level isolation against rogue clients.

---

## 2. Research 2: Minimal Zero-Delta Stocktake Idempotency Persistence

### Context & Problem
During retail physical stocktakes (cycle counts), a user counts physical shelf inventory and enters the counted number (`target_physical_count`).
When `target_physical_count = quantity_before`:
- The physical count perfectly matches the recorded stock (`quantity_delta = 0.0000`).
- The business specification and constraint `chk_movement_delta_zero_rule` strictly prohibit inserting a zero-delta movement into `public.stock_movements` (which is reserved exclusively for the one-time initial stock initialization exception).
- However, if the client sends an `idempotency_key` and retries due to a network timeout or UI double-click:
  1. If no persistent record exists, the system cannot verify whether the request was previously processed.
  2. If an intervening sale altered the stock balance before the retry, recalculating the delta against the updated balance would apply an erroneous non-zero adjustment, corrupting inventory.
  3. Replay authorization and key conflict checks cannot be enforced without persistence.

### Decision
Introduce a minimal, dedicated persistence table: `public.zero_delta_stocktakes`.
- **Schema**:
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE`
  - `product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE`
  - `idempotency_key UUID NOT NULL`
  - `idempotency_payload_hash TEXT NOT NULL`
  - `target_physical_count NUMERIC(14,4) NOT NULL`
  - `created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT`
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()`
  - `CONSTRAINT uq_zero_delta_stocktake_idempotency UNIQUE (organization_id, idempotency_key)`
- **Idempotency Lifecycle & Concurrency Serialization**:
  - In `execute_stock_movement`, when `p_idempotency_key` is present, the procedure immediately acquires a transaction-scoped advisory lock derived from the tenant and key: `pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_idempotency_key::text))`.
  - While holding the advisory lock, it queries BOTH `stock_movements` and `zero_delta_stocktakes` to verify whether the key was already committed.
  - **Concurrency & Visibility Guarantees**:
    - Under PostgreSQL's default `READ COMMITTED` isolation level, statement-level snapshotting ensures that when an unblocked transaction queries the tables after waiting on the lock, it immediately observes any newly committed rows.
    - 32-bit hash collisions between distinct keys or tenants result strictly in benign serialization contention (a brief wait), never in data leakage or false rejections, because all subsequent SELECTs filter explicitly by `organization_id` and `idempotency_key`.
    - Table unique constraints (`uq_movements_org_idempotency`, `uq_zero_delta_stocktake_idempotency`) act as the ultimate engine-level safeguard.
  - When `p_quantity_semantics = 'target_physical_count'` yields `quantity_delta = 0.0000`, the function inserts an audit row into `zero_delta_stocktakes` (persisting `target_physical_count`) and returns `{ status: "matched", is_replay: false, matched_quantity: "20.0000", current_stock: "20.0000", quantity_delta: "0.0000" }`.
  - Upon retry with the same key and payload hash, it detects the existing row, verifies permission, and returns `{ status: "matched", is_replay: true, matched_quantity: "20.0000", current_stock: "15.0000", quantity_delta: "0.0000" }`, separating the original matched count from the live current balance.

### Rationale
1. **Preserves Ledger Invariants**: Keeps `public.stock_movements` 100% clean of redundant zero-delta entries while satisfying constraint `chk_movement_delta_zero_rule`.
2. **Guarantees Replay Consistency**: Ensures subsequent retries never recalculate delta against changed inventory.
3. **Minimal Overhead**: Zero foreign keys to movement ledger; self-contained within the tenant boundary.

### Alternatives Considered
- *Loosening `chk_movement_delta_zero_rule` to Allow Zero-Delta Movements*: Discarded because it pollutes historical movement logs with no-op noise, inflating database storage and misleading inventory audit reports.
- *Redis / In-Memory Cache for Idempotency*: Discarded because it introduces external infrastructure dependencies, lacks ACID transactional binding with PostgreSQL, and fails to persist across container restarts.

---

## 3. Research 3: Deterministic Canonical Payload Hashing & Semantic Discriminators

### Context & Problem
Retail staff can adjust stock using two fundamentally distinct mental models:
1. **Target Physical Count Reconciliations**: "There are currently 45 bottles on the shelf." (`quantity_semantics = 'target_physical_count'`).
2. **Quantity Delta Adjustments**: "Add 45 bottles to the shelf from backroom." (`quantity_semantics = 'quantity_delta'`).

If the canonical idempotency hash evaluated only `{ quantity, movement_type, organization_id, product_id, reason, reference_id }`, both operations would produce identical canonical strings and identical SHA-256 hashes (`e.g. 45.0000, adjustment, ...`).
If a client submitted both requests with the same idempotency key or retried after stock shifted, the server would be unable to distinguish the client's true operational intent.

### Decision
Include an explicit `quantity_semantics` field in the canonical JSON payload, serialized in strict lexicographical order:
1. Canonical Fields: `canonical_quantity`, `movement_type`, `organization_id`, `product_id`, `quantity_semantics`, `reason`, `reference_id`.
2. Lexicographical Key Sorting: Standardized across both TypeScript server action and PostgreSQL stored procedure.
3. Safe String Encoding: Both TypeScript (`JSON.stringify`) and PostgreSQL (`to_json(trim(...))::text`) enforce RFC 8259 string escaping for quotation marks, backslashes, and control characters, preventing JSON injection.
4. Fixed Regression Fixtures:
   - **Target-Count Reconciliation**:
     `{"canonical_quantity":"45.0000","movement_type":"adjustment","organization_id":"a0000000-0000-0000-0000-000000000001","product_id":"b0000000-0000-0000-0000-000000000002","quantity_semantics":"target_physical_count","reason":"Quarterly stocktake","reference_id":null}`  
     SHA-256: `822dbc7818bb44882daff5f29396366a9d5f9eb571938eb36fd60270a5f108a6`
   - **Quantity Delta Adjustment**:
     `{"canonical_quantity":"45.0000","movement_type":"adjustment","organization_id":"a0000000-0000-0000-0000-000000000001","product_id":"b0000000-0000-0000-0000-000000000002","quantity_semantics":"quantity_delta","reason":"Quarterly stocktake","reference_id":null}`  
     SHA-256: `7e2b11299620db0e9531afe7b999c1d1096b39b7f860d67be5efc531eed9f707`
   - **String Escaping with Quotation Marks & Backslashes**:
     `{"canonical_quantity":"12.5000","movement_type":"damage","organization_id":"a0000000-0000-0000-0000-000000000001","product_id":"b0000000-0000-0000-0000-000000000002","quantity_semantics":"quantity_delta","reason":"Broken \"glass\" & \\backslashes\\","reference_id":"REF \"A-12\\34\""}`  
     SHA-256: `596a760972b11657cebb84a84a5b4541252b3f5c1d1d781a00c4686aeb7c0a3f`

### Rationale
- Mathematical uniqueness guarantees zero hash collision between target counts and delta adjustments.
- Retries carrying identical target counts return the original committed adjustment without recomputing delta.

### Alternatives Considered
- *Using different `movement_type` values (e.g. `stocktake` vs `adjustment`)*: Discarded because `stock_movements.movement_type` is constrained to the 8 standard enum values (`initial`, `restock`, `adjustment`, `damage`, `loss`, `internal_use`, `sale`, `return`) to ensure reporting consistency across all downstream analytics.

---

## 4. Research 4: Sensitive Unit Cost Isolation at the Database Boundary

### Context & Problem
Retail store employees (cashiers, stock clerks) have legitimate permissions to view stock balances (`inventory:read`) and audit movement logs (`inventory:history`). However, supplier acquisition costs and gross profit margins are sensitive commercial secrets that must be restricted to Owners, Admins, and Managers holding `inventory:read_valuation` AND `products:read_cost`.
PostgreSQL Row-Level Security (RLS) filters rows, not columns. If `unit_cost` were a column on `public.stock_movements`, any user with `SELECT` privilege on `stock_movements` could query `supabase.from('stock_movements').select('unit_cost')` directly.

### Decision
Isolate historical movement unit costs in a dedicated 1:1 satellite table: `public.stock_movement_costs`.
- **Table Definition**:
  - `movement_id UUID PRIMARY KEY REFERENCES public.stock_movements(id) ON DELETE CASCADE`
  - `organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE`
  - `unit_cost NUMERIC(14,4) NOT NULL CHECK (unit_cost >= 0.0000)`
  - `currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$')`
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()`
- **Security & RLS**:
  - `ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;`
  - Single permissive SELECT policy:
    ```sql
    CREATE POLICY "stock_movement_costs_select" ON public.stock_movement_costs
        FOR SELECT TO authenticated
        USING (
            public.check_user_permission(organization_id, auth.uid(), 'inventory:read_valuation')
            AND
            public.check_user_permission(organization_id, auth.uid(), 'products:read_cost')
        );
    ```
  - Direct `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` revoked from all client roles. Populated exclusively inside Layer 1 `_execute_inventory_mutation_core` via snapshot from `public.product_costs`.

### Rationale
- Completely eliminates column-level leakage risks at the database boundary without relying on Next.js server projection.
- Reconciles Feature 003's `products:read_cost` policy with Feature 004's `inventory:read_valuation` permission.
- Native compatibility with Supabase client relations (`stock_movements(..., stock_movement_costs(...))`). Unauthorized callers receive `null` for the joined cost record.

### Alternatives Considered
- *PostgreSQL Column-Level Grants (`GRANT SELECT (id, ...) ON stock_movements`)*: Discarded because Supabase client APIs and PostgREST generate `SELECT *` or composite queries that fail catastrophically when column-level permissions are missing.
- *Controlled Database View (`v_stock_movements_public`)*: Discarded because views with security definer rules introduce performance overhead and complex RLS bypass vectors.

---

## 5. Research 5: Multi-Product Concurrency & Lock Ordering (ABBA Deadlock Prevention)

### Context & Problem
Retail store operations frequently mutate inventory for multiple products concurrently:
- Feature 005 POS sales checking out multi-item baskets.
- Purchase order bulk receiving (`restock`).
- Multi-item physical stocktaking.
If Transaction 1 locks Product A then Product B, while Transaction 2 locks Product B then Product A, PostgreSQL detects a cyclic dependency and aborts one transaction with deadlock error (`40P01`).

### Decision
Mandate deterministic ascending `product_id` lock ordering:
1. Any procedure or server action accepting multiple product mutations MUST sort the unique product IDs in ascending alphabetical order (`ORDER BY product_id ASC`) prior to acquiring row locks (`SELECT ... FOR UPDATE`).
2. Single-product procedures (`execute_stock_movement`) inherently follow this rule.
3. Feature 005 integration contract explicitly documents this requirement for its bulk POS checkout wrapper.

### Rationale
- Standard computer science invariant: acquiring shared locks in a globally deterministic order mathematically eliminates cyclic wait-for graphs and prevents deadlocks.

---

## 6. Research 6: Tripartite Composite Foreign Key Deferrability for Atomic Tenant Offboarding

### Context & Problem
Tenant offboarding requires deleting an entire organization and all its data.
`public.stock_movements` has composite foreign keys:
1. `(organization_id, inventory_id, product_id) REFERENCES public.inventory(organization_id, id, product_id)`
2. `(organization_id, product_id) REFERENCES public.products(organization_id, id)`

If these foreign keys are enforced immediately (`NOT DEFERRABLE`), deleting an organization via multi-statement scripts or cascading triggers causes foreign-key order violations depending on the sequence in which PostgreSQL purges rows.
Conversely, if an individual product is deleted while historical stock movements exist, the audit ledger must be preserved.

### Decision
Declare both composite foreign keys as:
`ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED`
- **Tenant Deletion**: PostgreSQL defers constraint checking to transaction `COMMIT`. When the entire organization is purged, all referencing and referenced rows are removed simultaneously, allowing commit to succeed cleanly.
- **Product Deletion**: If a user attempts to delete an individual product while movement history exists (`DELETE FROM products WHERE id = $1`), the deferred check fires at `COMMIT`. Because referencing rows remain in `stock_movements`, PostgreSQL aborts the transaction with `foreign_key_violation` (`23503`), strictly protecting ledger integrity.
- **Tripartite Guarantee**: The composite key `(organization_id, inventory_id, product_id)` mathematically guarantees that every movement row is strictly co-located within the identical tenant and bound to the exact materialized inventory anchor.

---

## 7. Research 7: UI Filtering & Status Priority Architecture

### Context & Problem
Store operators need intuitive, responsive inventory filtering across hundreds or thousands of products.
Requirements:
1. Real-time metric tiles: Total Tracked Products, In-Stock, Low-Stock, Out-of-Stock, Total Valuation.
2. Filter by search query (Name/SKU/Barcode), Category, Stock Status (`all`, `in_stock`, `low_stock`, `out_of_stock`), and Product Lifecycle Status (`active`, `inactive`, `archived`).
3. Archived products must be excluded by default from overview metrics and tables, and revealed only when the user explicitly toggles **"Include Archived"**.
4. Inactive products must be included by default in overview metrics (as they represent physical store assets).
5. Deterministic stock status sort order: Out-of-Stock (priority 1), Low-Stock (priority 2), In-Stock (priority 3).

### Decision
Implement server-side query orchestration in Next.js Server Actions:
- Computes aggregate metric cards via SQL aggregation directly in PostgreSQL.
- Implements pagination (`limit`, `offset`) and server-side filtering.
- Maps stock status dynamically in SQL:
  ```sql
  CASE 
    WHEN inv.quantity = 0.0000 THEN 1 -- 'out_of_stock'
    WHEN inv.reorder_point IS NOT NULL AND inv.quantity <= inv.reorder_point THEN 2 -- 'low_stock'
    ELSE 3 -- 'in_stock'
  END AS stock_status_priority
  ```
- Evaluates `inventory:read_valuation` on the server before including valuation figures in the response payload.

