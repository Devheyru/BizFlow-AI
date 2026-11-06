# Database RPC Contracts: Feature 003 — Products & Categories

**Feature Branch**: `003-products-categories`  
**Date**: 2026-11-06 (Reconciled with Approved Specification)  
**Status**: Authoritative RPC Contracts  
**Governing Documents**:
- [BizFlow AI Constitution v1.1.0](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/.specify/memory/constitution.md)
- [Feature 003 Specification](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/specs/003-products-categories/spec.md)
- [Feature 003 Data Model](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/specs/003-products-categories/data-model.md)

---

## 1. Security Architecture & Execution Standard

All mutation RPCs adhere to the following strict database contract:

1. **Security Mode**: `SECURITY DEFINER` with owner `postgres`.
2. **Search Path**: Explicitly fixed: `SET search_path = pg_catalog, public, pg_temp;`.
3. **Execution Grants**:
   ```sql
   REVOKE ALL ON FUNCTION public.<rpc_name>(...) FROM PUBLIC;
   GRANT EXECUTE ON FUNCTION public.<rpc_name>(...) TO authenticated;
   ```
4. **Actor Derivation**: `v_caller_id := auth.uid();` — raises `P0003` (`UNAUTHENTICATED`) if `v_caller_id IS NULL`. Require `public.is_email_verified()` (raises `P0001` if unverified).
5. **Membership Verification**:
   ```sql
   SELECT role INTO v_caller_role
   FROM public.organization_memberships
   WHERE organization_id = p_org_id 
     AND user_id = v_caller_id 
     AND status = 'active';

   IF NOT FOUND OR v_caller_role IS NULL THEN
       RAISE EXCEPTION 'Caller is not an active member of organization %', p_org_id
           USING ERRCODE = 'P0004';
   END IF;
   ```
6. **Permission Gate via `public.check_user_permission`**:
   ```sql
   IF NOT public.check_user_permission(p_org_id, v_caller_id, '<permission_key>') THEN
       RAISE EXCEPTION 'Forbidden: missing % permission', '<permission_key>'
           USING ERRCODE = 'P0005';
   END IF;
   ```
7. **Procedural Tenant Isolation**: Every internal query must include `organization_id = p_org_id` in its predicate.
8. **Currency Concurrency Protection**: Mutation operations mutating prices acquire a row-level shared lock on `public.organizations`:
   ```sql
   SELECT o.currency INTO v_org_currency
   FROM public.organizations o
   WHERE o.id = p_org_id
   FOR SHARE;
   ```
9. **Atomic Audit Logging**: Each RPC executes an `INSERT INTO public.organization_audit_events` in the same transaction prior to returning. Plaintext numeric costs are strictly omitted from audit metadata.

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

---

## 3. Category RPC Specifications

### 3.1 `create_product_category`

- **Signature**:
  ```sql
  create_product_category(
      p_org_id UUID,
      p_name TEXT,
      p_description TEXT DEFAULT NULL
  ) RETURNS JSONB
  ```
- **Permission**: `categories:create`
- **Validation**:
  - `p_name`: Trimmed length 1-100 characters (`P0009`).
  - Name uniqueness across the entire organization:
    ```sql
    IF EXISTS (
        SELECT 1 FROM public.product_categories
        WHERE organization_id = p_org_id 
          AND lower(trim(name)) = lower(trim(p_name))
    ) THEN
        RAISE EXCEPTION 'Category name "%" already exists in this organization', trim(p_name)
            USING ERRCODE = 'P0006';
    END IF;
    ```
- **Execution**:
  - Insert into `public.product_categories`:
    ```sql
    INSERT INTO public.product_categories (organization_id, name, description, status, created_by, updated_by)
    VALUES (p_org_id, trim(p_name), nullif(trim(p_description), ''), 'active', v_caller_id, v_caller_id)
    RETURNING id, created_at INTO v_category_id, v_created_at;
    ```
  - Insert audit event: `category_created` with `{ category_id: v_category_id, name: trim(p_name) }`.
- **Return JSONB**:
  ```json
  {
    "success": true,
    "data": {
      "id": "uuid",
      "organization_id": "uuid",
      "name": "string",
      "description": "string | null",
      "status": "active",
      "created_at": "timestamptz"
    }
  }
  ```

