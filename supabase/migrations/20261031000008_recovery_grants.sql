-- Migration 08: Atomic Server-Side Recovery Nonce Grants (T050 / Security Remediation)
-- Provides single-use replay protection and concurrency-safe recovery nonce consumption in PostgreSQL.

CREATE TABLE public.recovery_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    nonce_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.recovery_grants ENABLE ROW LEVEL SECURITY;

-- Index on user_id for fast user lookups and cleanup
CREATE INDEX idx_recovery_grants_user_id ON public.recovery_grants(user_id);

-- Restrict direct access; access is only via SECURITY DEFINER functions or service_role
REVOKE ALL ON public.recovery_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recovery_grants TO service_role;

-- Function: create_recovery_grant
-- Invalidates any unconsumed recovery grants for the user and stores the new grant.
CREATE OR REPLACE FUNCTION public.create_recovery_grant(
    p_session_id TEXT,
    p_nonce_hash TEXT,
    p_expires_at TIMESTAMPTZ,
    p_user_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_user_id UUID;
    v_grant_id UUID;
BEGIN
    IF p_user_id IS NOT NULL THEN
        IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
            RAISE EXCEPTION 'Unauthorized: cannot create recovery grant for another user' USING ERRCODE = '42501';
        END IF;
        v_user_id := p_user_id;
    ELSE
        v_user_id := auth.uid();
    END IF;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
    END IF;

    IF p_nonce_hash IS NULL OR length(trim(p_nonce_hash)) = 0 THEN
        RAISE EXCEPTION 'Invalid nonce hash' USING ERRCODE = '22023';
    END IF;

    IF p_expires_at <= now() THEN
        RAISE EXCEPTION 'Expiration must be in the future' USING ERRCODE = '22023';
    END IF;

    -- Invalidate any prior unconsumed recovery grants for this user
    UPDATE public.recovery_grants
    SET consumed_at = now()
    WHERE user_id = v_user_id AND consumed_at IS NULL;

    INSERT INTO public.recovery_grants (
        user_id,
        session_id,
        nonce_hash,
        expires_at
    )
    VALUES (
        v_user_id,
        p_session_id,
        p_nonce_hash,
        p_expires_at
    )
    RETURNING id INTO v_grant_id;

    RETURN v_grant_id;
END;
$$;

-- Function: verify_recovery_grant
-- Verifies whether a recovery grant exists, is unconsumed, and has not expired.
CREATE OR REPLACE FUNCTION public.verify_recovery_grant(
    p_nonce_hash TEXT,
    p_user_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_user_id UUID;
    v_valid BOOLEAN;
BEGIN
    IF p_user_id IS NOT NULL THEN
        IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
            RETURN FALSE;
        END IF;
        v_user_id := p_user_id;
    ELSE
        v_user_id := auth.uid();
    END IF;

    IF v_user_id IS NULL OR p_nonce_hash IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.recovery_grants
        WHERE nonce_hash = p_nonce_hash
          AND user_id = v_user_id
          AND consumed_at IS NULL
          AND expires_at > now()
    ) INTO v_valid;

    RETURN v_valid;
END;
$$;

-- Function: consume_recovery_grant
-- Atomically consumes the recovery grant. Returns TRUE if successfully consumed,
-- or FALSE if already consumed, expired, or non-existent.
CREATE OR REPLACE FUNCTION public.consume_recovery_grant(
    p_nonce_hash TEXT,
    p_user_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_user_id UUID;
    v_grant_id UUID;
BEGIN
    IF p_user_id IS NOT NULL THEN
        IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
            RAISE EXCEPTION 'Unauthorized: cannot consume recovery grant for another user' USING ERRCODE = '42501';
        END IF;
        v_user_id := p_user_id;
    ELSE
        v_user_id := auth.uid();
    END IF;

    IF v_user_id IS NULL OR p_nonce_hash IS NULL THEN
        RAISE EXCEPTION 'Not authenticated or invalid nonce' USING ERRCODE = '28000';
    END IF;

    -- Row lock and atomic update
    UPDATE public.recovery_grants
    SET consumed_at = now()
    WHERE nonce_hash = p_nonce_hash
      AND user_id = v_user_id
      AND consumed_at IS NULL
      AND expires_at > now()
    RETURNING id INTO v_grant_id;

    RETURN v_grant_id IS NOT NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_recovery_grant(TEXT, TEXT, TIMESTAMPTZ, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_recovery_grant(TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_recovery_grant(TEXT, UUID) TO authenticated, service_role;

