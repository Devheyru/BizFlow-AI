# Specification Quality Checklist: Customers & Sales Management

**Purpose**: Validate specification completeness, quality, architectural consistency, and technical feasibility before proceeding to planning  
**Created**: 2026-11-17  
**Updated**: 2026-11-17 (Revision 2.6 -- Obligation Lock & Canonical Normalization Hardening)  
**Status**: Ready for Planning  
**Feature**: [spec.md](../spec.md)

---

## 1. Content Quality

- [x] No implementation details (languages, frameworks, APIs) in user stories and success criteria
- [x] Focused on user value and retail business needs
- [x] Written for business and retail stakeholders
- [x] All mandatory sections completed

*Note on Technical Architecture*: Non-negotiable technical constraints (PostgreSQL schema DDL, table-by-table RLS policies with column-level security on sensitive cost data, complete RPC transaction boundaries for all 11 trusted procedures, deterministic ascending lock acquisition ordering, snapshot pricing, RFC 8259-compliant deterministic JSON formatting, internal deterministic SHA-256 hashing, and integration with `_execute_inventory_mutation_core`) are isolated within `## Binding Implementation Constraints (inputs to /plan)` to provide clear, binding guidance for `/speckit-plan`, while user stories and success criteria remain strictly user- and business-focused.

---

## 2. Requirement Completeness & Edge Cases

- [x] No unresolved blocking `[NEEDS CLARIFICATION]` markers remain (Sensible, non-breaking defaults codified in Ambiguity Register and confirmed in Clarification Session)
- [x] Requirements are testable and unambiguous with explicit Given/When/Then acceptance criteria
- [x] Success criteria are measurable and distinguish DB query, server response, and UI interaction latencies (p95 DB RPC < 120 ms, checkout < 1.5 s, search < 500 ms)
- [x] Success criteria are technology-agnostic and describe observable business outcomes
- [x] All acceptance scenarios are defined using Given/When/Then structure
- [x] Edge cases are identified (concurrent checkout on final stock unit, network retries with advisory locks, cash overpayment & split tender, archived product/customer in cart, snapshot price immutability, zero-item cart rejection, duplicate cart product rejection, missing non-cash payment reference, zero-value sales, split-tender return caps, external reimbursement failure & replacement workflow)
- [x] Scope is clearly bounded (single-store MVP, loyalty points/credit deferred, external gateways out of scope)
- [x] Dependencies and assumptions identified

---

## 3. Mandatory Defect Remediation Checks

### Part 1: Initial Remediation Checks (F005-001 through F005-018)

#### A. Core Transaction Ordering & Identity
- [x] **F005-001 (Return Header & Movement Reference Ordering)**: In `execute_sale_return`, return UUID `v_return_id` is generated at transaction start and `public.sale_returns` header is inserted prior to item stock restoration. The movement reference string `return:{return_id}` is guaranteed to reference a persisted, committed return entity within the single atomic transaction.
- [x] **F005-002 (Duplicate Sale Item Rejection in Returns)**: In `execute_sale_return`, submitting duplicate entries for the same `sale_item_id` is explicitly validated and rejected with `DUPLICATE_RETURN_ITEM` (SQLSTATE `P0060`). Return quantity limits (`previously_returned + requested <= sold_quantity`) are calculated against aggregated item identifiers inside the database transaction.

#### B. Customer Mutation Contracts & Security
- [x] **F005-003 (Complete Customer Mutation Procedures)**: Trusted procedures `public.create_customer`, `public.update_customer`, and `public.archive_customer` are fully specified with parameter signatures, tenant validation, permission checks (`customers:create`, `customers:update`, `customers:archive`), case/whitespace normalization, partial unique index enforcement, and explicit denial of direct table mutations via RLS.
- [x] **F005-014 (Customer Email & Phone Normalization)**: Customer emails are normalized to lowercase trimmed strings (`lower(trim(email))`), and phones are validated against E.164. Uniqueness is scoped to the organization for active profiles (`WHERE status <> 'archived'`). Archival frees active uniqueness; customer reactivation re-checks for collision (`CUSTOMER_PHONE_EXISTS` / `CUSTOMER_EMAIL_EXISTS`, `23505`).

