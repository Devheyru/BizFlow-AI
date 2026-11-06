# Research & Technical Decisions: Feature 003 — Products & Categories

**Feature Branch**: `003-products-categories`  
**Date**: 2026-11-06 (Reconciled with Approved Specification)  
**Status**: Authoritative Research & Technical Decisions  
**Governing Documents**:
- [BizFlow AI Constitution v1.1.0](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/.specify/memory/constitution.md)
- [Master Project Blueprint](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/docs/MASTER_PROJECT_BLUEPRINT.md)
- [Feature 003 Specification](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/specs/003-products-categories/spec.md)
- [Feature 003 Requirements Checklist](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/specs/003-products-categories/checklists/requirements.md)

---

## 1. Technical Decisions & Research Findings

### Decision 1: Hybrid RBAC Extension with 9 Granular Permissions

- **Context**: Feature 002 established a hybrid RBAC model with system-wide permissions in `public.permissions` and role assignments in `public.role_permissions`. Feature 003 introduces product and category management, which requires distinct access tiers across Cashier, Manager, Admin, and Owner.
- **Decision**: Register 9 new permissions in `public.permissions` and map them across roles in `public.role_permissions`:
  1. `products:read` (All roles: Owner, Admin, Manager, Cashier)
  2. `products:read_cost` (Owner, Admin only — strictly restricted)
  3. `products:create` (Owner, Admin, Manager)
  4. `products:update` (Owner, Admin, Manager)
  5. `products:archive` (Owner, Admin only)
  6. `categories:read` (All roles: Owner, Admin, Manager, Cashier)
  7. `categories:create` (Owner, Admin, Manager)
  8. `categories:update` (Owner, Admin, Manager)
  9. `categories:archive` (Owner, Admin only)
- **Authoritative Permission Resolution**:
  - Consistent with Feature 002, permissions must exist in `public.permissions`.
  - In both TypeScript (`hasPermission`) and PostgreSQL (`check_user_permission`), unregistered permissions evaluate to `false` for all roles.
  - Active Owner role receives `true` for all registered permissions.
  - Non-Owner roles check `public.role_permissions`.
  - Cashiers have read-only access to products and categories (selling prices visible, cost prices hidden). Managers can create/update catalog items but cannot archive or view acquisition costs. Admins and Owners have complete operational and financial visibility.

---

### Decision 2: Product Acquisition Cost Isolation Architecture & Creation Semantics

