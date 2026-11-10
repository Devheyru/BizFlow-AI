# Specification Quality Checklist: Inventory & Stock Management

**Purpose**: Validate specification completeness and quality before proceeding to planning  
**Created**: 2026-11-10  
**Updated**: 2026-11-10 (Revision 2 — Final Hardening & Clarifications Fully Resolved)  
**Feature**: [spec.md](specs/004-inventory-stock-management/spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) in user stories and success criteria
- [x] Focused on user value and business needs
- [x] Written for business and retail stakeholders
- [x] All mandatory sections completed

*Note on Technical Architecture*: Binding technical implementation constraints (PostgreSQL schema DDL, RLS policies, function security contracts, composite foreign keys, and idempotency hashes) are intentionally preserved within the designated section `## Binding Implementation Constraints (inputs to /plan)` to provide unambiguous, non-negotiable architectural inputs for `/speckit.plan`, while user stories, business rules, and success criteria remain strictly outcome- and business-focused.

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain (Resolved: Question 1 approved - allow archival with frozen balance; Question 2 approved - internal use prohibited on inactive products with PRODUCT_INACTIVE_INTERNAL_USE_BLOCKED; product must be reactivated first)
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable and distinguish DB query, server response, and UI interaction latencies (p95 DB < 100 ms, API < 350 ms, UI < 500 ms)
- [x] Success criteria are technology-agnostic and describe observable business outcomes
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified (exact zero-initial exception, fractional precision, cross-product collision, canonical idempotency, and organization cascade)
- [x] Scope is clearly bounded (single-store MVP, sales/returns handed off to Feature 005, 13 explicit out-of-scope capabilities documented)
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows (P1 Overview, P1 Restock, P2 Initial Stock, P2 Adjustment, P3 History, P3 Reorder Points)
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into user-facing requirements

---

## Revision 2 Notes

This revision hardens the Feature 004 specification against the 13 Master Prompt findings:
1. **Resolved Product-Owner Archival Policy**: Unconditionally codified approved policy (Archive While Stock Is Frozen) in Section 3: products holding positive stock can be archived; stock balance is frozen; inbound replenishment is blocked (`PRODUCT_ARCHIVED_STOCK_FORBIDDEN`); outbound write-offs (`damage`, `loss`, negative `adjustment`) are permitted for authorized managers; archival does not generate automated movements.
2. **Database-Enforced Cost Confidentiality**: Historical movement unit costs isolated in dedicated 1:1 table `public.stock_movement_costs` with explicit SELECT policy requiring BOTH `inventory:read_valuation` AND `products:read_cost` (`SEC-INV-004`, `SEC-INV-008`). Cashier queries to movement costs return 0 rows.
3. **Exact Zero-Initial Exception & Singularity**: Enforced via `chk_movement_initial_before_zero`, `chk_movement_delta_zero_rule`, partial unique index `uq_stock_movements_initial_per_product`, and pre-check rejecting initial movements when any movement history exists (`INITIAL_STOCK_NOT_PERMITTED_HISTORY_EXISTS`, `FR-INV-008`, `FR-INV-009`, `BR-INV-006`).
4. **Two-Layer Mutation Architecture & Feature 005 Integration**: Section 11 establishes Layer 1 internal core function `_execute_inventory_mutation_core` (revoked from `PUBLIC`, `authenticated`, `anon`) and Layer 2 user-facing wrapper `execute_stock_movement`. Future Feature 005 POS checkout wrapper calls Layer 1 within the same transaction (`NFR-INV-002`, `A-INV-004`).
5. **Multi-Product Lock Ordering**: Added deterministic lock ordering in ascending `product_id` order to eliminate ABBA deadlock risks (`NFR-INV-003`).
6. **Canonical Idempotency & Replay Authorization**: Normalized canonical payload `{ canonical_quantity, movement_type, organization_id, product_id, quantity_semantics, reason, reference_id }` with deterministic lexicographical serialization and verified SHA-256 hashes (`822dbc78...` for stocktake target count reconciliation vs `7e2b1129...` for ordinary delta adjustment). The explicit `quantity_semantics` discriminator prevents semantic collisions between reconciliations and adjustments. Cross-product collisions handled via unique violation catch on `uq_movements_org_idempotency` with authorization re-check. Cycle count stocktakes preserve submitted target physical count in canonical hash to guarantee post-commit retry idempotency (`FR-INV-028`, `NFR-INV-004`).
7. **Referential Integrity & Cascading Tenant Deletion**: Changed composite foreign keys `fk_movements_inventory_composite` and `fk_movements_org_product` to `ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED`. This defers constraint checking to transaction commit, enabling multi-statement tenant purge transactions while blocking individual product deletion when movement history exists (`BR-INV-010`, `SEC-INV-007`).
8. **Reorder-Point Mutation**: Defined trusted procedure `update_inventory_thresholds` that updates `updated_at` and increments `version` without creating movement records (`FR-INV-019`, `BR-INV-012`).
9. **Inventory Version Semantics**: Explicitly defined `version` as an OCC counter incremented on balance and threshold mutations (`BR-INV-013`, `Entity 1`).
10. **Quantity Limits & UOM Restrictions**: Introduced `FR-INV-029` defining maximum allowable quantity (`999,999,999.9999`) and `FR-INV-030` restricting UOM class mutations when stock or movement history exists.
11. **Comprehensive Error Code Catalog**: Created Section 16 cataloging all 29 error codes, SQLSTATE codes, HTTP statuses, and trigger conditions.
12. **Tiered Performance Consistency**: Standardized latency targets to p95 DB < 100 ms, server action / REST < 350 ms, browser interaction < 500 ms across `NFR-INV-001`, `SC-INV-001`, `SC-INV-006`, and US1 Scenario 4.
13. **Clean Paths & Blueprint Deviations**: Replaced all absolute local-machine URI paths (`file://...`) with repository-relative links and documented all blueprint deviations (omission of `inventory_adjustments`, colon permissions, single location, movement cost table separation).
14. **Resolved Inactive Products Internal Use Policy**: Product Owner approved policy prohibiting `internal_use` movements when a product is inactive (`PRODUCT_INACTIVE_INTERNAL_USE_BLOCKED`, SQLSTATE `P0023`, HTTP 422). Product reactivation via `products:update` is required before store usage or sample allocations can be recorded. All `[NEEDS CLARIFICATION]` tags removed.
15. **Idempotency Semantic Discriminator Readiness**: Retained completed idempotency semantic-discriminator audit as an independent readiness check, confirming that `quantity_semantics` (`'quantity_delta'` vs `'target_physical_count'`) prevents hash collisions between stocktake reconciliation and delta adjustments.
16. **Mandatory Quantity-Semantics Server-Side Validation & Signature Management**: Codified explicit server-side conditional validation in Layer 2 `execute_stock_movement` using an explicit `IF ... RAISE EXCEPTION` block (`ERRCODE = 'P0033'`, `MESSAGE = 'INVALID_QUANTITY_SEMANTICS'`; avoiding PL/pgSQL `ASSERT`). Mandated exact parameter-qualified signatures (`public.execute_stock_movement(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, INTEGER, TEXT)`) for all `GRANT`/`REVOKE` statements, and explicit `DROP FUNCTION IF EXISTS` cleanup for legacy or overloaded signatures.

