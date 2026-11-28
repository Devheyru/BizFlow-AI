# Database RPC Contracts: Feature 006 — Invoices & Expenses

**Branch**: `006-invoices-expenses` | **Date**: 2026-11-28 | **Spec**: [spec.md](../spec.md) | **Data Model**: [data-model.md](../data-model.md)

Every stored procedure in Feature 006 follows the mandatory security preamble:
1. `SECURITY DEFINER`, `OWNER TO postgres`, `SET search_path = pg_catalog, public, pg_temp`
2. `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, service_role; GRANT EXECUTE ON FUNCTION ... TO authenticated;`
3. Verify `auth.uid()` is non-null (`08001 UNAUTHENTICATED`)
4. Verify organization active (`P0001`), active membership (`P0002`), and granular `public.check_user_permission(p_org_id, v_user_id, <perm>)` (`42501 INSUFFICIENT_PERMISSIONS`)
5. Never touch `public.sales`, `public.payments`, `public.sale_returns`, `public.refunds`, `public.inventory`, `public.stock_movements`, or `public.product_costs` (`D1`).

---

## 1. Authoritative Financial Calculation Helper (`_compute_invoice_totals` / Inline Pipeline)

Used identically by `create_invoice`, `update_invoice`, and `issue_invoice`:
1. Normalize currency decimals: `v_decimals := public.get_currency_exponent(v_org_currency)`.
2. For each input line sorted by `sort_order ASC` (`0..n-1`):
   - Validate `quantity > 0` (`P0012`), precision `<= 4` (`P0016`), `unit_price >= 0` (`P0007`), `line_discount_amount >= 0` (`P0007`), `description` trimmed `1..255`.
   - `line_gross_i = ROUND(quantity * unit_price, 4)`
   - `line_disc_i = ROUND(line_discount_amount, decimals)` (`P0047` if `line_disc_i > line_gross_i`)
   - `line_net_i = ROUND(line_gross_i - line_disc_i, 4)`
3. Compute `v_subtotal = COALESCE(SUM(line_gross_i), 0.0000)` and `v_net_subtotal = COALESCE(SUM(line_net_i), 0.0000)`.
4. Clamp & validate invoice discount:
   - `v_inv_disc = ROUND(COALESCE(p_invoice_discount_amount, 0.0000), decimals)`
   - Reject `v_inv_disc < 0` (`P0007`) or `v_inv_disc > v_net_subtotal` (`P0047 DISCOUNT_EXCEEDS_MAXIMUM`).
   - Identify residual target `v_last_pos_idx = MAX(i) WHERE line_net_i > 0.0000` (NULL if all lines `<= 0`).
5. Allocate invoice discount & compute tax line-by-line:
   - Effective rate `v_eff_rate = CASE WHEN p_is_tax_exempt THEN 0.0000 ELSE v_tax_rate END`.
   - For each line `i`:
     - If `v_net_subtotal <= 0.0000` OR `v_inv_disc = 0.0000` OR `line_net_i = 0.0000`: `alloc_disc_i = 0.0000`.
     - Else if `i = v_last_pos_idx`: `alloc_disc_i = ROUND(GREATEST(0.0000, LEAST(line_net_i, v_inv_disc - v_running_disc)), decimals)`.
     - Else: `alloc_disc_i = ROUND((line_net_i / v_net_subtotal) * v_inv_disc, decimals)`; accumulate `v_running_disc`.
     - `line_discounted_i = GREATEST(0.0000, ROUND(line_net_i - alloc_disc_i, decimals))`
     - If `NOT line_is_taxable`: `taxable_i = 0.0000`, `tax_i = 0.0000`, `total_i = line_discounted_i`.
     - Else if `v_eff_rate = 0.0000` OR `line_discounted_i = 0.0000`: `taxable_i = line_discounted_i`, `tax_i = 0.0000`, `total_i = line_discounted_i`.
     - Else if `v_is_tax_inclusive`: `taxable_i = ROUND(line_discounted_i / (1.0 + v_eff_rate / 100.0), decimals)`, `tax_i = ROUND(line_discounted_i - taxable_i, decimals)`, `total_i = line_discounted_i`.
     - Else (exclusive): `taxable_i = line_discounted_i`, `tax_i = ROUND(line_discounted_i * (v_eff_rate / 100.0), decimals)`, `total_i = ROUND(line_discounted_i + tax_i, decimals)`.
