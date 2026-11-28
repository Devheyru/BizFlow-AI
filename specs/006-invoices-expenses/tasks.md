# Tasks: Feature 006 — Invoices & Expenses

**Input**: Design documents from `specs/006-invoices-expenses/`  
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/database-rpcs.md](./contracts/database-rpcs.md), [contracts/server-actions.md](./contracts/server-actions.md), [quickstart.md](./quickstart.md)  
**Tests**: Automated unit, integration (concurrency, financial precision, RLS/security, isolation), Playwright E2E, and Feature 001–005 regression test tasks are included in Phase 9 per `spec.md` §13–14 and `plan.md` Phase 5–6.  
**Priority Scope**: All core workflows across **US1–US6** are **P0**. **`FR-014` (`Duplicate as Draft`)** is isolated into optional **P1** tasks (`T018`, `T039`, `T040`, `T070`) so **P0** implementation and release verification complete independently without requiring **P1**.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can execute in parallel (targets distinct files with zero unmet dependencies)
- **[US1]–[US6]**: Maps user story tasks to `spec.md` §5
- **Exact file paths**: Included in every task description

### Execution Rules

1. **Same-File Sequential Rule**: Tasks editing the same file MUST execute sequentially without concurrent edits:
   - Single SQL migration (`20261128000026_invoices_expenses_schema.sql`): `T001`–`T017` sequentially for P0; optional P1 `T018` executes sequentially after `T017` only if included.
   - Permissions catalog (`src/lib/auth/permissions.ts`): `T020` → `T021`.
   - Invoice actions (`src/actions/invoice-actions.ts`): P0-only execution order is `T033` → `T041` → `T044`; if optional P1 `T039` is selected, shared-file edit order is `T033` → `T039` → `T041` → `T044` (file-edit serialization only — P0 tasks `T041` and `T044` never depend on `T039`).
   - Invoice detail UI (`src/components/invoices/invoice-detail-view.tsx`): `T037` → `T043` → `T047` → `T052` for P0; if optional P1 `T040` is also selected, serialize its edit cleanly after `T037` (or after `T052`) without making P0 tasks depend on `T040`.
   - Expense actions (`src/actions/expense-actions.ts`): `T053` → `T054`.
2. **P0 Release Independence**: Every P0 task and checkpoint (`T001`–`T017`, `T019`–`T038`, `T041`–`T069`, `T071`–`T072`) executes, compiles, and passes acceptance independently without `T018`, `T039`, `T040`, or `T070`.
3. **Domain Boundaries**: Never mutate `public.sales`, `public.payments`, `public.sale_returns`, `public.refunds`, `public.inventory`, `public.stock_movements`, or expose `public.product_costs` (`D1`, `INT-003`–`INT-006`).

---

## Phase 1: Setup & Database Migration Foundation (`plan.md` Phase 1)

**Purpose**: Create `supabase/migrations/20261128000026_invoices_expenses_schema.sql` sequentially — **7 tables**, **1 private storage bucket**, **16 permissions**, **2 helpers**, **20 P0 RPCs** (`+ 1 optional P1 RPC`), and deny-all DML RLS.

> [!IMPORTANT]
> P0 tasks `T001`–`T017` edit the SQL migration sequentially and complete the P0 database schema without requiring `T018`. If optional P1 `T018` is selected, append it sequentially after `T017` before running `T019`.

