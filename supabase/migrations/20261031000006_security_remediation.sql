-- ============================================================================
-- Migration 06: Security Remediation & Active Organization Enforcement
-- Feature: 001-auth-organization
-- Task: Targeted Security Remediation (T006-T010)
-- ============================================================================

-- 1. Finding 1: Revoke and DROP privileged testing RPC
-- Unauthenticated / client-callable privileged functions must never exist in the database.
REVOKE ALL ON FUNCTION public.demote_member_role_for_testing(UUID, UUID, public.app_role, NUMERIC) FROM PUBLIC, authenticated;
DROP FUNCTION IF EXISTS public.demote_member_role_for_testing(UUID, UUID, public.app_role, NUMERIC);

-- 2. Finding 2: Enforce active organization status in security helpers
-- Both helpers must verify o.is_active = true in addition to om.status = 'active'.
CREATE OR REPLACE FUNCTION public.get_user_organization_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT om.organization_id
    FROM public.organization_memberships om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = auth.uid()
      AND om.status = 'active'
      AND o.is_active = true;
$$;

ALTER FUNCTION public.get_user_organization_ids OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_user_organization_ids FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_organization_ids TO authenticated;

CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id UUID, p_roles public.app_role[] DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.organization_memberships om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.organization_id = p_org_id
          AND om.user_id = auth.uid()
          AND om.status = 'active'
          AND o.is_active = true
          AND (p_roles IS NULL OR om.role = ANY(p_roles))
    );
$$;

ALTER FUNCTION public.is_org_member OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_org_member FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_member TO authenticated;

-- 3. Finding 2: Enforce active organization status on membership querying
-- Ensure memberships of closed organizations cannot be queried by ordinary authenticated users.
DROP POLICY IF EXISTS "memberships_select_own" ON public.organization_memberships;
DROP POLICY IF EXISTS "memberships_select_peers" ON public.organization_memberships;
DROP POLICY IF EXISTS "memberships_select_active_org" ON public.organization_memberships;

CREATE POLICY "memberships_select_active_org"
    ON public.organization_memberships FOR SELECT
    TO authenticated
    USING (organization_id IN (SELECT public.get_user_organization_ids()));

