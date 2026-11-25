-- Migration: 20261124000025_harden_execute_sale_zero_value.sql
-- Description: Allow zero-value promotional sales ($0 payable) with empty payments array per User Story 1 Scenario 6

CREATE OR REPLACE FUNCTION public.execute_sale(
    p_org_id                UUID,
    p_customer_id           UUID,
    p_items                 JSONB,
    p_payments              JSONB,
    p_order_discount_amount NUMERIC,
    p_idempotency_key       UUID,
    p_notes                 TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_org_currency TEXT;
    v_decimals INTEGER;
    v_tax_name TEXT := 'None';
    v_tax_rate NUMERIC(6, 4) := 0.0000;
    v_is_tax_inclusive BOOLEAN := false;

    v_sorted_items JSONB;
    v_sorted_payments JSONB;
    v_canonical_json JSONB;
    v_canonical_hash TEXT;

    v_existing_sale RECORD;

    v_item RECORD;
    v_payment RECORD;

    v_subtotal NUMERIC(14, 4) := 0.0000;
    v_total_tax NUMERIC(14, 4) := 0.0000;
    v_total_amount NUMERIC(14, 4) := 0.0000;
    v_total_payments NUMERIC(14, 4) := 0.0000;
    v_order_discount NUMERIC(14, 4);

    v_next_seq INTEGER;
    v_sale_number TEXT;
    v_sale_id UUID;
    v_items_count INTEGER;

    v_running_order_disc NUMERIC(14, 4) := 0.0000;
    v_item_idx INTEGER := 0;

    -- Temporary table array variables for computed lines
    v_calc_items JSONB := '[]'::jsonb;
    v_line RECORD;
    v_core_res JSONB;
    v_movement_id UUID;
BEGIN
    -- 1. Auth Guard
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

    -- 2. Active Org & Active Membership Guard
    SELECT currency INTO v_org_currency
    FROM public.organizations
    WHERE id = p_org_id AND is_active = TRUE;

    IF v_org_currency IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ORGANIZATION_INACTIVE';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_memberships
        WHERE organization_id = p_org_id AND user_id = auth.uid() AND status = 'active'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'MEMBERSHIP_INACTIVE';
    END IF;

    -- 3. Permission Gate: sales:create
    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'sales:create') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    -- 4. Idempotency Key Guard
    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0055', MESSAGE = 'IDEMPOTENCY_KEY_REQUIRED';
    END IF;

    -- 5. Transaction-Scoped Advisory Lock
    PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_idempotency_key::text));

    -- 6. Canonical Payload Hashing (PAY-010, F005-047)
    -- Normalize and sort items by product_id ASC
    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'line_discount_amount', to_char(coalesce((elem->>'line_discount_amount')::numeric, 0), 'FM9999999990.0000'),
            'product_id', (elem->>'product_id')::uuid,
            'quantity', to_char((elem->>'quantity')::numeric, 'FM9999999990.0000')
        ) ORDER BY (elem->>'product_id')::uuid ASC
    ), '[]'::jsonb) INTO v_sorted_items
    FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) elem;

    -- Normalize and sort payments across 5 discriminating fields deterministically
    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'amount', to_char((elem->>'amount')::numeric, 'FM9999999990.0000'),
            'amount_tendered', CASE WHEN (elem->>'amount_tendered') IS NOT NULL THEN to_char((elem->>'amount_tendered')::numeric, 'FM9999999990.0000') ELSE NULL END,
            'change_due', CASE WHEN (elem->>'change_due') IS NOT NULL THEN to_char((elem->>'change_due')::numeric, 'FM9999999990.0000') ELSE NULL END,
            'payment_method', elem->>'payment_method',
            'reference_no', NULLIF(trim(elem->>'reference_no'), '')
        ) ORDER BY
            elem->>'payment_method' ASC,
            (elem->>'amount')::numeric ASC,
            (elem->>'amount_tendered')::numeric ASC NULLS LAST,
            (elem->>'change_due')::numeric ASC NULLS LAST,
            NULLIF(trim(elem->>'reference_no'), '') ASC NULLS LAST
    ), '[]'::jsonb) INTO v_sorted_payments
    FROM jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) elem;

    v_canonical_json := jsonb_build_object(
        'customer_id', p_customer_id,
        'items', v_sorted_items,
        'order_discount_amount', to_char(coalesce(p_order_discount_amount, 0), 'FM9999999990.0000'),
        'payments', v_sorted_payments
    );

    v_canonical_hash := encode(sha256(convert_to(v_canonical_json::text, 'UTF8')), 'hex');

    -- 7. Idempotency Store Replay Check
    SELECT * INTO v_existing_sale
    FROM public.sales
    WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_existing_sale.idempotency_hash = v_canonical_hash THEN
            SELECT count(*) INTO v_items_count
            FROM public.sale_items
            WHERE sale_id = v_existing_sale.id;

            RETURN jsonb_build_object(
                'success', true,
                'is_replay', true,
                'sale_id', v_existing_sale.id,
                'sale_number', v_existing_sale.sale_number,
                'status', v_existing_sale.status,
                'payment_status', v_existing_sale.payment_status,
                'subtotal', to_char(v_existing_sale.subtotal, 'FM9999999990.0000'),
                'order_discount_amount', to_char(v_existing_sale.order_discount_amount, 'FM9999999990.0000'),
                'tax_amount', to_char(v_existing_sale.tax_amount, 'FM9999999990.0000'),
                'total_amount', to_char(v_existing_sale.total_amount, 'FM9999999990.0000'),
                'currency', v_existing_sale.currency,
                'items_count', v_items_count,
                'created_at', v_existing_sale.created_at,
                'created_by', v_existing_sale.created_by
            );
        ELSE
            RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
        END IF;
    END IF;

    -- 8. Cart Structure & Customer Guards
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0043', MESSAGE = 'SALE_EMPTY_CART';
    END IF;

    IF (SELECT count(DISTINCT (elem->>'product_id')::uuid) FROM jsonb_array_elements(p_items) elem) <> jsonb_array_length(p_items) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0044', MESSAGE = 'DUPLICATE_CART_PRODUCT';
    END IF;

    IF p_customer_id IS NOT NULL THEN
        SELECT status INTO v_item
        FROM public.customers
        WHERE organization_id = p_org_id AND id = p_customer_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0040', MESSAGE = 'CUSTOMER_NOT_FOUND';
        END IF;
        IF v_item.status = 'archived' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0041', MESSAGE = 'CUSTOMER_ARCHIVED';
        END IF;
    END IF;

    -- 9. Tax Settings & Currency Decimals Resolution
    SELECT tax_name, default_tax_rate, is_tax_inclusive
    INTO v_tax_name, v_tax_rate, v_is_tax_inclusive
    FROM public.organization_tax_settings
    WHERE organization_id = p_org_id;

    IF NOT FOUND THEN
        v_tax_name := 'None';
        v_tax_rate := 0.0000;
        v_is_tax_inclusive := false;
    END IF;

    v_decimals := public.get_currency_exponent(v_org_currency);
    v_order_discount := round(coalesce(p_order_discount_amount, 0.0000), v_decimals);

    IF v_order_discount < 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0007', MESSAGE = 'INVALID_FINANCIAL_AMOUNT';
    END IF;

    -- 10. Pass 1: Product Validation, Quantities, Unit Prices & Gross Totals
    -- Deadlock prevention: sort by product_id ASC
    FOR v_item IN
        SELECT
            (elem->>'product_id')::uuid AS product_id,
            (elem->>'quantity')::numeric AS quantity,
            coalesce((elem->>'line_discount_amount')::numeric, 0.0000) AS line_discount_amount,
            (elem->>'expected_version')::integer AS expected_version
        FROM jsonb_array_elements(p_items) elem
        ORDER BY (elem->>'product_id')::uuid ASC
    LOOP
        -- Check quantity bounds
        IF v_item.quantity IS NULL OR v_item.quantity <= 0.0000 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0012', MESSAGE = 'NON_POSITIVE_QUANTITY';
        END IF;

        IF v_item.quantity > 999999999.9999 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0028', MESSAGE = 'QUANTITY_EXCEEDS_MAXIMUM';
        END IF;

        IF trunc(v_item.quantity, 4) <> v_item.quantity THEN
            RAISE EXCEPTION USING ERRCODE = 'P0016', MESSAGE = 'DECIMAL_PRECISION_EXCEEDED';
        END IF;

        -- Lock and validate product under FOR SHARE
        SELECT p.selling_price, p.status, p.unit_of_measure, pc.cost_price
        INTO v_line
        FROM public.products p
        LEFT JOIN public.product_costs pc ON pc.product_id = p.id AND pc.organization_id = p_org_id
        WHERE p.organization_id = p_org_id AND p.id = v_item.product_id
        FOR SHARE OF p;

        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'PRODUCT_NOT_FOUND';
        END IF;

        IF v_line.status = 'archived' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0021', MESSAGE = 'PRODUCT_ARCHIVED_STOCK_FORBIDDEN';
        END IF;

        IF v_line.status = 'inactive' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0031', MESSAGE = 'PRODUCT_INACTIVE_SALE_BLOCKED';
        END IF;

        -- Discrete UOM integer check
        IF v_line.unit_of_measure IN ('piece', 'unit', 'box', 'pack', 'pair', 'set')
           AND trunc(v_item.quantity) <> v_item.quantity THEN
            RAISE EXCEPTION USING ERRCODE = 'P0015', MESSAGE = 'INTEGER_QUANTITY_REQUIRED';
        END IF;

        -- Line discount validation
        IF v_item.line_discount_amount < 0.0000 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0007', MESSAGE = 'INVALID_FINANCIAL_AMOUNT';
        END IF;

        IF v_item.line_discount_amount > round(v_item.quantity * v_line.selling_price, 4) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0047', MESSAGE = 'DISCOUNT_EXCEEDS_MAXIMUM';
        END IF;

        -- Accumulate subtotal (gross - line discount)
        v_subtotal := v_subtotal + (round(v_item.quantity * v_line.selling_price, 4) - v_item.line_discount_amount);

        -- Stash computed line data
        v_calc_items := v_calc_items || jsonb_build_object(
            'product_id', v_item.product_id,
            'quantity', v_item.quantity,
            'unit_price', v_line.selling_price,
            'unit_cost', v_line.cost_price,
            'line_discount_amount', v_item.line_discount_amount,
            'line_net', (round(v_item.quantity * v_line.selling_price, 4) - v_item.line_discount_amount),
            'expected_version', v_item.expected_version
        );
    END LOOP;

    -- Validate order discount against subtotal
    IF v_order_discount > v_subtotal THEN
        RAISE EXCEPTION USING ERRCODE = 'P0047', MESSAGE = 'DISCOUNT_EXCEEDS_MAXIMUM';
    END IF;

    -- 11. Pass 2: Order Discount Allocation & Tax Calculation per Line Item
    v_items_count := jsonb_array_length(v_calc_items);
    v_item_idx := 0;

    FOR v_line IN
        SELECT
            (elem->>'product_id')::uuid AS product_id,
            (elem->>'quantity')::numeric AS quantity,
            (elem->>'unit_price')::numeric AS unit_price,
            (elem->>'unit_cost')::numeric AS unit_cost,
            (elem->>'line_discount_amount')::numeric AS line_discount_amount,
            (elem->>'line_net')::numeric AS line_net,
            (elem->>'expected_version')::integer AS expected_version
        FROM jsonb_array_elements(v_calc_items) elem
    LOOP
        v_item_idx := v_item_idx + 1;
        DECLARE
            v_alloc_order_disc NUMERIC(14, 4);
            v_taxable_amount NUMERIC(14, 4);
            v_allocated_tax NUMERIC(14, 4);
            v_line_total NUMERIC(14, 4);
            v_line_discounted NUMERIC(14, 4);
        BEGIN
            -- Allocate order discount proportionally
            IF v_subtotal > 0 THEN
                IF v_item_idx = v_items_count THEN
                    -- Final item absorbs residual
                    v_alloc_order_disc := v_order_discount - v_running_order_disc;
                ELSE
                    v_alloc_order_disc := round((v_line.line_net / v_subtotal) * v_order_discount, v_decimals);
                    v_running_order_disc := v_running_order_disc + v_alloc_order_disc;
                END IF;
            ELSE
                v_alloc_order_disc := 0.0000;
            END IF;

            v_line_discounted := v_line.line_net - v_alloc_order_disc;

            -- Tax calculation
            IF v_is_tax_inclusive THEN
                v_taxable_amount := round(v_line_discounted / (1.0000 + (v_tax_rate / 100.0000)), v_decimals);
                v_allocated_tax := v_line_discounted - v_taxable_amount;
                v_line_total := v_line_discounted;
            ELSE
                v_taxable_amount := v_line_discounted;
                v_allocated_tax := round(v_line_discounted * (v_tax_rate / 100.0000), v_decimals);
                v_line_total := v_taxable_amount + v_allocated_tax;
            END IF;

            v_total_tax := v_total_tax + v_allocated_tax;
            v_total_amount := v_total_amount + v_line_total;
        END;
    END LOOP;

    -- 12. Pass 3: Payment Tender Validation
    IF (p_payments IS NULL OR jsonb_array_length(p_payments) = 0) THEN
        IF v_total_amount > 0.0000 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0045', MESSAGE = 'PAYMENT_INCOMPLETE';
        END IF;
    END IF;

    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN
            SELECT
                elem->>'payment_method' AS payment_method,
                (elem->>'amount')::numeric AS amount,
                (elem->>'amount_tendered')::numeric AS amount_tendered,
                (elem->>'change_due')::numeric AS change_due,
                NULLIF(trim(elem->>'reference_no'), '') AS reference_no
            FROM jsonb_array_elements(p_payments) elem
        LOOP
            IF v_payment.payment_method NOT IN ('cash', 'card', 'bank_transfer', 'other') THEN
                RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invalid payment method';
            END IF;

            IF v_payment.amount IS NULL OR v_payment.amount <= 0.0000 THEN
                RAISE EXCEPTION USING ERRCODE = 'P0007', MESSAGE = 'INVALID_FINANCIAL_AMOUNT';
            END IF;

            IF trunc(v_payment.amount, v_decimals) <> v_payment.amount THEN
                RAISE EXCEPTION USING ERRCODE = 'P0016', MESSAGE = 'DECIMAL_PRECISION_EXCEEDED';
            END IF;

            IF v_payment.payment_method <> 'cash' THEN
                -- Non-cash requires reference
                IF v_payment.reference_no IS NULL THEN
                    RAISE EXCEPTION USING ERRCODE = 'P0057', MESSAGE = 'PAYMENT_REFERENCE_REQUIRED';
                END IF;

                -- Non-cash overpayment forbidden
                IF v_payment.amount_tendered IS NOT NULL AND v_payment.amount_tendered > v_payment.amount THEN
                    RAISE EXCEPTION USING ERRCODE = 'P0046', MESSAGE = 'PAYMENT_EXCEEDS_PAYABLE_AMOUNT';
                END IF;
            ELSE
                -- Cash payment
                IF v_payment.amount_tendered IS NOT NULL AND v_payment.amount_tendered < v_payment.amount THEN
                    RAISE EXCEPTION USING ERRCODE = 'P0045', MESSAGE = 'PAYMENT_INCOMPLETE';
                END IF;
            END IF;

            -- Unique reference check across tenant
            IF v_payment.reference_no IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.payments
                WHERE organization_id = p_org_id
                  AND payment_method = v_payment.payment_method
                  AND reference_no = v_payment.reference_no
            ) THEN
                RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'PAYMENT_REFERENCE_EXISTS';
            END IF;

            v_total_payments := v_total_payments + v_payment.amount;
        END LOOP;
    END IF;

    -- Validate payment total matches sale total
    IF v_total_payments < v_total_amount THEN
        RAISE EXCEPTION USING ERRCODE = 'P0045', MESSAGE = 'PAYMENT_INCOMPLETE';
    END IF;

    IF v_total_payments > v_total_amount THEN
        RAISE EXCEPTION USING ERRCODE = 'P0046', MESSAGE = 'PAYMENT_EXCEEDS_PAYABLE_AMOUNT';
    END IF;

    -- 13. Pass 4: Sequence Generation (SAL-YYYYMMDD-XXXX)
    SELECT last_number + 1 INTO v_next_seq
    FROM public.sale_sequences
    WHERE organization_id = p_org_id AND sequence_type = 'sale' AND date_key = CURRENT_DATE
    FOR UPDATE;

    IF NOT FOUND THEN
        INSERT INTO public.sale_sequences (organization_id, sequence_type, date_key, last_number)
        VALUES (p_org_id, 'sale', CURRENT_DATE, 1)
        RETURNING 1 INTO v_next_seq;
    ELSE
        UPDATE public.sale_sequences
        SET last_number = v_next_seq, updated_at = now()
        WHERE organization_id = p_org_id AND sequence_type = 'sale' AND date_key = CURRENT_DATE;
    END IF;

    v_sale_number := 'SAL-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || lpad(v_next_seq::text, 4, '0');
    v_sale_id := gen_random_uuid();

    -- 14. Pass 5: Insert Sale Header
    INSERT INTO public.sales (
        id, organization_id, sale_number, customer_id, created_by,
        subtotal, order_discount_amount, is_tax_inclusive, tax_rate, tax_name,
        tax_amount, total_amount, currency, status, payment_status,
        idempotency_key, idempotency_hash, notes
    ) VALUES (
        v_sale_id, p_org_id, v_sale_number, p_customer_id, auth.uid(),
        v_subtotal, v_order_discount, v_is_tax_inclusive, v_tax_rate, v_tax_name,
        v_total_tax, v_total_amount, v_org_currency, 'completed', 'paid',
        p_idempotency_key, v_canonical_hash, NULLIF(trim(p_notes), '')
    );

    -- 15. Pass 6: Inventory Mutation & Sale Items Insertion (Ascending product_id)
    v_running_order_disc := 0.0000;
    v_item_idx := 0;

    FOR v_line IN
        SELECT
            (elem->>'product_id')::uuid AS product_id,
            (elem->>'quantity')::numeric AS quantity,
            (elem->>'unit_price')::numeric AS unit_price,
            (elem->>'unit_cost')::numeric AS unit_cost,
            (elem->>'line_discount_amount')::numeric AS line_discount_amount,
            (elem->>'line_net')::numeric AS line_net,
            (elem->>'expected_version')::integer AS expected_version
        FROM jsonb_array_elements(v_calc_items) elem
    LOOP
        v_item_idx := v_item_idx + 1;
        DECLARE
            v_alloc_order_disc NUMERIC(14, 4);
            v_taxable_amount NUMERIC(14, 4);
            v_allocated_tax NUMERIC(14, 4);
            v_line_total NUMERIC(14, 4);
            v_line_discounted NUMERIC(14, 4);
        BEGIN
            IF v_subtotal > 0 THEN
                IF v_item_idx = v_items_count THEN
                    v_alloc_order_disc := v_order_discount - v_running_order_disc;
                ELSE
                    v_alloc_order_disc := round((v_line.line_net / v_subtotal) * v_order_discount, v_decimals);
                    v_running_order_disc := v_running_order_disc + v_alloc_order_disc;
                END IF;
            ELSE
                v_alloc_order_disc := 0.0000;
            END IF;

            v_line_discounted := v_line.line_net - v_alloc_order_disc;

            IF v_is_tax_inclusive THEN
                v_taxable_amount := round(v_line_discounted / (1.0000 + (v_tax_rate / 100.0000)), v_decimals);
                v_allocated_tax := v_line_discounted - v_taxable_amount;
                v_line_total := v_line_discounted;
            ELSE
                v_taxable_amount := v_line_discounted;
                v_allocated_tax := round(v_line_discounted * (v_tax_rate / 100.0000), v_decimals);
                v_line_total := v_taxable_amount + v_allocated_tax;
            END IF;

            -- Deduct stock via Layer 1 core
            v_core_res := public._execute_inventory_mutation_core(
                p_org_id := p_org_id,
                p_product_id := v_line.product_id,
                p_movement_type := 'sale',
                p_quantity_delta := -1.0000 * v_line.quantity,
                p_reason := 'Sale ' || v_sale_number,
                p_reference_id := 'sale:' || v_sale_id::text,
                p_idempotency_key := NULL,
                p_idempotency_payload_hash := NULL,
                p_created_by := auth.uid(),
                p_expected_version := v_line.expected_version
            );
            v_movement_id := (v_core_res->>'movement_id')::uuid;

            -- Insert Sale Item with snapshotted unit_cost
            INSERT INTO public.sale_items (
                organization_id, sale_id, product_id, quantity, unit_price, unit_cost,
                line_discount_amount, allocated_order_disc, taxable_amount,
                allocated_tax_amount, total_price, movement_id
            ) VALUES (
                p_org_id, v_sale_id, v_line.product_id, v_line.quantity, v_line.unit_price, v_line.unit_cost,
                v_line.line_discount_amount, v_alloc_order_disc, v_taxable_amount,
                v_allocated_tax, v_line_total, v_movement_id
            );
        END;
    END LOOP;

    -- 16. Pass 7: Insert Payments
    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN
            SELECT
                elem->>'payment_method' AS payment_method,
                (elem->>'amount')::numeric AS amount,
                (elem->>'amount_tendered')::numeric AS amount_tendered,
                (elem->>'change_due')::numeric AS change_due,
                NULLIF(trim(elem->>'reference_no'), '') AS reference_no
            FROM jsonb_array_elements(p_payments) elem
        LOOP
            INSERT INTO public.payments (
                organization_id, sale_id, payment_method, amount,
                amount_tendered, change_due, reference_no
            ) VALUES (
                p_org_id, v_sale_id, v_payment.payment_method, v_payment.amount,
                CASE WHEN v_payment.amount_tendered IS NOT NULL THEN v_payment.amount_tendered ELSE v_payment.amount END,
                CASE WHEN v_payment.change_due IS NOT NULL THEN v_payment.change_due
                     WHEN v_payment.payment_method = 'cash' AND v_payment.amount_tendered IS NOT NULL THEN (v_payment.amount_tendered - v_payment.amount)
                     ELSE 0.0000 END,
                v_payment.reference_no
            );
        END LOOP;
    END IF;

    -- 17. Return Result
    RETURN jsonb_build_object(
        'success', true,
        'is_replay', false,
        'sale_id', v_sale_id,
        'sale_number', v_sale_number,
        'status', 'completed',
        'payment_status', 'paid',
        'subtotal', to_char(v_subtotal, 'FM9999999990.0000'),
        'order_discount_amount', to_char(v_order_discount, 'FM9999999990.0000'),
        'tax_amount', to_char(v_total_tax, 'FM9999999990.0000'),
        'total_amount', to_char(v_total_amount, 'FM9999999990.0000'),
        'currency', v_org_currency,
        'items_count', v_items_count,
        'created_at', now(),
        'created_by', auth.uid()
    );
END;
$$;

ALTER FUNCTION public.execute_sale(UUID, UUID, JSONB, JSONB, NUMERIC, UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.execute_sale(UUID, UUID, JSONB, JSONB, NUMERIC, UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.execute_sale(UUID, UUID, JSONB, JSONB, NUMERIC, UUID, TEXT) TO authenticated;