- [ ] T001 Create migration file header and transaction wrapper plus `public.financial_sequences` table (`date_key` PK `(organization_id, sequence_type, date_key)` and `handle_updated_at()` trigger) in `supabase/migrations/20261128000026_invoices_expenses_schema.sql`
- [ ] T002 Define `public.invoices` table (columns, customer snapshot fields `customer_name_snapshot`/`customer_email_snapshot`/`customer_phone_snapshot`, `fk_invoices_org_customer` `ON DELETE RESTRICT`, `due_date >= issue_date`, `paid_amount + outstanding_balance = total_amount`, `draft_idempotency_key`, partial unique indexes, performance indexes, and `handle_updated_at()` trigger) in `supabase/migrations/20261128000026_invoices_expenses_schema.sql`
- [ ] T003 Define `public.invoice_items` table (composite FKs to `invoices` `ON DELETE CASCADE` and `products` `ON DELETE RESTRICT`, sorting/tax/discount columns, zero `unit_cost` column) in `supabase/migrations/20261128000026_invoices_expenses_schema.sql`
- [ ] T004 Define `public.invoice_payments` table (composite FK `ON DELETE RESTRICT`, `balance_after_payment >= 0` snapshot, non-cash `reference_no` and reversal `CHECK` constraints, active-only partial unique index `WHERE status = 'recorded'`) in `supabase/migrations/20261128000026_invoices_expenses_schema.sql`
- [ ] T005 Define `public.expense_categories`, `public.expenses` (including `lifecycle_status IN ('active', 'voided', 'corrected')`, canonical settlement `CHECK`, `void`/`corrected` `CHECK`s, self-referential composite FKs `supersedes_expense_id` and `corrected_by_expense_id`, active partial unique category/reference indexes, and `handle_updated_at()` triggers), and `public.expense_attachments` in `supabase/migrations/20261128000026_invoices_expenses_schema.sql`
- [ ] T006 Enable and force RLS on all 7 Feature 006 tables, add deny-all DML policies for `authenticated`, add permission-gated `SELECT` RLS policies (`invoices`, `invoice_items`, `invoice_payments`, `expense_categories`, `expenses`, `expense_attachments`), and grant table `SELECT` to `authenticated` in `supabase/migrations/20261128000026_invoices_expenses_schema.sql`
- [ ] T007 Provision private Storage bucket `'expense-attachments'` (5 MB limit, MIME allow-list) and create `SELECT`, `INSERT`, and `DELETE` `storage.objects` RLS policies verifying tenant path regex and parent `lifecycle_status = 'active'` on mutations in `supabase/migrations/20261128000026_invoices_expenses_schema.sql`
- [ ] T008 Insert 16 Feature 006 permission keys into `public.permissions` and role mappings (`admin`, `manager`; `cashier` denied all 16) into `public.role_permissions` in `supabase/migrations/20261128000026_invoices_expenses_schema.sql`
- [ ] T009 Implement internal helpers `public._f006_next_sequence` and `public._f006_compute_invoice_totals` (`get_currency_exponent` scaling, zero-subtotal guard, `k = max(line_net > 0)` residual guard, line-by-line tax reconciliation) with execution revoked from client roles in `supabase/migrations/20261128000026_invoices_expenses_schema.sql`
- [ ] T010 Implement P0 draft & query RPCs `public.create_invoice`, `public.update_invoice`, `public.delete_draft_invoice`, and `public.get_invoice_detail` (with advisory lock + `draft_idempotency_key`, `FOR UPDATE` locks, derived `is_overdue`, zero cost exposure) in `supabase/migrations/20261128000026_invoices_expenses_schema.sql`
- [ ] T011 Implement P0 lifecycle RPCs `public.issue_invoice` (`INV-` daily org-timezone sequence, customer/tax snapshot freeze, zero-total auto-`'paid'`, `P0073`/`P0086`) and `public.cancel_invoice` (`P0076` active payment block) in `supabase/migrations/20261128000026_invoices_expenses_schema.sql`
- [ ] T012 Implement P0 payment RPCs `public.record_invoice_payment` (`IPAY-` sequence, `FOR UPDATE` balance check `P0075`, immutable `balance_after_payment`) and `public.reverse_invoice_payment` (`Case C -> A -> B -> D` idempotency replay vs `P0078`, internal ledger only) in `supabase/migrations/20261128000026_invoices_expenses_schema.sql`
- [ ] T013 Implement Expense Category RPCs `public.seed_default_expense_categories` (advisory lock + `ON CONFLICT DO NOTHING`), `public.create_expense_category`, `public.update_expense_category`, and `public.archive_expense_category` in `supabase/migrations/20261128000026_invoices_expenses_schema.sql`
- [ ] T014 Implement Expense creation, update, and settlement RPCs `public.create_expense`, `public.update_expense` (`P0084` locked financial fields when `'paid'`), and `public.mark_expense_paid` (canonical `paid_at`/`paid_by`) in `supabase/migrations/20261128000026_invoices_expenses_schema.sql`
- [ ] T015 Implement `public.void_expense` (unpaid only; `P0087` on `'paid'`) and `public.correct_paid_expense` (3-step `UPDATE corrected -> INSERT replacement -> UPDATE link` ordering preserving settlement & attachments) in `supabase/migrations/20261128000026_invoices_expenses_schema.sql`
- [ ] T016 Implement `public.register_expense_attachment`, `public.delete_expense_attachment` (`lifecycle_status = 'active'` enforced), and `public.get_invoices_expenses_summary` (period `[from_date, to_date]` vs `As of Today` open/overdue receivables) in `supabase/migrations/20261128000026_invoices_expenses_schema.sql`
- [ ] T017 Set `OWNER TO postgres`, `SECURITY DEFINER`, `SET search_path = pg_catalog, public, pg_temp`, and `REVOKE ALL FROM PUBLIC, anon, service_role; GRANT EXECUTE TO authenticated;` across all 20 P0 RPCs in `supabase/migrations/20261128000026_invoices_expenses_schema.sql`
- [ ] T018 `(Optional P1 — FR-014)` Implement `public.duplicate_invoice(p_org_id, p_source_invoice_id, p_idempotency_key)` plus its `OWNER TO postgres` and `GRANT EXECUTE TO authenticated` block in `supabase/migrations/20261128000026_invoices_expenses_schema.sql`
- [ ] T019 Verify database migration applies cleanly alongside Features 001–005 via `npx supabase db reset` and run P0 schema verification queries (`7` tables, `1` bucket, `16` permissions, `20` P0 RPCs; verify optional `duplicate_invoice` if `T018` was included) per `specs/006-invoices-expenses/quickstart.md`