#### C. Void Accounting & External Reversal Lifecycle
- [x] **F005-004 (Distinction Between Internal Void, Cash Reversal & External Reimbursement)**: `void_sale` distinguishes cash reimbursements (`status = 'completed'`) from external card/bank reversals (`status = 'pending'` when provider auth reference is unconfirmed at void time). Sale payment status remains `partially_refunded` until all reversal disbursements are confirmed.
- [x] **F005-004b (Reimbursement Confirmation RPC)**: Dedicated procedure `public.confirm_refund_reimbursement` allows authorized operators (`sales:void` or `returns:create`) to transition pending refunds to `completed` upon receipt of external provider confirmation, updating sale payment status to `refunded` when all disbursements settle.
- [x] **F005-005 (Void Idempotency Contract)**: `void_sale` requires mandatory `p_idempotency_key UUID`. It acquires advisory lock `pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_idempotency_key::text))` and hashes canonical void payload. Retried void requests replay the committed void result (`is_replay = true`) without duplicating refunds or inventory movements; conflicting payloads raise `IDEMPOTENCY_CONFLICT` (`P0024`).

#### D. Taxation, Precision & Partial-Return Financial Model
- [x] **F005-006 (Tax-Inclusive & Tax-Exclusive Formulations)**: Fully codified mathematical models for both modes: tax-exclusive adds tax on top of discounted subtotal; tax-inclusive extracts taxable base via `round(total / (1 + rate/100))` and tax as `total - taxable`. Sourced mode, rate, name, and allocated tax are snapshotted onto `sales` and `sale_items`.
- [x] **F005-007 (Complete Partial-Return Financial Reconciliation)**: Monetary fields on `sale_items` (`subtotal`, `line_discount_amount`, `allocated_order_disc`, `taxable_amount`, `allocated_tax_amount`, `total_price`) are strictly defined. `sum(sale_items.total_price) == sales.total_amount` down to the exact minor currency unit. When returning the final remaining quantity of an item, the calculation absorbs the exact remaining unrefunded portion of `total_price`, eliminating rounding drift across multiple partial returns. Cumulative refunds cannot exceed `sales.total_amount` (`REFUND_EXCEEDS_PAYABLE`, `P0054`).
- [x] **F005-017 (Zero-Value Sales Behavior)**: Fully defined: sales with 100% discount produce `total_amount = 0.0000`, `payment_status = 'paid'`, deduct stock normally via `_execute_inventory_mutation_core`, and allow return restocking with $0.00 refund.
- [x] **F005-018 (Tax Settings Mutation Authorization)**: Modifying `organization_tax_settings` is restricted to Owner/Admin roles. Mutations apply strictly to future checkouts; historical completed sales retain snapshotted tax parameters.

#### E. Idempotency Canonicalization & PostgreSQL Syntax
- [x] **F005-008 (Deterministic Array Sorting in Canonical Hashing)**: In `execute_sale` and `execute_sale_return`, items arrays are sorted by `product_id` ASC and payment arrays are sorted by `payment_method` ASC before building the canonical JSON string, ensuring equivalent requests in different order produce identical hashes.
- [x] **F005-010 (Valid PostgreSQL Parameter Signatures)**: Corrected invalid `UUID NOT NULL` function parameter syntax to valid PostgreSQL `p_idempotency_key UUID` with runtime null guard (`IF p_idempotency_key IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P0055', MESSAGE = 'IDEMPOTENCY_KEY_REQUIRED'; END IF;`). Table columns retain database `NOT NULL` constraints.

