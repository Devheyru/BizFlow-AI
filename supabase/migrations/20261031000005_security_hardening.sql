-- ============================================================================
-- Migration 05: Security Hardening & Defenses
-- Feature: 001-auth-organization
-- Task: Security Audit Hardening (T006-T010)
-- ============================================================================

-- 1. Audit Event Retention: Change ON DELETE CASCADE to ON DELETE RESTRICT
-- Prevents deletion of organizations that contain immutable audit history.
ALTER TABLE public.organization_audit_events
    DROP CONSTRAINT IF EXISTS organization_audit_events_organization_id_fkey;

ALTER TABLE public.organization_audit_events
    ADD CONSTRAINT organization_audit_events_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
    ON DELETE RESTRICT;

-- 2. Database-level Protection for Organization Protected/Lifecycle Fields
-- Enforces that created_by is strictly immutable, and lifecycle fields (is_active,
-- closed_at, closed_by) cannot be altered by standard UPDATE statements.
CREATE OR REPLACE FUNCTION public.check_organization_immutable_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    -- created_by is immutable once written
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION 'created_by is immutable'
            USING ERRCODE = '42501';
    END IF;

    -- Lifecycle fields require specialized lifecycle transaction flag
    IF (NEW.is_active IS DISTINCT FROM OLD.is_active OR
        NEW.closed_at IS DISTINCT FROM OLD.closed_at OR
        NEW.closed_by IS DISTINCT FROM OLD.closed_by) THEN
        IF current_setting('bizflow.allow_org_lifecycle_update', true) IS DISTINCT FROM 'true' THEN
            RAISE EXCEPTION 'Organization lifecycle fields (is_active, closed_at, closed_by) cannot be modified directly'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.check_organization_immutable_fields OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_check_org_immutable_fields ON public.organizations;
CREATE TRIGGER trg_check_org_immutable_fields
    BEFORE UPDATE ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION public.check_organization_immutable_fields();

-- 3. RLS-level Hardening for Organization Updates (Clean, Non-recursive)
-- Protected fields are enforced at the database layer via trg_check_org_immutable_fields.
-- RLS ensures only owners/admins can update the organization record.
DROP POLICY IF EXISTS "organizations_update_admin" ON public.organizations;
CREATE POLICY "organizations_update_admin"
    ON public.organizations FOR UPDATE
    TO authenticated
    USING (public.is_org_member(id, ARRAY['owner', 'admin']::public.app_role[]))
    WITH CHECK (public.is_org_member(id, ARRAY['owner', 'admin']::public.app_role[]));

-- 4. Owner Invariant & Membership Immutability Hardening
-- Enforces membership organization_id and user_id immutability,
-- and locks parent organization to guarantee serialized evaluation against concurrent demotions.
CREATE OR REPLACE FUNCTION public.check_owner_invariant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_org_id UUID := COALESCE(NEW.organization_id, OLD.organization_id);
    v_owner_count INT;
BEGIN
    -- Prevent changing organization_id or user_id on an existing membership
    IF TG_OP = 'UPDATE' THEN
        IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
            RAISE EXCEPTION 'organization_id cannot be changed on existing membership'
                USING ERRCODE = '42501';
        END IF;
        IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
            RAISE EXCEPTION 'user_id cannot be changed on existing membership'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Evaluate invariant if an active owner is being deleted, demoted, or deactivated
    IF (TG_OP = 'DELETE' AND OLD.role = 'owner' AND OLD.status = 'active') OR
       (TG_OP = 'UPDATE' AND OLD.role = 'owner' AND OLD.status = 'active' AND (NEW.role != 'owner' OR NEW.status != 'active')) THEN
        
        -- Acquire exclusive row-level lock on the parent organization to serialize concurrent transactions
        PERFORM 1 FROM public.organizations WHERE id = v_org_id FOR UPDATE;

        SELECT COUNT(*) INTO v_owner_count
        FROM public.organization_memberships
        WHERE organization_id = v_org_id
          AND role = 'owner'
          AND status = 'active'
          AND id != OLD.id;
          
        IF v_owner_count < 1 THEN
            RAISE EXCEPTION 'Cannot remove or demote the last active owner of an organization. Transfer ownership first.'
                USING ERRCODE = 'P0002';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

ALTER FUNCTION public.check_owner_invariant OWNER TO postgres;

-- 5. Test/Administrative RPC for Demoting Member Role
-- Enables testing concurrent operations and executing authorized role changes from server contexts.
CREATE OR REPLACE FUNCTION public.demote_member_role_for_testing(
    p_org_id UUID,
    p_user_id UUID,
    p_new_role public.app_role,
    p_sleep_seconds NUMERIC DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF p_sleep_seconds > 0 THEN
        PERFORM pg_sleep(p_sleep_seconds);
    END IF;

    UPDATE public.organization_memberships
    SET role = p_new_role,
        updated_at = now()
    WHERE organization_id = p_org_id
      AND user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.demote_member_role_for_testing OWNER TO postgres;
REVOKE ALL ON FUNCTION public.demote_member_role_for_testing FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.demote_member_role_for_testing TO authenticated;
