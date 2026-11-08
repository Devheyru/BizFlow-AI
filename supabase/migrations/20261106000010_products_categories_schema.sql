-- ============================================================================
-- Migration: 20261106000010_products_categories_schema.sql
-- Feature: 003 — Products & Categories
-- Description: Core schema, tables, constraints, composite FKs, indexes,
--              currency triggers, permission catalog seeds, role mappings,
--              Row-Level Security, private Storage bucket & policies, and
--              9 SECURITY DEFINER mutation RPCs with audit logging.
-- ============================================================================

-- ============================================================================
-- 1. Extensions
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- 2. Tables & Constraints
-- ============================================================================

-- 2.1 Table: public.product_categories
CREATE TABLE IF NOT EXISTS public.product_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    updated_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    archived_at TIMESTAMPTZ NULL,
    archived_by UUID NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    -- Constraints
    CONSTRAINT chk_category_name_length CHECK (
        char_length(trim(name)) BETWEEN 1 AND 100
    ),
    CONSTRAINT chk_category_description_length CHECK (
        description IS NULL OR char_length(trim(description)) <= 500
    ),
    CONSTRAINT chk_category_archival_status CHECK (
        (status = 'active' AND archived_at IS NULL AND archived_by IS NULL) OR
        (status = 'archived' AND archived_at IS NOT NULL AND archived_by IS NOT NULL)
    ),
    -- Composite unique key to support composite FK target from public.products
    CONSTRAINT uq_categories_org_id UNIQUE (organization_id, id)
);

-- Case-insensitive category name uniqueness per organization (enforced across active and archived)
CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_org_name 
ON public.product_categories (organization_id, lower(trim(name)));

-- Query performance index for filtering categories by status
CREATE INDEX IF NOT EXISTS idx_categories_org_status 
ON public.product_categories (organization_id, status);


-- 2.2 Table: public.products
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sku TEXT NOT NULL,
    barcode TEXT NULL,
    description TEXT NULL,
    category_id UUID NULL,
    selling_price NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
    unit_of_measure TEXT NOT NULL DEFAULT 'piece',
    image_url TEXT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    version INTEGER NOT NULL DEFAULT 1,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    updated_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    archived_at TIMESTAMPTZ NULL,
    archived_by UUID NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    -- Text length & format constraints
    CONSTRAINT chk_products_name_length CHECK (
        char_length(trim(name)) BETWEEN 1 AND 150
    ),
    CONSTRAINT chk_products_sku_format CHECK (
        sku = upper(trim(sku)) AND sku ~ '^[A-Z0-9_.-]{1,50}$'
    ),
    CONSTRAINT chk_products_barcode_format CHECK (
        barcode IS NULL OR (barcode = trim(barcode) AND barcode ~ '^[A-Za-z0-9-]{3,50}$')
    ),
    CONSTRAINT chk_products_description_length CHECK (
        description IS NULL OR char_length(trim(description)) <= 2000
    ),
    CONSTRAINT chk_products_selling_price_non_negative CHECK (
        selling_price >= 0.0000
    ),
    CONSTRAINT chk_products_unit_of_measure CHECK (
        unit_of_measure IN (
            'piece', 'unit', 'kg', 'g', 'mg', 'liter', 'ml', 'meter', 'cm', 'box', 'pack', 'pair', 'set'
        )
    ),
    CONSTRAINT chk_products_image_url_format CHECK (
        image_url IS NULL 
        OR image_url ~ '^https://.+' 
        OR image_url ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'
    ),
    CONSTRAINT chk_products_status CHECK (
        status IN ('active', 'inactive', 'archived')
    ),
    CONSTRAINT chk_products_version CHECK (
        version >= 1
    ),
    CONSTRAINT chk_products_archival_status CHECK (
        (status IN ('active', 'inactive') AND archived_at IS NULL AND archived_by IS NULL) OR
        (status = 'archived' AND archived_at IS NOT NULL AND archived_by IS NOT NULL)
    ),

    -- Composite unique key to support composite FK target from product_costs
    CONSTRAINT uq_products_org_id UNIQUE (organization_id, id),

    -- Permanent SKU uniqueness across organization (including archived products)
    CONSTRAINT uq_products_org_sku UNIQUE (organization_id, sku),

    -- Composite Foreign Key: Cross-tenant category prevention with column-specific NULLing
    CONSTRAINT fk_products_org_category FOREIGN KEY (organization_id, category_id)
        REFERENCES public.product_categories (organization_id, id)
        ON DELETE SET NULL (category_id)
);

-- Permanent Barcode uniqueness across organization for non-null barcodes (including archived products)
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_org_barcode 
ON public.products (organization_id, barcode) 
WHERE barcode IS NOT NULL;

-- B-Tree Indexes for catalog browsing, filtering, and prefix searching
CREATE INDEX IF NOT EXISTS idx_products_org_status_cat 
ON public.products (organization_id, status, category_id);

CREATE INDEX IF NOT EXISTS idx_products_name_prefix 
ON public.products (organization_id, name text_pattern_ops);

-- Trigram GIN Index for fast fuzzy and partial substring search (requires pg_trgm)
CREATE INDEX IF NOT EXISTS idx_products_name_trgm 
ON public.products USING gin (name gin_trgm_ops);