---

### 3.2 `update_product_category`

- **Signature**:
  ```sql
  update_product_category(
      p_org_id UUID,
      p_category_id UUID,
      p_name TEXT,
      p_description TEXT DEFAULT NULL
  ) RETURNS JSONB
  ```
- **Permission**: `categories:update`
- **Validation**:
  - Verify category exists:
    ```sql
    SELECT name, status INTO v_existing_name, v_existing_status 
    FROM public.product_categories
    WHERE id = p_category_id AND organization_id = p_org_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Category not found in this organization' USING ERRCODE = 'P0002';
    END IF;
    IF v_existing_status = 'archived' THEN
        RAISE EXCEPTION 'Archived category cannot be updated' USING ERRCODE = 'P0015';
    END IF;
    ```
  - Name uniqueness against other categories in organization:
    ```sql
    IF EXISTS (
        SELECT 1 FROM public.product_categories
        WHERE organization_id = p_org_id 
          AND lower(trim(name)) = lower(trim(p_name))
          AND id <> p_category_id
    ) THEN
        RAISE EXCEPTION 'Category name "%" already exists', trim(p_name) USING ERRCODE = 'P0006';
    END IF;
    ```
- **Execution**:
  - Update `product_categories` setting `name = trim(p_name)`, `description = nullif(trim(p_description), '')`, `updated_by = v_caller_id`, `updated_at = clock_timestamp()`.
  - Insert audit event: `category_updated` with `{ category_id: p_category_id, old_name: v_existing_name, new_name: trim(p_name) }`.

---

### 3.3 `archive_product_category`

- **Signature**:
  ```sql
  archive_product_category(
      p_org_id UUID,
      p_category_id UUID
  ) RETURNS JSONB
  ```
- **Permission**: `categories:archive`
- **Validation**:
  - Verify category exists and `status = 'active'`:
    ```sql
    SELECT name, status INTO v_existing_name, v_existing_status
    FROM public.product_categories
    WHERE id = p_category_id AND organization_id = p_org_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Category not found in this organization' USING ERRCODE = 'P0002';
    END IF;
    IF v_existing_status = 'archived' THEN
        RAISE EXCEPTION 'Category is already archived' USING ERRCODE = 'P0015';
    END IF;
    ```
- **Execution**:
  - Transition status to `'archived'`:
    ```sql
    UPDATE public.product_categories
    SET status = 'archived',
        archived_at = clock_timestamp(),
        archived_by = v_caller_id,
        updated_by = v_caller_id,
        updated_at = clock_timestamp()
    WHERE id = p_category_id AND organization_id = p_org_id;
    ```
  - Note: Associated products retain their `category_id`.
  - Insert audit event: `category_archived` with `{ category_id: p_category_id, name: v_existing_name }`.

---

### 3.4 `restore_product_category`

- **Signature**:
  ```sql
  restore_product_category(
      p_org_id UUID,
      p_category_id UUID
  ) RETURNS JSONB
  ```
- **Permission**: `categories:archive`
- **Validation**:
  - Verify category exists and is currently archived:
    ```sql
    SELECT name, status INTO v_existing_name, v_existing_status
    FROM public.product_categories
    WHERE id = p_category_id AND organization_id = p_org_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Category not found in this organization' USING ERRCODE = 'P0002';
    END IF;
    IF v_existing_status != 'archived' THEN
        RAISE EXCEPTION 'Category is not archived' USING ERRCODE = 'P0015';
    END IF;
    ```
- **Execution**:
  - Restore status to `'active'`:
    ```sql
    UPDATE public.product_categories
    SET status = 'active',
        archived_at = NULL,
        archived_by = NULL,
        updated_by = v_caller_id,
        updated_at = clock_timestamp()
    WHERE id = p_category_id AND organization_id = p_org_id;
    ```
  - Insert audit event: `category_restored` with `{ category_id: p_category_id, name: v_existing_name }`.

---

## 4. Product RPC Specifications

### 4.1 `create_product`

