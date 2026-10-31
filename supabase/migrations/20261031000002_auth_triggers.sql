-- ============================================================================
-- Migration 02: Auth User Profile Synchronization & Owner Invariant Triggers
-- Feature: 001-auth-organization
-- Task: T008
-- ============================================================================

-- 1. User Profile Sync Trigger (auth.users -> public.profiles)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    INSERT INTO public.profiles (id, first_name, last_name, phone)
    VALUES (
        NEW.id,
        COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'first_name'), ''), 'Retail'),
        COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'last_name'), ''), 'User'),
        NULLIF(trim(NEW.raw_user_meta_data->>'phone'), '')
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user OWNER TO postgres;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Owner Invariant Defensive Trigger (Prevents deleting or demoting last active Owner)
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
    IF (TG_OP = 'DELETE' AND OLD.role = 'owner') OR
       (TG_OP = 'UPDATE' AND OLD.role = 'owner' AND (NEW.role != 'owner' OR NEW.status != 'active')) THEN
        
        -- Acquire organization lock to serialize with concurrent demotions
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

DROP TRIGGER IF EXISTS trg_check_owner_invariant ON public.organization_memberships;
CREATE TRIGGER trg_check_owner_invariant
    BEFORE UPDATE OR DELETE ON public.organization_memberships
    FOR EACH ROW EXECUTE FUNCTION public.check_owner_invariant();

