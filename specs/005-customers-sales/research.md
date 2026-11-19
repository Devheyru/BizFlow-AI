# Phase 0 Research: Feature 005 — Customers & Sales

**Branch**: `005-customers-sales` | **Date**: 2026-11-17 | **Spec**: [spec.md](./spec.md)

---

## 1. Technology & Architecture Decisions

### 1.1 Database Transaction Architecture

**Decision**: Two-layer mutation architecture.

Feature 005 database RPCs (`execute_sale`, `void_sale`, `execute_sale_return`) invoke Feature 004's internal `_execute_inventory_mutation_core` directly within the same PostgreSQL transaction. This preserves atomicity across sale records, payment records, and inventory mutations without introducing a separate orchestration layer.

**Rationale**: `_execute_inventory_mutation_core` is `SECURITY DEFINER` owned by `postgres`, `REVOKED` from `PUBLIC`, `authenticated`, and `anon`. Feature 005 RPCs run as `SECURITY DEFINER` owned by `postgres`, so they have direct call access within the same transaction scope. This matches the established F004 architecture where `execute_stock_movement` wraps `_execute_inventory_mutation_core`.

**Evidence**: Migration `20261111000017_inventory_stock_management.sql`, lines ~300–500.

### 1.2 Tax Snapshot Model

**Decision**: Snapshot tax parameters at sale time.

Each sale header stores `is_tax_inclusive`, `tax_rate`, `tax_name`, and `tax_amount` as frozen snapshots of the organization's tax settings at the moment of checkout. Future changes to `organization_tax_settings` do not retroactively affect historical sales.

**Rationale**: Constitution Principle II (Financial Invariance) mandates historical price snapshotting. Tax parameters are financial facts that must be immutable once a sale commits.

### 1.3 Obligation-Based Refund Lineage

**Decision**: Use `obligation_refund_id` to track refund obligation identity.

Original refunds (from void or return) set `obligation_refund_id = id` (self-referencing). Replacement refunds inherit `obligation_refund_id` from their failed parent's obligation root. A partial unique index `UNIQUE (organization_id, obligation_refund_id) WHERE status IN ('pending', 'completed')` enforces at most one active reimbursement attempt per obligation.

**Rationale**: This design cleanly handles multi-failure chains (R1 fails → R2 fails → R3 succeeds) without complex recursive queries. The obligation root identity is always a single UUID lookup.

**Evidence**: Spec Section 4.F (issue_replacement_refund), F005-044 invariant.

### 1.4 Idempotency Pattern

**Decision**: Transaction-scoped advisory lock + SHA-256 canonical hash.

All mutating RPCs (`execute_sale`, `void_sale`, `execute_sale_return`, `confirm_refund_reimbursement`, `issue_replacement_refund`) acquire `pg_advisory_xact_lock(hashtext(org_id::text), hashtext(idempotency_key::text))` before checking for existing records. Canonical payload hashes use deterministic JSONB construction with sorted arrays and normalized optional fields.

**Rationale**: Reuses the proven F004 pattern from `execute_stock_movement`. Advisory locks serialize concurrent retries within the same transaction lifetime, preventing race conditions between the idempotency check and the insert.

**Evidence**: Migration `20261111000017`, `execute_stock_movement` function.

### 1.5 Sequence Number Generation

**Decision**: Organization-scoped counter table (`sale_sequences`).

Sequential numbers (`SAL-YYYYMMDD-XXXX`, `RET-YYYYMMDD-XXXX`) are generated atomically inside the database transaction using `INSERT ... ON CONFLICT DO UPDATE` on `(organization_id, sequence_type, date_key)`. The date is computed in the organization's configured IANA timezone.

**Rationale**: Database-level generation inside the transaction guarantees gap-free allocation under concurrent checkouts. Client-supplied numbers are rejected.

### 1.6 Composite Foreign Keys for Cross-Tenant Prevention

**Decision**: All inter-table references use composite foreign keys including `organization_id`.

Examples: `fk_sales_org_customer (organization_id, customer_id)`, `fk_refunds_org_sale_return (organization_id, sale_id, return_id)`, `fk_return_items_org_sale_item_prod (organization_id, sale_id, sale_item_id, product_id)`.

**Rationale**: Constitution Principle I (Multi-Tenancy). Simple single-column FKs could allow cross-tenant references if UUIDs collide or are manipulated. Composite FKs with `organization_id` make cross-tenant linking structurally impossible at the database constraint level.

**Evidence**: Existing pattern in F004: `stock_movements` uses composite FK `(organization_id, inventory_id, product_id) REFERENCES inventory (organization_id, id, product_id)`.

### 1.7 RLS Deny-All + SECURITY DEFINER RPCs

**Decision**: All Feature 005 tables use deny-all DML policies with SELECT permitted via `check_user_permission`. All mutations execute through `SECURITY DEFINER` stored procedures.

**Rationale**: Established pattern from Features 002–004. Prevents any direct client INSERT/UPDATE/DELETE while allowing read access through RLS-verified paths.

**Evidence**: Migration `20261106000010_products_categories_schema.sql` (products RLS policies), Migration `20261111000017` (inventory/stock_movements RLS policies).

---

## 2. Existing Architecture Integration Points

### 2.1 Authentication & Authorization Stack

