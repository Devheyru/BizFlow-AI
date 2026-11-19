-- ============================================================================
-- Migration: 20261117000021_customers_sales_schema.sql
-- Feature: 005 — Customers & Sales (Phase 1: Database Foundation)
-- Description: 9-table schema foundation, RLS policies, column-level security,
--              triggers, permission registrations, and 11 SECURITY DEFINER RPCs.
-- Compliance: BizFlow AI Constitution v1.1.0, PostgreSQL 15+ / 17+
-- ============================================================================

-- ============================================================================
-- 1. Tables and Constraints (T002–T010)
-- ============================================================================

-- 1.1 Table: public.customers (T002)
CREATE TABLE public.customers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name            TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 255),
    phone           TEXT NULL CHECK (phone IS NULL OR phone ~ '^\+[1-9]\d{6,14}$'),
    email           TEXT NULL CHECK (email IS NULL OR email ~ '^.+@.+$'),
    notes           TEXT NULL CHECK (notes IS NULL OR length(notes) <= 1000),
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'archived')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_customers_org_id UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX uq_customers_org_phone_active
    ON public.customers (organization_id, phone)
    WHERE status <> 'archived' AND phone IS NOT NULL;

CREATE UNIQUE INDEX uq_customers_org_email_active
    ON public.customers (organization_id, email)
    WHERE status <> 'archived' AND email IS NOT NULL;

CREATE INDEX idx_customers_org_status
    ON public.customers (organization_id, status);

CREATE INDEX idx_customers_org_name
    ON public.customers (organization_id, lower(name) text_pattern_ops);


-- 1.2 Table: public.organization_tax_settings (T003)
CREATE TABLE public.organization_tax_settings (
    organization_id  UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    tax_name         TEXT NOT NULL DEFAULT 'VAT'
                     CHECK (length(trim(tax_name)) >= 1 AND length(trim(tax_name)) <= 100),
    default_tax_rate NUMERIC(6, 4) NOT NULL DEFAULT 0.0000
                     CHECK (default_tax_rate >= 0.0000 AND default_tax_rate <= 100.0000),
    is_tax_inclusive BOOLEAN NOT NULL DEFAULT false,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT
);


-- 1.3 Table: public.sale_sequences (T004)
CREATE TABLE public.sale_sequences (
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    sequence_type   TEXT NOT NULL CHECK (sequence_type IN ('sale', 'return')),
    date_key        DATE NOT NULL,
    last_number     INTEGER NOT NULL DEFAULT 0 CHECK (last_number >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, sequence_type, date_key)
);


