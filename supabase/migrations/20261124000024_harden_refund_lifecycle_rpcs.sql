-- ============================================================================
-- Migration: 20261124000024_harden_refund_lifecycle_rpcs.sql
-- Description: Harden Phase 8 refund lifecycle RPCs with Revision 2.6 compliance:
--   1. confirm_refund_reimbursement:
--      - F005-046: Mandatory advisory lock on (org_id, idempotency_key).
--      - Case C: Cross-refund key collision check under advisory lock.
--      - Revision 2.6 canonical hash with org_id, refund_id, idempotency_key, external_reference.
--      - F005-039: Reconciled payment_status re-evaluation with status IN ('voided', 'returned')
--        and pending refund detection.
--   2. record_refund_failure:
--      - Strict reason validation (>= 3 chars).
--      - FOR UPDATE row lock and state verification (status = 'pending').
--      - Reason appending and F005-039 payment_status re-evaluation.
--   3. issue_replacement_refund:
--      - F005-044: Unconditional obligation-level advisory lock on obligation_refund_id.
--      - Revision 2.6 canonical hash (failed_refund_id, idempotency_key, notes, organization_id, reference_no, refund_method).
--      - Obligation root resolution & active attempt check (P0064, P0067).
--      - Tender ceiling & payable ceiling verification.
--      - Linked replacement insertion with shared obligation_refund_id.
--      - F005-039 payment_status re-evaluation.
--   4. Strict SECURITY DEFINER execution grants, ownership, and search_path.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RPC: public.confirm_refund_reimbursement (T020, T072)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_refund_reimbursement(
    p_org_id             UUID,
    p_refund_id          UUID,
    p_external_reference TEXT,
    p_idempotency_key    UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_clean_ref TEXT;
    v_canonical_hash TEXT;
    v_refund RECORD;
    v_target_sale RECORD;
    v_total_completed_refunds NUMERIC(14, 4);
    v_has_pending_refunds BOOLEAN;
    v_new_ps TEXT;
BEGIN
    -- 1. Auth Guard
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

    -- 2. Active Org & Active Membership Guard
    IF NOT EXISTS (
        SELECT 1 FROM public.organizations WHERE id = p_org_id AND is_active = TRUE
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ORGANIZATION_INACTIVE';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_memberships
        WHERE organization_id = p_org_id AND user_id = auth.uid() AND status = 'active'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'MEMBERSHIP_INACTIVE';
    END IF;

    -- 3. Permission Gate: refunds:read AND (sales:void OR returns:create)
    IF NOT (
        public.check_user_permission(p_org_id, auth.uid(), 'refunds:read')
        AND (
            public.check_user_permission(p_org_id, auth.uid(), 'sales:void')
            OR public.check_user_permission(p_org_id, auth.uid(), 'returns:create')
        )
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    -- 4. Idempotency Key Guard
    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0055', MESSAGE = 'IDEMPOTENCY_KEY_REQUIRED';
    END IF;

    v_clean_ref := trim(p_external_reference);
    IF v_clean_ref IS NULL OR length(v_clean_ref) = 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0059', MESSAGE = 'EXTERNAL_REVERSAL_REFERENCE_REQUIRED';
    END IF;

    -- 5. Transaction-Scoped Advisory Lock on (org_id, idempotency_key) (Case E)
    PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_idempotency_key::text));

    -- 6. Canonical Hash Construction (Revision 2.6)
    v_canonical_hash := encode(sha256(convert_to(
        jsonb_build_object(
            'external_reference', v_clean_ref,
            'idempotency_key', p_idempotency_key::text,
            'organization_id', p_org_id::text,
            'refund_id', p_refund_id::text
        )::text,
        'UTF8'
    )), 'hex');

    -- 7. Case C: Cross-Refund Key Collision Check under Advisory Lock
    IF EXISTS (
        SELECT 1 FROM public.refunds
        WHERE organization_id = p_org_id
          AND confirmation_idempotency_key = p_idempotency_key
          AND id <> p_refund_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
    END IF;

    -- 8. Target Refund Lock FOR UPDATE
    SELECT * INTO v_refund
    FROM public.refunds
    WHERE organization_id = p_org_id AND id = p_refund_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0058', MESSAGE = 'REFUND_NOT_FOUND';
    END IF;

    -- 9. Case A & B: Idempotency Replay or Conflict on Same Refund
    IF v_refund.confirmation_idempotency_key = p_idempotency_key THEN
        IF v_refund.confirmation_idempotency_hash = v_canonical_hash THEN
            RETURN jsonb_build_object(
                'success', true,
                'is_replay', true,
                'refund_id', v_refund.id,
                'sale_id', v_refund.sale_id,
                'status', v_refund.status,
                'external_reference', coalesce(v_refund.reference_no, v_clean_ref),
                'reference_no', coalesce(v_refund.reference_no, v_clean_ref),
                'amount', to_char(v_refund.amount, 'FM9999999990.0000'),
                'confirmed_at', v_refund.updated_at
            );
        ELSE
            RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
        END IF;
    END IF;

    -- 10. Case D: Refund Already Settled
    IF v_refund.status <> 'pending' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0062', MESSAGE = 'REFUND_ALREADY_SETTLED';
    END IF;

    -- 11. State Transition -> completed
    UPDATE public.refunds
    SET status = 'completed',
        reference_no = v_clean_ref,
        confirmation_idempotency_key = p_idempotency_key,
        confirmation_idempotency_hash = v_canonical_hash,
        updated_at = now()
    WHERE id = p_refund_id;

    -- 12. Recalculate Sale payment_status (F005-039 Reconciled Formula)
    SELECT coalesce(sum(amount), 0.0000) INTO v_total_completed_refunds
    FROM public.refunds
    WHERE organization_id = p_org_id AND sale_id = v_refund.sale_id AND status = 'completed';

    v_has_pending_refunds := EXISTS (
        SELECT 1 FROM public.refunds
        WHERE organization_id = p_org_id AND sale_id = v_refund.sale_id AND status = 'pending'
    );

    SELECT * INTO v_target_sale
    FROM public.sales
    WHERE organization_id = p_org_id AND id = v_refund.sale_id
    FOR UPDATE;

    v_new_ps := CASE
        WHEN v_target_sale.status IN ('voided', 'returned') AND v_total_completed_refunds >= v_target_sale.total_amount THEN 'refunded'
        WHEN v_total_completed_refunds > 0.0000 OR v_has_pending_refunds THEN 'partially_refunded'
        ELSE 'paid'
    END;

    UPDATE public.sales
    SET payment_status = v_new_ps,
        updated_at = now()
    WHERE id = v_refund.sale_id;

    RETURN jsonb_build_object(
        'success', true,
        'is_replay', false,
        'refund_id', p_refund_id,
        'sale_id', v_refund.sale_id,
        'status', 'completed',
        'external_reference', v_clean_ref,
        'reference_no', v_clean_ref,
        'amount', to_char(v_refund.amount, 'FM9999999990.0000'),
        'payment_status', v_new_ps,
        'confirmed_at', now()
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 2. RPC: public.record_refund_failure (T021, T073)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_refund_failure(
    p_org_id         UUID,
    p_refund_id      UUID,
    p_failure_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_clean_reason TEXT;
    v_refund RECORD;
    v_target_sale RECORD;
    v_total_completed_refunds NUMERIC(14, 4);
    v_has_pending_refunds BOOLEAN;
    v_new_ps TEXT;
BEGIN
    -- 1. Auth Guard
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

    -- 2. Active Org & Active Membership Guard
    IF NOT EXISTS (
        SELECT 1 FROM public.organizations WHERE id = p_org_id AND is_active = TRUE
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ORGANIZATION_INACTIVE';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_memberships
        WHERE organization_id = p_org_id AND user_id = auth.uid() AND status = 'active'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'MEMBERSHIP_INACTIVE';
    END IF;

    -- 3. Permission Gate: sales:void OR returns:create
    IF NOT (
        public.check_user_permission(p_org_id, auth.uid(), 'sales:void')
        OR public.check_user_permission(p_org_id, auth.uid(), 'returns:create')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    v_clean_reason := trim(p_failure_reason);
    IF v_clean_reason IS NULL OR length(v_clean_reason) < 3 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0053', MESSAGE = 'RETURN_REASON_REQUIRED';
    END IF;

    -- 4. Target Refund Lock FOR UPDATE
    SELECT * INTO v_refund
    FROM public.refunds
    WHERE organization_id = p_org_id AND id = p_refund_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0058', MESSAGE = 'REFUND_NOT_FOUND';
    END IF;

    IF v_refund.status <> 'pending' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0062', MESSAGE = 'REFUND_ALREADY_SETTLED';
    END IF;

    -- 5. Transition to failed
    UPDATE public.refunds
    SET status = 'failed',
        reason = CASE
            WHEN v_refund.reason IS NOT NULL AND length(trim(v_refund.reason)) > 0
            THEN v_refund.reason || ' | FAILURE: ' || v_clean_reason
            ELSE 'FAILURE: ' || v_clean_reason
        END,
        updated_at = now()
    WHERE id = p_refund_id;

    -- 6. Recalculate Sale payment_status (F005-039 Reconciled Formula)
    SELECT coalesce(sum(amount), 0.0000) INTO v_total_completed_refunds
    FROM public.refunds
    WHERE organization_id = p_org_id AND sale_id = v_refund.sale_id AND status = 'completed';

    v_has_pending_refunds := EXISTS (
        SELECT 1 FROM public.refunds
        WHERE organization_id = p_org_id AND sale_id = v_refund.sale_id AND status = 'pending'
    );

    SELECT * INTO v_target_sale
    FROM public.sales
    WHERE organization_id = p_org_id AND id = v_refund.sale_id
    FOR UPDATE;

    v_new_ps := CASE
        WHEN v_target_sale.status IN ('voided', 'returned') AND v_total_completed_refunds >= v_target_sale.total_amount THEN 'refunded'
        WHEN v_total_completed_refunds > 0.0000 OR v_has_pending_refunds THEN 'partially_refunded'
        ELSE 'paid'
    END;

    UPDATE public.sales
    SET payment_status = v_new_ps,
        updated_at = now()
    WHERE id = v_refund.sale_id;

    RETURN jsonb_build_object(
        'success', true,
        'refund_id', p_refund_id,
        'sale_id', v_refund.sale_id,
        'status', 'failed',
        'failure_reason', v_clean_reason,
        'payment_status', v_new_ps,
        'failed_at', now()
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 3. RPC: public.issue_replacement_refund (T022, T074)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_replacement_refund(
    p_org_id           UUID,
    p_failed_refund_id UUID,
    p_refund_method    TEXT,
    p_idempotency_key  UUID,
    p_reference_no     TEXT DEFAULT NULL,
    p_notes            TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_clean_ref TEXT;
    v_clean_notes TEXT;
    v_failed_refund RECORD;
    v_obligation_id UUID;
    v_canonical_hash TEXT;
    v_existing_refund RECORD;
    v_existing_status TEXT;

    v_orig_method_tender NUMERIC(14, 4);
    v_prior_method_refunds NUMERIC(14, 4);
    v_prior_total_refunds NUMERIC(14, 4);
    v_sale RECORD;

    v_new_refund_id UUID;
    v_new_status TEXT;
    v_ref TEXT;
    v_completed_refunds NUMERIC(14, 4);
    v_has_pending_refunds BOOLEAN;
    v_new_ps TEXT;
BEGIN
    -- 1. Auth Guard
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

    -- 2. Active Org & Active Membership Guard
    IF NOT EXISTS (
        SELECT 1 FROM public.organizations WHERE id = p_org_id AND is_active = TRUE
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ORGANIZATION_INACTIVE';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_memberships
        WHERE organization_id = p_org_id AND user_id = auth.uid() AND status = 'active'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'MEMBERSHIP_INACTIVE';
    END IF;

    -- 3. Permission Gate: sales:void OR returns:create
    IF NOT (
        public.check_user_permission(p_org_id, auth.uid(), 'sales:void')
        OR public.check_user_permission(p_org_id, auth.uid(), 'returns:create')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    -- 4. Idempotency Key Guard
    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0055', MESSAGE = 'IDEMPOTENCY_KEY_REQUIRED';
    END IF;

    IF p_refund_method NOT IN ('cash', 'card', 'bank_transfer', 'other') THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invalid refund method';
    END IF;

    v_clean_ref := NULLIF(trim(p_reference_no), '');
    v_clean_notes := NULLIF(trim(p_notes), '');

    -- 5. Transaction-Scoped Advisory Lock on Idempotency Key
    PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_idempotency_key::text));

    -- 6. Canonical Hash Construction (Revision 2.6)
    v_canonical_hash := encode(sha256(convert_to(
        jsonb_build_object(
            'failed_refund_id', p_failed_refund_id::text,
            'idempotency_key', p_idempotency_key::text,
            'notes', v_clean_notes,
            'organization_id', p_org_id::text,
            'reference_no', v_clean_ref,
            'refund_method', p_refund_method
        )::text,
        'UTF8'
    )), 'hex');

    -- 7. Case A & B: Idempotency Replay or Conflict on Same Key
    SELECT * INTO v_existing_refund
    FROM public.refunds
    WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_existing_refund.idempotency_hash = v_canonical_hash THEN
            RETURN jsonb_build_object(
                'success', true,
                'is_replay', true,
                'replacement_refund_id', v_existing_refund.id,
                'refund_id', v_existing_refund.id,
                'sale_id', v_existing_refund.sale_id,
                'obligation_refund_id', v_existing_refund.obligation_refund_id,
                'failed_refund_id', v_existing_refund.parent_refund_id,
                'parent_refund_id', v_existing_refund.parent_refund_id,
                'status', v_existing_refund.status,
                'refund_method', v_existing_refund.refund_method,
                'amount', to_char(v_existing_refund.amount, 'FM9999999990.0000'),
                'created_at', v_existing_refund.created_at
            );
        ELSE
            RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
        END IF;
    END IF;

    -- 8. Target Failed Refund Lock FOR UPDATE
    SELECT * INTO v_failed_refund
    FROM public.refunds
    WHERE organization_id = p_org_id AND id = p_failed_refund_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0058', MESSAGE = 'REFUND_NOT_FOUND';
    END IF;

    IF v_failed_refund.status <> 'failed' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0065', MESSAGE = 'REFUND_NOT_FAILED';
    END IF;

    -- 9. F005-044: Obligation Root Resolution & Unconditional Obligation Advisory Lock
    v_obligation_id := v_failed_refund.obligation_refund_id;
    PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(v_obligation_id::text));

    -- 10. Assert No Active Attempt Exists for this Obligation Across Full Lineage
    SELECT status INTO v_existing_status
    FROM public.refunds
    WHERE organization_id = p_org_id
      AND obligation_refund_id = v_obligation_id
      AND status IN ('pending', 'completed')
    LIMIT 1;

    IF FOUND THEN
        IF v_existing_status = 'completed' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0067', MESSAGE = 'OBLIGATION_ALREADY_COMPLETED';
        ELSE
            RAISE EXCEPTION USING ERRCODE = 'P0064', MESSAGE = 'REPLACEMENT_REFUND_ALREADY_EXISTS';
        END IF;
    END IF;

    -- 11. Parent Sale Row Lock & Split-Tender Ceiling Enforcement
    SELECT * INTO v_sale
    FROM public.sales
    WHERE organization_id = p_org_id AND id = v_failed_refund.sale_id
    FOR UPDATE;

    IF p_refund_method <> 'cash' THEN
        SELECT coalesce(sum(amount), 0.0000) INTO v_orig_method_tender
        FROM public.payments
        WHERE organization_id = p_org_id AND sale_id = v_failed_refund.sale_id AND payment_method = p_refund_method;

        IF v_orig_method_tender = 0.0000 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0061', MESSAGE = 'REFUND_METHOD_NOT_IN_ORIGINAL_SALE';
        END IF;

        SELECT coalesce(sum(amount), 0.0000) INTO v_prior_method_refunds
        FROM public.refunds
        WHERE organization_id = p_org_id
          AND sale_id = v_failed_refund.sale_id
          AND refund_method = p_refund_method
          AND status IN ('completed', 'pending');

        IF v_prior_method_refunds + v_failed_refund.amount > v_orig_method_tender THEN
            RAISE EXCEPTION USING ERRCODE = 'P0061', MESSAGE = 'REFUND_METHOD_EXCEEDS_ORIGINAL_TENDER';
        END IF;
    END IF;

    SELECT coalesce(sum(amount), 0.0000) INTO v_prior_total_refunds
    FROM public.refunds
    WHERE organization_id = p_org_id
      AND sale_id = v_failed_refund.sale_id
      AND status IN ('completed', 'pending');

    IF v_prior_total_refunds + v_failed_refund.amount > v_sale.total_amount THEN
        RAISE EXCEPTION USING ERRCODE = 'P0054', MESSAGE = 'REFUND_EXCEEDS_PAYABLE';
    END IF;

    -- 12. Insert Linked Replacement Refund Record
    v_new_refund_id := gen_random_uuid();
    IF p_refund_method = 'cash' THEN
        v_new_status := 'completed';
        v_ref := NULL;
    ELSE
        v_new_status := 'pending';
        v_ref := v_clean_ref;
    END IF;

    INSERT INTO public.refunds (
        id,
        organization_id,
        sale_id,
        return_id,
        parent_refund_id,
        obligation_refund_id,
        refund_method,
        amount,
        reference_no,
        status,
        reason,
        processed_by,
        idempotency_key,
        idempotency_hash,
        created_at,
        updated_at
    ) VALUES (
        v_new_refund_id,
        p_org_id,
        v_failed_refund.sale_id,
        v_failed_refund.return_id,
        p_failed_refund_id,
        v_obligation_id,
        p_refund_method,
        v_failed_refund.amount,
        v_ref,
        v_new_status,
        'Replacement for failed refund ' || p_failed_refund_id::text || coalesce(': ' || v_clean_notes, ''),
        auth.uid(),
        p_idempotency_key,
        v_canonical_hash,
        now(),
        now()
    );

    -- 13. Recalculate Sale payment_status (F005-039 Reconciled Formula)
    SELECT coalesce(sum(amount), 0.0000) INTO v_completed_refunds
    FROM public.refunds
    WHERE organization_id = p_org_id AND sale_id = v_failed_refund.sale_id AND status = 'completed';

    v_has_pending_refunds := EXISTS (
        SELECT 1 FROM public.refunds
        WHERE organization_id = p_org_id AND sale_id = v_failed_refund.sale_id AND status = 'pending'
    );

    v_new_ps := CASE
        WHEN v_sale.status IN ('voided', 'returned') AND v_completed_refunds >= v_sale.total_amount THEN 'refunded'
        WHEN v_completed_refunds > 0.0000 OR v_has_pending_refunds THEN 'partially_refunded'
        ELSE 'paid'
    END;

    UPDATE public.sales
    SET payment_status = v_new_ps,
        updated_at = now()
    WHERE id = v_failed_refund.sale_id;

    RETURN jsonb_build_object(
        'success', true,
        'is_replay', false,
        'replacement_refund_id', v_new_refund_id,
        'refund_id', v_new_refund_id,
        'sale_id', v_failed_refund.sale_id,
        'obligation_refund_id', v_obligation_id,
        'failed_refund_id', p_failed_refund_id,
        'parent_refund_id', p_failed_refund_id,
        'status', v_new_status,
        'refund_method', p_refund_method,
        'amount', to_char(v_failed_refund.amount, 'FM9999999990.0000'),
        'payment_status', v_new_ps,
        'created_at', now()
    );
END;
$$;


-- ============================================================================
-- 4. RPC Ownership, Security & Grants
-- ============================================================================

-- Function: confirm_refund_reimbursement
ALTER FUNCTION public.confirm_refund_reimbursement(UUID, UUID, TEXT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.confirm_refund_reimbursement(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_refund_reimbursement(UUID, UUID, TEXT, UUID) TO authenticated;

-- Function: record_refund_failure
ALTER FUNCTION public.record_refund_failure(UUID, UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_refund_failure(UUID, UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_refund_failure(UUID, UUID, TEXT) TO authenticated;

-- Function: issue_replacement_refund
ALTER FUNCTION public.issue_replacement_refund(UUID, UUID, TEXT, UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_replacement_refund(UUID, UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.issue_replacement_refund(UUID, UUID, TEXT, UUID, TEXT, TEXT) TO authenticated;