-- 2.3 Table: public.product_costs
CREATE TABLE IF NOT EXISTS public.product_costs (
    product_id UUID PRIMARY KEY,
    organization_id UUID NOT NULL,
    cost_price NUMERIC(14, 4) NOT NULL CHECK (cost_price >= 0.0000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    -- Composite Foreign Key: Ensures cost record matches product tenant and cascades on product delete
    CONSTRAINT fk_product_costs_org_product FOREIGN KEY (organization_id, product_id)
        REFERENCES public.products (organization_id, id)
        ON DELETE CASCADE,

    -- Direct Organization Foreign Key: Ensures org-level cascade handles cleanup
    CONSTRAINT fk_product_costs_org FOREIGN KEY (organization_id)
        REFERENCES public.organizations (id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_costs_org 
ON public.product_costs (organization_id);

-- ============================================================================
-- 3. Currency Helpers & Invariance Triggers
-- ============================================================================

-- 3.1 Currency Exponent Function
CREATE OR REPLACE FUNCTION public.get_currency_exponent(p_currency TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    CASE upper(trim(p_currency))
        -- 0 decimal places
        WHEN 'JPY', 'KRW', 'VND', 'CLP', 'PYG', 'UGX', 'RWF' THEN
            RETURN 0;
            
        -- 2 decimal places
        WHEN 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'CHF', 'SGD', 'HKD',
             'SEK', 'NOK', 'DKK', 'MXN', 'BRL', 'INR', 'ZAR', 'KES', 'NGN',
             'GHS', 'AED', 'SAR', 'QAR', 'EGP', 'COP', 'PEN', 'PHP', 'THB',
             'IDR', 'MYR' THEN
            RETURN 2;
            
        -- 3 decimal places
        WHEN 'BHD', 'KWD', 'OMR', 'JOD', 'TND', 'LYD', 'IQD' THEN
            RETURN 3;
            
        -- 4 decimal places
        WHEN 'CLF', 'UYW' THEN
            RETURN 4;
            
        ELSE
            RAISE EXCEPTION 'Unsupported or invalid ISO 4217 currency code: %', p_currency
                USING ERRCODE = 'P0009';
    END CASE;
END;
$$;

-- 3.2 Organization Currency Invariance Trigger
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

DROP TRIGGER IF EXISTS trg_prevent_currency_change_when_products_exist ON public.organizations;
CREATE TRIGGER trg_prevent_currency_change_when_products_exist
    BEFORE UPDATE OF currency ON public.organizations
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_currency_change_when_products_exist();

-- 3.3 Timestamp Updating Function & Triggers
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    NEW.updated_at = clock_timestamp();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_categories_updated_at ON public.product_categories;
CREATE TRIGGER trg_product_categories_updated_at
    BEFORE UPDATE ON public.product_categories
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_products_updated_at ON public.products;
CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON public.products
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_product_costs_updated_at ON public.product_costs;
CREATE TRIGGER trg_product_costs_updated_at
    BEFORE UPDATE ON public.product_costs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 4. RBAC Seed Data & Role Permissions
-- ============================================================================

-- Seed the 9 catalog permissions
INSERT INTO public.permissions (id, category, description)
VALUES
    ('products:read', 'products', 'View product catalog items and selling prices'),
    ('products:read_cost', 'products', 'View product acquisition costs and gross margins'),
    ('products:create', 'products', 'Create new product catalog entries and upload images'),
    ('products:update', 'products', 'Modify product details, selling prices, categories, and images'),
    ('products:archive', 'products', 'Archive or restore product catalog entries'),
    ('categories:read', 'categories', 'View product categories'),
    ('categories:create', 'categories', 'Create new product categories'),
    ('categories:update', 'categories', 'Modify category names and descriptions'),
    ('categories:archive', 'categories', 'Archive or restore product categories')
ON CONFLICT (id) DO UPDATE SET
    category = EXCLUDED.category,
    description = EXCLUDED.description;

-- Map permissions to roles in public.role_permissions
-- Admin role: all 9 catalog permissions
INSERT INTO public.role_permissions (role, permission_id)
VALUES
    ('admin', 'products:read'),
    ('admin', 'products:read_cost'),
    ('admin', 'products:create'),
    ('admin', 'products:update'),
    ('admin', 'products:archive'),
    ('admin', 'categories:read'),
    ('admin', 'categories:create'),
    ('admin', 'categories:update'),
    ('admin', 'categories:archive')
ON CONFLICT (role, permission_id) DO NOTHING;

-- Manager role: operational permissions (including read_cost, no archive)
INSERT INTO public.role_permissions (role, permission_id)
VALUES
    ('manager', 'products:read'),
    ('manager', 'products:read_cost'),
    ('manager', 'products:create'),
    ('manager', 'products:update'),
    ('manager', 'categories:read'),
    ('manager', 'categories:create'),
    ('manager', 'categories:update')
ON CONFLICT (role, permission_id) DO NOTHING;

-- Cashier role: read-only catalog access (no cost, no mutations)
INSERT INTO public.role_permissions (role, permission_id)
VALUES
    ('cashier', 'products:read'),
    ('cashier', 'categories:read')
ON CONFLICT (role, permission_id) DO NOTHING;

-- Note: 'owner' role receives automatic access to all registered permissions
-- via public.check_user_permission() rule 3.

-- ============================================================================
-- 5. Row-Level Security (RLS) & Direct DML Denial
-- ============================================================================

-- 5.1 Product Categories RLS
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read product categories of their organizations" ON public.product_categories;
CREATE POLICY "Users can read product categories of their organizations"
ON public.product_categories FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND public.check_user_permission(organization_id, auth.uid(), 'categories:read')
);

DROP POLICY IF EXISTS "Deny direct client insert on product_categories" ON public.product_categories;
CREATE POLICY "Deny direct client insert on product_categories"
ON public.product_categories FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "Deny direct client update on product_categories" ON public.product_categories;
CREATE POLICY "Deny direct client update on product_categories"
ON public.product_categories FOR UPDATE TO authenticated USING (false);

DROP POLICY IF EXISTS "Deny direct client delete on product_categories" ON public.product_categories;
CREATE POLICY "Deny direct client delete on product_categories"
ON public.product_categories FOR DELETE TO authenticated USING (false);


-- 5.2 Products RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read products of their organizations" ON public.products;
CREATE POLICY "Users can read products of their organizations"
ON public.products FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND public.check_user_permission(organization_id, auth.uid(), 'products:read')
);

DROP POLICY IF EXISTS "Deny direct client insert on products" ON public.products;
CREATE POLICY "Deny direct client insert on products"
ON public.products FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "Deny direct client update on products" ON public.products;
CREATE POLICY "Deny direct client update on products"
ON public.products FOR UPDATE TO authenticated USING (false);

DROP POLICY IF EXISTS "Deny direct client delete on products" ON public.products;
CREATE POLICY "Deny direct client delete on products"
ON public.products FOR DELETE TO authenticated USING (false);


-- 5.3 Product Costs RLS (Confidential Data Isolation)
ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_costs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users with products:read_cost can read product costs" ON public.product_costs;
CREATE POLICY "Users with products:read_cost can read product costs"
ON public.product_costs FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND public.check_user_permission(organization_id, auth.uid(), 'products:read_cost')
);

DROP POLICY IF EXISTS "Deny direct client insert on product_costs" ON public.product_costs;
CREATE POLICY "Deny direct client insert on product_costs"
ON public.product_costs FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "Deny direct client update on product_costs" ON public.product_costs;
CREATE POLICY "Deny direct client update on product_costs"
ON public.product_costs FOR UPDATE TO authenticated USING (false);

DROP POLICY IF EXISTS "Deny direct client delete on product_costs" ON public.product_costs;
CREATE POLICY "Deny direct client delete on product_costs"
ON public.product_costs FOR DELETE TO authenticated USING (false);

-- ============================================================================
-- 6. Storage Bucket & Policies
-- ============================================================================

-- Provision private product-images bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'product-images',
    'product-images',
    false,
    5242880, -- 5 MB
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[];

-- Storage Policy 1: SELECT
DROP POLICY IF EXISTS "product_images_select" ON storage.objects;
CREATE POLICY "product_images_select" ON storage.objects
FOR SELECT TO authenticated
USING (
    bucket_id = 'product-images'
    AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'
    AND public.is_org_member((storage.foldername(name))[1]::uuid)
    AND public.check_user_permission((storage.foldername(name))[1]::uuid, auth.uid(), 'products:read')
    AND EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = (storage.foldername(objects.name))[2]::uuid
          AND p.organization_id = (storage.foldername(objects.name))[1]::uuid
    )
);