**Checkpoint**: Database foundation complete (`7` tables, `1` bucket, `16` permissions, `20` P0 RPCs + `1` optional P1 RPC).

---

## Phase 2: Foundational Domain Types, Math Parity & Validations (`plan.md` Phase 1 `T010` & Phase 2 `T011`–`T013`)

**Purpose**: Establish strict TypeScript contracts, 16 RBAC permissions, Zod schemas, error mapper, canonical hashers, and client/server math parity required before ANY user story actions or UI begin.

**⚠️ CRITICAL**: No user story work (`US1`–`US6`) starts until `T032` passes.

- [ ] T020 Append 16 Feature 006 permission keys to `SYSTEM_PERMISSIONS` in `src/lib/auth/permissions.ts`
- [ ] T021 Add Feature 006 role-permission mappings (`owner`, `admin`, `manager`, `cashier`) to `ROLE_PERMISSIONS` in `src/lib/auth/permissions.ts` (sequential after `T020`)
- [ ] T022 [P] Extend `PermissionKey` union with the 16 Feature 006 keys in `src/types/auth.ts`
- [ ] T023 [P] Add Feature 006 table and RPC definitions to `src/types/database.ts`
- [ ] T024 [P] Define strict Invoice, InvoiceItem, InvoicePayment, PaymentReceipt, and CustomerInvoice domain types in `src/types/invoices.ts`
- [ ] T025 [P] Define strict Expense, ExpenseCategory, ExpenseAttachment, and InvoicesExpensesSummary domain types in `src/types/expenses.ts`
- [ ] T026 [P] Create SQLSTATE error mapper `mapInvoiceExpenseError()` covering `P0070`–`P0089` and shared codes in `src/lib/invoices/error-codes.ts`
- [ ] T027 [P] Create canonical JSONB serialization helpers (reusing `formatCanonicalAmount` & `normalizeReferenceNo` from `src/lib/sales/canonical-hash.ts`) in `src/lib/invoices/canonical-hash.ts`
- [ ] T028 [P] Create pure financial preview engine `calculateInvoiceTotals()` (with `line_net > 0` residual guard and zero-subtotal bypass) and `computeIsOverdue()` (reusing `getCurrencyExponent`) in `src/lib/invoices/financial-calc.ts`
- [ ] T029 [P] Create expense badge helpers and safe attachment filename sanitizer in `src/lib/expenses/formatters.ts`
- [ ] T030 [P] Create strict Zod validation schemas for invoices and invoice payments in `src/lib/validations/invoices.ts`
- [ ] T031 [P] Create strict Zod validation schemas for categories, expenses, paid correction, attachments, and summary dates in `src/lib/validations/expenses.ts`
- [ ] T032 Verify strict TypeScript compilation with zero `any` errors via `npm run typecheck`

