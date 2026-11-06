# Feature Specification: Products & Categories

**Feature ID**: 003
**Feature Name**: Products & Categories
**Feature Branch**: `003-products-categories`
**Created**: 2026-11-06
**Status**: Approved (Final Corrections Verified — Ready for Planning)
**Development Phase**: Web MVP
**Governing Documents**:
- [BizFlow AI Constitution v1.1.0](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/.specify/memory/constitution.md)
- [Master Project Blueprint](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/docs/MASTER_PROJECT_BLUEPRINT.md)
- [Feature 001 Specification & Architecture](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/specs/001-auth-organization/spec.md)
- [Feature 002 Specification & Architecture](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/specs/002-employee-rbac/spec.md)

**Input**: User description: "Feature 003: Products & Categories establishes the product catalog foundation for BizFlow AI. It allows authorized retail employees to create product categories, organize products into categories, register products, edit product information, view product details, search and filter products, manage product availability/status, archive products, and maintain unique product identifiers within the correct organization. The feature must integrate naturally with the existing BizFlow AI architecture, authentication, organization membership, RBAC, PostgreSQL security model, and future inventory and sales modules."

---

## Clarifications & Architectural Decisions

### Session 2026-11-06 (Remediation & Architectural Alignment)

1. **Cost-Price Confidentiality Strategy (Database-Backed Security)**:
   - *Problem*: PostgreSQL Row-Level Security (RLS) filters rows, not columns. If `cost_price` is a column on `public.products` and `authenticated` has table `SELECT` privileges, a Cashier could bypass application projection and read `cost_price` directly via the Supabase client (`supabase.from('products').select('cost_price')`).
   - *Architecture*: To guarantee database-enforced confidentiality without relying on privileged service-role bypasses:
     - General product attributes (`name`, `sku`, `barcode`, `description`, `category_id`, `selling_price`, `unit_of_measure`, `image_url`, `status`, `version`) reside on `public.products`.
     - Supplier acquisition costs reside in a dedicated 1:1 table `public.product_costs`. See Entity 3 for the full schema.
     - `public.product_costs` has Row-Level Security enabled and **forced** (`ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY; ALTER TABLE public.product_costs FORCE ROW LEVEL SECURITY;`).
     - A single permissive SELECT policy (the only SELECT policy on this table) restricts access via the authoritative Feature 002 permission helper:
       ```sql
       CREATE POLICY "product_costs_select" ON public.product_costs
           FOR SELECT TO authenticated
           USING (public.check_user_permission(organization_id, auth.uid(), 'products:read_cost'));
       ```
       Because this is the **only** permissive SELECT policy and `FORCE ROW LEVEL SECURITY` is active, callers without `products:read_cost` receive 0 rows. No `RESTRICTIVE` keyword is required when no other permissive SELECT policy exists.
     - **Table grants**: `GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_costs TO authenticated;`. All mutations are blocked at the RLS layer by `WITH CHECK (false)` policies; the grant exists only so the row-level policies can evaluate.
     - **Mutation isolation**: All `product_costs` mutations (insert, update, delete) execute exclusively through SECURITY DEFINER database functions owned by `postgres` with a fixed `SET search_path = pg_catalog, public, pg_temp`. No direct client-side `INSERT`, `UPDATE`, or `DELETE` on `product_costs` succeeds.
     - **Explicit mutation-denial policies**:
       ```sql
       CREATE POLICY "product_costs_insert_deny" ON public.product_costs
           FOR INSERT TO authenticated WITH CHECK (false);
       CREATE POLICY "product_costs_update_deny" ON public.product_costs
           FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
       CREATE POLICY "product_costs_delete_deny" ON public.product_costs
           FOR DELETE TO authenticated USING (false);
       ```
     - **Browser credential model**: The browser holds only the Supabase anon key plus the user's JWT. The service-role key is NEVER exposed to the browser or client-side JavaScript.
     - *Security Invariant*: If a user with the `Cashier` role directly queries `product_costs` via Supabase client, REST API, or GraphQL, PostgreSQL RLS evaluates `check_user_permission` to `false` and returns 0 rows. In Server Actions and React Server Components, the server additionally evaluates `hasPermission(context, 'products:read_cost')` before querying `product_costs`. If no `product_costs` row exists for a product, the application receives a LEFT JOIN `NULL` for cost — representing unknown/unrecorded cost, NOT a database NULL stored in the row (which is prohibited; see Decision 8 and Entity 3).  The cost price is physically inaccessible to unauthorized users across all access paths.

2. **Cross-Tenant Category Referential Integrity (Declarative Composite Foreign Key)**:
   - *Problem*: A standard foreign key `products.category_id REFERENCES product_categories(id)` does not guarantee that both rows share the same `organization_id`.
   - *Architecture*: The database enforces tenant integrity declaratively via a composite foreign key:
     - `public.product_categories` defines a composite unique constraint:
       ```sql
       CONSTRAINT uq_categories_org_id UNIQUE (organization_id, id)
       ```
     - `public.products` defines a matching composite foreign key:
       ```sql
       CONSTRAINT fk_products_org_category
           FOREIGN KEY (organization_id, category_id)
           REFERENCES public.product_categories (organization_id, id)
           ON DELETE SET NULL (category_id)
       ```
     - *Guarantee*: In PostgreSQL, when `category_id` is NOT NULL, the composite foreign key mandates that `(organization_id, category_id)` exists in `product_categories`. Because `products.organization_id` is part of the foreign key, it is impossible for a product in Organization A to reference a category in Organization B. The constraint is enforced natively by PostgreSQL without triggers or procedural overhead.
   - *`ON DELETE SET NULL (category_id)` column-specific syntax* (PostgreSQL 15+): Supabase Cloud runs PostgreSQL 15+, which supports the column-list variant of `SET NULL`. This syntax nulls only `category_id` (the nullable column) while preserving `organization_id NOT NULL`. Without this column-list syntax, `ON DELETE SET NULL` would attempt to null BOTH `organization_id` AND `category_id`, violating the `organization_id NOT NULL` constraint. This is the required syntax; `ON DELETE RESTRICT` is not preferred because physical category deletion as an edge-case safety net is acceptable (actual category lifecycle uses archival, not deletion).
   - *Physical Category Deletion*: Normal category lifecycle uses archival (`status = 'archived'`), not hard deletion. Physical deletion of a category (which would trigger this FK) is not a supported Feature 003 user action. The `ON DELETE SET NULL (category_id)` behavior is a database-level safety net for org-cascade deletion scenarios (e.g., `ON DELETE CASCADE` on `product_categories.organization_id`).

3. **PostgreSQL Category Uniqueness Syntax**:
   - Table-level `UNIQUE (organization_id, lower(trim(name)))` is invalid in PostgreSQL because table constraints accept column names, not expressions.
   - The specification mandates a unique expression index:
     ```sql
     CREATE UNIQUE INDEX uq_categories_org_name
         ON public.product_categories (organization_id, lower(trim(name)));
     ```
   - Application validation trims whitespace prior to length validation. Display casing is preserved in storage (`name`), but uniqueness is enforced case-insensitively at the database engine level.

4. **Genuinely Flat Category Architecture**:
   - Feature 003 Web MVP implements a **strictly flat (single-level) category model**.
   - The speculative `parent_id` column is completely removed from the schema and requirements.
   - Hierarchical category structures (parent-child trees, nested path queries, cycle detection) are explicitly deferred to a future post-MVP migration.

5. **Deterministic Category Archival Policy**:
   - Archiving a category (`status = 'archived'`) transitions its status without altering associated product records.
   - Associated products retain their `category_id`.
   - Product details views display the category name with an `[Archived]` indicator.
   - Archived categories are omitted from active category selection dropdowns in product creation and editing interfaces.
   - In catalog category filtering, archived categories are hidden from the filter list by default (accessible only when "Include Archived" is explicitly toggled).
   - Assigning an archived category to a new or updated product is strictly rejected (`CATEGORY_ARCHIVED_ASSIGNMENT_FORBIDDEN`).
   - Category restoration: Authorized users holding `categories:archive` (Owner and Admin) can restore an archived category back to `active`, re-enabling it for product assignments.

6. **Product Lifecycle & Retirement (No Draft, No Hard Deletion)**:
   - Exactly three lifecycle states are supported: `active`, `inactive`, and `archived`.
   - Product creation produces an `active` product (or `inactive` if specified at creation). No "draft" state exists in Feature 003.
   - Permitted transitions:
     - `active` $\leftrightarrow$ `inactive`: Authorized via `products:update` (Owner, Admin, Manager).
     - `active` $\rightarrow$ `archived`: Authorized via `products:archive` (Owner, Admin).
     - `inactive` $\rightarrow$ `archived`: Authorized via `products:archive` (Owner, Admin).
     - `archived` $\rightarrow$ `active`: Authorized via `products:archive` (Owner, Admin).
   - Invalid transitions (e.g., `archived` $\rightarrow$ `inactive` directly) are rejected with error `INVALID_STATUS_TRANSITION`.
   - Normal product management does NOT expose hard deletion (`DELETE FROM products`). Soft archival (`archived`) is the standard, permanent retirement mechanism.
   - Archived products permanently retain their SKU and barcode to preserve audit history and prevent confusion with future inventory/sales records.

7. **Identifier & Name Normalization and Uniqueness Rules**:
   - **Product & Category Name Normalization**:
     - Both `products.name` and `product_categories.name` MUST be stored strictly trimmed of leading and trailing whitespace.
     - Dual-boundary normalization: The application layer trims input via Zod `.trim()`, and database mutation RPCs execute `p_name := trim(p_name)` prior to length checks and persistence.
     - Display casing is preserved exactly as entered by the user (no lowercase conversion in storage).
     - Category name uniqueness is case-insensitive on trimmed values, enforced by unique expression index `uq_categories_org_name ON public.product_categories (organization_id, lower(trim(name)))`.
     - Length constraints: Product name `char_length(trim(name)) BETWEEN 1 AND 150`; Category name `char_length(trim(name)) BETWEEN 1 AND 100`.
   - **SKU (Stock Keeping Unit)**:
     - Mandatory business product identifier.
     - Normalized: trimmed of leading/trailing whitespace and converted to uppercase at both application and database RPC boundaries (`p_sku := upper(trim(p_sku))`).
     - Character set: `^[A-Z0-9_.-]{1,50}$`.
     - Database check constraint: `CHECK (sku = upper(trim(sku)) AND sku ~ '^[A-Z0-9_.-]{1,50}$')`.
     - Database uniqueness: `CONSTRAINT uq_products_org_sku UNIQUE (organization_id, sku)`.
     - Guarantees that neither direct SQL writes nor application actions can persist un-normalized or duplicate SKUs.
   - **Barcode**:
     - Optional retail scanning identifier (UPC-A, EAN-8, EAN-13, Code 128, Code 39, internal store barcodes).
     - The specification treats barcodes as general retail identifier strings; no proprietary EAN/UPC check-digit validation algorithm is imposed in Feature 003 to allow flexible internal store barcode schemes.
     - Normalized: trimmed of leading/trailing whitespace at both application and database RPC boundaries.
     - Empty string `""` or whitespace-only inputs are canonically converted to `NULL`.
     - Case-sensitive string comparison for general alphanumeric codes (`^[A-Za-z0-9-]{3,50}$`).
     - Database partial unique index:
       ```sql
       CREATE UNIQUE INDEX uq_products_org_barcode
           ON public.products (organization_id, barcode)
           WHERE barcode IS NOT NULL;
       ```
     - Multiple products may have `barcode IS NULL` without collision.

