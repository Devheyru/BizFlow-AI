# Implementation Plan: Feature 003 — Products & Categories

**Branch**: `003-products-categories` | **Date**: 2026-11-06 (Reconciled with Approved Specification) | **Spec**: [specs/003-products-categories/spec.md](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/specs/003-products-categories/spec.md)

**Input**: Approved Feature Specification (`spec.md`), Requirements Checklist (`checklists/requirements.md`), and Research Findings (`research.md`).

---

## 1. Summary

Feature 003 implements a production-grade, multi-tenant product catalog and category management system for BizFlow AI. It provides retail operators with the foundation for catalog browsing, SKU and barcode indexing, category classification, pricing, confidential acquisition cost tracking, media asset handling, and soft-archival lifecycles.

The technical approach builds directly upon the established Feature 001 and 002 architectural baseline:
1. **Database & RBAC Foundation**: Schema migration creating `public.product_categories`, `public.products`, and isolated `public.product_costs` tables with composite foreign keys, permanent identifier uniqueness constraints, and 9 system permissions registered in `public.permissions` and `public.role_permissions`.
2. **Product Creation Semantics**: `create_product` accepts `p_status TEXT DEFAULT 'active'` and strictly creates products in `'active'` status (any other value raises `P0015`). Cost creation is governed strictly by the presence or absence of `p_cost_price` (no `p_cost_operation` parameter). When provided, `products:read_cost` is enforced, non-negative bounds and currency precision are validated, and a `public.product_costs` record is created; supplied cost prices are never silently ignored.
3. **Unit of Measure (UOM) Enforcement**: Both database check constraints and application Zod schemas strictly validate against the 13 approved retail units of measure (`piece`, `unit`, `kg`, `g`, `mg`, `liter`, `ml`, `meter`, `cm`, `box`, `pack`, `pair`, `set`), defaulting to `'piece'`.
4. **Permanent Identifier Reservation**: Products permanently retain their SKU (`CONSTRAINT uq_products_org_sku UNIQUE (organization_id, sku)`) and barcode (`CREATE UNIQUE INDEX uq_products_org_barcode ... WHERE barcode IS NOT NULL`) across all lifecycle states. Archiving a product never releases its SKU or barcode for reuse.
5. **Lifecycle Representation**: Exact lifecycle states:
   - Products: `'active'`, `'inactive'`, `'archived'` (permitted transitions: `active` $\leftrightarrow$ `inactive`, `active` $\rightarrow$ `archived`, `inactive` $\rightarrow$ `archived`, `archived` $\rightarrow$ `active`; direct `archived` $\rightarrow$ `inactive` rejected with `P0015`).
   - Categories: `'active'`, `'archived'` (permitted transitions: `active` $\leftrightarrow$ `archived`).
   - `archived_at` and `archived_by` are audit metadata strictly synchronized with status `'archived'`.
6. **Cost Confidentiality**: Physical separation of `cost_price` into `product_costs` with dedicated RLS SELECT policies requiring `products:read_cost` and application-tier projection stripping for Cashier and Manager roles.
7. **Currency Invariance & Concurrency Protection**: Immutable function `get_currency_exponent()` enforcing exact ISO 4217 minor unit validation (0, 2, 3, or 4 decimals; error `P0009` on unsupported currencies). Product mutations acquire a row-level shared lock (`SELECT ... FOR SHARE`) on `public.organizations` before validating precision, blocking concurrent currency changes while the `prevent_currency_change_when_products_exist` trigger aborts any attempt to mutate currency once products exist (`P0015`).
8. **Optimistic Concurrency Control (OCC)**: Integer `version` column on `products` incremented on every update, rejecting stale writes with `P0010` (`CONCURRENCY_CONFLICT`).
9. **Private Media Storage & Dual URL Protocol**: Private Supabase bucket `product-images` (max 5 MB, 4 MIME types) protected by 4 strict Storage RLS policies with dynamic 1-hour signed URL generation for internal relative paths and passthrough support for external HTTPS URLs.
10. **Performance SLA on 10,000 Products**: PostgreSQL `pg_trgm` GIN indexing and composite B-tree indexes guaranteeing database query execution time $< 100$ms (p95) and end-to-end response time $< 400$ms on catalogs up to 10,000 items per tenant.

---

## 2. Technical Context

