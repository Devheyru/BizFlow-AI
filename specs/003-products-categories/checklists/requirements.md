# Specification Quality Checklist: Feature 003 — Products & Categories

**Purpose**: Validate specification completeness, architectural alignment, and quality before proceeding to planning
**Created**: 2026-11-06
**Last Updated**: 2026-11-06 (Final Pass — Storage Authorization & Membership Check Hardening)
**Feature**: [spec.md](../spec.md)
**Governing Documents**:
- [BizFlow AI Constitution v1.1.0](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/.specify/memory/constitution.md)
- [Feature 001 Specification](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/specs/001-auth-organization/spec.md)
- [Feature 002 Specification](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/specs/002-employee-rbac/spec.md)

---

## 1. Content Quality

- [x] **No Leaky Implementation Details in Scenarios**: User stories, scenarios, and success criteria focus purely on business value, user outcomes, and observable system behavior without referencing frontend frameworks or internal component code.
- [x] **Focused on Business & Retail Needs**: Captures core retail workflows: catalog discovery, item registration, pricing, category management, lifecycle archival, and cost protection.
- [x] **Clear Stakeholder Language**: Functional requirements and business rules are written unambiguously for product managers, store operators, and engineers alike.
- [x] **All Mandatory Sections Completed**: Includes User Scenarios, Edge Cases, Functional Requirements, Non-Functional Requirements, Key Entities, Success Criteria, Business Rules, Role-Permission Matrix, Dependencies, Assumptions, and Risks.

---

## 2. Requirement Completeness & Business Rule Consistency

- [x] **Zero Ambiguous Alternatives**: Removed conflicting phrases (such as "retain or disassociate"). Established explicit deterministic policies for all lifecycle events.
- [x] **No Unresolved Clarifications**: All 21 architectural and domain decisions are resolved, documented, and bound to testable requirements.
- [x] **Requirements are Testable & Unambiguous**: Every functional requirement (`FR-001` through `FR-045`) is specific, verifiable, and assigned a stable identifier.
- [x] **Success Criteria are Measurable**: Defined 12 technology-agnostic, quantifiable metrics (`SC-001` through `SC-012`) covering latency, data isolation, task completion, cross-tenant protection, currency precision, storage invariants, and superuser bypass mitigation.
- [x] **Comprehensive Acceptance Scenarios**: 40 Given/When/Then scenarios covering positive paths, negative paths, boundary conditions, concurrent edits, attack scenarios, and physical deletion denial.
- [x] **Clear Scope Boundaries**: Explicitly excludes stock counts, inventory movements, purchase orders, sales transactions, POS checkout, invoices, and AI assistant logic.

---

## 3. Database Architecture & Constraint Correctness

- [x] **Tenant-Aware Category Integrity (Composite Foreign Key with PostgreSQL 15+ Syntax)**:
  - `product_categories` exposes composite unique key: `CONSTRAINT uq_categories_org_id UNIQUE (organization_id, id)`.
  - `products` defines matching composite foreign key: `CONSTRAINT fk_products_org_category FOREIGN KEY (organization_id, category_id) REFERENCES public.product_categories (organization_id, id) ON DELETE SET NULL (category_id)`.
  - Column-specific `ON DELETE SET NULL (category_id)` (PostgreSQL 15+) nulls only `category_id`, preserving `organization_id NOT NULL`.
  - Cross-tenant category assignments are physically rejected by PostgreSQL without triggers.
- [x] **Tenant-Aware Cost Integrity (Composite Foreign Key)**:
  - `products` exposes composite unique key: `CONSTRAINT uq_products_org_id UNIQUE (organization_id, id)`.
  - `product_costs` defines composite foreign key: `CONSTRAINT fk_product_costs_org_product FOREIGN KEY (organization_id, product_id) REFERENCES public.products (organization_id, id) ON DELETE CASCADE`.
  - Redundant independent `product_id REFERENCES products(id)` FK is omitted.
  - Cross-tenant cost/product associations are physically rejected by PostgreSQL.