8. **Monetary Precision, Currency Binding, Cost-Price Nullability & Database-Enforced Precision**:
   - **Storage Precision**: All prices use PostgreSQL `NUMERIC(14, 4)` (up to 10 billion integer units with 4 fractional decimal digits). This accommodates 0-decimal currencies (JPY, KRW), standard 2-decimal currencies (USD, EUR, GBP, KES), and 3-decimal currencies (KWD, BHD) without schema modification.
   - **Currency Binding**: Products do not store an independent currency column. They strictly inherit the active organization's ISO 4217 currency established in `public.organizations.currency`.
   - **Selling Price Bounds**: Mandatory, non-negative (`selling_price >= 0.00`). A selling price of `0.00` is permitted for complimentary promotional items or zero-cost samples.
   - **Cost-Price Nullability & Storage Invariant**:
     - `cost_price NUMERIC(14, 4) NOT NULL CHECK (cost_price >= 0.0000)` — the column itself is NOT NULL within `product_costs`.
     - **No row in `product_costs`** = unknown/unrecorded acquisition cost (e.g., consignment items, untracked costs). The application-layer cost value is `null` (from a LEFT JOIN that finds no matching row).
     - **Row with `cost_price = 0.0000`** = genuine zero-cost acquisition (e.g., free gift, donation, zero-cost byproduct).
     - **Row with `cost_price > 0.0000`** = known positive cost.
     - This model cleanly differentiates "unknown cost" (no row) from "zero cost" (row with 0.00) without nullable columns. Zero database NULLs are ever stored in `cost_price`.
   - **Authoritative ISO 4217 Exponent Source & Strict Rejection of Unsupported Currencies**:
     - The authoritative minor-unit exponent is defined in PostgreSQL via an immutable helper function that strictly checks against the supported ISO 4217 currency catalog. **Zero fallback to two decimals is permitted for unknown currencies**:
       ```sql
       CREATE OR REPLACE FUNCTION public.get_currency_exponent(p_currency TEXT)
       RETURNS INTEGER
       LANGUAGE plpgsql
       IMMUTABLE
       PARALLEL SAFE
       SET search_path = pg_catalog, pg_temp
       AS $$
       DECLARE
           v_curr TEXT := upper(trim(p_currency));
       BEGIN
           CASE v_curr
               -- 0 decimal places
               WHEN 'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW',
                    'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF' THEN
                   RETURN 0;
               -- 3 decimal places
               WHEN 'BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND' THEN
                   RETURN 3;
               -- 4 decimal places
               WHEN 'CLF', 'UYW' THEN
                   RETURN 4;
               -- Explicitly supported 2 decimal places
               WHEN 'USD', 'EUR', 'GBP', 'KES', 'CAD', 'AUD', 'NZD', 'CHF',
                    'CNY', 'INR', 'ZAR', 'BRL', 'MXN', 'SGD', 'HKD', 'SEK',
                    'NOK', 'DKK', 'PLN', 'TRY', 'AED', 'SAR', 'EGP', 'NGN',
                    'GHS', 'TZS', 'PHP', 'THB', 'MYR', 'IDR', 'ILS', 'COP' THEN
                   RETURN 2;
               ELSE
                   RAISE EXCEPTION 'Unsupported or invalid ISO 4217 currency code: %', p_currency
                       USING ERRCODE = 'P0009';
           END CASE;
       END;
       $$;
       ALTER FUNCTION public.get_currency_exponent OWNER TO postgres;
       REVOKE ALL ON FUNCTION public.get_currency_exponent FROM PUBLIC;
       GRANT EXECUTE ON FUNCTION public.get_currency_exponent TO authenticated;
       ```
     - **Application Validation Mirror & Maintenance**: The application Zod schema mirrors this identical set via a TypeScript dictionary (`SUPPORTED_CURRENCIES: Record<string, number>`). Any submission where the active organization's currency is unlisted is rejected with an inline validation error `"Unsupported currency code: [CURRENCY]"`. When new retail currencies are onboarded, they MUST be added simultaneously to `get_currency_exponent` via database migration and to `SUPPORTED_CURRENCIES` in TypeScript.
     - **Unified Selling Price & Cost Price Rule**: Both `selling_price` and `cost_price` evaluate against the identical currency-exponent rules returned by `public.get_currency_exponent()`. Neither field is permitted to deviate from the organization currency's established minor-unit exponent.
   - **Database-Enforced Precision & Rejection of Excess Decimals (No Silent Rounding)**:
     - Privileged database mutation functions (`create_product`, `update_product`) MUST enforce the currency's minor-unit exponent directly before executing DML:
       ```sql
       v_max_decimals := public.get_currency_exponent(v_org_currency);
       -- Rejection check for selling price
       IF (p_selling_price * (10 ^ v_max_decimals)) <> trunc(p_selling_price * (10 ^ v_max_decimals)) THEN
           RAISE EXCEPTION 'Selling price exceeds maximum decimal places (%) for currency %',
               v_max_decimals, v_org_currency USING ERRCODE = 'P0009';
       END IF;
       -- Rejection check for cost price (if supplied)
       IF p_cost_price IS NOT NULL AND (p_cost_price * (10 ^ v_max_decimals)) <> trunc(p_cost_price * (10 ^ v_max_decimals)) THEN
           RAISE EXCEPTION 'Cost price exceeds maximum decimal places (%) for currency %',
               v_max_decimals, v_org_currency USING ERRCODE = 'P0009';
       END IF;
       ```
     - Input values with excess decimal digits are strictly rejected with error `P0009`. Silent rounding is strictly prohibited at both the application and database boundaries.
   - **Concurrency-Safe Currency Lock Mechanism**:
     - Preventing concurrent race conditions during product creation or price updates requires two coordinated PostgreSQL mechanisms:
       1. **Row-Level Read Lock in Mutation Functions**: When executing `create_product` or `update_product`, the function reads the organization's currency using a shared row lock:
          ```sql
          SELECT o.currency INTO v_org_currency
          FROM public.organizations o
          WHERE o.id = p_org_id
          FOR SHARE;
          ```
          The `FOR SHARE` lock guarantees that a concurrent transaction attempting to execute `UPDATE public.organizations SET currency = ...` (which requires an exclusive row lock, `FOR UPDATE`) is blocked until the product creation or update transaction commits.
       2. **Database Trigger Guard on `public.organizations`**: A `BEFORE UPDATE OF currency ON public.organizations` trigger rejects any attempt to mutate `currency` once products exist for the organization:
          ```sql
          CREATE OR REPLACE FUNCTION public.prevent_currency_change_when_products_exist()
          RETURNS TRIGGER
          LANGUAGE plpgsql
          SECURITY DEFINER
          SET search_path = pg_catalog, public, pg_temp
          AS $$
          BEGIN
              IF NEW.currency IS DISTINCT FROM OLD.currency THEN
                  IF EXISTS (SELECT 1 FROM public.products WHERE organization_id = OLD.id LIMIT 1) THEN
                      RAISE EXCEPTION 'Cannot change organization currency after products have been created'
                          USING ERRCODE = 'P0015';
                  END IF;
              END IF;
              RETURN NEW;
          END;
          $$;
          ```
   - **TypeScript Serialization Safety**: PostgreSQL `NUMERIC` values are serialized as strings by the Supabase JavaScript client (not JavaScript `number`). The application MUST NOT parse monetary strings into JavaScript `number` (floating-point). All monetary arithmetic MUST use string-based decimal arithmetic or a decimal library (e.g., `Decimal.js`, `big.js`). Using `parseFloat()` or `Number()` on monetary values is strictly prohibited.

9. **Deterministic Gross Margin Calculation**:
   - Gross Profit = `selling_price - cost_price`
   - Gross Margin % = `((selling_price - cost_price) / selling_price) * 100`
   - Rules:
     - When `selling_price > 0.00` and a `product_costs` row exists (application-layer cost is not `null`):
       - If `selling_price >= cost_price`: Calculates standard gross margin percentage (e.g., sell \$10, cost \$6 → 40.0%).
       - If `cost_price > selling_price`: Calculates negative gross margin percentage (e.g., sell \$10, cost \$15 → -50.0%) and displays an informational warning badge ("Negative Margin").
     - When `selling_price == 0.00`: Gross margin is mathematically undefined (division by zero). The system displays **N/A** ("—"), never `NaN`, `Infinity`, or an unhandled exception.
     - When no `product_costs` row exists (application-layer cost is `null` from LEFT JOIN): Gross margin cannot be computed. The system displays **N/A** ("—") with helper tooltip "Cost price not recorded".
     - For Cashiers: Gross margin and cost price are completely excluded from server responses and UI rendering.

10. **Optimistic Concurrency Control (OCC)**:
    - To prevent silent lost updates when multiple managers edit the same product concurrently:
    - `public.products` includes `version INTEGER NOT NULL DEFAULT 1`.
    - Edit submissions require `expected_version`.
    - Updates execute conditionally:
      ```sql
      UPDATE public.products
      SET ..., version = version + 1, updated_at = now(), updated_by = auth.uid()
      WHERE id = p_product_id AND organization_id = p_org_id AND version = p_expected_version;
      ```
    - If zero rows are updated, the server detects a concurrent edit collision and returns error `STALE_UPDATE_CONFLICT` (HTTP 409) with message: "This product was modified by another user. Please refresh and review the latest changes before saving."

11. **Realistic Search Performance & Indexing Strategy**:
    - Catalog size target: Up to 10,000 product records per organization.
    - Search fields:
      - Product Name: Case-insensitive text search accelerated by a dual-indexing strategy:
        - A B-tree prefix index `CREATE INDEX idx_products_name_prefix ON public.products (organization_id, name text_pattern_ops)` for prefix matching.
        - A trigram GIN index `CREATE INDEX idx_products_name_trgm ON public.products USING gin (name gin_trgm_ops)` via `pg_trgm` for partial substring matching.
      - SKU & Barcode: Exact and prefix matching accelerated by B-tree indexes on `(organization_id, sku)` and `(organization_id, barcode)`.
      - Category & Status: Filtered via composite B-tree index `(organization_id, status, category_id)`.
    - **Query Length Strategy & Trigram Mechanics**:
      - PostgreSQL `pg_trgm` decomposes text into 3-character sequences (trigrams). A query with fewer than 3 characters generates zero trigrams (`show_trgm('ab') = {}`), meaning GIN trigram indexes cannot accelerate arbitrary mid-word substring searches (`ILIKE '%ab%'`).
      - Client debounces input by 300ms. Minimum query length is **2 characters**.
      - **2-Character Queries**: The system executes exact/prefix searches on SKU and barcode (accelerated by B-tree), and a **prefix search on product name** (`name ILIKE 'query%'`), which is accelerated by `idx_products_name_prefix`. If a user performs an arbitrary mid-word substring search with 2 characters, the database executes a heap scan filtered by `organization_id` with an **explicitly accepted performance limitation** (evaluated in $< 150$ms on 10,000 rows, but not trigram-accelerated).
      - **3+ Character Queries**: Full trigram substring matching (`name ILIKE '%query%'`) is enabled and fully accelerated by `idx_products_name_trgm` combined with the RLS `organization_id` filter (bitmap AND).
    - Pagination: Server-side offset pagination (`limit`, `offset`) with deterministic sort tie-breakers: `ORDER BY name ASC, id ASC` or `ORDER BY created_at DESC, id DESC`.
    - Performance target: p95 database execution time $< 100$ms on 10,000 products; end-to-end response time $< 400$ms under normal network conditions.

12. **Product Images, Private Storage & SSRF Defense**:
    - Product images are stored exclusively in the dedicated, private Supabase Storage bucket: `product-images` (configured in `storage.buckets` with `public = false`, `file_size_limit = 5242880`, and `allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]`). Public access is disabled.
    - Direct uploads occur client-side via Supabase Storage client targeting bucket `product-images`, with object name structured as: `{organization_id}/{product_id}/{filename}` (complete storage location: `product-images/{organization_id}/{product_id}/{filename}`).
    - **Stable Object Name Persistence (No Public/Expiring URLs, No Bucket Prefix)**: The database `products.image_url` column stores ONLY either:
      - A stable Storage relative object name (without bucket prefix): `{organization_id}/{product_id}/{filename}` (regex `^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$`)
      - An external HTTPS URL: `^https://.+`
      - **Public object URLs (`/storage/v1/object/public/...`), bucket-prefixed paths (`product-images/...`), and expiring signed URLs MUST NEVER be persisted in the database.**
    - **Dynamic Signed URL Generation for Authorized Reads**: When an authorized user with `products:read` accesses products via Server Actions or React Server Components, the server checks if `products.image_url` is an internal Storage object name (matches `^[0-9a-f-]{36}/[0-9a-f-]{36}/`). If so, it generates a short-lived signed URL dynamically (1-hour expiration) via `supabase.storage.from('product-images').createSignedUrl(product.image_url, 3600)`, passing the object name without the bucket prefix. If `image_url` is an external `https://` URL, it is returned directly. If a referenced object is missing or inaccessible in Storage, the server returns `null` for the signed URL with a logged warning, preventing broken images or client crashes.
    - The server application **NEVER fetches, downloads, or proxies external image URLs** (eliminating Server-Side Request Forgery / SSRF vulnerabilities).
    - Image URLs are rendered directly by the browser with Content Security Policy protection (`img-src 'self' https: data:`). Insecure `http://`, executable `javascript:`, and local `file://` schemes are strictly rejected.

13. **Audit Atomicity & Transaction Invariant**:
    - In compliance with Constitutional Principle II (Atomic Operations), **every product and category mutation and its corresponding audit event MUST commit together or fail together in the same database transaction**.
    - Mutations execute via transactional Server Actions or authenticated database stored procedures that perform the data write and insert an audit event into `public.organization_audit_events` in one atomic transaction.
    - If either operation fails, the entire transaction rolls back cleanly.
    - Audit metadata captures non-sensitive before/after delta summaries (e.g., changed attribute names). Plaintext cost prices are excluded from general audit metadata.

14. **Standardized Unit of Measure (UOM) Enforcement**:
    - Database check constraint restricts units of measure to an explicit enumerated list:
      ```sql
      CONSTRAINT chk_products_uom CHECK (
          unit_of_measure IN (
              'piece', 'unit', 'kg', 'g', 'mg',
              'liter', 'ml', 'meter', 'cm',
              'box', 'pack', 'pair', 'set'
          )
      )
      ```
    - Application Zod schema enforces the identical 13 values. Arbitrary or unvetted strings are rejected at both application and database boundaries. Default: `'piece'`.

15. **Future Integration Boundaries**:
    - Product UUIDs (`id`) are immutable.
    - Feature 004 (Inventory) attaches `stock_movements` directly to `products.id`.
    - Feature 005 (Customers & POS) captures frozen point-in-time snapshots of product name, SKU, unit cost, and selling price at checkout time.
    - Tax calculation, tax categories, and tax rate snapshots are strictly OUT OF SCOPE for Feature 003.

16. **`pg_trgm` Extension Prerequisite**:
    - The trigram GIN index `CREATE INDEX idx_products_name_trgm ON public.products USING gin (name gin_trgm_ops)` requires the `pg_trgm` PostgreSQL extension.
    - This extension is **not** currently enabled by any existing migration in the repository. It MUST be enabled by a dedicated migration step in Feature 003:
      ```sql
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
      ```
    - This migration must execute before creating the trigram index. Its absence will cause the migration to fail.
    - **Benchmark method**: Search performance targets MUST be verified by executing `EXPLAIN (ANALYZE, BUFFERS)` on the worst-case query (`ILIKE '%term%'` with RLS active on a 10,000-row organization dataset) and confirming the query planner uses the trigram index (Bitmap Index Scan on `idx_products_name_trgm`). The p95 execution time must be recorded and compared against the 100ms target.
    - **Composite trigram index limitation**: PostgreSQL GIN trigram indexes do not support composite columns. The standard approach is a plain trigram GIN index on `name` with RLS filtering `organization_id`. The query planner uses a bitmap AND of the GIN index scan and the RLS visibility filter. This is the correct and standard pattern.
    - **Pagination stability**: When records change during browsing (e.g., a product is archived while user browses page 2), offset-based pagination may produce repeated or skipped items. This is an accepted limitation for the MVP. Cursor-based stable pagination is deferred to a future feature.

17. **`products` and `product_categories` Table-Level Security Model**:
    - Both `public.products` and `public.product_categories` MUST have Row-Level Security enabled and forced:
      ```sql
      ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.products FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.product_categories FORCE ROW LEVEL SECURITY;
      ```
    - **SELECT policies**: Active organization members can read products and categories belonging to their organization(s), evaluated via `get_user_organization_ids()`.
    - **Direct client INSERT/UPDATE/DELETE**: All direct client mutations on `products` and `product_categories` are denied via `WITH CHECK (false)` / `USING (false)` RLS policies. All mutations must route through authorized Server Actions backed by SECURITY DEFINER database functions.
    - **Organization-level cascade deletion**: The only legitimate path for bulk removal of products and categories is organization deletion, which cascades via `ON DELETE CASCADE` on the `organization_id` foreign key. This is the sole exception to the no-hard-delete rule.
    - **Dual authorization enforcement**: Every mutation is verified at two layers: (1) **Application layer** via `hasPermission(context, permission)` in the Server Action, and (2) **Database layer** via SECURITY DEFINER RPC that calls `check_user_permission` before executing DML.