- **Language/Version**: TypeScript 5.7.3, Node.js 22.x
- **Primary Dependencies**: Next.js 15.1.6 (App Router, Server Components & Server Actions), React 19.0.0, Supabase SSR (`@supabase/ssr` 0.5.2), Supabase JS Client (`@supabase/supabase-js` 2.48.1), Tailwind CSS 3.4.17, Zod 3.24.1, Lucide React 0.474.0, React Hook Form 7.54.2 with `@hookform/resolvers`
- **Storage**: PostgreSQL 15+ (Supabase) with Row-Level Security, private Supabase Storage bucket `product-images`
- **Testing**: Vitest 3.0.4 (Unit tests, Integration tests with PostgreSQL `pg`), Playwright 1.50.1 (E2E browser tests)
- **Target Platform**: Node.js runtime for Next.js Server Components / Actions, modern desktop and tablet retail web browsers (Chrome, Safari, Firefox, Edge)
- **Project Type**: Multi-tenant Retail SaaS Web Application (monorepo structure)
- **Performance Goals**: 
  - **Database query execution time (p95)**: $< 100$ms on catalogs up to 10,000 products per tenant
  - **End-to-end query response time (p95)**: $< 400$ms on catalogs up to 10,000 products per tenant
  - **Signed image URL resolution**: $< 50$ms
- **Constraints**: 
  - Strict multi-tenancy: every table contains `organization_id`; client tenant parameters are untrusted.
  - Zero exposed Supabase service-role keys.
  - Zero direct client DML on tables (all mutations mediated by `SECURITY DEFINER` RPCs).
  - Permanent identifier reservation for SKU and barcode (no reuse after archival).
  - Confidential cost data physically inaccessible to Cashier and Manager roles.
  - Strict ISO 4217 currency exponent enforcement (zero silent rounding; error `P0009` on excess decimals or unsupported currencies).
  - Dual image URL support: relative Storage paths (`{org_id}/{prod_id}/{filename}`) or external HTTPS URLs (`https://...`).
  - Cascading deletion from `organizations`: `ON DELETE CASCADE` removes catalog records upon tenant deletion, with unreferenced Storage objects purged via lifecycle maintenance.
- **Scale/Scope**: 10,000+ products per tenant, 9 system permissions, 9 database RPCs, 10 Server Actions, 4 responsive UI routes.

---

## 3. Constitution Check

*GATE: Must pass before implementation. All principles verified against BizFlow AI Constitution v1.1.0.*

- [x] **I. Multi-Tenancy & RLS**: All data entities (`product_categories`, `products`, `product_costs`) contain `organization_id`. `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` applied on all tables. Composite foreign keys `(organization_id, id)` prevent cross-tenant referencing. Tenant context resolved strictly on server via `resolveTenantContext(slug)`.
- [x] **II. Financial & Inventory Invariance**: Multi-record product and cost mutations execute atomically inside single database transactions. Currency exponents are mathematically enforced via immutable function `get_currency_exponent` without silent rounding; organization currency is locked via `FOR SHARE` locks during mutations and trigger `prevent_currency_change_when_products_exist` (`P0015`).
- [x] **III. Type Safety & Validation**: Strict TypeScript without `any`. Runtime validation using Zod on all Server Actions, RPC inputs, and forms. UOM validated against the 13 approved values.
- [x] **IV. Security & RBAC**: Dual-tier server-side permission verification (`hasPermission` in Next.js Server Actions and `check_user_permission` in PostgreSQL RPCs). No service-role key usage in application pathways. Cost data isolated via dedicated physical table `product_costs`, RLS SELECT policy, and projection stripping.
- [x] **V. AI Guardrails**: Product catalog and pricing structures are designed to serve human operators and authenticated workflows; AI integrations are strictly advisory and cannot autonomously create products or alter prices.

---

## 4. Project Structure & File Layout

### Documentation Artifacts (Feature 003)

```text
specs/003-products-categories/
├── spec.md                          # Approved feature specification
├── checklists/
│   └── requirements.md              # Requirements traceability checklist
├── plan.md                          # This master implementation plan
├── research.md                      # Phase 0 technical research & decisions
├── data-model.md                    # Phase 1 DDL, RLS, and RPC schemas
├── quickstart.md                    # Developer setup & test verification guide
└── contracts/
    ├── database-rpcs.md             # SQL RPC signatures, return formats, error codes (P0001-P0016)
    └── server-actions.md            # Server Action interfaces, Zod schemas, guards
```