**Checkpoint**: Foundation ready — all User Stories `US1`–`US6` can now execute cleanly.

---

## Phase 3: User Story 1 — Draft, Edit & Issue Customer Invoice (`Priority: P0` 🎯 MVP; Optional `P1` Duplicate Isolated)

**Goal**: Enable authorized staff to draft, edit, delete drafts, and atomically issue numbered, customer/tax-snapshotted invoices (`P0`), view Customer Invoices on Customer Detail (`FR-012`), and optionally duplicate invoices (`FR-014`, isolated `P1`).

**Independent Test**: Create a draft invoice for an active customer with two items, edit line quantities, issue with an idempotency key → sequential `INV-...`, immutable snapshots (`name`/`email`/`phone`/tax), `P0072` edit rejection, and audit log entry.

### P0 Core Implementation for User Story 1

- [ ] T033 [US1] Implement P0 invoice actions (`getInvoicesAction`, `getInvoiceDetailAction`, `getCustomerInvoicesAction`, `createInvoiceAction`, `updateInvoiceAction`, `deleteDraftInvoiceAction`, `issueInvoiceAction`) in `src/actions/invoice-actions.ts`
- [ ] T034 [P] [US1] Build Invoices workspace list UI (`invoices-list-view.tsx`) and route (`page.tsx`) with search, status filters, pagination, and loading/empty/error states in `src/components/invoices/invoices-list-view.tsx` and `src/app/[slug]/invoices/page.tsx`
- [ ] T035 [P] [US1] Build Draft invoice builder/editor component (reusing `CustomerPicker`, non-mutating active product prefill, line discount/`is_taxable`, invoice discount/`is_tax_exempt`, live parity preview, idempotent draft key) in `src/components/invoices/invoice-form.tsx`
- [ ] T036 [US1] Create `/invoices/new` and `/invoices/[invoiceId]/edit` routes wiring `invoice-form.tsx` in `src/app/[slug]/invoices/new/page.tsx` and `src/app/[slug]/invoices/[invoiceId]/edit/page.tsx` (depends on `T035`)
- [ ] T037 [P] [US1] Build Invoice detail page and core P0 header/line-item/audit view (Edit Draft, Delete Draft, Issue actions) in `src/components/invoices/invoice-detail-view.tsx` and `src/app/[slug]/invoices/[invoiceId]/page.tsx` (depends on `T033`)
- [ ] T038 [P] [US1] Extend Customer Detail page and component with conditional Customer Invoices tab (`customers:read` + `invoices:read`, excluding `draft`/`cancelled` from billed totals) in `src/app/[slug]/customers/[customerId]/page.tsx` and `src/components/customers/customer-detail-view.tsx` (depends on `T033`)

### Optional P1 Implementation for User Story 1 (`FR-014 — Duplicate as Draft`)

- [ ] T039 [US1] `(Optional P1 — FR-014)` Implement `duplicateInvoiceAction` calling `public.duplicate_invoice` (`invoices:create`) in `src/actions/invoice-actions.ts` (depends on `T018` and `T033`; when selected, follow shared-file edit order `T033 → T039 → T041 → T044` — never required for P0)
- [ ] T040 [US1] `(Optional P1 — FR-014)` Add **Duplicate as Draft** action button (`invoices:create`) redirecting to new draft editor in `src/components/invoices/invoice-detail-view.tsx` (depends on `T037` and `T039`; serialize shared-file edits with `T037`/`T043`/`T047`/`T052` when included — never required for P0)

**Checkpoint**: User Story 1 P0 billing lifecycle is functional and independently testable (P1 duplicate isolated in `T039`–`T040`).

---

## Phase 4: User Story 2 — Invoice Payment Collection, Partial Payments & Balance Reconciliation (`Priority: P0` 🎯 MVP)

**Goal**: Collect single, partial, and final invoice payments with non-overpayment locking (`P0075`), idempotency, active reference uniqueness, and immutable `balance_after_payment` snapshots (`F-02`).

**Independent Test**: Issue a \$200 invoice, record \$75 `bank_transfer` (`balance_after_payment = 125.0000`, `status = 'partially_paid'`), verify \$150 attempt fails (`P0075`), and record \$125 `cash` (`balance_after_payment = 0.0000`, `status = 'paid'`).