-- Storage Policy 2: INSERT
DROP POLICY IF EXISTS "product_images_insert" ON storage.objects;
CREATE POLICY "product_images_insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'product-images'
    AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'
    AND public.is_org_member((storage.foldername(name))[1]::uuid)
    AND (
        public.check_user_permission((storage.foldername(name))[1]::uuid, auth.uid(), 'products:create')
        OR public.check_user_permission((storage.foldername(name))[1]::uuid, auth.uid(), 'products:update')
    )
    AND EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = (storage.foldername(objects.name))[2]::uuid
          AND p.organization_id = (storage.foldername(objects.name))[1]::uuid
    )
    AND (COALESCE(metadata->>'size', metadata->>'contentLength')) IS NOT NULL 
    AND (COALESCE(metadata->>'size', metadata->>'contentLength')) ~ '^[0-9]+$' 
    AND (COALESCE(metadata->>'size', metadata->>'contentLength'))::bigint <= 5242880
    AND metadata->>'mimetype' IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
);

-- Storage Policy 3: UPDATE
DROP POLICY IF EXISTS "product_images_update" ON storage.objects;
CREATE POLICY "product_images_update" ON storage.objects
FOR UPDATE TO authenticated
USING (
    bucket_id = 'product-images'
    AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'
    AND public.is_org_member((storage.foldername(name))[1]::uuid)
    AND public.check_user_permission((storage.foldername(name))[1]::uuid, auth.uid(), 'products:update')
    AND EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = (storage.foldername(objects.name))[2]::uuid
          AND p.organization_id = (storage.foldername(objects.name))[1]::uuid
    )
)
WITH CHECK (
    bucket_id = 'product-images'
    AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'
    AND public.is_org_member((storage.foldername(name))[1]::uuid)
    AND public.check_user_permission((storage.foldername(name))[1]::uuid, auth.uid(), 'products:update')
    AND EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = (storage.foldername(objects.name))[2]::uuid
          AND p.organization_id = (storage.foldername(objects.name))[1]::uuid
    )
    AND (COALESCE(metadata->>'size', metadata->>'contentLength')) IS NOT NULL 
    AND (COALESCE(metadata->>'size', metadata->>'contentLength')) ~ '^[0-9]+$' 
    AND (COALESCE(metadata->>'size', metadata->>'contentLength'))::bigint <= 5242880
    AND metadata->>'mimetype' IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
);

-- Storage Policy 4: DELETE
DROP POLICY IF EXISTS "product_images_delete" ON storage.objects;
CREATE POLICY "product_images_delete" ON storage.objects
FOR DELETE TO authenticated
USING (
    bucket_id = 'product-images'
    AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'
    AND public.is_org_member((storage.foldername(name))[1]::uuid)
    AND public.check_user_permission((storage.foldername(name))[1]::uuid, auth.uid(), 'products:update')
    AND EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = (storage.foldername(objects.name))[2]::uuid
          AND p.organization_id = (storage.foldername(objects.name))[1]::uuid
    )
);

-- ============================================================================
-- 7. Privileged Category Stored Procedures
-- ============================================================================

-- 7.1 create_product_category
CREATE OR REPLACE FUNCTION public.create_product_category(
    p_org_id UUID,
    p_name TEXT,
    p_description TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role public.app_role;
    v_name TEXT;
    v_description TEXT;
    v_category_id UUID;
    v_created_at TIMESTAMPTZ;
BEGIN
    -- Phase A: Authorization
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0003';
    END IF;

    IF NOT public.is_email_verified() THEN
        RAISE EXCEPTION 'Email verification required' USING ERRCODE = 'P0001';
    END IF;

    SELECT m.role INTO v_caller_role
    FROM public.organization_memberships m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.organization_id = p_org_id 
      AND m.user_id = v_caller_id 
      AND m.status = 'active'
      AND o.is_active = TRUE;

    IF NOT FOUND OR v_caller_role IS NULL THEN
        RAISE EXCEPTION 'Caller is not an active member of organization %', p_org_id
            USING ERRCODE = 'P0004';
    END IF;

    IF NOT public.check_user_permission(p_org_id, v_caller_id, 'categories:create') THEN
        RAISE EXCEPTION 'Forbidden: missing categories:create permission'
            USING ERRCODE = 'P0005';
    END IF;

    -- Phase B: Validation
    v_name := trim(p_name);
    IF v_name IS NULL OR char_length(v_name) < 1 OR char_length(v_name) > 100 THEN
        RAISE EXCEPTION 'Category name must be between 1 and 100 characters' USING ERRCODE = 'P0009';
    END IF;

    v_description := nullif(trim(p_description), '');
    IF v_description IS NOT NULL AND char_length(v_description) > 500 THEN
        RAISE EXCEPTION 'Description exceeds maximum length of 500 characters' USING ERRCODE = 'P0009';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.product_categories
        WHERE organization_id = p_org_id 
          AND lower(trim(name)) = lower(v_name)
    ) THEN
        RAISE EXCEPTION 'Category name "%" already exists in this organization', v_name
            USING ERRCODE = 'P0006';
    END IF;

    -- Phase C: Atomic Mutation
    INSERT INTO public.product_categories (
        organization_id, name, description, status, created_by, updated_by
    )
    VALUES (
        p_org_id, v_name, v_description, 'active', v_caller_id, v_caller_id
    )
    RETURNING id, created_at INTO v_category_id, v_created_at;

    INSERT INTO public.organization_audit_events (
        organization_id, actor_id, event_type, metadata
    )
    VALUES (
        p_org_id,
        v_caller_id,
        'category_created',
        jsonb_build_object('category_id', v_category_id, 'name', v_name)
    );

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'id', v_category_id,
            'organization_id', p_org_id,
            'name', v_name,
            'description', v_description,
            'status', 'active',
            'created_at', v_created_at
        )
    );
END;
$$;


