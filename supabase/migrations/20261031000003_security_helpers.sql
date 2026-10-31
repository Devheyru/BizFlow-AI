-- ============================================================================
-- Migration 03: Non-Recursive Security & Authorization Helper Functions
-- Feature: 001-auth-organization
-- Task: T009
-- ============================================================================

-- 1. Helper: Check if calling user's email is confirmed in auth.users
-- Uses SECURITY DEFINER owned by postgres with isolated search_path to read auth.users safely
CREATE OR REPLACE FUNCTION public.is_email_verified()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, auth, pg_temp
AS $$
    SELECT COALESCE(
        (SELECT email_confirmed_at IS NOT NULL FROM auth.users WHERE id = auth.uid()),
        false
    );
$$;

ALTER FUNCTION public.is_email_verified OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_email_verified FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_email_verified TO authenticated;

-- 2. Helper: Get all active organization IDs for the calling user
-- Non-Recursive Mechanics: Owned by postgres (holding BYPASSRLS in Supabase).
-- When evaluated from RLS policies, this function queries organization_memberships
-- directly without re-triggering RLS, completely eliminating policy recursion.
CREATE OR REPLACE FUNCTION public.get_user_organization_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT organization_id
    FROM public.organization_memberships
    WHERE user_id = auth.uid()
      AND status = 'active';
$$;

ALTER FUNCTION public.get_user_organization_ids OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_user_organization_ids FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_organization_ids TO authenticated;

-- 3. Helper: Check if calling user is an active member with specific roles
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id UUID, p_roles public.app_role[] DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.organization_memberships
        WHERE organization_id = p_org_id
          AND user_id = auth.uid()
          AND status = 'active'
          AND (p_roles IS NULL OR role = ANY(p_roles))
    );
$$;

ALTER FUNCTION public.is_org_member OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_org_member FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_member TO authenticated;

