-- ============================================================================
-- Migration: 20261123000023_harden_execute_sale_return_rpc.sql
-- Description: Harden public.execute_sale_return RPC with Revision 2.6 compliance:
--   1. F005-039 pending refund payment status calculation.
--   2. Complete return result projection on idempotent replay.
--   3. Strict SECURITY DEFINER execution grants and privileges.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.execute_sale_return(
    p_org_id          UUID,
    p_sale_id         UUID,
    p_return_items    JSONB,
    p_refund_method   TEXT,
    p_reason          TEXT,
    p_idempotency_key UUID,
    p_reference_no    TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_clean_reason TEXT;
    v_sale RECORD;
    v_decimals INTEGER;
    v_sorted_return_items JSONB;
    v_canonical_json JSONB;
    v_canonical_hash TEXT;
    v_existing_return RECORD;

    v_ret_item RECORD;
    v_sale_item RECORD;
    v_prior_returned_qty NUMERIC(14, 4);
    v_prior_refund_amount NUMERIC(14, 4);
    v_remaining_qty NUMERIC(14, 4);
    v_prod_status TEXT;
    v_prod_uom TEXT;

    v_item_refund NUMERIC(14, 4);
    v_total_return_refund NUMERIC(14, 4) := 0.0000;

    v_orig_method_tender NUMERIC(14, 4);
    v_prior_method_refunds NUMERIC(14, 4);
    v_prior_total_refunds NUMERIC(14, 4);

    v_next_seq INTEGER;
    v_return_number TEXT;
    v_return_id UUID;
    v_refund_id UUID;
    v_refund_status TEXT;

    v_calc_return_items JSONB := '[]'::jsonb;
    v_line RECORD;
    v_core_res JSONB;
    v_movement_id UUID;

    v_completed_refunds NUMERIC(14, 4);
    v_has_pending_refunds BOOLEAN;
    v_new_sale_status TEXT;
    v_new_payment_status TEXT;
    v_all_items_fully_returned BOOLEAN;

    -- Replay fields
    v_replay_refund_id UUID;
    v_replay_refund_status TEXT;
    v_replay_sale_status TEXT;
    v_replay_sale_payment_status TEXT;
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

    -- 3. Permission Gate: returns:create
    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'returns:create') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    -- 4. Idempotency Key Guard
    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0055', MESSAGE = 'IDEMPOTENCY_KEY_REQUIRED';
    END IF;

    v_clean_reason := trim(p_reason);
    IF v_clean_reason IS NULL OR length(v_clean_reason) < 3 OR length(v_clean_reason) > 255 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0053', MESSAGE = 'RETURN_REASON_REQUIRED';
    END IF;

    IF p_refund_method NOT IN ('cash', 'card', 'bank_transfer', 'other') THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invalid refund method';
    END IF;

    IF p_return_items IS NULL OR jsonb_array_length(p_return_items) = 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0043', MESSAGE = 'SALE_EMPTY_CART';
    END IF;

    -- Duplicate sale_item_id check
    IF (SELECT count(DISTINCT (elem->>'sale_item_id')::uuid) FROM jsonb_array_elements(p_return_items) elem) <> jsonb_array_length(p_return_items) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0060', MESSAGE = 'DUPLICATE_RETURN_ITEM';
    END IF;

    -- 5. Advisory Lock on Idempotency Key
    PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_idempotency_key::text));

    -- 6. Canonical Return Hash Construction
    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'quantity', to_char((elem->>'quantity')::numeric, 'FM9999999990.0000'),
            'restock_to_inventory', coalesce((elem->>'restock_to_inventory')::boolean, false),
            'sale_item_id', (elem->>'sale_item_id')::uuid
        ) ORDER BY (elem->>'sale_item_id')::uuid ASC
    ), '[]'::jsonb) INTO v_sorted_return_items
    FROM jsonb_array_elements(p_return_items) elem;

    v_canonical_json := jsonb_build_object(
        'items', v_sorted_return_items,
        'reason', v_clean_reason,
        'reference_no', NULLIF(trim(p_reference_no), ''),
        'refund_method', p_refund_method,
        'sale_id', p_sale_id
    );
    v_canonical_hash := encode(sha256(convert_to(v_canonical_json::text, 'UTF8')), 'hex');

    -- 7. Check Idempotency Store
    SELECT * INTO v_existing_return
    FROM public.sale_returns
    WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_existing_return.idempotency_hash = v_canonical_hash THEN
            SELECT id, status INTO v_replay_refund_id, v_replay_refund_status
            FROM public.refunds
            WHERE organization_id = p_org_id AND return_id = v_existing_return.id
            ORDER BY created_at ASC LIMIT 1;

            SELECT status, payment_status INTO v_replay_sale_status, v_replay_sale_payment_status
            FROM public.sales
            WHERE organization_id = p_org_id AND id = v_existing_return.sale_id;

            RETURN jsonb_build_object(
                'success', true,
                'is_replay', true,
                'return_id', v_existing_return.id,
                'return_number', v_existing_return.return_number,
                'sale_id', v_existing_return.sale_id,
                'total_refund_amount', to_char(v_existing_return.total_refund_amount, 'FM9999999990.0000'),
                'refund_id', v_replay_refund_id,
                'refund_status', v_replay_refund_status,
                'sale_status', v_replay_sale_status,
                'payment_status', v_replay_sale_payment_status,
                'created_at', v_existing_return.created_at
            );
        ELSE
            RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
        END IF;
    END IF;

    -- 8. Lock Sale Row FOR UPDATE
    SELECT * INTO v_sale
    FROM public.sales
    WHERE organization_id = p_org_id AND id = p_sale_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0048', MESSAGE = 'SALE_NOT_FOUND';
    END IF;

    IF v_sale.status = 'voided' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0050', MESSAGE = 'SALE_ALREADY_VOIDED';
    END IF;

    IF v_sale.status NOT IN ('completed', 'partially_returned') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0049', MESSAGE = 'SALE_NOT_COMPLETED';
    END IF;

    v_decimals := public.get_currency_exponent(v_sale.currency);

    -- 9. Pass 1: Validate Return Items, Unreturned Quantities & Proportional Refund
    FOR v_ret_item IN
        SELECT
            (elem->>'sale_item_id')::uuid AS sale_item_id,
            (elem->>'quantity')::numeric AS quantity,
            coalesce((elem->>'restock_to_inventory')::boolean, false) AS restock_to_inventory
        FROM jsonb_array_elements(p_return_items) elem
        ORDER BY (elem->>'sale_item_id')::uuid ASC
    LOOP
        IF v_ret_item.quantity IS NULL OR v_ret_item.quantity <= 0.0000 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0012', MESSAGE = 'NON_POSITIVE_QUANTITY';
        END IF;

        IF trunc(v_ret_item.quantity, 4) <> v_ret_item.quantity THEN
            RAISE EXCEPTION USING ERRCODE = 'P0016', MESSAGE = 'DECIMAL_PRECISION_EXCEEDED';
        END IF;

        -- Fetch sale item
        SELECT * INTO v_sale_item
        FROM public.sale_items
        WHERE organization_id = p_org_id AND sale_id = p_sale_id AND id = v_ret_item.sale_item_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0048', MESSAGE = 'SALE_NOT_FOUND';
        END IF;

        -- Prior returned quantity for this sale item
        SELECT coalesce(sum(quantity), 0.0000) INTO v_prior_returned_qty
        FROM public.sale_return_items
        WHERE organization_id = p_org_id AND sale_item_id = v_ret_item.sale_item_id;

        v_remaining_qty := v_sale_item.quantity - v_prior_returned_qty;

        IF v_ret_item.quantity > v_remaining_qty THEN
            RAISE EXCEPTION USING ERRCODE = 'P0052', MESSAGE = 'RETURN_QUANTITY_EXCEEDS_SOLD';
        END IF;

        -- Product check
        SELECT status, unit_of_measure
        INTO v_prod_status, v_prod_uom
        FROM public.products
        WHERE organization_id = p_org_id AND id = v_sale_item.product_id;

        IF v_prod_status = 'archived' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0021', MESSAGE = 'PRODUCT_ARCHIVED_STOCK_FORBIDDEN';
        END IF;

        IF v_ret_item.restock_to_inventory AND v_prod_status <> 'active' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0056', MESSAGE = 'PRODUCT_INACTIVE_RETURN_BLOCKED';
        END IF;

        IF v_prod_uom IN ('piece', 'unit', 'box', 'pack', 'pair', 'set')
           AND trunc(v_ret_item.quantity) <> v_ret_item.quantity THEN
            RAISE EXCEPTION USING ERRCODE = 'P0015', MESSAGE = 'INTEGER_QUANTITY_REQUIRED';
        END IF;

        -- Proportional refund calculation:
        -- Final remaining quantity absorbs residual
        IF v_ret_item.quantity = v_remaining_qty THEN
            SELECT coalesce(sum(refund_amount), 0.0000) INTO v_prior_refund_amount
            FROM public.sale_return_items
            WHERE organization_id = p_org_id AND sale_item_id = v_ret_item.sale_item_id;

            v_item_refund := v_sale_item.total_price - v_prior_refund_amount;
        ELSE
            v_item_refund := round((v_sale_item.total_price / v_sale_item.quantity) * v_ret_item.quantity, v_decimals);
        END IF;

        v_total_return_refund := v_total_return_refund + v_item_refund;

        v_calc_return_items := v_calc_return_items || jsonb_build_object(
            'sale_item_id', v_ret_item.sale_item_id,
            'product_id', v_sale_item.product_id,
            'quantity', v_ret_item.quantity,
            'refund_amount', v_item_refund,
            'restock_to_inventory', v_ret_item.restock_to_inventory
        );
    END LOOP;

    -- 10. Split-Tender Ceiling Check
    IF p_refund_method <> 'cash' THEN
        SELECT coalesce(sum(amount), 0.0000) INTO v_orig_method_tender
        FROM public.payments
        WHERE organization_id = p_org_id AND sale_id = p_sale_id AND payment_method = p_refund_method;

        SELECT coalesce(sum(amount), 0.0000) INTO v_prior_method_refunds
        FROM public.refunds
        WHERE organization_id = p_org_id AND sale_id = p_sale_id AND refund_method = p_refund_method AND status IN ('completed', 'pending');

        IF v_prior_method_refunds + v_total_return_refund > v_orig_method_tender THEN
            RAISE EXCEPTION USING ERRCODE = 'P0061', MESSAGE = 'REFUND_METHOD_EXCEEDS_ORIGINAL_TENDER';
        END IF;
    END IF;

    -- 11. Cumulative Refund Cap Check
    SELECT coalesce(sum(amount), 0.0000) INTO v_prior_total_refunds
    FROM public.refunds
    WHERE organization_id = p_org_id AND sale_id = p_sale_id AND status IN ('completed', 'pending');

    IF v_prior_total_refunds + v_total_return_refund > v_sale.total_amount THEN
        RAISE EXCEPTION USING ERRCODE = 'P0054', MESSAGE = 'REFUND_EXCEEDS_PAYABLE';
    END IF;

    -- 12. Generate Return Sequence Number (RET-YYYYMMDD-XXXX)
    SELECT last_number + 1 INTO v_next_seq
    FROM public.sale_sequences
    WHERE organization_id = p_org_id AND sequence_type = 'return' AND date_key = CURRENT_DATE
    FOR UPDATE;

    IF NOT FOUND THEN
        INSERT INTO public.sale_sequences (organization_id, sequence_type, date_key, last_number)
        VALUES (p_org_id, 'return', CURRENT_DATE, 1)
        RETURNING 1 INTO v_next_seq;
    ELSE
        UPDATE public.sale_sequences
        SET last_number = v_next_seq, updated_at = now()
        WHERE organization_id = p_org_id AND sequence_type = 'return' AND date_key = CURRENT_DATE;
    END IF;

    v_return_number := 'RET-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || lpad(v_next_seq::text, 4, '0');
    v_return_id := gen_random_uuid();

    -- 13. Insert Sale Return Header
    INSERT INTO public.sale_returns (
        id, organization_id, sale_id, return_number, reason,
        total_refund_amount, idempotency_key, idempotency_hash, created_by
    ) VALUES (
        v_return_id, p_org_id, p_sale_id, v_return_number, v_clean_reason,
        v_total_return_refund, p_idempotency_key, v_canonical_hash, auth.uid()
    );

    -- 14. Pass 2: Restock Mutation & Return Items Insertion (Ascending product_id Order)
    FOR v_line IN
        SELECT
            (elem->>'sale_item_id')::uuid AS sale_item_id,
            (elem->>'product_id')::uuid AS product_id,
            (elem->>'quantity')::numeric AS quantity,
            (elem->>'refund_amount')::numeric AS refund_amount,
            (elem->>'restock_to_inventory')::boolean AS restock_to_inventory
        FROM jsonb_array_elements(v_calc_return_items) elem
        ORDER BY (elem->>'product_id')::uuid ASC
    LOOP
        v_movement_id := NULL;

        IF v_line.restock_to_inventory THEN
            v_core_res := public._execute_inventory_mutation_core(
                p_org_id := p_org_id,
                p_product_id := v_line.product_id,
                p_movement_type := 'return',
                p_quantity_delta := v_line.quantity,
                p_reason := 'Return ' || v_return_number,
                p_reference_id := 'return:' || v_return_id::text,
                p_idempotency_key := NULL,
                p_idempotency_payload_hash := NULL,
                p_created_by := auth.uid()
            );
            v_movement_id := (v_core_res->>'movement_id')::uuid;
        END IF;

        INSERT INTO public.sale_return_items (
            organization_id, return_id, sale_id, sale_item_id,
            product_id, quantity, refund_amount, restock_to_inventory, movement_id
        ) VALUES (
            p_org_id, v_return_id, p_sale_id, v_line.sale_item_id,
            v_line.product_id, v_line.quantity, v_line.refund_amount,
            v_line.restock_to_inventory, v_movement_id
        );
    END LOOP;

    -- 15. Create Refund Row
    -- Self-referencing obligation_refund_id = id validates deferred at transaction commit
    v_refund_id := gen_random_uuid();
    v_refund_status := CASE WHEN p_refund_method = 'cash' THEN 'completed' ELSE 'pending' END;

    INSERT INTO public.refunds (
        id, organization_id, sale_id, return_id, parent_refund_id, obligation_refund_id,
        refund_method, amount, reference_no, status, reason, processed_by
    ) VALUES (
        v_refund_id, p_org_id, p_sale_id, v_return_id, NULL, v_refund_id,
        p_refund_method, v_total_return_refund, NULLIF(trim(p_reference_no), ''),
        v_refund_status, 'Return: ' || v_clean_reason, auth.uid()
    );

    -- 16. Recalculate Sale Status and Payment Status (F005-039 Reconciled Formula)
    -- Check if all items across sale are now fully returned
    SELECT bool_and(
        si.quantity <= (
            SELECT coalesce(sum(sri.quantity), 0)
            FROM public.sale_return_items sri
            WHERE sri.organization_id = p_org_id AND sri.sale_item_id = si.id
        )
    ) INTO v_all_items_fully_returned
    FROM public.sale_items si
    WHERE si.organization_id = p_org_id AND si.sale_id = p_sale_id;

    IF v_all_items_fully_returned THEN
        v_new_sale_status := 'returned';
    ELSE
        v_new_sale_status := 'partially_returned';
    END IF;

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
        WHEN v_all_items_fully_returned AND v_completed_refunds >= v_sale.total_amount
            THEN 'refunded'
        WHEN v_completed_refunds > 0.0000 OR v_has_pending_refunds
            THEN 'partially_refunded'
        ELSE 'paid'
    END;

    UPDATE public.sales
    SET status = v_new_sale_status,
        payment_status = v_new_payment_status,
        updated_at = now()
    WHERE id = p_sale_id;

    -- 17. Return Result
    RETURN jsonb_build_object(
        'success', true,
        'is_replay', false,
        'return_id', v_return_id,
        'return_number', v_return_number,
        'sale_id', p_sale_id,
        'total_refund_amount', to_char(v_total_return_refund, 'FM9999999990.0000'),
        'refund_id', v_refund_id,
        'refund_status', v_refund_status,
        'sale_status', v_new_sale_status,
        'payment_status', v_new_payment_status,
        'created_at', now()
    );
END;
$$;

ALTER FUNCTION public.execute_sale_return(UUID, UUID, JSONB, TEXT, TEXT, UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.execute_sale_return(UUID, UUID, JSONB, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.execute_sale_return(UUID, UUID, JSONB, TEXT, TEXT, UUID, TEXT) TO authenticated;