18. **Product Lifecycle Authorization — Distinct Operations**:
    - Status management is split into three distinct server operations with distinct authorization requirements:
      1. **`updateProductAction`** — requires `products:update` — modifies name, description, SKU, barcode, category, selling price, cost price, unit of measure, image URL. Does NOT modify `status`.
      2. **`toggleProductStatusAction`** — requires `products:update` — transitions between `active` ↔ `inactive` ONLY. Does NOT support `archived` as source or target.
      3. **`archiveProductAction`** — requires `products:archive` — transitions `active` or `inactive` → `archived`. Records `archived_at` and `archived_by`.
      4. **`restoreProductAction`** — requires `products:archive` — transitions `archived` → `active`. Clears `archived_at` and `archived_by`.
    - Managers hold `products:update` and can therefore toggle `active` ↔ `inactive`. Managers do NOT hold `products:archive` and CANNOT archive or restore.
    - Attempting to invoke `archiveProductAction` or `restoreProductAction` as a Manager is rejected server-side with HTTP 403 Forbidden before any database contact.

19. **Audit Transaction Boundaries**:
    - Every product and category mutation and its corresponding audit event MUST commit in a single atomic transaction. The mechanism is:
      - Option A (preferred): A SECURITY DEFINER PL/pgSQL function that wraps the DML + `INSERT INTO public.organization_audit_events(organization_id, actor_id, event_type, metadata) VALUES (...)` in one block. The caller (Server Action) invokes this via `supabase.rpc(...)`.
      - Option B: A Next.js Server Action that uses a Supabase `rpc()` call to a transaction-wrapping database function.
    - The `public.organization_audit_events` table schema (from Feature 002 migration) is: `(id UUID, organization_id UUID, actor_id UUID, event_type TEXT, metadata JSONB, created_at TIMESTAMPTZ)`. There are NO `updated_at` or `updated_by` columns on this table.
    - **Per-operation audit event types and metadata**:
      - `product.created`: `{"product_id": "...", "name": "...", "sku": "...", "status": "active"}`
      - `product.updated`: `{"product_id": "...", "changed_fields": ["name", "selling_price"]}`
      - `product.status_changed`: `{"product_id": "...", "from": "active", "to": "inactive"}`
      - `product.archived`: `{"product_id": "...", "name": "...", "sku": "..."}`
      - `product.restored`: `{"product_id": "...", "name": "...", "sku": "..."}`
      - `product.cost_updated`: `{"product_id": "..."}` (cost value itself is EXCLUDED from audit metadata)
      - `category.created`: `{"category_id": "...", "name": "..."}`
      - `category.updated`: `{"category_id": "...", "changed_fields": ["name"]}`
      - `category.archived`: `{"category_id": "...", "name": "..."}`
      - `category.restored`: `{"category_id": "...", "name": "..."}`
    - Cost prices are explicitly EXCLUDED from all audit metadata to protect confidentiality even within audit logs.

20. **Supabase Storage Object Ownership, Bucket Configuration & Authorization Invariants**:
    - **Explicit Bucket-Level Configuration (`storage.buckets`)**:
      - The `product-images` bucket MUST be configured directly at the bucket level in `storage.buckets` by a Feature 003 migration:
        ```sql
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES (
            'product-images',
            'product-images',
            false,
            5242880,
            ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
        )
        ON CONFLICT (id) DO UPDATE SET
            public = EXCLUDED.public,
            file_size_limit = EXCLUDED.file_size_limit,
            allowed_mime_types = EXCLUDED.allowed_mime_types;
        ```
      - **Bucket ID**: `'product-images'`
      - **Name**: `'product-images'`
      - **Visibility**: Private (`public = false`). Direct unauthenticated or public object access (`/storage/v1/object/public/...`) is completely disabled.
      - **File Size Limit**: `5242880` bytes (5 MB).
      - **Allowed MIME Types**: `ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]` (JPEG, PNG, WebP, GIF).
      - **Enforcement Mandate**: The implementation MUST verify these actual bucket-level settings in `storage.buckets`. Client-side validation or metadata-only checks are defense-in-depth and MUST NOT be treated as substitutes for bucket-level database enforcement.
    - **Product-First Workflow & Object Name Structure**:
      - Images are uploaded only after a product record exists (or within an atomic client registration flow with verified product UUID). Inside bucket `product-images`, the canonical object name is strictly `{organization_id}/{product_id}/{filename}` (complete storage location: `product-images/{organization_id}/{product_id}/{filename}`).
      - In Supabase Storage RLS policies, `storage.objects.name` is strictly relative to the bucket (the bucket name `product-images` is NOT part of `storage.objects.name`).
      - Helper `storage.foldername(name)` decomposes `name` into an array of directory segments:
        - `(storage.foldername(name))[1]::uuid` safely extracts the `{organization_id}`.
        - `(storage.foldername(name))[2]::uuid` safely extracts the `{product_id}`.
    - **Mandatory Storage RLS Invariants (4 Explicit Policies on `storage.objects`)**:
      1. **Storage Read Policy (`SELECT`)**:
         - Evaluates:
           ```sql
           CREATE POLICY "product_images_select" ON storage.objects
           FOR SELECT TO authenticated
           USING (
               bucket_id = 'product-images'
               AND public.is_org_member((storage.foldername(name))[1]::uuid)
               AND public.check_user_permission((storage.foldername(name))[1]::uuid, auth.uid(), 'products:read')
               AND EXISTS (
                   SELECT 1 FROM public.products p
                   WHERE p.id = (storage.foldername(name))[2]::uuid
                     AND p.organization_id = (storage.foldername(name))[1]::uuid
               )
           );
           ```
         - Guarantees: Verifies bucket ID, organization folder extraction, active caller membership in that organization (`is_org_member`), caller permission `products:read`, product existence in `public.products`, and that the product's `organization_id` strictly matches the organization folder. Access is NEVER granted based solely on folder or membership; target product ownership is required.
      2. **Storage Upload Policy (`INSERT`)**:
         - Evaluates:
           ```sql
           CREATE POLICY "product_images_insert" ON storage.objects
           FOR INSERT TO authenticated
           WITH CHECK (
               bucket_id = 'product-images'
               AND public.is_org_member((storage.foldername(name))[1]::uuid)
               AND (
                   public.check_user_permission((storage.foldername(name))[1]::uuid, auth.uid(), 'products:create')
                   OR public.check_user_permission((storage.foldername(name))[1]::uuid, auth.uid(), 'products:update')
               )
               AND EXISTS (
                   SELECT 1 FROM public.products p
                   WHERE p.id = (storage.foldername(name))[2]::uuid
                     AND p.organization_id = (storage.foldername(name))[1]::uuid
               )
               AND (metadata->>'size')::bigint <= 5242880
               AND metadata->>'mimetype' IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
           );
           ```
         - Guarantees: Uploads require active membership, `products:create` or `products:update`, target product existence and ownership by the same organization, allowed MIME types (`image/jpeg`, `image/png`, `image/webp`, `image/gif`), and maximum size of 5 MB (5,242,880 bytes).
      3. **Storage Replacement Policy (`UPDATE`)**:
         - Evaluates:
           ```sql
           CREATE POLICY "product_images_update" ON storage.objects
           FOR UPDATE TO authenticated
           USING (
               bucket_id = 'product-images'
               AND public.is_org_member((storage.foldername(name))[1]::uuid)
               AND public.check_user_permission((storage.foldername(name))[1]::uuid, auth.uid(), 'products:update')
               AND EXISTS (
                   SELECT 1 FROM public.products p
                   WHERE p.id = (storage.foldername(name))[2]::uuid
                     AND p.organization_id = (storage.foldername(name))[1]::uuid
               )
           )
           WITH CHECK (
               bucket_id = 'product-images'
               AND public.is_org_member((storage.foldername(name))[1]::uuid)
               AND public.check_user_permission((storage.foldername(name))[1]::uuid, auth.uid(), 'products:update')
               AND EXISTS (
                   SELECT 1 FROM public.products p
                   WHERE p.id = (storage.foldername(name))[2]::uuid
                     AND p.organization_id = (storage.foldername(name))[1]::uuid
               )
               AND (metadata->>'size')::bigint <= 5242880
               AND metadata->>'mimetype' IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
           );
           ```
         - Guarantees: Both `USING` (existing object) and `WITH CHECK` (proposed replacement object) independently enforce the complete authorization contract: correct bucket ID, organization folder extraction and active caller membership, target product existence in that same organization, `products:update` permission, allowed MIME type, and size $\le 5$ MB. Because `WITH CHECK` independently validates the destination path, an attacker cannot update an object to move it into another product or another organization's folder, completely preventing cross-tenant or cross-product path manipulation.
      4. **Storage Deletion Policy (`DELETE`)**:
         - Evaluates:
           ```sql
           CREATE POLICY "product_images_delete" ON storage.objects
           FOR DELETE TO authenticated
           USING (
               bucket_id = 'product-images'
               AND public.is_org_member((storage.foldername(name))[1]::uuid)
               AND public.check_user_permission((storage.foldername(name))[1]::uuid, auth.uid(), 'products:update')
               AND EXISTS (
                   SELECT 1 FROM public.products p
                   WHERE p.id = (storage.foldername(name))[2]::uuid
                     AND p.organization_id = (storage.foldername(name))[1]::uuid
               )
           );
           ```
         - Guarantees: Deleting an image object requires `products:update`, active tenant membership, and product entity ownership.
    - **Stable Object Name Persistence in Database (`products.image_url`)**:
      - Stored values MUST match one of two formats:
        - Stable Supabase Storage relative object name (without bucket prefix): `^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$` (e.g. `550e8400-e29b-41d4-a716-446655440000/123e4567-e89b-12d3-a456-426614174000/product-image.webp`)
        - External HTTPS URL: `^https://.+`. Stored as-is for direct browser rendering.
      - **Bucket-prefixed paths (`product-images/...`), public object paths (`/storage/v1/object/public/...`), expiring signed URLs, insecure `http://`, executable `javascript:`, `data:`, and local `file://` schemes MUST NEVER be persisted in the database.**
    - **Dynamic Short-Lived Signed URL Generation on Reads**:
      - When serving product details or catalog lists to authorized clients (via Server Actions or React Server Components), the application server inspects `products.image_url`.
      - If `image_url` is an internal Storage object name (matches `^[0-9a-f-]{36}/[0-9a-f-]{36}/`), the server invokes:
        ```typescript
        supabase.storage
          .from('product-images')
          .createSignedUrl(product.image_url, 3600);
        ```
        passing the object name directly without any bucket prefix (`product.image_url` already contains `{organization_id}/{product_id}/{filename}`).
      - If `image_url` is an external `https://` URL, it is passed directly to the client.
      - If the object in Storage is missing or inaccessible, the server safely falls back to `null` with a logged warning, preventing broken client rendering.
    - **Image Replacement Lifecycle**:
      - When a product's image is updated, the previous image object name in Storage is identified from the existing `products.image_url`. Upon successful commitment of the product update transaction, the Server Action issues `supabase.storage.from('product-images').remove([old_object_name])` using the persisted object name (without bucket prefix) to purge the superseded object.
    - **Abandoned & Orphaned Upload Cleanup**:
      - If an image upload succeeds but the subsequent product transaction fails or the client disconnects, the file becomes unreferenced. A scheduled background cleanup task (executed daily via pg_cron or Supabase Edge maintenance function) scans bucket `product-images` for objects older than 24 hours whose `name` is not currently referenced by any `products.image_url` and deletes them via `supabase.storage.from('product-images').remove(orphan_names)`.
    - **SSRF Prevention**:
      - The application server **NEVER fetches, downloads, or proxies external image URLs**. External images are rendered strictly client-side by the browser under Content Security Policy (`img-src 'self' https: data:`).