- **Context**: Product acquisition cost (`cost_price`) is confidential financial data. Cashiers and Managers must never be exposed to cost prices or gross margins in API responses, server action payloads, or client bundles.
- **Decision**: Implement a **two-tier defense-in-depth isolation strategy**:
  1. **Database-Tier Physical Table Separation & RLS**:
     - Separate cost into `public.product_costs (product_id PK, organization_id NOT NULL, cost_price NUMERIC(14, 4) NOT NULL CHECK (cost_price >= 0.0000))`.
     - Composite Foreign Key: `CONSTRAINT fk_product_costs_org_product FOREIGN KEY (organization_id, product_id) REFERENCES public.products (organization_id, id) ON DELETE CASCADE`.
     - Direct Organization FK: `CONSTRAINT fk_product_costs_org FOREIGN KEY (organization_id) REFERENCES public.organizations (id) ON DELETE CASCADE`.
     - Table has `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
     - SELECT policy enforces permission verification: `public.check_user_permission(organization_id, auth.uid(), 'products:read_cost')`.
     - Direct client DML is denied (`WITH CHECK (false)`, `USING (false)`).
     - Missing row in `product_costs` represents an unknown/unset cost (`null` in application layer). A row with `cost_price = 0.0000` represents an explicit zero cost.
  2. **Product Creation vs. Update Cost Semantics**:
     - **Product Creation (`create_product`)**: Does NOT use `p_cost_operation`. The presence or absence of `p_cost_price` controls cost record creation. The transaction executes in strict order: Authorization -> Full Validation (currency `FOR SHARE` lock) -> Insert Product first (`RETURNING id INTO v_product_id`) -> Insert Cost record into `public.product_costs` if `p_cost_price IS NOT NULL` using `v_product_id` (enforcing `products:read_cost` (`P0005`), non-negative (`P0007`), precision (`P0009`)) -> Insert Audit event -> Return. If `p_cost_price IS NULL`, no cost row is created. Supplied cost prices are NEVER silently ignored. Automatic transaction rollback guarantees that if cost or audit insertion fails, product creation rolls back completely.
     - **Product Update (`update_product`)**: Uses explicit `p_cost_operation` parameter with values `'unchanged' | 'set' | 'clear'`:
       - `'unchanged'`: Leaves `product_costs` untouched (used by Managers or when cost is not being modified).
       - `'set'`: Inserts or updates `product_costs.cost_price = p_cost_price` (requires `products:read_cost`, non-null and non-negative price).
       - `'clear'`: Deletes the row in `product_costs` (requires `products:read_cost`), resetting cost to unrecorded/unknown.
  3. **Application-Tier Dynamic Projection Stripping**:
     - Server Actions inspect `hasPermission(context, 'products:read_cost')`. If false, `cost_price` and derived `gross_margin` are stripped (`undefined`/omitted) from return payloads.

---

### Decision 3: Currency Validation, Monetary Precision & Concurrency Protection

- **Context**: Product selling prices and costs must maintain exact monetary precision matching the organization's configured currency, without silent truncation, rounding errors, or race conditions.
- **Decision**:
  1. **Authoritative ISO 4217 Currency Whitelist & Exponent Registry**:
     - Implement an immutable PostgreSQL function `public.get_currency_exponent(p_currency TEXT) RETURNS INTEGER`.
     - Whitelist supported currencies:
       - 0 decimal places: `JPY`, `KRW`, `VND`, `CLP`, `PYG`, `UGX`, `RWF`
       - 2 decimal places: `USD`, `EUR`, `GBP`, `CAD`, `AUD`, `NZD`, `CHF`, `SGD`, `HKD`, `SEK`, `NOK`, `DKK`, `MXN`, `BRL`, `INR`, `ZAR`, `KES`, `NGN`, `GHS`, `AED`, `SAR`, `QAR`, `EGP`, `COP`, `PEN`, `PHP`, `THB`, `IDR`, `MYR`
       - 3 decimal places: `BHD`, `KWD`, `OMR`, `JOD`, `TND`, `LYD`, `IQD`
       - 4 decimal places: `CLF`, `UYW`
     - Unknown or unlisted currency codes are **strictly rejected** by raising PostgreSQL error `P0009` (`VALIDATION_ERROR`). No default fallback exponent is permitted.
  2. **Dual-Boundary Monetary Precision Enforcement**:
     - Application layer validates decimal places against `SUPPORTED_CURRENCIES` dictionary via Zod.
     - Database RPCs acquire a row-level shared lock on `public.organizations`:
       ```sql
       SELECT o.currency INTO v_org_currency
       FROM public.organizations o
       WHERE o.id = p_org_id
       FOR SHARE;
       ```
     - Precision checks for `selling_price` and `cost_price`:
       ```sql
       v_max_decimals := public.get_currency_exponent(v_org_currency);
       IF p_selling_price * (10 ^ v_max_decimals) != round(p_selling_price * (10 ^ v_max_decimals)) THEN
           RAISE EXCEPTION 'Selling price exceeds maximum decimal places (%) for currency %',
               v_max_decimals, v_org_currency USING ERRCODE = 'P0009';
       END IF;
       ```
     - Zero silent rounding: excess decimal digits are rejected with error `P0009`.
  3. **Concurrency-Safe Currency Lock Guard**:
     - The `FOR SHARE` lock taken during price mutations blocks any concurrent `UPDATE organizations SET currency = ...` (which requires exclusive row lock `FOR UPDATE`).
     - Trigger `prevent_currency_change_when_products_exist` on `public.organizations`: If `UPDATE` attempts to change `currency` when `EXISTS (SELECT 1 FROM public.products WHERE organization_id = OLD.id)`, the transaction is aborted with error `P0015` (`STATE_CONFLICT`).

---

### Decision 4: Private Storage Bucket, Dual URL Protocol & Storage RLS

- **Context**: Product images are tenant-isolated assets. They must support both internal private storage and external HTTPS CDN links without cross-tenant leakage or SSRF.
- **Decision**:
  1. **Private Bucket Configuration**:
     - Bucket name: `product-images`, configured with `public = false`, `file_size_limit = 5242880` (5 MB), and allowed MIME types: `image/jpeg`, `image/png`, `image/webp`, `image/gif`.
  2. **Canonical Path Convention & Dual URL Protocol**:
     - Canonical internal Storage object name: `{organization_id}/{product_id}/{filename}` (stored in `products.image_url` **without bucket prefix**).
     - External HTTPS URLs: `^https://.+` stored directly as-is.
     - Server Actions inspect `products.image_url`:
       - If starting with `https://`, returned directly.
       - If matching internal object name, verified against tenant prefix and signed via `supabase.storage.from('product-images').createSignedUrl(objectName, 3600)` (1-hour TTL).
  3. **Storage RLS Security Contract (4 Policies on `storage.objects`)**:
     - **SELECT**: Verify caller is active org member (`is_org_member`), has `products:read`, and target product exists in same org.
     - **INSERT**: Verify active org membership, `products:create`/`products:update`, target product exists in same org, MIME type valid, size $\le 5$ MB.
     - **UPDATE**: Complete independent authorization across **BOTH** `USING` and `WITH CHECK` clauses, enforcing bucket, organization, membership, product ownership, `products:update`, MIME type, and size limit. Prevents cross-tenant/cross-product file movement.
     - **DELETE**: Verify active membership, `products:update`, and product entity ownership.
  4. **Storage Cleanup & Maintenance**:
     - Image replacement in `updateProductAction` triggers explicit deletion of the previous Storage object upon successful RPC commit.
     - Scheduled cron purges unreferenced objects older than 24 hours.