#### F. Referential Integrity, Numbering & UOM Invariants
- [x] **F005-009 (Tenant-Aware Composite Foreign Keys)**: All internal Feature 005 entities (`sale_items`, `payments`, `sale_returns`, `sale_return_items`, `refunds`) enforce composite foreign keys `(organization_id, ...)` to their parent records and to `public.products (organization_id, id)`. `sale_items` exposes `UNIQUE (organization_id, id)` to support composite FK target from `sale_return_items`. `stock_movements` foreign key is documented as single UUID FK based on Feature 004 schema, with organization matching enforced in RPC logic.
- [x] **F005-011 (Sequential Sale Numbering with Gap Semantics)**: Defined as sequentially allocated and unique per organization (`UNIQUE (organization_id, sale_number)`) using atomic counter table `public.sale_sequences`. Gaps may occur only upon transaction rollbacks or voids; voided numbers are never reused (immutable audit preservation). Number prefix is formatted based on `public.organizations.timezone`.
- [x] **F005-013 (Payment Reference Naming & Uniqueness)**: Standardized universally on `reference_no TEXT NULL`. Mandatory on non-cash payments (`PAYMENT_REFERENCE_REQUIRED`, `P0057`). Uniqueness enforced via `UNIQUE (organization_id, payment_method, reference_no) WHERE reference_no IS NOT NULL` (`23505`).
- [x] **F005-015 (Return Quantity UOM Precision Alignment)**: Returns enforce original product UOM rules from Feature 004: discrete UOMs require positive whole integers (`P0015`); continuous UOMs permit up to 4 decimal places (`P0016`).
- [x] **F005-016 (Expected Inventory Version Semantics)**: `execute_sale` accepts optional caller-supplied `expected_version` for OCC decrement checking. Returns and voids pass `expected_version := NULL` because additions do not compete on decrement thresholds; ascending `FOR UPDATE` inventory locking serializes stock restoration safely.

#### G. Security, Roles & Table-by-Table RLS
- [x] **F005-012 (Granular Permissions & Dual-Permission Cost Protection)**: Defined distinct scopes for `sales:read`, `returns:read`, `refunds:read`, and `customers:read`. Direct table-level SELECT on `sale_items` is revoked and direct column SELECT granted only on safe non-cost columns (`unit_cost` omitted, denying direct PostgREST queries with SQLSTATE `42501`). Viewing `sale_items.unit_cost` strictly requires **BOTH** `inventory:read_valuation` AND `products:read_cost` permissions via the `get_sale_detail` SECURITY DEFINER RPC (returning null otherwise).
- [x] **Table-by-Table RLS Specifications**: Individual SELECT and direct mutation deny policies (`FOR ALL TO authenticated USING (false) WITH CHECK (false);`) are explicitly specified for all 9 tables: `customers`, `organization_tax_settings`, `sales`, `sale_items`, `payments`, `sale_returns`, `sale_return_items`, `refunds`, and `sale_sequences`.

---

### Part 2: Intermediate Remediation Checks (F005-019 through F005-037)

#### A. Refund and Reversal Correctness
- [x] **F005-019 (External Refunds Marked Pending in Returns)**: In `execute_sale_return`, non-cash refunds (`'card'`, `'bank_transfer'`, `'other'`) start with `status = 'pending'`, even if an external transaction intent/trace reference is provided. They transition to `'completed'` only when confirmed via `confirm_refund_reimbursement`. Cash refunds disburse immediately with `status = 'completed'`. Sale `payment_status` updates to `'refunded'` only when all line items are returned AND all refunds for the sale are completed.
- [x] **F005-020 (Void Idempotency Canonical Hash Includes Reversals)**: In `void_sale`, `p_reversal_references` is deterministically sorted by `(payment_id)::UUID ASC` and included in the structured `jsonb_build_object` canonical payload, guaranteeing retries with conflicting reversal references raise `P0024 IDEMPOTENCY_CONFLICT`.
- [x] **F005-027 (Mandatory Refund Confirmation Idempotency)**: In `confirm_refund_reimbursement`, added mandatory `p_idempotency_key UUID` with null check (`P0055`), transaction-scoped advisory lock, canonical payload hash check against `confirmation_idempotency_hash`, and replay semantics (`is_replay = true`) or conflict exception (`P0024`).
- [x] **F005-030 (Split-Tender Refund Allocation Policy)**: In `execute_sale_return`, split-tender refunds are validated such that non-cash refund methods must have been tendered on the original sale and cumulative refunds for that method cannot exceed original tendered amount minus prior refunds for that method (`P0061 REFUND_METHOD_EXCEEDS_ORIGINAL_TENDER`). Cash refunds are permitted regardless of original payment methods, bounded only by overall unrefunded sale total amount (`P0054`).
- [x] **F005-036 (Failed External Reimbursement Lifecycle Procedure)**: Added dedicated procedure `public.record_refund_failure(p_org_id UUID, p_refund_id UUID, p_failure_reason TEXT) RETURNS JSONB` allowing authorized operators (`sales:void` or `returns:create`) to transition `pending` refunds to `failed`, recording the failure reason while leaving the unsettled sale balance available for re-disbursement via alternative methods.