21. **SECURITY DEFINER Database Mutation RPC Authorization Contract**:
    - Direct client DML (`INSERT`, `UPDATE`, `DELETE`) on `public.products`, `public.product_categories`, and `public.product_costs` is strictly denied via table-level RLS policies (`WITH CHECK (false)` / `USING (false)`).
    - All business mutations execute exclusively through privileged PostgreSQL functions. The complete catalog of mutation RPCs is:
      1. `public.create_product(p_org_id UUID, p_name TEXT, p_sku TEXT, p_selling_price NUMERIC, p_unit_of_measure TEXT, p_status TEXT, p_barcode TEXT, p_description TEXT, p_category_id UUID, p_cost_price NUMERIC, p_image_url TEXT)`
      2. `public.update_product(p_org_id UUID, p_product_id UUID, p_expected_version INTEGER, p_name TEXT, p_sku TEXT, p_selling_price NUMERIC, p_unit_of_measure TEXT, p_barcode TEXT, p_description TEXT, p_category_id UUID, p_cost_price NUMERIC, p_cost_operation TEXT, p_image_url TEXT)`
      3. `public.toggle_product_status(p_org_id UUID, p_product_id UUID, p_expected_version INTEGER, p_new_status TEXT)`
      4. `public.archive_product(p_org_id UUID, p_product_id UUID, p_expected_version INTEGER)`
      5. `public.restore_product(p_org_id UUID, p_product_id UUID, p_expected_version INTEGER)`
      6. `public.create_product_category(p_org_id UUID, p_name TEXT, p_description TEXT)`
      7. `public.update_product_category(p_org_id UUID, p_category_id UUID, p_name TEXT, p_description TEXT)`
      8. `public.archive_product_category(p_org_id UUID, p_category_id UUID)`
      9. `public.restore_product_category(p_org_id UUID, p_category_id UUID)`
    - **The 10 Mandatory Security Contract Guarantees**:
      1. **Actor Derivation from `auth.uid()`**: Every mutation RPC derives caller identity strictly from `auth.uid()` (`v_caller_id UUID := auth.uid();`). If `v_caller_id IS NULL`, raise exception `'Authentication required'` (`P0003`). Caller-supplied `actor_id` or `created_by` arguments are forbidden. Require `public.is_email_verified()` (raise `P0001` if unverified).
      2. **Zero-Trust Organization Resolution**: Never trust caller-supplied `p_org_id` as authorization evidence. It is treated strictly as an unverified target tenant context.
      3. **Active Membership Verification**: The RPC MUST verify that `v_caller_id` is an active member of `p_org_id` in an active organization:
         ```sql
         SELECT m.role INTO v_caller_role
         FROM public.organization_memberships m
         JOIN public.organizations o ON o.id = m.organization_id
         WHERE m.organization_id = p_org_id
           AND m.user_id = v_caller_id
           AND m.status = 'active'
           AND o.is_active = TRUE;
         IF NOT FOUND OR v_caller_role IS NULL THEN
             RAISE EXCEPTION 'Caller is not an active member of this organization' USING ERRCODE = 'P0004';
         END IF;
         ```
      4. **In-Function Permission Gate via `public.check_user_permission`**: Before performing any validation or DML, the RPC calls `public.check_user_permission(p_org_id, v_caller_id, '<permission>')`. If it returns `FALSE`, raise exception `'Insufficient permissions'` (`P0005`). Required permissions:
         - `create_product`: `products:create` (plus `products:read_cost` if `p_cost_price` is provided)
         - `update_product`: `products:update` (plus `products:read_cost` if `p_cost_operation IN ('set', 'clear')`)
         - `toggle_product_status`: `products:update`
         - `archive_product`: `products:archive`
         - `restore_product`: `products:archive`
         - `create_product_category`: `categories:create`
         - `update_product_category`: `categories:update`
         - `archive_product_category`: `categories:archive`
         - `restore_product_category`: `categories:archive`
      5. **Target Entity Tenant Ownership Verification**: For entity updates or status transitions, the RPC verifies that the target record exists and belongs to `p_org_id` (`WHERE id = p_target_id AND organization_id = p_org_id`). If not found, raise exception `'Resource not found in this organization'` (`P0002` — HTTP 404 equivalent). Cross-tenant manipulation is aborted before any write.
      6. **In-Function Lifecycle, OCC Version & Cost Operation Enforcement**:
         - In `update_product`: Evaluates `WHERE id = p_product_id AND organization_id = p_org_id AND version = p_expected_version`. If zero rows updated, checks if product exists; if it exists with different version, raise `'Stale update conflict'` (`P0010` — HTTP 409).
         - In `update_product`: Evaluates `p_cost_operation`. Must be one of `'unchanged'`, `'set'`, `'clear'`. Any other value raises exception `'Invalid cost operation'` (`P0016`).
           - When `p_cost_operation = 'unchanged'`: leaves `public.product_costs` untouched; does NOT require `products:read_cost` permission.
           - When `p_cost_operation = 'set'`: requires `products:read_cost` permission (raise `P0005` if missing); requires `p_cost_price IS NOT NULL` (raise `P0008` if null, `P0007` if negative); validates decimal precision using `get_currency_exponent()`; upserts into `public.product_costs (organization_id, product_id, cost_price, updated_at) VALUES (p_org_id, p_product_id, p_cost_price, now()) ON CONFLICT (organization_id, product_id) DO UPDATE SET cost_price = EXCLUDED.cost_price, updated_at = EXCLUDED.updated_at`.
           - When `p_cost_operation = 'clear'`: requires `products:read_cost` permission (raise `P0005` if missing); executes `DELETE FROM public.product_costs WHERE organization_id = p_org_id AND product_id = p_product_id`. The cost price becomes unrecorded/unknown (`null` in application layer).
         - In `toggle_product_status`: Validates that current `status != 'archived'` and `p_new_status IN ('active', 'inactive')`. Transitions involving `archived` are rejected (`P0015`).
         - In `archive_product`: Validates current `status IN ('active', 'inactive')`. Sets `status = 'archived'`, `archived_at = now()`, `archived_by = v_caller_id`.
         - In `restore_product`: Validates current `status = 'archived'`. Transitions `archived` → `active`, clearing `archived_at` and `archived_by`.
      7. **Reject Before DML**: All authentication, membership, permission, currency precision, entity ownership, cost operation, and OCC version checks execute BEFORE any `INSERT`, `UPDATE`, or `DELETE`. Any violation immediately raises an exception and aborts the transaction cleanly.
      8. **Ownership, Search Path & Explicit Grants**:
         - Every mutation function MUST be owned by `postgres`: `ALTER FUNCTION public.<name> OWNER TO postgres;`.
         - Every function MUST declare a locked search path: `SET search_path = pg_catalog, public, pg_temp;`.
         - Execution privileges MUST be revoked from PUBLIC: `REVOKE ALL ON FUNCTION public.<name> FROM PUBLIC;`.
         - Execution MUST be granted explicitly to authenticated users: `GRANT EXECUTE ON FUNCTION public.<name> TO authenticated;`.
      9. **Interaction with `FORCE ROW LEVEL SECURITY` & Superuser Bypass**:
         - **Critical Architectural Invariant**: In PostgreSQL, `SECURITY DEFINER` functions execute with the privileges of their owner (`postgres`). In Supabase, the `postgres` role possesses the `BYPASSRLS` attribute.
         - Consequently, **queries executed inside a `SECURITY DEFINER` function BYPASS table-level Row-Level Security policies**.
         - Therefore, table RLS policies (`FORCE ROW LEVEL SECURITY`) protect against direct client queries from `authenticated` callers, but do NOT automatically constrain queries executed within the SECURITY DEFINER functions.
         - **Procedural Tenant Enforcement Mandate**: Every query, join, `INSERT`, `UPDATE`, and `DELETE` within the PL/pgSQL function MUST explicitly include `organization_id = p_org_id`. Relying on RLS to enforce tenant isolation inside a `SECURITY DEFINER` function is a catastrophic flaw that would lead to cross-tenant data corruption.
      10. **Cost-Price Disclosure, Modification & Audit Protection**:
          - Cost prices in `public.product_costs` represent sensitive commercial data.
          - In `create_product`: if `p_cost_price` is provided, caller MUST possess `products:read_cost` (raises `P0005` if missing).
          - In `update_product`: `p_cost_operation` (`'unchanged'`, `'set'`, `'clear'`) dictates cost handling. Modifying or clearing cost (`'set'` or `'clear'`) requires `products:read_cost`. If `p_cost_operation = 'unchanged'`, callers without `products:read_cost` can safely update non-cost product fields without modifying or disclosing cost.
          - Return payloads from `create_product` and `update_product` return general product attributes, and MUST NOT include `cost_price` unless `public.check_user_permission(p_org_id, v_caller_id, 'products:read_cost')` is verified.
          - Plaintext numeric cost values are **strictly EXCLUDED from all audit log payloads**. Audit metadata records only boolean indicators (`"cost_updated": true` or `"cost_cleared": true`), never the numeric price.
          - Mutations on `public.product_costs` utilize composite foreign key `(organization_id, product_id) REFERENCES public.products(organization_id, id) ON DELETE CASCADE`, preventing any cross-tenant cost/product association.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Product Catalog Browsing, Search & Filtering (Priority: P1)

As an authorized store employee (Owner, Admin, Manager, or Cashier), I want to browse the organization's product catalog with fast search, category filtering, status filtering, sorting, and pagination, so that I can quickly locate retail items, review prices, and verify product details.

**Why this priority**: Discoverability and catalog visibility are essential everyday retail functions. Cashiers must look up prices and barcodes, and managers must oversee catalog completeness.

**Independent Test**: Can be tested independently by logging in as an authorized employee, navigating to `/[slug]/products`, searching by product name, SKU, or barcode, filtering by category and status, changing sort order, paginating through results, and verifying that only records for the active tenant are visible.

**Acceptance Scenarios**:

1. **Given** an authenticated user with `products:read` permission (Owner, Admin, Manager, Cashier), **When** they navigate to `/[slug]/products`, **Then** the system displays a paginated list of products for the active organization, showing product name, SKU, barcode (or "—"), category name (or "Uncategorized"), selling price formatted in the organization's currency, unit of measure, status badge, and product image thumbnail.
2. **Given** an authorized user entering a search query in the catalog search bar, **When** they enter 2 characters (e.g., "CO"), **Then** the catalog filters matching SKU/barcode (via B-tree) and product name prefix (via B-tree prefix index); **When** they enter 3 or more characters (e.g., "COF"), **Then** the catalog enables full trigram partial substring matching (accelerated by `idx_products_name_trgm`), returning filtered results in under 400ms end-to-end (p95 DB query $< 100$ms).
3. **Given** an authorized user viewing the product catalog, **When** they select a category filter, **Then** only products assigned to that specific category are displayed.
4. **Given** an authorized user viewing the product catalog, **When** they select a status filter (`Active`, `Inactive`, `Archived`), **Then** the list updates to display only products matching the selected status. Default view displays `Active` and `Inactive` products, hiding `Archived` items unless explicitly filtered.
5. **Given** a catalog containing more items than the page size (e.g., 20 items per page), **When** the user navigates between pages, **Then** the next batch is loaded cleanly with deterministic ordering (`ORDER BY name ASC, id ASC`) and accurate total counts.
6. **Given** an organization with zero products, **When** an authorized user navigates to `/[slug]/products`, **Then** the system presents an actionable empty state with a "Create First Product" button (visible to users with `products:create`).
7. **Given** an authenticated user with Cashier role (lacking `products:read_cost` permission), **When** they view the product catalog or inspect product details, **Then** cost price and profit margin columns are absent from the UI, and the underlying server response payload contains zero cost price fields.

---

### User Story 2 — Product Registration & Identifier Integrity (Priority: P1)

As an organization Owner, Admin, or Manager, I want to register a new product by providing its name, SKU, optional barcode, category, prices, unit of measure, and description, so that the item is cataloged and available for store operations.

**Why this priority**: Product creation is the fundamental prerequisite for inventory tracking, purchasing, and point-of-sale checkout.

**Independent Test**: Can be tested independently by completing the product creation form with valid details, submitting it, verifying that the product is saved with the active organization's ID, verifying that tenant-scoped SKU uniqueness is enforced, and verifying that an audit event is logged atomically.

**Acceptance Scenarios**:

1. **Given** an authorized user with `products:create` permission (Owner, Admin, Manager), **When** they fill out the product registration form with valid data (name: " Arabica Coffee Beans 250g ", SKU: " cof-ara-250 ", barcode: "012345678905", selling price: 12.50, cost price: 6.00, category: "Beverages", unit of measure: "pack") and submit, **Then** the product name is stored trimmed ("Arabica Coffee Beans 250g"), the SKU is normalized to "COF-ARA-250", status defaults to "active", a product record is created in `public.products`, a cost record is created in `public.product_costs`, an audit event `product.created` is committed atomically in the same database transaction via privileged `create_product` RPC, and the user receives a success confirmation.
2. **Given** an authorized user registering a product without a cost price, **When** they leave the cost price field blank, **Then** no row is inserted into `public.product_costs` (representing unknown/unrecorded cost), and product registration succeeds. The application-layer cost value is `null` (from a LEFT JOIN that finds no matching row); no database NULL is stored in `cost_price` within any `product_costs` row.
3. **Given** a user attempting to create a product with an SKU that already exists in the same organization, **When** they submit the form, **Then** creation is rejected with an inline validation error: "SKU 'COF-ARA-250' is already in use in this organization", and no database mutation occurs.
4. **Given** a user attempting to create a product with a barcode that already exists in the same organization, **When** they submit the form, **Then** creation is rejected with an error: "Barcode is already assigned to another product in this organization".
5. **Given** Organization A with SKU "PROD-001", **When** an authorized user in Organization B registers a product with the identical SKU "PROD-001", **Then** creation in Organization B succeeds without conflict, verifying tenant-scoped SKU uniqueness.
6. **Given** an authorized user entering monetary values, **When** they enter a negative selling price (e.g., -5.00) or negative cost price (e.g., -2.00), **Then** the system rejects the input with an error: "Price cannot be negative".
7. **Given** an authorized user entering a selling price with more decimal places than allowed by the organization's currency (e.g., $12.555 for USD), **When** they submit, **Then** both application Zod validation and the database RPC `create_product` reject the value with error: "Selling price exceeds maximum decimal places (2) for currency USD", and zero silent rounding occurs.
8. **Given** a Cashier (lacking `products:create` permission), **When** they attempt to access `/[slug]/products/new` or invoke the creation server action, **Then** access is denied with HTTP 403 Forbidden.
9. **Given** an authorized user attempting to create a product in an organization configured with an unsupported or unknown currency code (e.g., 'XYZ'), **When** the creation request is processed, **Then** both application Zod validation and database function `get_currency_exponent` reject the submission with error `P0009` ('Unsupported or invalid ISO 4217 currency code: XYZ'), preventing any silent fallback or assumption of two decimal places.
10. **Given** an authorized user uploading a product image during product creation, **When** the image is uploaded to private bucket `product-images` with object name `{organization_id}/{product_id}/{filename}`, **Then** the database stores strictly the stable relative object name `{organization_id}/{product_id}/{filename}` (without bucket prefix), direct public storage URLs and bucket-prefixed paths are rejected, and client views request short-lived signed URLs dynamically via `supabase.storage.from('product-images').createSignedUrl(objectName, 3600)`.

---

### User Story 3 — Product Detail View & Optimistic Concurrency Editing (Priority: P1)

As an organization Owner, Admin, or Manager, I want to view comprehensive product details and update editable attributes with optimistic concurrency control, so that store catalog data remains accurate without silently overwriting colleague updates.

**Why this priority**: Retailers frequently adjust selling prices, update supplier costs, refine descriptions, and reassign product categories. Concurrent edit safety prevents lost business data.

**Independent Test**: Can be tested independently by opening a product edit screen in two sessions, modifying values in both, submitting the first successfully, and confirming that the second submission detects a version conflict and rejects the stale update with an actionable message.

**Acceptance Scenarios**:

