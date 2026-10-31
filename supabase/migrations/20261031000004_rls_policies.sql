-- ============================================================================
-- Migration 04: Universal FORCE ROW LEVEL SECURITY & Granular RLS Policies
-- Feature: 001-auth-organization
-- Task: T010
-- ============================================================================

-- 1. Universal Activation of FORCE ROW LEVEL SECURITY
-- Enforces RLS on table owners and authenticated clients alike.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;

ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships FORCE ROW LEVEL SECURITY;

ALTER TABLE public.organization_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_audit_events FORCE ROW LEVEL SECURITY;

-- 2. Policies on `profiles`
CREATE POLICY "profiles_select_own"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (auth.uid() = id);

CREATE POLICY "profiles_select_peers"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (
        id IN (
            SELECT om.user_id
            FROM public.organization_memberships om
            WHERE om.organization_id IN (SELECT public.get_user_organization_ids())
              AND om.status = 'active'
        )
    );

CREATE POLICY "profiles_update_own"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_insert_deny"
    ON public.profiles FOR INSERT
    TO authenticated
    WITH CHECK (false);

CREATE POLICY "profiles_delete_deny"
    ON public.profiles FOR DELETE
    TO authenticated
    USING (false);

-- 3. Policies on `organizations`
CREATE POLICY "organizations_select_member"
    ON public.organizations FOR SELECT
    TO authenticated
    USING (id IN (SELECT public.get_user_organization_ids()));

-- Admins and Owners can update business metadata, but CANNOT alter is_active directly
CREATE POLICY "organizations_update_admin"
    ON public.organizations FOR UPDATE
    TO authenticated
    USING (public.is_org_member(id, ARRAY['owner', 'admin']::public.app_role[]))
    WITH CHECK (
        public.is_org_member(id, ARRAY['owner', 'admin']::public.app_role[])
        AND is_active = (SELECT o.is_active FROM public.organizations o WHERE o.id = organizations.id)
    );

CREATE POLICY "organizations_insert_deny"
    ON public.organizations FOR INSERT
    TO authenticated
    WITH CHECK (false);

CREATE POLICY "organizations_delete_deny"
    ON public.organizations FOR DELETE
    TO authenticated
    USING (false);

-- 4. Policies on `organization_memberships` (Direct Client Mutations DENIED)
-- All membership state changes MUST be routed through authenticated, locked database RPCs
CREATE POLICY "memberships_select_own"
    ON public.organization_memberships FOR SELECT
    TO authenticated
    USING (user_id = (SELECT auth.uid()));

CREATE POLICY "memberships_select_peers"
    ON public.organization_memberships FOR SELECT
    TO authenticated
    USING (organization_id IN (SELECT public.get_user_organization_ids()));

CREATE POLICY "memberships_update_deny_direct"
    ON public.organization_memberships FOR UPDATE
    TO authenticated
    USING (false);

CREATE POLICY "memberships_insert_deny_direct"
    ON public.organization_memberships FOR INSERT
    TO authenticated
    WITH CHECK (false);

CREATE POLICY "memberships_delete_deny_direct"
    ON public.organization_memberships FOR DELETE
    TO authenticated
    USING (false);

-- 5. Policies on `organization_audit_events` (Immutable Security Log)
-- Read-only access for organization Owners and Admins; client writes are completely blocked
CREATE POLICY "audit_events_select_admin"
    ON public.organization_audit_events FOR SELECT
    TO authenticated
    USING (public.is_org_member(organization_id, ARRAY['owner', 'admin']::public.app_role[]));

CREATE POLICY "audit_events_insert_deny"
    ON public.organization_audit_events FOR INSERT
    TO authenticated
    WITH CHECK (false);

CREATE POLICY "audit_events_update_deny"
    ON public.organization_audit_events FOR UPDATE
    TO authenticated
    USING (false);

CREATE POLICY "audit_events_delete_deny"
    ON public.organization_audit_events FOR DELETE
    TO authenticated
    USING (false);