- [ ] T041 [US2] Implement `recordInvoicePaymentAction` in `src/actions/invoice-actions.ts` per `contracts/server-actions.md` §3 (depends strictly on P0 `T012` and `T033`; shared-file edit order is `T033 → T041 → T044` for P0-only, or `T033 → T039 → T041 → T044` if optional P1 `T039` is selected, without making `T041` depend on `T039`)
- [ ] T042 [US2] Build Record Payment modal (method selector, mandatory non-cash reference validation, idempotent key guard, overpayment feedback) in `src/components/invoices/invoice-payment-modal.tsx`
- [ ] T043 [US2] Wire `invoice-payment-modal.tsx` and payment history table (`IPAY-...`, amount, `balance_after_payment`) into `src/components/invoices/invoice-detail-view.tsx` (depends strictly on P0 `T037`, `T041`, and `T042`; serialize edits if optional `T040` is also selected)

**Checkpoint**: User Story 2 partial/full invoice payment collection works and reconciles exact outstanding balances.

---

## Phase 5: User Story 3 — Invoice Cancellation, Overdue Identification & Payment Reversals (`Priority: P0` 🎯 MVP)

**Goal**: Surface derived `is_overdue` states across lists and detail views, block cancelling invoices with active payments (`P0076`), allow audited internal payment-record reversals (`P0078` + `is_replay`), and cancel unpaid invoices with reason (`D2`).

**Independent Test**: Create an issued invoice with `due_date < org_today` (`is_overdue = true`), record a payment, confirm cancellation fails (`P0076`), reverse payment (`is_replay = true` on retry, `P0078` on new key against reversed row, zero refund disbursement), and cancel invoice cleanly.

- [ ] T044 [US3] Implement `cancelInvoiceAction` and `reverseInvoicePaymentAction` in `src/actions/invoice-actions.ts` (sequential after `T041`)
- [ ] T045 [P] [US3] Build Cancel Invoice confirmation modal (`cancellation_reason`, clear block notice if active payments exist) in `src/components/invoices/cancel-invoice-dialog.tsx`
- [ ] T046 [P] [US3] Build Reverse Payment confirmation modal (`reversal_reason`, explicit internal billing-ledger correction disclosure) in `src/components/invoices/reverse-payment-dialog.tsx`
- [ ] T047 [US3] Add `Overdue` filter tab & badges in `src/components/invoices/invoices-list-view.tsx` and wire cancel/reverse triggers in `src/components/invoices/invoice-detail-view.tsx` (depends on `T043`, `T044`, `T045`, `T046`)

**Checkpoint**: User Story 3 overdue tracking, cancellation rules, and payment reversals work end-to-end.

---

## Phase 6: User Story 4 — Printable Invoices, PDF Generation & Payment Receipts (`Priority: P0` 🎯 MVP)

**Goal**: Generate matching `@media print` invoices, fail-closed server-side multi-page PDF exports (`/pdf` route), and historical payment receipts showing persisted `balance_after_payment` (`F-02`, `F-03`).

**Independent Test**: Issue an invoice with discounts/tax, record two partial payments, print/download PDF verifying exact snapshotted customer/totals with zero cost exposure, and print Payment 1 receipt verifying `balance_after_payment` matches Payment 1 rather than final \$0 balance.

- [ ] T048 [P] [US4] Implement zero-dependency deterministic PDF 1.4 binary builder (`buildInvoicePdfBuffer()` with multi-page item flow, PDF literal escaping, and zero `product_costs`) in `src/lib/invoices/pdf-builder.ts` (depends on `T028`)
- [ ] T049 [P] [US4] Build browser `@media print` invoice component displaying org metadata, `customer_name_snapshot`/`customer_email_snapshot`/`customer_phone_snapshot`, lines, taxes, discounts, and balances in `src/components/invoices/invoice-print-view.tsx`
- [ ] T050 [P] [US4] Build immutable payment receipt print component displaying `IPAY-...`, method, reference, amount paid, and persisted `balance_after_payment` in `src/components/invoices/payment-receipt-print.tsx`
- [ ] T051 [US4] Implement fail-closed authenticated PDF Route Handler `GET` (`resolveTenantContext` + `invoices:read`, `Cache-Control: private, no-store`) in `src/app/[slug]/invoices/[invoiceId]/pdf/route.ts` (depends on `T033`, `T048`)
- [ ] T052 [US4] Wire Print Invoice, Download PDF, and per-payment Print Receipt buttons in `src/components/invoices/invoice-detail-view.tsx` (depends on `T047`, `T049`, `T050`, `T051`)