1. **Given** an authorized user with `products:read` permission, **When** they navigate to `/[slug]/products/[id]`, **Then** the system displays complete product details including name, SKU, barcode, category, unit of measure, selling price (formatted in organization currency), status, version, creation timestamp, and last update timestamp.
2. **Given** an authorized user with `products:read_cost` permission (Owner, Admin, Manager), **When** they view product details for an item with cost $6.00 and selling price $12.00, **Then** the cost price and gross profit margin (50.0%) are clearly displayed.
3. **Given** an authorized user with `products:read_cost` permission viewing an item with selling price $0.00 (promotional item), **When** the page renders, **Then** the gross margin is displayed as "—" (N/A) without division-by-zero errors.
4. **Given** an authorized user with `products:read_cost` permission viewing an item without a recorded cost (no row in `public.product_costs`, application-layer cost is `null`), **When** the page renders, **Then** the gross margin is displayed as "—" (N/A) with tooltip "Cost price not recorded".
5. **Given** a Cashier viewing `/[slug]/products/[id]`, **When** the page renders, **Then** cost price and gross margin are absent from both the UI and backend data payload.
6. **Given** an authorized user with `products:update` permission, **When** they edit product fields (name, description, selling price) with expected version 1 and submit, **Then** the record updates, version increments to 2, an audit event `product.updated` commits atomically, and the user receives a confirmation toast.
7. **Given** two users A and B editing Product X (both starting at version 1), **When** User A saves changes (updating version to 2), and subsequently User B attempts to save changes with expected version 1, **Then** User B's update is rejected with error `STALE_UPDATE_CONFLICT` (HTTP 409): "This product was modified by another user. Please refresh to review the latest changes before reapplying your edits."
8. **Given** an authorized user attempting to access a product ID belonging to Organization B while active in Organization A, **When** the server processes the request, **Then** the request is rejected with HTTP 404 Not Found, preventing cross-tenant existence disclosure.
9. **Given** an authorized user updating a product with `cost_operation = 'unchanged'`, **When** they update name, selling price, or description without modifying cost, **Then** the product record updates, the existing record in `public.product_costs` remains untouched, and the operation does not require `products:read_cost` permission.
10. **Given** an authorized user with `products:read_cost` updating a product with `cost_operation = 'set'` and `cost_price = 8.50`, **When** the update commits, **Then** `public.product_costs` is updated/inserted with 8.5000, version increments, and audit metadata records `cost_updated: true` without disclosing the numeric cost amount in audit logs.
11. **Given** an authorized user with `products:read_cost` updating a product with `cost_operation = 'clear'`, **When** the update commits, **Then** the corresponding row in `public.product_costs` is deleted, the product's cost becomes unrecorded/unknown (`null`), and audit metadata records `cost_cleared: true`.
12. **Given** a user lacking `products:read_cost` attempting to execute an update with `cost_operation = 'set'` or `cost_operation = 'clear'`, **When** the request reaches the server action or database RPC `update_product`, **Then** the operation is rejected with HTTP 403 / error `P0005` ('Insufficient permissions'), and no database modification occurs.
13. **Given** an update request with an invalid `cost_operation` value (e.g., 'replace' or 'null'), **When** processed by the database RPC `update_product`, **Then** the transaction is aborted with error `P0016` ('Invalid cost operation').

---

### User Story 4 — Category Management & Composite Referential Integrity (Priority: P1)

As an organization Owner, Admin, or Manager, I want to create, browse, edit, and organize product categories with database-enforced tenant boundaries, so that our retail catalog is logically structured without cross-tenant leakage.

**Why this priority**: Categories provide the foundational hierarchy for retail product organization, reporting, and point-of-sale browsing.

**Independent Test**: Can be tested independently by creating a category, assigning a product to it, verifying that database foreign key constraints reject any attempt to reference a category belonging to another tenant, and verifying category archival behavior.

**Acceptance Scenarios**:

1. **Given** an authorized user with `categories:read` permission, **When** they navigate to `/[slug]/categories`, **Then** they see a list of all active categories in the organization, including name, description, active product count, and status badge.
2. **Given** an authorized user with `categories:create` permission (Owner, Admin, Manager), **When** they submit the category creation form with valid name " Dairy & Refrigerated " and optional description, **Then** the category name is stored trimmed ("Dairy & Refrigerated"), a category record is created in `public.product_categories`, an audit event `category.created` is committed atomically via privileged `create_product_category` RPC, and the category becomes immediately selectable in product forms.
3. **Given** a user attempting to create a category with a name that already exists in the same organization (case-insensitive: "Beverages" vs " beverages "), **When** they submit, **Then** the system catches the conflict via the unique expression index `uq_categories_org_name` and rejects the submission: "A category with this name already exists in this organization".
4. **Given** an authorized user with `categories:update` permission, **When** they update a category name or description, **Then** the category updates (with trimmed name), an audit event `category.updated` is logged, and associated products reflect the new category name.
5. **Given** an authorized user with `categories:archive` permission (Owner, Admin), **When** they archive a category containing 20 products, **Then** the category transitions to `status = 'archived'`, all 20 products retain their `category_id`, product detail views display the category with an `[Archived]` badge, and the category is omitted from active product creation dropdowns.
6. **Given** a product form submission attempting to set `category_id` to an archived category, **When** the server validates the request, **Then** submission is rejected with error `CATEGORY_ARCHIVED_ASSIGNMENT_FORBIDDEN` ("Cannot assign an archived category to a product.").
7. **Given** an authorized user with `categories:archive` permission (Owner, Admin), **When** they restore an archived category, **Then** the category transitions back to `active`, and becomes selectable for product assignments again.
8. **Given** an update payload attempting to associate Product (Organization A) with Category (Organization B), **When** the database executes the update, **Then** PostgreSQL constraint `fk_products_org_category` aborts the transaction with foreign key violation, preventing cross-tenant category linkage.
9. **Given** any employee attempting to execute a direct physical delete (`DELETE FROM product_categories`), **When** the operation is evaluated, **Then** physical deletion is denied by RLS policy `USING (false)` and no RPC exposes physical deletion; soft archival (`categories:archive`) is the sole supported retirement path.

---

### User Story 5 — Product Lifecycle Transitions & Archival Integrity (Priority: P2)

As an authorized organization member (Owner, Admin, or Manager for status toggling; Owner or Admin for archival/restoration), I want to activate, deactivate, or archive products as our retail inventory changes, so that discontinued items are cleanly retired without breaking historical transaction records.

**Why this priority**: Retail inventory changes constantly with seasonal rotations and discontinued items. Clean status transitions prevent discontinued items from being sold while protecting data integrity.

**Independent Test**: Can be tested independently by: (a) toggling a product `active` → `inactive` as a Manager (verifying success), (b) verifying the product disappears from default active views, (c) archiving the product as an Admin (verifying success), and (d) attempting the same archive operation as a Manager (verifying HTTP 403 rejection).

**Acceptance Scenarios**:

1. **Given** an authorized user with `products:update` permission (Owner, Admin, or Manager), **When** they toggle a product's status from `active` to `inactive` via `toggleProductStatusAction`, **Then** the product status updates to `inactive`, an audit event `product.status_changed` is logged with previous and new status, and the product is visually flagged as inactive.
2. **Given** an authorized user with `products:archive` permission (Owner, Admin), **When** they archive an active or inactive product via `archiveProductAction`, **Then** the status transitions to `archived`, `archived_at` and `archived_by` are recorded, an audit event `product.archived` is logged atomically, and the product is excluded from normal catalog views.
3. **Given** an archived product, **When** viewed in the catalog with the "Archived" status filter enabled, **Then** the product is displayed with an `Archived` badge, and editing core fields is disabled.
4. **Given** an authorized user with `products:archive` permission, **When** they select "Restore Product" on an archived product via `restoreProductAction`, **Then** the product transitions back to `active` status, `archived_at` and `archived_by` are cleared, an audit event `product.restored` is logged, and the product returns to active catalog listings.
5. **Given** an archived product with SKU "OLD-SKU-01", **When** any user attempts to register a new product with the identical SKU "OLD-SKU-01", **Then** creation is rejected because archived products retain their SKU uniqueness binding.
6. **Given** a Manager (holding `products:update` but lacking `products:archive`), **When** they attempt to archive or restore a product via `archiveProductAction` or `restoreProductAction`, **Then** the request is rejected server-side with HTTP 403 Forbidden before any database contact; **But When** the same Manager toggles a product between `active` and `inactive` via `toggleProductStatusAction`, **Then** the operation succeeds normally.
7. **Given** any employee attempting to execute a direct hard delete (`DELETE FROM products`), **When** the operation is evaluated, **Then** hard delete is denied by RLS policy; soft archival (`archived`) is the sole retirement path.

---

### User Story 6 — Role-Based Access Control & Direct Database Attack Protection (Priority: P2)

As an organization Owner, I want strict server-side and database-level enforcement of employee roles, so that staff members only perform actions and view data appropriate for their role even if they probe database tables or endpoints directly.

**Why this priority**: Safeguards store financial data (margins, costs), protects product catalog integrity against unauthorized modification, and upholds Constitutional Principle IV.

**Independent Test**: Can be tested by executing operations across Owner, Admin, Manager, and Cashier sessions and verifying that unauthorized operations (e.g., Cashier editing a price, Cashier reading cost price, Manager archiving a category) are strictly rejected.

**Acceptance Scenarios**:

1. **Given** an active Owner session, **When** they perform any catalog operation (create, read, update, archive, view cost), **Then** all operations succeed and are audited.
2. **Given** an active Admin session, **When** they perform product or category operations, **Then** all operations (including archiving) succeed.
3. **Given** an active Manager session, **When** they create or update products and categories or toggle product status (active ↔ inactive), **Then** the operations succeed; **When** they attempt to archive a product or category, **Then** the request is rejected with HTTP 403 Forbidden.
4. **Given** an active Cashier session attempting to query `public.product_costs` directly via Supabase client, **When** the database evaluates the query, **Then** RLS policy `product_costs_select` evaluates `check_user_permission` to `false` and returns 0 rows.
5. **Given** an active Cashier session invoking a Server Action or API endpoint for product details, **When** the server prepares the response, **Then** `cost_price` is omitted from the return payload.
6. **Given** an active Cashier session attempting to invoke `createProductAction`, `updateProductAction`, `toggleProductStatusAction`, or `archiveProductAction`, **When** the server evaluates authorization, **Then** the action immediately aborts with HTTP 403 Forbidden.
7. **Given** an employee whose membership is `suspended` or `revoked`, **When** they attempt to access any product or category route or action, **Then** the server evaluates `resolveTenantContext()`, denies access with HTTP 404/403, and prevents any tenant data access.
8. **Given** a tampered request attempting to insert a `product_costs` row with `product_id` from Organization B while operating in Organization A context, **When** the database evaluates the composite foreign key `(organization_id, product_id) REFERENCES products (organization_id, id)`, **Then** PostgreSQL aborts the transaction with a foreign key violation, preventing cross-tenant cost/product association at the database level.
9. **Given** an authenticated user attempting to view or download a product image, **When** they query the product catalog or details, **Then** the server verifies active tenant membership and `products:read` permission and confirms that the product exists and belongs to that organization before generating short-lived signed URLs (1-hour expiration); direct unauthenticated or public GET requests to `/storage/v1/object/public/product-images/...` return HTTP 404/403, and SELECT requests for objects referencing non-existent or cross-tenant products are rejected by Storage RLS.
10. **Given** an attacker attempting to upload (`INSERT`) or overwrite (`UPDATE`) an image in `product-images` targeting an Organization B object path (`{org_b_id}/{product_id}/...`) or manipulate the destination path in an UPDATE to move an object across organizations or products, **When** evaluated by Supabase Storage RLS policies, **Then** both `USING` and `WITH CHECK` independently reject the request because `is_org_member`, `check_user_permission`, and product entity-tenant ownership (`p.organization_id = folder_org_id`) evaluate to `false` for the target path.

---

### Edge Cases & Boundary Conditions

