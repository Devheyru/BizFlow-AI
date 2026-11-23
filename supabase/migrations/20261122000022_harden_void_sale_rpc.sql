-- ============================================================================
-- Migration: 20261122000022_harden_void_sale_rpc.sql
-- Description: Harden public.void_sale RPC with Revision 2.6 compliance:
--   1. F005-039 pending refund payment status calculation.
--   2. Canonical idempotency hash with deterministic reversal reference ordering.
--   3. Transaction-scoped advisory lock on (p_org_id, p_idempotency_key).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.void_sale(
    p_org_id               UUID,
    p_sale_id              UUID,
    p_void_reason          TEXT,
    p_idempotency_key      UUID,
    p_reversal_references  JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_clean_reason TEXT;
    v_sale RECORD;
    v_sorted_reversals JSONB;
    v_canonical_jsonb JSONB;
    v_canonical_hash TEXT;
    v_item RECORD;
    v_payment RECORD;
    v_core_res JSONB;
    v_refund_id UUID;
    v_ref_status TEXT;
    v_lookup_ref TEXT;
    v_completed_refunds NUMERIC(14, 4);
    v_has_pending_refunds BOOLEAN;
    v_new_payment_status TEXT;
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

    -- 3. Permission Gate: sales:void
    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'sales:void') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    -- 4. Idempotency Key Guard
    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0055', MESSAGE = 'IDEMPOTENCY_KEY_REQUIRED';
    END IF;

    -- 5. Transaction-scoped Advisory Lock (Revision 2.6 Serialization)
    PERFORM pg_advisory_xact_lock(
        hashtext(p_org_id::text),
        hashtext(p_idempotency_key::text)
    );

    -- 6. Void Reason Validation
    v_clean_reason := trim(p_void_reason);
    IF v_clean_reason IS NULL OR length(v_clean_reason) < 3 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0053', MESSAGE = 'RETURN_REASON_REQUIRED';
    END IF;

    -- 7. Lock Sale Row FOR UPDATE
    SELECT * INTO v_sale
    FROM public.sales
    WHERE organization_id = p_org_id AND id = p_sale_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0048', MESSAGE = 'SALE_NOT_FOUND';
    END IF;

    -- 8. Deterministic Reversal References Sorting & Canonical Void Hash (Revision 2.6)
    SELECT coalesce(
        jsonb_agg(
            elem ORDER BY (elem->>'payment_id')::UUID ASC
        ),
        '[]'::jsonb
    )
    INTO v_sorted_reversals
    FROM jsonb_array_elements(
        coalesce(p_reversal_references, '[]'::jsonb)
    ) elem;

    v_canonical_jsonb := jsonb_build_object(
        'idempotency_key', p_idempotency_key::text,
        'organization_id', p_org_id::text,
        'reversal_references', v_sorted_reversals,
        'sale_id', p_sale_id::text,
        'void_reason', v_clean_reason
    );
    v_canonical_hash := encode(
        sha256(convert_to(v_canonical_jsonb::text, 'UTF8')),
        'hex'
    );

    IF v_sale.void_idempotency_key = p_idempotency_key THEN
        IF v_sale.void_idempotency_hash = v_canonical_hash THEN
            RETURN jsonb_build_object(
                'success', true,
                'is_replay', true,
                'sale_id', v_sale.id,
                'sale_number', v_sale.sale_number,
                'status', v_sale.status,
                'payment_status', v_sale.payment_status,
                'voided_at', v_sale.voided_at,
                'voided_by', v_sale.voided_by
            );
        ELSE
            RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
        END IF;
    END IF;

    -- 9. Status & Return Eligibility Guards
    IF v_sale.status = 'voided' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0050', MESSAGE = 'SALE_ALREADY_VOIDED';
    END IF;

    IF v_sale.status <> 'completed' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0049', MESSAGE = 'SALE_NOT_COMPLETED';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.sale_returns
        WHERE organization_id = p_org_id AND sale_id = p_sale_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0051', MESSAGE = 'SALE_VOID_HAS_RETURNS_BLOCKED';
    END IF;

    -- 10. Restore Stock via Inventory Core in Ascending product_id Order
    FOR v_item IN
        SELECT product_id, quantity
        FROM public.sale_items
        WHERE organization_id = p_org_id AND sale_id = p_sale_id
        ORDER BY product_id ASC
    LOOP
        v_core_res := public._execute_inventory_mutation_core(
            p_org_id := p_org_id,
            p_product_id := v_item.product_id,
            p_movement_type := 'return',
            p_quantity_delta := v_item.quantity,
            p_reason := 'Void sale: ' || v_clean_reason,
            p_reference_id := 'void:' || p_sale_id::text,
            p_idempotency_key := NULL,
            p_idempotency_payload_hash := NULL,
            p_created_by := auth.uid()
        );
    END LOOP;

    -- 11. Create Refund Records per Original Payment
    -- Constraint fk_refunds_org_obligation is DEFERRABLE INITIALLY DEFERRED,
    -- allowing obligation_refund_id = id (self-referencing) to validate at commit
    FOR v_payment IN
        SELECT id, payment_method, amount, reference_no
        FROM public.payments
        WHERE organization_id = p_org_id AND sale_id = p_sale_id
        ORDER BY created_at ASC
    LOOP
        v_refund_id := gen_random_uuid();

        IF v_payment.payment_method = 'cash' THEN
            v_ref_status := 'completed';
            v_lookup_ref := NULL;
        ELSE
            v_ref_status := 'pending';
            -- Look up optional reversal reference if provided
            SELECT elem->>'reference_no' INTO v_lookup_ref
            FROM jsonb_array_elements(coalesce(p_reversal_references, '[]'::jsonb)) elem
            WHERE (elem->>'payment_id')::uuid = v_payment.id;

            IF v_lookup_ref IS NULL THEN
                v_lookup_ref := v_payment.reference_no;
            END IF;
        END IF;

        INSERT INTO public.refunds (
            id, organization_id, sale_id, return_id, parent_refund_id, obligation_refund_id,
            refund_method, amount, reference_no, status, reason, processed_by
        ) VALUES (
            v_refund_id, p_org_id, p_sale_id, NULL, NULL, v_refund_id,
            v_payment.payment_method, v_payment.amount, v_lookup_ref, v_ref_status,
            'Void sale: ' || v_clean_reason, auth.uid()
        );
    END LOOP;

    -- 12. Recalculate Sale payment_status (F005-039 Reconciled Formula)
    SELECT coalesce(sum(amount), 0.0000) INTO v_completed_refunds
    FROM public.refunds
    WHERE organization_id = p_org_id AND sale_id = p_sale_id AND status = 'completed';

    v_has_pending_refunds := EXISTS (
        SELECT 1
        FROM public.refunds
        WHERE organization_id = p_org_id
          AND sale_id = p_sale_id
          AND status = 'pending'
    );

    v_new_payment_status := CASE
        WHEN v_completed_refunds >= v_sale.total_amount
            THEN 'refunded'
        WHEN v_completed_refunds > 0.0000 OR v_has_pending_refunds
            THEN 'partially_refunded'
        ELSE 'paid'
    END;

    -- 13. Update Sale Header
    UPDATE public.sales
    SET status = 'voided',
        payment_status = v_new_payment_status,
        void_idempotency_key = p_idempotency_key,
        void_idempotency_hash = v_canonical_hash,
        voided_at = now(),
        voided_by = auth.uid(),
        void_reason = v_clean_reason,
        updated_at = now()
    WHERE id = p_sale_id;

    RETURN jsonb_build_object(
        'success', true,
        'is_replay', false,
        'sale_id', p_sale_id,
        'sale_number', v_sale.sale_number,
        'status', 'voided',
        'payment_status', v_new_payment_status,
        'voided_at', now(),
        'voided_by', auth.uid()
    );
END;
$$;

ALTER FUNCTION public.void_sale(UUID, UUID, TEXT, UUID, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.void_sale(UUID, UUID, TEXT, UUID, JSONB) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.void_sale(UUID, UUID, TEXT, UUID, JSONB) TO authenticated;