**Checkpoint**: User Story 4 document generation, PDF downloads, and historical payment receipts are complete.

---

## Phase 7: User Story 5 — Business Expense Recording, Paid Correction, Categorization & Attachments (`Priority: P0` 🎯 MVP)

**Goal**: Manage expense categories (idempotent default seed + CRUD + archival), record unpaid/paid expenses with optional additive tax, mark unpaid expenses paid, lock paid amounts (`P0084`), block direct void on paid (`P0087`), provide audited paid-expense correction (`correct_paid_expense`), and secure private receipt attachments (`active` only).

**Independent Test**: Seed default categories cleanly under concurrency, record an unpaid expense, attach PDF receipt, mark paid (`paid_at`/`paid_by` persisted), verify direct void fails (`P0087`), execute `correct_paid_expense` creating linked replacement (`supersedes_expense_id`), archive category (`P0080`), and confirm cross-tenant attachment fetch fails.

- [ ] T053 [US5] Implement core expense & category actions (`getExpenseCategoriesAction`, `createExpenseCategoryAction`, `updateExpenseCategoryAction`, `archiveExpenseCategoryAction`, `getExpensesAction`, `getExpenseDetailAction`, `createExpenseAction`, `updateExpenseAction`, `markExpensePaidAction`, `voidExpenseAction`, `correctPaidExpenseAction`) in `src/actions/expense-actions.ts`
- [ ] T054 [US5] Implement attachment actions (`uploadExpenseAttachmentAction` with compensating storage cleanup, `deleteExpenseAttachmentAction`, `getExpenseAttachmentDownloadUrlAction` 60s signed URL) in `src/actions/expense-actions.ts` (sequential after `T053`)
- [ ] T055 [P] [US5] Build Expense Categories management modal (`expense_categories:manage` CRUD & archive) in `src/components/expenses/expense-categories-modal.tsx`
- [ ] T056 [P] [US5] Build Expense Attachments panel (active-only upload/remove, MIME/5 MB validation, signed download preview) in `src/components/expenses/expense-attachments-panel.tsx` (depends on `T054`)
- [ ] T057 [P] [US5] Build Create/Edit Expense modal (locked financial amount indicator when `'paid'`, decoupled additive tax input, conditional settlement inputs) in `src/components/expenses/expense-form-modal.tsx`
- [ ] T058 [P] [US5] Build Mark as Paid modal and Void Unpaid Expense modal (`void_reason`, unpaid guard) in `src/components/expenses/mark-paid-dialog.tsx` and `src/components/expenses/void-expense-dialog.tsx`
- [ ] T059 [P] [US5] Build Correct Paid Expense modal (`expenses:void`, replacement inputs, audit link notice to `supersedes_expense_id` / `corrected_by_expense_id`) in `src/components/expenses/correct-paid-expense-modal.tsx`
- [ ] T060 [US5] Build Expenses workspace UI (`expenses-list-view.tsx`) and route (`page.tsx`) wiring search, filters (`Active`/`Voided`/`Corrected`, `Unpaid`/`Paid`, category, date range), `T055`–`T059`, and loading/empty/error states in `src/components/expenses/expenses-list-view.tsx` and `src/app/[slug]/expenses/page.tsx`

**Checkpoint**: User Story 5 expenses, categories, active-only attachments, and paid correction chain work end-to-end.

---

## Phase 8: User Story 6 — Operational Invoice & Expense Summary Dashboard & Navigation (`Priority: P0` 🎯 MVP)

**Goal**: Deliver `financial_summaries:read`-gated period activity (`[from_date, to_date]` in org timezone) vs. current `As of Today` open/overdue receivables KPIs, expense category breakdowns, and permission-gated `TenantNav` navigation links.

**Independent Test**: Load `/invoices` and `/expenses` as Owner/Admin with mixed-period, overdue, cancelled, voided, corrected, and archived-category records verifying exact single-currency KPI totals; confirm Cashier sees neither summary KPIs nor Invoices/Expenses nav links.