- **Duplicate SKU with Mixed Case or Whitespace**: A user submits SKU `" cof-101 "` when `"COF-101"` already exists. The system trims and converts the input to `"COF-101"` before evaluating uniqueness, reliably catching and rejecting the duplicate via both Zod validation and database constraint `chk_products_sku_normalized` / `uq_products_org_sku`.
- **Empty Barcode Submission**: A user creates a product without a barcode (field left empty or whitespace). The system normalizes empty barcode input to `NULL` (rather than empty string `""`), allowing multiple products to have `NULL` barcodes without triggering unique index collisions.
- **Cross-Tenant Category Assignment Attack**: An attacker tampers with an update payload to pass `category_id` from Organization B to a product in Organization A. Database constraint `fk_products_org_category` evaluates `(organization_id, category_id)` against Organization A's categories and aborts the transaction with a foreign key violation.
- **Zero Selling Price with Undefined Margin**: A merchant enters `selling_price = 0.00` for a promotional sample. The database accepts `0.00` (`selling_price >= 0.00`), while the gross margin calculation cleanly yields `N/A` ("—") instead of a runtime `DivisionByZero` error.
- **Cost Price Exceeding Selling Price**: A merchant enters cost price `$15.00` and selling price `$10.00`. The system accepts the data (to allow clearance sales or loss-leader promotions), but calculates a negative gross margin (-50.0%) and renders an informational warning badge ("Negative Margin").
- **Cost Price Unknown (No Row)**: A merchant adds an item without entering a cost price. No row is inserted into `public.product_costs`. Application-layer cost value is `null` (from LEFT JOIN returning no match). Margin calculation returns `N/A` with tooltip "Cost price not recorded". This is distinct from `cost_price = 0.0000` (a genuine zero-cost acquisition).
- **Cost Price Clearing**: A merchant previously recorded cost $5.00 for Product X and now wishes to unrecord it. The user submits `costOperation = 'clear'` via `updateProductAction`. The database deletes the row from `public.product_costs`, transitioning application-layer cost back to `null` (unknown), while preserving the product and auditing `cost_cleared: true`.
- **Category Archival with Active Products**: A category with 50 active products is archived. The 50 products retain their `category_id`. Product details display the category name with `[Archived]`. The category is hidden from active product creation dropdowns.
- **Concurrent Edits with Version Collision**: Two managers simultaneously edit Product X (both on version 1). Manager A submits first; update commits and version becomes 2. Manager B submits second with expected version 1; server detects version mismatch and rejects with error `STALE_UPDATE_CONFLICT` (HTTP 409).
- **Extremely Long Text Inputs**: A user enters a 5,000-character description or 500-character name. Zod schemas and database constraints reject strings exceeding limits (name: max 150 chars; description: max 2,000 chars).
- **Special Characters in Product Name and SKU**: Product names support full Unicode characters (e.g., "Café au Lait — 250ml", "T-Shirt Größe M"). SKU strictly enforces alphanumeric plus `_`, `-`, `.` characters.
- **Invalid or Malicious Image URLs**: Submitting `javascript:alert(1)`, `http://insecure.com`, `/storage/v1/object/public/...`, bucket-prefixed `product-images/...`, or `data:text/html` is rejected by Zod URL validation (only `^https://.+` or canonical Storage object name `^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$` without bucket prefix are permitted). The application never performs server-side fetches of image URLs.
- **Atomic Audit Failure Simulation**: If the database audit insertion into `public.organization_audit_events` fails (e.g., due to constraint or disk failure), the entire product mutation rolls back atomically, ensuring no unaudited product modifications exist.
- **Currency Change Restriction**: An organization attempts to change its currency from USD to EUR after products exist. The system prohibits direct currency changes to prevent corrupting existing numerical price records.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Product Catalog & Data Management
- **FR-001**: System MUST allow authorized users (`products:create`) to create new products with required attributes: Product Name, SKU, Selling Price, and Unit of Measure. Product Status is optional at creation and defaults to `active` (or may explicitly be set to `inactive`; setting `archived` at creation is strictly prohibited with error `INVALID_CREATION_STATUS`). Product Name MUST be stored trimmed of leading and trailing whitespace while preserving display casing.
- **FR-002**: System MUST allow authorized users (`products:create`) to provide optional attributes: Barcode, Description, Category ID, Cost Price, and Image URL (stable Supabase Storage relative object path or external HTTPS URL).
- **FR-003**: System MUST enforce that every product belongs to exactly one active organization, set automatically from verified server tenant context.
- **FR-004**: System MUST enforce SKU uniqueness within the organization scope (`UNIQUE (organization_id, sku)`). SKU comparison MUST be case-insensitive.
- **FR-005**: System MUST automatically normalize SKUs by trimming leading/trailing whitespace and converting all characters to uppercase prior to validation and storage. Database MUST enforce `CHECK (sku = upper(trim(sku)) AND sku ~ '^[A-Z0-9_.-]{1,50}$')`.
- **FR-006**: System MUST enforce barcode uniqueness within the organization scope when a barcode is present (`UNIQUE (organization_id, barcode) WHERE barcode IS NOT NULL`).
- **FR-007**: System MUST normalize empty or whitespace-only barcode inputs to `NULL` to prevent duplicate empty string collisions.
- **FR-008**: System MUST allow authorized users (`products:update`) to edit the following product attributes via `updateProductAction`: Product Name, Description, Category ID, Selling Price, Cost Price (governed by explicit `costOperation: 'unchanged' | 'set' | 'clear'`), Unit of Measure, and Image URL. Product `status` is NOT editable via `updateProductAction`; it is modified exclusively through `toggleProductStatusAction` (requires `products:update`) or `archiveProductAction` / `restoreProductAction` (requires `products:archive`).
- **FR-009**: System MUST permit an authorized user to update a product without triggering a false duplicate SKU/barcode collision against the product's own existing record.
- **FR-010**: System MUST validate that `selling_price` is a non-negative fixed-point number (`NUMERIC(14, 4)` with `selling_price >= 0.00`).
- **FR-011**: System MUST implement cost-price as an optional attribute stored in `public.product_costs` with column `cost_price NUMERIC(14, 4) NOT NULL CHECK (cost_price >= 0.0000)`. Absence of a row in `product_costs` represents unknown/unrecorded cost (application-layer value: `null`). A row with `cost_price = 0.0000` represents a genuine zero-cost acquisition. No database NULL is stored in `cost_price`. Product updates handle cost modifications exclusively through explicit `p_cost_operation` (`'unchanged'`, `'set'`, `'clear'`). Operations `'set'` and `'clear'` require `products:read_cost`; `'clear'` deletes the row from `product_costs`; `'unchanged'` leaves cost intact without requiring `products:read_cost`. Numeric cost values MUST be strictly excluded from audit logs.
- **FR-012**: System MUST associate product prices with the active organization's ISO 4217 currency configuration, formatting all currency displays in the organization's currency format.
- **FR-013**: System MUST validate and enforce that decimal places entered for `selling_price` and `cost_price` do not exceed the minor unit exponent of the organization's currency at both application (Zod) and database (`get_currency_exponent`) boundaries. Unsupported or unknown currency codes MUST be rejected with error `P0009` without silent fallback or assumption of two decimals. Input values with excess decimal digits MUST be rejected with error `P0009` without silent rounding.
- **FR-014**: System MUST enforce that once products have been created in an organization, changing `organizations.currency` is locked via database trigger `prevent_currency_change_when_products_exist` and row-level `FOR SHARE` locks during price mutations.
- **FR-015**: System MUST enforce tenant referential integrity for categories via declarative composite foreign key `(organization_id, category_id) REFERENCES product_categories (organization_id, id) ON DELETE SET NULL (category_id)` (PostgreSQL 15+ column-specific syntax), rejecting cross-tenant category assignments at the database level. The column-specific form nulls only `category_id`, preserving `organization_id NOT NULL`.
- **FR-016**: System MUST restrict units of measure to an explicit enumerated list (`piece`, `unit`, `kg`, `g`, `mg`, `liter`, `ml`, `meter`, `cm`, `box`, `pack`, `pair`, `set`), defaulting to `'piece'`.

#### Product Lifecycle & Status
- **FR-017**: System MUST support exactly three product lifecycle statuses: `active`, `inactive`, and `archived`. Newly created products MUST default to `active` status unless explicitly designated as `inactive`. Specifying `archived` at creation is strictly prohibited with error `INVALID_CREATION_STATUS`.
- **FR-018**: System MUST expose a dedicated `toggleProductStatusAction` (requires `products:update`) that transitions products between `active` ↔ `inactive` ONLY. Attempting to use this action with `archived` as source or target MUST be rejected with error `INVALID_STATUS_TRANSITION`.
- **FR-019**: System MUST expose a dedicated `archiveProductAction` (requires `products:archive`) to transition products from `active` or `inactive` to `archived` status, capturing `archived_at` timestamp and `archived_by` user ID.
- **FR-020**: System MUST expose a dedicated `restoreProductAction` (requires `products:archive`) to restore an `archived` product back to `active` status, clearing `archived_at` and `archived_by`.
- **FR-021**: System MUST preserve SKU and barcode attachments on archived products, preventing their reuse by other products within the same organization to preserve historical audit integrity.
- **FR-022**: System MUST prohibit hard deletion (`DELETE`) of products in normal product management workflows; soft archival (`archived`) is the standard retirement mechanism.

#### Concurrency & Gross Margin
- **FR-023**: System MUST implement optimistic concurrency control on product updates via an integer `version` column. Updates with mismatched expected versions MUST be rejected with error `STALE_UPDATE_CONFLICT` (HTTP 409).
- **FR-024**: System MUST calculate gross profit margin percentage as `((selling_price - cost_price) / selling_price) * 100` when `selling_price > 0.00` and a `product_costs` row exists (application-layer cost is not `null`).
- **FR-025**: When `selling_price == 0.00` or no `product_costs` row exists (application-layer cost is `null`), system MUST display gross margin as **N/A** ("—") without division-by-zero errors.

#### Search, Filtering & Browsing
- **FR-026**: System MUST allow authorized users (`products:read`) to view a paginated list of products for the active organization.
- **FR-027**: System MUST support text-based search across product name, SKU, and barcode with minimum query length of 2 characters and 300ms client debounce. For 2-character queries, product name matching executes as a prefix search (accelerated by `idx_products_name_prefix`); for queries of 3 or more characters, full trigram partial substring matching (accelerated by `idx_products_name_trgm`) is enabled.
- **FR-028**: System MUST support filtering products by category ID, including an option to filter for uncategorized products (`category_id IS NULL`).
- **FR-029**: System MUST support filtering products by status (`active`, `inactive`, `archived`), defaulting the view to `active` and `inactive` products while hiding `archived` products.
- **FR-030**: System MUST support sorting product listings by product name, selling price, and creation date, using deterministic tie-breakers (`ORDER BY name ASC, id ASC` or `ORDER BY created_at DESC, id DESC`).
- **FR-031**: System MUST implement server-side pagination with configurable page sizes (default: 20; options: 10, 20, 50, 100), returning total product count and page metadata.

#### Category Management
- **FR-032**: System MUST allow authorized users (`categories:create`) to create product categories with a required Category Name and optional Description under a strictly flat (single-level) category architecture. Category Name MUST be stored trimmed of leading and trailing whitespace while preserving display casing.
- **FR-033**: System MUST enforce that category names are unique within the organization scope via unique expression index `CREATE UNIQUE INDEX uq_categories_org_name ON public.product_categories (organization_id, lower(trim(name)))`.
- **FR-034**: System MUST allow authorized users (`categories:update`) to edit category name and description.
- **FR-035**: System MUST allow authorized users (`categories:archive`) to archive categories. Physical deletion of categories in normal workflows is strictly prohibited (denied by RLS `USING (false)` and omitted from database functions); soft archival (`archived`) is the sole supported retirement mechanism. Existing products retain their `category_id` with `[Archived]` indicator. Archived categories MUST be excluded from active product creation dropdowns and rejected if submitted (`CATEGORY_ARCHIVED_ASSIGNMENT_FORBIDDEN`).
- **FR-036**: System MUST allow authorized users (`categories:archive`) to restore an archived category back to `active`.
- **FR-037**: System MUST compute and display the active product count associated with each category in the category management view.

#### Security, Confidentiality & Auditability
- **FR-038**: System MUST isolate supplier acquisition costs in `public.product_costs` with table-level RLS policy restricting `SELECT` strictly to callers holding `products:read_cost` (`public.check_user_permission(organization_id, auth.uid(), 'products:read_cost')`).
- **FR-039**: System MUST ensure that Cashiers cannot obtain `cost_price` through direct table queries, RPCs, Server Actions, RSC payloads, or API endpoints.
- **FR-040**: System MUST verify server-side authorization for every product and category mutation, rejecting unauthorized calls with HTTP 403 Forbidden.
- **FR-041**: System MUST atomically commit business mutations and their corresponding audit event in `public.organization_audit_events` in the same database transaction.
- **FR-042**: System MUST store product images in dedicated Supabase Storage bucket `product-images`, explicitly configured at the bucket level in `storage.buckets` with `public = false`, `file_size_limit = 5242880` (5 MB), and `allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[] (which implementation MUST verify in `storage.buckets` rather than relying solely on client or metadata validation). Stored database values in `products.image_url` MUST be restricted to canonical relative object names (`{organization_id}/{product_id}/{filename}`, regex `^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$`) or external HTTPS URLs (`^https://.+`), strictly forbidding bucket-prefixed paths (`product-images/...`), public storage object paths (`/storage/v1/object/public/...`), expiring signed URLs in persistent storage, and insecure (`http://`), executable (`javascript:`), or local (`file://`) URLs. Storage access MUST be governed by 4 explicit RLS policies on `storage.objects` where `storage.objects.name` is `{organization_id}/{product_id}/{filename}`: `SELECT` MUST verify product entity-to-tenant ownership (`p.organization_id = folder_org_id`), and `UPDATE` MUST independently enforce the complete authorization contract in both `USING` and `WITH CHECK` clauses to prevent moving objects across organizations or products. The application server MUST dynamically generate short-lived signed URLs (1-hour expiration) via `supabase.storage.from('product-images').createSignedUrl(objectName, 3600)` without bucket prefix when serving private images to authorized users (`products:read`). The server MUST NOT perform server-side fetching or proxying of image URLs (SSRF prevention). When an existing product image is replaced, the system MUST trigger deletion of the previous Storage file upon successful update. Unreferenced orphaned uploads older than 24 hours MUST be purged by a scheduled maintenance cleanup.
- **FR-043**: System MUST deny direct client `INSERT`, `UPDATE`, and `DELETE` operations on `public.products`, `public.product_categories`, and `public.product_costs` via RLS `WITH CHECK (false)` / `USING (false)` policies. All catalog mutations MUST route through privileged SECURITY DEFINER database functions satisfying the 10-point authorization contract (deriving actor strictly from `auth.uid()`, verifying active organization membership, evaluating `check_user_permission`, verifying entity ownership, enforcing OCC `version` and explicit `p_cost_operation` (`'unchanged'` | `'set'` | `'clear'`), locking currency `FOR SHARE`, and explicitly filtering all internal queries by `organization_id = p_org_id`).
- **FR-044**: The Feature 003 migration MUST enable the `pg_trgm` PostgreSQL extension (`CREATE EXTENSION IF NOT EXISTS pg_trgm`) before creating the trigram GIN index on `products.name`. Implementation MUST verify extension availability via `EXPLAIN (ANALYZE, BUFFERS)` on a representative search query.
- **FR-045**: Monetary values (`selling_price`, `cost_price`) received from the database as strings MUST be processed using string-based decimal arithmetic or a decimal library. Parsing monetary strings with JavaScript `parseFloat()` or `Number()` is strictly prohibited.

---

### Non-Functional Requirements

- **NFR-001 (Data Isolation)**: Every tenant query to `products`, `product_costs`, and `product_categories` MUST execute under PostgreSQL Row-Level Security (`FORCE ROW LEVEL SECURITY`) enforcing `organization_id` matching. Zero cross-tenant data leakage is permitted.
- **NFR-002 (Cost Confidentiality)**: Database-level RLS policy on `public.product_costs` MUST prevent unauthorized database clients (including Cashiers querying via anon/authenticated Supabase client) from viewing cost prices.
- **NFR-003 (Financial Precision)**: Monetary values (`cost_price`, `selling_price`) MUST be persisted as PostgreSQL `NUMERIC(14, 4)` to eliminate floating-point rounding errors and accommodate diverse currency exponents.
- **NFR-004 (Search Latency)**: Catalog search and filter queries across up to 10,000 product records in an organization MUST complete with p95 database query execution time $< 100$ms and round-trip server action response time $< 400$ms.
- **NFR-005 (Scalability & Indexing)**: Database schema MUST maintain composite indexes on `(organization_id, status, category_id)`, `(organization_id, sku)`, `(organization_id, barcode)`, and a trigram GIN index on `(name)` (requires `pg_trgm` extension, enabled by Feature 003 migration) to guarantee scalable query plans.
- **NFR-006 (Optimistic Concurrency)**: All product update operations MUST evaluate the product `version` column, guaranteeing zero silent lost updates under concurrent access.
- **NFR-007 (Type Safety)**: All product and category domain models, validation schemas, server action inputs/outputs, and UI component props MUST be strictly typed in TypeScript without the use of `any`.
- **NFR-008 (Input Sanitization & Normalization)**: All inputs MUST be validated and normalized using Zod schemas at application boundaries before reaching database or business logic layers.
- **NFR-009 (SSRF Prevention)**: The server MUST NOT download, fetch, or proxy external image URLs. Image rendering is delegated entirely to the browser with Content Security Policy controls.
- **NFR-010 (Audit Transactional Invariance)**: Business mutations and audit event records in `organization_audit_events` MUST commit together or fail together within the same database transaction.
- **NFR-011 (Accessibility & Responsiveness)**: UI components MUST conform to WCAG 2.1 AA accessibility standards, support complete keyboard navigation for rapid barcode entry, and render responsively across desktop, tablet, and mobile displays.
- **NFR-012 (Zero Client Trust)**: Active tenant identity MUST be resolved server-side strictly from verified user session tokens and active membership records, never from client-supplied organization IDs.