---

### Decision 5: Optimistic Concurrency Control (OCC) Architecture

- **Context**: Multi-user retail updates must prevent lost updates without blocking database reads.
- **Decision**:
  1. `version INT NOT NULL DEFAULT 1` on `public.products`.
  2. All product mutation RPCs require `p_expected_version INTEGER`.
  3. Row acquired via `SELECT version INTO v_current_version FROM public.products WHERE id = p_product_id AND organization_id = p_org_id FOR UPDATE;`
  4. If `v_current_version <> p_expected_version`, raise error `P0010` (`CONCURRENCY_CONFLICT` — HTTP 409).
  5. Upon successful mutation, `version` increments by 1.
  6. Server Action maps `P0010` and triggers client reload modal.

---

### Decision 6: Product & Category Lifecycle, Archival & Permanent Identifier Reservation

- **Context**: Retail operations require soft-archiving to preserve historical sales, orders, and inventory audit logs. Archiving must preserve referential and operational invariants without breaking downstream references.
- **Decision**:
  1. **Strict Lifecycle Representation**:
     - `products.status`: Exactly three states: `'active'`, `'inactive'`, `'archived'`.
     - `product_categories.status`: Exactly two states: `'active'`, `'archived'`.
     - `archived_at` and `archived_by` are audit metadata strictly synchronized with status `'archived'`.
     - Initial product creation strictly produces an `'active'` product. Any other initial status is rejected with error `P0015` (`STATE_CONFLICT`).
     - Permitted product transitions: `active` $\leftrightarrow$ `inactive`, `active` $\rightarrow$ `archived`, `inactive` $\rightarrow$ `archived`, `archived` $\rightarrow$ `active`. Invalid transitions (e.g., `archived` $\rightarrow$ `inactive` directly) are rejected with error `P0015`.
     - Permitted category transitions: `active` $\leftrightarrow$ `archived`.
  2. **Permanent SKU & Barcode Reservation**:
     - Archiving a product **permanently retains** its SKU and barcode. Archiving does NOT release an identifier for reuse.
     - Enforced via unconditional database constraints:
       - `CONSTRAINT uq_products_org_sku UNIQUE (organization_id, sku)`
       - `CREATE UNIQUE INDEX uq_products_org_barcode ON public.products (organization_id, barcode) WHERE barcode IS NOT NULL;`
     - Restoring a product can never fail due to identifier conflict, as no other product could have claimed its SKU or barcode.
  3. **Category Archival & Composite Foreign Key**:
     - Archiving a category transitions its status to `'archived'` without modifying associated products.
     - Associated products retain `category_id`.
     - Products cannot be assigned to an archived category (`P0015`).
     - Composite FK: `CONSTRAINT fk_products_org_category FOREIGN KEY (organization_id, category_id) REFERENCES public.product_categories (organization_id, id) ON DELETE SET NULL (category_id)`.
  4. **Organization Cascading Deletion**:
     - When an organization is deleted, `ON DELETE CASCADE` on `organization_id` removes categories, products, and costs cleanly without violating tenant isolation.