- [x] **Name Normalization & Uniqueness Invariants**:
  - `products.name` and `product_categories.name` are stored strictly trimmed of leading/trailing whitespace at both application and database RPC boundaries (`p_name := trim(p_name)`).
  - Display casing is preserved in storage.
  - Category uniqueness is case-insensitive on trimmed name: `CREATE UNIQUE INDEX uq_categories_org_name ON public.product_categories (organization_id, lower(trim(name)));`.
- [x] **Genuinely Flat Category Architecture**:
  - Removed speculative `parent_id` column and hierarchy logic entirely from the MVP.
- [x] **Category Physical Deletion Prohibited**:
  - Direct client `DELETE FROM product_categories` denied by RLS policy `USING (false)`.
  - No database RPC exposes category deletion. Soft archival (`categories:archive`) is the sole retirement mechanism.
  - Physical removal occurs strictly via organization deletion cascade (`ON DELETE CASCADE` on `organization_id`).
- [x] **SKU Normalization & Uniqueness**:
  - Trimmed, uppercase alphanumeric format enforced by database constraint `CHECK (sku = upper(trim(sku)) AND sku ~ '^[A-Z0-9_.-]{1,50}$')`.
  - Tenant-scoped uniqueness enforced by `CONSTRAINT uq_products_org_sku UNIQUE (organization_id, sku)`.
- [x] **Barcode Handling**:
  - Optional retail scanning identifier string; empty string converted to `NULL`.
  - Partial unique index: `CREATE UNIQUE INDEX uq_products_org_barcode ON public.products (organization_id, barcode) WHERE barcode IS NOT NULL;`.
  - No unsupported check-digit algorithm claims.
- [x] **Unit of Measure Validation**:
  - Enforced in database via `CHECK (unit_of_measure IN ('piece', 'unit', 'kg', 'g', 'mg', 'liter', 'ml', 'meter', 'cm', 'box', 'pack', 'pair', 'set'))`.
  - Matched in Zod validation schema. Default: `'piece'`.

---

## 4. Financial Invariance, Currency & Pricing Precision

- [x] **Universal Fixed-Point Storage**:
  - Prices stored as PostgreSQL `NUMERIC(14, 4)` to eliminate floating-point rounding errors and accommodate 0, 2, and 3-decimal ISO 4217 currencies.
  - Floating-point types (`FLOAT`, `DOUBLE PRECISION`, `REAL`) are strictly prohibited.
- [x] **Safe Serialization (PostgreSQL ↔ TypeScript)**:
  - `NUMERIC` values are serialized as strings by the Supabase JS client.
  - Parsing monetary strings with JavaScript `parseFloat()` or `Number()` is prohibited. Decimal library or string arithmetic required.
- [x] **Authoritative ISO 4217 Currency Exponent Source & Rejection of Unsupported Currencies**:
  - Immutable database helper function `public.get_currency_exponent(p_currency TEXT) RETURNS INTEGER` defines minor units (0, 2, 3, 4) with explicit CASE branches.
  - Zero default exponent fallback. Unsupported or unknown currency codes raise exception `P0009` immediately.
  - Application Zod validation mirrors identical supported catalog via `SUPPORTED_CURRENCIES` dictionary.
  - Selling price and cost price evaluate under identical currency-exponent precision constraints.
- [x] **Database-Enforced Currency Precision (No Silent Rounding)**:
  - Privileged RPCs (`create_product`, `update_product`) evaluate input decimals against `get_currency_exponent()`.
  - Values with excess decimal digits are rejected with error `P0009` without silent rounding.
- [x] **Concurrency-Safe Currency Lock**:
  - Product creation and price mutation RPCs execute `SELECT currency FROM public.organizations WHERE id = p_org_id FOR SHARE;` to block concurrent currency modifications.
  - Database trigger `prevent_currency_change_when_products_exist` on `public.organizations` blocks currency changes once products exist.