### Source Code Layout (Repository Root)

```text
# Database Migrations & Seeds
supabase/migrations/
└── 20261106000010_products_categories_schema.sql     # Complete schema, triggers, RLS, storage, RPCs, seed

# Core Types
src/types/
├── database.ts                                        # Updated Supabase database types
└── product.ts                                         # Domain types: Product, Category, ProductCost, ViewModels, UOM

# Validation Schemas
src/lib/validations/
├── product.ts                                         # Zod schemas for CreateProduct, UpdateProduct, etc.
└── category.ts                                        # Zod schemas for CreateCategory, UpdateCategory

# Server Actions
src/actions/
├── product-actions.ts                                 # Server Actions for product CRUD, OCC, and dual URLs
└── category-actions.ts                                # Server Actions for category CRUD and archiving

# UI Components & Modules
src/components/
├── layout/
│   └── tenant-nav.tsx                                 # Updated navigation with Products menu item
└── products/
    ├── ProductTable.tsx                               # Responsive data table with sorting and badges
    ├── ProductFilters.tsx                             # Search bar, category filter, status tabs
    ├── ProductForm.tsx                                # Create/edit form with image dropzone & UOM selector
    ├── ProductDetailView.tsx                          # Detail view with metadata, version, audit timeline
    ├── CategoryManagerModal.tsx                       # Drawer/modal for category list and CRUD
    ├── ConcurrencyConflictModal.tsx                   # OCC conflict notification (P0010) and reload prompt
    └── ProductImageUploader.tsx                       # Image upload widget supporting private uploads & HTTPS URLs

# Tenant Application Routes
src/app/[slug]/products/
├── page.tsx                                           # Product catalog list view (RSC)
├── loading.tsx                                        # Loading skeleton for catalog
├── new/
│   └── page.tsx                                       # Product creation page (RSC wrapper)
├── [productId]/
│   ├── page.tsx                                       # Product detail view (RSC)
│   ├── loading.tsx                                    # Detail loading skeleton
│   └── edit/
│       └── page.tsx                                   # Product edit page (RSC wrapper)
└── categories/
    └── page.tsx                                       # Dedicated category management view (RSC)

# Automated Test Suites
tests/
├── unit/
│   ├── validations/
│   │   ├── product.test.ts                            # Zod product schema tests (13 UOMs, SKU regex, prices)
│   │   └── category.test.ts                           # Zod category schema tests
│   └── actions/
│       ├── product-actions.test.ts                    # Unit tests for product Server Actions
│       └── category-actions.test.ts                   # Unit tests for category Server Actions
├── integration/
│   ├── products-categories-rls.test.ts                # Direct DML denial & tenant isolation tests
│   ├── product-cost-confidentiality.test.ts           # Cost isolation & cashier permission tests
│   └── product-rpcs.test.ts                           # 9 RPC execution, OCC (P0010), currency validation tests
└── e2e/
    └── products-catalog.spec.ts                       # Playwright E2E full user journey tests
```

---

## 5. Authoritative SQLSTATE and Error-Code Registry

All database RPCs and Server Action error mappers adhere to this unified registry:

| SQLSTATE | Constant | HTTP Status | Provenance & Meaning |
|---|---|---|---|
| `P0001` | `EMAIL_UNVERIFIED` | 403 | Feature 001 convention & `spec.md` line 507: Caller email is not verified. |
| `P0002` | `RESOURCE_NOT_FOUND` | 404 | `spec.md` line 532: Target product or category does not exist in this organization. |
| `P0003` | `UNAUTHENTICATED` | 401 | Feature 001/002 convention & `spec.md` line 507: Authentication required (`auth.uid()` is null). |
| `P0004` | `UNAUTHORIZED_MEMBERSHIP` | 403 | Feature 002 convention & `spec.md` line 519: Caller is not an active member of organization. |
| `P0005` | `FORBIDDEN` | 403 | Feature 002 convention & `spec.md` lines 522, 537, 538: Insufficient RBAC permission. |
| `P0006` | `IDENTIFIER_EXISTS` | 409 | Feature 003 planning & `spec.md` line 1037: Duplicate SKU, Barcode, or Category Name in tenant. |
| `P0007` | `NEGATIVE_PRICE` | 400 | `spec.md` line 537: Selling price or cost price cannot be negative. |
| `P0008` | `MISSING_REQUIRED_PRICE` | 400 | Feature 001 convention & `spec.md` line 537: Cost price required when cost_operation is 'set'. |
| `P0009` | `VALIDATION_ERROR` | 400 | Feature 001/002 convention & `spec.md` line 173, 190: Currency, precision, UOM, or length error. |
| `P0010` | `CONCURRENCY_CONFLICT` | 409 | `spec.md` line 534: Stale update conflict: version does not match expected_version. |
| `P0011`–`P0014` | *(Unassigned)* | N/A | Reserved for future core modules. |
| `P0015` | `STATE_CONFLICT` | 409 | `spec.md` lines 221, 539: Conflict with current state (archived item, invalid transition, currency lock). |
| `P0016` | `INVALID_COST_OPERATION` | 400 | `spec.md` line 535: Invalid cost_operation on update (must be 'unchanged', 'set', or 'clear'). |