---

## Cross-Feature Verification

| Reference | Claim in Feature 004 | Status | Evidence / Repository Document |
|---|---|:---:|---|
| **Feature 001** | `organizations.timezone` (IANA format, default 'UTC') defines local boundaries for date-range filters in movement history. | **VERIFIED** | Confirmed in `specs/001-auth-organization/spec.md` (`FR-008`, `FR-010`, Entity 1 `organizations.timezone`). |
| **Feature 001** | `created_by REFERENCES profiles(id) ON DELETE RESTRICT` maintains movement attribution; employee profiles are deactivated or anonymized, never hard-deleted while history exists. | **PARTIALLY VERIFIED** | Database FK restriction pattern (`created_by ... ON DELETE RESTRICT`) is verified against Feature 001 schema; employee membership status revocation is verified against Feature 002 `FR-029`. Explicit profile anonymization/deletion is a Feature 004 retention policy assumption, not an explicit Feature 001 requirement. |
| **Feature 002** | Granular colon-delimited permissions (`inventory:read`, `inventory:receive`, etc.) and `check_user_permission()` evaluate Owner dynamic catalog access. | **VERIFIED** | Confirmed in `specs/002-employee-rbac/spec.md` (RBAC Section 4, rule 3 of `check_user_permission()`). |
| **Feature 002** | Predefined roles are `owner`, `admin`, `manager`, and `cashier`. | **VERIFIED** | Confirmed in `specs/002-employee-rbac/spec.md` and database enum `public.app_role`. |
| **Feature 003** | Product hard deletion is completely prohibited in normal operations (`BR-015`); soft archival (`products:archive`) is the sole retirement mechanism. | **VERIFIED** | Confirmed in `specs/003-products-categories/spec.md` (`BR-015`). |
| **Feature 003** | Supplier acquisition costs reside in dedicated `public.product_costs` table with RLS requiring `products:read_cost`. | **VERIFIED** | Confirmed in `specs/003-products-categories/spec.md` (Section 2, Entity 3). |
| **Feature 003** | Currency exponent helper `public.get_currency_exponent()` formats monetary valuation in organization currency. | **VERIFIED** | Confirmed in `specs/003-products-categories/spec.md` (Valuation formula, helper catalog). |
| **Feature 003** | Product UOM cannot change between discrete and continuous classes when stock > 0 or history exists (`FR-INV-030`). | **PARTIALLY VERIFIED** | The 13 retail UOM values are verified in Feature 003 (`BR-017`, `chk_products_uom`). However, UOM classification (discrete vs continuous) and mutation restriction when stock > 0 are new Feature 004 business rules that must be integrated into product updates during Feature 004 implementation. |
