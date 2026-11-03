-- ============================================================================
-- Migration: 20261103000009_employee_management_rbac.sql
-- Feature: 002 — Employee Management & Role-Based Access Control (RBAC)
-- Description: Core schema, tables, enums, partial unique indexes, RLS policies,
--              permission catalog seeds, role mappings, and 9 SECURITY DEFINER RPCs.
-- ============================================================================

-- ============================================================================
-- 1. Enums
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invitation_status') THEN
        CREATE TYPE public.invitation_status AS ENUM (
            'pending',
            'accepted',
            'declined',
            'revoked',
            'expired'
        );
    END IF;
END $$;

-- ============================================================================
-- 2. Organization Invitations Table & Indexes
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.organization_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role public.app_role NOT NULL,
    token_hash TEXT NOT NULL,
    invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    status public.invitation_status NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT chk_invitation_email_syntax CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    CONSTRAINT chk_invitation_email_normalized CHECK (email = lower(trim(email))),
    CONSTRAINT chk_invitation_token_hash CHECK (token_hash ~ '^[a-f0-9]{64}$')
);

-- Partial Unique Index: only 1 pending invitation per email per organization
CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_invitation
    ON public.organization_invitations (organization_id, email)
    WHERE (status = 'pending');

-- Unique Token Hash Index
CREATE UNIQUE INDEX IF NOT EXISTS uq_organization_invitations_token_hash
    ON public.organization_invitations (token_hash);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_organization_invitations_org_status
    ON public.organization_invitations (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_organization_invitations_email
    ON public.organization_invitations (email);

CREATE INDEX IF NOT EXISTS idx_organization_invitations_expires_at
    ON public.organization_invitations (expires_at);

-- ============================================================================
-- 3. Permissions Catalog & Role-Permissions Schema
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.permissions (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_permission_colon_notation CHECK (id ~ '^[a-z]+:[a-z_]+$')
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
    role public.app_role NOT NULL,
    permission_id TEXT NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (role, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role
    ON public.role_permissions (role);

-- ============================================================================
-- 4. Row-Level Security (RLS) Configuration
-- ============================================================================

-- A. organization_invitations
ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invitations FORCE ROW LEVEL SECURITY;

-- Allow active Owners and Admins to view invitations in their organization
DROP POLICY IF EXISTS "Active owners and admins can view organization invitations" ON public.organization_invitations;
CREATE POLICY "Active owners and admins can view organization invitations"
    ON public.organization_invitations
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.organization_memberships m
            WHERE m.organization_id = organization_invitations.organization_id
              AND m.user_id = auth.uid()
              AND m.status = 'active'
              AND m.role IN ('owner', 'admin')
        )
    );

-- Explicitly deny client-side direct mutations (mutations must go through SECURITY DEFINER RPCs)
DROP POLICY IF EXISTS "Deny client direct inserts on organization_invitations" ON public.organization_invitations;
CREATE POLICY "Deny client direct inserts on organization_invitations"
    ON public.organization_invitations
    FOR INSERT
    TO authenticated
    WITH CHECK (false);

DROP POLICY IF EXISTS "Deny client direct updates on organization_invitations" ON public.organization_invitations;
CREATE POLICY "Deny client direct updates on organization_invitations"
    ON public.organization_invitations
    FOR UPDATE
    TO authenticated
    USING (false);

DROP POLICY IF EXISTS "Deny client direct deletes on organization_invitations" ON public.organization_invitations;
CREATE POLICY "Deny client direct deletes on organization_invitations"
    ON public.organization_invitations
    FOR DELETE
    TO authenticated
    USING (false);

-- B. permissions & role_permissions
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view permissions catalog" ON public.permissions;
CREATE POLICY "Authenticated users can view permissions catalog"
    ON public.permissions
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Deny client direct mutations on permissions" ON public.permissions;
CREATE POLICY "Deny client direct mutations on permissions"
    ON public.permissions
    FOR ALL
    TO authenticated
    USING (false)
    WITH CHECK (false);

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view role permissions" ON public.role_permissions;
CREATE POLICY "Authenticated users can view role permissions"
    ON public.role_permissions
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Deny client direct mutations on role_permissions" ON public.role_permissions;
CREATE POLICY "Deny client direct mutations on role_permissions"
    ON public.role_permissions
    FOR ALL
    TO authenticated
    USING (false)
    WITH CHECK (false);

-- ============================================================================
-- 5. Seed Permissions & Deterministic Role Mappings
-- ============================================================================

INSERT INTO public.permissions (id, category, description)
VALUES
    ('employees:read', 'employees', 'View employee directory and workforce status'),
    ('employees:invite', 'employees', 'Issue and resend employee organization invitations'),
    ('employees:update_role', 'employees', 'Change employee organizational roles'),
    ('employees:suspend', 'employees', 'Suspend and reactivate employee organization access'),
    ('employees:remove', 'employees', 'Remove employees from organization (soft revocation)'),
    ('employees:invitations_read', 'employees', 'View pending organization invitations'),
    ('employees:invitations_revoke', 'employees', 'Revoke pending organization invitations')
ON CONFLICT (id) DO NOTHING;

-- Map all 7 permissions to Admin
INSERT INTO public.role_permissions (role, permission_id)
VALUES
    ('admin', 'employees:read'),
    ('admin', 'employees:invite'),
    ('admin', 'employees:update_role'),
    ('admin', 'employees:suspend'),
    ('admin', 'employees:remove'),
    ('admin', 'employees:invitations_read'),
    ('admin', 'employees:invitations_revoke')
ON CONFLICT (role, permission_id) DO NOTHING;

-- Map read-only permissions to Manager
INSERT INTO public.role_permissions (role, permission_id)
VALUES
    ('manager', 'employees:read')
ON CONFLICT (role, permission_id) DO NOTHING;

-- ============================================================================
-- 6. Centralized Permission Helper (Database-Level 4-Rule Engine)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_user_permission(
    p_org_id UUID,
    p_user_id UUID,
    p_permission TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_role public.app_role;
BEGIN
    -- 1. Catalog Existence Requirement: The evaluated permission key MUST exist in public.permissions
    IF NOT EXISTS (SELECT 1 FROM public.permissions WHERE id = p_permission) THEN
        RETURN FALSE;
    END IF;

    -- 2. Caller must be an active member of an active organization
    SELECT m.role INTO v_role
    FROM public.organization_memberships m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.organization_id = p_org_id
      AND m.user_id = p_user_id
      AND m.status = 'active'
      AND o.is_active = TRUE;

    IF v_role IS NULL THEN
        RETURN FALSE;
    END IF;

    -- 3. Owner Automatic Access: Active Owners dynamically receive access to all registered permissions
    IF v_role = 'owner' THEN
        RETURN TRUE;
    END IF;

    -- 4. Other Roles: Evaluated against deterministic role_permissions mappings
    RETURN EXISTS (
        SELECT 1
        FROM public.role_permissions
        WHERE role = v_role
          AND permission_id = p_permission
    );
END;
$$;

ALTER FUNCTION public.check_user_permission OWNER TO postgres;
REVOKE ALL ON FUNCTION public.check_user_permission FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_user_permission TO authenticated, service_role;

-- ============================================================================
-- 7. Stored Procedure 1: create_organization_invitation
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_organization_invitation(
    p_org_id UUID,
    p_email TEXT,
    p_role public.app_role,
    p_token_hash TEXT,
    p_expires_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role public.app_role;
    v_clean_email TEXT;
    v_existing_inv_id UUID;
    v_existing_expires_at TIMESTAMPTZ;
    v_invitation_id UUID;
BEGIN
    -- 1. Authentication Check
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0003';
    END IF;

    -- 2. Email Verification Check
    IF NOT public.is_email_verified() THEN
        RAISE EXCEPTION 'Email verification required' USING ERRCODE = 'P0001';
    END IF;

    -- 3. Input Validation
    IF p_org_id IS NULL THEN
        RAISE EXCEPTION 'Organization ID is required' USING ERRCODE = 'P0009';
    END IF;

    IF p_email IS NULL THEN
        RAISE EXCEPTION 'Email is required' USING ERRCODE = 'P0009';
    END IF;

    v_clean_email := lower(trim(p_email));
    IF char_length(v_clean_email) < 5 OR char_length(v_clean_email) > 255 OR v_clean_email !~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' THEN
        RAISE EXCEPTION 'Invalid email format' USING ERRCODE = 'P0009';
    END IF;

    IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
        RAISE EXCEPTION 'Token hash must be 64 hexadecimal characters' USING ERRCODE = 'P0009';
    END IF;

    -- Maximum lifetime of exactly 7 days
    IF p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > (now() + INTERVAL '7 days') THEN
        RAISE EXCEPTION 'Invitation expiration must be between now and 7 days' USING ERRCODE = 'P0009';
    END IF;

    IF p_role IS NULL THEN
        RAISE EXCEPTION 'Role is required' USING ERRCODE = 'P0009';
    END IF;

    -- 4. Caller Membership Check
    SELECT m.role INTO v_caller_role
    FROM public.organization_memberships m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.organization_id = p_org_id
      AND m.user_id = v_caller_id
      AND m.status = 'active'
      AND o.is_active = TRUE;

    IF v_caller_role IS NULL THEN
        RAISE EXCEPTION 'Caller is not an active member of this organization' USING ERRCODE = 'P0004';
    END IF;

    -- 5. Permission Gate: employees:invite
    IF NOT public.check_user_permission(p_org_id, v_caller_id, 'employees:invite') THEN
        RAISE EXCEPTION 'Insufficient permissions to invite employees' USING ERRCODE = 'P0005';
    END IF;

    -- 6. Privilege Escalation Prevention: Admin cannot invite Owner
    IF v_caller_role = 'admin' AND p_role = 'owner' THEN
        RAISE EXCEPTION 'Admins cannot invite users with the Owner role' USING ERRCODE = 'P0020';
    END IF;

    -- 7. Existing Active Member Check
    IF EXISTS (
        SELECT 1
        FROM public.organization_memberships m
        JOIN auth.users u ON u.id = m.user_id
        WHERE m.organization_id = p_org_id
          AND m.status = 'active'
          AND lower(trim(u.email)) = v_clean_email
    ) THEN
        RAISE EXCEPTION 'User is already an active member of this organization' USING ERRCODE = 'P0021';
    END IF;

    -- 8. Existing Pending Invitation Handling (Concurrency-Safe Row Lock)
    SELECT id, expires_at INTO v_existing_inv_id, v_existing_expires_at
    FROM public.organization_invitations
    WHERE organization_id = p_org_id
      AND email = v_clean_email
      AND status = 'pending'
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_expires_at <= now() THEN
            -- Transition expired invitation to 'expired' and log employee.invitation_expired audit event
            UPDATE public.organization_invitations
            SET status = 'expired', updated_at = now()
            WHERE id = v_existing_inv_id;

            INSERT INTO public.organization_audit_events (
                organization_id, actor_id, event_type, metadata
            ) VALUES (
                p_org_id, v_caller_id, 'employee.invitation_expired',
                jsonb_build_object(
                    'invitation_id', v_existing_inv_id,
                    'email', v_clean_email,
                    'reason', 'expired_on_reinvitation'
                )
            );
        ELSE
            -- Active pending invitation exists
            RAISE EXCEPTION 'An active invitation is already pending for this email address' USING ERRCODE = 'P0022';
        END IF;
    END IF;

    -- 9. Insert New Invitation
    BEGIN
        INSERT INTO public.organization_invitations (
            organization_id,
            email,
            role,
            token_hash,
            invited_by,
            status,
            expires_at
        ) VALUES (
            p_org_id,
            v_clean_email,
            p_role,
            p_token_hash,
            v_caller_id,
            'pending',
            p_expires_at
        ) RETURNING id INTO v_invitation_id;
    EXCEPTION
        WHEN unique_violation THEN
            RAISE EXCEPTION 'An active invitation is already pending for this email address' USING ERRCODE = 'P0022';
    END;

    -- 10. Audit Logging: employee.invited
    INSERT INTO public.organization_audit_events (
        organization_id,
        actor_id,
        event_type,
        metadata
    ) VALUES (
        p_org_id,
        v_caller_id,
        'employee.invited',
        jsonb_build_object(
            'invitation_id', v_invitation_id,
            'email', v_clean_email,
            'role', p_role,
            'expires_at', p_expires_at
        )
    );

    RETURN jsonb_build_object(
        'invitation_id', v_invitation_id,
        'organization_id', p_org_id,
        'email', v_clean_email,
        'role', p_role,
        'status', 'pending',
        'expires_at', p_expires_at
    );
END;
$$;

ALTER FUNCTION public.create_organization_invitation OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_organization_invitation FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization_invitation TO authenticated, service_role;

-- ============================================================================
-- 8. Stored Procedure 2: validate_invitation_token
-- ============================================================================

CREATE OR REPLACE FUNCTION public.validate_invitation_token(
    p_token_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_status public.invitation_status;
    v_expires_at TIMESTAMPTZ;
BEGIN
    IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
        RETURN jsonb_build_object('is_valid', false, 'is_expired', false, 'status', NULL);
    END IF;

    SELECT status, expires_at INTO v_status, v_expires_at
    FROM public.organization_invitations
    WHERE token_hash = p_token_hash;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('is_valid', false, 'is_expired', false, 'status', NULL);
    END IF;

    IF v_expires_at <= now() OR v_status = 'expired' THEN
        RETURN jsonb_build_object('is_valid', false, 'is_expired', true, 'status', 'expired');
    END IF;

    IF v_status = 'pending' THEN
        RETURN jsonb_build_object('is_valid', true, 'is_expired', false, 'status', 'pending');
    END IF;

    RETURN jsonb_build_object('is_valid', false, 'is_expired', false, 'status', v_status);
END;
$$;

ALTER FUNCTION public.validate_invitation_token OWNER TO postgres;
REVOKE ALL ON FUNCTION public.validate_invitation_token FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_invitation_token TO anon, authenticated, service_role;

-- ============================================================================
-- 9. Stored Procedure 3: accept_organization_invitation
-- ============================================================================

CREATE OR REPLACE FUNCTION public.accept_organization_invitation(
    p_token_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_email TEXT;
    v_invite RECORD;
    v_org_slug TEXT;
BEGIN
    -- 1. Authentication Check
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'message', 'Authentication required.');
    END IF;

    -- 2. Email Verification Check
    IF NOT public.is_email_verified() THEN
        RETURN jsonb_build_object('success', false, 'code', 'EMAIL_UNVERIFIED', 'message', 'Email verification required before accepting invitation.');
    END IF;

    -- 3. Token Format Validation
    IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_TOKEN', 'message', 'Invalid invitation token format.');
    END IF;

    -- 4. Lock Invitation Record
    SELECT * INTO v_invite
    FROM public.organization_invitations
    WHERE token_hash = p_token_hash
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVITATION_NOT_FOUND', 'message', 'Invalid invitation link.');
    END IF;

    -- 5. Non-Pending Check
    IF v_invite.status != 'pending' THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVITATION_NOT_PENDING', 'message', 'This invitation has already been processed.', 'status', v_invite.status);
    END IF;

    -- 6. Transaction-Safe Lazy Expiration
    IF v_invite.expires_at <= now() THEN
        UPDATE public.organization_invitations
        SET status = 'expired', updated_at = now()
        WHERE id = v_invite.id;

        INSERT INTO public.organization_audit_events (
            organization_id, actor_id, event_type, metadata
        ) VALUES (
            v_invite.organization_id, v_caller_id, 'employee.invitation_expired',
            jsonb_build_object(
                'invitation_id', v_invite.id,
                'email', v_invite.email,
                'reason', 'expired_on_acceptance'
            )
        );

        RETURN jsonb_build_object('success', false, 'code', 'INVITATION_EXPIRED', 'message', 'This invitation has expired.');
    END IF;

    -- 7. Email Match Verification (Generic Privacy Protection)
    SELECT lower(trim(email)) INTO v_caller_email
    FROM auth.users
    WHERE id = v_caller_id;

    IF v_caller_email IS NULL OR v_caller_email != lower(trim(v_invite.email)) THEN
        RETURN jsonb_build_object('success', false, 'code', 'EMAIL_MISMATCH', 'message', 'The authenticated account does not match the invitation recipient.');
    END IF;

    -- 8. Atomic Membership Creation & State Transition
    INSERT INTO public.organization_memberships (
        organization_id,
        user_id,
        role,
        status
    ) VALUES (
        v_invite.organization_id,
        v_caller_id,
        v_invite.role,
        'active'
    )
    ON CONFLICT (user_id, organization_id) DO UPDATE
    SET role = EXCLUDED.role,
        status = 'active',
        updated_at = now();

    UPDATE public.organization_invitations
    SET status = 'accepted', updated_at = now()
    WHERE id = v_invite.id;

    -- 9. Audit Logging: employee.joined
    INSERT INTO public.organization_audit_events (
        organization_id,
        actor_id,
        event_type,
        metadata
    ) VALUES (
        v_invite.organization_id,
        v_caller_id,
        'employee.joined',
        jsonb_build_object(
            'invitation_id', v_invite.id,
            'email', v_invite.email,
            'role', v_invite.role
        )
    );

    SELECT slug INTO v_org_slug
    FROM public.organizations
    WHERE id = v_invite.organization_id;

    RETURN jsonb_build_object(
        'success', true,
        'organization_id', v_invite.organization_id,
        'organization_slug', v_org_slug,
        'role', v_invite.role,
        'status', 'active'
    );
END;
$$;

ALTER FUNCTION public.accept_organization_invitation OWNER TO postgres;
REVOKE ALL ON FUNCTION public.accept_organization_invitation FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_organization_invitation TO authenticated, service_role;

-- ============================================================================
-- 10. Stored Procedure 4: decline_organization_invitation
-- ============================================================================

CREATE OR REPLACE FUNCTION public.decline_organization_invitation(
    p_token_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_email TEXT;
    v_invite RECORD;
BEGIN
    -- 1. Authentication Check
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'message', 'Authentication required.');
    END IF;

    -- 2. Email Verification Check
    IF NOT public.is_email_verified() THEN
        RETURN jsonb_build_object('success', false, 'code', 'EMAIL_UNVERIFIED', 'message', 'Email verification required before declining invitation.');
    END IF;

    -- 3. Token Format Validation
    IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_TOKEN', 'message', 'Invalid invitation token format.');
    END IF;

    -- 4. Lock Invitation Record
    SELECT * INTO v_invite
    FROM public.organization_invitations
    WHERE token_hash = p_token_hash
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVITATION_NOT_FOUND', 'message', 'Invalid invitation link.');
    END IF;

    -- 5. Non-Pending Check
    IF v_invite.status != 'pending' THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVITATION_NOT_PENDING', 'message', 'This invitation has already been processed.', 'status', v_invite.status);
    END IF;

    -- 6. Transaction-Safe Lazy Expiration
    IF v_invite.expires_at <= now() THEN
        UPDATE public.organization_invitations
        SET status = 'expired', updated_at = now()
        WHERE id = v_invite.id;

        INSERT INTO public.organization_audit_events (
            organization_id, actor_id, event_type, metadata
        ) VALUES (
            v_invite.organization_id, v_caller_id, 'employee.invitation_expired',
            jsonb_build_object(
                'invitation_id', v_invite.id,
                'email', v_invite.email,
                'reason', 'expired_on_decline'
            )
        );

        RETURN jsonb_build_object('success', false, 'code', 'INVITATION_EXPIRED', 'message', 'This invitation has expired.');
    END IF;

    -- 7. Email Match Verification (Generic Privacy Protection)
    SELECT lower(trim(email)) INTO v_caller_email
    FROM auth.users
    WHERE id = v_caller_id;

    IF v_caller_email IS NULL OR v_caller_email != lower(trim(v_invite.email)) THEN
        RETURN jsonb_build_object('success', false, 'code', 'EMAIL_MISMATCH', 'message', 'The authenticated account does not match the invitation recipient.');
    END IF;

    -- 8. State Transition to Declined
    UPDATE public.organization_invitations
    SET status = 'declined', updated_at = now()
    WHERE id = v_invite.id;

    -- 9. Audit Logging: employee.invitation_declined
    INSERT INTO public.organization_audit_events (
        organization_id,
        actor_id,
        event_type,
        metadata
    ) VALUES (
        v_invite.organization_id,
        v_caller_id,
        'employee.invitation_declined',
        jsonb_build_object(
            'invitation_id', v_invite.id,
            'email', v_invite.email
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'invitation_id', v_invite.id,
        'status', 'declined'
    );
END;
$$;

ALTER FUNCTION public.decline_organization_invitation OWNER TO postgres;
REVOKE ALL ON FUNCTION public.decline_organization_invitation FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_organization_invitation TO authenticated, service_role;

-- ============================================================================
-- 11. Stored Procedure 5: resend_organization_invitation
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resend_organization_invitation(
    p_invitation_id UUID,
    p_new_token_hash TEXT,
    p_new_expires_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_invite RECORD;
BEGIN
    -- 1. Input Validation
    IF p_invitation_id IS NULL THEN
        RAISE EXCEPTION 'Invitation ID is required' USING ERRCODE = 'P0009';
    END IF;

    IF p_new_token_hash IS NULL OR p_new_token_hash !~ '^[a-f0-9]{64}$' THEN
        RAISE EXCEPTION 'Token hash must be 64 hexadecimal characters' USING ERRCODE = 'P0009';
    END IF;

    IF p_new_expires_at IS NULL OR p_new_expires_at <= now() OR p_new_expires_at > (now() + INTERVAL '7 days') THEN
        RAISE EXCEPTION 'Expiration must be between now and 7 days' USING ERRCODE = 'P0009';
    END IF;

    -- 2. Caller Authentication Check
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0003';
    END IF;

    -- 3. Lock Target Invitation
    SELECT * INTO v_invite
    FROM public.organization_invitations
    WHERE id = p_invitation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invitation not found' USING ERRCODE = 'P0009';
    END IF;

    -- 4. Caller Permission Gate: employees:invite
    IF NOT public.check_user_permission(v_invite.organization_id, v_caller_id, 'employees:invite') THEN
        RAISE EXCEPTION 'Insufficient permissions to resend invitations' USING ERRCODE = 'P0005';
    END IF;

    -- 5. Eligible Status Check (pending or expired only)
    IF v_invite.status NOT IN ('pending', 'expired') THEN
        RAISE EXCEPTION 'Cannot resend an accepted, declined, or revoked invitation' USING ERRCODE = 'P0026';
    END IF;

    -- 6. Update Invitation
    UPDATE public.organization_invitations
    SET token_hash = p_new_token_hash,
        expires_at = p_new_expires_at,
        status = 'pending',
        updated_at = now()
    WHERE id = v_invite.id;

    -- 7. Audit Logging: employee.invitation_resent
    INSERT INTO public.organization_audit_events (
        organization_id,
        actor_id,
        event_type,
        metadata
    ) VALUES (
        v_invite.organization_id,
        v_caller_id,
        'employee.invitation_resent',
        jsonb_build_object(
            'invitation_id', v_invite.id,
            'email', v_invite.email,
            'new_expires_at', p_new_expires_at
        )
    );

    RETURN jsonb_build_object(
        'invitation_id', v_invite.id,
        'organization_id', v_invite.organization_id,
        'email', v_invite.email,
        'role', v_invite.role,
        'status', 'pending',
        'expires_at', p_new_expires_at
    );
END;
$$;

ALTER FUNCTION public.resend_organization_invitation OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resend_organization_invitation FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resend_organization_invitation TO authenticated, service_role;

-- ============================================================================
-- 12. Stored Procedure 6: revoke_organization_invitation
-- ============================================================================

CREATE OR REPLACE FUNCTION public.revoke_organization_invitation(
    p_invitation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_invite RECORD;
BEGIN
    -- 1. Input Validation
    IF p_invitation_id IS NULL THEN
        RAISE EXCEPTION 'Invitation ID is required' USING ERRCODE = 'P0009';
    END IF;

    -- 2. Caller Authentication Check
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0003';
    END IF;

    -- 3. Lock Target Invitation
    SELECT * INTO v_invite
    FROM public.organization_invitations
    WHERE id = p_invitation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invitation not found' USING ERRCODE = 'P0009';
    END IF;

    -- 4. Caller Permission Gate: employees:invitations_revoke
    IF NOT public.check_user_permission(v_invite.organization_id, v_caller_id, 'employees:invitations_revoke') THEN
        RAISE EXCEPTION 'Insufficient permissions to revoke invitations' USING ERRCODE = 'P0005';
    END IF;

    -- 5. Status Check (only pending invitations can be revoked)
    IF v_invite.status != 'pending' THEN
        RAISE EXCEPTION 'Only pending invitations can be revoked' USING ERRCODE = 'P0009';
    END IF;

    -- 6. Transition to Revoked
    UPDATE public.organization_invitations
    SET status = 'revoked', updated_at = now()
    WHERE id = v_invite.id;

    -- 7. Audit Logging: employee.invitation_revoked
    INSERT INTO public.organization_audit_events (
        organization_id,
        actor_id,
        event_type,
        metadata
    ) VALUES (
        v_invite.organization_id,
        v_caller_id,
        'employee.invitation_revoked',
        jsonb_build_object(
            'invitation_id', v_invite.id,
            'email', v_invite.email
        )
    );

    RETURN jsonb_build_object(
        'invitation_id', v_invite.id,
        'status', 'revoked'
    );
END;
$$;

ALTER FUNCTION public.revoke_organization_invitation OWNER TO postgres;
REVOKE ALL ON FUNCTION public.revoke_organization_invitation FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_organization_invitation TO authenticated, service_role;

-- ============================================================================
-- 13. Stored Procedure 7: update_organization_member_role
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_organization_member_role(
    p_org_id UUID,
    p_target_membership_id UUID,
    p_new_role public.app_role
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_mem_id UUID;
    v_caller_role public.app_role;
    v_target_mem RECORD;
BEGIN
    -- 1. Input Validation
    IF p_org_id IS NULL OR p_target_membership_id IS NULL THEN
        RAISE EXCEPTION 'Organization ID and Membership ID are required' USING ERRCODE = 'P0009';
    END IF;

    IF p_new_role IS NULL THEN
        RAISE EXCEPTION 'New role is required' USING ERRCODE = 'P0009';
    END IF;

    -- 2. Caller Authentication Check
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0003';
    END IF;

    -- 3. Caller Membership & Role
    SELECT m.id, m.role INTO v_caller_mem_id, v_caller_role
    FROM public.organization_memberships m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.organization_id = p_org_id
      AND m.user_id = v_caller_id
      AND m.status = 'active'
      AND o.is_active = TRUE;

    IF v_caller_mem_id IS NULL THEN
        RAISE EXCEPTION 'Caller is not an active member of this organization' USING ERRCODE = 'P0004';
    END IF;

    -- 4. Permission Gate: employees:update_role
    IF NOT public.check_user_permission(p_org_id, v_caller_id, 'employees:update_role') THEN
        RAISE EXCEPTION 'Insufficient permissions to update employee roles' USING ERRCODE = 'P0005';
    END IF;

    -- 5. Self-Modification Prevention
    IF v_caller_mem_id = p_target_membership_id THEN
        RAISE EXCEPTION 'Users cannot modify their own role' USING ERRCODE = 'P0023';
    END IF;

    -- 6. Lock Target Membership
    SELECT * INTO v_target_mem
    FROM public.organization_memberships
    WHERE id = p_target_membership_id
      AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target membership not found' USING ERRCODE = 'P0009';
    END IF;

    -- 7. Terminal Revoked Membership Guard
    IF v_target_mem.status = 'revoked' THEN
        RAISE EXCEPTION 'Cannot modify a revoked membership. Revocation is terminal.' USING ERRCODE = 'P0025';
    END IF;

    -- 8. Admin Escalation Checks
    IF v_caller_role = 'admin' THEN
        IF v_target_mem.role = 'owner' THEN
            RAISE EXCEPTION 'Admins cannot modify the role of an Owner' USING ERRCODE = 'P0020';
        END IF;

        IF p_new_role = 'owner' THEN
            RAISE EXCEPTION 'Admins cannot promote members to Owner' USING ERRCODE = 'P0020';
        END IF;
    END IF;

    -- 9. Update Target Role (check_owner_invariant trigger enforces last-owner protection)
    UPDATE public.organization_memberships
    SET role = p_new_role, updated_at = now()
    WHERE id = v_target_mem.id;

    -- 10. Audit Logging: employee.role_updated
    INSERT INTO public.organization_audit_events (
        organization_id,
        actor_id,
        event_type,
        metadata
    ) VALUES (
        p_org_id,
        v_caller_id,
        'employee.role_updated',
        jsonb_build_object(
            'target_membership_id', v_target_mem.id,
            'target_user_id', v_target_mem.user_id,
            'old_role', v_target_mem.role,
            'new_role', p_new_role
        )
    );

    RETURN jsonb_build_object(
        'membership_id', v_target_mem.id,
        'user_id', v_target_mem.user_id,
        'role', p_new_role,
        'status', v_target_mem.status
    );
END;
$$;

ALTER FUNCTION public.update_organization_member_role OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_organization_member_role FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_organization_member_role TO authenticated, service_role;

-- ============================================================================
-- 14. Stored Procedure 8: update_organization_member_status
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_organization_member_status(
    p_org_id UUID,
    p_target_membership_id UUID,
    p_new_status public.membership_status
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_mem_id UUID;
    v_caller_role public.app_role;
    v_target_mem RECORD;
    v_required_perm TEXT;
    v_audit_event TEXT;
BEGIN
    -- 1. Input Validation
    IF p_org_id IS NULL OR p_target_membership_id IS NULL THEN
        RAISE EXCEPTION 'Organization ID and Membership ID are required' USING ERRCODE = 'P0009';
    END IF;

    IF p_new_status IS NULL OR p_new_status NOT IN ('active', 'suspended', 'revoked') THEN
        RAISE EXCEPTION 'Invalid membership status' USING ERRCODE = 'P0009';
    END IF;

    -- 2. Caller Authentication Check
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0003';
    END IF;

    -- 3. Caller Membership & Role
    SELECT m.id, m.role INTO v_caller_mem_id, v_caller_role
    FROM public.organization_memberships m
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.organization_id = p_org_id
      AND m.user_id = v_caller_id
      AND m.status = 'active'
      AND o.is_active = TRUE;

    IF v_caller_mem_id IS NULL THEN
        RAISE EXCEPTION 'Caller is not an active member of this organization' USING ERRCODE = 'P0004';
    END IF;

    -- 4. Self-Modification Prevention
    IF v_caller_mem_id = p_target_membership_id THEN
        RAISE EXCEPTION 'Users cannot modify their own membership status' USING ERRCODE = 'P0024';
    END IF;

    -- 5. Lock Target Membership
    SELECT * INTO v_target_mem
    FROM public.organization_memberships
    WHERE id = p_target_membership_id
      AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target membership not found' USING ERRCODE = 'P0009';
    END IF;

    -- 6. Terminal Revocation Guard
    IF v_target_mem.status = 'revoked' THEN
        RAISE EXCEPTION 'Cannot modify a revoked membership. Revocation is terminal.' USING ERRCODE = 'P0025';
    END IF;

    -- 7. Admin Privilege Boundary: Admins cannot alter Owner status
    IF v_caller_role = 'admin' AND v_target_mem.role = 'owner' THEN
        RAISE EXCEPTION 'Admins cannot modify the status of an Owner' USING ERRCODE = 'P0020';
    END IF;

    -- 8. Status Transition Rules & Required Permission Resolution
    IF v_target_mem.status = 'active' AND p_new_status = 'suspended' THEN
        v_required_perm := 'employees:suspend';
        v_audit_event := 'employee.suspended';
    ELSIF v_target_mem.status = 'suspended' AND p_new_status = 'active' THEN
        v_required_perm := 'employees:suspend';
        v_audit_event := 'employee.reactivated';
    ELSIF v_target_mem.status IN ('active', 'suspended') AND p_new_status = 'revoked' THEN
        v_required_perm := 'employees:remove';
        v_audit_event := 'employee.removed';
    ELSE
        RAISE EXCEPTION 'Invalid membership status transition' USING ERRCODE = 'P0009';
    END IF;

    -- 9. Check Specific Permission
    IF NOT public.check_user_permission(p_org_id, v_caller_id, v_required_perm) THEN
        RAISE EXCEPTION 'Insufficient permissions' USING ERRCODE = 'P0005';
    END IF;

    -- 10. Update Status (check_owner_invariant trigger enforces last-owner protection)
    UPDATE public.organization_memberships
    SET status = p_new_status, updated_at = now()
    WHERE id = v_target_mem.id;

    -- 11. Audit Logging
    INSERT INTO public.organization_audit_events (
        organization_id,
        actor_id,
        event_type,
        metadata
    ) VALUES (
        p_org_id,
        v_caller_id,
        v_audit_event,
        jsonb_build_object(
            'target_membership_id', v_target_mem.id,
            'target_user_id', v_target_mem.user_id,
            'old_status', v_target_mem.status,
            'new_status', p_new_status
        )
    );

    RETURN jsonb_build_object(
        'membership_id', v_target_mem.id,
        'user_id', v_target_mem.user_id,
        'role', v_target_mem.role,
        'status', p_new_status
    );
END;
$$;

ALTER FUNCTION public.update_organization_member_status OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_organization_member_status FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_organization_member_status TO authenticated, service_role;

-- ============================================================================
-- 15. Stored Procedure 9: get_organization_employees
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_organization_employees(
    p_org_id UUID
)
RETURNS TABLE (
    membership_id UUID,
    user_id UUID,
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    phone TEXT,
    role public.app_role,
    status public.membership_status,
    joined_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
BEGIN
    -- 1. Caller Authentication
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0003';
    END IF;

    -- 2. Authoritative Permission Gate: employees:read (Owner receives automatically for registered key)
    IF NOT public.check_user_permission(p_org_id, v_caller_id, 'employees:read') THEN
        RAISE EXCEPTION 'Insufficient permissions to view employee directory' USING ERRCODE = 'P0005';
    END IF;

    -- 3. Sanitized Minimal Field Projection (Excludes revoked members)
    RETURN QUERY
    SELECT
        m.id AS membership_id,
        m.user_id,
        p.first_name,
        p.last_name,
        u.email::TEXT,
        p.phone,
        m.role,
        m.status,
        m.created_at AS joined_at
    FROM public.organization_memberships m
    JOIN public.profiles p ON p.id = m.user_id
    JOIN auth.users u ON u.id = m.user_id
    WHERE m.organization_id = p_org_id
      AND m.status != 'revoked'
    ORDER BY m.created_at ASC;
END;
$$;

ALTER FUNCTION public.get_organization_employees OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_organization_employees FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_organization_employees TO authenticated, service_role;