| Component | Location | Integration Point |
|---|---|---|
| `resolveTenantContext(slug)` | `src/lib/auth/context.ts` | Server actions resolve tenant from URL slug |
| `check_user_permission(org, user, perm)` | Migration 009 | Database-level RBAC check |
| `is_org_member(org, user)` | Migration 009 | Database-level membership check |
| `hasPermission(context, perm)` | `src/lib/auth/permissions.ts` | Application-level permission check |
| `SYSTEM_PERMISSIONS` | `src/lib/auth/permissions.ts` | Must add 12 new F005 permissions |
| `ROLE_PERMISSIONS` | `src/lib/auth/permissions.ts` | Must add F005 role mappings |
| `PermissionKey` | `src/types/auth.ts` | Must extend union type |

### 2.2 Inventory Integration Contract

| Function | Signature | Access |
|---|---|---|
| `_execute_inventory_mutation_core` | `(p_org_id, p_product_id, p_movement_type, p_quantity_delta, p_reason, p_reference_id, p_idempotency_key, p_idempotency_payload_hash, p_created_by, p_expected_version)` → `JSONB` | `postgres` only |
| `get_currency_exponent` | `(currency TEXT)` → `INTEGER` | `authenticated` |
| Reserved movement types | `'sale'` (delta < 0), `'return'` (delta > 0) | Used by F005 RPCs |

### 2.3 Product & Inventory Schema Dependencies

- `products (organization_id, id)` — unique composite, used as FK target
- `products.selling_price NUMERIC(14,4)` — authoritative unit price source
- `product_costs.cost_price NUMERIC(14,4)` — authoritative unit cost source (nullable)
- `inventory (organization_id, product_id)` — unique composite, row-locked during checkout
- `stock_movements.movement_type` — includes `'sale'` and `'return'` reserved for F005

### 2.4 Application Patterns to Replicate

| Pattern | Reference File | Replication Target |
|---|---|---|
| Server Action structure | `src/actions/inventory-actions.ts` | `src/actions/sales-actions.ts`, `src/actions/customer-actions.ts` |
| Zod validation schemas | `src/lib/validations/inventory.ts` | `src/lib/validations/sales.ts`, `src/lib/validations/customers.ts` |
| Domain type definitions | `src/types/inventory.ts` | `src/types/sales.ts`, `src/types/customers.ts` |
| Error code mapping | `inventory-actions.ts:45–73` | Sales/customer error mappers |
| `ActionResult<T>` pattern | `src/types/auth.ts` | All F005 server actions |
| Canonical hash utility | `src/lib/inventory/canonical-hash.ts` | `src/lib/sales/canonical-hash.ts` |

---

## 3. Migration Numbering

**Latest existing migration**: `20261115000020_revoke_inventory_service_role_privileges.sql`

**Feature 005 migration**: `20261117000021_customers_sales_schema.sql`

This single migration file will contain all 9 tables, constraints, indexes, RLS policies, 11 RPCs, permission seeds, column-level security grants, and execution privileges.

---

## 4. New Permissions to Register

12 new permissions must be added to:
- Database `permissions` table (via migration INSERT)
- Database `role_permissions` table (via migration INSERT)
- `src/lib/auth/permissions.ts` → `SYSTEM_PERMISSIONS` array
- `src/lib/auth/permissions.ts` → `ROLE_PERMISSIONS` map
- `src/types/auth.ts` → `PermissionKey` union type

| Permission | Owner | Admin | Manager | Cashier |
|---|:---:|:---:|:---:|:---:|
| `customers:read` | ✓ | ✓ | ✓ | ✓ |
| `customers:create` | ✓ | ✓ | ✓ | ✓ |
| `customers:update` | ✓ | ✓ | ✓ | ✓ |
| `customers:archive` | ✓ | ✓ | ✓ | — |
| `sales:read` | ✓ | ✓ | ✓ | ✓ |
| `sales:create` | ✓ | ✓ | ✓ | ✓ |
| `sales:void` | ✓ | ✓ | ✓ | — |
| `returns:read` | ✓ | ✓ | ✓ | ✓ |
| `returns:create` | ✓ | ✓ | ✓ | — |
| `payments:read` | ✓ | ✓ | ✓ | ✓ |
| `refunds:read` | ✓ | ✓ | ✓ | — |
| `tax_settings:update` | ✓ | ✓ | — | — |

---

## 5. Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Deadlock on concurrent multi-item checkout | High | Deterministic ascending `product_id` row locking eliminates ABBA deadlocks |
| Duplicate checkout on network retry | High | Advisory lock + idempotency key + canonical hash prevents double-charge |
| Cross-tenant data leakage | Critical | Composite FKs + RLS deny-all + `SECURITY DEFINER` RPCs |
| Financial rounding discrepancy | Medium | Last-line rounding reconciliation absorbs residuals |
| Duplicate refund payout | High | Obligation partial unique index + advisory lock on obligation root |
| Stale inventory version conflict | Medium | Optional `expected_version` passed to `_execute_inventory_mutation_core` |

---

## 6. Decisions Requiring No Further Clarification

All specification decisions are resolved. The user has confirmed:

1. ✅ No hardcoded calendar return cutoff (manager discretion)
2. ✅ Cashier discounts allowed within subtotal bounds
3. ✅ Cash refunds permitted regardless of original payment method
4. ✅ External refunds always start as `pending`, never auto-completed
5. ✅ Obligation lock acquired unconditionally (F005-044 correction)
6. ✅ Payment canonicalization includes all 5 material fields (F005-047)

No open questions remain. The specification is approved for planning.