- [x] **Cost-Price Nullability Invariants (Resolved Contradiction)**:
  - Column `product_costs.cost_price NUMERIC(14, 4) NOT NULL CHECK (cost_price >= 0.0000)`.
  - No row in `product_costs` = unknown/unrecorded acquisition cost (application-layer cost is `null` via LEFT JOIN).
  - Row with `cost_price = 0.0000` = genuine zero-cost item.
  - Zero database NULL values stored in `cost_price`.
- [x] **Explicit Cost Update & Clearing Semantics**:
  - `update_product` accepts `p_cost_operation TEXT` with strictly validated domain: `'unchanged'`, `'set'`, `'clear'`. Invalid values raise `P0016`.
  - Never overloads SQL NULL to mean both "unchanged" and "clear".
  - `'unchanged'`: leaves `product_costs` untouched; does not require `products:read_cost`.
  - `'set'`: mandates `products:read_cost`, validates non-negative price and minor unit exponent, upserts into `product_costs`.
  - `'clear'`: mandates `products:read_cost`, deletes row from `product_costs` (reverting application-layer cost to `null`).
  - Plaintext numeric cost values are strictly excluded from audit logs.
- [x] **Selling Price Bounds**:
  - Non-negative constraint enforced: `CHECK (selling_price >= 0.00)`.
  - Zero selling price permitted for free promotional samples.
- [x] **Deterministic Gross Margin Calculation**:
  - Formula: `((selling_price - cost_price) / selling_price) * 100`.
  - Selling price = 0: Yields `N/A` ("—") without division-by-zero errors.
  - No `product_costs` row: Yields `N/A` ("—") with tooltip "Cost price not recorded".
  - Cost price > Selling price: Permitted with negative margin warning badge.
  - Cashier access: Cost and margin completely excluded from responses and UI.

---

## 5. Security, RBAC & Cost-Price Confidentiality

- [x] **SECURITY DEFINER RPC Authorization Contract (10 Mandatory Guarantees)**:
  - All catalog mutations execute via 9 dedicated privileged database functions owned by `postgres`.
  - Locked search path: `SET search_path = pg_catalog, public, pg_temp;`.
  - Revoke all privileges from PUBLIC; grant execute explicitly to `authenticated`.
  - Actor derived strictly from `auth.uid()`; caller-supplied actor IDs rejected.
  - Active tenant membership validated against `public.organization_memberships` using valid query-result checks (`IF NOT FOUND OR v_caller_role IS NULL THEN`).
  - Permission gate enforced inside the function via `public.check_user_permission()`.
  - Target entity ownership verified (`WHERE id = p_id AND organization_id = p_org_id`).
  - Lifecycle state, OCC `version`, and explicit `p_cost_operation` verified inside the function.
  - All checks reject before any DML.
  - **Superuser/Owner RLS Bypass Mitigation**: Spec explicitly documents that SECURITY DEFINER functions run as `postgres` (holding `BYPASSRLS`) and bypass table RLS. All internal function queries MUST procedurally enforce `WHERE organization_id = p_org_id`.
  - Cost-price disclosure protection: mutations require `products:read_cost` for `'set'` and `'clear'` (or fail with `P0005`), and return payloads omit cost prices for unauthorized roles.
  - Plaintext numeric cost values are strictly excluded from all audit metadata.
- [x] **Database-Backed Cost Confidentiality**:
  - Sensitive supplier acquisition costs isolated in `public.product_costs`.
  - Table-level RLS policy on `product_costs` enables and forces RLS (`FORCE ROW LEVEL SECURITY`).
  - Single permissive SELECT policy evaluated strictly via `public.check_user_permission(organization_id, auth.uid(), 'products:read_cost')`.
  - Direct client queries by Cashiers (via Supabase client or API) return 0 rows.
  - Direct client mutations denied via RLS `WITH CHECK (false)` / `USING (false)`.