-- 1.4 Table: public.sales (T005)
CREATE TABLE public.sales (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    sale_number           TEXT NOT NULL,
    customer_id           UUID NULL,
    created_by            UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    subtotal              NUMERIC(14, 4) NOT NULL CHECK (subtotal >= 0),
    order_discount_amount NUMERIC(14, 4) NOT NULL DEFAULT 0.0000 CHECK (order_discount_amount >= 0),
    is_tax_inclusive      BOOLEAN NOT NULL DEFAULT false,
    tax_rate              NUMERIC(6, 4) NOT NULL DEFAULT 0.0000 CHECK (tax_rate >= 0),
    tax_name              TEXT NOT NULL DEFAULT 'None',
    tax_amount            NUMERIC(14, 4) NOT NULL DEFAULT 0.0000 CHECK (tax_amount >= 0),
    total_amount          NUMERIC(14, 4) NOT NULL CHECK (total_amount >= 0),
    currency              TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    status                TEXT NOT NULL DEFAULT 'completed'
                          CHECK (status IN ('completed', 'voided', 'partially_returned', 'returned')),
    payment_status        TEXT NOT NULL DEFAULT 'paid'
                          CHECK (payment_status IN ('paid', 'partially_refunded', 'refunded')),
    idempotency_key       UUID NOT NULL,
    idempotency_hash      TEXT NOT NULL,
    void_idempotency_key  UUID NULL,
    void_idempotency_hash TEXT NULL,
    voided_at             TIMESTAMPTZ NULL,
    voided_by             UUID NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    void_reason           TEXT NULL,
    notes                 TEXT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_sales_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_sales_org_customer FOREIGN KEY (organization_id, customer_id)
        REFERENCES public.customers (organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT uq_sales_org_sale_number UNIQUE (organization_id, sale_number),
    CONSTRAINT uq_sales_org_idempotency UNIQUE (organization_id, idempotency_key)
);

CREATE UNIQUE INDEX uq_sales_org_void_idempotency
    ON public.sales (organization_id, void_idempotency_key)
    WHERE void_idempotency_key IS NOT NULL;

CREATE INDEX idx_sales_org_status
    ON public.sales (organization_id, status);

CREATE INDEX idx_sales_org_created
    ON public.sales (organization_id, created_at DESC);

CREATE INDEX idx_sales_org_customer
    ON public.sales (organization_id, customer_id)
    WHERE customer_id IS NOT NULL;

CREATE INDEX idx_sales_org_created_by
    ON public.sales (organization_id, created_by);


-- 1.5 Table: public.sale_items (T006)
CREATE TABLE public.sale_items (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      UUID NOT NULL,
    sale_id              UUID NOT NULL,
    product_id           UUID NOT NULL,
    quantity             NUMERIC(14, 4) NOT NULL CHECK (quantity > 0),
    unit_price           NUMERIC(14, 4) NOT NULL CHECK (unit_price >= 0),
    unit_cost            NUMERIC(14, 4) NULL,
    line_discount_amount NUMERIC(14, 4) NOT NULL DEFAULT 0.0000 CHECK (line_discount_amount >= 0),
    allocated_order_disc NUMERIC(14, 4) NOT NULL DEFAULT 0.0000 CHECK (allocated_order_disc >= 0),
    taxable_amount       NUMERIC(14, 4) NOT NULL CHECK (taxable_amount >= 0),
    allocated_tax_amount NUMERIC(14, 4) NOT NULL CHECK (allocated_tax_amount >= 0),
    total_price          NUMERIC(14, 4) NOT NULL CHECK (total_price >= 0),
    movement_id          UUID NOT NULL REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_sale_items_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_sale_items_org_sale_item_prod UNIQUE (organization_id, sale_id, id, product_id),
    CONSTRAINT fk_sale_items_org_sale FOREIGN KEY (organization_id, sale_id)
        REFERENCES public.sales (organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_sale_items_org_product FOREIGN KEY (organization_id, product_id)
        REFERENCES public.products (organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT uq_sale_items_sale_product UNIQUE (sale_id, product_id)
);

CREATE INDEX idx_sale_items_sale_id
    ON public.sale_items (sale_id);

CREATE INDEX idx_sale_items_product_id
    ON public.sale_items (organization_id, product_id);


-- 1.6 Table: public.payments (T007)
CREATE TABLE public.payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    sale_id         UUID NOT NULL,
    payment_method  TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'bank_transfer', 'other')),
    amount          NUMERIC(14, 4) NOT NULL CHECK (amount > 0),
    amount_tendered NUMERIC(14, 4) NULL CHECK (amount_tendered IS NULL OR amount_tendered >= 0),
    change_due      NUMERIC(14, 4) NULL CHECK (change_due IS NULL OR change_due >= 0),
    reference_no    TEXT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_payments_org_sale FOREIGN KEY (organization_id, sale_id)
        REFERENCES public.sales (organization_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX uq_payments_org_method_ref
    ON public.payments (organization_id, payment_method, reference_no)
    WHERE reference_no IS NOT NULL;

CREATE INDEX idx_payments_sale_id
    ON public.payments (sale_id);


-- 1.7 Table: public.sale_returns (T008)
CREATE TABLE public.sale_returns (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    sale_id             UUID NOT NULL,
    return_number       TEXT NOT NULL,
    reason              TEXT NOT NULL CHECK (length(trim(reason)) >= 3 AND length(trim(reason)) <= 255),
    total_refund_amount NUMERIC(14, 4) NOT NULL CHECK (total_refund_amount >= 0),
    idempotency_key     UUID NOT NULL,
    idempotency_hash    TEXT NOT NULL,
    created_by          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_sale_returns_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_sale_returns_org_sale_id UNIQUE (organization_id, sale_id, id),
    CONSTRAINT fk_sale_returns_org_sale FOREIGN KEY (organization_id, sale_id)
        REFERENCES public.sales (organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT uq_sale_returns_org_return_number UNIQUE (organization_id, return_number),
    CONSTRAINT uq_sale_returns_org_idempotency UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX idx_sale_returns_sale_id
    ON public.sale_returns (organization_id, sale_id);


-- 1.8 Table: public.sale_return_items (T009)
CREATE TABLE public.sale_return_items (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      UUID NOT NULL,
    return_id            UUID NOT NULL,
    sale_id              UUID NOT NULL,
    sale_item_id         UUID NOT NULL,
    product_id           UUID NOT NULL,
    quantity             NUMERIC(14, 4) NOT NULL CHECK (quantity > 0),
    refund_amount        NUMERIC(14, 4) NOT NULL CHECK (refund_amount >= 0),
    restock_to_inventory BOOLEAN NOT NULL,
    movement_id          UUID NULL REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_return_items_org_return_sale FOREIGN KEY (organization_id, sale_id, return_id)
        REFERENCES public.sale_returns (organization_id, sale_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_return_items_org_sale_item_prod FOREIGN KEY (organization_id, sale_id, sale_item_id, product_id)
        REFERENCES public.sale_items (organization_id, sale_id, id, product_id) ON DELETE RESTRICT,
    CONSTRAINT uq_return_items_return_sale_item UNIQUE (return_id, sale_item_id)
);

CREATE INDEX idx_return_items_sale_item
    ON public.sale_return_items (sale_item_id);


-- 1.9 Table: public.refunds (T010)
CREATE TABLE public.refunds (
    id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id               UUID NOT NULL,
    sale_id                       UUID NOT NULL,
    return_id                     UUID NULL,
    parent_refund_id              UUID NULL,
    obligation_refund_id          UUID NOT NULL,
    refund_method                 TEXT NOT NULL CHECK (refund_method IN ('cash', 'card', 'bank_transfer', 'other')),
    amount                        NUMERIC(14, 4) NOT NULL CHECK (amount > 0),
    reference_no                  TEXT NULL,
    status                        TEXT NOT NULL CHECK (status IN ('completed', 'pending', 'failed')),
    reason                        TEXT NOT NULL,
    processed_by                  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    idempotency_key               UUID NULL,
    idempotency_hash              TEXT NULL,
    confirmation_idempotency_key  UUID NULL,
    confirmation_idempotency_hash TEXT NULL,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_refunds_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_refunds_org_sale_id UNIQUE (organization_id, sale_id, id),
    CONSTRAINT fk_refunds_org_sale FOREIGN KEY (organization_id, sale_id)
        REFERENCES public.sales (organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_refunds_org_sale_return FOREIGN KEY (organization_id, sale_id, return_id)
        REFERENCES public.sale_returns (organization_id, sale_id, id),
    CONSTRAINT fk_refunds_org_sale_parent FOREIGN KEY (organization_id, sale_id, parent_refund_id)
        REFERENCES public.refunds (organization_id, sale_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_refunds_org_obligation FOREIGN KEY (organization_id, obligation_refund_id)
        REFERENCES public.refunds (organization_id, id)
        ON DELETE RESTRICT
        DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX uq_refunds_org_obligation_active
    ON public.refunds (organization_id, obligation_refund_id)
    WHERE status IN ('pending', 'completed');

CREATE UNIQUE INDEX uq_refunds_org_confirmation_key
    ON public.refunds (organization_id, confirmation_idempotency_key)
    WHERE confirmation_idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX uq_refunds_org_idempotency_key
    ON public.refunds (organization_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_refunds_sale_id
    ON public.refunds (organization_id, sale_id);

CREATE INDEX idx_refunds_obligation
    ON public.refunds (organization_id, obligation_refund_id);

CREATE INDEX idx_refunds_status
    ON public.refunds (organization_id, status);


-- ============================================================================
-- 2. Row Level Security & Policies (T011–T013)
-- ============================================================================

-- 2.1 Enable and Force RLS on all 9 tables (T011)
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;

ALTER TABLE public.organization_tax_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_tax_settings FORCE ROW LEVEL SECURITY;

ALTER TABLE public.sale_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_sequences FORCE ROW LEVEL SECURITY;

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales FORCE ROW LEVEL SECURITY;

ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items FORCE ROW LEVEL SECURITY;

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;

ALTER TABLE public.sale_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_returns FORCE ROW LEVEL SECURITY;

ALTER TABLE public.sale_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_return_items FORCE ROW LEVEL SECURITY;

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refunds FORCE ROW LEVEL SECURITY;


-- 2.2 Deny-all DML policies for authenticated role on all 9 tables (T013)
CREATE POLICY deny_dml_customers ON public.customers
    FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY deny_dml_tax_settings ON public.organization_tax_settings
    FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY deny_all_sale_sequences ON public.sale_sequences
    FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY deny_dml_sales ON public.sales
    FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY deny_dml_sale_items ON public.sale_items
    FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY deny_dml_payments ON public.payments
    FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY deny_dml_sale_returns ON public.sale_returns
    FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY deny_dml_sale_return_items ON public.sale_return_items
    FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY deny_dml_refunds ON public.refunds
    FOR ALL TO authenticated USING (false) WITH CHECK (false);


-- 2.3 Permissive SELECT policies using check_user_permission (T012)
CREATE POLICY select_customers ON public.customers
    FOR SELECT TO authenticated
    USING (public.check_user_permission(organization_id, auth.uid(), 'customers:read'));

CREATE POLICY select_tax_settings ON public.organization_tax_settings
    FOR SELECT TO authenticated
    USING (
        public.check_user_permission(organization_id, auth.uid(), 'sales:read')
        OR public.is_org_member(organization_id)
    );

CREATE POLICY select_sales ON public.sales
    FOR SELECT TO authenticated
    USING (public.check_user_permission(organization_id, auth.uid(), 'sales:read'));

CREATE POLICY select_sale_items ON public.sale_items
    FOR SELECT TO authenticated
    USING (public.check_user_permission(organization_id, auth.uid(), 'sales:read'));

CREATE POLICY select_payments ON public.payments
    FOR SELECT TO authenticated
    USING (public.check_user_permission(organization_id, auth.uid(), 'payments:read'));

CREATE POLICY select_sale_returns ON public.sale_returns
    FOR SELECT TO authenticated
    USING (public.check_user_permission(organization_id, auth.uid(), 'returns:read'));

CREATE POLICY select_sale_return_items ON public.sale_return_items
    FOR SELECT TO authenticated
    USING (public.check_user_permission(organization_id, auth.uid(), 'returns:read'));

CREATE POLICY select_refunds ON public.refunds
    FOR SELECT TO authenticated
    USING (public.check_user_permission(organization_id, auth.uid(), 'refunds:read'));


-- ============================================================================
-- 3. Column-Level Security & Grants on sale_items (T014)
-- ============================================================================

-- Grant table-level SELECT on tables intended for authenticated direct read
GRANT SELECT ON TABLE public.customers TO authenticated;
GRANT SELECT ON TABLE public.organization_tax_settings TO authenticated;
GRANT SELECT ON TABLE public.sales TO authenticated;
GRANT SELECT ON TABLE public.payments TO authenticated;
GRANT SELECT ON TABLE public.sale_returns TO authenticated;
GRANT SELECT ON TABLE public.sale_return_items TO authenticated;
GRANT SELECT ON TABLE public.refunds TO authenticated;

-- For sale_items: Revoke table-level SELECT from authenticated, anon, PUBLIC
REVOKE SELECT ON TABLE public.sale_items FROM authenticated, anon, PUBLIC;

-- Grant column-level SELECT strictly on safe non-cost columns (unit_cost omitted)
GRANT SELECT (
    id,
    organization_id,
    sale_id,
    product_id,
    quantity,
    unit_price,
    line_discount_amount,
    allocated_order_disc,
    taxable_amount,
    allocated_tax_amount,
    total_price,
    movement_id,
    created_at
) ON TABLE public.sale_items TO authenticated;


-- ============================================================================
-- 4. Triggers (T015)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    NEW.updated_at = clock_timestamp();
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_updated_at() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.handle_updated_at() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_updated_at() TO authenticated;

CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON public.customers
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_tax_settings_updated_at
    BEFORE UPDATE ON public.organization_tax_settings
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_sales_updated_at
    BEFORE UPDATE ON public.sales
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_refunds_updated_at
    BEFORE UPDATE ON public.refunds
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_sale_sequences_updated_at
    BEFORE UPDATE ON public.sale_sequences
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


-- ============================================================================
-- 5. Permission Registrations & Role-Permission Seed Data (T016)
-- ============================================================================

-- Allow snake_case resource prefixes (e.g., tax_settings:update) in permissions table
ALTER TABLE public.permissions DROP CONSTRAINT IF EXISTS chk_permission_colon_notation;
ALTER TABLE public.permissions ADD CONSTRAINT chk_permission_colon_notation CHECK (id ~ '^[a-z_]+:[a-z_]+$');

INSERT INTO public.permissions (id, category, description) VALUES
    ('customers:read', 'customers', 'View customer profiles and search customers'),
    ('customers:create', 'customers', 'Create customer profiles'),
    ('customers:update', 'customers', 'Update customer contact information'),
    ('customers:archive', 'customers', 'Archive customer profiles'),
    ('sales:read', 'sales', 'View sales history and receipts'),
    ('sales:create', 'sales', 'Create sales checkouts'),
    ('sales:void', 'sales', 'Void completed sales'),
    ('returns:read', 'returns', 'View return records'),
    ('returns:create', 'returns', 'Process returns and refunds'),
    ('payments:read', 'payments', 'View payment records'),
    ('refunds:read', 'refunds', 'View refund records'),
    ('tax_settings:update', 'tax_settings', 'Update organization tax settings')
ON CONFLICT (id) DO UPDATE SET
    category = EXCLUDED.category,
    description = EXCLUDED.description;

INSERT INTO public.role_permissions (role, permission_id) VALUES
    -- Owner (all 12)
    ('owner', 'customers:read'),
    ('owner', 'customers:create'),
    ('owner', 'customers:update'),
    ('owner', 'customers:archive'),
    ('owner', 'sales:read'),
    ('owner', 'sales:create'),
    ('owner', 'sales:void'),
    ('owner', 'returns:read'),
    ('owner', 'returns:create'),
    ('owner', 'payments:read'),
    ('owner', 'refunds:read'),
    ('owner', 'tax_settings:update'),
    -- Admin (all 12)
    ('admin', 'customers:read'),
    ('admin', 'customers:create'),
    ('admin', 'customers:update'),
    ('admin', 'customers:archive'),
    ('admin', 'sales:read'),
    ('admin', 'sales:create'),
    ('admin', 'sales:void'),
    ('admin', 'returns:read'),
    ('admin', 'returns:create'),
    ('admin', 'payments:read'),
    ('admin', 'refunds:read'),
    ('admin', 'tax_settings:update'),
    -- Manager (11: all except tax_settings:update)
    ('manager', 'customers:read'),
    ('manager', 'customers:create'),
    ('manager', 'customers:update'),
    ('manager', 'customers:archive'),
    ('manager', 'sales:read'),
    ('manager', 'sales:create'),
    ('manager', 'sales:void'),
    ('manager', 'returns:read'),
    ('manager', 'returns:create'),
    ('manager', 'payments:read'),
    ('manager', 'refunds:read'),
    -- Cashier (7: operational read/create only)
    ('cashier', 'customers:read'),
    ('cashier', 'customers:create'),
    ('cashier', 'customers:update'),
    ('cashier', 'sales:read'),
    ('cashier', 'sales:create'),
    ('cashier', 'returns:read'),
    ('cashier', 'payments:read')
ON CONFLICT (role, permission_id) DO NOTHING;


-- ============================================================================
-- 6. RPC Implementations (T017–T027)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 6.1 RPC: public.create_customer (T023)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_customer(
    p_org_id UUID,
    p_name   TEXT,
    p_phone  TEXT DEFAULT NULL,
    p_email  TEXT DEFAULT NULL,
    p_notes  TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_clean_name TEXT;
    v_clean_phone TEXT;
    v_clean_email TEXT;
    v_clean_notes TEXT;
    v_customer_id UUID;
    v_created_at TIMESTAMPTZ;
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

    -- 3. Permission Gate: customers:create
    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'customers:create') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    -- 4. Normalization
    v_clean_name := trim(p_name);
    v_clean_phone := NULLIF(trim(p_phone), '');
    v_clean_email := NULLIF(lower(trim(p_email)), '');
    v_clean_notes := NULLIF(trim(p_notes), '');

    -- 5. Field Validations
    IF v_clean_name IS NULL OR length(v_clean_name) < 1 OR length(v_clean_name) > 255 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Customer name must be between 1 and 255 characters';
    END IF;

    IF v_clean_phone IS NOT NULL AND v_clean_phone !~ '^\+[1-9]\d{6,14}$' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Customer phone must follow E.164 format';
    END IF;

    IF v_clean_email IS NOT NULL AND v_clean_email !~ '^.+@.+$' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Customer email format is invalid';
    END IF;

    IF v_clean_notes IS NOT NULL AND length(v_clean_notes) > 1000 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Customer notes cannot exceed 1000 characters';
    END IF;

    -- 6. Uniqueness Check among Active
    IF v_clean_phone IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.customers
        WHERE organization_id = p_org_id AND phone = v_clean_phone AND status = 'active'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'CUSTOMER_PHONE_EXISTS';
    END IF;

    IF v_clean_email IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.customers
        WHERE organization_id = p_org_id AND email = v_clean_email AND status = 'active'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'CUSTOMER_EMAIL_EXISTS';
    END IF;

    -- 7. Insert
    INSERT INTO public.customers (
        organization_id, name, phone, email, notes, status
    ) VALUES (
        p_org_id, v_clean_name, v_clean_phone, v_clean_email, v_clean_notes, 'active'
    ) RETURNING id, created_at INTO v_customer_id, v_created_at;

    -- 8. Return
    RETURN jsonb_build_object(
        'success', true,
        'customer_id', v_customer_id,
        'name', v_clean_name,
        'phone', v_clean_phone,
        'email', v_clean_email,
        'status', 'active',
        'created_at', v_created_at
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 6.2 RPC: public.update_customer (T024)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_customer(
    p_org_id       UUID,
    p_customer_id  UUID,
    p_name         TEXT,
    p_phone        TEXT DEFAULT NULL,
    p_email        TEXT DEFAULT NULL,
    p_notes        TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_clean_name TEXT;
    v_clean_phone TEXT;
    v_clean_email TEXT;
    v_clean_notes TEXT;
    v_status TEXT;
    v_updated_at TIMESTAMPTZ;
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

    -- 3. Permission Gate: customers:update
    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'customers:update') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    -- 4. Target Customer Lock & Status Check
    SELECT status INTO v_status
    FROM public.customers
    WHERE organization_id = p_org_id AND id = p_customer_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0040', MESSAGE = 'CUSTOMER_NOT_FOUND';
    END IF;

    IF v_status = 'archived' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0041', MESSAGE = 'CUSTOMER_ARCHIVED';
    END IF;

    -- 5. Normalization
    v_clean_name := trim(p_name);
    v_clean_phone := NULLIF(trim(p_phone), '');
    v_clean_email := NULLIF(lower(trim(p_email)), '');
    v_clean_notes := NULLIF(trim(p_notes), '');

    -- 6. Field Validations
    IF v_clean_name IS NULL OR length(v_clean_name) < 1 OR length(v_clean_name) > 255 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Customer name must be between 1 and 255 characters';
    END IF;

    IF v_clean_phone IS NOT NULL AND v_clean_phone !~ '^\+[1-9]\d{6,14}$' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Customer phone must follow E.164 format';
    END IF;

    IF v_clean_email IS NOT NULL AND v_clean_email !~ '^.+@.+$' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Customer email format is invalid';
    END IF;

    IF v_clean_notes IS NOT NULL AND length(v_clean_notes) > 1000 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Customer notes cannot exceed 1000 characters';
    END IF;

    -- 7. Uniqueness Check among other Active Customers
    IF v_clean_phone IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.customers
        WHERE organization_id = p_org_id AND phone = v_clean_phone AND status = 'active' AND id <> p_customer_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'CUSTOMER_PHONE_EXISTS';
    END IF;

    IF v_clean_email IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.customers
        WHERE organization_id = p_org_id AND email = v_clean_email AND status = 'active' AND id <> p_customer_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'CUSTOMER_EMAIL_EXISTS';
    END IF;

    -- 8. Update
    UPDATE public.customers
    SET name = v_clean_name,
        phone = v_clean_phone,
        email = v_clean_email,
        notes = v_clean_notes,
        updated_at = now()
    WHERE organization_id = p_org_id AND id = p_customer_id
    RETURNING updated_at INTO v_updated_at;

    RETURN jsonb_build_object(
        'success', true,
        'customer_id', p_customer_id,
        'name', v_clean_name,
        'phone', v_clean_phone,
        'email', v_clean_email,
        'status', 'active',
        'updated_at', v_updated_at
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 6.3 RPC: public.archive_customer (T025)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archive_customer(
    p_org_id      UUID,
    p_customer_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_status TEXT;
    v_updated_at TIMESTAMPTZ;
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

    -- 3. Permission Gate: customers:archive
    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'customers:archive') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    -- 4. Target Customer Lock
    SELECT status, updated_at INTO v_status, v_updated_at
    FROM public.customers
    WHERE organization_id = p_org_id AND id = p_customer_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0040', MESSAGE = 'CUSTOMER_NOT_FOUND';
    END IF;

    -- 5. Idempotent check: if already archived, return success
    IF v_status = 'archived' THEN
        RETURN jsonb_build_object(
            'success', true,
            'customer_id', p_customer_id,
            'status', 'archived',
            'is_noop', true,
            'updated_at', v_updated_at
        );
    END IF;

    -- 6. Transition status -> archived
    UPDATE public.customers
    SET status = 'archived',
        updated_at = now()
    WHERE organization_id = p_org_id AND id = p_customer_id
    RETURNING updated_at INTO v_updated_at;

    RETURN jsonb_build_object(
        'success', true,
        'customer_id', p_customer_id,
        'status', 'archived',
        'is_noop', false,
        'updated_at', v_updated_at
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 6.4 RPC: public.update_tax_settings (T026)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_tax_settings(
    p_org_id            UUID,
    p_tax_name          TEXT,
    p_default_tax_rate  NUMERIC,
    p_is_tax_inclusive  BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_clean_name TEXT;
    v_rate NUMERIC(6, 4);
    v_inclusive BOOLEAN;
    v_role TEXT;
    v_updated_at TIMESTAMPTZ;
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

    SELECT role INTO v_role
    FROM public.organization_memberships
    WHERE organization_id = p_org_id AND user_id = auth.uid() AND status = 'active';

    IF v_role IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'MEMBERSHIP_INACTIVE';
    END IF;

    -- 3. Permission Gate: Owner/Admin or tax_settings:update
    IF v_role NOT IN ('owner', 'admin') AND NOT public.check_user_permission(p_org_id, auth.uid(), 'tax_settings:update') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    -- 4. Validations
    v_clean_name := trim(p_tax_name);
    IF v_clean_name IS NULL OR length(v_clean_name) < 1 OR length(v_clean_name) > 100 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Tax name must be between 1 and 100 characters';
    END IF;

    IF p_default_tax_rate IS NULL OR p_default_tax_rate < 0.0000 OR p_default_tax_rate > 100.0000 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Tax rate must be between 0.0000 and 100.0000';
    END IF;
    v_rate := round(p_default_tax_rate, 4);
    v_inclusive := coalesce(p_is_tax_inclusive, false);

    -- 5. Upsert
    INSERT INTO public.organization_tax_settings (
        organization_id, tax_name, default_tax_rate, is_tax_inclusive, updated_at, updated_by
    ) VALUES (
        p_org_id, v_clean_name, v_rate, v_inclusive, now(), auth.uid()
    ) ON CONFLICT (organization_id) DO UPDATE SET
        tax_name = EXCLUDED.tax_name,
        default_tax_rate = EXCLUDED.default_tax_rate,
        is_tax_inclusive = EXCLUDED.is_tax_inclusive,
        updated_at = now(),
        updated_by = auth.uid()
    RETURNING updated_at INTO v_updated_at;

    RETURN jsonb_build_object(
        'success', true,
        'organization_id', p_org_id,
        'tax_name', v_clean_name,
        'default_tax_rate', to_char(v_rate, 'FM990.0000'),
        'is_tax_inclusive', v_inclusive,
        'updated_at', v_updated_at
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 6.5 RPC: public.get_sale_detail (T027)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sale_detail(
    p_org_id  UUID,
    p_sale_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_sale RECORD;
    v_customer JSONB := NULL;
    v_items JSONB := '[]'::jsonb;
    v_payments JSONB := '[]'::jsonb;
    v_returns JSONB := '[]'::jsonb;
    v_refunds JSONB := '[]'::jsonb;
    v_can_view_cost BOOLEAN;
    v_taxable_amount NUMERIC(14, 4) := 0.0000;
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

    -- 3. Permission Gate: sales:read
    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'sales:read') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    -- 4. Target Sale Check
    SELECT * INTO v_sale
    FROM public.sales
    WHERE organization_id = p_org_id AND id = p_sale_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0048', MESSAGE = 'SALE_NOT_FOUND';
    END IF;

    -- 5. Cost Protection Gate: requires BOTH inventory:read_valuation AND products:read_cost
    v_can_view_cost := public.check_user_permission(p_org_id, auth.uid(), 'inventory:read_valuation')
                   AND public.check_user_permission(p_org_id, auth.uid(), 'products:read_cost');

    -- 6. Customer Details (if attached)
    IF v_sale.customer_id IS NOT NULL THEN
        SELECT jsonb_build_object(
            'id', id,
            'name', name,
            'phone', phone,
            'email', email,
            'status', status
        ) INTO v_customer
        FROM public.customers
        WHERE id = v_sale.customer_id;
    END IF;

    -- 7. Line Items (unit_cost conditionally projected based on v_can_view_cost)
    SELECT
        coalesce(jsonb_agg(
            jsonb_build_object(
                'id', si.id,
                'product_id', si.product_id,
                'product_name', p.name,
                'sku', p.sku,
                'quantity', to_char(si.quantity, 'FM9999999990.0000'),
                'unit_price', to_char(si.unit_price, 'FM9999999990.0000'),
                'unit_cost', CASE WHEN v_can_view_cost AND si.unit_cost IS NOT NULL THEN to_char(si.unit_cost, 'FM9999999990.0000') ELSE NULL END,
                'line_discount_amount', to_char(si.line_discount_amount, 'FM9999999990.0000'),
                'allocated_order_disc', to_char(si.allocated_order_disc, 'FM9999999990.0000'),
                'taxable_amount', to_char(si.taxable_amount, 'FM9999999990.0000'),
                'allocated_tax_amount', to_char(si.allocated_tax_amount, 'FM9999999990.0000'),
                'total_price', to_char(si.total_price, 'FM9999999990.0000'),
                'movement_id', si.movement_id
            ) ORDER BY si.created_at ASC
        ), '[]'::jsonb),
        coalesce(sum(si.taxable_amount), 0.0000)
    INTO v_items, v_taxable_amount
    FROM public.sale_items si
    JOIN public.products p ON p.id = si.product_id
    WHERE si.organization_id = p_org_id AND si.sale_id = p_sale_id;

    -- 8. Payments
    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'id', pay.id,
            'payment_method', pay.payment_method,
            'amount', to_char(pay.amount, 'FM9999999990.0000'),
            'amount_tendered', CASE WHEN pay.amount_tendered IS NOT NULL THEN to_char(pay.amount_tendered, 'FM9999999990.0000') ELSE NULL END,
            'change_due', CASE WHEN pay.change_due IS NOT NULL THEN to_char(pay.change_due, 'FM9999999990.0000') ELSE NULL END,
            'reference_no', pay.reference_no,
            'created_at', pay.created_at
        ) ORDER BY pay.created_at ASC
    ), '[]'::jsonb) INTO v_payments
    FROM public.payments pay
    WHERE pay.organization_id = p_org_id AND pay.sale_id = p_sale_id;

    -- 9. Returns
    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'id', sr.id,
            'return_number', sr.return_number,
            'reason', sr.reason,
            'total_refund_amount', to_char(sr.total_refund_amount, 'FM9999999990.0000'),
            'created_at', sr.created_at,
            'created_by', sr.created_by
        ) ORDER BY sr.created_at ASC
    ), '[]'::jsonb) INTO v_returns
    FROM public.sale_returns sr
    WHERE sr.organization_id = p_org_id AND sr.sale_id = p_sale_id;

    -- 10. Refunds
    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'id', ref.id,
            'return_id', ref.return_id,
            'parent_refund_id', ref.parent_refund_id,
            'obligation_refund_id', ref.obligation_refund_id,
            'refund_method', ref.refund_method,
            'amount', to_char(ref.amount, 'FM9999999990.0000'),
            'reference_no', ref.reference_no,
            'status', ref.status,
            'reason', ref.reason,
            'created_at', ref.created_at
        ) ORDER BY ref.created_at ASC
    ), '[]'::jsonb) INTO v_refunds
    FROM public.refunds ref
    WHERE ref.organization_id = p_org_id AND ref.sale_id = p_sale_id;

    -- 11. Assemble Result
    RETURN jsonb_build_object(
        'sale', jsonb_build_object(
            'id', v_sale.id,
            'organization_id', v_sale.organization_id,
            'sale_number', v_sale.sale_number,
            'customer_id', v_sale.customer_id,
            'status', v_sale.status,
            'payment_status', v_sale.payment_status,
            'subtotal', to_char(v_sale.subtotal, 'FM9999999990.0000'),
            'order_discount_amount', to_char(v_sale.order_discount_amount, 'FM9999999990.0000'),
            'taxable_amount', to_char(v_taxable_amount, 'FM9999999990.0000'),
            'tax_amount', to_char(v_sale.tax_amount, 'FM9999999990.0000'),
            'total_amount', to_char(v_sale.total_amount, 'FM9999999990.0000'),
            'currency', v_sale.currency,
            'is_tax_inclusive', v_sale.is_tax_inclusive,
            'tax_rate', to_char(v_sale.tax_rate, 'FM990.0000'),
            'tax_name', v_sale.tax_name,
            'notes', v_sale.notes,
            'created_at', v_sale.created_at,
            'created_by', v_sale.created_by,
            'voided_at', v_sale.voided_at,
            'voided_by', v_sale.voided_by,
            'void_reason', v_sale.void_reason
        ),
        'customer', v_customer,
        'items', v_items,
        'payments', v_payments,
        'returns', v_returns,
        'refunds', v_refunds
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 6.6 RPC: public.execute_sale (T017)
-- ----------------------------------------------------------------------------
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
    IF p_payments IS NULL OR jsonb_array_length(p_payments) = 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0045', MESSAGE = 'PAYMENT_INCOMPLETE';
    END IF;

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


-- ----------------------------------------------------------------------------
-- 6.7 RPC: public.void_sale (T018)
-- ----------------------------------------------------------------------------
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
    v_void_json JSONB;
    v_void_hash TEXT;
    v_item RECORD;
    v_payment RECORD;
    v_core_res JSONB;
    v_refund_id UUID;
    v_ref_status TEXT;
    v_lookup_ref TEXT;
    v_completed_refunds NUMERIC(14, 4);
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

    v_clean_reason := trim(p_void_reason);
    IF v_clean_reason IS NULL OR length(v_clean_reason) < 3 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0053', MESSAGE = 'RETURN_REASON_REQUIRED';
    END IF;

    -- 5. Lock Sale Row FOR UPDATE
    SELECT * INTO v_sale
    FROM public.sales
    WHERE organization_id = p_org_id AND id = p_sale_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0048', MESSAGE = 'SALE_NOT_FOUND';
    END IF;

    -- 6. Canonical Void Hash & Idempotency Check
    v_void_json := jsonb_build_object(
        'reversal_references', coalesce(p_reversal_references, '[]'::jsonb),
        'sale_id', p_sale_id,
        'void_reason', v_clean_reason
    );
    v_void_hash := encode(sha256(convert_to(v_void_json::text, 'UTF8')), 'hex');

    IF v_sale.void_idempotency_key = p_idempotency_key THEN
        IF v_sale.void_idempotency_hash = v_void_hash THEN
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

    -- Check if already voided under another key
    IF v_sale.status = 'voided' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0050', MESSAGE = 'SALE_ALREADY_VOIDED';
    END IF;

    IF v_sale.status <> 'completed' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0049', MESSAGE = 'SALE_NOT_COMPLETED';
    END IF;

    -- 7. Block Void if Returns Already Processed
    IF EXISTS (
        SELECT 1 FROM public.sale_returns
        WHERE organization_id = p_org_id AND sale_id = p_sale_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0051', MESSAGE = 'SALE_VOID_HAS_RETURNS_BLOCKED';
    END IF;

    -- 8. Restore Stock via Inventory Core in Ascending product_id Order
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

    -- 9. Create Refund Records per Original Payment
    -- Constraint fk_refunds_org_obligation is DEFERRABLE INITIALLY DEFERRED,
    -- allowing obligation_refund_id = id (self-referencing) to validate at commit!
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

    -- 10. Recalculate Sale payment_status (F005-039 Reconciled Formula)
    SELECT coalesce(sum(amount), 0) INTO v_completed_refunds
    FROM public.refunds
    WHERE organization_id = p_org_id AND sale_id = p_sale_id AND status = 'completed';

    IF v_completed_refunds >= v_sale.total_amount THEN
        v_new_payment_status := 'refunded';
    ELSIF v_completed_refunds > 0 THEN
        v_new_payment_status := 'partially_refunded';
    ELSE
        v_new_payment_status := 'paid';
    END IF;

    -- 11. Update Sale Header
    UPDATE public.sales
    SET status = 'voided',
        payment_status = v_new_payment_status,
        void_idempotency_key = p_idempotency_key,
        void_idempotency_hash = v_void_hash,
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


-- ----------------------------------------------------------------------------
-- 6.8 RPC: public.execute_sale_return (T019)
-- ----------------------------------------------------------------------------
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
    v_new_sale_status TEXT;
    v_new_payment_status TEXT;
    v_all_items_fully_returned BOOLEAN;
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
            RETURN jsonb_build_object(
                'success', true,
                'is_replay', true,
                'return_id', v_existing_return.id,
                'return_number', v_existing_return.return_number,
                'sale_id', v_existing_return.sale_id,
                'total_refund_amount', to_char(v_existing_return.total_refund_amount, 'FM9999999990.0000'),
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

    IF v_completed_refunds >= v_sale.total_amount THEN
        v_new_payment_status := 'refunded';
    ELSIF v_completed_refunds > 0.0000 THEN
        v_new_payment_status := 'partially_refunded';
    ELSE
        v_new_payment_status := 'paid';
    END IF;

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


-- ----------------------------------------------------------------------------
-- 6.9 RPC: public.confirm_refund_reimbursement (T020)
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
    v_refund RECORD;
    v_confirm_hash TEXT;
    v_sale RECORD;
    v_completed_refunds NUMERIC(14, 4);
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

    -- 5. Transaction-Scoped Advisory Lock (Case E)
    PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_idempotency_key::text));

    -- 6. Case C: Cross-Refund Key Collision Check under Advisory Lock
    IF EXISTS (
        SELECT 1 FROM public.refunds
        WHERE organization_id = p_org_id
          AND confirmation_idempotency_key = p_idempotency_key
          AND id <> p_refund_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
    END IF;

    -- 7. Target Refund Lock FOR UPDATE
    SELECT * INTO v_refund
    FROM public.refunds
    WHERE organization_id = p_org_id AND id = p_refund_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0058', MESSAGE = 'REFUND_NOT_FOUND';
    END IF;

    -- 8. Canonical Hash Construction
    v_confirm_hash := encode(sha256(convert_to(
        jsonb_build_object('external_reference', v_clean_ref, 'refund_id', p_refund_id)::text,
        'UTF8'
    )), 'hex');

    -- 9. Case A & B: Idempotency Replay or Conflict on Same Refund
    IF v_refund.confirmation_idempotency_key = p_idempotency_key THEN
        IF v_refund.confirmation_idempotency_hash = v_confirm_hash THEN
            RETURN jsonb_build_object(
                'success', true,
                'is_replay', true,
                'refund_id', v_refund.id,
                'status', v_refund.status,
                'reference_no', v_refund.reference_no,
                'amount', to_char(v_refund.amount, 'FM9999999990.0000')
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
        confirmation_idempotency_hash = v_confirm_hash,
        updated_at = now()
    WHERE id = p_refund_id;

    -- 12. Recalculate Sale payment_status (F005-039 Reconciled Formula)
    SELECT * INTO v_sale FROM public.sales WHERE id = v_refund.sale_id;

    SELECT coalesce(sum(amount), 0.0000) INTO v_completed_refunds
    FROM public.refunds
    WHERE organization_id = p_org_id AND sale_id = v_refund.sale_id AND status = 'completed';

    IF v_completed_refunds >= v_sale.total_amount THEN
        v_new_ps := 'refunded';
    ELSIF v_completed_refunds > 0.0000 THEN
        v_new_ps := 'partially_refunded';
    ELSE
        v_new_ps := 'paid';
    END IF;

    UPDATE public.sales
    SET payment_status = v_new_ps,
        updated_at = now()
    WHERE id = v_refund.sale_id;

    RETURN jsonb_build_object(
        'success', true,
        'is_replay', false,
        'refund_id', p_refund_id,
        'status', 'completed',
        'reference_no', v_clean_ref,
        'amount', to_char(v_refund.amount, 'FM9999999990.0000'),
        'payment_status', v_new_ps,
        'updated_at', now()
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 6.10 RPC: public.record_refund_failure (T021)
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
    v_sale RECORD;
    v_completed_refunds NUMERIC(14, 4);
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
        reason = v_refund.reason || ' [Failure: ' || v_clean_reason || ']',
        updated_at = now()
    WHERE id = p_refund_id;

    -- 6. Recalculate Sale payment_status (F005-039 Reconciled Formula)
    SELECT * INTO v_sale FROM public.sales WHERE id = v_refund.sale_id;

    SELECT coalesce(sum(amount), 0.0000) INTO v_completed_refunds
    FROM public.refunds
    WHERE organization_id = p_org_id AND sale_id = v_refund.sale_id AND status = 'completed';

    IF v_completed_refunds >= v_sale.total_amount THEN
        v_new_ps := 'refunded';
    ELSIF v_completed_refunds > 0.0000 THEN
        v_new_ps := 'partially_refunded';
    ELSE
        v_new_ps := 'paid';
    END IF;

    UPDATE public.sales
    SET payment_status = v_new_ps,
        updated_at = now()
    WHERE id = v_refund.sale_id;

    RETURN jsonb_build_object(
        'success', true,
        'refund_id', p_refund_id,
        'status', 'failed',
        'failure_reason', v_clean_reason,
        'payment_status', v_new_ps,
        'updated_at', now()
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 6.11 RPC: public.issue_replacement_refund (T022)
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
    v_failed_refund RECORD;
    v_rep_json JSONB;
    v_rep_hash TEXT;
    v_existing_refund RECORD;

    v_orig_method_tender NUMERIC(14, 4);
    v_prior_method_refunds NUMERIC(14, 4);
    v_prior_total_refunds NUMERIC(14, 4);
    v_sale RECORD;

    v_new_refund_id UUID;
    v_new_status TEXT;
    v_completed_refunds NUMERIC(14, 4);
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

    -- 5. Lock Failed Refund Row FOR UPDATE
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

    -- 6. F005-044: Unconditional Obligation-Level Advisory Lock
    PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(v_failed_refund.obligation_refund_id::text));

    -- 7. Check Canonical Hash and Idempotency
    v_rep_json := jsonb_build_object(
        'failed_refund_id', p_failed_refund_id,
        'reference_no', NULLIF(trim(p_reference_no), ''),
        'refund_method', p_refund_method
    );
    v_rep_hash := encode(sha256(convert_to(v_rep_json::text, 'UTF8')), 'hex');

    SELECT * INTO v_existing_refund
    FROM public.refunds
    WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_existing_refund.idempotency_hash = v_rep_hash THEN
            RETURN jsonb_build_object(
                'success', true,
                'is_replay', true,
                'refund_id', v_existing_refund.id,
                'obligation_refund_id', v_existing_refund.obligation_refund_id,
                'parent_refund_id', v_existing_refund.parent_refund_id,
                'status', v_existing_refund.status,
                'amount', to_char(v_existing_refund.amount, 'FM9999999990.0000'),
                'created_at', v_existing_refund.created_at
            );
        ELSE
            RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
        END IF;
    END IF;

    -- 8. Obligation Lifecycle Checks (F005-044)
    -- Check if obligation already has a completed reimbursement
    IF EXISTS (
        SELECT 1 FROM public.refunds
        WHERE organization_id = p_org_id
          AND obligation_refund_id = v_failed_refund.obligation_refund_id
          AND status = 'completed'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0067', MESSAGE = 'OBLIGATION_ALREADY_COMPLETED';
    END IF;

    -- Check if obligation already has an active (pending) attempt
    IF EXISTS (
        SELECT 1 FROM public.refunds
        WHERE organization_id = p_org_id
          AND obligation_refund_id = v_failed_refund.obligation_refund_id
          AND status = 'pending'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0064', MESSAGE = 'REPLACEMENT_REFUND_ALREADY_EXISTS';
    END IF;

    -- 9. Tender Ceiling & Cumulative Cap Checks
    SELECT * INTO v_sale FROM public.sales WHERE id = v_failed_refund.sale_id;

    IF p_refund_method <> 'cash' THEN
        SELECT coalesce(sum(amount), 0.0000) INTO v_orig_method_tender
        FROM public.payments
        WHERE organization_id = p_org_id AND sale_id = v_failed_refund.sale_id AND payment_method = p_refund_method;

        SELECT coalesce(sum(amount), 0.0000) INTO v_prior_method_refunds
        FROM public.refunds
        WHERE organization_id = p_org_id AND sale_id = v_failed_refund.sale_id AND refund_method = p_refund_method AND status IN ('completed', 'pending');

        IF v_prior_method_refunds + v_failed_refund.amount > v_orig_method_tender THEN
            RAISE EXCEPTION USING ERRCODE = 'P0061', MESSAGE = 'REFUND_METHOD_EXCEEDS_ORIGINAL_TENDER';
        END IF;
    END IF;

    SELECT coalesce(sum(amount), 0.0000) INTO v_prior_total_refunds
    FROM public.refunds
    WHERE organization_id = p_org_id AND sale_id = v_failed_refund.sale_id AND status IN ('completed', 'pending');

    IF v_prior_total_refunds + v_failed_refund.amount > v_sale.total_amount THEN
        RAISE EXCEPTION USING ERRCODE = 'P0054', MESSAGE = 'REFUND_EXCEEDS_PAYABLE';
    END IF;

    -- 10. Insert Linked Replacement Refund Row
    v_new_refund_id := gen_random_uuid();
    v_new_status := CASE WHEN p_refund_method = 'cash' THEN 'completed' ELSE 'pending' END;

    INSERT INTO public.refunds (
        id, organization_id, sale_id, return_id, parent_refund_id, obligation_refund_id,
        refund_method, amount, reference_no, status, reason, processed_by,
        idempotency_key, idempotency_hash
    ) VALUES (
        v_new_refund_id, p_org_id, v_failed_refund.sale_id, v_failed_refund.return_id,
        p_failed_refund_id, v_failed_refund.obligation_refund_id, p_refund_method,
        v_failed_refund.amount, NULLIF(trim(p_reference_no), ''), v_new_status,
        coalesce(trim(p_notes), 'Replacement for failed refund ' || p_failed_refund_id::text),
        auth.uid(), p_idempotency_key, v_rep_hash
    );

    -- 11. Recalculate Sale payment_status (F005-039 Reconciled Formula)
    SELECT coalesce(sum(amount), 0.0000) INTO v_completed_refunds
    FROM public.refunds
    WHERE organization_id = p_org_id AND sale_id = v_failed_refund.sale_id AND status = 'completed';

    IF v_completed_refunds >= v_sale.total_amount THEN
        v_new_ps := 'refunded';
    ELSIF v_completed_refunds > 0.0000 THEN
        v_new_ps := 'partially_refunded';
    ELSE
        v_new_ps := 'paid';
    END IF;

    UPDATE public.sales
    SET payment_status = v_new_ps,
        updated_at = now()
    WHERE id = v_failed_refund.sale_id;

    RETURN jsonb_build_object(
        'success', true,
        'is_replay', false,
        'refund_id', v_new_refund_id,
        'obligation_refund_id', v_failed_refund.obligation_refund_id,
        'parent_refund_id', p_failed_refund_id,
        'status', v_new_status,
        'amount', to_char(v_failed_refund.amount, 'FM9999999990.0000'),
        'payment_status', v_new_ps,
        'created_at', now()
    );
END;
$$;


-- ============================================================================
-- 7. RPC Ownership, Security & Grants (T028)
-- ============================================================================

-- Function 1: execute_sale
ALTER FUNCTION public.execute_sale(UUID, UUID, JSONB, JSONB, NUMERIC, UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.execute_sale(UUID, UUID, JSONB, JSONB, NUMERIC, UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.execute_sale(UUID, UUID, JSONB, JSONB, NUMERIC, UUID, TEXT) TO authenticated;

-- Function 2: void_sale
ALTER FUNCTION public.void_sale(UUID, UUID, TEXT, UUID, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.void_sale(UUID, UUID, TEXT, UUID, JSONB) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.void_sale(UUID, UUID, TEXT, UUID, JSONB) TO authenticated;

-- Function 3: execute_sale_return
ALTER FUNCTION public.execute_sale_return(UUID, UUID, JSONB, TEXT, TEXT, UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.execute_sale_return(UUID, UUID, JSONB, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.execute_sale_return(UUID, UUID, JSONB, TEXT, TEXT, UUID, TEXT) TO authenticated;

-- Function 4: confirm_refund_reimbursement
ALTER FUNCTION public.confirm_refund_reimbursement(UUID, UUID, TEXT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.confirm_refund_reimbursement(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_refund_reimbursement(UUID, UUID, TEXT, UUID) TO authenticated;

-- Function 5: record_refund_failure
ALTER FUNCTION public.record_refund_failure(UUID, UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_refund_failure(UUID, UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_refund_failure(UUID, UUID, TEXT) TO authenticated;

-- Function 6: issue_replacement_refund
ALTER FUNCTION public.issue_replacement_refund(UUID, UUID, TEXT, UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_replacement_refund(UUID, UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.issue_replacement_refund(UUID, UUID, TEXT, UUID, TEXT, TEXT) TO authenticated;

-- Function 7: create_customer
ALTER FUNCTION public.create_customer(UUID, TEXT, TEXT, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_customer(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_customer(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- Function 8: update_customer
ALTER FUNCTION public.update_customer(UUID, UUID, TEXT, TEXT, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_customer(UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_customer(UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- Function 9: archive_customer
ALTER FUNCTION public.archive_customer(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.archive_customer(UUID, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.archive_customer(UUID, UUID) TO authenticated;

-- Function 10: update_tax_settings
ALTER FUNCTION public.update_tax_settings(UUID, TEXT, NUMERIC, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_tax_settings(UUID, TEXT, NUMERIC, BOOLEAN) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_tax_settings(UUID, TEXT, NUMERIC, BOOLEAN) TO authenticated;

-- Function 11: get_sale_detail
ALTER FUNCTION public.get_sale_detail(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_sale_detail(UUID, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_sale_detail(UUID, UUID) TO authenticated;
