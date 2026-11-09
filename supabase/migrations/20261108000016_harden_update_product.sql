-- Migration: 20261108000016_harden_update_product.sql
-- Feature 003 — Phase 5: Harden update_product with strict OCC, tenant/product storage isolation, and ARE regex

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

    IF p_image_url IS NOT NULL THEN
        -- 1. Reject whitespace anywhere in raw URL
        IF p_image_url ~ '\s' THEN
            RAISE EXCEPTION 'Image URL must not contain whitespace'
                USING ERRCODE = 'P0009';
        END IF;

        -- 2. If storage path prefix, enforce strict tenant + product ownership and canonical format
        IF p_image_url ~ '^[0-9a-f-]{36}/' THEN
            IF NOT p_image_url LIKE p_org_id::text || '/' || p_product_id::text || '/%' THEN
                RAISE EXCEPTION 'Image path must belong to current organization and product'
                    USING ERRCODE = 'P0009';
            END IF;
            IF p_image_url !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]+$' THEN
                RAISE EXCEPTION 'Invalid storage image path format'
                    USING ERRCODE = 'P0009';
            END IF;
        ELSE
            -- 3. External HTTPS URL: Clean ARE regex validation
            IF p_image_url !~ '^https://[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*(:[0-9]+)?([/?#][^[:space:]]*)?$' THEN
                RAISE EXCEPTION 'Invalid image URL format. Must be a secure HTTPS URL or valid storage path'
                    USING ERRCODE = 'P0009';
            END IF;
        END IF;

        v_image_url := p_image_url;
    ELSE
        v_image_url := NULL;
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

ALTER FUNCTION public.update_product(UUID, UUID, INTEGER, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID, NUMERIC, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_product(UUID, UUID, INTEGER, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_product(UUID, UUID, INTEGER, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID, NUMERIC, TEXT, TEXT) TO authenticated;