6. Sum line outputs strictly (`v_taxable = SUM(taxable_i)`, `v_tax = SUM(tax_i)`, `v_total = SUM(total_i)`).

---

## 2. Shared Idempotency Evaluation Precedence (All Idempotent RPCs)

For every RPC taking `p_idempotency_key`:
1. Acquire `PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_idempotency_key::text))` and require non-null UUID (`P0055`).
2. Compute canonical SHA-256 hex digest of normalized JSONB payload.
3. **Case C (Cross-Record Conflict)**: If `p_idempotency_key` exists on a *different* record in the same org (e.g. different `invoice_id`, `payment_id`, or `expense_id` within that RPC's key scope) → `RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT'`.
4. **Case A (Same-Record Replay)**: If target already stores `p_idempotency_key` with matching hash → immediately return original stored result JSONB with `is_replay = true` **before** validating current transition state (`F-07`, `D2` `reverse_invoice_payment`, `F-01` `correct_paid_expense`).
5. **Case B (Same-Record Drift)**: If target stores `p_idempotency_key` with differing hash → `RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT'`.
6. **Case D (Fresh Key State Validation)**: Only now check target row state preconditions (`P0072`–`P0089`).

---

## 3. Invoice RPCs (7)

### 3.1 `public.create_invoice`
- **Signature**: `(p_org_id UUID, p_customer_id UUID, p_issue_date DATE, p_due_date DATE, p_items JSONB, p_invoice_discount_amount NUMERIC, p_is_tax_exempt BOOLEAN, p_notes TEXT, p_payment_instructions TEXT, p_idempotency_key UUID) RETURNS JSONB`
- **Permission**: `invoices:create`
- **Validation & Preconditions**:
  - `p_due_date >= p_issue_date` (`P0071 INVALID_DATE_RANGE`).
  - Customer exists in `p_org_id` (`P0040 CUSTOMER_NOT_FOUND`) and `status = 'active'` (`P0041 CUSTOMER_ARCHIVED`).
  - Optional catalog `product_id` on items belongs to org (`P0003`) and is active (snapshot `sku_snapshot`, `unit_of_measure_snapshot`).
  - Reads org tax settings (`organization_tax_settings`, defaulting to `'VAT'`, `0.0000`, `false` if unset) to compute preview totals.
- **Idempotency**: Advisory lock + `draft_idempotency_key` / `draft_idempotency_hash`. Canonical payload sorts normalized `items` by `(sort_order ASC, description ASC)`. Replay returns `{ success: true, is_replay: true, invoice_id, status: 'draft', total_amount, ... }`.
- **Effects**: Inserts `invoices` (`status = 'draft'`, `invoice_number = NULL`, `customer_*_snapshot`) + `invoice_items`; logs `invoice.created` to `organization_audit_events`.

### 3.2 `public.update_invoice`
- **Signature**: `(p_org_id UUID, p_invoice_id UUID, p_customer_id UUID, p_issue_date DATE, p_due_date DATE, p_items JSONB, p_invoice_discount_amount NUMERIC, p_is_tax_exempt BOOLEAN, p_notes TEXT, p_payment_instructions TEXT) RETURNS JSONB`
- **Permission**: `invoices:update`
- **Locks & Checks**: Locks `invoices ... FOR UPDATE`; rejects missing (`P0070`) or `status <> 'draft'` (`P0072 INVOICE_IMMUTABLE_AFTER_ISSUANCE`); validates `p_due_date >= p_issue_date` (`P0071`) and active customer (`P0040`/`P0041`).
- **Effects**: Updates header & customer snapshots, replaces `invoice_items`, recalculates totals, logs `invoice.updated`.

### 3.3 `public.delete_draft_invoice`
- **Signature**: `(p_org_id UUID, p_invoice_id UUID) RETURNS JSONB`
- **Permission**: `invoices:update`
- **Locks & Checks**: Locks `invoices ... FOR UPDATE`; rejects missing (`P0070`) or `status <> 'draft'` (`P0072`).
- **Effects**: Deletes unissued draft row (`ON DELETE CASCADE` removes `invoice_items`), logs `invoice.draft_deleted`.

### 3.4 `public.issue_invoice`
- **Signature**: `(p_org_id UUID, p_invoice_id UUID, p_idempotency_key UUID) RETURNS JSONB`
- **Permission**: `invoices:issue`
- **Locks & Checks**: Advisory lock `(p_org_id, p_idempotency_key)` + Precedence C/A/B/D; locks `invoices ... FOR UPDATE`; verifies `status = 'draft'` (`P0072`), `>= 1` item (`P0073 INVOICE_EMPTY_ITEMS`), active customer (`P0041`), any linked `product_id` has `status = 'active'` (`P0086 PRODUCT_UNAVAILABLE_FOR_INVOICE`).
- **Effects**:
  - Snapshots live `organization_tax_settings` and active `customers` (`name`, `email`, `phone`) cleanly.
  - Recomputes authoritative totals under locked tax snapshot.
  - Allocates sequential `INV-{YYYYMMDD}-{XXXX}` via `public.financial_sequences` (`sequence_type = 'invoice'`, `date_key = (now() AT TIME ZONE org.timezone)::DATE`).
  - If `v_total = 0.0000`: sets `status = 'paid'`, `outstanding_balance = 0.0000`, `issued_at = now()`, `paid_at = now()`. Otherwise sets `status = 'issued'`, `outstanding_balance = v_total`, `issued_at = now()`.
  - Logs `invoice.issued`.

### 3.5 `public.cancel_invoice`
- **Signature**: `(p_org_id UUID, p_invoice_id UUID, p_reason TEXT, p_idempotency_key UUID) RETURNS JSONB`
- **Permission**: `invoices:cancel`
- **Locks & Checks**: Advisory lock + Precedence C/A/B/D; locks `invoices ... FOR UPDATE`; verifies `trim(p_reason)` 3..255 chars; verifies zero active `'recorded'` payments (`paid_amount = 0.0000` and zero `'recorded'` rows → else `P0076 INVOICE_HAS_ACTIVE_PAYMENTS`); verifies `status = 'issued'` (drafts must be deleted via `delete_draft_invoice`, `paid` zero-value or paid invoices without active reversal blocked `P0072`/`P0074`).
- **Effects**: Sets `status = 'cancelled'`, `cancelled_at = now()`, `cancelled_by = auth.uid()`, `cancellation_reason`, retains `invoice_number`, logs `invoice.cancelled`.

### 3.6 `public.duplicate_invoice` *(P1)*
- **Signature**: `(p_org_id UUID, p_source_invoice_id UUID, p_idempotency_key UUID) RETURNS JSONB`
- **Permission**: `invoices:create`
- **Effects**: Copies active customer (or rejects `P0041`), line descriptions/prices/discounts/taxability, notes, and instructions with org-today `issue_date` & `+14` day `due_date` into a new `'draft'` via identical `draft_idempotency_key` safety; logs `invoice.duplicated`.

### 3.7 `public.get_invoice_detail`
- **Signature**: `(p_org_id UUID, p_invoice_id UUID) RETURNS JSONB`
- **Permission**: `invoices:read` *(payments array returned only if `check_user_permission(p_org_id, auth.uid(), 'invoice_payments:read')`)*
- **Effects**: Returns header (with derived `is_overdue` using `org.timezone`), customer block, ordered `items` (never exposing `product_costs`), `payments` (ordered `created_at ASC`, including `balance_after_payment`), and org billing block (`name`, `address`, `phone`, `email`, `tax_id`, `currency`, `timezone`). Rejects missing/cross-tenant with `P0070`.

---

## 4. Invoice Payment RPCs (2)

### 4.1 `public.record_invoice_payment`
- **Signature**: `(p_org_id UUID, p_invoice_id UUID, p_payment_method TEXT, p_amount NUMERIC, p_payment_date DATE, p_reference_no TEXT, p_notes TEXT, p_idempotency_key UUID) RETURNS JSONB`
- **Permission**: `invoice_payments:create`
- **Locks & Checks**:
  - Advisory lock `(p_org_id, p_idempotency_key)` + Precedence C/A/B/D (canonical hash includes `invoice_id`, `payment_method`, `formatCanonicalAmount(amount)`, `payment_date`, `NULLIF(trim(reference_no), '')`, `NULLIF(trim(notes), '')`).
  - Locks `invoices ... FOR UPDATE`. Rejects missing (`P0070`) or `status NOT IN ('issued', 'partially_paid')` (`P0074 INVOICE_NOT_PAYABLE`).
  - Validates `p_amount > 0` (`P0007`), `p_payment_method` valid, non-cash requires non-empty `reference_no` (`P0057`), `p_amount` precision `<= org_decimals` (`P0016`), and `p_amount <= outstanding_balance` (`P0075 INVOICE_PAYMENT_EXCEEDS_BALANCE`).
- **Effects**:
  - Allocates sequential `IPAY-{YYYYMMDD}-{XXXX}` via `public.financial_sequences` (`sequence_type = 'invoice_payment'`).
  - Computes `v_new_paid = paid_amount + p_amount`, `v_new_outstanding = total_amount - v_new_paid`.
  - Inserts `public.invoice_payments` with **`balance_after_payment = v_new_outstanding`** (`F-02`), `created_by = auth.uid()`. Maps active duplicate `(org, method, reference_no)` `23505` cleanly.
  - Updates `invoices` (`paid_amount`, `outstanding_balance`, `status = CASE WHEN v_new_outstanding = 0 THEN 'paid' ELSE 'partially_paid' END`, `paid_at = CASE WHEN v_new_outstanding = 0 THEN now() ELSE NULL END`).
  - Logs `invoice_payment.recorded`. Returns `{ success: true, is_replay: false, payment_id, payment_number, balance_after_payment, invoice_status, outstanding_balance }`.

### 4.2 `public.reverse_invoice_payment`
- **Signature**: `(p_org_id UUID, p_payment_id UUID, p_reason TEXT, p_idempotency_key UUID) RETURNS JSONB`
- **Permission**: `invoice_payments:reverse`
- **Locks & Checks**:
  - Advisory lock `(p_org_id, p_idempotency_key)` + **Precedence C → A → B → D**:
    - Lock target `invoice_payments ... FOR UPDATE` (`P0077 INVOICE_PAYMENT_NOT_FOUND` if missing).
    - Cross-record reuse of `reversal_idempotency_key` on another payment → `P0024`.
    - Same-record `reversal_idempotency_key` + matching hash → return stored reversal result `{ success: true, is_replay: true, payment_id, status: 'reversed', ... }` **even though `status = 'reversed'`** (`D2`).
    - Same-record differing hash → `P0024`.
    - Fresh key against `status = 'reversed'` → `P0078 INVOICE_PAYMENT_ALREADY_REVERSED`.
  - Locks parent `invoices ... FOR UPDATE`; verifies `trim(p_reason)` 3..255 chars and invoice `status <> 'cancelled'`.
- **Effects**:
  - Marks `invoice_payments.status = 'reversed'`, `reversed_at = now()`, `reversed_by = auth.uid()`, `reversal_reason`.
  - Recomputes `v_new_paid = COALESCE(SUM(amount), 0.0000)` over `'recorded'` payments on `invoice_id`; updates `invoices` (`paid_amount`, `outstanding_balance = total_amount - v_new_paid`, `status = CASE WHEN v_new_paid = 0 THEN 'issued' ELSE 'partially_paid' END`, `paid_at = NULL`).
  - Logs `invoice_payment.reversed` (strictly internal ledger correction; zero customer refund record or payout created).

---

## 5. Expense, Category, Attachment & Summary RPCs (12)

### 5.1–5.4 Expense Categories (`seed_default_expense_categories`, `create_expense_category`, `update_expense_category`, `archive_expense_category`)
- `seed_default_expense_categories(p_org_id UUID)`: Permission `expense_categories:read` OR `expense_categories:manage`. Acquires `pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext('seed_default_expense_categories'))`; inserts the 8 standard categories (`is_system_default = true`) with `ON CONFLICT DO NOTHING` on `(organization_id, lower(trim(name))) WHERE status = 'active'`.
- `create_expense_category(p_org_id, p_name, p_description)`: Permission `expense_categories:manage`. Trims name, relies on unique active index (`23505`), logs `expense_category.created`.
- `update_expense_category(p_org_id, p_category_id, p_name, p_description)`: Permission `expense_categories:manage`. Rejects missing (`P0079`) or archived (`P0080`), updates name/description, logs `expense_category.updated`.
- `archive_expense_category(p_org_id, p_category_id)`: Permission `expense_categories:manage`. Idempotent if already archived; preserves existing expenses; logs `expense_category.archived`.

### 5.5 `public.create_expense`
- **Signature**: `(p_org_id UUID, p_title TEXT, p_category_id UUID, p_net_amount NUMERIC, p_tax_amount NUMERIC, p_expense_date DATE, p_payee_name TEXT, p_description TEXT, p_payment_status TEXT, p_payment_date DATE, p_payment_method TEXT, p_reference_no TEXT, p_idempotency_key UUID) RETURNS JSONB`
- **Permission**: `expenses:create`
- **Checks**: Advisory lock + Precedence C/A/B/D; category exists (`P0079`) & `'active'` (`P0080`); `p_net_amount > 0` (`P0007`), `COALESCE(p_tax_amount, 0) >= 0` (`P0007`), rounded to `org_decimals`; `p_payment_status IN ('unpaid', 'paid')`; `'paid'` requires `p_payment_date`, `p_payment_method`, and non-cash `p_reference_no` (`P0057`), setting `paid_at = now()`, `paid_by = auth.uid()`; `'unpaid'` nulls all 5 settlement columns (`F-05`).
- **Effects**: Allocates sequential `EXP-{YYYYMMDD}-{XXXX}`, inserts `'active'` expense, logs `expense.created`.

### 5.6 `public.update_expense`
- **Signature**: `(p_org_id UUID, p_expense_id UUID, p_title TEXT, p_category_id UUID, p_net_amount NUMERIC, p_tax_amount NUMERIC, p_expense_date DATE, p_payee_name TEXT, p_description TEXT) RETURNS JSONB`
- **Permission**: `expenses:update`
- **Locks & Checks**: Locks `expenses ... FOR UPDATE` (`P0081` if missing). Rejects `'voided'` (`P0083 EXPENSE_VOIDED`) and `'corrected'` (`P0088 EXPENSE_NOT_ACTIVE`).
  - If `payment_status = 'paid'`: rejects ANY change to `net_amount` or `tax_amount` (`P0084 PAID_EXPENSE_AMOUNT_LOCKED`), allowing non-financial metadata (`title`, `description`, `payee_name`, `category_id` if active) with audit event `expense.updated`.
  - If `payment_status = 'unpaid'`: updates allowed fields including `net_amount`, `tax_amount`, `total_amount`, `expense_date`, logs `expense.updated`.

### 5.7 `public.mark_expense_paid`
- **Signature**: `(p_org_id UUID, p_expense_id UUID, p_payment_date DATE, p_payment_method TEXT, p_reference_no TEXT, p_idempotency_key UUID) RETURNS JSONB`
- **Permission**: `expenses:pay`
- **Locks & Checks**: Advisory lock + Precedence C/A/B/D; locks `expenses ... FOR UPDATE` (`P0081`); rejects `'voided'` (`P0083`), `'corrected'` (`P0088`), `'paid'` (`P0082 EXPENSE_ALREADY_PAID`), or missing non-cash reference (`P0057`).
- **Effects**: Sets `payment_status = 'paid'`, `payment_date`, `payment_method`, `reference_no`, `paid_at = now()`, `paid_by = auth.uid()`, logs `expense.paid`.

### 5.8 `public.void_expense`
- **Signature**: `(p_org_id UUID, p_expense_id UUID, p_reason TEXT, p_idempotency_key UUID) RETURNS JSONB`
- **Permission**: `expenses:void`
- **Locks & Checks**: Advisory lock + Precedence C/A/B/D; locks `expenses ... FOR UPDATE` (`P0081`); rejects `'voided'` (`P0083`), `'corrected'` (`P0088`), and **`payment_status = 'paid'` (`P0087 PAID_EXPENSE_VOID_BLOCKED`)**; requires `trim(p_reason)` 3..255 chars.
- **Effects**: Sets `lifecycle_status = 'voided'`, `voided_at = now()`, `voided_by = auth.uid()`, `void_reason`, excludes from totals while retaining attachments read-only, logs `expense.voided`.

### 5.9 `public.correct_paid_expense` *(F-01)*
- **Signature**: `(p_org_id UUID, p_expense_id UUID, p_reason TEXT, p_title TEXT, p_category_id UUID, p_net_amount NUMERIC, p_tax_amount NUMERIC, p_expense_date DATE, p_payee_name TEXT, p_description TEXT, p_payment_date DATE, p_payment_method TEXT, p_reference_no TEXT, p_idempotency_key UUID) RETURNS JSONB`
- **Permission**: `expenses:void`
- **Locks & Checks**: Advisory lock + Precedence C/A/B/D; locks `expenses ... FOR UPDATE` (`P0081`); rejects `'voided'` (`P0083`), `'corrected'` (`P0088 EXPENSE_NOT_ACTIVE`), and `'unpaid'` (`P0089 EXPENSE_NOT_PAID`); requires `trim(p_reason)` 3..255 chars; validates category (`P0079`/`P0080`), positive rounded amounts, non-cash ref (`P0057`).
- **Atomic Execution Order** *(prevents partial unique index collision if reference is reused)*:
  1. Update original row: `lifecycle_status = 'corrected'`, `correction_reason`, `correct_idempotency_key`, `correct_idempotency_hash`, `updated_by = auth.uid()`, `updated_at = now()`. (Original amounts, `payment_*`, and attachments remain untouched.)
  2. Allocate new `EXP-{YYYYMMDD}-{XXXX}` and insert `'active'` `'paid'` replacement row (`supersedes_expense_id = original.id`, `paid_at = now()`, `paid_by = auth.uid()`).
  3. Update original row setting `corrected_by_expense_id = replacement.id`.
  4. Append `expense.corrected` to `organization_audit_events`.
  5. Return `{ success: true, is_replay: false, original_expense_id, replacement_expense_id, replacement_expense_number }`.

### 5.10 `public.register_expense_attachment`, `public.delete_expense_attachment`, & `public.get_invoices_expenses_summary`
- `register_expense_attachment(p_org_id, p_expense_id, p_storage_path, p_file_name, p_mime_type, p_file_size)`: Permission `expenses:create` OR `expenses:update`. Locks `expenses ... FOR UPDATE` (`P0081`), enforces `lifecycle_status = 'active'` (`P0083` / `P0088`), validates `{p_org_id}/{p_expense_id}/...` regex + MIME + size `<= 5242880` (`P0085 INVALID_ATTACHMENT`), inserts `expense_attachments`, logs `expense_attachment.added`.
- `delete_expense_attachment(p_org_id, p_attachment_id)`: Permission `expenses:update`. Locks parent `expenses ... FOR UPDATE`, enforces parent `lifecycle_status = 'active'` (`P0083` / `P0088`), deletes `expense_attachments` row and returns `storage_path` for Storage deletion, logs `expense_attachment.removed`.
- `get_invoices_expenses_summary(p_org_id, p_from_date DATE, p_to_date DATE)`: Permission `financial_summaries:read`. Validates `p_to_date >= p_from_date` (`P0071 INVALID_DATE_RANGE`). Returns:
  - `currency`, `from_date`, `to_date`, `as_of_date` (`org_today`)
  - **Period Activity**: issued invoice count/total, paid/partially_paid breakdown in period (`issue_date` in `[from, to]`, excluding `draft`/`cancelled`), collected invoice payments (`payment_date` in `[from, to]`, `status = 'recorded'`), active expenses total + paid vs unpaid split (`expense_date` in `[from, to]`, `lifecycle_status = 'active'`), category breakdown (retaining archived categories with active expenses in range).
  - **Point-in-Time Receivables (`As of Today`)**: `current_open_receivables_total`, `current_open_invoice_count`, `current_overdue_receivables_total`, `current_overdue_invoice_count` across all `status IN ('issued', 'partially_paid')` invoices regardless of filter dates (`F-04`).