-- 7.2 update_product_category
CREATE OR REPLACE FUNCTION public.update_product_category(
    p_org_id UUID,
    p_category_id UUID,
    p_name TEXT,
    p_description TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role public.app_role;
    v_name TEXT;
    v_description TEXT;
    v_existing_name TEXT;
    v_existing_status TEXT;
    v_updated_at TIMESTAMPTZ;
BEGIN
    -- Phase A: Authorization
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0003';
    END IF;

    IF NOT public.is_email_verified() THEN
        RAISE EXCEPTION 'Email verification required' USING ERRCODE = 'P0001';
    END IF;

    SELECT m.role INTO v_caller_role
    FROM public.organization_memberships m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.organization_id = p_org_id 
      AND m.user_id = v_caller_id 
      AND m.status = 'active'
      AND o.is_active = TRUE;

    IF NOT FOUND OR v_caller_role IS NULL THEN
        RAISE EXCEPTION 'Caller is not an active member of organization %', p_org_id
            USING ERRCODE = 'P0004';
    END IF;

    IF NOT public.check_user_permission(p_org_id, v_caller_id, 'categories:update') THEN
        RAISE EXCEPTION 'Forbidden: missing categories:update permission'
            USING ERRCODE = 'P0005';
    END IF;

    -- Phase B: Validation & Row Lock
    SELECT name, status INTO v_existing_name, v_existing_status
    FROM public.product_categories
    WHERE id = p_category_id AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Category not found in this organization' USING ERRCODE = 'P0002';
    END IF;

    IF v_existing_status = 'archived' THEN
        RAISE EXCEPTION 'Archived category cannot be updated' USING ERRCODE = 'P0015';
    END IF;

    v_name := trim(p_name);
    IF v_name IS NULL OR char_length(v_name) < 1 OR char_length(v_name) > 100 THEN
        RAISE EXCEPTION 'Category name must be between 1 and 100 characters' USING ERRCODE = 'P0009';
    END IF;

    v_description := nullif(trim(p_description), '');
    IF v_description IS NOT NULL AND char_length(v_description) > 500 THEN
        RAISE EXCEPTION 'Description exceeds maximum length of 500 characters' USING ERRCODE = 'P0009';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.product_categories
        WHERE organization_id = p_org_id 
          AND lower(trim(name)) = lower(v_name)
          AND id <> p_category_id
    ) THEN
        RAISE EXCEPTION 'Category name "%" already exists in this organization', v_name
            USING ERRCODE = 'P0006';
    END IF;

    -- Phase C: Atomic Mutation
    UPDATE public.product_categories
    SET name = v_name,
        description = v_description,
        updated_by = v_caller_id,
        updated_at = clock_timestamp()
    WHERE id = p_category_id AND organization_id = p_org_id
    RETURNING updated_at INTO v_updated_at;

    INSERT INTO public.organization_audit_events (
        organization_id, actor_id, event_type, metadata
    )
    VALUES (
        p_org_id,
        v_caller_id,
        'category_updated',
        jsonb_build_object(
            'category_id', p_category_id,
            'old_name', v_existing_name,
            'new_name', v_name
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'id', p_category_id,
            'organization_id', p_org_id,
            'name', v_name,
            'description', v_description,
            'status', 'active',
            'updated_at', v_updated_at
        )
    );
END;
$$;


-- 7.3 archive_product_category
CREATE OR REPLACE FUNCTION public.archive_product_category(
    p_org_id UUID,
    p_category_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role public.app_role;
    v_existing_name TEXT;
    v_existing_status TEXT;
    v_archived_at TIMESTAMPTZ;
BEGIN
    -- Phase A: Authorization
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0003';
    END IF;

    IF NOT public.is_email_verified() THEN
        RAISE EXCEPTION 'Email verification required' USING ERRCODE = 'P0001';
    END IF;

    SELECT m.role INTO v_caller_role
    FROM public.organization_memberships m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.organization_id = p_org_id 
      AND m.user_id = v_caller_id 
      AND m.status = 'active'
      AND o.is_active = TRUE;

    IF NOT FOUND OR v_caller_role IS NULL THEN
        RAISE EXCEPTION 'Caller is not an active member of organization %', p_org_id
            USING ERRCODE = 'P0004';
    END IF;

    IF NOT public.check_user_permission(p_org_id, v_caller_id, 'categories:archive') THEN
        RAISE EXCEPTION 'Forbidden: missing categories:archive permission'
            USING ERRCODE = 'P0005';
    END IF;

    -- Phase B: Validation & Row Lock
    SELECT name, status INTO v_existing_name, v_existing_status
    FROM public.product_categories
    WHERE id = p_category_id AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Category not found in this organization' USING ERRCODE = 'P0002';
    END IF;

    IF v_existing_status = 'archived' THEN
        RAISE EXCEPTION 'Category is already archived' USING ERRCODE = 'P0015';
    END IF;

    -- Phase C: Atomic Mutation
    UPDATE public.product_categories
    SET status = 'archived',
        archived_at = clock_timestamp(),
        archived_by = v_caller_id,
        updated_by = v_caller_id,
        updated_at = clock_timestamp()
    WHERE id = p_category_id AND organization_id = p_org_id
    RETURNING archived_at INTO v_archived_at;

    INSERT INTO public.organization_audit_events (
        organization_id, actor_id, event_type, metadata
    )
    VALUES (
        p_org_id,
        v_caller_id,
        'category_archived',
        jsonb_build_object('category_id', p_category_id, 'name', v_existing_name)
    );

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'id', p_category_id,
            'organization_id', p_org_id,
            'name', v_existing_name,
            'status', 'archived',
            'archived_at', v_archived_at
        )
    );
END;
$$;


-- 7.4 restore_product_category
CREATE OR REPLACE FUNCTION public.restore_product_category(
    p_org_id UUID,
    p_category_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role public.app_role;
    v_existing_name TEXT;
    v_existing_status TEXT;
    v_updated_at TIMESTAMPTZ;
BEGIN
    -- Phase A: Authorization
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0003';
    END IF;

    IF NOT public.is_email_verified() THEN
        RAISE EXCEPTION 'Email verification required' USING ERRCODE = 'P0001';
    END IF;

    SELECT m.role INTO v_caller_role
    FROM public.organization_memberships m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.organization_id = p_org_id 
      AND m.user_id = v_caller_id 
      AND m.status = 'active'
      AND o.is_active = TRUE;

    IF NOT FOUND OR v_caller_role IS NULL THEN
        RAISE EXCEPTION 'Caller is not an active member of organization %', p_org_id
            USING ERRCODE = 'P0004';
    END IF;

    IF NOT public.check_user_permission(p_org_id, v_caller_id, 'categories:archive') THEN
        RAISE EXCEPTION 'Forbidden: missing categories:archive permission'
            USING ERRCODE = 'P0005';
    END IF;

    -- Phase B: Validation & Row Lock
    SELECT name, status INTO v_existing_name, v_existing_status
    FROM public.product_categories
    WHERE id = p_category_id AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Category not found in this organization' USING ERRCODE = 'P0002';
    END IF;

    IF v_existing_status <> 'archived' THEN
        RAISE EXCEPTION 'Category is not archived' USING ERRCODE = 'P0015';
    END IF;

    -- Phase C: Atomic Mutation
    UPDATE public.product_categories
    SET status = 'active',
        archived_at = NULL,
        archived_by = NULL,
        updated_by = v_caller_id,
        updated_at = clock_timestamp()
    WHERE id = p_category_id AND organization_id = p_org_id
    RETURNING updated_at INTO v_updated_at;

    INSERT INTO public.organization_audit_events (
        organization_id, actor_id, event_type, metadata
    )
    VALUES (
        p_org_id,
        v_caller_id,
        'category_restored',
        jsonb_build_object('category_id', p_category_id, 'name', v_existing_name)
    );

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'id', p_category_id,
            'organization_id', p_org_id,
            'name', v_existing_name,
            'status', 'active',
            'updated_at', v_updated_at
        )
    );