---

## 6. Implementation Roadmap & Phases

### Phase 1: Database Infrastructure, Migration, RLS & Storage

1. **Schema & Extensions**:
   - Create `supabase/migrations/20261106000010_products_categories_schema.sql`.
   - Ensure `pg_trgm` extension is enabled.
   - Define `public.product_categories`: `organization_id NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`, 2-state status (`active`, `archived`), length constraints, and unique index `(organization_id, lower(trim(name)))`.
   - Define `public.products`: `organization_id NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`, 3-state status (`active`, `inactive`, `archived`), 13 allowed UOM values, uppercase SKU format, dual image URL format, permanent unique constraint `uq_products_org_sku`, permanent unique index `uq_products_org_barcode`, and composite FK to `product_categories` with `ON DELETE SET NULL (category_id)`.
   - Define `public.product_costs`: composite FK `fk_product_costs_org_product` with `ON DELETE CASCADE`, org FK `fk_product_costs_org` with `ON DELETE CASCADE`.
2. **Immutable Functions & Triggers**:
   - Implement `public.get_currency_exponent(TEXT)` covering all ISO 4217 whitelist currencies and raising `P0009` on unknown.
   - Implement `public.prevent_currency_change_when_products_exist()` trigger on `public.organizations` raising `P0015`.
   - Attach `update_updated_at_column()` triggers to all three tables.
3. **RBAC Seed**:
   - Insert 9 catalog permissions into `public.permissions`.
   - Map permissions to `admin`, `manager`, and `cashier` in `public.role_permissions`.
4. **Row-Level Security**:
   - Enable and force RLS on `product_categories`, `products`, `product_costs`.
   - Create SELECT policies using `is_org_member(organization_id)`.
   - For `product_costs`, add `check_user_permission(organization_id, auth.uid(), 'products:read_cost')` to SELECT policy.
   - Create explicit DML denial policies (`WITH CHECK (false)`, `USING (false)`) for INSERT, UPDATE, DELETE on all three tables.
5. **Private Storage Bucket & Policies**:
   - Provision `product-images` bucket in `storage.buckets` (`public = false`, 5 MB limit, allowed MIME types).
   - Create 4 explicit policies on `storage.objects` for SELECT, INSERT, UPDATE, DELETE with independent `USING` and `WITH CHECK` on UPDATE to prevent cross-tenant/cross-product file tampering.
6. **Privileged Mutation RPCs**:
   - Implement `create_product(p_org_id, p_name, p_sku, p_selling_price, p_unit_of_measure, p_status, p_barcode, p_description, p_category_id, p_cost_price, p_image_url)`. Enforce strict execution ordering: Phase A (Authorization) -> Phase B (Validation & currency `FOR SHARE` lock) -> Phase C (Atomic Mutation: Insert Product first `RETURNING id INTO v_product_id` -> Insert Cost record if `p_cost_price IS NOT NULL` -> Insert Audit event -> Return). Automatic rollback on any failure ensures zero orphaned records.
   - Implement `update_product` with `p_cost_operation` (`'unchanged'`, `'set'`, `'clear'`) and OCC version checks (`P0010`).
   - Implement `toggle_product_status`, `archive_product`, `restore_product`, and category mutation RPCs using `P0001`–`P0016` error codes, currency concurrency row-level shared locks (`FOR SHARE`), and atomic audit logging.

---

### Phase 2: Domain Types, Validation Schemas & Utilities

1. **TypeScript Types**:
   - Update `src/types/database.ts` with new table definitions and RPC signatures.
   - Create `src/types/product.ts` defining domain models, view models, filter params, status types, and `UnitOfMeasure`.