- **Authoritative Signature** (matches `spec.md` line 497):
  ```sql
  create_product(
      p_org_id UUID,
      p_name TEXT,
      p_sku TEXT,
      p_selling_price NUMERIC,
      p_unit_of_measure TEXT DEFAULT 'piece',
      p_status TEXT DEFAULT 'active',
      p_barcode TEXT DEFAULT NULL,
      p_description TEXT DEFAULT NULL,
      p_category_id UUID DEFAULT NULL,
      p_cost_price NUMERIC DEFAULT NULL,
      p_image_url TEXT DEFAULT NULL
  ) RETURNS JSONB
  ```

- **Execution Standard & Transaction Ordering**:
  All steps execute within a single atomic PostgreSQL function transaction. If cost insertion or audit insertion fails, the entire transaction rolls back automatically, preventing orphaned products or inconsistent states.

#### Phase A — Authorization
1. **Derive Actor**: `v_caller_id := auth.uid();` — raises `P0003` (`UNAUTHENTICATED`) if `v_caller_id IS NULL`.
2. **Email Verification**: Check `public.is_email_verified()` — raises `P0001` (`EMAIL_UNVERIFIED`) if unverified.
3. **Active Membership**:
   ```sql
   SELECT role INTO v_caller_role
   FROM public.organization_memberships
   WHERE organization_id = p_org_id 
     AND user_id = v_caller_id 
     AND status = 'active';

   IF NOT FOUND OR v_caller_role IS NULL THEN
       RAISE EXCEPTION 'Caller is not an active member of organization %', p_org_id
           USING ERRCODE = 'P0004';
   END IF;
   ```
4. **Active Organization Verification**: Confirm organization exists and is active (`P0002` if not found).
5. **Product Creation Permission**:
   ```sql
   IF NOT public.check_user_permission(p_org_id, v_caller_id, 'products:create') THEN
       RAISE EXCEPTION 'Forbidden: missing products:create permission'
           USING ERRCODE = 'P0005';
   END IF;
   ```
6. **Cost Read/Write Permission**:
   ```sql
   IF p_cost_price IS NOT NULL THEN
       IF NOT public.check_user_permission(p_org_id, v_caller_id, 'products:read_cost') THEN
           RAISE EXCEPTION 'Forbidden: missing products:read_cost permission to set cost'
               USING ERRCODE = 'P0005';
       END IF;
   END IF;
   ```

#### Phase B — Validation (No mutations occur before all validations succeed)
1. **Initial Status Check**: Must be `'active'`:
   ```sql
   IF p_status IS NULL OR p_status != 'active' THEN
       RAISE EXCEPTION 'Initial product status must be active' USING ERRCODE = 'P0015';
   END IF;
   ```
2. **Unit of Measure Validation**: Must be one of the 13 approved retail UOM values:
   ```sql
   IF p_unit_of_measure IS NULL OR p_unit_of_measure NOT IN (
       'piece', 'unit', 'kg', 'g', 'mg', 'liter', 'ml', 'meter', 'cm', 'box', 'pack', 'pair', 'set'
   ) THEN
       RAISE EXCEPTION 'Invalid unit of measure: %', p_unit_of_measure USING ERRCODE = 'P0009';
   END IF;
   ```
3. **Name & Description Length**:
   ```sql
   v_name := trim(p_name);
   IF char_length(v_name) < 1 OR char_length(v_name) > 150 THEN
       RAISE EXCEPTION 'Product name must be between 1 and 150 characters' USING ERRCODE = 'P0009';
   END IF;
   v_description := nullif(trim(p_description), '');
   IF v_description IS NOT NULL AND char_length(v_description) > 2000 THEN
       RAISE EXCEPTION 'Description exceeds maximum length of 2000 characters' USING ERRCODE = 'P0009';
   END IF;
   ```
4. **SKU Normalization & Permanent Uniqueness**:
   ```sql
   v_sku := upper(trim(p_sku));
   IF v_sku !~ '^[A-Z0-9_.-]{1,50}$' THEN
       RAISE EXCEPTION 'Invalid SKU format: %', p_sku USING ERRCODE = 'P0009';
   END IF;
   IF EXISTS (SELECT 1 FROM public.products WHERE organization_id = p_org_id AND sku = v_sku) THEN
       RAISE EXCEPTION 'SKU "%" already exists in organization catalog', v_sku USING ERRCODE = 'P0006';
   END IF;
   ```