- [ ] T061 [P] [US6] Implement `getInvoicesExpensesSummaryAction` (`financial_summaries:read`, date range refinement, RPC `get_invoices_expenses_summary`) in `src/actions/financial-summary-actions.ts`
- [ ] T062 [P] [US6] Evaluate `invoices:read` & `expenses:read` in tenant layout and render permission-gated `Invoices` & `Expenses` nav links in `src/app/[slug]/layout.tsx`, `src/components/layout/TenantHeader.tsx`, and `src/components/layout/tenant-nav.tsx`
- [ ] T063 [US6] Wire Period Activity (`from_date`–`to_date`) vs Current Open/Overdue Receivables (`As of Today`) KPI strips and category breakdown into `src/components/invoices/invoices-list-view.tsx` and `src/components/expenses/expenses-list-view.tsx` (depends on `T034`, `T060`, `T061`)

**Checkpoint**: User Story 6 operational summaries and navigation complete; **all P0 application workflows (`US1`–`US6`) are ready**.

---

## Phase 9: Comprehensive Automated Test Suite & Final Verification (`plan.md` Phases 5–6)

**Purpose**: Validate all unit, DB, concurrency, precision, RLS/security, isolation, regression, and E2E invariants (`AC-01`–`AC-16`, `SC-001`–`SC-005`).

- [ ] T064 [P] Write unit test suites covering `calculateInvoiceTotals` (`F-08` `line_net > 0` residual guard, zero-subtotal, JPY/KWD rounding), `computeIsOverdue`, canonical hashers, `mapInvoiceExpenseError` (`P0070`–`P0089`), Zod invoice/expense schemas, 16-permission RBAC checks (including unknown-key false for Owner), and `buildInvoicePdfBuffer` (`< 2s`, escaping) in `tests/unit/invoices/financial-calc.test.ts`, `tests/unit/invoices/canonical-hash.test.ts`, `tests/unit/invoices/error-codes.test.ts`, `tests/unit/invoices/validations.test.ts`, `tests/unit/invoices/pdf-builder.test.ts`, and `tests/unit/expenses/validations.test.ts`
- [ ] T065 [P] Write P0 Invoice & Payment lifecycle integration tests (draft idempotency `F-07`, snapshot immutability `F-03`, `P0072`/`P0073`/`P0086`, zero-value auto-`'paid'`, partial payments & immutable `balance_after_payment` `F-02`, reversal replay vs `P0078` + ref reuse + `P0076` cancel block, org-timezone overdue, Customer FK `23503`) in `tests/integration/invoices/lifecycle-and-payments.test.ts`
- [ ] T066 [P] Write Concurrency & Idempotency integration tests (100-request `INV-`/`IPAY-`/`EXP-` numbering, simultaneous exact-balance partial payments `P0075`, `Case C -> A -> B -> D` retry/conflict matrix, concurrent first-time `seed_default_expense_categories`) in `tests/integration/invoices/concurrency-and-idempotency.test.ts`
- [ ] T067 [P] Write Expense, Paid-Correction & Summary integration tests (`F-05` canonical settlement, `P0084`, `P0087` on paid void, `correct_paid_expense` audit chain + ref reuse + active non-duplication `F-01`, `P0080` archival, active-only attachments, `get_invoices_expenses_summary` `F-04` period vs `As of Today` + JPY/KWD) in `tests/integration/expenses/lifecycle-and-summaries.test.ts`
- [ ] T068 [P] Write Security, RLS, Storage, PDF & F001–F005 Isolation integration tests (`42501` direct DML on all 7 tables, Cashier denials, cross-tenant RPC/Storage/PDF 0-byte checks, zero rows in `sales`/`payments`/`inventory`/`stock_movements`, zero `product_costs` exposure) in `tests/integration/invoices/security-and-regression.test.ts`
- [ ] T069 [P] Write P0 Playwright E2E workflows covering billing/payments/receipt(`balance_after_payment`)/reversals/cancellation/PDF download, Customer Invoices tab, expenses/attachments/paid correction/categories, summary KPIs, and Cashier denial in `tests/e2e/invoices-expenses/invoice-billing.e2e.ts` and `tests/e2e/invoices-expenses/expense-lifecycle.e2e.ts`
- [ ] T070 [P] `(Optional P1 — FR-014)` Write isolated integration & Playwright E2E tests for `duplicate_invoice` (`P0041` archived customer check, idempotency replay, editable draft flow; depends on `T018` and `T040`, non-blocking for P0 acceptance) in `tests/integration/invoices/duplicate-invoice.test.ts` and `tests/e2e/invoices-expenses/duplicate-invoice.e2e.ts`
- [ ] T071 Execute quickstart P0 database verification SQL (`specs/006-invoices-expenses/quickstart.md`, verifying 20 P0 RPCs + optional P1 `T018` if included) and static checks (`npm run typecheck && npm run lint`)
- [ ] T072 Run full P0 automated test & regression suites (`npm run test && npm run test:e2e`, running `T064`–`T069` without requiring optional P1 `T070`) confirming zero P0 failures, zero skipped critical assertions, and zero regressions across Features 001–005