2. **Runtime Zod Schemas**:
   - Create `src/lib/validations/category.ts`: `CreateCategorySchema`, `UpdateCategorySchema`.
   - Create `src/lib/validations/product.ts`:
     - `CreateProductSchema`: strictly validates attributes without `cost_operation`; validates `cost_price` if supplied.
     - `UpdateProductSchema`: includes `expected_version` and `cost_operation` (`unchanged`, `set`, `clear`).
   - Include `ALLOWED_UOM` enum validation (13 values), uppercase SKU transform, dual image URL refinement, and decimal precision checks against `SUPPORTED_CURRENCIES`.
3. **Helper Utilities**:
   - Currency formatting utility matching tenant exponent.
   - Deterministic gross margin calculation utility: handles zero selling price, negative margins, and unrecorded costs.

---

### Phase 3: Server Actions & Authorization Pipeline

1. **Category Actions (`src/actions/category-actions.ts`)**:
   - `createCategoryAction`: tenant resolution, `categories:create` check, Zod parse, `create_product_category` RPC call, revalidation.
   - `updateCategoryAction`: tenant resolution, `categories:update` check, Zod parse, `update_product_category` RPC call, revalidation.
   - `archiveCategoryAction`: tenant resolution, `categories:archive` check, `archive_product_category` RPC call, revalidation.
   - `restoreCategoryAction`: tenant resolution, `categories:archive` check, `restore_product_category` RPC call, revalidation.
2. **Product Actions (`src/actions/product-actions.ts`)**:
   - `createProductAction`: tenant resolution, `products:create` check, conditional `products:read_cost` check if `cost_price` supplied, Zod parse, RPC call with explicit `p_status: 'active'`, projection stripping, revalidation.
   - `updateProductAction`: tenant resolution, `products:update` check, conditional `products:read_cost` check if cost changed/cleared, OCC version handling, RPC call, projection stripping, image replacement cleanup, revalidation.
   - `toggleProductStatusAction`: tenant resolution, `products:update` check, OCC version check, RPC call, revalidation.
   - `archiveProductAction`: tenant resolution, `products:archive` check, OCC version check, RPC call, revalidation.
   - `restoreProductAction`: tenant resolution, `products:archive` check, OCC version check, RPC call, revalidation.
   - `getSignedProductImageUrlAction`: dual URL protocol (external HTTPS URLs passed through directly; internal relative paths verified against tenant prefix and signed with 3600s TTL).
3. **Error Mapping Middleware**:
   - Centralized handler translating `P0001` through `P0016` into user-friendly localized messages.

---

### Phase 4: UI Components, Views & Navigation Integration

1. **Navigation Integration**:
   - Update `src/components/layout/tenant-nav.tsx` to include "Products" link with `Package` Lucide icon.
   - Display link to all users with `products:read` permission.
2. **Product Catalog Page (`src/app/[slug]/products/page.tsx`)**:
   - Server Component fetching paginated products and categories via Supabase SSR client.
   - Search bar with debounce, category filter dropdown, status tabs (Active, Inactive, Archived, All).
   - Render `ProductTable` with SKU, Name, Category, Selling Price, UOM badge, Status badge, and contextual actions.
   - If user has `products:read_cost`, display Cost Price and Gross Margin column; otherwise hide completely.
   - "Add Product" button (visible only with `products:create`).
3. **Product Form (`src/components/products/ProductForm.tsx` & routes)**:
   - Shared form component for `new/page.tsx` and `[productId]/edit/page.tsx`.
   - Form fields: Name, SKU, Barcode, Category dropdown, Selling Price, Unit of Measure (13 options).
   - Cost section: Rendered only if user has `products:read_cost` permission.
   - Image uploader: Upload to Supabase Storage or enter external HTTPS URL.
   - Handles OCC version submission on edit; catches `CONCURRENCY_CONFLICT` (`P0010`) and displays `ConcurrencyConflictModal`.
4. **Product Detail Page (`src/app/[slug]/products/[productId]/page.tsx`)**:
   - Server Component displaying full product metadata, category, UOM, dynamic signed image URL or external URL, selling price.
   - Confidential financial panel (Cost, Gross Margin) if authorized.
   - Audit event history timeline from `organization_audit_events`.
   - Action buttons: Edit, Toggle Status, Archive, Restore.