END;
$$;

-- ============================================================================
-- 8. Privileged Product Stored Procedures
-- ============================================================================

-- 8.1 create_product
CREATE OR REPLACE FUNCTION public.create_product(
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
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role public.app_role;
    v_name TEXT;
    v_sku TEXT;
    v_barcode TEXT;
    v_description TEXT;
    v_image_url TEXT;
    v_cat_status TEXT;
    v_org_currency TEXT;
    v_max_decimals INTEGER;
    v_product_id UUID;
    v_created_at TIMESTAMPTZ;
BEGIN
    -- Phase A: Authorization
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0003';
    END IF;

    IF NOT public.is_email_verified() THEN
        RAISE EXCEPTION 'Email verification required' USING ERRCODE = 'P0001';
    END IF;

    SELECT m.role INTO v_caller_role
    FROM public.organization_memberships m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.organization_id = p_org_id 
      AND m.user_id = v_caller_id 
      AND m.status = 'active'
      AND o.is_active = TRUE;

    IF NOT FOUND OR v_caller_role IS NULL THEN
        RAISE EXCEPTION 'Caller is not an active member of organization %', p_org_id
            USING ERRCODE = 'P0004';
    END IF;

    IF NOT public.check_user_permission(p_org_id, v_caller_id, 'products:create') THEN
        RAISE EXCEPTION 'Forbidden: missing products:create permission'
            USING ERRCODE = 'P0005';
    END IF;

    IF p_cost_price IS NOT NULL THEN
        IF NOT public.check_user_permission(p_org_id, v_caller_id, 'products:read_cost') THEN
            RAISE EXCEPTION 'Forbidden: missing products:read_cost permission to set cost'
                USING ERRCODE = 'P0005';
        END IF;
    END IF;

    -- Phase B: Validation & Currency Lock
    IF p_status IS NULL OR p_status <> 'active' THEN
        RAISE EXCEPTION 'Initial product status must be active' USING ERRCODE = 'P0015';
    END IF;

    IF p_unit_of_measure IS NULL OR p_unit_of_measure NOT IN (
        'piece', 'unit', 'kg', 'g', 'mg', 'liter', 'ml', 'meter', 'cm', 'box', 'pack', 'pair', 'set'
    ) THEN
        RAISE EXCEPTION 'Invalid unit of measure: %', p_unit_of_measure USING ERRCODE = 'P0009';
    END IF;

    v_name := trim(p_name);
    IF v_name IS NULL OR char_length(v_name) < 1 OR char_length(v_name) > 150 THEN
        RAISE EXCEPTION 'Product name must be between 1 and 150 characters' USING ERRCODE = 'P0009';
    END IF;

    v_description := nullif(trim(p_description), '');
    IF v_description IS NOT NULL AND char_length(v_description) > 2000 THEN
        RAISE EXCEPTION 'Description exceeds maximum length of 2000 characters' USING ERRCODE = 'P0009';
    END IF;

    v_sku := upper(trim(p_sku));
    IF v_sku IS NULL OR v_sku !~ '^[A-Z0-9_.-]{1,50}$' THEN
        RAISE EXCEPTION 'Invalid SKU format: %', p_sku USING ERRCODE = 'P0009';
    END IF;

    IF EXISTS (SELECT 1 FROM public.products WHERE organization_id = p_org_id AND sku = v_sku) THEN
        RAISE EXCEPTION 'SKU "%" already exists in organization catalog', v_sku USING ERRCODE = 'P0006';
    END IF;

    v_barcode := nullif(trim(p_barcode), '');
    IF v_barcode IS NOT NULL THEN
        IF v_barcode !~ '^[A-Za-z0-9-]{3,50}$' THEN
            RAISE EXCEPTION 'Invalid barcode format: %', p_barcode USING ERRCODE = 'P0009';
        END IF;
        IF EXISTS (SELECT 1 FROM public.products WHERE organization_id = p_org_id AND barcode = v_barcode) THEN
            RAISE EXCEPTION 'Barcode "%" already exists in organization catalog', v_barcode USING ERRCODE = 'P0006';
        END IF;
    END IF;

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

    v_image_url := nullif(trim(p_image_url), '');
    IF v_image_url IS NOT NULL THEN
        IF v_image_url !~ '^https://.+' AND v_image_url !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$' THEN
            RAISE EXCEPTION 'Invalid image URL format' USING ERRCODE = 'P0009';
        END IF;
        IF v_image_url ~ '^[0-9a-f-]{36}/' AND NOT v_image_url LIKE p_org_id::text || '/%' THEN
            RAISE EXCEPTION 'Image path must belong to current organization' USING ERRCODE = 'P0009';
        END IF;
    END IF;

    -- Concurrency row-level shared lock on organization currency
    SELECT o.currency INTO v_org_currency
    FROM public.organizations o
    WHERE o.id = p_org_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002';
    END IF;

    v_max_decimals := public.get_currency_exponent(v_org_currency);

    IF p_selling_price IS NULL OR p_selling_price < 0 THEN
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

    -- Phase C: Atomic Mutation
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

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'id', v_product_id,
            'organization_id', p_org_id,
            'name', v_name,
            'sku', v_sku,
            'barcode', v_barcode,
            'description', v_description,
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
END;
$$;


-- 8.2 update_product
CREATE OR REPLACE FUNCTION public.update_product(
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
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role public.app_role;
    v_target_product public.products%ROWTYPE;
    v_name TEXT;
    v_sku TEXT;
    v_barcode TEXT;
    v_description TEXT;
    v_image_url TEXT;
    v_cat_status TEXT;
    v_org_currency TEXT;
    v_max_decimals INTEGER;
    v_new_version INTEGER;
    v_updated_at TIMESTAMPTZ;
BEGIN
    -- Phase A: Authorization
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0003';
    END IF;

    IF NOT public.is_email_verified() THEN
        RAISE EXCEPTION 'Email verification required' USING ERRCODE = 'P0001';
    END IF;

    SELECT m.role INTO v_caller_role
    FROM public.organization_memberships m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.organization_id = p_org_id 
      AND m.user_id = v_caller_id 
      AND m.status = 'active'
      AND o.is_active = TRUE;

    IF NOT FOUND OR v_caller_role IS NULL THEN
        RAISE EXCEPTION 'Caller is not an active member of organization %', p_org_id
            USING ERRCODE = 'P0004';
    END IF;

    IF NOT public.check_user_permission(p_org_id, v_caller_id, 'products:update') THEN
        RAISE EXCEPTION 'Forbidden: missing products:update permission'
            USING ERRCODE = 'P0005';
    END IF;

    IF p_cost_operation IN ('set', 'clear') THEN
        IF NOT public.check_user_permission(p_org_id, v_caller_id, 'products:read_cost') THEN
            RAISE EXCEPTION 'Forbidden: missing products:read_cost permission to modify cost'
                USING ERRCODE = 'P0005';
        END IF;
    END IF;

    -- Phase B: Validation & Row Lock
    SELECT * INTO v_target_product
    FROM public.products
    WHERE id = p_product_id AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found in this organization' USING ERRCODE = 'P0002';
    END IF;

    IF v_target_product.status = 'archived' THEN
        RAISE EXCEPTION 'Archived product cannot be updated' USING ERRCODE = 'P0015';
    END IF;

    IF v_target_product.version <> p_expected_version THEN
        RAISE EXCEPTION 'Stale update conflict' USING ERRCODE = 'P0010';
    END IF;

    IF p_cost_operation NOT IN ('unchanged', 'set', 'clear') THEN
        RAISE EXCEPTION 'Invalid cost operation: %', p_cost_operation USING ERRCODE = 'P0016';
    END IF;

    IF p_unit_of_measure IS NULL OR p_unit_of_measure NOT IN (
        'piece', 'unit', 'kg', 'g', 'mg', 'liter', 'ml', 'meter', 'cm', 'box', 'pack', 'pair', 'set'
    ) THEN
        RAISE EXCEPTION 'Invalid unit of measure: %', p_unit_of_measure USING ERRCODE = 'P0009';
    END IF;

    v_name := trim(p_name);
    IF v_name IS NULL OR char_length(v_name) < 1 OR char_length(v_name) > 150 THEN
        RAISE EXCEPTION 'Product name must be between 1 and 150 characters' USING ERRCODE = 'P0009';
    END IF;

    v_description := nullif(trim(p_description), '');
    IF v_description IS NOT NULL AND char_length(v_description) > 2000 THEN
        RAISE EXCEPTION 'Description exceeds maximum length of 2000 characters' USING ERRCODE = 'P0009';
    END IF;

    v_sku := upper(trim(p_sku));
    IF v_sku IS NULL OR v_sku !~ '^[A-Z0-9_.-]{1,50}$' THEN
        RAISE EXCEPTION 'Invalid SKU format: %', p_sku USING ERRCODE = 'P0009';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.products
        WHERE organization_id = p_org_id 
          AND sku = v_sku 
          AND id <> p_product_id
    ) THEN
        RAISE EXCEPTION 'SKU "%" already exists in organization catalog', v_sku USING ERRCODE = 'P0006';
    END IF;

    v_barcode := nullif(trim(p_barcode), '');
    IF v_barcode IS NOT NULL THEN
        IF v_barcode !~ '^[A-Za-z0-9-]{3,50}$' THEN
            RAISE EXCEPTION 'Invalid barcode format: %', p_barcode USING ERRCODE = 'P0009';
        END IF;
        IF EXISTS (
            SELECT 1 FROM public.products
            WHERE organization_id = p_org_id 
              AND barcode = v_barcode 
              AND id <> p_product_id
        ) THEN
            RAISE EXCEPTION 'Barcode "%" already exists in organization catalog', v_barcode USING ERRCODE = 'P0006';
        END IF;
    END IF;

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

    v_image_url := nullif(trim(p_image_url), '');
    IF v_image_url IS NOT NULL THEN
        IF v_image_url !~ '^https://.+' AND v_image_url !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$' THEN
            RAISE EXCEPTION 'Invalid image URL format' USING ERRCODE = 'P0009';
        END IF;
        IF v_image_url ~ '^[0-9a-f-]{36}/' AND NOT v_image_url LIKE p_org_id::text || '/%' THEN
            RAISE EXCEPTION 'Image path must belong to current organization' USING ERRCODE = 'P0009';
        END IF;
    END IF;

    -- Concurrency row-level shared lock on organization currency
    SELECT o.currency INTO v_org_currency
    FROM public.organizations o
    WHERE o.id = p_org_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002';
    END IF;

    v_max_decimals := public.get_currency_exponent(v_org_currency);

    IF p_selling_price IS NULL OR p_selling_price < 0 THEN
        RAISE EXCEPTION 'Selling price cannot be negative' USING ERRCODE = 'P0007';
    END IF;

    IF p_selling_price * (10 ^ v_max_decimals) != round(p_selling_price * (10 ^ v_max_decimals)) THEN
        RAISE EXCEPTION 'Selling price exceeds maximum decimal places (%) for currency %',
            v_max_decimals, v_org_currency USING ERRCODE = 'P0009';
    END IF;

    IF p_cost_operation = 'set' THEN
        IF p_cost_price IS NULL THEN
            RAISE EXCEPTION 'Cost price required when cost_operation is set' USING ERRCODE = 'P0008';
        END IF;
        IF p_cost_price < 0 THEN
            RAISE EXCEPTION 'Cost price cannot be negative' USING ERRCODE = 'P0007';
        END IF;
        IF p_cost_price * (10 ^ v_max_decimals) != round(p_cost_price * (10 ^ v_max_decimals)) THEN
            RAISE EXCEPTION 'Cost price exceeds maximum decimal places (%) for currency %',
                v_max_decimals, v_org_currency USING ERRCODE = 'P0009';
        END IF;
    END IF;

    -- Phase C: Atomic Mutation
    UPDATE public.products
    SET name = v_name,
        sku = v_sku,
        barcode = v_barcode,
        description = v_description,
        category_id = p_category_id,
        selling_price = p_selling_price,
        unit_of_measure = p_unit_of_measure,
        image_url = v_image_url,
        version = version + 1,
        updated_by = v_caller_id,
        updated_at = clock_timestamp()
    WHERE id = p_product_id AND organization_id = p_org_id
    RETURNING version, updated_at INTO v_new_version, v_updated_at;

    IF p_cost_operation = 'set' THEN
        INSERT INTO public.product_costs (
            organization_id,
            product_id,
            cost_price,
            updated_at
        )
        VALUES (
            p_org_id,
            p_product_id,
            p_cost_price,
            clock_timestamp()
        )
        ON CONFLICT (product_id)
        DO UPDATE SET
            cost_price = EXCLUDED.cost_price,
            updated_at = EXCLUDED.updated_at;
    ELSIF p_cost_operation = 'clear' THEN
        DELETE FROM public.product_costs
        WHERE organization_id = p_org_id AND product_id = p_product_id;
    END IF;

    INSERT INTO public.organization_audit_events (
        organization_id,
        actor_id,
        event_type,
        metadata
    )
    VALUES (
        p_org_id,
        v_caller_id,
        'product_updated',
        jsonb_build_object(
            'product_id', p_product_id,
            'sku', v_sku,
            'version', v_new_version,
            'cost_operation', p_cost_operation
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'id', p_product_id,
            'organization_id', p_org_id,
            'name', v_name,
            'sku', v_sku,
            'barcode', v_barcode,
            'description', v_description,
            'category_id', p_category_id,
            'selling_price', p_selling_price,
            'unit_of_measure', p_unit_of_measure,
            'status', v_target_product.status,
            'version', v_new_version,
            'image_url', v_image_url,
            'updated_at', v_updated_at,
            'cost_price', CASE 
                WHEN public.check_user_permission(p_org_id, v_caller_id, 'products:read_cost') THEN (
                    SELECT cost_price FROM public.product_costs
                    WHERE organization_id = p_org_id AND product_id = p_product_id
                )
                ELSE NULL 
            END
        )
    );
END;
$$;


-- 8.3 toggle_product_status
CREATE OR REPLACE FUNCTION public.toggle_product_status(
    p_org_id UUID,
    p_product_id UUID,
    p_expected_version INTEGER,
    p_new_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role public.app_role;
    v_target_product public.products%ROWTYPE;
    v_new_version INTEGER;
    v_updated_at TIMESTAMPTZ;
BEGIN
    -- Phase A: Authorization
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0003';
    END IF;

    IF NOT public.is_email_verified() THEN
        RAISE EXCEPTION 'Email verification required' USING ERRCODE = 'P0001';
    END IF;

    SELECT m.role INTO v_caller_role
    FROM public.organization_memberships m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.organization_id = p_org_id 
      AND m.user_id = v_caller_id 
      AND m.status = 'active'
      AND o.is_active = TRUE;

    IF NOT FOUND OR v_caller_role IS NULL THEN
        RAISE EXCEPTION 'Caller is not an active member of organization %', p_org_id
            USING ERRCODE = 'P0004';
    END IF;

    IF NOT public.check_user_permission(p_org_id, v_caller_id, 'products:update') THEN
        RAISE EXCEPTION 'Forbidden: missing products:update permission'
            USING ERRCODE = 'P0005';
    END IF;

    -- Phase B: Validation & Row Lock
    SELECT * INTO v_target_product
    FROM public.products
    WHERE id = p_product_id AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found in this organization' USING ERRCODE = 'P0002';
    END IF;

    IF v_target_product.version <> p_expected_version THEN
        RAISE EXCEPTION 'Stale update conflict' USING ERRCODE = 'P0010';
    END IF;

    IF v_target_product.status = 'archived' THEN
        RAISE EXCEPTION 'Cannot change status of archived product' USING ERRCODE = 'P0015';
    END IF;

    IF p_new_status = 'archived' THEN
        RAISE EXCEPTION 'Cannot toggle status to archived' USING ERRCODE = 'P0015';
    END IF;

    IF p_new_status NOT IN ('active', 'inactive') THEN
        RAISE EXCEPTION 'Invalid status for toggle: %', p_new_status USING ERRCODE = 'P0009';
    END IF;

    -- Phase C: Atomic Mutation
    UPDATE public.products
    SET status = p_new_status,
        version = version + 1,
        updated_by = v_caller_id,
        updated_at = clock_timestamp()
    WHERE id = p_product_id AND organization_id = p_org_id
    RETURNING version, updated_at INTO v_new_version, v_updated_at;

    INSERT INTO public.organization_audit_events (
        organization_id,
        actor_id,
        event_type,
        metadata
    )
    VALUES (
        p_org_id,
        v_caller_id,
        'product_status_changed',
        jsonb_build_object(
            'product_id', p_product_id,
            'old_status', v_target_product.status,
            'new_status', p_new_status,
            'version', v_new_version
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'id', p_product_id,
            'organization_id', p_org_id,
            'status', p_new_status,
            'version', v_new_version,
            'updated_at', v_updated_at
        )
    );
END;
$$;


-- 8.4 archive_product
CREATE OR REPLACE FUNCTION public.archive_product(
    p_org_id UUID,
    p_product_id UUID,
    p_expected_version INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role public.app_role;
    v_target_product public.products%ROWTYPE;
    v_new_version INTEGER;
    v_archived_at TIMESTAMPTZ;
BEGIN
    -- Phase A: Authorization
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0003';
    END IF;

    IF NOT public.is_email_verified() THEN
        RAISE EXCEPTION 'Email verification required' USING ERRCODE = 'P0001';
    END IF;

    SELECT m.role INTO v_caller_role
    FROM public.organization_memberships m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.organization_id = p_org_id 
      AND m.user_id = v_caller_id 
      AND m.status = 'active'
      AND o.is_active = TRUE;

    IF NOT FOUND OR v_caller_role IS NULL THEN
        RAISE EXCEPTION 'Caller is not an active member of organization %', p_org_id
            USING ERRCODE = 'P0004';
    END IF;

    IF NOT public.check_user_permission(p_org_id, v_caller_id, 'products:archive') THEN
        RAISE EXCEPTION 'Forbidden: missing products:archive permission'
            USING ERRCODE = 'P0005';
    END IF;

    -- Phase B: Validation & Row Lock
    SELECT * INTO v_target_product
    FROM public.products
    WHERE id = p_product_id AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found in this organization' USING ERRCODE = 'P0002';
    END IF;

    IF v_target_product.version <> p_expected_version THEN
        RAISE EXCEPTION 'Stale update conflict' USING ERRCODE = 'P0010';
    END IF;

    IF v_target_product.status = 'archived' THEN
        RAISE EXCEPTION 'Product is already archived' USING ERRCODE = 'P0015';
    END IF;

    -- Phase C: Atomic Mutation
    UPDATE public.products
    SET status = 'archived',
        archived_at = clock_timestamp(),
        archived_by = v_caller_id,
        version = version + 1,
        updated_by = v_caller_id,
        updated_at = clock_timestamp()
    WHERE id = p_product_id AND organization_id = p_org_id
    RETURNING version, archived_at INTO v_new_version, v_archived_at;

    INSERT INTO public.organization_audit_events (
        organization_id,
        actor_id,
        event_type,
        metadata
    )
    VALUES (
        p_org_id,
        v_caller_id,
        'product_archived',
        jsonb_build_object(
            'product_id', p_product_id,
            'sku', v_target_product.sku,
            'version', v_new_version
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'id', p_product_id,
            'organization_id', p_org_id,
            'status', 'archived',
            'version', v_new_version,
            'archived_at', v_archived_at
        )
    );
END;
$$;


-- 8.5 restore_product
CREATE OR REPLACE FUNCTION public.restore_product(
    p_org_id UUID,
    p_product_id UUID,
    p_expected_version INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role public.app_role;
    v_target_product public.products%ROWTYPE;
    v_new_version INTEGER;
    v_updated_at TIMESTAMPTZ;
BEGIN
    -- Phase A: Authorization
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0003';
    END IF;

    IF NOT public.is_email_verified() THEN
        RAISE EXCEPTION 'Email verification required' USING ERRCODE = 'P0001';
    END IF;

    SELECT m.role INTO v_caller_role
    FROM public.organization_memberships m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.organization_id = p_org_id 
      AND m.user_id = v_caller_id 
      AND m.status = 'active'
      AND o.is_active = TRUE;

    IF NOT FOUND OR v_caller_role IS NULL THEN
        RAISE EXCEPTION 'Caller is not an active member of organization %', p_org_id
            USING ERRCODE = 'P0004';
    END IF;

    IF NOT public.check_user_permission(p_org_id, v_caller_id, 'products:archive') THEN
        RAISE EXCEPTION 'Forbidden: missing products:archive permission'
            USING ERRCODE = 'P0005';
    END IF;

    -- Phase B: Validation & Row Lock
    SELECT * INTO v_target_product
    FROM public.products
    WHERE id = p_product_id AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found in this organization' USING ERRCODE = 'P0002';
    END IF;

    IF v_target_product.version <> p_expected_version THEN
        RAISE EXCEPTION 'Stale update conflict' USING ERRCODE = 'P0010';
    END IF;

    IF v_target_product.status <> 'archived' THEN
        RAISE EXCEPTION 'Product is not archived' USING ERRCODE = 'P0015';
    END IF;

    -- Phase C: Atomic Mutation
    UPDATE public.products
    SET status = 'active',
        archived_at = NULL,
        archived_by = NULL,
        version = version + 1,
        updated_by = v_caller_id,
        updated_at = clock_timestamp()
    WHERE id = p_product_id AND organization_id = p_org_id
    RETURNING version, updated_at INTO v_new_version, v_updated_at;

    INSERT INTO public.organization_audit_events (
        organization_id,
        actor_id,
        event_type,
        metadata
    )
    VALUES (
        p_org_id,
        v_caller_id,
        'product_restored',
        jsonb_build_object(
            'product_id', p_product_id,
            'sku', v_target_product.sku,
            'version', v_new_version
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'id', p_product_id,
            'organization_id', p_org_id,
            'status', 'active',
            'version', v_new_version,
            'updated_at', v_updated_at
        )
    );
END;
$$;

-- ============================================================================
-- 9. Security Hardening & Execution Privilege Revocation
-- ============================================================================

-- Function 1: get_currency_exponent
ALTER FUNCTION public.get_currency_exponent(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_currency_exponent(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_currency_exponent(TEXT) TO authenticated, service_role;

-- Function 2: create_product_category
ALTER FUNCTION public.create_product_category(UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_product_category(UUID, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_product_category(UUID, TEXT, TEXT) TO authenticated;

-- Function 3: update_product_category
ALTER FUNCTION public.update_product_category(UUID, UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_product_category(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_product_category(UUID, UUID, TEXT, TEXT) TO authenticated;

-- Function 4: archive_product_category
ALTER FUNCTION public.archive_product_category(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.archive_product_category(UUID, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.archive_product_category(UUID, UUID) TO authenticated;

-- Function 5: restore_product_category
ALTER FUNCTION public.restore_product_category(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.restore_product_category(UUID, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.restore_product_category(UUID, UUID) TO authenticated;

-- Function 6: create_product
ALTER FUNCTION public.create_product(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, NUMERIC, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_product(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, NUMERIC, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_product(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, NUMERIC, TEXT) TO authenticated;

-- Function 7: update_product
ALTER FUNCTION public.update_product(UUID, UUID, INTEGER, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID, NUMERIC, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_product(UUID, UUID, INTEGER, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_product(UUID, UUID, INTEGER, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID, NUMERIC, TEXT, TEXT) TO authenticated;

-- Function 8: toggle_product_status
ALTER FUNCTION public.toggle_product_status(UUID, UUID, INTEGER, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.toggle_product_status(UUID, UUID, INTEGER, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.toggle_product_status(UUID, UUID, INTEGER, TEXT) TO authenticated;

-- Function 9: archive_product
ALTER FUNCTION public.archive_product(UUID, UUID, INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.archive_product(UUID, UUID, INTEGER) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.archive_product(UUID, UUID, INTEGER) TO authenticated;

-- Function 10: restore_product
ALTER FUNCTION public.restore_product(UUID, UUID, INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.restore_product(UUID, UUID, INTEGER) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.restore_product(UUID, UUID, INTEGER) TO authenticated;

-- Function 11: prevent_currency_change_when_products_exist
ALTER FUNCTION public.prevent_currency_change_when_products_exist() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prevent_currency_change_when_products_exist() FROM PUBLIC, anon;

-- Function 12: update_updated_at_column
ALTER FUNCTION public.update_updated_at_column() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO authenticated, service_role;

-- ============================================================================
-- 10. Security Assertion Verification
-- ============================================================================

DO $$
DECLARE
    v_anon_count INTEGER;
    v_service_role_count INTEGER;
BEGIN
    SELECT count(*) INTO v_anon_count
    FROM information_schema.routine_privileges
    WHERE grantee IN ('PUBLIC', 'anon')
      AND specific_schema = 'public'
      AND routine_name IN (
          'get_currency_exponent',
          'create_product_category',
          'update_product_category',
          'archive_product_category',
          'restore_product_category',
          'create_product',
          'update_product',
          'toggle_product_status',
          'archive_product',
          'restore_product'
      );

    IF v_anon_count > 0 THEN
        RAISE EXCEPTION 'Security verification failed: % privileges still granted to PUBLIC or anon on Feature 003 routines', v_anon_count;
    END IF;

    SELECT count(*) INTO v_service_role_count
    FROM information_schema.routine_privileges
    WHERE grantee = 'service_role'
      AND specific_schema = 'public'
      AND routine_name IN (
          'create_product_category',
          'update_product_category',
          'archive_product_category',
          'restore_product_category',
          'create_product',
          'update_product',
          'toggle_product_status',
          'archive_product',
          'restore_product'
      );

    IF v_service_role_count > 0 THEN
        RAISE EXCEPTION 'Security verification failed: % privileges still granted to service_role on Feature 003 mutation routines', v_service_role_count;
    END IF;
END $$;