#### B. Financial Calculations and Reconciliation
- [x] **F005-021 (Zero-Subtotal Division by Zero Guard in Sales)**: In `execute_sale`, added an explicit guard: when `v_subtotal = 0.0000`, `v_alloc_order_disc` is set directly to `0.0000`, preventing `22012 division by zero` when processing sales with 100% item discounts or zero-priced promotional items.
- [x] **F005-022 (Sale-Line Financial Rounding Exact Reconciliation)**: In `execute_sale`, line-item allocation tracks accumulated line totals. The final line item absorbs any minor rounding residual (`v_line_total := v_total_amount - v_accumulated_line_total`), guaranteeing that `SUM(sale_items.total_price) == sales.total_amount` down to the exact minor currency unit.

#### C. Schema and Database Integrity
- [x] **F005-023 (`public.refunds.updated_at` Column & Lifecycle Tracking)**: Updated `public.refunds` schema to include `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `confirmation_idempotency_key UUID NULL`, `confirmation_idempotency_hash TEXT NULL`, and partial unique constraint `UNIQUE (organization_id, confirmation_idempotency_key) WHERE confirmation_idempotency_key IS NOT NULL`.
- [x] **F005-024 (Timezone Direct Resolution for Returns)**: In `execute_sale_return`, local calendar date is computed by querying `timezone` directly from `public.organizations WHERE id = p_org_id` (`v_org_date := (now() AT TIME ZONE coalesce(v_org_timezone, 'UTC'))::DATE`), eliminating the nonexistent `v_sale.timezone` reference.
- [x] **F005-026 (Tenant-Aware Composite Foreign Key on Customers)**: `public.sales` enforces composite foreign key `CONSTRAINT fk_sales_org_customer FOREIGN KEY (organization_id, customer_id) REFERENCES customers (organization_id, id) ON DELETE RESTRICT`. Also confirmed `sale_items` exposes `UNIQUE (organization_id, id)` and `sale_return_items` enforces `(organization_id, sale_item_id) REFERENCES sale_items(organization_id, id)`.
- [x] **F005-029 (Complete `sale_sequences` Table Definition & Schema)**: Fully defined entity schema for `public.sale_sequences` with composite primary key `(organization_id, sequence_type, date_key)`, `sequence_type CHECK (sequence_type IN ('sale', 'return'))`, `last_number INTEGER NOT NULL DEFAULT 0`, and RLS policy denying direct client mutations while allowing trusted RPC execution.
- [x] **F005-034 (`expected_version` Sourced Parameter Semantics)**: Defined that `expected_version` is passed per-item in `p_items` array in `execute_sale` (sourced from client inventory query for OCC validation); in `void_sale` and `execute_sale_return`, `expected_version` is passed as `NULL` because restocking additions do not decrement and are serialized by row locks.

#### D. Concurrency and Inventory Integration
- [x] **F005-025 (Deterministic Ascending Inventory Pre-locking in Voids & Returns)**: In both `void_sale` and `execute_sale_return`, distinct product IDs are extracted, sorted ascending alphanumeric, and pre-locked via `SELECT id FROM public.inventory WHERE organization_id = p_org_id AND product_id = ANY(sorted_pids) ORDER BY product_id ASC FOR UPDATE` prior to invoking `_execute_inventory_mutation_core`, eliminating deadlocks.
- [x] **F005-033 (Deterministic Payment Array Sorting in Sales)**: In `execute_sale`, payments array is sorted deterministically across all three discriminating fields: `payment_method ASC`, `coalesce(reference_no, '') ASC`, and `amount ASC`.

#### E. Canonical Idempotency
- [x] **F005-031 (Structured JSONB Canonicalization in Returns)**: In `execute_sale_return`, replaced fragile string concatenation and manual escaping with PostgreSQL `jsonb_build_object` over sorted return items, converted deterministically to text and hashed via SHA-256.
- [x] **F005-032 (Structured JSONB Canonicalization in Voids)**: In `void_sale`, replaced fragile string concatenation with `jsonb_build_object` over sorted reversal references, converted deterministically to text and hashed via SHA-256.

#### F. Security and Permissions
- [x] **F005-028 (Complete Customer Mutation Security Contracts)**: Fully specified complete SQL DDL, `SECURITY DEFINER`, fixed `search_path = pg_catalog, public, pg_temp`, ownership `postgres`, `REVOKE ALL`, `GRANT EXECUTE TO authenticated`, and RBAC permission checks (`customers:create`, `customers:update`, `customers:archive`) for all three customer mutation procedures.
- [x] **F005-035 (Tax Settings Mutation Procedure Contract)**: Fully specified complete SQL contract for `public.update_tax_settings(p_org_id UUID, p_tax_name TEXT, p_default_tax_rate NUMERIC, p_is_tax_inclusive BOOLEAN) RETURNS JSONB` with `SECURITY DEFINER`, ownership, grants, and Owner/Admin authorization.

#### G. Contract and Checklist Consistency
- [x] **F005-037 (RPC Contract Count Reconciliation)**: Procedures documented across Feature 005 have complete parameter signatures, security definitions, and execution contracts.

---

### Part 3: Final Targeted Remediation Checks (F005-038 through F005-043)

#### A. Void Reversal Integrity & Acceptance Scenarios
- [x] **F005-038 (External Void Reimbursements Remain Pending Until Confirmation)**: In `void_sale`, cash reversals disburse immediately with `status = 'completed'`. Every non-cash reimbursement (`'card'`, `'bank_transfer'`, `'other'`) is initialized as `status = 'pending'`, regardless of whether an external reversal reference was supplied. A supplied reversal reference serves strictly as supporting trace data (intent/gateway authorization code), never as proof of completed reimbursement. It transitions to `'completed'` exclusively through subsequent execution of `confirm_refund_reimbursement`. Five explicit acceptance scenarios are established in User Story 6 covering: (1) Cash void reimbursement; (2) External void with supplied reference; (3) External void without supplied reference; (4) Successful external confirmation; and (5) Failed external reimbursement & replacement.

#### B. Financial Reconciliation & Failed Refund Calculations
- [x] **F005-039 (Failed Refunds Excluded from Completed Reimbursement in Aggregate Status)**: Across `execute_sale_return`, `void_sale`, `confirm_refund_reimbursement`, `record_refund_failure`, and `issue_replacement_refund`, aggregate sale `payment_status` is calculated strictly from actual completed reimbursements (`SELECT coalesce(sum(amount), 0) ... WHERE status = 'completed'`):
  - `'refunded'`: When `status IN ('voided', 'returned')` AND `v_total_completed >= v_sale.total_amount`.
  - `'partially_refunded'`: When completed refunds $> 0.0000$ OR at least one refund has `status = 'pending'`.
  - `'paid'`: When completed refunds $= 0.0000$ AND pending refunds $= 0.0000$ (e.g. when all attempted refunds have failed).
  Failed refunds never count as money returned to the customer, cannot cause a sale to appear fully refunded, and do not consume refundable ceilings.

#### C. Replacement Reimbursement Workflow
- [x] **F005-040 (Durable Replacement Reimbursement Workflow via `issue_replacement_refund`)**: Fully specified dedicated procedure `public.issue_replacement_refund(p_org_id UUID, p_failed_refund_id UUID, p_refund_method TEXT, p_idempotency_key UUID, p_reference_no TEXT DEFAULT NULL, p_notes TEXT DEFAULT NULL) RETURNS JSONB`. The procedure locks the failed refund row `FOR UPDATE`, verifies `status = 'failed'` (`P0065 REFUND_NOT_FAILED`), verifies no active replacement exists (`P0064 REPLACEMENT_REFUND_ALREADY_EXISTS`), enforces split-tender and sale refundable ceilings, and inserts a linked replacement refund record (`parent_refund_id = failed_id`) with `status = 'completed'` (cash) or `'pending'` (non-cash). The historical failed record remains completely immutable and traceable; no duplicate inventory movements or return items are created.

#### D. Database-Enforced Return Parent-Sale Integrity
- [x] **F005-041 (Return-Item Parent-Sale Foreign Key Integrity Constraints)**: Corrected `public.sale_return_items` schema to enforce database-level parent-sale consistency:
  - `CONSTRAINT fk_return_items_org_return_sale FOREIGN KEY (organization_id, sale_id, return_id) REFERENCES sale_returns (organization_id, sale_id, id) ON DELETE CASCADE`
  - `CONSTRAINT fk_return_items_org_sale_item_prod FOREIGN KEY (organization_id, sale_id, sale_item_id, product_id) REFERENCES sale_items (organization_id, sale_id, id, product_id) ON DELETE RESTRICT`
  Referenced composite unique constraints `uq_sale_returns_org_sale_id` and `uq_sale_items_org_sale_item_prod` are explicitly defined. PostgreSQL strictly rejects any return item referencing a sale item from a different sale (`23503 foreign_key_violation`), verified via explicit User Story 4 Acceptance Scenario 5.

#### E. Error Catalog & Operational Semantics Reconciliation
- [x] **F005-042 (Consistent P0059 Meaning & Permitted Pending External Returns)**: Reconciled `P0059 EXTERNAL_REVERSAL_REFERENCE_REQUIRED` across the error catalog and RPC contracts to mean: "Missing or empty external provider reference when executing `confirm_refund_reimbursement`". In `execute_sale_return` and `void_sale`, `p_reference_no` is optional trace metadata at creation time; external refunds are created as `pending` without error.

#### F. Artifact Version Synchronization
- [x] **F005-043 (Specification and Checklist Revision Synchronization)**: Both `specs/005-customers-sales/spec.md` and `specs/005-customers-sales/checklists/requirements.md` identify authoritative `Revision 2.6 -- Obligation Lock & Canonical Normalization Hardening`, dated `2026-11-17`, with matching references and complete cross-artifact synchronization.

---

### Part 4: Final Database Integrity & Idempotency Hardening (F005-044 through F005-047)

#### A. Reimbursement Obligation Identity & Lineage
- [x] **F005-044 (Authoritative Obligation Identity, Unconditional Locking & Duplicate Active Prevention)**: Codified `obligation_refund_id UUID NOT NULL` on `public.refunds`. Original refunds (created during void or return) set `obligation_refund_id = id` (self-referencing). All replacements inherit the original obligation root `obligation_refund_id`. In `issue_replacement_refund`, transaction acquires an unconditional advisory lock on the obligation root `(organization_id, obligation_refund_id)` for EVERY replacement request (including requests targeting the original failed refund where `v_obligation_id = p_failed_refund_id`), eliminating race conditions that could leak raw PostgreSQL `23505` unique index errors. Competing requests serialize cleanly: if an active replacement is pending, it raises `REPLACEMENT_REFUND_ALREADY_EXISTS` (`P0064`); if the obligation is already completed, it raises `OBLIGATION_ALREADY_COMPLETED` (`P0067`). Partial unique index `UNIQUE (organization_id, obligation_refund_id) WHERE status IN ('pending', 'completed')` retained as the final database-level safeguard across arbitrary failure chains (R1 -> R2 -> R3).

#### B. Composite Foreign Key Integrity
- [x] **F005-045 (Composite Foreign Key Integrity Across Sales, Returns, and Parent Refunds)**: Added `uq_refunds_org_sale_id UNIQUE (organization_id, sale_id, id)`. Replaced single-entity foreign keys with composite foreign keys enforcing parent-sale consistency:
  - `CONSTRAINT fk_refunds_org_sale_return FOREIGN KEY (organization_id, sale_id, return_id) REFERENCES sale_returns (organization_id, sale_id, id)`
  - `CONSTRAINT fk_refunds_org_sale_parent FOREIGN KEY (organization_id, sale_id, parent_refund_id) REFERENCES refunds (organization_id, sale_id, id) ON DELETE RESTRICT`
  PostgreSQL composite foreign key semantics ensure that when `return_id` is NULL (void refunds) or `parent_refund_id` is NULL (original returns), the check is cleanly skipped, while preventing any cross-sale return or parent refund linking (`23503`). Verified via User Story 7 Acceptance Scenarios 5 & 6.

#### C. Confirmation Idempotency Conflict Handling
- [x] **F005-046 (Complete Tenant-Scoped Confirmation Idempotency Conflict Resolution)**: In `confirm_refund_reimbursement`, added pre-emptive check under transaction-scoped advisory lock: if `confirmation_idempotency_key` is already registered to a different refund in the same tenant (`id <> p_refund_id`), the procedure immediately raises `IDEMPOTENCY_CONFLICT` (SQLSTATE `P0024`, HTTP 409), preventing raw database unique constraint exceptions (`23505`) from leaking. Handled all five idempotency lifecycle cases (A: matching replay, B: conflict payload, C: cross-refund collision, D: already settled, E: concurrent serialization). Verified via User Story 7 Acceptance Scenario 7.

#### D. Payment Canonicalization
- [x] **F005-047 (Deterministic Payment Canonicalization & Optional Value Normalization)**: In `execute_sale`, payment canonicalization normalizes optional `reference_no` values prior to canonical JSON construction: missing, null, empty (`""`), and whitespace-only strings are uniformly converted to JSON `null` via `NULLIF(trim(reference_no), '')`. Each payment object is explicitly reconstructed with formatted numeric strings and sorted deterministically across all five material discriminating fields (`payment_method ASC`, `amount ASC`, `amount_tendered ASC`, `change_due ASC`, and `reference_no ASC NULLS LAST`). This eliminates sorting ties and ensures equivalent arrays with alternative blank representations produce identical canonical hashes, while genuine tender variations trigger `IDEMPOTENCY_CONFLICT` (`P0024`). Verified via User Story 7 Acceptance Scenario 8.

---

## 4. Cross-Feature Verification Matrix

| Reference | Claim in Feature 005 | Status | Evidence / Repository Document |
|---|---|:---:|---|
| **Feature 001** | `organizations.currency` (strict ISO 4217, 3 uppercase letters) defines the currency for sale totals and receipts. | **VERIFIED** | Confirmed in `supabase/migrations/20261031000001_auth_organization_schema.sql` (`currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$')`). |
| **Feature 001** | `organizations.timezone` defines the local calendar day for sale and return number date formatting. | **VERIFIED** | Confirmed in `supabase/migrations/20261031000001_auth_organization_schema.sql` (`timezone TEXT NOT NULL DEFAULT 'UTC'`). |
| **Feature 001** | `created_by REFERENCES profiles(id) ON DELETE RESTRICT` maintains cashier and manager attribution. | **VERIFIED** | Confirmed in `supabase/migrations/20261031000001_auth_organization_schema.sql` and `specs/001-auth-organization/spec.md`. |
| **Feature 002** | Granular colon-delimited permissions are evaluated via `public.check_user_permission(organization_id, user_id, permission)`. | **VERIFIED** | Confirmed in `src/lib/auth/permissions.ts` and `supabase/migrations/20261103000009_employee_management_rbac.sql`. |
| **Feature 002** | Predefined roles are `owner`, `admin`, `manager`, and `cashier`. | **VERIFIED** | Confirmed in `src/types/auth.ts` and database enum `public.app_role`. |
| **Feature 003** | Product catalog prices (`selling_price`) and costs (`product_costs.cost_price`) use `NUMERIC(14, 4)`. | **VERIFIED** | Confirmed in `supabase/migrations/20261106000010_products_categories_schema.sql`. |
| **Feature 003** | `public.products` exposes composite unique key `(organization_id, id)` enabling composite FK target from `sale_items`. | **VERIFIED** | Confirmed in `supabase/migrations/20261106000010_products_categories_schema.sql` (lines 48–52). |
| **Feature 003** | Currency exponent helper `public.get_currency_exponent()` formats monetary amounts according to currency rules. | **VERIFIED** | Confirmed in `supabase/migrations/20261106000010_products_categories_schema.sql`. |
| **Feature 004** | Internal mutation core `_execute_inventory_mutation_core` natively supports `movement_type = 'sale'` (< 0) and `'return'` (> 0). | **VERIFIED** | Confirmed in `supabase/migrations/20261111000017_inventory_stock_management.sql` and `20261111000018_enforce_inventory_uom_precision_invariants.sql`. |
| **Feature 004** | Outer wrapper `execute_stock_movement` explicitly rejects `'sale'` and `'return'` with `P0032`, reserving them for Feature 005's atomic checkout procedure. | **VERIFIED** | Confirmed in `supabase/migrations/20261111000017_inventory_stock_management.sql` (lines 355–360). |
| **Feature 004** | UOM integer precision rules (discrete UOMs require whole numbers; continuous permit up to 4 decimals) apply to sale quantities. | **VERIFIED** | Confirmed in `specs/004-inventory-stock-management/spec.md` (`FR-INV-030`) and migration 18. |
| **Feature 004** | Internal core function signature: `(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, TEXT, UUID, INTEGER)` owned by `postgres` with execution revoked from `PUBLIC, authenticated, anon`. | **VERIFIED** | Confirmed in `supabase/migrations/20261111000018_enforce_inventory_uom_precision_invariants.sql` (lines 330–355). |
| **Feature 004** | Access to product cost data requires BOTH `inventory:read_valuation` AND `products:read_cost`. | **VERIFIED** | Confirmed in `supabase/migrations/20261111000017_inventory_stock_management.sql` (`stock_movement_costs_select_policy`). |
| **Feature 004** | Transaction-scoped advisory lock structure: `pg_advisory_xact_lock(hashtext(org_id::text), hashtext(key::text))`. | **VERIFIED** | Confirmed in `supabase/migrations/20261111000017_inventory_stock_management.sql`. |

---

## 5. Verification Summary

- **Total Checklist Items**: 65/65 Passed
- **Cross-Feature Integrations**: 14/14 Verified with concrete repository evidence
- **Defects Closed**: 47/47 Resolved with complete technical contracts (F005-001 through F005-047)
- **SQLSTATE Collisions**: 0 (Full cross-feature error table codified; `P0032` preserved for Feature 004, `P0067` added)
- **Tenant Security Gaps**: 0 (No client JWT claims trusted; full RLS enforced table by table across all 9 tables)
- **RPC Contracts Documented**: 11/11 (`execute_sale`, `void_sale`, `execute_sale_return`, `confirm_refund_reimbursement`, `record_refund_failure`, `issue_replacement_refund`, `create_customer`, `update_customer`, `archive_customer`, `update_tax_settings`, `get_sale_detail`)