---

### Decision 7: Catalog Search, Filtering & Performance Targets (10,000 Products)

- **Context**: Performance must meet approved SLA targets on catalogs up to 10,000 items.
- **Performance Targets (Authoritative)**:
  - **Database query execution time (p95)**: $< 100$ms
  - **End-to-end response time (p95)**: $< 400$ms
- **Benchmark Methodology**:
  - **Dataset**: 10,000 synthetic products distributed across 50 categories for the target organization, with 5 background tenant organizations containing 2,000 products each (total 20,000 products in table).
  - **Workloads**:
    1. Exact SKU match (`WHERE organization_id = $1 AND sku = $2`)
    2. Barcode scan match (`WHERE organization_id = $1 AND barcode = $2`)
    3. Prefix name search (`WHERE organization_id = $1 AND name ILIKE 'term%'`)
    4. Trigram infix name search (`WHERE organization_id = $1 AND name ILIKE '%term%'`)
    5. Filtered pagination (`WHERE organization_id = $1 AND status = 'active' AND category_id = $2 ORDER BY created_at DESC LIMIT 20 OFFSET 0`)
  - **Measurement**: PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` over 100 executions; p95 calculated as the 95th percentile execution time. End-to-end measured via Playwright / HTTP test client measuring TTFB and SSR render time.
  - **Index Suite**: B-tree prefix index `(organization_id, name text_pattern_ops)`, GIN trigram index on `name`, composite index `(organization_id, status, category_id)`, unique B-tree on `(organization_id, sku)`.

---

### Decision 8: SECURITY DEFINER RPC Authorization Contract & Tenant Ownership

- **Context**: Privileged mutations execute with elevated permissions to atomically insert audit logs and manage `product_costs` while enforcing strict tenant isolation.
- **Decision**:
  - All 9 mutation operations are encapsulated in `SECURITY DEFINER` functions owned by `postgres` with fixed `search_path = pg_catalog, public, pg_temp;`.
  - Actor identity derived exclusively from `auth.uid()` (raises `P0003` if null; requires `is_email_verified()`, raises `P0001` if unverified).
  - Active membership verified in `organization_memberships` (raises `P0004` if not found).
  - Permission verified via `public.check_user_permission` (raises `P0005` if missing).
  - Target record ownership verified via `organization_id = p_org_id` (raises `P0002` if not found).
  - OCC version mismatch raises `P0010`.
  - Atomic audit log inserted into `public.organization_audit_events` with plaintext numeric costs excluded.

---

## 2. Authoritative SQLSTATE and Error-Code Registry

| SQLSTATE | Constant | HTTP Status | Provenance & Description |
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
