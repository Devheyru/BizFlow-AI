-- ============================================================================
-- Migration: 20261128000026_invoices_expenses_schema.sql
-- Feature: 006 — Invoices & Expenses (Phase 1: Database Foundation, P0 Only)
-- Tasks: T001–T017 (T018 duplicate_invoice P1 intentionally excluded)
-- Description:
--   - 7 tables: financial_sequences, invoices, invoice_items, invoice_payments,
--               expense_categories, expenses, expense_attachments
--   - ENABLE + FORCE ROW LEVEL SECURITY, deny-all DML, permission-gated SELECT
--   - Private storage bucket 'expense-attachments' + active-parent Storage RLS
--   - 16 RBAC permissions registered in public.permissions & role_permissions
--   - 2 internal financial/sequence helpers (_f006_next_sequence, _f006_compute_invoice_totals)
--   - 20 P0 SECURITY DEFINER RPCs with strict locks, idempotency, & audit events
-- Compliance: BizFlow AI Constitution v1.1.0, Feature 006 Spec & Contracts
-- ============================================================================

BEGIN;

-- ============================================================================
-- T001: Daily Numbering Sequences (public.financial_sequences)
-- ============================================================================
CREATE TABLE public.financial_sequences (
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    sequence_type   TEXT NOT NULL CHECK (sequence_type IN ('invoice', 'invoice_payment', 'expense')),
    date_key        DATE NOT NULL,
    last_number     INTEGER NOT NULL DEFAULT 0 CHECK (last_number >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (organization_id, sequence_type, date_key)
);

CREATE TRIGGER trg_financial_sequences_updated_at
    BEFORE UPDATE ON public.financial_sequences
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();


-- ============================================================================
-- T002: Standalone Customer Billing Headers (public.invoices)
-- ============================================================================
CREATE TABLE public.invoices (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    invoice_number          TEXT NULL,
    customer_id             UUID NOT NULL,
    customer_name_snapshot  TEXT NOT NULL CHECK (length(trim(customer_name_snapshot)) BETWEEN 1 AND 255),
    customer_email_snapshot TEXT NULL,
    customer_phone_snapshot TEXT NULL,
    issue_date              DATE NOT NULL,
    due_date                DATE NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'cancelled')),
    currency                TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    tax_name                TEXT NOT NULL DEFAULT 'VAT'
                            CHECK (length(trim(tax_name)) BETWEEN 1 AND 100),
    tax_rate                NUMERIC(6, 4) NOT NULL DEFAULT 0.0000
                            CHECK (tax_rate >= 0.0000 AND tax_rate <= 100.0000),
    is_tax_inclusive        BOOLEAN NOT NULL DEFAULT false,
    is_tax_exempt           BOOLEAN NOT NULL DEFAULT false,
    subtotal                NUMERIC(14, 4) NOT NULL DEFAULT 0.0000 CHECK (subtotal >= 0),
    invoice_discount_amount NUMERIC(14, 4) NOT NULL DEFAULT 0.0000 CHECK (invoice_discount_amount >= 0),
    taxable_amount          NUMERIC(14, 4) NOT NULL DEFAULT 0.0000 CHECK (taxable_amount >= 0),
    tax_amount              NUMERIC(14, 4) NOT NULL DEFAULT 0.0000 CHECK (tax_amount >= 0),
    total_amount            NUMERIC(14, 4) NOT NULL DEFAULT 0.0000 CHECK (total_amount >= 0),
    paid_amount             NUMERIC(14, 4) NOT NULL DEFAULT 0.0000 CHECK (paid_amount >= 0),
    outstanding_balance     NUMERIC(14, 4) NOT NULL DEFAULT 0.0000 CHECK (outstanding_balance >= 0),
    notes                   TEXT NULL CHECK (notes IS NULL OR length(notes) <= 1000),
    payment_instructions    TEXT NULL CHECK (payment_instructions IS NULL OR length(payment_instructions) <= 1000),
    issued_at               TIMESTAMPTZ NULL,
    issued_by               UUID NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    paid_at                 TIMESTAMPTZ NULL,
    cancelled_at            TIMESTAMPTZ NULL,
    cancelled_by            UUID NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    cancellation_reason     TEXT NULL CHECK (cancellation_reason IS NULL OR length(trim(cancellation_reason)) BETWEEN 3 AND 255),
    draft_idempotency_key   UUID NOT NULL,
    draft_idempotency_hash  TEXT NOT NULL,
    issue_idempotency_key   UUID NULL,
    issue_idempotency_hash  TEXT NULL,
    cancel_idempotency_key  UUID NULL,
    cancel_idempotency_hash TEXT NULL,
    created_by              UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    updated_by              UUID NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_invoices_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_invoices_org_customer FOREIGN KEY (organization_id, customer_id)
        REFERENCES public.customers(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_invoices_dates CHECK (due_date >= issue_date),
    CONSTRAINT chk_invoices_balance_eq CHECK (paid_amount + outstanding_balance = total_amount),
    CONSTRAINT chk_invoices_paid_bounds CHECK (paid_amount <= total_amount),
    CONSTRAINT uq_invoices_org_draft_idemp UNIQUE (organization_id, draft_idempotency_key)
);

CREATE UNIQUE INDEX uq_invoices_org_number
    ON public.invoices (organization_id, invoice_number)
    WHERE invoice_number IS NOT NULL;

CREATE UNIQUE INDEX uq_invoices_org_issue_idemp
    ON public.invoices (organization_id, issue_idempotency_key)
    WHERE issue_idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX uq_invoices_org_cancel_idemp
    ON public.invoices (organization_id, cancel_idempotency_key)
    WHERE cancel_idempotency_key IS NOT NULL;

CREATE INDEX idx_invoices_org_status_due
    ON public.invoices (organization_id, status, due_date);

CREATE INDEX idx_invoices_org_customer
    ON public.invoices (organization_id, customer_id, created_at DESC);

CREATE INDEX idx_invoices_org_issue_date
    ON public.invoices (organization_id, issue_date DESC);

CREATE INDEX idx_invoices_org_created
    ON public.invoices (organization_id, created_at DESC);

CREATE TRIGGER trg_invoices_updated_at
    BEFORE UPDATE ON public.invoices
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();


-- ============================================================================
-- T003: Invoice Line Items (public.invoice_items — NO unit_cost column)
-- ============================================================================
CREATE TABLE public.invoice_items (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    invoice_id               UUID NOT NULL,
    sort_order               INTEGER NOT NULL CHECK (sort_order >= 0),
    product_id               UUID NULL,
    sku_snapshot             TEXT NULL CHECK (sku_snapshot IS NULL OR length(trim(sku_snapshot)) <= 100),
    unit_of_measure_snapshot TEXT NULL CHECK (unit_of_measure_snapshot IS NULL OR length(trim(unit_of_measure_snapshot)) <= 50),
    description              TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 255),
    quantity                 NUMERIC(14, 4) NOT NULL CHECK (quantity > 0),
    unit_price               NUMERIC(14, 4) NOT NULL CHECK (unit_price >= 0),
    line_discount_amount     NUMERIC(14, 4) NOT NULL DEFAULT 0.0000 CHECK (line_discount_amount >= 0),
    allocated_invoice_disc   NUMERIC(14, 4) NOT NULL DEFAULT 0.0000 CHECK (allocated_invoice_disc >= 0),
    is_taxable               BOOLEAN NOT NULL DEFAULT true,
    taxable_amount           NUMERIC(14, 4) NOT NULL DEFAULT 0.0000 CHECK (taxable_amount >= 0),
    allocated_tax_amount     NUMERIC(14, 4) NOT NULL DEFAULT 0.0000 CHECK (allocated_tax_amount >= 0),
    total_price              NUMERIC(14, 4) NOT NULL CHECK (total_price >= 0),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_invoice_items_org_invoice FOREIGN KEY (organization_id, invoice_id)
        REFERENCES public.invoices(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_invoice_items_org_product FOREIGN KEY (organization_id, product_id)
        REFERENCES public.products(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT uq_invoice_items_order UNIQUE (organization_id, invoice_id, sort_order)
);

CREATE INDEX idx_invoice_items_invoice
    ON public.invoice_items (organization_id, invoice_id, sort_order);


-- ============================================================================
-- T004: Invoice Payment Ledger (public.invoice_payments)
-- ============================================================================
CREATE TABLE public.invoice_payments (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    invoice_id               UUID NOT NULL,
    payment_number           TEXT NOT NULL,
    payment_method           TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'bank_transfer', 'other')),
    amount                   NUMERIC(14, 4) NOT NULL CHECK (amount > 0),
    balance_after_payment    NUMERIC(14, 4) NOT NULL CHECK (balance_after_payment >= 0),
    payment_date             DATE NOT NULL,
    reference_no             TEXT NULL CHECK (reference_no IS NULL OR length(trim(reference_no)) BETWEEN 1 AND 120),
    notes                    TEXT NULL CHECK (notes IS NULL OR length(notes) <= 500),
    status                   TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'reversed')),
    reversed_at              TIMESTAMPTZ NULL,
    reversed_by              UUID NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    reversal_reason          TEXT NULL CHECK (reversal_reason IS NULL OR length(trim(reversal_reason)) BETWEEN 3 AND 255),
    idempotency_key          UUID NOT NULL,
    idempotency_hash         TEXT NOT NULL,
    reversal_idempotency_key UUID NULL,
    reversal_idempotency_hash TEXT NULL,
    created_by               UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_invoice_payments_org_invoice FOREIGN KEY (organization_id, invoice_id)
        REFERENCES public.invoices(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT uq_invoice_payments_org_number UNIQUE (organization_id, payment_number),
    CONSTRAINT uq_invoice_payments_org_idemp UNIQUE (organization_id, idempotency_key),
    CONSTRAINT chk_invoice_payments_ref_req CHECK (payment_method = 'cash' OR reference_no IS NOT NULL),
    CONSTRAINT chk_invoice_payments_reversal CHECK (
        (status = 'recorded' AND reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL) OR
        (status = 'reversed' AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND reversal_reason IS NOT NULL)
    )
);

CREATE UNIQUE INDEX uq_invoice_payments_method_ref_active
    ON public.invoice_payments (organization_id, payment_method, reference_no)
    WHERE reference_no IS NOT NULL AND status = 'recorded';

CREATE UNIQUE INDEX uq_invoice_payments_rev_idemp
    ON public.invoice_payments (organization_id, reversal_idempotency_key)
    WHERE reversal_idempotency_key IS NOT NULL;

CREATE INDEX idx_invoice_payments_invoice
    ON public.invoice_payments (organization_id, invoice_id, created_at ASC);

CREATE INDEX idx_invoice_payments_date
    ON public.invoice_payments (organization_id, payment_date DESC)
    WHERE status = 'recorded';