**Checkpoint**: Feature 006 P0 release verified (`AC-01`–`AC-16`, `SC-001`–`SC-005`).

---

## Dependencies & Execution Order

### Story & Phase Dependency Graph

```text
Phase 1 P0 (T001–T017, T019: DB Migration) ──▶ [Optional P1: T018 duplicate_invoice]
   │
   ▼
Phase 2 P0 (T020–T032: Types, Permissions, Validations, Math Parity)
   ├──▶ Phase 3 P0 (T033–T038: US1 Invoices Core) ──▶ [Optional P1: T039 → T040]
   │       ├──▶ Phase 4 P0 (T041–T043: US2 Invoice Payments)
   │       │       └──▶ Phase 5 P0 (T044–T047: US3 Cancel, Overdue, Reversals)
   │       │               └──▶ Phase 6 P0 (T048–T052: US4 Print, PDF & Receipts)
   │       └──▶ Phase 8 P0 (T061–T063: US6 Summary Dashboard & Nav, also depends on US5 list)
   └──▶ Phase 7 P0 (T053–T060: US5 Expenses, Categories, Attachments & Paid Correction)
           └──▶ Phase 8 P0 (US6 Summary & Nav)
                   └──▶ Phase 9 P0 (T064–T069 → T071–T072) ──▶ [Optional P1 Test: T070]
```

### Parallel Execution Examples

- **Phase 2 (Foundational)**: Once `T020`–`T021` (`src/lib/auth/permissions.ts`) finish, run `T022`–`T031` concurrently across separate TypeScript modules before `T032`.
- **Phase 3 (`US1`)**: After `T033` completes `src/actions/invoice-actions.ts`, run `T034`, `T035`, `T037`, and `T038` in parallel across distinct pages/components.
- **Phase 6 (`US4`)**: Run `T048` (`pdf-builder.ts`), `T049` (`invoice-print-view.tsx`), and `T050` (`payment-receipt-print.tsx`) completely in parallel.
- **Phase 7 (`US5`)**: After `T053`–`T054` (`expense-actions.ts`), run `T055`, `T056`, `T057`, `T058`, and `T059` in parallel before assembling `T060`.
- **Phase 9 (Verification)**: Run `T064`–`T069` (and optional `T070`) across isolated test files in parallel prior to final `T071`–`T072` gates.

## Implementation Strategy

1. **P0 MVP Increment 1 (Database + Billing Core)**: Complete Phases 1–2 (`T001`–`T017`, `T019`–`T032`) then **US1–US4** (`T033`–`T038`, `T041`–`T052`) for full draft/issue/partial-payment/reversal/cancellation/PDF/receipt billing.
2. **P0 MVP Increment 2 (Expenses + Summary + Nav)**: Complete **US5–US6** (`T053`–`T063`) for expenses, categories, active-only attachments, paid corrections, summary KPIs, and nav links.
3. **Optional P1 Increment (`FR-014`)**: Execute `T018`, `T039`, `T040`, and `T070` cleanly alongside or after P0 without delaying P0 acceptance.
4. **Final P0 Closure**: Execute Phase 9 (`T064`–`T069`, `T071`–`T072`) verifying full `F-01`–`F-08`, `D1`–`D5`, security, and F001–F005 regression compliance.
