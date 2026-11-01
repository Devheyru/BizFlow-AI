-- ============================================================================
-- Migration: 20261031000007_create_organization_rpc.sql
-- Description: Implement create_organization_with_owner() stored procedure (T028)
--
-- Security Guarantees & Remediations:
-- 1. SECURITY DEFINER owned by postgres with locked search_path = pg_catalog, public, pg_temp
-- 2. Requires authenticated session (auth.uid() IS NOT NULL) -> P0003
-- 3. Requires email-verified account via public.is_email_verified() -> P0001
-- 4. Database-level input validation on all required and optional parameters (P0008, P0009)
-- 5. Timezone validated against pg_catalog.pg_timezone_names
-- 6. Non-null p_client_mutation_id required (P0008)
-- 7. Idempotency strictly bound to (created_by, client_mutation_id)
-- 8. Safe idempotent replay: rejects inactive organizations (P0015) and callers who lost active membership (P0005)
-- 9. Atomic creation of organization, Owner membership, and organization.created audit event
-- 10. Handles concurrent duplicate submissions gracefully via unique_violation trapping and inactive checks
-- ============================================================================

-- Drop old function signature if existing to allow parameter default modification
DROP FUNCTION IF EXISTS public.create_organization_with_owner(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_organization_with_owner(
    p_name TEXT,
    p_slug TEXT,
    p_business_type TEXT,
    p_country TEXT,
    p_currency TEXT,
    p_timezone TEXT,
    p_client_mutation_id UUID,
    p_tax_id TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_email TEXT DEFAULT NULL,
    p_address TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_org_id UUID;
    v_existing_org RECORD;
    v_caller_role app_role;
    v_final_slug TEXT;
    v_clean_email TEXT;
BEGIN
    -- 1. Enforce Authentication
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0003';
    END IF;

    -- 2. Enforce Email Verification Gate
    IF NOT public.is_email_verified() THEN
        RAISE EXCEPTION 'Email verification required before creating an organization' USING ERRCODE = 'P0001';
    END IF;

    -- 3. Enforce Non-Null Mutation Identifier (Finding 1.1)
    IF p_client_mutation_id IS NULL THEN
        RAISE EXCEPTION 'client_mutation_id is required for organization creation' USING ERRCODE = 'P0008';
    END IF;

    -- 4. Validate Organization Name (Finding 1.2)
    IF p_name IS NULL OR char_length(trim(p_name)) < 2 OR char_length(trim(p_name)) > 100 THEN
        RAISE EXCEPTION 'Organization name must be between 2 and 100 characters' USING ERRCODE = 'P0009';
    END IF;

    -- 5. Validate Business Type (Finding 1.3)
    IF p_business_type IS NULL OR char_length(trim(p_business_type)) < 2 OR char_length(trim(p_business_type)) > 50 THEN
        RAISE EXCEPTION 'Business type is required and must be between 2 and 50 characters' USING ERRCODE = 'P0009';
    END IF;

    -- 6. Validate Country Code (Strict ISO 3166-1 alpha-2) (Finding 1.5)
    IF p_country IS NULL OR upper(trim(p_country)) !~ '^[A-Z]{2}$' THEN
        RAISE EXCEPTION 'Country must be a 2-letter uppercase ISO 3166-1 alpha-2 code' USING ERRCODE = 'P0009';
    END IF;

    -- 7. Validate Currency Code (Strict ISO 4217) (Finding 1.5)
    IF p_currency IS NULL OR upper(trim(p_currency)) !~ '^[A-Z]{3}$' THEN
        RAISE EXCEPTION 'Currency must be a 3-letter uppercase ISO 4217 code' USING ERRCODE = 'P0009';
    END IF;

    -- 8. Validate Timezone against PostgreSQL recognized timezone names (Finding 1.4)
    IF p_timezone IS NULL OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = trim(p_timezone)
    ) THEN
        RAISE EXCEPTION 'Invalid timezone: must be a recognized IANA timezone' USING ERRCODE = 'P0009';
    END IF;

    -- 9. Validate Optional Fields (Finding 1.6)
    IF p_tax_id IS NOT NULL AND char_length(trim(p_tax_id)) > 50 THEN
        RAISE EXCEPTION 'Tax ID must not exceed 50 characters' USING ERRCODE = 'P0009';
    END IF;

    IF p_phone IS NOT NULL AND char_length(trim(p_phone)) > 30 THEN
        RAISE EXCEPTION 'Phone number must not exceed 30 characters' USING ERRCODE = 'P0009';
    END IF;

    IF p_email IS NOT NULL AND trim(p_email) != '' THEN
        v_clean_email := lower(trim(p_email));
        IF v_clean_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
            RAISE EXCEPTION 'Invalid business email format' USING ERRCODE = 'P0009';
        END IF;
    ELSE
        v_clean_email := NULL;
    END IF;

    IF p_address IS NOT NULL AND char_length(trim(p_address)) > 255 THEN
        RAISE EXCEPTION 'Address must not exceed 255 characters' USING ERRCODE = 'P0009';
    END IF;

    -- 10. Creator-Bound Idempotency Check (Fast Path) (Finding 2)
    SELECT id, name, slug, business_type, country, currency, timezone, is_active
    INTO v_existing_org
    FROM public.organizations
    WHERE client_mutation_id = p_client_mutation_id
      AND created_by = v_user_id;

    IF FOUND THEN
        -- Reject inactive organizations on fast-path replay (Finding 2)
        IF NOT v_existing_org.is_active THEN
            RAISE EXCEPTION 'This organization is no longer active' USING ERRCODE = 'P0015';
        END IF;

        -- Query caller's actual role dynamically
        SELECT role INTO v_caller_role
        FROM public.organization_memberships
        WHERE organization_id = v_existing_org.id
          AND user_id = v_user_id
          AND status = 'active';

        -- Prevent data exposure if creator lost active membership
        IF v_caller_role IS NULL THEN
            RAISE EXCEPTION 'Caller is no longer an active member of this organization' USING ERRCODE = 'P0005';
        END IF;

        RETURN jsonb_build_object(
            'organization_id', v_existing_org.id,
            'name', v_existing_org.name,
            'slug', v_existing_org.slug,
            'business_type', v_existing_org.business_type,
            'country', v_existing_org.country,
            'currency', v_existing_org.currency,
            'timezone', v_existing_org.timezone,
            'role', v_caller_role,
            'is_active', v_existing_org.is_active,
            'is_idempotent_replay', true
        );
    END IF;

    -- 11. Slug Resolution & Uniqueness
    IF p_slug IS NOT NULL AND trim(p_slug) != '' THEN
        v_final_slug := lower(trim(p_slug));
        IF v_final_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
            RAISE EXCEPTION 'Invalid slug format: must be lowercase alphanumeric with hyphens' USING ERRCODE = 'P0009';
        END IF;
    ELSE
        v_final_slug := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '-', 'g'));
        v_final_slug := trim(both '-' from v_final_slug);
        IF v_final_slug = '' THEN
            v_final_slug := 'org';
        END IF;
    END IF;

    -- Ensure unique slug by appending random hex if collision exists
    WHILE EXISTS (SELECT 1 FROM public.organizations WHERE slug = v_final_slug) LOOP
        v_final_slug := v_final_slug || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
    END LOOP;

    -- 12. Atomic Organization Creation
    BEGIN
        INSERT INTO public.organizations (
            name,
            slug,
            business_type,
            country,
            currency,
            timezone,
            tax_id,
            phone,
            email,
            address,
            created_by,
            client_mutation_id
        ) VALUES (
            trim(p_name),
            v_final_slug,
            trim(p_business_type),
            upper(trim(p_country)),
            upper(trim(p_currency)),
            trim(p_timezone),
            CASE WHEN p_tax_id IS NOT NULL AND trim(p_tax_id) != '' THEN trim(p_tax_id) ELSE NULL END,
            CASE WHEN p_phone IS NOT NULL AND trim(p_phone) != '' THEN trim(p_phone) ELSE NULL END,
            v_clean_email,
            CASE WHEN p_address IS NOT NULL AND trim(p_address) != '' THEN trim(p_address) ELSE NULL END,
            v_user_id,
            p_client_mutation_id
        )
        RETURNING id INTO v_org_id;

    EXCEPTION WHEN unique_violation THEN
        -- Handle concurrent duplicate submission with identical (created_by, client_mutation_id) (Finding 2)
        SELECT id, name, slug, business_type, country, currency, timezone, is_active
        INTO v_existing_org
        FROM public.organizations
        WHERE client_mutation_id = p_client_mutation_id
          AND created_by = v_user_id;

        IF FOUND THEN
            -- Reject inactive organizations on concurrent conflict recovery (Finding 2)
            IF NOT v_existing_org.is_active THEN
                RAISE EXCEPTION 'This organization is no longer active' USING ERRCODE = 'P0015';
            END IF;

            SELECT role INTO v_caller_role
            FROM public.organization_memberships
            WHERE organization_id = v_existing_org.id
              AND user_id = v_user_id
              AND status = 'active';

            IF v_caller_role IS NULL THEN
                RAISE EXCEPTION 'Caller is no longer an active member of this organization' USING ERRCODE = 'P0005';
            END IF;

            RETURN jsonb_build_object(
                'organization_id', v_existing_org.id,
                'name', v_existing_org.name,
                'slug', v_existing_org.slug,
                'business_type', v_existing_org.business_type,
                'country', v_existing_org.country,
                'currency', v_existing_org.currency,
                'timezone', v_existing_org.timezone,
                'role', v_caller_role,
                'is_active', v_existing_org.is_active,
                'is_idempotent_replay', true
            );
        END IF;
        RAISE;
    END;

    -- 13. Assign Creator as Initial Owner
    INSERT INTO public.organization_memberships (
        organization_id,
        user_id,
        role,
        status
    ) VALUES (
        v_org_id,
        v_user_id,
        'owner',
        'active'
    );

    -- 14. Record Atomic Audit Event
    INSERT INTO public.organization_audit_events (
        organization_id,
        actor_id,
        event_type,
        metadata
    ) VALUES (
        v_org_id,
        v_user_id,
        'organization.created',
        jsonb_build_object(
            'name', trim(p_name),
            'slug', v_final_slug,
            'business_type', trim(p_business_type),
            'country', upper(trim(p_country)),
            'currency', upper(trim(p_currency)),
            'timezone', trim(p_timezone),
            'client_mutation_id', p_client_mutation_id
        )
    );

    -- 15. Return Summary Result
    RETURN jsonb_build_object(
        'organization_id', v_org_id,
        'name', trim(p_name),
        'slug', v_final_slug,
        'business_type', trim(p_business_type),
        'country', upper(trim(p_country)),
        'currency', upper(trim(p_currency)),
        'timezone', trim(p_timezone),
        'role', 'owner',
        'is_active', true,
        'is_idempotent_replay', false
    );
END;
$$;

-- Secure Execution Privileges
ALTER FUNCTION public.create_organization_with_owner OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_organization_with_owner FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_organization_with_owner TO authenticated;
