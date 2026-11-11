-- ============================================================================
-- Migration: 20261111000018_enforce_inventory_uom_precision_invariants.sql
-- Feature: 004 — Inventory & Stock Management (Phase 5 Security Hardening)
-- Description:
--   Forward migration adding database-level enforcement in both Layer 2
--   (`execute_stock_movement`) and Layer 1 (`_execute_inventory_mutation_core`) for:
--   1. Authoritative discrete unit-of-measure integer invariant (`P0015`, INTEGER_QUANTITY_REQUIRED)
--      resolved from the tenant-owned `public.products.unit_of_measure` under `FOR SHARE` lock.
--   2. Strict 4-decimal precision guard (`P0016`, DECIMAL_PRECISION_EXCEEDED) prior to numeric scale rounding.
--   3. Maximum bound guard (`P0028`, QUANTITY_EXCEEDS_MAXIMUM) up to 999,999,999.9999.
--   4. Explicit sign/null guards (`P0012` restock <= 0, `P0013` negative initial/target, `P0014` zero delta).
--   Preserves the approved Layer 1 / Layer 2 mutation architecture, strict lock order
--   (products FOR SHARE -> inventory FOR UPDATE), and idempotent replay-before-lifecycle order.
-- ============================================================================

-- ============================================================================
-- 1. Harden Layer 1 Internal Mutation Core (_execute_inventory_mutation_core)
-- ============================================================================

