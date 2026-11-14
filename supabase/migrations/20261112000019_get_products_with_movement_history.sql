-- ============================================================================
-- Migration: 20261112000019_get_products_with_movement_history.sql
-- Feature: 004 — Inventory & Stock Management (T025 History Completeness Hardening)
-- Description:
--   Forward migration adding a tenant-scoped, security-definer RPC to retrieve
--   distinct product IDs that have recorded stock movements.
--   Solves PostgREST max_rows truncation by executing SELECT DISTINCT within PostgreSQL,
--   guaranteeing complete history detection regardless of movement count.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_products_with_movement_history(
    p_org_id UUID,
    p_product_ids UUID[] DEFAULT NULL
) RETURNS TABLE(product_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    -- 1. Caller Authentication
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

    -- 2. Active Organization Status
    IF NOT EXISTS (
        SELECT 1 FROM public.organizations
        WHERE id = p_org_id AND is_active = TRUE
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ORGANIZATION_INACTIVE';
    END IF;

    -- 3. Active Membership Status
    IF NOT EXISTS (
        SELECT 1 FROM public.organization_memberships
        WHERE organization_id = p_org_id
          AND user_id = auth.uid()
          AND status = 'active'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'MEMBERSHIP_INACTIVE';
    END IF;

    -- 4. Granular RBAC Check (Requires inventory:read)
    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'inventory:read') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    -- 5. Return distinct product IDs with movement history
    IF p_product_ids IS NOT NULL AND array_length(p_product_ids, 1) > 0 THEN
        RETURN QUERY
        SELECT DISTINCT sm.product_id
        FROM public.stock_movements sm
        WHERE sm.organization_id = p_org_id
          AND sm.product_id = ANY(p_product_ids);
    ELSE
        RETURN QUERY
        SELECT DISTINCT sm.product_id
        FROM public.stock_movements sm
        WHERE sm.organization_id = p_org_id;
    END IF;
END;
$$;

-- Function Ownership & Permissions
ALTER FUNCTION public.get_products_with_movement_history(UUID, UUID[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_products_with_movement_history(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_products_with_movement_history(UUID, UUID[]) TO authenticated, service_role;


