-- Migration: 20261108000013_fix_url_validation_regex_create_product.sql
-- Feature 003 — Phase 4 Remediation: Standards-aligned database URL validation regex fix
-- Corrects POSIX whitespace/character-class handling in PostgreSQL ARE syntax.
-- Enforces strict HTTPS URL syntax, non-empty authority/hostname, optional port,
-- optional path/query/fragment, no whitespace, and rejects all storage paths / malformed schemes.

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
        -- 1. Explicitly reject internal Supabase Storage paths
        IF v_image_url ~ '^[0-9a-f-]{36}/' THEN
            RAISE EXCEPTION 'Internal storage paths are not permitted during product creation. Use external HTTPS URL or create with null image'
                USING ERRCODE = 'P0009';
        END IF;

        -- 2. Reject raw whitespace anywhere in the URL string
        IF v_image_url ~ '\s' THEN
            RAISE EXCEPTION 'Image URL must not contain whitespace'
                USING ERRCODE = 'P0009';
        END IF;

        -- 3. Strict HTTPS URL syntax enforcement:
        -- Must start with https://, followed by a non-empty hostname (RFC 1123 domain or IP),
        -- optional port, and optional path, query, or fragment.
        -- Rejects empty authority (e.g. https:///), non-HTTPS schemes, and malformed characters.
        IF v_image_url !~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]+)?([/?#][^[:space:]]*)?$' THEN
            RAISE EXCEPTION 'Invalid image URL format. Must be a secure HTTPS URL'
                USING ERRCODE = 'P0009';
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

ALTER FUNCTION public.create_product(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, NUMERIC, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_product(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, NUMERIC, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_product(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, NUMERIC, TEXT) TO authenticated;

