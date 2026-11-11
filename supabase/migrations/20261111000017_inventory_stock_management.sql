-- ============================================================================
-- Migration: 20261111000017_inventory_stock_management.sql
-- Feature: 004 — Inventory & Stock Management
-- Description: Authoritative inventory balance table, immutable movement ledger,
--              isolated cost snapshots, zero-delta stocktake idempotency store,
--              and two-layer security definer mutation engine.
-- Compliance: BizFlow AI Constitution v1.1.0, PostgreSQL 15+ / 17+
-- ============================================================================

-- ============================================================================
-- 1. Tables and Constraints
-- ============================================================================

-- 1.1 Table: public.inventory (Authoritative Materialized Stock Balance)
CREATE TABLE public.inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    quantity NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
    reorder_point NUMERIC(14, 4) DEFAULT NULL,
    reorder_quantity NUMERIC(14, 4) DEFAULT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    -- Constraints
    CONSTRAINT uq_inventory_org_product UNIQUE (organization_id, product_id),
    CONSTRAINT uq_inventory_org_id_product UNIQUE (organization_id, id, product_id),
    CONSTRAINT chk_inventory_quantity_non_negative CHECK (quantity >= 0.0000),
    CONSTRAINT chk_inventory_reorder_point_non_negative CHECK (reorder_point IS NULL OR reorder_point >= 0.0000),
    CONSTRAINT chk_inventory_reorder_quantity_positive CHECK (reorder_quantity IS NULL OR reorder_quantity > 0.0000),
    CONSTRAINT chk_inventory_version_positive CHECK (version > 0)
);

-- 1.2 Table: public.stock_movements (Immutable Historical Audit Ledger)
CREATE TABLE public.stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    product_id UUID NOT NULL,
    inventory_id UUID NOT NULL,
    movement_type TEXT NOT NULL,
    quantity_before NUMERIC(14, 4) NOT NULL,
    quantity_delta NUMERIC(14, 4) NOT NULL,
    quantity_after NUMERIC(14, 4) NOT NULL,
    reason TEXT NOT NULL,
    reference_id TEXT DEFAULT NULL,
    idempotency_key UUID DEFAULT NULL,
    idempotency_payload_hash TEXT DEFAULT NULL,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    -- Composite Foreign Keys with Deferrable Commit Checking
    CONSTRAINT fk_movements_inventory_composite FOREIGN KEY (organization_id, inventory_id, product_id)
        REFERENCES public.inventory (organization_id, id, product_id)
        ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,

    CONSTRAINT fk_movements_org_product FOREIGN KEY (organization_id, product_id)
        REFERENCES public.products (organization_id, id)
        ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,

    -- Enum Validation
    CONSTRAINT chk_movement_type_valid CHECK (
        movement_type IN (
            'initial', 'restock', 'adjustment', 'damage',
            'loss', 'internal_use', 'sale', 'return'
        )
    ),

    -- Mathematical Ledger Consistency
    CONSTRAINT chk_movement_math_integrity CHECK (quantity_after = quantity_before + quantity_delta),
    CONSTRAINT chk_movement_after_non_negative CHECK (quantity_after >= 0.0000),

    -- Movement Sign Direction Integrity
    CONSTRAINT chk_movement_type_sign CHECK (
        (movement_type = 'initial' AND quantity_delta >= 0.0000) OR
        (movement_type = 'restock' AND quantity_delta > 0.0000) OR
        (movement_type = 'adjustment' AND quantity_delta <> 0.0000) OR
        (movement_type IN ('damage', 'loss', 'internal_use', 'sale') AND quantity_delta < 0.0000) OR
        (movement_type = 'return' AND quantity_delta > 0.0000)
    ),

    -- Exact Zero-Initial Exception Rule
    CONSTRAINT chk_movement_initial_before_zero CHECK (
        movement_type <> 'initial' OR quantity_before = 0.0000
    ),
    CONSTRAINT chk_movement_delta_zero_rule CHECK (
        (movement_type = 'initial' AND quantity_before = 0.0000 AND quantity_delta = 0.0000) OR
        (quantity_delta <> 0.0000)
    ),

    -- String Bounds
    CONSTRAINT chk_movement_reason_length CHECK (char_length(trim(reason)) BETWEEN 3 AND 250),
    CONSTRAINT chk_movement_reference_length CHECK (reference_id IS NULL OR char_length(trim(reference_id)) <= 100),

    -- Idempotency Pair Integrity
    CONSTRAINT chk_movement_idempotency_pair CHECK (
        (idempotency_key IS NULL AND idempotency_payload_hash IS NULL) OR
        (idempotency_key IS NOT NULL AND idempotency_payload_hash IS NOT NULL)
    )
);