---

### Key Entities & Data Requirements

#### Entity 1: `product_categories` (Product Categories)
Represents a flat logical grouping of retail products within an organization.

| Attribute | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | Primary Key, `DEFAULT gen_random_uuid()` | Internal unique identifier |
| `organization_id` | UUID | NOT NULL, `REFERENCES organizations(id) ON DELETE CASCADE` | Owning tenant identifier |
| `name` | TEXT | NOT NULL, `CHECK (char_length(trim(name)) BETWEEN 1 AND 100)` | Display name of the category |
| `description` | TEXT | NULLABLE, `CHECK (description IS NULL OR char_length(trim(description)) <= 500)` | Optional category description |
| `status` | TEXT | NOT NULL, `DEFAULT 'active'`, `CHECK (status IN ('active', 'archived'))` | Category lifecycle status |
| `created_by` | UUID | NOT NULL, `REFERENCES profiles(id) ON DELETE RESTRICT` | User who created the category |
| `updated_by` | UUID | NOT NULL, `REFERENCES profiles(id) ON DELETE RESTRICT` | User who last updated the category |
| `archived_at` | TIMESTAMPTZ | NULLABLE | Timestamp when category was archived |
| `archived_by` | UUID | NULLABLE, `REFERENCES profiles(id) ON DELETE RESTRICT` | User who archived the category |
| `created_at` | TIMESTAMPTZ | NOT NULL, `DEFAULT now()` | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, `DEFAULT now()` | Last modification timestamp |

**Indexes & Constraints**:
- `CONSTRAINT uq_categories_org_id UNIQUE (organization_id, id)` *(enables composite foreign key from products)*
- `CREATE UNIQUE INDEX uq_categories_org_name ON public.product_categories (organization_id, lower(trim(name)));`
- `CREATE INDEX idx_categories_org_status ON public.product_categories (organization_id, status);`

---

#### Entity 2: `products` (Retail Products)
Represents a distinct, saleable retail product within an organization.

| Attribute | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | Primary Key, `DEFAULT gen_random_uuid()` | Internal unique product identifier |
| `organization_id` | UUID | NOT NULL, `REFERENCES organizations(id) ON DELETE CASCADE` | Owning tenant identifier |
| `name` | TEXT | NOT NULL, `CHECK (char_length(trim(name)) BETWEEN 1 AND 150)` | Product display name |
| `sku` | TEXT | NOT NULL, `CHECK (sku = upper(trim(sku)) AND sku ~ '^[A-Z0-9_.-]{1,50}$')` | Unique business product identifier |
| `barcode` | TEXT | NULLABLE, `CHECK (barcode IS NULL OR (barcode = trim(barcode) AND barcode ~ '^[A-Za-z0-9-]{3,50}$'))` | Retail scanning identifier |
| `description` | TEXT | NULLABLE, `CHECK (description IS NULL OR char_length(trim(description)) <= 2000)` | Detailed product description |
| `category_id` | UUID | NULLABLE | Associated product category |
| `selling_price` | NUMERIC(14, 4) | NOT NULL, `DEFAULT 0.0000`, `CHECK (selling_price >= 0.0000)` | Standard retail selling price |
| `unit_of_measure` | TEXT | NOT NULL, `DEFAULT 'piece'`, `CHECK (unit_of_measure IN ('piece', 'unit', 'kg', 'g', 'mg', 'liter', 'ml', 'meter', 'cm', 'box', 'pack', 'pair', 'set'))` | Unit of sale |
| `image_url` | TEXT | NULLABLE, `CHECK (image_url IS NULL OR image_url ~ '^https://.+' OR image_url ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$')` | Product image URL (stable Storage object name or external HTTPS URL) |
| `status` | TEXT | NOT NULL, `DEFAULT 'active'`, `CHECK (status IN ('active', 'inactive', 'archived'))` | Product lifecycle status |
| `version` | INTEGER | NOT NULL, `DEFAULT 1`, `CHECK (version >= 1)` | Optimistic concurrency version |
| `created_by` | UUID | NOT NULL, `REFERENCES profiles(id) ON DELETE RESTRICT` | User who created the product |
| `updated_by` | UUID | NOT NULL, `REFERENCES profiles(id) ON DELETE RESTRICT` | User who last updated the product |
| `archived_at` | TIMESTAMPTZ | NULLABLE | Timestamp when product was archived |
| `archived_by` | UUID | NULLABLE, `REFERENCES profiles(id) ON DELETE RESTRICT` | User who archived the product |
| `created_at` | TIMESTAMPTZ | NOT NULL, `DEFAULT now()` | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, `DEFAULT now()` | Last update timestamp |