5. **Barcode Normalization & Permanent Uniqueness**:
   ```sql
   v_barcode := nullif(trim(p_barcode), '');
   IF v_barcode IS NOT NULL THEN
       IF v_barcode !~ '^[A-Za-z0-9-]{3,50}$' THEN
           RAISE EXCEPTION 'Invalid barcode format: %', p_barcode USING ERRCODE = 'P0009';
       END IF;
       IF EXISTS (SELECT 1 FROM public.products WHERE organization_id = p_org_id AND barcode = v_barcode) THEN
           RAISE EXCEPTION 'Barcode "%" already exists in organization catalog', v_barcode USING ERRCODE = 'P0006';
       END IF;
   END IF;
   ```
6. **Category Validation & Active State**:
   ```sql
   IF p_category_id IS NOT NULL THEN
       SELECT status INTO v_cat_status FROM public.product_categories
       WHERE id = p_category_id AND organization_id = p_org_id;
       IF NOT FOUND THEN
           RAISE EXCEPTION 'Category not found in this organization' USING ERRCODE = 'P0002';
       END IF;
       IF v_cat_status = 'archived' THEN
           RAISE EXCEPTION 'Archived category cannot be assigned to products' USING ERRCODE = 'P0015';
       END IF;
   END IF;
   ```
7. **Image URL Format & Organization Ownership**:
   ```sql
   v_image_url := nullif(trim(p_image_url), '');
   IF v_image_url IS NOT NULL THEN
       IF v_image_url !~ '^https://.+' AND v_image_url !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$' THEN
           RAISE EXCEPTION 'Invalid image URL format' USING ERRCODE = 'P0009';
       END IF;
       IF v_image_url ~ '^[0-9a-f-]{36}/' AND NOT v_image_url LIKE p_org_id::text || '/%' THEN
           RAISE EXCEPTION 'Image path must belong to current organization' USING ERRCODE = 'P0009';
       END IF;
   END IF;
   ```
8. **Currency Concurrency Lock & Price Precision**:
   ```sql
   SELECT o.currency INTO v_org_currency
   FROM public.organizations o
   WHERE o.id = p_org_id
   FOR SHARE;

   IF NOT FOUND THEN
       RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002';
   END IF;

   v_max_decimals := public.get_currency_exponent(v_org_currency);

   IF p_selling_price < 0 THEN
       RAISE EXCEPTION 'Selling price cannot be negative' USING ERRCODE = 'P0007';
   END IF;
   IF p_selling_price * (10 ^ v_max_decimals) != round(p_selling_price * (10 ^ v_max_decimals)) THEN
       RAISE EXCEPTION 'Selling price exceeds maximum decimal places (%) for currency %',
           v_max_decimals, v_org_currency USING ERRCODE = 'P0009';
   END IF;

   IF p_cost_price IS NOT NULL THEN
       IF p_cost_price < 0 THEN
           RAISE EXCEPTION 'Cost price cannot be negative' USING ERRCODE = 'P0007';
       END IF;
       IF p_cost_price * (10 ^ v_max_decimals) != round(p_cost_price * (10 ^ v_max_decimals)) THEN
           RAISE EXCEPTION 'Cost price exceeds maximum decimal places (%) for currency %',
               v_max_decimals, v_org_currency USING ERRCODE = 'P0009';
       END IF;
   END IF;
   ```

#### Phase C — Atomic Mutation (Execute only after all validations succeed)
1. **Insert Product FIRST & Retrieve Generated ID**:
   ```sql
   INSERT INTO public.products (
       organization_id,
       name,
       sku,
       barcode,
       description,
       category_id,
       selling_price,
       unit_of_measure,
       image_url,
       status,
       version,
       created_by,
       updated_by
   )
   VALUES (
       p_org_id,
       v_name,
       v_sku,
       v_barcode,
       v_description,
       p_category_id,
       p_selling_price,
       p_unit_of_measure,
       v_image_url,
       'active',
       1,
       v_caller_id,
       v_caller_id
   )
   RETURNING id, created_at INTO v_product_id, v_created_at;
   ```