-- ============================================================================
-- T005: Expense Categories, Expenses & Attachments
-- ============================================================================
CREATE TABLE public.expense_categories (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name              TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
    description       TEXT NULL CHECK (description IS NULL OR length(description) <= 500),
    status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    is_system_default BOOLEAN NOT NULL DEFAULT false,
    created_by        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_expense_categories_org_id UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX uq_expense_categories_org_name_active
    ON public.expense_categories (organization_id, lower(trim(name)))
    WHERE status = 'active';

CREATE INDEX idx_expense_categories_org_status
    ON public.expense_categories (organization_id, status);

CREATE TRIGGER trg_expense_categories_updated_at
    BEFORE UPDATE ON public.expense_categories
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();


CREATE TABLE public.expenses (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    expense_number          TEXT NOT NULL,
    category_id             UUID NOT NULL,
    title                   TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 255),
    description             TEXT NULL CHECK (description IS NULL OR length(description) <= 1000),
    payee_name              TEXT NULL CHECK (payee_name IS NULL OR length(trim(payee_name)) <= 255),
    net_amount              NUMERIC(14, 4) NOT NULL CHECK (net_amount > 0),
    tax_amount              NUMERIC(14, 4) NOT NULL DEFAULT 0.0000 CHECK (tax_amount >= 0),
    total_amount            NUMERIC(14, 4) NOT NULL CHECK (total_amount > 0),
    currency                TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    expense_date            DATE NOT NULL,
    lifecycle_status        TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active', 'voided', 'corrected')),
    payment_status          TEXT NOT NULL CHECK (payment_status IN ('unpaid', 'paid')),
    payment_date            DATE NULL,
    payment_method          TEXT NULL CHECK (payment_method IS NULL OR payment_method IN ('cash', 'card', 'bank_transfer', 'other')),
    reference_no            TEXT NULL CHECK (reference_no IS NULL OR length(trim(reference_no)) BETWEEN 1 AND 120),
    paid_at                 TIMESTAMPTZ NULL,
    paid_by                 UUID NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    voided_at               TIMESTAMPTZ NULL,
    voided_by               UUID NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    void_reason             TEXT NULL CHECK (void_reason IS NULL OR length(trim(void_reason)) BETWEEN 3 AND 255),
    supersedes_expense_id   UUID NULL,
    corrected_by_expense_id UUID NULL,
    correction_reason       TEXT NULL CHECK (correction_reason IS NULL OR length(trim(correction_reason)) BETWEEN 3 AND 255),
    idempotency_key         UUID NOT NULL,
    idempotency_hash        TEXT NOT NULL,
    pay_idempotency_key     UUID NULL,
    pay_idempotency_hash    TEXT NULL,
    void_idempotency_key    UUID NULL,
    void_idempotency_hash   TEXT NULL,
    correct_idempotency_key UUID NULL,
    correct_idempotency_hash TEXT NULL,
    created_by              UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    updated_by              UUID NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_expenses_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_expenses_org_number UNIQUE (organization_id, expense_number),
    CONSTRAINT fk_expenses_org_category FOREIGN KEY (organization_id, category_id)
        REFERENCES public.expense_categories(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_expenses_org_supersedes FOREIGN KEY (organization_id, supersedes_expense_id)
        REFERENCES public.expenses(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_expenses_org_corrected_by FOREIGN KEY (organization_id, corrected_by_expense_id)
        REFERENCES public.expenses(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_expenses_total_eq CHECK (total_amount = net_amount + tax_amount),
    CONSTRAINT chk_expenses_settlement CHECK (
        (payment_status = 'unpaid' AND payment_date IS NULL AND payment_method IS NULL AND reference_no IS NULL AND paid_at IS NULL AND paid_by IS NULL) OR
        (payment_status = 'paid' AND payment_date IS NOT NULL AND payment_method IS NOT NULL AND paid_at IS NOT NULL AND paid_by IS NOT NULL AND (payment_method = 'cash' OR reference_no IS NOT NULL))
    ),
    CONSTRAINT chk_expenses_void_only_unpaid CHECK (
        lifecycle_status <> 'voided' OR (payment_status = 'unpaid' AND voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL)
    ),
    CONSTRAINT chk_expenses_corrected_only_paid CHECK (
        lifecycle_status <> 'corrected' OR (payment_status = 'paid' AND correction_reason IS NOT NULL)
    ),
    CONSTRAINT uq_expenses_org_idemp UNIQUE (organization_id, idempotency_key)
);

CREATE UNIQUE INDEX uq_expenses_org_pay_idemp
    ON public.expenses (organization_id, pay_idempotency_key)
    WHERE pay_idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX uq_expenses_org_void_idemp
    ON public.expenses (organization_id, void_idempotency_key)
    WHERE void_idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX uq_expenses_org_correct_idemp
    ON public.expenses (organization_id, correct_idempotency_key)
    WHERE correct_idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX uq_expenses_org_method_ref_active
    ON public.expenses (organization_id, payment_method, reference_no)
    WHERE reference_no IS NOT NULL AND lifecycle_status = 'active';

CREATE INDEX idx_expenses_org_lifecycle_date
    ON public.expenses (organization_id, lifecycle_status, expense_date DESC);

CREATE INDEX idx_expenses_org_category
    ON public.expenses (organization_id, category_id);

CREATE INDEX idx_expenses_org_payment_status
    ON public.expenses (organization_id, payment_status);

CREATE TRIGGER trg_expenses_updated_at
    BEFORE UPDATE ON public.expenses
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();


CREATE TABLE public.expense_attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    expense_id      UUID NOT NULL,
    storage_path    TEXT NOT NULL UNIQUE
                    CHECK (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'),
    file_name       TEXT NOT NULL CHECK (length(trim(file_name)) BETWEEN 1 AND 255),
    mime_type       TEXT NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
    file_size       BIGINT NOT NULL CHECK (file_size BETWEEN 1 AND 5242880),
    uploaded_by     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_expense_attachments_org_expense FOREIGN KEY (organization_id, expense_id)
        REFERENCES public.expenses(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_expense_attachments_expense
    ON public.expense_attachments (organization_id, expense_id, created_at ASC);


-- ============================================================================
-- T006: ENABLE + FORCE RLS, Deny-All Direct DML & Permission-Gated SELECT
-- ============================================================================
ALTER TABLE public.financial_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_sequences FORCE ROW LEVEL SECURITY;

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices FORCE ROW LEVEL SECURITY;

ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items FORCE ROW LEVEL SECURITY;

ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_payments FORCE ROW LEVEL SECURITY;

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_categories FORCE ROW LEVEL SECURITY;

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses FORCE ROW LEVEL SECURITY;

ALTER TABLE public.expense_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_attachments FORCE ROW LEVEL SECURITY;

-- Deny-all direct DML policies for authenticated role across all 7 tables
CREATE POLICY deny_all_financial_sequences ON public.financial_sequences
    FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY deny_dml_invoices ON public.invoices
    FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY deny_dml_invoice_items ON public.invoice_items
    FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY deny_dml_invoice_payments ON public.invoice_payments
    FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY deny_dml_expense_categories ON public.expense_categories
    FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY deny_dml_expenses ON public.expenses
    FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY deny_dml_expense_attachments ON public.expense_attachments
    FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- Permissive SELECT policies for the 6 read surfaces
CREATE POLICY select_invoices ON public.invoices
    FOR SELECT TO authenticated
    USING (public.check_user_permission(organization_id, auth.uid(), 'invoices:read'));

CREATE POLICY select_invoice_items ON public.invoice_items
    FOR SELECT TO authenticated
    USING (public.check_user_permission(organization_id, auth.uid(), 'invoices:read'));

CREATE POLICY select_invoice_payments ON public.invoice_payments
    FOR SELECT TO authenticated
    USING (public.check_user_permission(organization_id, auth.uid(), 'invoice_payments:read'));

CREATE POLICY select_expense_categories ON public.expense_categories
    FOR SELECT TO authenticated
    USING (public.check_user_permission(organization_id, auth.uid(), 'expense_categories:read'));

CREATE POLICY select_expenses ON public.expenses
    FOR SELECT TO authenticated
    USING (public.check_user_permission(organization_id, auth.uid(), 'expenses:read'));

CREATE POLICY select_expense_attachments ON public.expense_attachments
    FOR SELECT TO authenticated
    USING (public.check_user_permission(organization_id, auth.uid(), 'expenses:read'));

-- Explicit SQL privilege surface (no SELECT granted on financial_sequences; no direct DML/DDL for PUBLIC/anon/authenticated)
REVOKE ALL ON TABLE public.financial_sequences FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.invoices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.invoice_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.invoice_payments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.expense_categories FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.expenses FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.expense_attachments FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.invoices TO authenticated;
GRANT SELECT ON TABLE public.invoice_items TO authenticated;
GRANT SELECT ON TABLE public.invoice_payments TO authenticated;
GRANT SELECT ON TABLE public.expense_categories TO authenticated;
GRANT SELECT ON TABLE public.expenses TO authenticated;
GRANT SELECT ON TABLE public.expense_attachments TO authenticated;


-- ============================================================================
-- T007: Private Storage Bucket ('expense-attachments') & Active-Parent RLS
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'expense-attachments',
    'expense-attachments',
    false,
    5242880,
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[];

DROP POLICY IF EXISTS "expense_attachments_select" ON storage.objects;
CREATE POLICY "expense_attachments_select" ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'expense-attachments'
        AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'
        AND public.is_org_member((storage.foldername(name))[1]::uuid)
        AND public.check_user_permission((storage.foldername(name))[1]::uuid, auth.uid(), 'expenses:read')
        AND EXISTS (
            SELECT 1 FROM public.expenses e
            WHERE e.id = (storage.foldername(objects.name))[2]::uuid
              AND e.organization_id = (storage.foldername(objects.name))[1]::uuid
        )
    );

DROP POLICY IF EXISTS "expense_attachments_insert" ON storage.objects;
CREATE POLICY "expense_attachments_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'expense-attachments'
        AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'
        AND public.is_org_member((storage.foldername(name))[1]::uuid)
        AND (
            public.check_user_permission((storage.foldername(name))[1]::uuid, auth.uid(), 'expenses:create')
            OR public.check_user_permission((storage.foldername(name))[1]::uuid, auth.uid(), 'expenses:update')
        )
        AND EXISTS (
            SELECT 1 FROM public.expenses e
            WHERE e.id = (storage.foldername(objects.name))[2]::uuid
              AND e.organization_id = (storage.foldername(objects.name))[1]::uuid
              AND e.lifecycle_status = 'active'
        )
        AND (COALESCE(metadata->>'size', metadata->>'contentLength')) IS NOT NULL
        AND (COALESCE(metadata->>'size', metadata->>'contentLength')) ~ '^[0-9]+$'
        AND (COALESCE(metadata->>'size', metadata->>'contentLength'))::bigint BETWEEN 1 AND 5242880
        AND metadata->>'mimetype' IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    );

DROP POLICY IF EXISTS "expense_attachments_delete" ON storage.objects;
CREATE POLICY "expense_attachments_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id = 'expense-attachments'
        AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'
        AND public.is_org_member((storage.foldername(name))[1]::uuid)
        AND public.check_user_permission((storage.foldername(name))[1]::uuid, auth.uid(), 'expenses:update')
        AND EXISTS (
            SELECT 1 FROM public.expenses e
            WHERE e.id = (storage.foldername(objects.name))[2]::uuid
              AND e.organization_id = (storage.foldername(objects.name))[1]::uuid
              AND e.lifecycle_status = 'active'
        )
    );


-- ============================================================================
-- T008: Feature 006 RBAC Permissions & Role Mappings (16 Keys)
-- ============================================================================
INSERT INTO public.permissions (id, category, description) VALUES
    ('invoices:read', 'invoices', 'View invoices, details, and print/PDF views'),
    ('invoices:create', 'invoices', 'Create draft invoices and duplicate invoices'),
    ('invoices:update', 'invoices', 'Edit or delete unissued draft invoices'),
    ('invoices:issue', 'invoices', 'Issue draft invoices into immutable billing records'),
    ('invoices:cancel', 'invoices', 'Cancel unpaid issued invoices'),
    ('invoice_payments:read', 'invoice_payments', 'View invoice payments and payment receipts'),
    ('invoice_payments:create', 'invoice_payments', 'Record partial or full payments on issued invoices'),
    ('invoice_payments:reverse', 'invoice_payments', 'Reverse recorded invoice payments with reason'),
    ('expenses:read', 'expenses', 'View expense lists, details, and attachments'),
    ('expenses:create', 'expenses', 'Record new expenses and attach receipts'),
    ('expenses:update', 'expenses', 'Update active expenses and manage attachments'),
    ('expenses:pay', 'expenses', 'Mark unpaid expenses as paid'),
    ('expenses:void', 'expenses', 'Void unpaid erroneous expenses or correct paid expenses with reason'),
    ('expense_categories:read', 'expense_categories', 'View expense categories'),
    ('expense_categories:manage', 'expense_categories', 'Create, edit, and archive expense categories'),
    ('financial_summaries:read', 'financial_summaries', 'View Invoice & Expense financial summary dashboard')
ON CONFLICT (id) DO NOTHING;

-- Admin: all 16 permissions
INSERT INTO public.role_permissions (role, permission_id) VALUES
    ('admin', 'invoices:read'),
    ('admin', 'invoices:create'),
    ('admin', 'invoices:update'),
    ('admin', 'invoices:issue'),
    ('admin', 'invoices:cancel'),
    ('admin', 'invoice_payments:read'),
    ('admin', 'invoice_payments:create'),
    ('admin', 'invoice_payments:reverse'),
    ('admin', 'expenses:read'),
    ('admin', 'expenses:create'),
    ('admin', 'expenses:update'),
    ('admin', 'expenses:pay'),
    ('admin', 'expenses:void'),
    ('admin', 'expense_categories:read'),
    ('admin', 'expense_categories:manage'),
    ('admin', 'financial_summaries:read')
ON CONFLICT (role, permission_id) DO NOTHING;

-- Manager: 12 operational permissions (no reverse, no expense void/correct, no category manage, no summary)
INSERT INTO public.role_permissions (role, permission_id) VALUES
    ('manager', 'invoices:read'),
    ('manager', 'invoices:create'),
    ('manager', 'invoices:update'),
    ('manager', 'invoices:issue'),
    ('manager', 'invoices:cancel'),
    ('manager', 'invoice_payments:read'),
    ('manager', 'invoice_payments:create'),
    ('manager', 'expenses:read'),
    ('manager', 'expenses:create'),
    ('manager', 'expenses:update'),
    ('manager', 'expenses:pay'),
    ('manager', 'expense_categories:read')
ON CONFLICT (role, permission_id) DO NOTHING;
-- Cashier intentionally receives 0 Feature 006 permissions; Owner dynamically resolves all registered keys.


-- ============================================================================
-- T009: Internal Helpers (_f006_next_sequence, _f006_compute_invoice_totals)
-- ============================================================================
CREATE OR REPLACE FUNCTION public._f006_next_sequence(
    p_org_id        UUID,
    p_sequence_type TEXT,
    p_timezone      TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_prefix   TEXT;
    v_tz       TEXT;
    v_date_key DATE;
    v_next     INTEGER;
BEGIN
    v_prefix := CASE p_sequence_type
        WHEN 'invoice' THEN 'INV'
        WHEN 'invoice_payment' THEN 'IPAY'
        WHEN 'expense' THEN 'EXP'
        ELSE NULL
    END;

    IF v_prefix IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_SEQUENCE_TYPE';
    END IF;

    v_tz := COALESCE(NULLIF(trim(p_timezone), ''), 'UTC');
    v_date_key := (now() AT TIME ZONE v_tz)::DATE;

    INSERT INTO public.financial_sequences (organization_id, sequence_type, date_key, last_number)
    VALUES (p_org_id, p_sequence_type, v_date_key, 1)
    ON CONFLICT (organization_id, sequence_type, date_key)
    DO UPDATE SET
        last_number = public.financial_sequences.last_number + 1,
        updated_at = now()
    RETURNING last_number INTO v_next;

    RETURN v_prefix || '-' || to_char(v_date_key, 'YYYYMMDD') || '-' || lpad(v_next::text, 4, '0');
END;
$$;

ALTER FUNCTION public._f006_next_sequence(UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._f006_next_sequence(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;


CREATE OR REPLACE FUNCTION public._f006_compute_invoice_totals(
    p_org_id                  UUID,
    p_currency                TEXT,
    p_items                   JSONB,
    p_invoice_discount_amount NUMERIC,
    p_is_tax_exempt           BOOLEAN,
    p_tax_rate                NUMERIC,
    p_is_tax_inclusive        BOOLEAN,
    p_enforce_active_products BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_decimals           INTEGER;
    v_eff_rate           NUMERIC(6, 4);
    v_inv_disc           NUMERIC(14, 4);
    v_subtotal           NUMERIC(14, 4) := 0.0000;
    v_total_taxable      NUMERIC(14, 4) := 0.0000;
    v_total_tax          NUMERIC(14, 4) := 0.0000;
    v_total_amount       NUMERIC(14, 4) := 0.0000;
    v_pre_lines          JSONB := '[]'::jsonb;
    v_final_lines        JSONB := '[]'::jsonb;
    v_last_pos_idx       INTEGER := -1;
    v_idx                INTEGER := 0;
    v_running_disc       NUMERIC(14, 4) := 0.0000;
    v_elem               JSONB;
    v_prod_id            UUID;
    v_prod               RECORD;
    v_desc               TEXT;
    v_qty                NUMERIC;
    v_unit_price         NUMERIC;
    v_line_disc_raw      NUMERIC;
    v_is_taxable         BOOLEAN;
    v_sku_snap           TEXT;
    v_uom_snap           TEXT;
    v_line_gross         NUMERIC(14, 4);
    v_line_disc          NUMERIC(14, 4);
    v_line_net           NUMERIC(14, 4);
    v_alloc_disc         NUMERIC(14, 4);
    v_line_discounted    NUMERIC(14, 4);
    v_taxable_i          NUMERIC(14, 4);
    v_tax_i              NUMERIC(14, 4);
    v_total_i            NUMERIC(14, 4);
BEGIN
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_ITEMS_PAYLOAD';
    END IF;

    v_decimals := public.get_currency_exponent(p_currency);
    v_inv_disc := round(COALESCE(p_invoice_discount_amount, 0.0000), v_decimals);

    IF v_inv_disc < 0.0000 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0007', MESSAGE = 'INVALID_FINANCIAL_AMOUNT';
    END IF;

    IF COALESCE(p_invoice_discount_amount, 0.0000) <> 0.0000 AND trunc(p_invoice_discount_amount, 4) <> p_invoice_discount_amount THEN
        RAISE EXCEPTION USING ERRCODE = 'P0016', MESSAGE = 'DECIMAL_PRECISION_EXCEEDED';
    END IF;

    -- Pass 1: Validate lines in deterministic sort_order ASC
    FOR v_elem IN
        SELECT value
        FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(value, ord)
        ORDER BY COALESCE((value->>'sort_order')::integer, (ord - 1)::integer) ASC, ord ASC
    LOOP
        v_desc := trim(COALESCE(v_elem->>'description', ''));
        IF length(v_desc) < 1 OR length(v_desc) > 255 THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_LINE_DESCRIPTION';
        END IF;

        v_qty := (v_elem->>'quantity')::numeric;
        IF v_qty IS NULL OR v_qty <= 0.0000 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0012', MESSAGE = 'NON_POSITIVE_QUANTITY';
        END IF;
        IF v_qty > 999999999.9999 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0028', MESSAGE = 'QUANTITY_EXCEEDS_MAXIMUM';
        END IF;
        IF trunc(v_qty, 4) <> v_qty THEN
            RAISE EXCEPTION USING ERRCODE = 'P0016', MESSAGE = 'DECIMAL_PRECISION_EXCEEDED';
        END IF;

        v_unit_price := (v_elem->>'unit_price')::numeric;
        IF v_unit_price IS NULL OR v_unit_price < 0.0000 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0007', MESSAGE = 'INVALID_FINANCIAL_AMOUNT';
        END IF;
        IF trunc(v_unit_price, 4) <> v_unit_price THEN
            RAISE EXCEPTION USING ERRCODE = 'P0016', MESSAGE = 'DECIMAL_PRECISION_EXCEEDED';
        END IF;

        v_line_disc_raw := COALESCE((v_elem->>'line_discount_amount')::numeric, 0.0000);
        IF v_line_disc_raw < 0.0000 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0007', MESSAGE = 'INVALID_FINANCIAL_AMOUNT';
        END IF;
        IF trunc(v_line_disc_raw, 4) <> v_line_disc_raw THEN
            RAISE EXCEPTION USING ERRCODE = 'P0016', MESSAGE = 'DECIMAL_PRECISION_EXCEEDED';
        END IF;

        v_is_taxable := COALESCE((v_elem->>'is_taxable')::boolean, true);

        v_prod_id := NULLIF(trim(COALESCE(v_elem->>'product_id', '')), '')::uuid;
        v_sku_snap := NULL;
        v_uom_snap := NULL;

        IF v_prod_id IS NOT NULL THEN
            SELECT id, sku, unit_of_measure, status
            INTO v_prod
            FROM public.products
            WHERE organization_id = p_org_id AND id = v_prod_id;

            IF NOT FOUND THEN
                RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'PRODUCT_NOT_FOUND';
            END IF;

            IF p_enforce_active_products AND v_prod.status <> 'active' THEN
                RAISE EXCEPTION USING ERRCODE = 'P0086', MESSAGE = 'PRODUCT_UNAVAILABLE_FOR_INVOICE';
            END IF;

            v_sku_snap := v_prod.sku;
            v_uom_snap := v_prod.unit_of_measure;
        END IF;

        v_line_gross := round(v_qty * v_unit_price, v_decimals);
        v_line_disc := round(v_line_disc_raw, v_decimals);

        IF v_line_disc > v_line_gross THEN
            RAISE EXCEPTION USING ERRCODE = 'P0047', MESSAGE = 'DISCOUNT_EXCEEDS_MAXIMUM';
        END IF;

        v_line_net := v_line_gross - v_line_disc;
        v_subtotal := v_subtotal + v_line_net;

        IF v_line_net > 0.0000 THEN
            v_last_pos_idx := v_idx;
        END IF;

        v_pre_lines := v_pre_lines || jsonb_build_object(
            'sort_order', v_idx,
            'product_id', v_prod_id,
            'sku_snapshot', v_sku_snap,
            'unit_of_measure_snapshot', v_uom_snap,
            'description', v_desc,
            'quantity', to_char(v_qty, 'FM9999999990.0000'),
            'unit_price', to_char(round(v_unit_price, 4), 'FM9999999990.0000'),
            'line_discount_amount', to_char(v_line_disc, 'FM9999999990.0000'),
            'line_net', to_char(v_line_net, 'FM9999999990.0000'),
            'is_taxable', v_is_taxable
        );

        v_idx := v_idx + 1;
    END LOOP;

    IF v_inv_disc > v_subtotal THEN
        RAISE EXCEPTION USING ERRCODE = 'P0047', MESSAGE = 'DISCOUNT_EXCEEDS_MAXIMUM';
    END IF;

    v_eff_rate := CASE
        WHEN COALESCE(p_is_tax_exempt, false) THEN 0.0000
        ELSE COALESCE(p_tax_rate, 0.0000)
    END;

    -- Pass 2: Proportional invoice discount allocation (residual absorbed on last positive line k) & tax
    FOR v_elem IN
        SELECT value FROM jsonb_array_elements(v_pre_lines) AS value
    LOOP
        v_idx := (v_elem->>'sort_order')::integer;
        v_line_net := (v_elem->>'line_net')::numeric;
        v_is_taxable := (v_elem->>'is_taxable')::boolean;

        IF v_subtotal <= 0.0000 OR v_inv_disc = 0.0000 OR v_line_net <= 0.0000 THEN
            v_alloc_disc := 0.0000;
        ELSIF v_idx = v_last_pos_idx THEN
            v_alloc_disc := GREATEST(0.0000, LEAST(v_line_net, round(v_inv_disc - v_running_disc, v_decimals)));
        ELSE
            v_alloc_disc := LEAST(v_line_net, round((v_line_net / v_subtotal) * v_inv_disc, v_decimals));
            v_running_disc := v_running_disc + v_alloc_disc;
        END IF;

        v_line_discounted := GREATEST(0.0000, v_line_net - v_alloc_disc);

        IF NOT v_is_taxable THEN
            v_taxable_i := 0.0000;
            v_tax_i := 0.0000;
            v_total_i := v_line_discounted;
        ELSIF v_eff_rate = 0.0000 OR v_line_discounted = 0.0000 THEN
            v_taxable_i := v_line_discounted;
            v_tax_i := 0.0000;
            v_total_i := v_line_discounted;
        ELSIF COALESCE(p_is_tax_inclusive, false) THEN
            v_taxable_i := round(v_line_discounted / (1.0000 + (v_eff_rate / 100.0000)), v_decimals);
            v_tax_i := v_line_discounted - v_taxable_i;
            v_total_i := v_line_discounted;
        ELSE
            v_taxable_i := v_line_discounted;
            v_tax_i := round(v_line_discounted * (v_eff_rate / 100.0000), v_decimals);
            v_total_i := v_taxable_i + v_tax_i;
        END IF;

        v_total_taxable := v_total_taxable + v_taxable_i;
        v_total_tax := v_total_tax + v_tax_i;
        v_total_amount := v_total_amount + v_total_i;

        v_final_lines := v_final_lines || jsonb_build_object(
            'sort_order', v_idx,
            'product_id', v_elem->'product_id',
            'sku_snapshot', v_elem->'sku_snapshot',
            'unit_of_measure_snapshot', v_elem->'unit_of_measure_snapshot',
            'description', v_elem->'description',
            'quantity', v_elem->'quantity',
            'unit_price', v_elem->'unit_price',
            'line_discount_amount', v_elem->'line_discount_amount',
            'allocated_invoice_disc', to_char(v_alloc_disc, 'FM9999999990.0000'),
            'is_taxable', v_is_taxable,
            'taxable_amount', to_char(v_taxable_i, 'FM9999999990.0000'),
            'allocated_tax_amount', to_char(v_tax_i, 'FM9999999990.0000'),
            'total_price', to_char(v_total_i, 'FM9999999990.0000')
        );
    END LOOP;

    RETURN jsonb_build_object(
        'subtotal', to_char(v_subtotal, 'FM9999999990.0000'),
        'invoice_discount_amount', to_char(v_inv_disc, 'FM9999999990.0000'),
        'taxable_amount', to_char(v_total_taxable, 'FM9999999990.0000'),
        'tax_amount', to_char(v_total_tax, 'FM9999999990.0000'),
        'total_amount', to_char(v_total_amount, 'FM9999999990.0000'),
        'items', v_final_lines
    );
END;
$$;

ALTER FUNCTION public._f006_compute_invoice_totals(UUID, TEXT, JSONB, NUMERIC, BOOLEAN, NUMERIC, BOOLEAN, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._f006_compute_invoice_totals(UUID, TEXT, JSONB, NUMERIC, BOOLEAN, NUMERIC, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;


-- ============================================================================
-- T010: P0 Invoice Draft & Query RPCs
--   - public.create_invoice
--   - public.update_invoice
--   - public.delete_draft_invoice
--   - public.get_invoice_detail
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_invoice(
    p_org_id                  UUID,
    p_customer_id             UUID,
    p_issue_date              DATE,
    p_due_date                DATE,
    p_items                   JSONB,
    p_invoice_discount_amount NUMERIC,
    p_is_tax_exempt           BOOLEAN,
    p_notes                   TEXT,
    p_payment_instructions    TEXT,
    p_idempotency_key         UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_org           RECORD;
    v_customer      RECORD;
    v_tax_name      TEXT := 'VAT';
    v_tax_rate      NUMERIC(6, 4) := 0.0000;
    v_is_tax_incl   BOOLEAN := false;
    v_calc          JSONB;
    v_norm_items    JSONB;
    v_canon_hash    TEXT;
    v_existing      RECORD;
    v_inv_id        UUID;
    v_total_amount  NUMERIC(14, 4);
    v_item          JSONB;
    v_notes         TEXT;
    v_instr         TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

    SELECT id, currency, timezone INTO v_org
    FROM public.organizations
    WHERE id = p_org_id AND is_active = TRUE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ORGANIZATION_INACTIVE';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_memberships
        WHERE organization_id = p_org_id AND user_id = auth.uid() AND status = 'active'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'MEMBERSHIP_INACTIVE';
    END IF;

    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'invoices:create') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0055', MESSAGE = 'IDEMPOTENCY_KEY_REQUIRED';
    END IF;

    IF p_items IS NOT NULL AND jsonb_typeof(p_items) <> 'array' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_ITEMS_PAYLOAD';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_idempotency_key::text));

    v_notes := NULLIF(trim(COALESCE(p_notes, '')), '');
    v_instr := NULLIF(trim(COALESCE(p_payment_instructions, '')), '');

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'sort_order', COALESCE((value->>'sort_order')::integer, (ord - 1)::integer),
            'product_id', NULLIF(trim(COALESCE(value->>'product_id', '')), ''),
            'description', trim(COALESCE(value->>'description', '')),
            'quantity', to_char((value->>'quantity')::numeric, 'FM9999999990.0000'),
            'unit_price', to_char((value->>'unit_price')::numeric, 'FM9999999990.0000'),
            'line_discount_amount', to_char(COALESCE((value->>'line_discount_amount')::numeric, 0.0000), 'FM9999999990.0000'),
            'is_taxable', COALESCE((value->>'is_taxable')::boolean, true)
        ) ORDER BY COALESCE((value->>'sort_order')::integer, (ord - 1)::integer) ASC, trim(COALESCE(value->>'description', '')) ASC
    ), '[]'::jsonb)
    INTO v_norm_items
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) WITH ORDINALITY AS t(value, ord);

    v_canon_hash := encode(sha256(convert_to(
        jsonb_build_object(
            'op', 'create_invoice',
            'org_id', p_org_id::text,
            'customer_id', p_customer_id::text,
            'issue_date', p_issue_date::text,
            'due_date', p_due_date::text,
            'items', v_norm_items,
            'invoice_discount_amount', to_char(COALESCE(p_invoice_discount_amount, 0.0000), 'FM9999999990.0000'),
            'is_tax_exempt', COALESCE(p_is_tax_exempt, false),
            'notes', v_notes,
            'payment_instructions', v_instr
        )::text,
        'UTF8'
    )), 'hex');

    SELECT * INTO v_existing
    FROM public.invoices
    WHERE organization_id = p_org_id AND draft_idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_existing.draft_idempotency_hash = v_canon_hash THEN
            RETURN jsonb_build_object(
                'success', true,
                'is_replay', true,
                'invoice_id', v_existing.id,
                'invoice_number', v_existing.invoice_number,
                'status', v_existing.status,
                'currency', v_existing.currency,
                'subtotal', to_char(v_existing.subtotal, 'FM9999999990.0000'),
                'tax_amount', to_char(v_existing.tax_amount, 'FM9999999990.0000'),
                'total_amount', to_char(v_existing.total_amount, 'FM9999999990.0000'),
                'outstanding_balance', to_char(v_existing.outstanding_balance, 'FM9999999990.0000')
            );
        ELSE
            RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
        END IF;
    END IF;

    IF p_issue_date IS NULL OR p_due_date IS NULL OR p_due_date < p_issue_date THEN
        RAISE EXCEPTION USING ERRCODE = 'P0071', MESSAGE = 'INVALID_DATE_RANGE';
    END IF;

    SELECT id, name, email, phone, status INTO v_customer
    FROM public.customers
    WHERE organization_id = p_org_id AND id = p_customer_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0040', MESSAGE = 'CUSTOMER_NOT_FOUND';
    END IF;
    IF v_customer.status = 'archived' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0041', MESSAGE = 'CUSTOMER_ARCHIVED';
    END IF;

    SELECT tax_name, default_tax_rate, is_tax_inclusive
    INTO v_tax_name, v_tax_rate, v_is_tax_incl
    FROM public.organization_tax_settings
    WHERE organization_id = p_org_id;

    IF NOT FOUND THEN
        v_tax_name := 'VAT';
        v_tax_rate := 0.0000;
        v_is_tax_incl := false;
    END IF;

    v_calc := public._f006_compute_invoice_totals(
        p_org_id, v_org.currency, COALESCE(p_items, '[]'::jsonb),
        p_invoice_discount_amount, COALESCE(p_is_tax_exempt, false),
        v_tax_rate, v_is_tax_incl, true
    );

    v_total_amount := (v_calc->>'total_amount')::numeric;
    v_inv_id := gen_random_uuid();

    INSERT INTO public.invoices (
        id, organization_id, invoice_number, customer_id,
        customer_name_snapshot, customer_email_snapshot, customer_phone_snapshot,
        issue_date, due_date, status, currency,
        tax_name, tax_rate, is_tax_inclusive, is_tax_exempt,
        subtotal, invoice_discount_amount, taxable_amount, tax_amount,
        total_amount, paid_amount, outstanding_balance,
        notes, payment_instructions,
        draft_idempotency_key, draft_idempotency_hash,
        created_by, updated_by
    ) VALUES (
        v_inv_id, p_org_id, NULL, p_customer_id,
        v_customer.name, v_customer.email, v_customer.phone,
        p_issue_date, p_due_date, 'draft', v_org.currency,
        v_tax_name, v_tax_rate, v_is_tax_incl, COALESCE(p_is_tax_exempt, false),
        (v_calc->>'subtotal')::numeric,
        (v_calc->>'invoice_discount_amount')::numeric,
        (v_calc->>'taxable_amount')::numeric,
        (v_calc->>'tax_amount')::numeric,
        v_total_amount, 0.0000, v_total_amount,
        v_notes, v_instr,
        p_idempotency_key, v_canon_hash,
        auth.uid(), auth.uid()
    );

    FOR v_item IN SELECT value FROM jsonb_array_elements(v_calc->'items') AS value
    LOOP
        INSERT INTO public.invoice_items (
            organization_id, invoice_id, sort_order, product_id,
            sku_snapshot, unit_of_measure_snapshot, description,
            quantity, unit_price, line_discount_amount,
            allocated_invoice_disc, is_taxable, taxable_amount,
            allocated_tax_amount, total_price
        ) VALUES (
            p_org_id, v_inv_id,
            (v_item->>'sort_order')::integer,
            NULLIF(v_item->>'product_id', '')::uuid,
            NULLIF(v_item->>'sku_snapshot', ''),
            NULLIF(v_item->>'unit_of_measure_snapshot', ''),
            v_item->>'description',
            (v_item->>'quantity')::numeric,
            (v_item->>'unit_price')::numeric,
            (v_item->>'line_discount_amount')::numeric,
            (v_item->>'allocated_invoice_disc')::numeric,
            (v_item->>'is_taxable')::boolean,
            (v_item->>'taxable_amount')::numeric,
            (v_item->>'allocated_tax_amount')::numeric,
            (v_item->>'total_price')::numeric
        );
    END LOOP;

    INSERT INTO public.organization_audit_events (organization_id, actor_id, event_type, metadata)
    VALUES (
        p_org_id, auth.uid(), 'invoice.created',
        jsonb_build_object(
            'invoice_id', v_inv_id,
            'customer_id', p_customer_id,
            'total_amount', v_calc->>'total_amount',
            'currency', v_org.currency
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'is_replay', false,
        'invoice_id', v_inv_id,
        'invoice_number', NULL,
        'status', 'draft',
        'currency', v_org.currency,
        'subtotal', v_calc->>'subtotal',
        'tax_amount', v_calc->>'tax_amount',
        'total_amount', v_calc->>'total_amount',
        'outstanding_balance', v_calc->>'total_amount'
    );
END;
$$;


CREATE OR REPLACE FUNCTION public.update_invoice(
    p_org_id                  UUID,
    p_invoice_id              UUID,
    p_customer_id             UUID,
    p_issue_date              DATE,
    p_due_date                DATE,
    p_items                   JSONB,
    p_invoice_discount_amount NUMERIC,
    p_is_tax_exempt           BOOLEAN,
    p_notes                   TEXT,
    p_payment_instructions    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_org           RECORD;
    v_inv           RECORD;
    v_customer      RECORD;
    v_tax_name      TEXT := 'VAT';
    v_tax_rate      NUMERIC(6, 4) := 0.0000;
    v_is_tax_incl   BOOLEAN := false;
    v_calc          JSONB;
    v_total_amount  NUMERIC(14, 4);
    v_item          JSONB;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

    SELECT id, currency INTO v_org
    FROM public.organizations
    WHERE id = p_org_id AND is_active = TRUE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ORGANIZATION_INACTIVE';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_memberships
        WHERE organization_id = p_org_id AND user_id = auth.uid() AND status = 'active'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'MEMBERSHIP_INACTIVE';
    END IF;

    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'invoices:update') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    SELECT * INTO v_inv
    FROM public.invoices
    WHERE organization_id = p_org_id AND id = p_invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0070', MESSAGE = 'INVOICE_NOT_FOUND';
    END IF;

    IF v_inv.status <> 'draft' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0072', MESSAGE = 'INVOICE_IMMUTABLE_AFTER_ISSUANCE';
    END IF;

    IF p_issue_date IS NULL OR p_due_date IS NULL OR p_due_date < p_issue_date THEN
        RAISE EXCEPTION USING ERRCODE = 'P0071', MESSAGE = 'INVALID_DATE_RANGE';
    END IF;

    SELECT id, name, email, phone, status INTO v_customer
    FROM public.customers
    WHERE organization_id = p_org_id AND id = p_customer_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0040', MESSAGE = 'CUSTOMER_NOT_FOUND';
    END IF;
    IF v_customer.status = 'archived' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0041', MESSAGE = 'CUSTOMER_ARCHIVED';
    END IF;

    SELECT tax_name, default_tax_rate, is_tax_inclusive
    INTO v_tax_name, v_tax_rate, v_is_tax_incl
    FROM public.organization_tax_settings
    WHERE organization_id = p_org_id;

    IF NOT FOUND THEN
        v_tax_name := 'VAT';
        v_tax_rate := 0.0000;
        v_is_tax_incl := false;
    END IF;

    v_calc := public._f006_compute_invoice_totals(
        p_org_id, v_org.currency, COALESCE(p_items, '[]'::jsonb),
        p_invoice_discount_amount, COALESCE(p_is_tax_exempt, false),
        v_tax_rate, v_is_tax_incl, true
    );

    v_total_amount := (v_calc->>'total_amount')::numeric;

    UPDATE public.invoices SET
        customer_id = p_customer_id,
        customer_name_snapshot = v_customer.name,
        customer_email_snapshot = v_customer.email,
        customer_phone_snapshot = v_customer.phone,
        issue_date = p_issue_date,
        due_date = p_due_date,
        tax_name = v_tax_name,
        tax_rate = v_tax_rate,
        is_tax_inclusive = v_is_tax_incl,
        is_tax_exempt = COALESCE(p_is_tax_exempt, false),
        subtotal = (v_calc->>'subtotal')::numeric,
        invoice_discount_amount = (v_calc->>'invoice_discount_amount')::numeric,
        taxable_amount = (v_calc->>'taxable_amount')::numeric,
        tax_amount = (v_calc->>'tax_amount')::numeric,
        total_amount = v_total_amount,
        outstanding_balance = v_total_amount,
        notes = NULLIF(trim(COALESCE(p_notes, '')), ''),
        payment_instructions = NULLIF(trim(COALESCE(p_payment_instructions, '')), ''),
        updated_by = auth.uid()
    WHERE id = p_invoice_id;

    DELETE FROM public.invoice_items
    WHERE organization_id = p_org_id AND invoice_id = p_invoice_id;

    FOR v_item IN SELECT value FROM jsonb_array_elements(v_calc->'items') AS value
    LOOP
        INSERT INTO public.invoice_items (
            organization_id, invoice_id, sort_order, product_id,
            sku_snapshot, unit_of_measure_snapshot, description,
            quantity, unit_price, line_discount_amount,
            allocated_invoice_disc, is_taxable, taxable_amount,
            allocated_tax_amount, total_price
        ) VALUES (
            p_org_id, p_invoice_id,
            (v_item->>'sort_order')::integer,
            NULLIF(v_item->>'product_id', '')::uuid,
            NULLIF(v_item->>'sku_snapshot', ''),
            NULLIF(v_item->>'unit_of_measure_snapshot', ''),
            v_item->>'description',
            (v_item->>'quantity')::numeric,
            (v_item->>'unit_price')::numeric,
            (v_item->>'line_discount_amount')::numeric,
            (v_item->>'allocated_invoice_disc')::numeric,
            (v_item->>'is_taxable')::boolean,
            (v_item->>'taxable_amount')::numeric,
            (v_item->>'allocated_tax_amount')::numeric,
            (v_item->>'total_price')::numeric
        );
    END LOOP;

    INSERT INTO public.organization_audit_events (organization_id, actor_id, event_type, metadata)
    VALUES (
        p_org_id, auth.uid(), 'invoice.updated',
        jsonb_build_object('invoice_id', p_invoice_id, 'total_amount', v_calc->>'total_amount')
    );

    RETURN jsonb_build_object(
        'success', true,
        'invoice_id', p_invoice_id,
        'status', 'draft',
        'currency', v_org.currency,
        'subtotal', v_calc->>'subtotal',
        'tax_amount', v_calc->>'tax_amount',
        'total_amount', v_calc->>'total_amount',
        'outstanding_balance', v_calc->>'total_amount'
    );
END;
$$;


CREATE OR REPLACE FUNCTION public.delete_draft_invoice(
    p_org_id     UUID,
    p_invoice_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_inv RECORD;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

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

    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'invoices:update') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    SELECT * INTO v_inv
    FROM public.invoices
    WHERE organization_id = p_org_id AND id = p_invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0070', MESSAGE = 'INVOICE_NOT_FOUND';
    END IF;

    IF v_inv.status <> 'draft' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0072', MESSAGE = 'INVOICE_IMMUTABLE_AFTER_ISSUANCE';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.invoice_payments
        WHERE organization_id = p_org_id AND invoice_id = p_invoice_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0076', MESSAGE = 'INVOICE_HAS_ACTIVE_PAYMENTS';
    END IF;

    DELETE FROM public.invoices
    WHERE organization_id = p_org_id AND id = p_invoice_id;

    INSERT INTO public.organization_audit_events (organization_id, actor_id, event_type, metadata)
    VALUES (
        p_org_id, auth.uid(), 'invoice.draft_deleted',
        jsonb_build_object('invoice_id', p_invoice_id, 'customer_id', v_inv.customer_id)
    );

    RETURN jsonb_build_object('success', true, 'invoice_id', p_invoice_id, 'deleted', true);
END;
$$;


CREATE OR REPLACE FUNCTION public.get_invoice_detail(
    p_org_id     UUID,
    p_invoice_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_org           RECORD;
    v_inv           RECORD;
    v_org_today     DATE;
    v_is_overdue    BOOLEAN;
    v_items         JSONB;
    v_payments      JSONB := '[]'::jsonb;
    v_can_view_pay  BOOLEAN;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

    SELECT id, name, address, phone, email, tax_id, currency, timezone
    INTO v_org
    FROM public.organizations
    WHERE id = p_org_id AND is_active = TRUE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ORGANIZATION_INACTIVE';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_memberships
        WHERE organization_id = p_org_id AND user_id = auth.uid() AND status = 'active'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'MEMBERSHIP_INACTIVE';
    END IF;

    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'invoices:read') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    SELECT * INTO v_inv
    FROM public.invoices
    WHERE organization_id = p_org_id AND id = p_invoice_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0070', MESSAGE = 'INVOICE_NOT_FOUND';
    END IF;

    v_org_today := (now() AT TIME ZONE COALESCE(NULLIF(trim(v_org.timezone), ''), 'UTC'))::DATE;
    v_is_overdue := (v_inv.status IN ('issued', 'partially_paid') AND v_inv.due_date < v_org_today);

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', ii.id,
            'sort_order', ii.sort_order,
            'product_id', ii.product_id,
            'sku_snapshot', ii.sku_snapshot,
            'unit_of_measure_snapshot', ii.unit_of_measure_snapshot,
            'description', ii.description,
            'quantity', to_char(ii.quantity, 'FM9999999990.0000'),
            'unit_price', to_char(ii.unit_price, 'FM9999999990.0000'),
            'line_discount_amount', to_char(ii.line_discount_amount, 'FM9999999990.0000'),
            'allocated_invoice_disc', to_char(ii.allocated_invoice_disc, 'FM9999999990.0000'),
            'is_taxable', ii.is_taxable,
            'taxable_amount', to_char(ii.taxable_amount, 'FM9999999990.0000'),
            'allocated_tax_amount', to_char(ii.allocated_tax_amount, 'FM9999999990.0000'),
            'total_price', to_char(ii.total_price, 'FM9999999990.0000')
        ) ORDER BY ii.sort_order ASC, ii.id ASC
    ), '[]'::jsonb)
    INTO v_items
    FROM public.invoice_items ii
    WHERE ii.organization_id = p_org_id AND ii.invoice_id = p_invoice_id;

    v_can_view_pay := public.check_user_permission(p_org_id, auth.uid(), 'invoice_payments:read');
    IF v_can_view_pay THEN
        SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'id', ip.id,
                'payment_number', ip.payment_number,
                'payment_method', ip.payment_method,
                'amount', to_char(ip.amount, 'FM9999999990.0000'),
                'balance_after_payment', to_char(ip.balance_after_payment, 'FM9999999990.0000'),
                'payment_date', ip.payment_date,
                'reference_no', ip.reference_no,
                'notes', ip.notes,
                'status', ip.status,
                'reversed_at', ip.reversed_at,
                'reversed_by', ip.reversed_by,
                'reversal_reason', ip.reversal_reason,
                'created_by', ip.created_by,
                'created_at', ip.created_at
            ) ORDER BY ip.created_at ASC
        ), '[]'::jsonb)
        INTO v_payments
        FROM public.invoice_payments ip
        WHERE ip.organization_id = p_org_id AND ip.invoice_id = p_invoice_id;
    END IF;

    RETURN jsonb_build_object(
        'invoice', jsonb_build_object(
            'id', v_inv.id,
            'organization_id', v_inv.organization_id,
            'invoice_number', v_inv.invoice_number,
            'customer_id', v_inv.customer_id,
            'customer_name_snapshot', v_inv.customer_name_snapshot,
            'customer_email_snapshot', v_inv.customer_email_snapshot,
            'customer_phone_snapshot', v_inv.customer_phone_snapshot,
            'issue_date', v_inv.issue_date,
            'due_date', v_inv.due_date,
            'status', v_inv.status,
            'is_overdue', v_is_overdue,
            'currency', v_inv.currency,
            'tax_name', v_inv.tax_name,
            'tax_rate', to_char(v_inv.tax_rate, 'FM990.0000'),
            'is_tax_inclusive', v_inv.is_tax_inclusive,
            'is_tax_exempt', v_inv.is_tax_exempt,
            'subtotal', to_char(v_inv.subtotal, 'FM9999999990.0000'),
            'invoice_discount_amount', to_char(v_inv.invoice_discount_amount, 'FM9999999990.0000'),
            'taxable_amount', to_char(v_inv.taxable_amount, 'FM9999999990.0000'),
            'tax_amount', to_char(v_inv.tax_amount, 'FM9999999990.0000'),
            'total_amount', to_char(v_inv.total_amount, 'FM9999999990.0000'),
            'paid_amount', to_char(v_inv.paid_amount, 'FM9999999990.0000'),
            'outstanding_balance', to_char(v_inv.outstanding_balance, 'FM9999999990.0000'),
            'notes', v_inv.notes,
            'payment_instructions', v_inv.payment_instructions,
            'issued_at', v_inv.issued_at,
            'issued_by', v_inv.issued_by,
            'paid_at', v_inv.paid_at,
            'cancelled_at', v_inv.cancelled_at,
            'cancelled_by', v_inv.cancelled_by,
            'cancellation_reason', v_inv.cancellation_reason,
            'created_by', v_inv.created_by,
            'created_at', v_inv.created_at,
            'updated_at', v_inv.updated_at
        ),
        'organization', jsonb_build_object(
            'id', v_org.id,
            'name', v_org.name,
            'address', v_org.address,
            'phone', v_org.phone,
            'email', v_org.email,
            'tax_id', v_org.tax_id,
            'currency', v_org.currency,
            'timezone', v_org.timezone
        ),
        'items', v_items,
        'payments', v_payments
    );