- [x] **Direct Client Mutation Denial across Tables**:
  - `products`, `product_categories`, and `product_costs` all enforce `FORCE ROW LEVEL SECURITY` with direct client INSERT, UPDATE, DELETE denied via RLS.
  - Bulk removal only occurs via organization-level cascade (`ON DELETE CASCADE` on `organization_id`).
- [x] **Authoritative Feature 002 RBAC Integration**:
  - 9 permissions follow colon notation: `products:read`, `products:read_cost`, `products:create`, `products:update`, `products:archive`, `categories:read`, `categories:create`, `categories:update`, `categories:archive`.
  - All 9 permissions must be seeded into `public.permissions` via Feature 003 migration.
  - Deterministic role mapping: Owner (auto all 9), Admin (all 9), Manager (7 operational; no archive), Cashier (read catalog and categories only; no cost reading, no mutations).
  - Unknown permissions fail-closed (evaluate to `false`).
  - Suspended and revoked members immediately denied all tenant access.
- [x] **Zero Client Trust**:
  - Server never trusts client-supplied `organization_id`. Active tenant identity is derived server-side via `resolveTenantContext(slug)`.
  - Browser credentials limited to anon key + user JWT; service-role key is never exposed.
- [x] **Supabase Storage Ownership, Bucket Configuration & Signed URL Invariants**:
  - Bucket `product-images` is explicitly configured in `storage.buckets` with `id = 'product-images'`, `name = 'product-images'`, `public = false`, `file_size_limit = 5242880` (5 MB), and `allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]`. Implementation MUST verify these actual bucket settings and not rely on client-side or metadata-only checks. Direct public object paths (`/storage/v1/object/public/...`) are forbidden.
  - Product-first workflow: inside bucket `product-images`, object name is strictly `{organization_id}/{product_id}/{filename}` where folder extraction on `storage.objects.name` uses `(storage.foldername(name))[1]::uuid` for organization and `(storage.foldername(name))[2]::uuid` for product.
  - 4 explicit Storage RLS policies on `storage.objects`:
    - `SELECT`: requires authenticated user, active tenant membership, `products:read` permission, and target product existence in `public.products` with matching `organization_id` (`p.organization_id = folder_org_id`). Access is never granted on folder or membership alone.
    - `INSERT`: requires authenticated user, active tenant membership, `products:create` or `products:update`, target product existence and ownership, allowed MIME types, and <= 5MB.
    - `UPDATE`: **both `USING` and `WITH CHECK` independently enforce the complete authorization contract** (correct bucket ID, organization folder extraction and active caller membership, target product existence in that same organization, `products:update` permission, allowed MIME types, and <= 5MB size limit), completely preventing cross-tenant or cross-product destination path manipulation.
    - `DELETE`: requires authenticated user, active tenant membership, `products:update`, and target product existence and ownership.
  - Database stores strictly either stable relative object name without bucket prefix (`^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$`) or external HTTPS URL (`^https://.+`). Bucket-prefixed paths, expiring signed URLs, and public URLs are never persisted.
  - Application server dynamically generates short-lived signed URLs (1-hour expiration) on read via `supabase.storage.from('product-images').createSignedUrl(objectName, 3600)` passing the object name without bucket prefix.
  - Server NEVER fetches, downloads, or proxies image URLs (SSRF prevention).
  - Image Replacement: Superseded Storage objects deleted upon successful product update.
  - Abandoned Uploads: Daily background maintenance task purges unreferenced objects older than 24 hours.

---

## 6. Lifecycle, Concurrency & Audit Integrity