CREATE OR REPLACE FUNCTION public._execute_inventory_mutation_core(
    p_org_id UUID,
    p_product_id UUID,
    p_movement_type TEXT,
    p_quantity_delta NUMERIC,
    p_reason TEXT,
    p_reference_id TEXT,
    p_idempotency_key UUID,
    p_idempotency_payload_hash TEXT,
    p_created_by UUID,
    p_expected_version INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_prod_uom TEXT;
    v_is_discrete_uom BOOLEAN;
    v_inventory_id UUID;
    v_current_qty NUMERIC(14, 4);
    v_current_version INTEGER;
    v_raw_resulting_qty NUMERIC;
    v_resulting_qty NUMERIC(14, 4);
    v_movement_id UUID;
    v_unit_cost NUMERIC(14, 4);
    v_currency TEXT;
BEGIN
    -- 0. Lock Product (FOR SHARE) FIRST to preserve strict lock hierarchy (products -> inventory)
    --    and read authoritative unit_of_measure from the tenant-owned product row.
    SELECT unit_of_measure INTO v_prod_uom
    FROM public.products
    WHERE organization_id = p_org_id AND id = p_product_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'PRODUCT_NOT_FOUND';
    END IF;

    -- Validate delta presence, 4-decimal scale, maximum bounds, and discrete UOM integer invariant
    IF p_quantity_delta IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0014', MESSAGE = 'ZERO_QUANTITY_NOT_PERMITTED';
    END IF;

    IF trunc(p_quantity_delta, 4) <> p_quantity_delta THEN
        RAISE EXCEPTION USING ERRCODE = 'P0016', MESSAGE = 'DECIMAL_PRECISION_EXCEEDED';
    END IF;

    IF abs(p_quantity_delta) > 999999999.9999 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0028', MESSAGE = 'QUANTITY_EXCEEDS_MAXIMUM';
    END IF;

    v_is_discrete_uom := (v_prod_uom IN ('piece', 'unit', 'box', 'pack', 'pair', 'set'));
    IF v_is_discrete_uom AND trunc(p_quantity_delta) <> p_quantity_delta THEN
        RAISE EXCEPTION USING ERRCODE = 'P0015', MESSAGE = 'INTEGER_QUANTITY_REQUIRED';
    END IF;

    -- 1. Row Lock & Inventory ID Resolution
    SELECT id, quantity, version INTO v_inventory_id, v_current_qty, v_current_version
    FROM public.inventory
    WHERE organization_id = p_org_id AND product_id = p_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0004', MESSAGE = 'INVENTORY_NOT_FOUND';
    END IF;

    -- 2. Optimistic Concurrency Control Check
    IF p_expected_version IS NOT NULL AND v_current_version <> p_expected_version THEN
        RAISE EXCEPTION USING ERRCODE = 'P0027', MESSAGE = 'STALE_VERSION_CONFLICT';
    END IF;

    -- 3. Negative Stock, Maximum Bound & Discrete Resulting Balance Guards
    v_raw_resulting_qty := v_current_qty + p_quantity_delta;
    IF v_raw_resulting_qty < 0.0000 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0011', MESSAGE = 'INSUFFICIENT_STOCK';
    END IF;

    IF v_raw_resulting_qty > 999999999.9999 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0028', MESSAGE = 'QUANTITY_EXCEEDS_MAXIMUM';
    END IF;

    IF v_is_discrete_uom AND trunc(v_raw_resulting_qty) <> v_raw_resulting_qty THEN
        RAISE EXCEPTION USING ERRCODE = 'P0015', MESSAGE = 'INTEGER_QUANTITY_REQUIRED';
    END IF;

    v_resulting_qty := v_raw_resulting_qty::NUMERIC(14, 4);

    -- 4. Initial Singularity Guard: initial movement permitted only when no prior movement exists
    IF p_movement_type = 'initial' THEN
        IF EXISTS (
            SELECT 1 FROM public.stock_movements
            WHERE organization_id = p_org_id AND product_id = p_product_id
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0026', MESSAGE = 'INITIAL_STOCK_NOT_PERMITTED_HISTORY_EXISTS';
        END IF;
    END IF;

    -- 5. Atomic Inventory Balance Update
    UPDATE public.inventory
    SET quantity = v_resulting_qty,
        version = version + 1,
        updated_at = clock_timestamp()
    WHERE id = v_inventory_id;

    -- 6. Immutable Movement Ledger Insert
    INSERT INTO public.stock_movements (
        organization_id,
        product_id,
        inventory_id,
        movement_type,
        quantity_before,
        quantity_delta,
        quantity_after,
        reason,
        reference_id,
        idempotency_key,
        idempotency_payload_hash,
        created_by,
        created_at
    ) VALUES (
        p_org_id,
        p_product_id,
        v_inventory_id,
        p_movement_type,
        v_current_qty,
        p_quantity_delta,
        v_resulting_qty,
        trim(p_reason),
        NULLIF(trim(p_reference_id), ''),
        p_idempotency_key,
        CASE WHEN p_idempotency_key IS NULL THEN NULL ELSE p_idempotency_payload_hash END,
        p_created_by,
        clock_timestamp()
    ) RETURNING id INTO v_movement_id;

    -- 7. Acquisition Cost Snapshot (Dual-auth isolated table)
    SELECT cost_price INTO v_unit_cost
    FROM public.product_costs
    WHERE product_id = p_product_id AND organization_id = p_org_id;

    IF FOUND AND v_unit_cost IS NOT NULL THEN
        SELECT currency INTO v_currency FROM public.organizations WHERE id = p_org_id;
        INSERT INTO public.stock_movement_costs (
            movement_id,
            organization_id,
            unit_cost,
            currency,
            created_at
        ) VALUES (
            v_movement_id,
            p_org_id,
            v_unit_cost,
            v_currency,
            clock_timestamp()
        );
    END IF;

    -- 8. Return Authoritative Result
    RETURN jsonb_build_object(
        'success', true,
        'status', 'committed',
        'is_replay', false,
        'movement_id', v_movement_id,
        'product_id', p_product_id,
        'quantity_before', to_char(v_current_qty, 'FM9999999990.0000'),
        'quantity_delta', to_char(p_quantity_delta, 'FM9999999990.0000'),
        'quantity_after', to_char(v_resulting_qty, 'FM9999999990.0000'),
        'current_stock', to_char(v_resulting_qty, 'FM9999999990.0000'),
        'version', v_current_version + 1
    );
END;
$$;

-- ============================================================================
-- 2. Harden Layer 2 Public Mutation RPC Wrapper (execute_stock_movement)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.execute_stock_movement(
    p_org_id UUID,
    p_product_id UUID,
    p_movement_type TEXT,
    p_quantity NUMERIC,
    p_reason TEXT,
    p_reference_id TEXT DEFAULT NULL,
    p_idempotency_key UUID DEFAULT NULL,
    p_expected_version INTEGER DEFAULT NULL,
    p_quantity_semantics TEXT DEFAULT 'quantity_delta'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_req_perm TEXT;
    v_canonical_hash TEXT;
    v_existing_movement RECORD;
    v_existing_zd RECORD;
    v_live_qty NUMERIC(14, 4);
    v_live_version INTEGER;
    v_prod_status TEXT;
    v_prod_uom TEXT;
    v_is_discrete_uom BOOLEAN;
    v_inventory_id UUID;
    v_current_stock NUMERIC(14, 4);
    v_raw_calc_delta NUMERIC;
    v_calc_delta NUMERIC(14, 4);
BEGIN
    -- Step 1: Caller Authentication Guard
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

    -- Step 2: Active Organization Guard
    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id AND is_active = TRUE) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ORGANIZATION_INACTIVE';
    END IF;

    -- Step 3: Active Membership Guard
    IF NOT EXISTS (
        SELECT 1 FROM public.organization_memberships
        WHERE organization_id = p_org_id AND user_id = auth.uid() AND status = 'active'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'MEMBERSHIP_INACTIVE';
    END IF;

    -- Step 4: Movement Type Scope Boundary (sale and return strictly reserved for Feature 005)
    IF p_movement_type IN ('sale', 'return') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0020', MESSAGE = 'INVALID_MOVEMENT_TYPE';
    END IF;

    -- Step 5: Granular Permission Check
    v_req_perm := CASE
        WHEN p_movement_type IN ('initial', 'restock') THEN 'inventory:receive'
        WHEN p_movement_type IN ('adjustment', 'damage', 'loss', 'internal_use') THEN 'inventory:adjust'
        ELSE NULL
    END;

    IF v_req_perm IS NULL OR NOT public.check_user_permission(p_org_id, auth.uid(), v_req_perm) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    -- Step 6: Explicit Quantity-Semantics Server-Side Validation
    IF p_quantity_semantics IS NULL
       OR p_quantity_semantics NOT IN (
           'quantity_delta',
           'target_physical_count'
       )
       OR (
           p_quantity_semantics = 'target_physical_count'
           AND p_movement_type <> 'adjustment'
       )
    THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0033',
            MESSAGE = 'INVALID_QUANTITY_SEMANTICS';
    END IF;

    -- Step 6b: Numeric Precision, System Bounds & Sign Invariants (Executed PRIOR to hashing
    --          so over-precision inputs like 10.12345 are never silently rounded by to_char)
    IF p_quantity IS NULL THEN
        IF p_quantity_semantics = 'target_physical_count' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0013', MESSAGE = 'NEGATIVE_QUANTITY_NOT_PERMITTED';
        ELSE
            RAISE EXCEPTION USING ERRCODE = 'P0014', MESSAGE = 'ZERO_QUANTITY_NOT_PERMITTED';
        END IF;
    END IF;

    IF trunc(p_quantity, 4) <> p_quantity THEN
        RAISE EXCEPTION USING ERRCODE = 'P0016', MESSAGE = 'DECIMAL_PRECISION_EXCEEDED';
    END IF;

    IF abs(p_quantity) > 999999999.9999 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0028', MESSAGE = 'QUANTITY_EXCEEDS_MAXIMUM';
    END IF;

    IF p_movement_type = 'restock' AND p_quantity <= 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0012', MESSAGE = 'NON_POSITIVE_QUANTITY';
    END IF;

    IF p_movement_type = 'initial' AND p_quantity < 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0013', MESSAGE = 'NEGATIVE_QUANTITY_NOT_PERMITTED';
    END IF;

    IF p_quantity_semantics = 'target_physical_count' AND p_quantity < 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0013', MESSAGE = 'NEGATIVE_QUANTITY_NOT_PERMITTED';
    END IF;

    IF p_quantity_semantics = 'quantity_delta' AND p_movement_type <> 'initial' AND p_quantity = 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0014', MESSAGE = 'ZERO_QUANTITY_NOT_PERMITTED';
    END IF;

    -- Step 7: Deterministic Canonical Payload Hashing (RFC 8259 escaping)
    v_canonical_hash := encode(
        sha256(
            convert_to(
                format(
                    '{"canonical_quantity":"%s","movement_type":"%s","organization_id":"%s","product_id":"%s","quantity_semantics":"%s","reason":%s,"reference_id":%s}',
                    to_char(p_quantity, 'FM9999999990.0000'),
                    p_movement_type,
                    p_org_id,
                    p_product_id,
                    p_quantity_semantics,
                    to_json(trim(p_reason))::text,
                    CASE WHEN p_reference_id IS NULL OR trim(p_reference_id) = '' THEN 'null' ELSE to_json(trim(p_reference_id))::text END
                ),
                'UTF8'
            )
        ),
        'hex'
    );

    -- Step 8: Transaction-Scoped Advisory Lock
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_idempotency_key::text));

        -- Step 9: Check Idempotency Stores (Executed BEFORE product lifecycle & UOM checks)
        -- Check 9a: Movement ledger
        SELECT * INTO v_existing_movement FROM public.stock_movements
        WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;

        IF FOUND THEN
            IF v_existing_movement.idempotency_payload_hash = v_canonical_hash THEN
                SELECT quantity, version INTO v_live_qty, v_live_version FROM public.inventory
                WHERE organization_id = p_org_id AND product_id = p_product_id;

                RETURN jsonb_build_object(
                    'success', true,
                    'is_replay', true,
                    'status', 'replayed',
                    'movement_id', v_existing_movement.id,
                    'product_id', p_product_id,
                    'quantity_before', to_char(v_existing_movement.quantity_before, 'FM9999999990.0000'),
                    'quantity_delta', to_char(v_existing_movement.quantity_delta, 'FM9999999990.0000'),
                    'quantity_after', to_char(v_existing_movement.quantity_after, 'FM9999999990.0000'),
                    'current_stock', to_char(v_live_qty, 'FM9999999990.0000'),
                    'version', v_live_version
                );
            ELSE
                RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
            END IF;
        END IF;

        -- Check 9b: Zero-delta stocktakes
        SELECT * INTO v_existing_zd FROM public.zero_delta_stocktakes
        WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;

        IF FOUND THEN
            IF v_existing_zd.idempotency_payload_hash = v_canonical_hash THEN
                SELECT quantity, version INTO v_live_qty, v_live_version FROM public.inventory
                WHERE organization_id = p_org_id AND product_id = p_product_id;

                RETURN jsonb_build_object(
                    'success', true,
                    'status', 'matched',
                    'is_replay', true,
                    'product_id', p_product_id,
                    'matched_quantity', to_char(v_existing_zd.target_physical_count, 'FM9999999990.0000'),
                    'current_stock', to_char(v_live_qty, 'FM9999999990.0000'),
                    'quantity_delta', '0.0000',
                    'version', v_live_version,
                    'message', 'Physical count matches recorded stock. No adjustment needed.'
                );
            ELSE
                RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
            END IF;
        END IF;
    END IF;

    -- ========================================================================
    -- FOR NEW MUTATIONS ONLY: Lifecycle, UOM, Row Locking, and Execution
    -- ========================================================================

    -- Step 10: Acquire Product Row Lock (FOR SHARE) & Retrieve Status + Authoritative UOM
    SELECT status, unit_of_measure INTO v_prod_status, v_prod_uom
    FROM public.products
    WHERE id = p_product_id AND organization_id = p_org_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'PRODUCT_NOT_FOUND';
    END IF;

    -- Step 11: Immediate Lifecycle Restrictions Prior to Delta Calculation
    IF v_prod_status = 'archived' THEN
        IF p_movement_type IN ('initial', 'restock', 'internal_use') THEN
            RAISE EXCEPTION USING ERRCODE = 'P0021', MESSAGE = 'PRODUCT_ARCHIVED_STOCK_FORBIDDEN';
        END IF;
    END IF;

    IF v_prod_status = 'inactive' THEN
        IF p_movement_type = 'restock' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0022', MESSAGE = 'PRODUCT_INACTIVE_RESTOCK_BLOCKED';
        ELSIF p_movement_type = 'internal_use' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0023', MESSAGE = 'PRODUCT_INACTIVE_INTERNAL_USE_BLOCKED';
        END IF;
    END IF;

    -- Step 11b: Authoritative Discrete Unit-of-Measure Integer Enforcement
    v_is_discrete_uom := (v_prod_uom IN ('piece', 'unit', 'box', 'pack', 'pair', 'set'));
    IF v_is_discrete_uom AND trunc(p_quantity) <> p_quantity THEN
        RAISE EXCEPTION USING ERRCODE = 'P0015', MESSAGE = 'INTEGER_QUANTITY_REQUIRED';
    END IF;

    -- Step 12: Acquire Inventory Row Lock (FOR UPDATE)
    IF p_quantity_semantics = 'target_physical_count' THEN
        SELECT id, quantity INTO v_inventory_id, v_current_stock FROM public.inventory
        WHERE organization_id = p_org_id AND product_id = p_product_id FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0004', MESSAGE = 'INVENTORY_NOT_FOUND';
        END IF;

        -- Step 13: Calculate Actual Signed Delta safely via unbounded NUMERIC before NUMERIC(14,4)
        v_raw_calc_delta := p_quantity - v_current_stock;
        IF abs(v_raw_calc_delta) > 999999999.9999 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0028', MESSAGE = 'QUANTITY_EXCEEDS_MAXIMUM';
        END IF;
        v_calc_delta := v_raw_calc_delta::NUMERIC(14, 4);
    ELSE
        v_calc_delta := p_quantity::NUMERIC(14, 4);
    END IF;

    -- Step 14: Archived Product Calculated-Delta Restriction
    IF v_prod_status = 'archived' THEN
        -- Positive delta adds inventory to archived product: strictly forbidden
        IF p_movement_type = 'adjustment' AND v_calc_delta > 0.0000 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0021', MESSAGE = 'PRODUCT_ARCHIVED_STOCK_FORBIDDEN';
        END IF;
        -- Note: Negative adjustments (v_calc_delta < 0), damage (< 0), and loss (< 0) are permitted write-offs
    END IF;

    -- Step 15: Handle Zero-Delta Stocktakes (No movement row inserted)
    IF p_quantity_semantics = 'target_physical_count' AND v_calc_delta = 0.0000 THEN
        IF p_idempotency_key IS NOT NULL THEN
            INSERT INTO public.zero_delta_stocktakes (
                organization_id,
                product_id,
                idempotency_key,
                idempotency_payload_hash,
                target_physical_count,
                created_by
            ) VALUES (
                p_org_id,
                p_product_id,
                p_idempotency_key,
                v_canonical_hash,
                p_quantity,
                auth.uid()
            );
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'status', 'matched',
            'is_replay', false,
            'product_id', p_product_id,
            'matched_quantity', to_char(p_quantity, 'FM9999999990.0000'),
            'current_stock', to_char(v_current_stock, 'FM9999999990.0000'),
            'quantity_delta', '0.0000',
            'message', 'Physical count matches recorded stock. No adjustment needed.'
        );
    END IF;

    -- Step 16: Delegate Valid Non-Zero Mutation to Layer 1 Core
    RETURN public._execute_inventory_mutation_core(
        p_org_id := p_org_id,
        p_product_id := p_product_id,
        p_movement_type := p_movement_type,
        p_quantity_delta := v_calc_delta,
        p_reason := trim(p_reason),
        p_reference_id := NULLIF(trim(p_reference_id), ''),
        p_idempotency_key := p_idempotency_key,
        p_idempotency_payload_hash := CASE WHEN p_idempotency_key IS NULL THEN NULL ELSE v_canonical_hash END,
        p_created_by := auth.uid(),
        p_expected_version := p_expected_version
    );
END;
$$;

-- ============================================================================
-- 3. Ownership & Parameter-Qualified Privilege Preservation
-- ============================================================================

ALTER FUNCTION public._execute_inventory_mutation_core(
    UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, TEXT, UUID, INTEGER
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public._execute_inventory_mutation_core(
    UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, TEXT, UUID, INTEGER
) FROM PUBLIC, authenticated, anon;

GRANT EXECUTE ON FUNCTION public._execute_inventory_mutation_core(
    UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, TEXT, UUID, INTEGER
) TO postgres;

ALTER FUNCTION public.execute_stock_movement(
    UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, INTEGER, TEXT
) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.execute_stock_movement(
    UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, INTEGER, TEXT
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.execute_stock_movement(
    UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, INTEGER, TEXT
) FROM anon, PUBLIC;