END;
$$;


-- ============================================================================
-- T011: P0 Invoice Lifecycle RPCs (public.issue_invoice, public.cancel_invoice)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.issue_invoice(
    p_org_id          UUID,
    p_invoice_id      UUID,
    p_idempotency_key UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_org           RECORD;
    v_inv           RECORD;
    v_customer      RECORD;
    v_tax_name      TEXT := 'VAT';
    v_tax_rate      NUMERIC(6, 4) := 0.0000;
    v_is_tax_incl   BOOLEAN := false;
    v_canon_hash    TEXT;
    v_items_jsonb   JSONB;
    v_calc          JSONB;
    v_inv_number    TEXT;
    v_total_amount  NUMERIC(14, 4);
    v_new_status    TEXT;
    v_item          JSONB;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

    SELECT id, currency, timezone INTO v_org
    FROM public.organizations
    WHERE id = p_org_id AND is_active = TRUE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ORGANIZATION_INACTIVE';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_memberships
        WHERE organization_id = p_org_id AND user_id = auth.uid() AND status = 'active'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'MEMBERSHIP_INACTIVE';
    END IF;

    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'invoices:issue') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0055', MESSAGE = 'IDEMPOTENCY_KEY_REQUIRED';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_idempotency_key::text));

    v_canon_hash := encode(sha256(convert_to(
        jsonb_build_object(
            'op', 'issue_invoice',
            'org_id', p_org_id::text,
            'invoice_id', p_invoice_id::text
        )::text,
        'UTF8'
    )), 'hex');

    -- Case C: Cross-record key collision check
    IF EXISTS (
        SELECT 1 FROM public.invoices
        WHERE organization_id = p_org_id
          AND issue_idempotency_key = p_idempotency_key
          AND id <> p_invoice_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
    END IF;

    SELECT * INTO v_inv
    FROM public.invoices
    WHERE organization_id = p_org_id AND id = p_invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0070', MESSAGE = 'INVOICE_NOT_FOUND';
    END IF;

    -- Case A / Case B
    IF v_inv.issue_idempotency_key = p_idempotency_key THEN
        IF v_inv.issue_idempotency_hash = v_canon_hash THEN
            RETURN jsonb_build_object(
                'success', true,
                'is_replay', true,
                'invoice_id', v_inv.id,
                'invoice_number', v_inv.invoice_number,
                'status', v_inv.status,
                'currency', v_inv.currency,
                'total_amount', to_char(v_inv.total_amount, 'FM9999999990.0000'),
                'outstanding_balance', to_char(v_inv.outstanding_balance, 'FM9999999990.0000'),
                'issued_at', v_inv.issued_at
            );
        ELSE
            RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
        END IF;
    END IF;

    -- Case D: State Validation
    IF v_inv.status <> 'draft' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0072', MESSAGE = 'INVOICE_IMMUTABLE_AFTER_ISSUANCE';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'sort_order', ii.sort_order,
            'product_id', ii.product_id,
            'description', ii.description,
            'quantity', ii.quantity,
            'unit_price', ii.unit_price,
            'line_discount_amount', ii.line_discount_amount,
            'is_taxable', ii.is_taxable
        ) ORDER BY ii.sort_order ASC, ii.id ASC
    ), '[]'::jsonb)
    INTO v_items_jsonb
    FROM public.invoice_items ii
    WHERE ii.organization_id = p_org_id AND ii.invoice_id = p_invoice_id;

    IF jsonb_array_length(v_items_jsonb) = 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0073', MESSAGE = 'INVOICE_EMPTY_ITEMS';
    END IF;

    IF v_inv.due_date < v_inv.issue_date THEN
        RAISE EXCEPTION USING ERRCODE = 'P0071', MESSAGE = 'INVALID_DATE_RANGE';
    END IF;

    SELECT id, name, email, phone, status INTO v_customer
    FROM public.customers
    WHERE organization_id = p_org_id AND id = v_inv.customer_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0040', MESSAGE = 'CUSTOMER_NOT_FOUND';
    END IF;
    IF v_customer.status = 'archived' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0041', MESSAGE = 'CUSTOMER_ARCHIVED';
    END IF;

    SELECT tax_name, default_tax_rate, is_tax_inclusive
    INTO v_tax_name, v_tax_rate, v_is_tax_incl
    FROM public.organization_tax_settings
    WHERE organization_id = p_org_id;

    IF NOT FOUND THEN
        v_tax_name := 'VAT';
        v_tax_rate := 0.0000;
        v_is_tax_incl := false;
    END IF;

    v_calc := public._f006_compute_invoice_totals(
        p_org_id, v_org.currency, v_items_jsonb,
        v_inv.invoice_discount_amount, v_inv.is_tax_exempt,
        v_tax_rate, v_is_tax_incl, true
    );

    v_inv_number := public._f006_next_sequence(p_org_id, 'invoice', v_org.timezone);
    v_total_amount := (v_calc->>'total_amount')::numeric;
    v_new_status := CASE WHEN v_total_amount = 0.0000 THEN 'paid' ELSE 'issued' END;

    UPDATE public.invoices SET
        invoice_number = v_inv_number,
        customer_name_snapshot = v_customer.name,
        customer_email_snapshot = v_customer.email,
        customer_phone_snapshot = v_customer.phone,
        currency = v_org.currency,
        tax_name = v_tax_name,
        tax_rate = v_tax_rate,
        is_tax_inclusive = v_is_tax_incl,
        subtotal = (v_calc->>'subtotal')::numeric,
        invoice_discount_amount = (v_calc->>'invoice_discount_amount')::numeric,
        taxable_amount = (v_calc->>'taxable_amount')::numeric,
        tax_amount = (v_calc->>'tax_amount')::numeric,
        total_amount = v_total_amount,
        paid_amount = 0.0000,
        outstanding_balance = v_total_amount,
        status = v_new_status,
        issued_at = now(),
        issued_by = auth.uid(),
        paid_at = CASE WHEN v_total_amount = 0.0000 THEN now() ELSE NULL END,
        issue_idempotency_key = p_idempotency_key,
        issue_idempotency_hash = v_canon_hash,
        updated_by = auth.uid()
    WHERE id = p_invoice_id;

    DELETE FROM public.invoice_items
    WHERE organization_id = p_org_id AND invoice_id = p_invoice_id;

    FOR v_item IN SELECT value FROM jsonb_array_elements(v_calc->'items') AS value
    LOOP
        INSERT INTO public.invoice_items (
            organization_id, invoice_id, sort_order, product_id,
            sku_snapshot, unit_of_measure_snapshot, description,
            quantity, unit_price, line_discount_amount,
            allocated_invoice_disc, is_taxable, taxable_amount,
            allocated_tax_amount, total_price
        ) VALUES (
            p_org_id, p_invoice_id,
            (v_item->>'sort_order')::integer,
            NULLIF(v_item->>'product_id', '')::uuid,
            NULLIF(v_item->>'sku_snapshot', ''),
            NULLIF(v_item->>'unit_of_measure_snapshot', ''),
            v_item->>'description',
            (v_item->>'quantity')::numeric,
            (v_item->>'unit_price')::numeric,
            (v_item->>'line_discount_amount')::numeric,
            (v_item->>'allocated_invoice_disc')::numeric,
            (v_item->>'is_taxable')::boolean,
            (v_item->>'taxable_amount')::numeric,
            (v_item->>'allocated_tax_amount')::numeric,
            (v_item->>'total_price')::numeric
        );
    END LOOP;

    INSERT INTO public.organization_audit_events (organization_id, actor_id, event_type, metadata)
    VALUES (
        p_org_id, auth.uid(), 'invoice.issued',
        jsonb_build_object(
            'invoice_id', p_invoice_id,
            'invoice_number', v_inv_number,
            'status', v_new_status,
            'total_amount', v_calc->>'total_amount',
            'currency', v_org.currency
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'is_replay', false,
        'invoice_id', p_invoice_id,
        'invoice_number', v_inv_number,
        'status', v_new_status,
        'currency', v_org.currency,
        'total_amount', v_calc->>'total_amount',
        'outstanding_balance', v_calc->>'total_amount',
        'issued_at', now()
    );
END;
$$;


CREATE OR REPLACE FUNCTION public.cancel_invoice(
    p_org_id          UUID,
    p_invoice_id      UUID,
    p_reason          TEXT,
    p_idempotency_key UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_clean_reason TEXT;
    v_canon_hash   TEXT;
    v_inv          RECORD;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

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

    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'invoices:cancel') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0055', MESSAGE = 'IDEMPOTENCY_KEY_REQUIRED';
    END IF;

    v_clean_reason := trim(COALESCE(p_reason, ''));
    IF length(v_clean_reason) < 3 OR length(v_clean_reason) > 255 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_CANCELLATION_REASON';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_idempotency_key::text));

    v_canon_hash := encode(sha256(convert_to(
        jsonb_build_object(
            'op', 'cancel_invoice',
            'org_id', p_org_id::text,
            'invoice_id', p_invoice_id::text,
            'reason', v_clean_reason
        )::text,
        'UTF8'
    )), 'hex');

    IF EXISTS (
        SELECT 1 FROM public.invoices
        WHERE organization_id = p_org_id
          AND cancel_idempotency_key = p_idempotency_key
          AND id <> p_invoice_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
    END IF;

    SELECT * INTO v_inv
    FROM public.invoices
    WHERE organization_id = p_org_id AND id = p_invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0070', MESSAGE = 'INVOICE_NOT_FOUND';
    END IF;

    IF v_inv.cancel_idempotency_key = p_idempotency_key THEN
        IF v_inv.cancel_idempotency_hash = v_canon_hash THEN
            RETURN jsonb_build_object(
                'success', true,
                'is_replay', true,
                'invoice_id', v_inv.id,
                'invoice_number', v_inv.invoice_number,
                'status', v_inv.status,
                'cancelled_at', v_inv.cancelled_at
            );
        ELSE
            RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
        END IF;
    END IF;

    IF v_inv.paid_amount > 0.0000 OR EXISTS (
        SELECT 1 FROM public.invoice_payments
        WHERE organization_id = p_org_id
          AND invoice_id = p_invoice_id
          AND status = 'recorded'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0076', MESSAGE = 'INVOICE_HAS_ACTIVE_PAYMENTS';
    END IF;

    IF v_inv.status <> 'issued' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0072', MESSAGE = 'INVOICE_IMMUTABLE_AFTER_ISSUANCE';
    END IF;

    UPDATE public.invoices SET
        status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = auth.uid(),
        cancellation_reason = v_clean_reason,
        cancel_idempotency_key = p_idempotency_key,
        cancel_idempotency_hash = v_canon_hash,
        updated_by = auth.uid()
    WHERE id = p_invoice_id;

    INSERT INTO public.organization_audit_events (organization_id, actor_id, event_type, metadata)
    VALUES (
        p_org_id, auth.uid(), 'invoice.cancelled',
        jsonb_build_object(
            'invoice_id', p_invoice_id,
            'invoice_number', v_inv.invoice_number,
            'reason', v_clean_reason
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'is_replay', false,
        'invoice_id', p_invoice_id,
        'invoice_number', v_inv.invoice_number,
        'status', 'cancelled',
        'cancelled_at', now()
    );
END;
$$;


-- ============================================================================
-- T012: P0 Invoice Payment & Reversal RPCs
--   - public.record_invoice_payment
--   - public.reverse_invoice_payment
-- ============================================================================
CREATE OR REPLACE FUNCTION public.record_invoice_payment(
    p_org_id          UUID,
    p_invoice_id      UUID,
    p_payment_method  TEXT,
    p_amount          NUMERIC,
    p_payment_date    DATE,
    p_reference_no    TEXT,
    p_notes           TEXT,
    p_idempotency_key UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_org             RECORD;
    v_decimals        INTEGER;
    v_clean_ref       TEXT;
    v_clean_notes     TEXT;
    v_canon_hash      TEXT;
    v_existing_pay    RECORD;
    v_inv             RECORD;
    v_pay_number      TEXT;
    v_pay_id          UUID;
    v_new_paid        NUMERIC(14, 4);
    v_new_outstanding NUMERIC(14, 4);
    v_new_status      TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

    SELECT id, currency, timezone INTO v_org
    FROM public.organizations
    WHERE id = p_org_id AND is_active = TRUE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ORGANIZATION_INACTIVE';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_memberships
        WHERE organization_id = p_org_id AND user_id = auth.uid() AND status = 'active'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'MEMBERSHIP_INACTIVE';
    END IF;

    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'invoice_payments:create') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0055', MESSAGE = 'IDEMPOTENCY_KEY_REQUIRED';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0.0000 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0007', MESSAGE = 'INVALID_FINANCIAL_AMOUNT';
    END IF;

    IF p_payment_method NOT IN ('cash', 'card', 'bank_transfer', 'other') THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_PAYMENT_METHOD';
    END IF;

    IF p_payment_date IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_PAYMENT_DATE';
    END IF;

    v_decimals := public.get_currency_exponent(v_org.currency);
    IF trunc(p_amount, v_decimals) <> p_amount THEN
        RAISE EXCEPTION USING ERRCODE = 'P0016', MESSAGE = 'DECIMAL_PRECISION_EXCEEDED';
    END IF;

    v_clean_ref := NULLIF(trim(COALESCE(p_reference_no, '')), '');
    v_clean_notes := NULLIF(trim(COALESCE(p_notes, '')), '');

    IF p_payment_method <> 'cash' AND v_clean_ref IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0057', MESSAGE = 'PAYMENT_REFERENCE_REQUIRED';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_idempotency_key::text));

    v_canon_hash := encode(sha256(convert_to(
        jsonb_build_object(
            'op', 'record_invoice_payment',
            'org_id', p_org_id::text,
            'invoice_id', p_invoice_id::text,
            'payment_method', p_payment_method,
            'amount', to_char(p_amount, 'FM9999999990.0000'),
            'payment_date', p_payment_date::text,
            'reference_no', v_clean_ref,
            'notes', v_clean_notes
        )::text,
        'UTF8'
    )), 'hex');

    SELECT * INTO v_existing_pay
    FROM public.invoice_payments
    WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        -- Case C / Case B / Case A
        IF v_existing_pay.invoice_id <> p_invoice_id OR v_existing_pay.idempotency_hash <> v_canon_hash THEN
            RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
        END IF;

        SELECT status, outstanding_balance INTO v_inv
        FROM public.invoices
        WHERE organization_id = p_org_id AND id = p_invoice_id;

        RETURN jsonb_build_object(
            'success', true,
            'is_replay', true,
            'payment_id', v_existing_pay.id,
            'payment_number', v_existing_pay.payment_number,
            'balance_after_payment', to_char(v_existing_pay.balance_after_payment, 'FM9999999990.0000'),
            'invoice_status', v_inv.status,
            'outstanding_balance', to_char(v_inv.outstanding_balance, 'FM9999999990.0000')
        );
    END IF;

    -- Case D: Lock parent invoice FOR UPDATE
    SELECT * INTO v_inv
    FROM public.invoices
    WHERE organization_id = p_org_id AND id = p_invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0070', MESSAGE = 'INVOICE_NOT_FOUND';
    END IF;

    IF v_inv.status NOT IN ('issued', 'partially_paid') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0074', MESSAGE = 'INVOICE_NOT_PAYABLE';
    END IF;

    IF p_amount > v_inv.outstanding_balance THEN
        RAISE EXCEPTION USING ERRCODE = 'P0075', MESSAGE = 'INVOICE_PAYMENT_EXCEEDS_BALANCE';
    END IF;

    IF v_clean_ref IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.invoice_payments
        WHERE organization_id = p_org_id
          AND payment_method = p_payment_method
          AND reference_no = v_clean_ref
          AND status = 'recorded'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'PAYMENT_REFERENCE_EXISTS';
    END IF;

    v_new_paid := v_inv.paid_amount + p_amount;
    v_new_outstanding := v_inv.total_amount - v_new_paid;
    v_new_status := CASE WHEN v_new_outstanding = 0.0000 THEN 'paid' ELSE 'partially_paid' END;
    v_pay_number := public._f006_next_sequence(p_org_id, 'invoice_payment', v_org.timezone);
    v_pay_id := gen_random_uuid();

    INSERT INTO public.invoice_payments (
        id, organization_id, invoice_id, payment_number,
        payment_method, amount, balance_after_payment,
        payment_date, reference_no, notes, status,
        idempotency_key, idempotency_hash, created_by
    ) VALUES (
        v_pay_id, p_org_id, p_invoice_id, v_pay_number,
        p_payment_method, p_amount, v_new_outstanding,
        p_payment_date, v_clean_ref, v_clean_notes, 'recorded',
        p_idempotency_key, v_canon_hash, auth.uid()
    );

    UPDATE public.invoices SET
        paid_amount = v_new_paid,
        outstanding_balance = v_new_outstanding,
        status = v_new_status,
        paid_at = CASE WHEN v_new_outstanding = 0.0000 THEN now() ELSE paid_at END,
        updated_by = auth.uid()
    WHERE id = p_invoice_id;

    INSERT INTO public.organization_audit_events (organization_id, actor_id, event_type, metadata)
    VALUES (
        p_org_id, auth.uid(), 'invoice_payment.recorded',
        jsonb_build_object(
            'invoice_id', p_invoice_id,
            'payment_id', v_pay_id,
            'payment_number', v_pay_number,
            'amount', to_char(p_amount, 'FM9999999990.0000'),
            'balance_after_payment', to_char(v_new_outstanding, 'FM9999999990.0000'),
            'payment_method', p_payment_method
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'is_replay', false,
        'payment_id', v_pay_id,
        'payment_number', v_pay_number,
        'balance_after_payment', to_char(v_new_outstanding, 'FM9999999990.0000'),
        'invoice_status', v_new_status,
        'outstanding_balance', to_char(v_new_outstanding, 'FM9999999990.0000')
    );
END;
$$;


CREATE OR REPLACE FUNCTION public.reverse_invoice_payment(
    p_org_id          UUID,
    p_payment_id      UUID,
    p_reason          TEXT,
    p_idempotency_key UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_clean_reason    TEXT;
    v_canon_hash      TEXT;
    v_pay             RECORD;
    v_inv             RECORD;
    v_new_paid        NUMERIC(14, 4);
    v_new_outstanding NUMERIC(14, 4);
    v_new_status      TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

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

    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'invoice_payments:reverse') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0055', MESSAGE = 'IDEMPOTENCY_KEY_REQUIRED';
    END IF;

    v_clean_reason := trim(COALESCE(p_reason, ''));
    IF length(v_clean_reason) < 3 OR length(v_clean_reason) > 255 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_REVERSAL_REASON';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_idempotency_key::text));

    v_canon_hash := encode(sha256(convert_to(
        jsonb_build_object(
            'op', 'reverse_invoice_payment',
            'org_id', p_org_id::text,
            'payment_id', p_payment_id::text,
            'reason', v_clean_reason
        )::text,
        'UTF8'
    )), 'hex');

    -- Case C: Cross-payment collision check
    IF EXISTS (
        SELECT 1 FROM public.invoice_payments
        WHERE organization_id = p_org_id
          AND reversal_idempotency_key = p_idempotency_key
          AND id <> p_payment_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
    END IF;

    SELECT * INTO v_pay
    FROM public.invoice_payments
    WHERE organization_id = p_org_id AND id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0077', MESSAGE = 'INVOICE_PAYMENT_NOT_FOUND';
    END IF;

    -- Case A & Case B checked BEFORE Case D state rejection (P0078)
    IF v_pay.reversal_idempotency_key = p_idempotency_key THEN
        IF v_pay.reversal_idempotency_hash = v_canon_hash THEN
            SELECT status, outstanding_balance INTO v_inv
            FROM public.invoices
            WHERE organization_id = p_org_id AND id = v_pay.invoice_id;

            RETURN jsonb_build_object(
                'success', true,
                'is_replay', true,
                'payment_id', v_pay.id,
                'payment_number', v_pay.payment_number,
                'status', v_pay.status,
                'invoice_id', v_pay.invoice_id,
                'invoice_status', v_inv.status,
                'outstanding_balance', to_char(v_inv.outstanding_balance, 'FM9999999990.0000'),
                'reversed_at', v_pay.reversed_at
            );
        ELSE
            RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
        END IF;
    END IF;

    -- Case D: New key against already-reversed payment
    IF v_pay.status = 'reversed' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0078', MESSAGE = 'INVOICE_PAYMENT_ALREADY_REVERSED';
    END IF;

    SELECT * INTO v_inv
    FROM public.invoices
    WHERE organization_id = p_org_id AND id = v_pay.invoice_id
    FOR UPDATE;

    IF v_inv.status = 'cancelled' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0072', MESSAGE = 'INVOICE_IMMUTABLE_AFTER_ISSUANCE';
    END IF;

    UPDATE public.invoice_payments SET
        status = 'reversed',
        reversed_at = now(),
        reversed_by = auth.uid(),
        reversal_reason = v_clean_reason,
        reversal_idempotency_key = p_idempotency_key,
        reversal_idempotency_hash = v_canon_hash
    WHERE id = p_payment_id;

    SELECT COALESCE(SUM(amount), 0.0000) INTO v_new_paid
    FROM public.invoice_payments
    WHERE organization_id = p_org_id
      AND invoice_id = v_pay.invoice_id
      AND status = 'recorded';

    v_new_outstanding := v_inv.total_amount - v_new_paid;
    v_new_status := CASE WHEN v_new_paid = 0.0000 THEN 'issued' ELSE 'partially_paid' END;

    UPDATE public.invoices SET
        paid_amount = v_new_paid,
        outstanding_balance = v_new_outstanding,
        status = v_new_status,
        paid_at = NULL,
        updated_by = auth.uid()
    WHERE id = v_pay.invoice_id;

    INSERT INTO public.organization_audit_events (organization_id, actor_id, event_type, metadata)
    VALUES (
        p_org_id, auth.uid(), 'invoice_payment.reversed',
        jsonb_build_object(
            'invoice_id', v_pay.invoice_id,
            'payment_id', v_pay.id,
            'payment_number', v_pay.payment_number,
            'amount', to_char(v_pay.amount, 'FM9999999990.0000'),
            'reason', v_clean_reason,
            'internal_ledger_correction_only', true
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'is_replay', false,
        'payment_id', v_pay.id,
        'payment_number', v_pay.payment_number,
        'status', 'reversed',
        'invoice_id', v_pay.invoice_id,
        'invoice_status', v_new_status,
        'outstanding_balance', to_char(v_new_outstanding, 'FM9999999990.0000'),
        'reversed_at', now()
    );
END;
$$;


-- ============================================================================
-- T013: Expense Category RPCs
--   - public.seed_default_expense_categories
--   - public.create_expense_category
--   - public.update_expense_category
--   - public.archive_expense_category
-- ============================================================================
CREATE OR REPLACE FUNCTION public.seed_default_expense_categories(
    p_org_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_inserted INTEGER := 0;
    v_seed     TEXT;
    v_seeds    TEXT[] := ARRAY[
        'Rent & Utilities',
        'Salaries & Wages',
        'Supplies & Packaging',
        'Marketing & Advertising',
        'Transport & Delivery',
        'Software & Subscriptions',
        'Maintenance & Repairs',
        'Other Operating Expenses'
    ];
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

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

    IF NOT (
        public.check_user_permission(p_org_id, auth.uid(), 'expense_categories:read')
        OR public.check_user_permission(p_org_id, auth.uid(), 'expense_categories:manage')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext('seed_default_expense_categories'));

    FOREACH v_seed IN ARRAY v_seeds
    LOOP
        INSERT INTO public.expense_categories (
            organization_id, name, description, status, is_system_default, created_by
        ) VALUES (
            p_org_id, v_seed, NULL, 'active', true, auth.uid()
        )
        ON CONFLICT (organization_id, lower(trim(name))) WHERE status = 'active'
        DO NOTHING;

        IF FOUND THEN
            v_inserted := v_inserted + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'inserted_count', v_inserted);
END;
$$;


CREATE OR REPLACE FUNCTION public.create_expense_category(
    p_org_id      UUID,
    p_name        TEXT,
    p_description TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_clean_name TEXT;
    v_clean_desc TEXT;
    v_cat_id     UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

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

    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'expense_categories:manage') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    v_clean_name := trim(COALESCE(p_name, ''));
    v_clean_desc := NULLIF(trim(COALESCE(p_description, '')), '');

    IF length(v_clean_name) < 1 OR length(v_clean_name) > 100 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_CATEGORY_NAME';
    END IF;

    v_cat_id := gen_random_uuid();
    INSERT INTO public.expense_categories (
        id, organization_id, name, description, status, is_system_default, created_by
    ) VALUES (
        v_cat_id, p_org_id, v_clean_name, v_clean_desc, 'active', false, auth.uid()
    );

    INSERT INTO public.organization_audit_events (organization_id, actor_id, event_type, metadata)
    VALUES (
        p_org_id, auth.uid(), 'expense_category.created',
        jsonb_build_object('category_id', v_cat_id, 'name', v_clean_name)
    );

    RETURN jsonb_build_object(
        'success', true,
        'category_id', v_cat_id,
        'name', v_clean_name,
        'status', 'active'
    );
END;
$$;


CREATE OR REPLACE FUNCTION public.update_expense_category(
    p_org_id      UUID,
    p_category_id UUID,
    p_name        TEXT,
    p_description TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_cat        RECORD;
    v_clean_name TEXT;
    v_clean_desc TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

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

    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'expense_categories:manage') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    SELECT * INTO v_cat
    FROM public.expense_categories
    WHERE organization_id = p_org_id AND id = p_category_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0079', MESSAGE = 'EXPENSE_CATEGORY_NOT_FOUND';
    END IF;

    IF v_cat.status = 'archived' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0080', MESSAGE = 'EXPENSE_CATEGORY_ARCHIVED';
    END IF;

    v_clean_name := trim(COALESCE(p_name, ''));
    v_clean_desc := NULLIF(trim(COALESCE(p_description, '')), '');

    IF length(v_clean_name) < 1 OR length(v_clean_name) > 100 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_CATEGORY_NAME';
    END IF;

    UPDATE public.expense_categories SET
        name = v_clean_name,
        description = v_clean_desc
    WHERE id = p_category_id;

    INSERT INTO public.organization_audit_events (organization_id, actor_id, event_type, metadata)
    VALUES (
        p_org_id, auth.uid(), 'expense_category.updated',
        jsonb_build_object('category_id', p_category_id, 'name', v_clean_name)
    );

    RETURN jsonb_build_object(
        'success', true,
        'category_id', p_category_id,
        'name', v_clean_name,
        'status', 'active'
    );
END;
$$;


CREATE OR REPLACE FUNCTION public.archive_expense_category(
    p_org_id      UUID,
    p_category_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_cat RECORD;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

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

    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'expense_categories:manage') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    SELECT * INTO v_cat
    FROM public.expense_categories
    WHERE organization_id = p_org_id AND id = p_category_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0079', MESSAGE = 'EXPENSE_CATEGORY_NOT_FOUND';
    END IF;

    IF v_cat.status = 'archived' THEN
        RETURN jsonb_build_object(
            'success', true,
            'category_id', p_category_id,
            'status', 'archived',
            'is_noop', true
        );
    END IF;

    UPDATE public.expense_categories SET status = 'archived' WHERE id = p_category_id;

    INSERT INTO public.organization_audit_events (organization_id, actor_id, event_type, metadata)
    VALUES (
        p_org_id, auth.uid(), 'expense_category.archived',
        jsonb_build_object('category_id', p_category_id, 'name', v_cat.name)
    );

    RETURN jsonb_build_object(
        'success', true,
        'category_id', p_category_id,
        'status', 'archived',
        'is_noop', false
    );
END;
$$;


-- ============================================================================
-- T014: Expense Create, Update & Settlement RPCs
--   - public.create_expense
--   - public.update_expense
--   - public.mark_expense_paid
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_expense(
    p_org_id          UUID,
    p_title           TEXT,
    p_category_id     UUID,
    p_net_amount      NUMERIC,
    p_tax_amount      NUMERIC,
    p_expense_date    DATE,
    p_payee_name      TEXT,
    p_description     TEXT,
    p_payment_status  TEXT,
    p_payment_date    DATE,
    p_payment_method  TEXT,
    p_reference_no    TEXT,
    p_idempotency_key UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_org           RECORD;
    v_decimals      INTEGER;
    v_clean_title   TEXT;
    v_clean_payee   TEXT;
    v_clean_desc    TEXT;
    v_clean_ref     TEXT;
    v_net           NUMERIC(14, 4);
    v_tax           NUMERIC(14, 4);
    v_total         NUMERIC(14, 4);
    v_canon_hash    TEXT;
    v_existing      RECORD;
    v_cat           RECORD;
    v_exp_number    TEXT;
    v_exp_id        UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

    SELECT id, currency, timezone INTO v_org
    FROM public.organizations
    WHERE id = p_org_id AND is_active = TRUE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ORGANIZATION_INACTIVE';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_memberships
        WHERE organization_id = p_org_id AND user_id = auth.uid() AND status = 'active'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'MEMBERSHIP_INACTIVE';
    END IF;

    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'expenses:create') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0055', MESSAGE = 'IDEMPOTENCY_KEY_REQUIRED';
    END IF;

    v_clean_title := trim(COALESCE(p_title, ''));
    IF length(v_clean_title) < 1 OR length(v_clean_title) > 255 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_EXPENSE_TITLE';
    END IF;

    v_clean_payee := NULLIF(trim(COALESCE(p_payee_name, '')), '');
    v_clean_desc := NULLIF(trim(COALESCE(p_description, '')), '');
    v_clean_ref := NULLIF(trim(COALESCE(p_reference_no, '')), '');

    IF p_net_amount IS NULL OR p_net_amount <= 0.0000 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0007', MESSAGE = 'INVALID_FINANCIAL_AMOUNT';
    END IF;
    IF COALESCE(p_tax_amount, 0.0000) < 0.0000 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0007', MESSAGE = 'INVALID_FINANCIAL_AMOUNT';
    END IF;

    v_decimals := public.get_currency_exponent(v_org.currency);
    IF trunc(p_net_amount, v_decimals) <> p_net_amount OR trunc(COALESCE(p_tax_amount, 0.0000), v_decimals) <> COALESCE(p_tax_amount, 0.0000) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0016', MESSAGE = 'DECIMAL_PRECISION_EXCEEDED';
    END IF;

    v_net := round(p_net_amount, v_decimals);
    v_tax := round(COALESCE(p_tax_amount, 0.0000), v_decimals);
    v_total := v_net + v_tax;

    IF p_expense_date IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_EXPENSE_DATE';
    END IF;

    IF p_payment_status NOT IN ('unpaid', 'paid') THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_PAYMENT_STATUS';
    END IF;

    IF p_payment_status = 'paid' THEN
        IF p_payment_date IS NULL OR p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'card', 'bank_transfer', 'other') THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_SETTLEMENT_FIELDS';
        END IF;
        IF p_payment_method <> 'cash' AND v_clean_ref IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0057', MESSAGE = 'PAYMENT_REFERENCE_REQUIRED';
        END IF;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_idempotency_key::text));

    v_canon_hash := encode(sha256(convert_to(
        jsonb_build_object(
            'op', 'create_expense',
            'org_id', p_org_id::text,
            'title', v_clean_title,
            'category_id', p_category_id::text,
            'net_amount', to_char(v_net, 'FM9999999990.0000'),
            'tax_amount', to_char(v_tax, 'FM9999999990.0000'),
            'expense_date', p_expense_date::text,
            'payee_name', v_clean_payee,
            'description', v_clean_desc,
            'payment_status', p_payment_status,
            'payment_date', CASE WHEN p_payment_status = 'paid' THEN p_payment_date::text ELSE NULL END,
            'payment_method', CASE WHEN p_payment_status = 'paid' THEN p_payment_method ELSE NULL END,
            'reference_no', CASE WHEN p_payment_status = 'paid' THEN v_clean_ref ELSE NULL END
        )::text,
        'UTF8'
    )), 'hex');

    SELECT * INTO v_existing
    FROM public.expenses
    WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_existing.idempotency_hash = v_canon_hash THEN
            RETURN jsonb_build_object(
                'success', true,
                'is_replay', true,
                'expense_id', v_existing.id,
                'expense_number', v_existing.expense_number,
                'lifecycle_status', v_existing.lifecycle_status,
                'payment_status', v_existing.payment_status,
                'total_amount', to_char(v_existing.total_amount, 'FM9999999990.0000'),
                'currency', v_existing.currency
            );
        ELSE
            RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
        END IF;
    END IF;

    SELECT id, status INTO v_cat
    FROM public.expense_categories
    WHERE organization_id = p_org_id AND id = p_category_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0079', MESSAGE = 'EXPENSE_CATEGORY_NOT_FOUND';
    END IF;
    IF v_cat.status = 'archived' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0080', MESSAGE = 'EXPENSE_CATEGORY_ARCHIVED';
    END IF;

    IF p_payment_status = 'paid' AND v_clean_ref IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.expenses
        WHERE organization_id = p_org_id
          AND lifecycle_status = 'active'
          AND payment_method = p_payment_method
          AND reference_no = v_clean_ref
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'PAYMENT_REFERENCE_EXISTS';
    END IF;

    v_exp_number := public._f006_next_sequence(p_org_id, 'expense', v_org.timezone);
    v_exp_id := gen_random_uuid();

    INSERT INTO public.expenses (
        id, organization_id, expense_number, category_id,
        title, description, payee_name,
        net_amount, tax_amount, total_amount, currency, expense_date,
        lifecycle_status, payment_status,
        payment_date, payment_method, reference_no, paid_at, paid_by,
        idempotency_key, idempotency_hash, created_by, updated_by
    ) VALUES (
        v_exp_id, p_org_id, v_exp_number, p_category_id,
        v_clean_title, v_clean_desc, v_clean_payee,
        v_net, v_tax, v_total, v_org.currency, p_expense_date,
        'active', p_payment_status,
        CASE WHEN p_payment_status = 'paid' THEN p_payment_date ELSE NULL END,
        CASE WHEN p_payment_status = 'paid' THEN p_payment_method ELSE NULL END,
        CASE WHEN p_payment_status = 'paid' THEN v_clean_ref ELSE NULL END,
        CASE WHEN p_payment_status = 'paid' THEN now() ELSE NULL END,
        CASE WHEN p_payment_status = 'paid' THEN auth.uid() ELSE NULL END,
        p_idempotency_key, v_canon_hash, auth.uid(), auth.uid()
    );

    INSERT INTO public.organization_audit_events (organization_id, actor_id, event_type, metadata)
    VALUES (
        p_org_id, auth.uid(), 'expense.created',
        jsonb_build_object(
            'expense_id', v_exp_id,
            'expense_number', v_exp_number,
            'payment_status', p_payment_status,
            'total_amount', to_char(v_total, 'FM9999999990.0000'),
            'currency', v_org.currency
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'is_replay', false,
        'expense_id', v_exp_id,
        'expense_number', v_exp_number,
        'lifecycle_status', 'active',
        'payment_status', p_payment_status,
        'total_amount', to_char(v_total, 'FM9999999990.0000'),
        'currency', v_org.currency
    );
END;
$$;


CREATE OR REPLACE FUNCTION public.update_expense(
    p_org_id       UUID,
    p_expense_id   UUID,
    p_title        TEXT,
    p_category_id  UUID,
    p_net_amount   NUMERIC,
    p_tax_amount   NUMERIC,
    p_expense_date DATE,
    p_payee_name   TEXT,
    p_description  TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_exp         RECORD;
    v_cat         RECORD;
    v_decimals    INTEGER;
    v_clean_title TEXT;
    v_clean_payee TEXT;
    v_clean_desc  TEXT;
    v_net         NUMERIC(14, 4);
    v_tax         NUMERIC(14, 4);
    v_total       NUMERIC(14, 4);
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

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

    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'expenses:update') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    SELECT * INTO v_exp
    FROM public.expenses
    WHERE organization_id = p_org_id AND id = p_expense_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0081', MESSAGE = 'EXPENSE_NOT_FOUND';
    END IF;

    IF v_exp.lifecycle_status = 'voided' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0083', MESSAGE = 'EXPENSE_VOIDED';
    END IF;

    IF v_exp.lifecycle_status = 'corrected' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0088', MESSAGE = 'EXPENSE_NOT_ACTIVE';
    END IF;

    v_clean_title := trim(COALESCE(p_title, ''));
    IF length(v_clean_title) < 1 OR length(v_clean_title) > 255 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_EXPENSE_TITLE';
    END IF;

    v_clean_payee := NULLIF(trim(COALESCE(p_payee_name, '')), '');
    v_clean_desc := NULLIF(trim(COALESCE(p_description, '')), '');

    IF p_category_id <> v_exp.category_id THEN
        SELECT id, status INTO v_cat
        FROM public.expense_categories
        WHERE organization_id = p_org_id AND id = p_category_id
        FOR SHARE;

        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0079', MESSAGE = 'EXPENSE_CATEGORY_NOT_FOUND';
        END IF;
        IF v_cat.status = 'archived' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0080', MESSAGE = 'EXPENSE_CATEGORY_ARCHIVED';
        END IF;
    END IF;

    v_decimals := public.get_currency_exponent(v_exp.currency);

    IF p_net_amount IS NULL OR p_net_amount <= 0.0000 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0007', MESSAGE = 'INVALID_FINANCIAL_AMOUNT';
    END IF;
    IF COALESCE(p_tax_amount, 0.0000) < 0.0000 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0007', MESSAGE = 'INVALID_FINANCIAL_AMOUNT';
    END IF;

    IF trunc(p_net_amount, v_decimals) <> p_net_amount OR trunc(COALESCE(p_tax_amount, 0.0000), v_decimals) <> COALESCE(p_tax_amount, 0.0000) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0016', MESSAGE = 'DECIMAL_PRECISION_EXCEEDED';
    END IF;

    v_net := round(p_net_amount, v_decimals);
    v_tax := round(COALESCE(p_tax_amount, 0.0000), v_decimals);
    v_total := v_net + v_tax;

    IF v_exp.payment_status = 'paid' THEN
        IF v_net <> v_exp.net_amount OR v_tax <> v_exp.tax_amount OR (p_expense_date IS NOT NULL AND p_expense_date <> v_exp.expense_date) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0084', MESSAGE = 'PAID_EXPENSE_AMOUNT_LOCKED';
        END IF;

        UPDATE public.expenses SET
            title = v_clean_title,
            category_id = p_category_id,
            payee_name = v_clean_payee,
            description = v_clean_desc,
            updated_by = auth.uid()
        WHERE id = p_expense_id;
    ELSE
        IF p_expense_date IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_EXPENSE_DATE';
        END IF;

        UPDATE public.expenses SET
            title = v_clean_title,
            category_id = p_category_id,
            net_amount = v_net,
            tax_amount = v_tax,
            total_amount = v_total,
            expense_date = p_expense_date,
            payee_name = v_clean_payee,
            description = v_clean_desc,
            updated_by = auth.uid()
        WHERE id = p_expense_id;
    END IF;

    INSERT INTO public.organization_audit_events (organization_id, actor_id, event_type, metadata)
    VALUES (
        p_org_id, auth.uid(), 'expense.updated',
        jsonb_build_object('expense_id', p_expense_id, 'expense_number', v_exp.expense_number)
    );

    RETURN jsonb_build_object(
        'success', true,
        'expense_id', p_expense_id,
        'expense_number', v_exp.expense_number,
        'payment_status', v_exp.payment_status,
        'total_amount', to_char(CASE WHEN v_exp.payment_status = 'paid' THEN v_exp.total_amount ELSE v_total END, 'FM9999999990.0000')
    );
END;
$$;


CREATE OR REPLACE FUNCTION public.mark_expense_paid(
    p_org_id          UUID,
    p_expense_id      UUID,
    p_payment_date    DATE,
    p_payment_method  TEXT,
    p_reference_no    TEXT,
    p_idempotency_key UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_clean_ref  TEXT;
    v_canon_hash TEXT;
    v_exp        RECORD;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

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

    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'expenses:pay') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0055', MESSAGE = 'IDEMPOTENCY_KEY_REQUIRED';
    END IF;

    IF p_payment_date IS NULL OR p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'card', 'bank_transfer', 'other') THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_SETTLEMENT_FIELDS';
    END IF;

    v_clean_ref := NULLIF(trim(COALESCE(p_reference_no, '')), '');
    IF p_payment_method <> 'cash' AND v_clean_ref IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0057', MESSAGE = 'PAYMENT_REFERENCE_REQUIRED';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_idempotency_key::text));

    v_canon_hash := encode(sha256(convert_to(
        jsonb_build_object(
            'op', 'mark_expense_paid',
            'org_id', p_org_id::text,
            'expense_id', p_expense_id::text,
            'payment_date', p_payment_date::text,
            'payment_method', p_payment_method,
            'reference_no', v_clean_ref
        )::text,
        'UTF8'
    )), 'hex');

    IF EXISTS (
        SELECT 1 FROM public.expenses
        WHERE organization_id = p_org_id
          AND pay_idempotency_key = p_idempotency_key
          AND id <> p_expense_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
    END IF;

    SELECT * INTO v_exp
    FROM public.expenses
    WHERE organization_id = p_org_id AND id = p_expense_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0081', MESSAGE = 'EXPENSE_NOT_FOUND';
    END IF;

    IF v_exp.pay_idempotency_key = p_idempotency_key THEN
        IF v_exp.pay_idempotency_hash = v_canon_hash THEN
            RETURN jsonb_build_object(
                'success', true,
                'is_replay', true,
                'expense_id', v_exp.id,
                'expense_number', v_exp.expense_number,
                'payment_status', v_exp.payment_status,
                'paid_at', v_exp.paid_at,
                'paid_by', v_exp.paid_by
            );
        ELSE
            RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
        END IF;
    END IF;

    IF v_exp.lifecycle_status = 'voided' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0083', MESSAGE = 'EXPENSE_VOIDED';
    END IF;

    IF v_exp.lifecycle_status = 'corrected' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0088', MESSAGE = 'EXPENSE_NOT_ACTIVE';
    END IF;

    IF v_exp.payment_status = 'paid' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0082', MESSAGE = 'EXPENSE_ALREADY_PAID';
    END IF;

    IF v_clean_ref IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.expenses
        WHERE organization_id = p_org_id
          AND lifecycle_status = 'active'
          AND payment_method = p_payment_method
          AND reference_no = v_clean_ref
          AND id <> p_expense_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'PAYMENT_REFERENCE_EXISTS';
    END IF;

    UPDATE public.expenses SET
        payment_status = 'paid',
        payment_date = p_payment_date,
        payment_method = p_payment_method,
        reference_no = v_clean_ref,
        paid_at = now(),
        paid_by = auth.uid(),
        pay_idempotency_key = p_idempotency_key,
        pay_idempotency_hash = v_canon_hash,
        updated_by = auth.uid()
    WHERE id = p_expense_id;

    INSERT INTO public.organization_audit_events (organization_id, actor_id, event_type, metadata)
    VALUES (
        p_org_id, auth.uid(), 'expense.paid',
        jsonb_build_object(
            'expense_id', p_expense_id,
            'expense_number', v_exp.expense_number,
            'payment_method', p_payment_method,
            'payment_date', p_payment_date
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'is_replay', false,
        'expense_id', p_expense_id,
        'expense_number', v_exp.expense_number,
        'payment_status', 'paid',
        'paid_at', now(),
        'paid_by', auth.uid()
    );
END;
$$;


-- ============================================================================
-- T015: Expense Void (Unpaid Only) & Bounded Paid Correction RPCs
--   - public.void_expense
--   - public.correct_paid_expense
-- ============================================================================
CREATE OR REPLACE FUNCTION public.void_expense(
    p_org_id          UUID,
    p_expense_id      UUID,
    p_reason          TEXT,
    p_idempotency_key UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_clean_reason TEXT;
    v_canon_hash   TEXT;
    v_exp          RECORD;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

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

    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'expenses:void') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0055', MESSAGE = 'IDEMPOTENCY_KEY_REQUIRED';
    END IF;

    v_clean_reason := trim(COALESCE(p_reason, ''));
    IF length(v_clean_reason) < 3 OR length(v_clean_reason) > 255 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_VOID_REASON';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_idempotency_key::text));

    v_canon_hash := encode(sha256(convert_to(
        jsonb_build_object(
            'op', 'void_expense',
            'org_id', p_org_id::text,
            'expense_id', p_expense_id::text,
            'reason', v_clean_reason
        )::text,
        'UTF8'
    )), 'hex');

    IF EXISTS (
        SELECT 1 FROM public.expenses
        WHERE organization_id = p_org_id
          AND void_idempotency_key = p_idempotency_key
          AND id <> p_expense_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
    END IF;

    SELECT * INTO v_exp
    FROM public.expenses
    WHERE organization_id = p_org_id AND id = p_expense_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0081', MESSAGE = 'EXPENSE_NOT_FOUND';
    END IF;

    IF v_exp.void_idempotency_key = p_idempotency_key THEN
        IF v_exp.void_idempotency_hash = v_canon_hash THEN
            RETURN jsonb_build_object(
                'success', true,
                'is_replay', true,
                'expense_id', v_exp.id,
                'expense_number', v_exp.expense_number,
                'lifecycle_status', v_exp.lifecycle_status,
                'voided_at', v_exp.voided_at
            );
        ELSE
            RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
        END IF;
    END IF;

    IF v_exp.lifecycle_status = 'voided' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0083', MESSAGE = 'EXPENSE_VOIDED';
    END IF;

    IF v_exp.lifecycle_status = 'corrected' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0088', MESSAGE = 'EXPENSE_NOT_ACTIVE';
    END IF;

    IF v_exp.payment_status = 'paid' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0087', MESSAGE = 'PAID_EXPENSE_VOID_BLOCKED';
    END IF;

    UPDATE public.expenses SET
        lifecycle_status = 'voided',
        voided_at = now(),
        voided_by = auth.uid(),
        void_reason = v_clean_reason,
        void_idempotency_key = p_idempotency_key,
        void_idempotency_hash = v_canon_hash,
        updated_by = auth.uid()
    WHERE id = p_expense_id;

    INSERT INTO public.organization_audit_events (organization_id, actor_id, event_type, metadata)
    VALUES (
        p_org_id, auth.uid(), 'expense.voided',
        jsonb_build_object(
            'expense_id', p_expense_id,
            'expense_number', v_exp.expense_number,
            'reason', v_clean_reason
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'is_replay', false,
        'expense_id', p_expense_id,
        'expense_number', v_exp.expense_number,
        'lifecycle_status', 'voided',
        'voided_at', now()
    );
END;
$$;


CREATE OR REPLACE FUNCTION public.correct_paid_expense(
    p_org_id          UUID,
    p_expense_id      UUID,
    p_reason          TEXT,
    p_title           TEXT,
    p_category_id     UUID,
    p_net_amount      NUMERIC,
    p_tax_amount      NUMERIC,
    p_expense_date    DATE,
    p_payee_name      TEXT,
    p_description     TEXT,
    p_payment_date    DATE,
    p_payment_method  TEXT,
    p_reference_no    TEXT,
    p_idempotency_key UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_org           RECORD;
    v_exp           RECORD;
    v_rep           RECORD;
    v_cat           RECORD;
    v_decimals      INTEGER;
    v_clean_reason  TEXT;
    v_clean_title   TEXT;
    v_clean_payee   TEXT;
    v_clean_desc    TEXT;
    v_clean_ref     TEXT;
    v_net           NUMERIC(14, 4);
    v_tax           NUMERIC(14, 4);
    v_total         NUMERIC(14, 4);
    v_canon_hash    TEXT;
    v_new_id        UUID;
    v_new_number    TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

    SELECT id, currency, timezone INTO v_org
    FROM public.organizations
    WHERE id = p_org_id AND is_active = TRUE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ORGANIZATION_INACTIVE';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_memberships
        WHERE organization_id = p_org_id AND user_id = auth.uid() AND status = 'active'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'MEMBERSHIP_INACTIVE';
    END IF;

    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'expenses:void') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0055', MESSAGE = 'IDEMPOTENCY_KEY_REQUIRED';
    END IF;

    v_clean_reason := trim(COALESCE(p_reason, ''));
    IF length(v_clean_reason) < 3 OR length(v_clean_reason) > 255 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_CORRECTION_REASON';
    END IF;

    v_clean_title := trim(COALESCE(p_title, ''));
    IF length(v_clean_title) < 1 OR length(v_clean_title) > 255 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_EXPENSE_TITLE';
    END IF;

    v_clean_payee := NULLIF(trim(COALESCE(p_payee_name, '')), '');
    v_clean_desc := NULLIF(trim(COALESCE(p_description, '')), '');
    v_clean_ref := NULLIF(trim(COALESCE(p_reference_no, '')), '');

    IF p_net_amount IS NULL OR p_net_amount <= 0.0000 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0007', MESSAGE = 'INVALID_FINANCIAL_AMOUNT';
    END IF;
    IF COALESCE(p_tax_amount, 0.0000) < 0.0000 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0007', MESSAGE = 'INVALID_FINANCIAL_AMOUNT';
    END IF;

    v_decimals := public.get_currency_exponent(v_org.currency);
    IF trunc(p_net_amount, v_decimals) <> p_net_amount OR trunc(COALESCE(p_tax_amount, 0.0000), v_decimals) <> COALESCE(p_tax_amount, 0.0000) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0016', MESSAGE = 'DECIMAL_PRECISION_EXCEEDED';
    END IF;

    v_net := round(p_net_amount, v_decimals);
    v_tax := round(COALESCE(p_tax_amount, 0.0000), v_decimals);
    v_total := v_net + v_tax;

    IF p_expense_date IS NULL OR p_payment_date IS NULL OR p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'card', 'bank_transfer', 'other') THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_SETTLEMENT_FIELDS';
    END IF;

    IF p_payment_method <> 'cash' AND v_clean_ref IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0057', MESSAGE = 'PAYMENT_REFERENCE_REQUIRED';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_idempotency_key::text));

    v_canon_hash := encode(sha256(convert_to(
        jsonb_build_object(
            'op', 'correct_paid_expense',
            'org_id', p_org_id::text,
            'expense_id', p_expense_id::text,
            'reason', v_clean_reason,
            'title', v_clean_title,
            'category_id', p_category_id::text,
            'net_amount', to_char(v_net, 'FM9999999990.0000'),
            'tax_amount', to_char(v_tax, 'FM9999999990.0000'),
            'expense_date', p_expense_date::text,
            'payee_name', v_clean_payee,
            'description', v_clean_desc,
            'payment_date', p_payment_date::text,
            'payment_method', p_payment_method,
            'reference_no', v_clean_ref
        )::text,
        'UTF8'
    )), 'hex');

    -- Case C: Cross-record idempotency check
    IF EXISTS (
        SELECT 1 FROM public.expenses
        WHERE organization_id = p_org_id
          AND correct_idempotency_key = p_idempotency_key
          AND id <> p_expense_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
    END IF;

    SELECT * INTO v_exp
    FROM public.expenses
    WHERE organization_id = p_org_id AND id = p_expense_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0081', MESSAGE = 'EXPENSE_NOT_FOUND';
    END IF;

    -- Case A & Case B before state rejection
    IF v_exp.correct_idempotency_key = p_idempotency_key THEN
        IF v_exp.correct_idempotency_hash = v_canon_hash THEN
            SELECT id, expense_number, total_amount INTO v_rep
            FROM public.expenses
            WHERE organization_id = p_org_id AND id = v_exp.corrected_by_expense_id;

            RETURN jsonb_build_object(
                'success', true,
                'is_replay', true,
                'original_expense_id', v_exp.id,
                'replacement_expense_id', v_rep.id,
                'replacement_expense_number', v_rep.expense_number,
                'total_amount', to_char(v_rep.total_amount, 'FM9999999990.0000')
            );
        ELSE
            RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
        END IF;
    END IF;

    -- Case D: State checks
    IF v_exp.lifecycle_status = 'voided' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0083', MESSAGE = 'EXPENSE_VOIDED';
    END IF;

    IF v_exp.lifecycle_status = 'corrected' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0088', MESSAGE = 'EXPENSE_NOT_ACTIVE';
    END IF;

    IF v_exp.payment_status <> 'paid' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0089', MESSAGE = 'EXPENSE_NOT_PAID';
    END IF;

    SELECT id, status INTO v_cat
    FROM public.expense_categories
    WHERE organization_id = p_org_id AND id = p_category_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0079', MESSAGE = 'EXPENSE_CATEGORY_NOT_FOUND';
    END IF;
    IF v_cat.status = 'archived' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0080', MESSAGE = 'EXPENSE_CATEGORY_ARCHIVED';
    END IF;

    IF v_clean_ref IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.expenses
        WHERE organization_id = p_org_id
          AND lifecycle_status = 'active'
          AND payment_method = p_payment_method
          AND reference_no = v_clean_ref
          AND id <> p_expense_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'PAYMENT_REFERENCE_EXISTS';
    END IF;

    -- 3-Step Atomic Correction Order:
    -- Step 1: Mark original row 'corrected' first so active partial unique index releases its reference_no
    UPDATE public.expenses SET
        lifecycle_status = 'corrected',
        correction_reason = v_clean_reason,
        correct_idempotency_key = p_idempotency_key,
        correct_idempotency_hash = v_canon_hash,
        updated_by = auth.uid()
    WHERE id = v_exp.id;

    -- Step 2: Insert linked active paid replacement row
    v_new_id := gen_random_uuid();
    v_new_number := public._f006_next_sequence(p_org_id, 'expense', v_org.timezone);

    INSERT INTO public.expenses (
        id, organization_id, expense_number, category_id,
        title, description, payee_name,
        net_amount, tax_amount, total_amount, currency, expense_date,
        lifecycle_status, payment_status,
        payment_date, payment_method, reference_no, paid_at, paid_by,
        supersedes_expense_id, idempotency_key, idempotency_hash,
        created_by, updated_by
    ) VALUES (
        v_new_id, p_org_id, v_new_number, p_category_id,
        v_clean_title, v_clean_desc, v_clean_payee,
        v_net, v_tax, v_total, v_org.currency, p_expense_date,
        'active', 'paid',
        p_payment_date, p_payment_method, v_clean_ref, now(), auth.uid(),
        v_exp.id, gen_random_uuid(), v_canon_hash,
        auth.uid(), auth.uid()
    );

    -- Step 3: Back-link original row to replacement
    UPDATE public.expenses SET
        corrected_by_expense_id = v_new_id
    WHERE id = v_exp.id;

    INSERT INTO public.organization_audit_events (organization_id, actor_id, event_type, metadata)
    VALUES (
        p_org_id, auth.uid(), 'expense.corrected',
        jsonb_build_object(
            'original_expense_id', v_exp.id,
            'original_expense_number', v_exp.expense_number,
            'replacement_expense_id', v_new_id,
            'replacement_expense_number', v_new_number,
            'reason', v_clean_reason,
            'total_amount', to_char(v_total, 'FM9999999990.0000')
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'is_replay', false,
        'original_expense_id', v_exp.id,
        'replacement_expense_id', v_new_id,
        'replacement_expense_number', v_new_number,
        'total_amount', to_char(v_total, 'FM9999999990.0000')
    );
END;
$$;


-- ============================================================================
-- T016: Attachment Metadata & Operational Summary RPCs
--   - public.register_expense_attachment
--   - public.delete_expense_attachment
--   - public.get_invoices_expenses_summary
-- ============================================================================
CREATE OR REPLACE FUNCTION public.register_expense_attachment(
    p_org_id       UUID,
    p_expense_id   UUID,
    p_storage_path TEXT,
    p_file_name    TEXT,
    p_mime_type    TEXT,
    p_file_size    BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_exp           RECORD;
    v_att_id        UUID;
    v_expected_pfx  TEXT;
    v_clean_name    TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

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

    IF NOT (
        public.check_user_permission(p_org_id, auth.uid(), 'expenses:create')
        OR public.check_user_permission(p_org_id, auth.uid(), 'expenses:update')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    SELECT * INTO v_exp
    FROM public.expenses
    WHERE organization_id = p_org_id AND id = p_expense_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0081', MESSAGE = 'EXPENSE_NOT_FOUND';
    END IF;

    IF v_exp.lifecycle_status = 'voided' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0083', MESSAGE = 'EXPENSE_VOIDED';
    END IF;

    IF v_exp.lifecycle_status = 'corrected' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0088', MESSAGE = 'EXPENSE_NOT_ACTIVE';
    END IF;

    v_expected_pfx := p_org_id::text || '/' || p_expense_id::text || '/';
    IF p_storage_path IS NULL
       OR left(p_storage_path, length(v_expected_pfx)) <> v_expected_pfx
       OR p_storage_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0085', MESSAGE = 'INVALID_ATTACHMENT';
    END IF;

    IF p_mime_type IS NULL OR p_mime_type NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0085', MESSAGE = 'INVALID_ATTACHMENT';
    END IF;

    IF p_file_size IS NULL OR p_file_size < 1 OR p_file_size > 5242880 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0085', MESSAGE = 'INVALID_ATTACHMENT';
    END IF;

    v_clean_name := trim(COALESCE(p_file_name, ''));
    IF length(v_clean_name) < 1 OR length(v_clean_name) > 255 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0085', MESSAGE = 'INVALID_ATTACHMENT';
    END IF;

    v_att_id := gen_random_uuid();
    INSERT INTO public.expense_attachments (
        id, organization_id, expense_id, storage_path, file_name, mime_type, file_size, uploaded_by
    ) VALUES (
        v_att_id, p_org_id, p_expense_id, p_storage_path, v_clean_name, p_mime_type, p_file_size, auth.uid()
    );

    INSERT INTO public.organization_audit_events (organization_id, actor_id, event_type, metadata)
    VALUES (
        p_org_id, auth.uid(), 'expense_attachment.added',
        jsonb_build_object(
            'expense_id', p_expense_id,
            'attachment_id', v_att_id,
            'file_name', v_clean_name,
            'mime_type', p_mime_type,
            'file_size', p_file_size
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'attachment_id', v_att_id,
        'expense_id', p_expense_id,
        'storage_path', p_storage_path
    );
END;
$$;


CREATE OR REPLACE FUNCTION public.delete_expense_attachment(
    p_org_id        UUID,
    p_attachment_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_att RECORD;
    v_exp RECORD;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

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

    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'expenses:update') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    SELECT * INTO v_att
    FROM public.expense_attachments
    WHERE organization_id = p_org_id AND id = p_attachment_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0085', MESSAGE = 'INVALID_ATTACHMENT';
    END IF;

    SELECT * INTO v_exp
    FROM public.expenses
    WHERE organization_id = p_org_id AND id = v_att.expense_id
    FOR UPDATE;

    IF v_exp.lifecycle_status = 'voided' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0083', MESSAGE = 'EXPENSE_VOIDED';
    END IF;

    IF v_exp.lifecycle_status = 'corrected' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0088', MESSAGE = 'EXPENSE_NOT_ACTIVE';
    END IF;

    DELETE FROM public.expense_attachments
    WHERE organization_id = p_org_id AND id = p_attachment_id;

    INSERT INTO public.organization_audit_events (organization_id, actor_id, event_type, metadata)
    VALUES (
        p_org_id, auth.uid(), 'expense_attachment.removed',
        jsonb_build_object(
            'expense_id', v_att.expense_id,
            'attachment_id', p_attachment_id,
            'storage_path', v_att.storage_path
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'attachment_id', p_attachment_id,
        'storage_path', v_att.storage_path
    );
END;
$$;


CREATE OR REPLACE FUNCTION public.get_invoices_expenses_summary(
    p_org_id    UUID,
    p_from_date DATE,
    p_to_date   DATE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_org           RECORD;
    v_org_today     DATE;
    v_inv_period    RECORD;
    v_pay_period    RECORD;
    v_open_recv     RECORD;
    v_overdue_recv  RECORD;
    v_exp_period    RECORD;
    v_cat_breakdown JSONB;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '08001', MESSAGE = 'UNAUTHENTICATED';
    END IF;

    SELECT id, currency, timezone INTO v_org
    FROM public.organizations
    WHERE id = p_org_id AND is_active = TRUE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ORGANIZATION_INACTIVE';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_memberships
        WHERE organization_id = p_org_id AND user_id = auth.uid() AND status = 'active'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'MEMBERSHIP_INACTIVE';
    END IF;

    IF NOT public.check_user_permission(p_org_id, auth.uid(), 'financial_summaries:read') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'INSUFFICIENT_PERMISSIONS';
    END IF;

    IF p_from_date IS NULL OR p_to_date IS NULL OR p_to_date < p_from_date THEN
        RAISE EXCEPTION USING ERRCODE = 'P0071', MESSAGE = 'INVALID_DATE_RANGE';
    END IF;

    v_org_today := (now() AT TIME ZONE COALESCE(NULLIF(trim(v_org.timezone), ''), 'UTC'))::DATE;

    -- Period activity: issued invoices (issued, partially_paid, paid; excludes draft & cancelled)
    SELECT
        COUNT(*)::integer AS issued_count,
        COALESCE(SUM(total_amount), 0.0000) AS issued_total,
        COUNT(*) FILTER (WHERE status = 'paid')::integer AS paid_count,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'paid'), 0.0000) AS paid_total,
        COUNT(*) FILTER (WHERE status = 'partially_paid')::integer AS partially_paid_count,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'partially_paid'), 0.0000) AS partially_paid_total
    INTO v_inv_period
    FROM public.invoices
    WHERE organization_id = p_org_id
      AND status IN ('issued', 'partially_paid', 'paid')
      AND issue_date BETWEEN p_from_date AND p_to_date;

    -- Period activity: collected recorded invoice payments
    SELECT
        COUNT(*)::integer AS payment_count,
        COALESCE(SUM(amount), 0.0000) AS collected_total
    INTO v_pay_period
    FROM public.invoice_payments
    WHERE organization_id = p_org_id
      AND status = 'recorded'
      AND payment_date BETWEEN p_from_date AND p_to_date;

    -- Point-in-time receivables As of Today
    SELECT
        COUNT(*)::integer AS open_count,
        COALESCE(SUM(outstanding_balance), 0.0000) AS open_total
    INTO v_open_recv
    FROM public.invoices
    WHERE organization_id = p_org_id
      AND status IN ('issued', 'partially_paid');

    SELECT
        COUNT(*)::integer AS overdue_count,
        COALESCE(SUM(outstanding_balance), 0.0000) AS overdue_total
    INTO v_overdue_recv
    FROM public.invoices
    WHERE organization_id = p_org_id
      AND status IN ('issued', 'partially_paid')
      AND due_date < v_org_today;

    -- Period activity: active expenses (excludes voided and corrected)
    SELECT
        COUNT(*)::integer AS active_count,
        COALESCE(SUM(total_amount), 0.0000) AS active_total,
        COUNT(*) FILTER (WHERE payment_status = 'paid')::integer AS paid_count,
        COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid'), 0.0000) AS paid_total,
        COUNT(*) FILTER (WHERE payment_status = 'unpaid')::integer AS unpaid_count,
        COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'unpaid'), 0.0000) AS unpaid_total
    INTO v_exp_period
    FROM public.expenses
    WHERE organization_id = p_org_id
      AND lifecycle_status = 'active'
      AND expense_date BETWEEN p_from_date AND p_to_date;

    -- Expense totals grouped by category (retains archived categories with active historical expenses in range)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'category_id', sub.category_id,
            'category_name', sub.category_name,
            'category_status', sub.category_status,
            'expense_count', sub.expense_count,
            'total_amount', to_char(sub.total_amount, 'FM9999999990.0000'),
            'paid_amount', to_char(sub.paid_amount, 'FM9999999990.0000'),
            'unpaid_amount', to_char(sub.unpaid_amount, 'FM9999999990.0000')
        ) ORDER BY sub.total_amount DESC, sub.category_name ASC
    ), '[]'::jsonb)
    INTO v_cat_breakdown
    FROM (
        SELECT
            c.id AS category_id,
            c.name AS category_name,
            c.status AS category_status,
            COUNT(e.id)::integer AS expense_count,
            COALESCE(SUM(e.total_amount), 0.0000) AS total_amount,
            COALESCE(SUM(e.total_amount) FILTER (WHERE e.payment_status = 'paid'), 0.0000) AS paid_amount,
            COALESCE(SUM(e.total_amount) FILTER (WHERE e.payment_status = 'unpaid'), 0.0000) AS unpaid_amount
        FROM public.expenses e
        JOIN public.expense_categories c
          ON c.organization_id = e.organization_id AND c.id = e.category_id
        WHERE e.organization_id = p_org_id
          AND e.lifecycle_status = 'active'
          AND e.expense_date BETWEEN p_from_date AND p_to_date
        GROUP BY c.id, c.name, c.status
    ) sub;

    RETURN jsonb_build_object(
        'currency', v_org.currency,
        'timezone', v_org.timezone,
        'from_date', p_from_date,
        'to_date', p_to_date,
        'as_of_date', v_org_today,
        'period_invoices', jsonb_build_object(
            'issued_count', v_inv_period.issued_count,
            'issued_total', to_char(v_inv_period.issued_total, 'FM9999999990.0000'),
            'paid_count', v_inv_period.paid_count,
            'paid_total', to_char(v_inv_period.paid_total, 'FM9999999990.0000'),
            'partially_paid_count', v_inv_period.partially_paid_count,
            'partially_paid_total', to_char(v_inv_period.partially_paid_total, 'FM9999999990.0000'),
            'collected_payments_count', v_pay_period.payment_count,
            'collected_payments_total', to_char(v_pay_period.collected_total, 'FM9999999990.0000')
        ),
        'current_receivables', jsonb_build_object(
            'open_invoice_count', v_open_recv.open_count,
            'open_balance_total', to_char(v_open_recv.open_total, 'FM9999999990.0000'),
            'overdue_invoice_count', v_overdue_recv.overdue_count,
            'overdue_balance_total', to_char(v_overdue_recv.overdue_total, 'FM9999999990.0000')
        ),
        'period_expenses', jsonb_build_object(
            'active_count', v_exp_period.active_count,
            'active_total', to_char(v_exp_period.active_total, 'FM9999999990.0000'),
            'paid_count', v_exp_period.paid_count,
            'paid_total', to_char(v_exp_period.paid_total, 'FM9999999990.0000'),
            'unpaid_count', v_exp_period.unpaid_count,
            'unpaid_total', to_char(v_exp_period.unpaid_total, 'FM9999999990.0000'),
            'by_category', v_cat_breakdown
        )
    );
END;
$$;


-- ============================================================================
-- T017: RPC Ownership, Search Path & Execution Grants (All 20 P0 RPCs)
-- ============================================================================

-- 1. create_invoice
ALTER FUNCTION public.create_invoice(UUID, UUID, DATE, DATE, JSONB, NUMERIC, BOOLEAN, TEXT, TEXT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_invoice(UUID, UUID, DATE, DATE, JSONB, NUMERIC, BOOLEAN, TEXT, TEXT, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_invoice(UUID, UUID, DATE, DATE, JSONB, NUMERIC, BOOLEAN, TEXT, TEXT, UUID) TO authenticated;

-- 2. update_invoice
ALTER FUNCTION public.update_invoice(UUID, UUID, UUID, DATE, DATE, JSONB, NUMERIC, BOOLEAN, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_invoice(UUID, UUID, UUID, DATE, DATE, JSONB, NUMERIC, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_invoice(UUID, UUID, UUID, DATE, DATE, JSONB, NUMERIC, BOOLEAN, TEXT, TEXT) TO authenticated;

-- 3. delete_draft_invoice
ALTER FUNCTION public.delete_draft_invoice(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_draft_invoice(UUID, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_draft_invoice(UUID, UUID) TO authenticated;

-- 4. get_invoice_detail
ALTER FUNCTION public.get_invoice_detail(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_invoice_detail(UUID, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_invoice_detail(UUID, UUID) TO authenticated;

-- 5. issue_invoice
ALTER FUNCTION public.issue_invoice(UUID, UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_invoice(UUID, UUID, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.issue_invoice(UUID, UUID, UUID) TO authenticated;

-- 6. cancel_invoice
ALTER FUNCTION public.cancel_invoice(UUID, UUID, TEXT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_invoice(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_invoice(UUID, UUID, TEXT, UUID) TO authenticated;

-- 7. record_invoice_payment
ALTER FUNCTION public.record_invoice_payment(UUID, UUID, TEXT, NUMERIC, DATE, TEXT, TEXT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_invoice_payment(UUID, UUID, TEXT, NUMERIC, DATE, TEXT, TEXT, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_invoice_payment(UUID, UUID, TEXT, NUMERIC, DATE, TEXT, TEXT, UUID) TO authenticated;

-- 8. reverse_invoice_payment
ALTER FUNCTION public.reverse_invoice_payment(UUID, UUID, TEXT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reverse_invoice_payment(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reverse_invoice_payment(UUID, UUID, TEXT, UUID) TO authenticated;

-- 9. seed_default_expense_categories
ALTER FUNCTION public.seed_default_expense_categories(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.seed_default_expense_categories(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.seed_default_expense_categories(UUID) TO authenticated;

-- 10. create_expense_category
ALTER FUNCTION public.create_expense_category(UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_expense_category(UUID, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_expense_category(UUID, TEXT, TEXT) TO authenticated;

-- 11. update_expense_category
ALTER FUNCTION public.update_expense_category(UUID, UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_expense_category(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_expense_category(UUID, UUID, TEXT, TEXT) TO authenticated;

-- 12. archive_expense_category
ALTER FUNCTION public.archive_expense_category(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.archive_expense_category(UUID, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.archive_expense_category(UUID, UUID) TO authenticated;

-- 13. create_expense
ALTER FUNCTION public.create_expense(UUID, TEXT, UUID, NUMERIC, NUMERIC, DATE, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_expense(UUID, TEXT, UUID, NUMERIC, NUMERIC, DATE, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_expense(UUID, TEXT, UUID, NUMERIC, NUMERIC, DATE, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, UUID) TO authenticated;

-- 14. update_expense
ALTER FUNCTION public.update_expense(UUID, UUID, TEXT, UUID, NUMERIC, NUMERIC, DATE, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_expense(UUID, UUID, TEXT, UUID, NUMERIC, NUMERIC, DATE, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_expense(UUID, UUID, TEXT, UUID, NUMERIC, NUMERIC, DATE, TEXT, TEXT) TO authenticated;

-- 15. mark_expense_paid
ALTER FUNCTION public.mark_expense_paid(UUID, UUID, DATE, TEXT, TEXT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mark_expense_paid(UUID, UUID, DATE, TEXT, TEXT, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mark_expense_paid(UUID, UUID, DATE, TEXT, TEXT, UUID) TO authenticated;

-- 16. void_expense
ALTER FUNCTION public.void_expense(UUID, UUID, TEXT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.void_expense(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.void_expense(UUID, UUID, TEXT, UUID) TO authenticated;

-- 17. correct_paid_expense
ALTER FUNCTION public.correct_paid_expense(UUID, UUID, TEXT, TEXT, UUID, NUMERIC, NUMERIC, DATE, TEXT, TEXT, DATE, TEXT, TEXT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.correct_paid_expense(UUID, UUID, TEXT, TEXT, UUID, NUMERIC, NUMERIC, DATE, TEXT, TEXT, DATE, TEXT, TEXT, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.correct_paid_expense(UUID, UUID, TEXT, TEXT, UUID, NUMERIC, NUMERIC, DATE, TEXT, TEXT, DATE, TEXT, TEXT, UUID) TO authenticated;

-- 18. register_expense_attachment
ALTER FUNCTION public.register_expense_attachment(UUID, UUID, TEXT, TEXT, TEXT, BIGINT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.register_expense_attachment(UUID, UUID, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.register_expense_attachment(UUID, UUID, TEXT, TEXT, TEXT, BIGINT) TO authenticated;

-- 19. delete_expense_attachment
ALTER FUNCTION public.delete_expense_attachment(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_expense_attachment(UUID, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_expense_attachment(UUID, UUID) TO authenticated;

-- 20. get_invoices_expenses_summary
ALTER FUNCTION public.get_invoices_expenses_summary(UUID, DATE, DATE) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_invoices_expenses_summary(UUID, DATE, DATE) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_invoices_expenses_summary(UUID, DATE, DATE) TO authenticated;

COMMIT;