2. **Insert Cost Record ONLY When Cost Was Supplied**:
   ```sql
   IF p_cost_price IS NOT NULL THEN
       INSERT INTO public.product_costs (
           organization_id,
           product_id,
           cost_price
       )
       VALUES (
           p_org_id,
           v_product_id,
           p_cost_price
       );
   END IF;
   ```

3. **Insert Audit Event**:
   ```sql
   INSERT INTO public.organization_audit_events (
       organization_id,
       actor_id,
       event_type,
       metadata
   )
   VALUES (
       p_org_id,
       v_caller_id,
       'product_created',
       jsonb_build_object(
           'product_id', v_product_id,
           'sku', v_sku,
           'name', v_name,
           'selling_price', p_selling_price,
           'unit_of_measure', p_unit_of_measure,
           'category_id', p_category_id,
           'cost_set', (p_cost_price IS NOT NULL)
       )
   );
   ```

4. **Return Response**:
   ```sql
   RETURN jsonb_build_object(
       'success', true,
       'data', jsonb_build_object(
           'id', v_product_id,
           'organization_id', p_org_id,
           'name', v_name,
           'sku', v_sku,
           'barcode', v_barcode,
           'category_id', p_category_id,
           'selling_price', p_selling_price,
           'unit_of_measure', p_unit_of_measure,
           'status', 'active',
           'version', 1,
           'image_url', v_image_url,
           'created_at', v_created_at,
           'cost_price', CASE 
               WHEN p_cost_price IS NOT NULL AND public.check_user_permission(p_org_id, v_caller_id, 'products:read_cost') 
               THEN p_cost_price 
               ELSE NULL 
           END
       )
   );
   ```

---

### 4.2 `update_product`

- **Authoritative Signature** (matches `spec.md` line 498):
  ```sql
  update_product(
      p_org_id UUID,
      p_product_id UUID,
      p_expected_version INTEGER,
      p_name TEXT,
      p_sku TEXT,
      p_selling_price NUMERIC,
      p_unit_of_measure TEXT DEFAULT 'piece',
      p_barcode TEXT DEFAULT NULL,
      p_description TEXT DEFAULT NULL,
      p_category_id UUID DEFAULT NULL,
      p_cost_price NUMERIC DEFAULT NULL,
      p_cost_operation TEXT DEFAULT 'unchanged',
      p_image_url TEXT DEFAULT NULL
  ) RETURNS JSONB
  ```
- **Permissions**:
  - Requires `products:update`.
  - If `p_cost_operation IN ('set', 'clear')`, caller must have `products:read_cost` (`P0005`).
- **Concurrency & Lifecycle Validation**:
  - Acquire row for update:
    ```sql
    SELECT * INTO v_target_product FROM public.products
    WHERE id = p_product_id AND organization_id = p_org_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found in this organization' USING ERRCODE = 'P0002';
    END IF;
    IF v_target_product.status = 'archived' THEN
        RAISE EXCEPTION 'Archived product cannot be updated' USING ERRCODE = 'P0015';
    END IF;
    IF v_target_product.version <> p_expected_version THEN
        RAISE EXCEPTION 'Stale update conflict' USING ERRCODE = 'P0010';
    END IF;
    ```
- **Cost Operation Evaluation**:
  - Must be `'unchanged'`, `'set'`, or `'clear'`. Any other value raises `P0016` (`INVALID_COST_OPERATION`).
  - If `'set'`:
    - Require `p_cost_price IS NOT NULL` (`P0008`) and `p_cost_price >= 0` (`P0007`).
    - Verify decimal precision against currency exponent (`P0009`).
    - Upsert into `public.product_costs (organization_id, product_id, cost_price, updated_at) VALUES (p_org_id, p_product_id, p_cost_price, clock_timestamp()) ON CONFLICT (organization_id, product_id) DO UPDATE SET cost_price = EXCLUDED.cost_price, updated_at = EXCLUDED.updated_at`.
  - If `'clear'`:
    - Delete from `public.product_costs WHERE organization_id = p_org_id AND product_id = p_product_id`.