-- 1.3 Table: public.stock_movement_costs (Protected Acquisition Costs)
CREATE TABLE public.stock_movement_costs (
    movement_id UUID PRIMARY KEY REFERENCES public.stock_movements(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    unit_cost NUMERIC(14, 4) NOT NULL CHECK (unit_cost >= 0.0000),
    currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 1.4 Table: public.zero_delta_stocktakes (Zero-Delta Stocktake Idempotency Persistence)
CREATE TABLE public.zero_delta_stocktakes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    idempotency_key UUID NOT NULL,
    idempotency_payload_hash TEXT NOT NULL,
    target_physical_count NUMERIC(14, 4) NOT NULL CHECK (target_physical_count >= 0.0000),
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT uq_zero_delta_stocktake_idempotency UNIQUE (organization_id, idempotency_key)
);

-- ============================================================================
-- 2. Indexes
-- ============================================================================

-- Inventory Indexes
CREATE INDEX idx_inventory_org_product ON public.inventory (organization_id, product_id);
CREATE INDEX idx_inventory_reorder_alert ON public.inventory (organization_id, quantity, reorder_point)
    WHERE reorder_point IS NOT NULL;

-- Movement Partial Unique Indexes
CREATE UNIQUE INDEX uq_stock_movements_initial_per_product
    ON public.stock_movements (organization_id, product_id)
    WHERE movement_type = 'initial';

CREATE UNIQUE INDEX uq_movements_org_idempotency
    ON public.stock_movements (organization_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- Movement Query Performance Indexes
CREATE INDEX idx_stock_movements_org_created ON public.stock_movements (organization_id, created_at DESC, id DESC);
CREATE INDEX idx_stock_movements_org_product ON public.stock_movements (organization_id, product_id, created_at DESC);
CREATE INDEX idx_stock_movements_inventory ON public.stock_movements (organization_id, inventory_id);
CREATE INDEX idx_stock_movements_org_type ON public.stock_movements (organization_id, movement_type, created_at DESC);

-- Cost & Zero-Delta Indexes
CREATE INDEX idx_stock_movement_costs_org ON public.stock_movement_costs (organization_id);
CREATE INDEX idx_zero_delta_stocktakes_org ON public.zero_delta_stocktakes (organization_id, created_at DESC);

-- ============================================================================
-- 3. Row-Level Security (RLS) & Access Policies
-- ============================================================================

ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory FORCE ROW LEVEL SECURITY;

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements FORCE ROW LEVEL SECURITY;

ALTER TABLE public.stock_movement_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movement_costs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.zero_delta_stocktakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zero_delta_stocktakes FORCE ROW LEVEL SECURITY;

-- 3.1 Inventory Read Policy (inventory:read)
CREATE POLICY "inventory_select_policy" ON public.inventory
    FOR SELECT TO authenticated
    USING (public.check_user_permission(organization_id, auth.uid(), 'inventory:read'));

-- 3.2 Movement History Read Policy (inventory:history)
CREATE POLICY "stock_movements_select_policy" ON public.stock_movements
    FOR SELECT TO authenticated
    USING (public.check_user_permission(organization_id, auth.uid(), 'inventory:history'));

-- 3.3 Movement Cost Read Policy (Dual Permission: inventory:read_valuation AND products:read_cost)
CREATE POLICY "stock_movement_costs_select_policy" ON public.stock_movement_costs
    FOR SELECT TO authenticated
    USING (
        public.check_user_permission(organization_id, auth.uid(), 'inventory:read_valuation')
        AND
        public.check_user_permission(organization_id, auth.uid(), 'products:read_cost')
    );

-- 3.4 Zero-Delta Stocktakes Read Policy (inventory:history)
CREATE POLICY "zero_delta_stocktakes_select_policy" ON public.zero_delta_stocktakes
    FOR SELECT TO authenticated
    USING (public.check_user_permission(organization_id, auth.uid(), 'inventory:history'));

-- 3.5 Absolute Denial of Direct Client Mutations
CREATE POLICY "inventory_deny_mutation" ON public.inventory
    FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY "stock_movements_deny_mutation" ON public.stock_movements
    FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY "stock_movement_costs_deny_mutation" ON public.stock_movement_costs
    FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY "zero_delta_stocktakes_deny_mutation" ON public.zero_delta_stocktakes
    FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ============================================================================
-- 4. Permission Catalog & Role Mappings
-- ============================================================================

INSERT INTO public.permissions (id, category, description) VALUES
    ('inventory:read', 'inventory', 'View inventory balances, stock status, and overview metrics'),
    ('inventory:read_valuation', 'inventory', 'View inventory valuation totals, unit costs, and financial value'),
    ('inventory:receive', 'inventory', 'Record initial opening stock and inbound restock deliveries'),
    ('inventory:adjust', 'inventory', 'Record stock adjustments, write-offs, internal use, and reorder thresholds'),
    ('inventory:history', 'inventory', 'View full audit ledger history of inventory movements')
ON CONFLICT (id) DO UPDATE SET
    category = EXCLUDED.category,
    description = EXCLUDED.description;

INSERT INTO public.role_permissions (role, permission_id) VALUES
    ('admin', 'inventory:read'),
    ('admin', 'inventory:read_valuation'),
    ('admin', 'inventory:receive'),
    ('admin', 'inventory:adjust'),
    ('admin', 'inventory:history'),
    ('manager', 'inventory:read'),
    ('manager', 'inventory:read_valuation'),
    ('manager', 'inventory:receive'),
    ('manager', 'inventory:adjust'),
    ('manager', 'inventory:history'),
    ('cashier', 'inventory:read')
ON CONFLICT (role, permission_id) DO NOTHING;

-- ============================================================================
-- 5. Inventory Anchor Provisioning Trigger & Backfill
-- ============================================================================

CREATE OR REPLACE FUNCTION public._provision_product_inventory_anchor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    INSERT INTO public.inventory (
        organization_id,
        product_id,
        quantity,
        version,
        created_at,
        updated_at
    ) VALUES (
        NEW.organization_id,
        NEW.id,
        0.0000,
        1,
        clock_timestamp(),
        clock_timestamp()
    )
    ON CONFLICT (organization_id, product_id) DO NOTHING;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._provision_product_inventory_anchor() FROM PUBLIC, authenticated, anon;

DROP TRIGGER IF EXISTS trg_provision_inventory_anchor ON public.products;
CREATE TRIGGER trg_provision_inventory_anchor
    AFTER INSERT ON public.products
    FOR EACH ROW
    EXECUTE FUNCTION public._provision_product_inventory_anchor();

-- One-time backward-compatible backfill for pre-existing products
INSERT INTO public.inventory (
    organization_id,
    product_id,
    quantity,
    version,
    created_at,
    updated_at
)
SELECT
    p.organization_id,
    p.id,
    0.0000,
    1,
    clock_timestamp(),
    clock_timestamp()
FROM public.products p
WHERE NOT EXISTS (
    SELECT 1 FROM public.inventory i
    WHERE i.organization_id = p.organization_id AND i.product_id = p.id
)
ON CONFLICT (organization_id, product_id) DO NOTHING;

-- ============================================================================
-- 6. Layer 1 Internal Mutation Core (_execute_inventory_mutation_core)
-- ============================================================================

-- Parameter-qualified cleanup of any legacy or overloaded signatures
DROP FUNCTION IF EXISTS public.execute_stock_movement(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, INTEGER);
DROP FUNCTION IF EXISTS public.execute_stock_movement(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public._execute_inventory_mutation_core(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, TEXT, UUID, INTEGER);
DROP FUNCTION IF EXISTS public.update_inventory_thresholds(UUID, UUID, NUMERIC, NUMERIC, INTEGER);

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
    v_inventory_id UUID;
    v_current_qty NUMERIC(14, 4);
    v_current_version INTEGER;
    v_resulting_qty NUMERIC(14, 4);
    v_movement_id UUID;
    v_unit_cost NUMERIC(14, 4);
    v_currency TEXT;
BEGIN
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

    -- 3. Negative Stock Guard
    v_resulting_qty := v_current_qty + p_quantity_delta;
    IF v_resulting_qty < 0.0000 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0011', MESSAGE = 'INSUFFICIENT_STOCK';
    END IF;

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
-- 7. Layer 2 Public Mutation RPC Wrapper (execute_stock_movement)
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
    v_prod_status TEXT;
    v_inventory_id UUID;
    v_current_stock NUMERIC(14, 4);
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

        -- Step 9: Check Idempotency Stores (Executed BEFORE product lifecycle checks)
        -- Check 9a: Movement ledger
        SELECT * INTO v_existing_movement FROM public.stock_movements
        WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;

        IF FOUND THEN
            IF v_existing_movement.idempotency_payload_hash = v_canonical_hash THEN
                SELECT quantity INTO v_live_qty FROM public.inventory
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
                    'current_stock', to_char(v_live_qty, 'FM9999999990.0000')
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
                SELECT quantity INTO v_live_qty FROM public.inventory
                WHERE organization_id = p_org_id AND product_id = p_product_id;

                RETURN jsonb_build_object(
                    'success', true,
                    'status', 'matched',
                    'is_replay', true,
                    'product_id', p_product_id,
                    'matched_quantity', to_char(v_existing_zd.target_physical_count, 'FM9999999990.0000'),
                    'current_stock', to_char(v_live_qty, 'FM9999999990.0000'),
                    'quantity_delta', '0.0000',
                    'message', 'Physical count matches recorded stock. No adjustment needed.'
                );
            ELSE
                RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
            END IF;
        END IF;
    END IF;

    -- ========================================================================
    -- FOR NEW MUTATIONS ONLY: Lifecycle, Row Locking, and Execution
    -- ========================================================================

    -- Step 10: Acquire Product Row Lock (FOR SHARE)
    SELECT status INTO v_prod_status
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

    -- Step 12: Acquire Inventory Row Lock (FOR UPDATE)
    SELECT id, quantity INTO v_inventory_id, v_current_stock
    FROM public.inventory
    WHERE organization_id = p_org_id AND product_id = p_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0004', MESSAGE = 'INVENTORY_NOT_FOUND';
    END IF;

    -- Step 13: Calculate Actual Signed Delta
    IF p_quantity_semantics = 'target_physical_count' THEN
        v_calc_delta := p_quantity - v_current_stock;
    ELSE
        v_calc_delta := p_quantity;
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
-- 8. Reorder Threshold RPC (update_inventory_thresholds)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_inventory_thresholds(
    p_org_id UUID,
    p_product_id UUID,
    p_reorder_point NUMERIC,
    p_reorder_quantity NUMERIC,
    p_expected_version INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_current_version INTEGER;
BEGIN
    -- 1. Caller Authentication
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

    -- 2. Active Organization Status
    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id AND is_active = TRUE) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ORGANIZATION_INACTIVE';
    END IF;

    -- 3. Active Membership Status
    IF NOT EXISTS (
        SELECT 1 FROM public.organization_memberships
        WHERE organization_id = p_org_id AND user_id = auth.uid() AND status = 'active'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'MEMBERSHIP_INACTIVE';
    END IF;

    -- 4. Permission Check
    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'inventory:adjust') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    -- 5. Range Bounds Checks
    IF p_reorder_point IS NOT NULL AND p_reorder_point < 0.0000 THEN
        RAISE EXCEPTION USING ERRCODE = '22003', MESSAGE = 'REORDER_POINT_CANNOT_BE_NEGATIVE';
    END IF;

    IF p_reorder_quantity IS NOT NULL AND p_reorder_quantity <= 0.0000 THEN
        RAISE EXCEPTION USING ERRCODE = '22003', MESSAGE = 'REORDER_QUANTITY_MUST_BE_POSITIVE';
    END IF;

    -- 6. Lock and Validate Target Inventory Row
    SELECT version INTO v_current_version FROM public.inventory
    WHERE organization_id = p_org_id AND product_id = p_product_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0004', MESSAGE = 'INVENTORY_NOT_FOUND';
    END IF;

    -- 7. Optimistic Concurrency Control Check
    IF p_expected_version IS NOT NULL AND v_current_version <> p_expected_version THEN
        RAISE EXCEPTION USING ERRCODE = 'P0027', MESSAGE = 'STALE_VERSION_CONFLICT';
    END IF;

    -- 8. Atomic Threshold Update
    UPDATE public.inventory SET
        reorder_point = p_reorder_point,
        reorder_quantity = p_reorder_quantity,
        version = version + 1,
        updated_at = clock_timestamp()
    WHERE organization_id = p_org_id AND product_id = p_product_id;

    RETURN jsonb_build_object(
        'success', true,
        'product_id', p_product_id,
        'reorder_point', p_reorder_point,
        'reorder_quantity', p_reorder_quantity,
        'version', v_current_version + 1
    );
END;
$$;

-- ============================================================================
-- 9. Overload Cleanup, Function Grants & Revokes
-- ============================================================================

-- Exact Layer 1 Grants & Revokes
-- Absolute denial of execution to PUBLIC (OID 0), authenticated, and anon
REVOKE ALL ON FUNCTION public._execute_inventory_mutation_core(
    UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, TEXT, UUID, INTEGER
) FROM PUBLIC, authenticated, anon;

-- Ensure function owner retains execution privilege for SECURITY DEFINER wrapper
GRANT EXECUTE ON FUNCTION public._execute_inventory_mutation_core(
    UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, TEXT, UUID, INTEGER
) TO postgres;

-- Exact Layer 2 Grants & Revokes
GRANT EXECUTE ON FUNCTION public.execute_stock_movement(
    UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, INTEGER, TEXT
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.execute_stock_movement(
    UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, INTEGER, TEXT
) FROM anon, PUBLIC;

-- Exact Threshold RPC Grants & Revokes
GRANT EXECUTE ON FUNCTION public.update_inventory_thresholds(
    UUID, UUID, NUMERIC, NUMERIC, INTEGER
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_inventory_thresholds(
    UUID, UUID, NUMERIC, NUMERIC, INTEGER
) FROM anon, PUBLIC;