- [x] **Product Lifecycle (Three States, No Draft, No Hard Deletion)**:
  - Supported states: `active`, `inactive`, `archived`.
  - Product creation defaults to `active` (or `inactive`); `archived` prohibited at creation (`INVALID_CREATION_STATUS`).
  - Hard deletion (`DELETE FROM products`) completely excluded from normal workflows. Soft archival (`archived`) is the sole retirement mechanism.
  - Archived products retain SKU and barcode bindings permanently.
- [x] **Lifecycle Authorization Split**:
  - `updateProductAction` (`products:update`): core fields, no status mutation.
  - `toggleProductStatusAction` (`products:update`): active ↔ inactive only (accessible to Managers, Admins, Owners).
  - `archiveProductAction` & `restoreProductAction` (`products:archive`): archival/restoration (accessible to Admins, Owners only; rejected with HTTP 403 for Managers).
- [x] **Deterministic Category Archival**:
  - Archiving a category sets `status = 'archived'`.
  - Existing products retain `category_id` with `[Archived]` indicator in detail views.
  - Archived categories excluded from active assignment dropdowns.
  - Restoring an archived category re-enables it for new product assignments.
- [x] **Optimistic Concurrency Control (OCC)**:
  - `products.version` integer incremented on updates.
  - Mismatched expected version rejected with `STALE_UPDATE_CONFLICT` (HTTP 409). Zero silent lost updates.
- [x] **Audit Transactional Invariance**:
  - Business mutations and `organization_audit_events` insertions commit together or fail together in the same database transaction via SECURITY DEFINER PL/pgSQL functions.
  - Schema strictly conforms to existing `public.organization_audit_events` (no missing or invented columns).
  - Cost prices explicitly excluded from audit metadata to prevent leakage in audit logs.

---

## 7. Search Performance & Verification

- [x] **Deterministic Search Strategy & Trigram Mechanics**:
  - Prerequisite migration: `CREATE EXTENSION IF NOT EXISTS pg_trgm;`.
  - Dual indexing:
    - B-tree prefix index `idx_products_name_prefix` on `(organization_id, name text_pattern_ops)`.
    - Trigram GIN index `idx_products_name_trgm` on `name gin_trgm_ops`.
    - B-tree indexes on `(organization_id, sku)` and `(organization_id, barcode)`.
    - Composite B-tree index on `(organization_id, status, category_id)`.
  - 2-Character Search Behavior: Evaluates SKU/barcode matches (B-tree) and product name prefix matches (`name ILIKE 'query%'`, accelerated by prefix index). Documented accepted performance limitation if mid-word substring search is attempted for 2 characters.
  - 3+ Character Search Behavior: Full trigram substring matching (`name ILIKE '%query%'`) accelerated by trigram index.
- [x] **Measurable Performance Target & Benchmark Methodology**:
  - Max target catalog size: 10,000 items.
  - Target: p95 database query execution time $< 100$ms; end-to-end response time $< 400$ms.
  - Benchmark method: `EXPLAIN (ANALYZE, BUFFERS)` on worst-case query (`ILIKE '%term%'` with active RLS on 10,000 items).
  - Client debounce: 300ms. Minimum query length: 2 characters.
  - Deterministic sort tie-breakers: `ORDER BY name ASC, id ASC`.
  - Documented offset pagination behavior during concurrent updates; cursor-based pagination deferred to post-MVP.

---

## 8. Downstream Readiness

- [x] **Feature 004 (Inventory)**: Stable UUIDs ready for `stock_movements` ledger references.
- [x] **Feature 005 (Sales & POS)**: Sales line items contractually mandated to capture frozen historical snapshots of product name, SKU, cost, and selling price.
- [x] **No Scope Bleed**: Tax calculations, stock quantities, and physical warehouse management remain strictly out of scope.

---

## Verification Status

- **Status**: **PASSED — APPROVED FOR PLANNING**
- **Internal Consistency**: 100% verified across Decisions, Scenarios, Requirements, Entities, Constraints, Business Rules, and Checklists.
- **Next Step**: Await user review and authorization before invoking `/speckit-plan`.