**Indexes & Constraints**:
- `CONSTRAINT uq_products_org_id UNIQUE (organization_id, id)` *(enables composite foreign key from `product_costs`; `id` alone is already PRIMARY KEY, but this explicit composite unique constraint satisfies PostgreSQL's requirement for composite FK referencing)*
- `CONSTRAINT uq_products_org_sku UNIQUE (organization_id, sku)`
- `CONSTRAINT fk_products_org_category FOREIGN KEY (organization_id, category_id) REFERENCES public.product_categories (organization_id, id) ON DELETE SET NULL (category_id)` *(PostgreSQL 15+ column-specific SET NULL; nulls only `category_id`, preserving `organization_id NOT NULL`)*
- `CREATE UNIQUE INDEX uq_products_org_barcode ON public.products (organization_id, barcode) WHERE barcode IS NOT NULL;`
- `CREATE INDEX idx_products_org_status_cat ON public.products (organization_id, status, category_id);`
- `CREATE INDEX idx_products_name_prefix ON public.products (organization_id, name text_pattern_ops);` *(accelerates 2-character and general prefix searches on product name; see Decision 11)*
- `CREATE INDEX idx_products_name_trgm ON public.products USING gin (name gin_trgm_ops);` *(accelerates 3+ character partial substring searches; requires `pg_trgm` extension; see Decision 16)*

---

#### Entity 3: `product_costs` (Product Acquisition Costs)
Isolates sensitive supplier acquisition costs to enforce database-level confidentiality. This table uses a composite primary key on `product_id` (1:1 relationship with `products`) and enforces cross-tenant referential integrity via a composite foreign key that references both `organization_id` and `product_id` from `products`.

| Attribute | Type | Constraints | Description |
|---|---|---|---|
| `product_id` | UUID | Primary Key | Associated product identifier (part of composite FK) |
| `organization_id` | UUID | NOT NULL | Owning tenant identifier (part of composite FK) |
| `cost_price` | NUMERIC(14, 4) | NOT NULL, `CHECK (cost_price >= 0.0000)` | Supplier acquisition / purchase cost |
| `created_at` | TIMESTAMPTZ | NOT NULL, `DEFAULT now()` | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, `DEFAULT now()` | Last update timestamp |

*Note on Nullability*: `cost_price` is NOT NULL within this table. If cost is unrecorded/unknown at product creation, **no row is inserted** into `product_costs`. If cost is known (including \$0.00), a row is persisted. The application uses a LEFT JOIN from `products` to `product_costs`; a `null` application-layer cost means "no row found" (unknown cost). A row with `cost_price = 0.0000` means genuine zero-cost. This cleanly differentiates between unknown and zero-cost items without nullable columns.

**Indexes & Constraints**:
- `CONSTRAINT fk_product_costs_org_product FOREIGN KEY (organization_id, product_id) REFERENCES public.products (organization_id, id) ON DELETE CASCADE` *(composite FK ensures the cost record's `organization_id` matches the product's `organization_id`; prevents cross-tenant cost/product associations at the database level)*
- `CONSTRAINT fk_product_costs_org FOREIGN KEY (organization_id) REFERENCES public.organizations (id) ON DELETE CASCADE` *(ensures org-level cascade is handled even if the composite FK is not followed)*
- `CREATE INDEX idx_product_costs_org ON public.product_costs (organization_id);`

> [!IMPORTANT]
> The composite foreign key `(organization_id, product_id) REFERENCES products (organization_id, id)` requires `products` to have `CONSTRAINT uq_products_org_id UNIQUE (organization_id, id)`. This constraint is defined in Entity 2. The independent `REFERENCES products(id)` FK on `product_id` alone is NOT used; it is superseded by the composite FK which provides stronger cross-tenant guarantees. Do NOT add a separate `product_id REFERENCES products(id)` constraint — it would be redundant and misleading.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Authorized store staff can register a new retail product with full pricing, category, and identifiers in under 45 seconds.
- **SC-002**: Catalog search queries by product name, SKU, or barcode complete with database execution time $< 100$ms (p95) and end-to-end response time $< 400$ms on catalogs up to 10,000 items.
- **SC-003**: 100% of product and category database operations strictly enforce organization data isolation under PostgreSQL Row-Level Security (zero cross-tenant data leakage).
- **SC-004**: 100% of direct database queries or API requests for cost price executed by Cashiers return 0 rows or omitted fields (zero cost-price disclosure). All cost updates and clearings strictly enforce `products:read_cost`.
- **SC-005**: 100% of cross-tenant category assignments are rejected by PostgreSQL declarative composite foreign keys (zero cross-tenant category linkage).
- **SC-006**: 100% of concurrent product update collisions are detected via optimistic concurrency control, producing zero silent lost updates.
- **SC-007**: 100% of product and category mutations commit atomically with their corresponding audit event in `organization_audit_events` (zero unaudited mutations).
- **SC-008**: First-time users can navigate to the catalog and create their first product without requiring external documentation or administrative intervention (task completion rate $> 90\%$).
- **SC-009**: 100% of attempts to create a `product_costs` row referencing a product from a different organization are rejected by PostgreSQL composite foreign key `(organization_id, product_id) REFERENCES products (organization_id, id)` (zero cross-tenant cost/product associations).
- **SC-010**: 100% of price submissions with fractional precision exceeding the organization currency's ISO 4217 minor unit exponent or featuring unsupported currency codes are rejected at both application and database RPC boundaries with zero silent rounding (error `P0009`).
- **SC-011**: 100% of product image operations comply with explicit database-level private bucket configuration (`storage.buckets` with `public = false`, `file_size_limit = 5242880`, `allowed_mime_types`), the 4 explicit Storage RLS policies (with `SELECT` strictly enforcing product entity-to-tenant ownership, and `UPDATE` independently enforcing complete authorization across both `USING` and `WITH CHECK` clauses), stable relative path persistence in database, and dynamic short-lived signed URL generation on read.
- **SC-012**: 100% of catalog mutations executed via privileged database functions strictly verify caller `auth.uid()`, active tenant membership, OCC `version`, explicit `cost_operation` (`'unchanged'` | `'set'` | `'clear'`), and required permissions prior to DML, with zero unauthenticated or cross-tenant modifications under superuser RLS bypass.

---

## Business Rules

- **BR-001 (Tenant Ownership Invariance)**: Every product, category, and cost record MUST belong to exactly one organization (`organization_id`). Tenant reassignment is strictly prohibited.
- **BR-002 (SKU Normalization & Uniqueness)**: SKUs MUST be unique within an organization. SKUs are uppercase, trimmed, and restricted to `^[A-Z0-9_.-]{1,50}$`. The database constraint `chk_products_sku_normalized` rejects un-normalized inputs.
- **BR-003 (Barcode Optionality & Uniqueness)**: Barcodes are optional general retail identifiers. When present, barcodes MUST be unique within an organization. Empty or whitespace-only inputs MUST be stored as `NULL`.
- **BR-004 (Monetary Precision & Currency Binding)**: Prices use fixed-point `NUMERIC(14, 4)` and bind to `organizations.currency`. Selling price MUST be $\ge 0.00$. Currency code MUST belong to the authoritative supported ISO 4217 set; unsupported currency codes are rejected with error `P0009` without silent assumption of two decimals. Price decimal places for both selling price and cost price must not exceed the currency's ISO 4217 minor unit exponent, enforced at both application (Zod) and database (`get_currency_exponent`) boundaries. Values with excess decimal digits are rejected with error `P0009` without silent rounding.
- **BR-005 (Organization Currency Lock)**: Once products exist in an organization, changing `organizations.currency` is strictly locked via database trigger `prevent_currency_change_when_products_exist` and `FOR SHARE` row-level locks during price mutations.
- **BR-006 (Cost-Price Confidentiality & Explicit Mutation Semantics)**: Cost prices are proprietary. Only roles with `products:read_cost` (Owner, Admin, Manager) can read cost prices. Cashiers MUST NEVER receive cost prices. Database RLS on `product_costs` enforces read boundaries. Updating a product's cost requires explicit `costOperation` in `updateProductAction` and `p_cost_operation` in `update_product`: `'unchanged'` (leaves cost intact, does not require `products:read_cost`), `'set'` (updates/inserts cost, requires `products:read_cost` and non-null valid price), or `'clear'` (deletes row, requires `products:read_cost`). Plaintext numeric costs are strictly EXCLUDED from all audit logs.
- **BR-007 (Cost Nullability Semantics)**: `cost_price` is optional at the product level, implemented as row absence in `product_costs`. An absent row in `product_costs` represents unknown/unrecorded cost (application-layer value: `null` from LEFT JOIN). A row with `cost_price = 0.0000` represents a genuine zero-cost item. No database NULL is stored in `cost_price` within any `product_costs` row. Submitting `costOperation = 'clear'` deletes the row from `product_costs`.
- **BR-008 (Gross Margin Calculation Rules)**:
  - Gross Margin % = `((selling_price - cost_price) / selling_price) * 100` when `selling_price > 0.00` and a `product_costs` row exists (application-layer cost is not `null`).
  - Negative margins are permitted and flagged with a warning badge.
  - When `selling_price == 0.00` or no `product_costs` row exists (application-layer cost is `null`), gross margin is displayed as **N/A** ("—").
  - Cashiers never receive cost or margin data.
- **BR-009 (Declarative Cross-Tenant Integrity)**: Products can only reference categories belonging to the identical organization. Enforced natively via composite foreign key `(organization_id, category_id) REFERENCES product_categories (organization_id, id) ON DELETE SET NULL (category_id)` (PostgreSQL 15+). Additionally, `product_costs` can only reference products belonging to the same organization, enforced via composite foreign key `(organization_id, product_id) REFERENCES products (organization_id, id) ON DELETE CASCADE`.
- **BR-010 (Category Archival Determinism)**:
  - Archiving a category sets `status = 'archived'`.
  - Products assigned to an archived category retain their `category_id`.
  - Product details display the category with an `[Archived]` indicator.
  - Archived categories cannot be assigned to new or updated products (`CATEGORY_ARCHIVED_ASSIGNMENT_FORBIDDEN`).
  - Archived categories are hidden from primary filter lists by default.
  - Authorized users (`categories:archive`, Owner/Admin) can restore an archived category back to `active`.
- **BR-011 (Genuinely Flat Categories)**: Product categories in Web MVP are single-level only. No category hierarchy or parent-child nesting is supported.
- **BR-012 (Category Name Uniqueness)**: Category names MUST be unique within an organization, enforced case-insensitively via unique expression index `uq_categories_org_name`.
- **BR-013 (Product Lifecycle Transitions)**:
  - Valid transitions: `active` $\leftrightarrow$ `inactive` (requires `products:update`); `active` / `inactive` $\rightarrow$ `archived` (requires `products:archive`); `archived` $\rightarrow$ `active` (requires `products:archive`).
  - Invalid transitions are rejected with error `INVALID_STATUS_TRANSITION`.
- **BR-014 (Archival Identifier Preservation)**: Archived products retain their SKU and barcode permanently. Their identifiers cannot be reused by other products within the same organization.
- **BR-015 (Hard Deletion Prohibited)**: Hard deletion of products or categories (`DELETE FROM products`, `DELETE FROM product_categories`) is completely prohibited in normal workflows (denied by RLS `USING (false)` and omitted from database functions). Soft archival is the sole supported retirement mechanism. Bulk removal occurs exclusively via cascading deletion of the organization itself (`ON DELETE CASCADE` on `organization_id`).
- **BR-016 (Optimistic Concurrency Control)**: Product updates require `expected_version`. Updates increment `version`. Collisions abort with error `STALE_UPDATE_CONFLICT` (HTTP 409).
- **BR-017 (Unit of Measure Validation)**: Every product MUST specify a valid retail UOM from the 13 allowed values (`piece`, `unit`, `kg`, `g`, `mg`, `liter`, `ml`, `meter`, `cm`, `box`, `pack`, `pair`, `set`). Default: `'piece'`.
- **BR-018 (Image Security, Bucket Configuration & Storage RLS Invariants)**: Bucket `product-images` MUST be configured in `storage.buckets` with `public = false`, `file_size_limit = 5242880`, and `allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]`. Implementation must verify these actual bucket settings and not rely on client-side or metadata-only checks. Objects store in bucket `product-images` using canonical object name `{organization_id}/{product_id}/{filename}`, and `products.image_url` persists this object name without bucket prefix (or external HTTPS URLs). Public storage access is disabled. Storage RLS enforces 4 explicit policies: `SELECT` verifies product entity-to-tenant ownership (`p.organization_id = folder_org_id`) and `products:read`; `INSERT` verifies `products:create`/`products:update`, product ownership, MIME, and size; `UPDATE` enforces complete authorization across both `USING` and `WITH CHECK` to prevent cross-tenant/cross-product destination path tampering; `DELETE` verifies `products:update` and product ownership. Dynamic short-lived signed URLs (1-hour expiration) are generated on authorized read via `supabase.storage.from('product-images').createSignedUrl(objectName, 3600)`. When an image is replaced, the old Storage object is deleted upon successful product update. Orphaned unreferenced uploads older than 24 hours are purged by scheduled maintenance. The server NEVER fetches or proxies image URLs server-side (SSRF prevention).
- **BR-019 (Audit Transactional Invariance)**: Every catalog mutation and its corresponding audit event in `organization_audit_events` MUST commit together or fail together in the same database transaction.
- **BR-020 (Historical Sales Invariance)**: Future sales line items (Feature 005) MUST store frozen historical snapshots of product name, SKU, unit cost, and selling price. Future catalog edits MUST NOT mutate historical sales records.
- **BR-021 (Privileged Database Mutation Contract)**: All mutations to products, categories, and costs MUST execute via SECURITY DEFINER database functions owned by `postgres` with fixed search path. Functions must derive caller identity strictly from `auth.uid()`, verify active organization membership, enforce permission checks via `check_user_permission`, evaluate OCC versions and explicit cost operations (`'unchanged'` | `'set'` | `'clear'`), lock organization currency `FOR SHARE`, and explicitly filter all internal queries by `organization_id = p_org_id` to prevent cross-tenant data corruption under superuser RLS bypass.
- **BR-022 (Name Normalization Invariant)**: Product and category names MUST be stored trimmed of leading and trailing whitespace at both application and database boundaries, while preserving display casing in storage. Category uniqueness is enforced case-insensitively on trimmed values.

---

## Role-Permission Matrix

The Feature 003 permission catalog extends the authoritative Feature 002 RBAC engine. All permission identifiers strictly follow colon-separated `<resource>:<action>` format.

### New System Permissions

| Permission ID | Category | Description |
|---|---|---|
| `products:read` | `products` | View product catalog list, details, selling prices, and categories |
| `products:read_cost` | `products` | View product acquisition cost prices and gross profit margins |
| `products:create` | `products` | Register new products in the organization catalog |
| `products:update` | `products` | Modify existing product details, prices, categories, and active/inactive status |
| `products:archive` | `products` | Archive or restore products in the organization catalog |
| `categories:read` | `categories` | View product categories and category product counts |
| `categories:create` | `categories` | Create new product categories |
| `categories:update` | `categories` | Edit existing category names and descriptions |
| `categories:archive` | `categories` | Archive or restore product categories |

### Role Mapping Matrix

| Permission | Owner | Admin | Manager | Cashier | Server Enforcement Point | Database RLS Guard |
|---|:---:|:---:|:---:|:---:|---|---|
| `products:read` | ✅ (auto) | ✅ | ✅ | ✅ | `resolveTenantContext()` + `hasPermission(ctx, 'products:read')` | `products` SELECT policy |
| `products:read_cost` | ✅ (auto) | ✅ | ✅ | ❌ | Server Action & RSC field projection / data stripping | `product_costs` SELECT policy (`check_user_permission`) |
| `products:create` | ✅ (auto) | ✅ | ✅ | ❌ | `createProductAction` guard | Deny direct client INSERT |
| `products:update` | ✅ (auto) | ✅ | ✅ | ❌ | `updateProductAction` & `toggleProductStatusAction` guard | Deny direct client UPDATE |
| `products:archive` | ✅ (auto) | ✅ | ❌ | ❌ | `archiveProductAction` & `restoreProductAction` guard | Deny direct client UPDATE |
| `categories:read` | ✅ (auto) | ✅ | ✅ | ✅ | `resolveTenantContext()` + `hasPermission(ctx, 'categories:read')` | `product_categories` SELECT policy |
| `categories:create` | ✅ (auto) | ✅ | ✅ | ❌ | `createCategoryAction` guard | Deny direct client INSERT |
| `categories:update` | ✅ (auto) | ✅ | ✅ | ❌ | `updateCategoryAction` guard | Deny direct client UPDATE |
| `categories:archive` | ✅ (auto) | ✅ | ❌ | ❌ | `archiveCategoryAction` & `restoreCategoryAction` guard | Deny direct client UPDATE |

*Notes:*
- **Owner**: Automatically receives all 9 permissions via Rule 3 of `check_user_permission` / `hasPermission`.
- **Admin**: Receives all 9 permissions.
- **Manager**: Receives operational permissions (`products:read`, `products:read_cost`, `products:create`, `products:update`, `categories:read`, `categories:create`, `categories:update`). Managers CAN toggle product status (`active` ↔ `inactive`) via `toggleProductStatusAction`. Managers CANNOT archive or restore products or categories.
- **Cashier**: Receives read-only access to products and categories (`products:read`, `categories:read`), but CANNOT view cost prices (`products:read_cost`) and CANNOT mutate catalog data.
- **Suspended / Revoked Members**: Denied all access immediately (HTTP 404/403) by `resolveTenantContext()`.
- **9 permissions require seeding**: All 9 `products:*` and `categories:*` permissions MUST be inserted into `public.permissions` by a Feature 003 migration (using the same seeding pattern as Feature 002's `employees:*` permissions). `check_user_permission` will return `false` for any permission not registered in `public.permissions`.

---

## Dependencies & Integration

### Preceding Features (Authoritative Foundation)
1. **Feature 001 (Auth & Organizations)**:
   - Provides verified user authentication (`auth.users`, `public.profiles`).
   - Provides multi-tenant organization context (`public.organizations`).
   - Provides store currency code (`organizations.currency`, ISO 4217).
   - Provides server-side tenant resolution (`resolveTenantContext`).
2. **Feature 002 (Employee Management & RBAC)**:
   - Provides the centralized permission engine (`public.permissions`, `public.role_permissions`, `public.check_user_permission`).
   - Provides application TypeScript permission resolver (`hasPermission`).
   - Provides append-only audit logging architecture (`public.organization_audit_events`).
   - Provides active organization membership validation (`organization_memberships.status = 'active'`).

### Infrastructure Prerequisites (must be satisfied by Feature 003 migration)
1. **`pg_trgm` PostgreSQL Extension**: Must be enabled via `CREATE EXTENSION IF NOT EXISTS pg_trgm` before the trigram GIN index on `products.name` can be created. Not present in any existing migration.
2. **`product-images` Supabase Storage Bucket**: Must be created in `storage.buckets` with `public = false`, `file_size_limit = 5242880`, and `allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]`. The 4 mandatory Storage RLS policies defined in Decision 20 (`SELECT` with product entity ownership verification, `INSERT`, `UPDATE` with independent `USING` and `WITH CHECK` authorization, and `DELETE`) must be applied to `storage.objects` in the Feature 003 migration.
3. **9 New Permission Seeds**: All 9 Feature 003 permissions must be inserted into `public.permissions` and appropriate rows into `public.role_permissions` using the same seeding pattern as Feature 002's `employees:*` permissions.
4. **PostgreSQL 15+**: The column-specific `ON DELETE SET NULL (category_id)` syntax on the composite FK requires PostgreSQL 15 or later. Supabase Cloud runs PostgreSQL 15+. This is a documented version assumption.

### Subsequent Features (Downstream Integration)
1. **Feature 004 (Inventory Management)**:
   - References `products.id` as the primary key for tracking stock quantities.
   - Every stock movement record links to `products.id`.
   - Feature 003's stable UUIDs and non-negative pricing guarantee inventory ledger consistency.
2. **Feature 005 (Customers & Point of Sale)**:
   - POS checkout queries active products by barcode, SKU, and name using Feature 003's indexes.
   - Sales lines capture immutable snapshots of product name, SKU, unit cost, and selling price at checkout time.
3. **Feature 006 (Invoices & Expenses)**:
   - Invoices reference catalog products to auto-fill line items.
4. **Feature 007 (Dashboard & Analytics)**:
   - Dashboard aggregates top-selling products, category distribution, and margin metrics.
5. **Feature 008 (AI Business Assistant)**:
   - AI assistant queries authorized product catalog summaries strictly within the caller's active tenant and RBAC boundaries (RLS-enforced).

---

## Assumptions

1. **Simple Products First**: Matrix variant combinations (e.g., shoe sizes across colors) are deferred; each distinct retail item is tracked as an independent product.
2. **Flat Categories**: Single-level category organization is sufficient for the Web MVP; nested subcategories are deferred.
3. **Single Currency per Organization**: All products in an organization share the single store currency established in `organizations.currency`. Multi-currency catalog pricing is out of scope.
4. **Tax Calculation Deferred**: Product prices represent base retail selling price. Tax categories, tax rates, and tax calculations are strictly deferred to subsequent retail sales features.
5. **Image Hosting & SSRF**: Product images utilize Supabase Storage (`product-images` bucket) or external HTTPS URLs. The application server never fetches external images server-side.
6. **No Stock Mutation**: Physical stock quantities and warehouse locations are NOT tracked in Feature 003; they belong strictly to Feature 004 (Inventory Management).

---

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation Strategy |
|---|---|---|---|
| **Direct Database Query for Cost Price** | High (Financial confidentiality breach) | Medium | Segregate cost into `public.product_costs` with FORCE RLS and table-level SELECT policy requiring `products:read_cost`. Cashiers receive 0 rows from direct table queries. All mutations via SECURITY DEFINER RPCs. |
| **Cross-Tenant Category Manipulation** | High (Multi-tenancy violation) | Low | Declarative composite foreign key `(organization_id, category_id) REFERENCES product_categories (organization_id, id) ON DELETE SET NULL (category_id)` enforced by PostgreSQL 15+. |
| **Cross-Tenant Cost/Product Association** | High (Multi-tenancy violation) | Low | Composite foreign key `(organization_id, product_id) REFERENCES products (organization_id, id) ON DELETE CASCADE` on `product_costs` prevents referencing a product from a different organization. |
| **SKU / Barcode Collisions** | Medium (Catalog confusion, POS scanning failure) | Medium | Database unique constraint `uq_products_org_sku`, partial unique index on barcode, uppercase normalization, and Zod pre-flight checks. |
| **Lost Updates under Concurrent Edits** | Medium (Data loss) | Medium | Optimistic Concurrency Control (OCC) using `version` column. Mismatches abort with `STALE_UPDATE_CONFLICT` (HTTP 409). |
| **Catalog Query Performance on Large Stores** | Medium (Degraded UX) | Low | B-tree composite index `(organization_id, status, category_id)`, trigram index on `name` (requires `pg_trgm` extension migration), mandatory server pagination (max 100). |
| **Silent Audit Failure** | High (Audit non-compliance) | Low | Transactional invariant: Product mutation and audit event insertion commit together or fail together in the same SECURITY DEFINER database function call. |
| **SSRF via Product Image URL** | Critical (Server security compromise) | Low | The server application NEVER fetches or proxies external image URLs. Image rendering is purely browser-side with CSP protection. `http://` and `javascript:` schemes rejected by Zod. |
| **Floating-Point Monetary Rounding** | High (Financial data corruption) | Low | `NUMERIC(14, 4)` storage. Supabase JS client returns `NUMERIC` as strings. Application MUST NOT use `parseFloat()`/`Number()` on monetary strings; use decimal library. |
| **`pg_trgm` Extension Not Enabled** | Medium (Migration failure) | Medium | Spec mandates `CREATE EXTENSION IF NOT EXISTS pg_trgm` as a prerequisite migration step. Build/CI must verify extension before creating trigram index. |