- **Attribute Mutation**:
  - Validate UOM in 13 allowed values (`P0009`).
  - Normalize SKU: `v_sku := upper(trim(p_sku));` Check permanent uniqueness excluding `p_product_id` (`P0006`).
  - Normalize Barcode: `v_barcode := nullif(trim(p_barcode), '');` Check permanent uniqueness excluding `p_product_id` (`P0006`).
  - Category check: If `p_category_id IS NOT NULL`, verify category exists in `p_org_id` and `status = 'active'` (`P0015`).
  - Currency Lock: `SELECT o.currency INTO v_org_currency FROM public.organizations o WHERE o.id = p_org_id FOR SHARE;`
  - Decimal precision check for `p_selling_price` (`P0009`).
  - Update `public.products`:
    ```sql
    UPDATE public.products
    SET name = trim(p_name),
        sku = v_sku,
        barcode = v_barcode,
        description = nullif(trim(p_description), ''),
        category_id = p_category_id,
        selling_price = p_selling_price,
        unit_of_measure = p_unit_of_measure,
        image_url = nullif(trim(p_image_url), ''),
        version = version + 1,
        updated_by = v_caller_id,
        updated_at = clock_timestamp()
    WHERE id = p_product_id AND organization_id = p_org_id;
    ```
  - Insert audit event: `product_updated` with `{ product_id, sku: v_sku, version: v_target_product.version + 1, cost_operation: p_cost_operation }`.

---

### 4.3 `toggle_product_status`

- **Signature**:
  ```sql
  toggle_product_status(
      p_org_id UUID,
      p_product_id UUID,
      p_expected_version INTEGER,
      p_new_status TEXT
  ) RETURNS JSONB
  ```
- **Permission**: `products:update`
- **Validation**:
  - Acquire row for update. If not found, raise `P0002`.
  - If current `status = 'archived'` or `p_new_status = 'archived'`, raise `P0015` (`STATE_CONFLICT`).
  - If `p_new_status NOT IN ('active', 'inactive')`, raise `P0009`.
  - If `version <> p_expected_version`, raise `P0010` (`CONCURRENCY_CONFLICT`).
- **Execution**:
  - Update `status = p_new_status, version = version + 1, updated_by = v_caller_id, updated_at = clock_timestamp()`.
  - Insert audit event: `product_status_changed` with `{ product_id, old_status, new_status: p_new_status, version: version + 1 }`.

---

### 4.4 `archive_product`

- **Signature**:
  ```sql
  archive_product(
      p_org_id UUID,
      p_product_id UUID,
      p_expected_version INTEGER
  ) RETURNS JSONB
  ```
- **Permission**: `products:archive`
- **Validation**:
  - Acquire row for update. If not found, raise `P0002`.
  - If current `status = 'archived'`, raise `P0015` (`STATE_CONFLICT`).
  - If `version <> p_expected_version`, raise `P0010` (`CONCURRENCY_CONFLICT`).
- **Execution**:
  - Transition status to `'archived'`:
    ```sql
    UPDATE public.products
    SET status = 'archived',
        archived_at = clock_timestamp(),
        archived_by = v_caller_id,
        version = version + 1,
        updated_by = v_caller_id,
        updated_at = clock_timestamp()
    WHERE id = p_product_id AND organization_id = p_org_id;
    ```
  - Note: Archiving permanently retains the SKU and barcode reservation.
  - Insert audit event: `product_archived` with `{ product_id, sku, version: version + 1 }`.

---

### 4.5 `restore_product`

- **Signature**:
  ```sql
  restore_product(
      p_org_id UUID,
      p_product_id UUID,
      p_expected_version INTEGER
  ) RETURNS JSONB
  ```
- **Permission**: `products:archive`
- **Validation**:
  - Acquire row for update. If not found, raise `P0002`.
  - If current `status != 'archived'`, raise `P0015` (`STATE_CONFLICT`).
  - If `version <> p_expected_version`, raise `P0010` (`CONCURRENCY_CONFLICT`).
- **Execution**:
  - Transition status to `'active'`:
    ```sql
    UPDATE public.products
    SET status = 'active',
        archived_at = NULL,
        archived_by = NULL,
        version = version + 1,
        updated_by = v_caller_id,
        updated_at = clock_timestamp()
    WHERE id = p_product_id AND organization_id = p_org_id;
    ```
  - Insert audit event: `product_restored` with `{ product_id, sku, version: version + 1 }`.