5. **Category Manager (`src/components/products/CategoryManagerModal.tsx` & `/categories`)**:
   - Table showing category names, descriptions, active product count, and status (`active` / `archived`).
   - Modal form to create/edit categories.
   - Archive and restore category actions with confirmation dialogs.

---

### Phase 5: Testing, Performance Benchmarking & Hardening

1. **Unit Testing**:
   - Test all Zod schemas against valid and edge-case inputs (13 UOMs, SKU regex, barcode regex, negative prices, null handling).
   - Test Server Action guard logic, error mapping (`P0001`-`P0016`), and cost projection stripping.
2. **Integration Testing (PostgreSQL + RLS + RPCs)**:
   - Direct DML denial tests: Verify direct `INSERT`, `UPDATE`, `DELETE` fail via PostgREST/client connection.
   - Tenant isolation tests: Verify Tenant A cannot read or mutate Tenant B's products or categories.
   - Cost confidentiality tests: Verify Cashier client cannot read `product_costs` via RLS or Server Action.
   - Creation cost tests: Verify that a supplied cost price is inserted into `public.product_costs`, while null cost creates zero rows. Verify `products:read_cost` is required to supply cost.
   - Permanent identifier reservation tests: Verify that archiving a product does not permit creating another product with the same SKU or barcode.
   - OCC tests: Verify `P0010` is raised when expected version mismatches.
   - State conflict tests: Verify `P0015` (`STATE_CONFLICT`) is raised for invalid status transitions, mutating archived items, or changing locked currency.
   - Storage RLS tests: Verify cross-tenant image access denial and upload permission enforcement.
3. **Performance Benchmarking (10,000 Products)**:
   - Dataset: 10,000 synthetic products across 50 categories for tenant, plus multi-tenant background data (20,000 total rows).
   - Measure 5 query workloads under warm buffer conditions over 100 runs.
   - Verify: Database execution time $< 100$ms (p95); End-to-end response time $< 400$ms (p95).
4. **End-to-End Testing (Playwright)**:
   - User Story 1: Browse catalog, search by name, filter by category and status.
   - User Story 2: Create product with SKU, barcode, UOM, and optional cost; verify duplicate detection.
   - User Story 3: View product detail, perform concurrent edit in two sessions, verify OCC modal (`P0010`).
   - User Story 4: Category creation, editing, product assignment, category archival without product loss.
   - User Story 5: Product status toggle (active/inactive), archiving, and restoring with permanent SKU reservation.
   - User Story 6: Cashier role experience: verify cost prices and margins are invisible across UI and network tabs.

---

## 7. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation Strategy |
|---|---|---|---|
| Confidential Cost Leakage to Cashiers/Managers | High | Medium | Dual-tier protection: dedicated physical `product_costs` table with restrictive RLS SELECT policy + explicit projection stripping in Server Actions before RSC rendering. |
| Lost Updates Under Concurrent Multi-User Edits | Medium | High | Optimistic Concurrency Control with integer `version` checked in row-locking SQL RPCs (`P0010`) and client reload modal. |
| Slow Search in Large Catalogs (10,000+ items) | Medium | Medium | PostgreSQL `pg_trgm` GIN index on product names + composite B-tree indexes on `(org_id, status, category_id)` and prefix B-tree on `name`. Target $< 100$ms DB p95. |
| Cross-Tenant Image Asset Access or Tampering | High | Low | Private Supabase Storage bucket with 4 explicit RLS policies verifying tenant membership and product entity linkage on both `USING` and `WITH CHECK` clauses. |
| Monetary Precision Corruption across Currencies | High | Low | Immutable `get_currency_exponent()` rejecting unlisted currencies (`P0009`), fractional math checks, `FOR SHARE` concurrency lock, and trigger preventing currency change on organizations with products (`P0015`). |
| Storage Orphan Accumulation on Tenant Deletion | Low | Medium | Database cascades clean up relational tables on tenant deletion (`ON DELETE CASCADE`); image replacement cleans up old images in Server Actions; 24-hour background cron purges unreferenced Storage objects. |

---

## 8. Planning Sign-Off & Next Steps

This implementation plan satisfies all requirements set forth in the BizFlow AI Constitution v1.1.0, the Master Project Blueprint, and the approved Feature 003 Specification.

Upon user authorization, the next execution step is **`/speckit-tasks`** to generate the dependency-ordered `tasks.md` task breakdown.
