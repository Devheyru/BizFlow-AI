# Implementation Plan: Feature 006 — Invoices & Expenses

**Branch**: `006-invoices-expenses` | **Date**: 2026-11-28 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from [specs/006-invoices-expenses/spec.md](./spec.md) (D1–D5 Option A approved; completeness remediation `F-01`–`F-08` & priority reconciliation complete)

---

## 1. Summary & Technical Context

Feature 006 delivers **Customer Invoicing (Billing & Receivables)** and **Operational Business Expense Tracking** to BizFlow AI as strictly standalone financial workflows (`D1`–`D5`), insulated from Feature 004 inventory movements and Feature 005 POS sales.

- **Language / Framework**: TypeScript 5.7+ (strict mode, zero `any`), Next.js 15+ App Router (React 19+), Tailwind CSS + shadcn/ui, React Hook Form + Zod 3.24+
- **Database / Storage**: PostgreSQL 15+ (Supabase) — **7 new tables**, **1 private storage bucket (`expense-attachments`)**, **16 new RBAC permissions**, **20 P0 + 1 P1 (`duplicate_invoice`) = 21 `SECURITY DEFINER` RPCs**, error codes **`P0070`–`P0089`** (plus shared Feature 001–005 codes)
- **Dependencies Added**: **None** (`package.json` unchanged; deterministic zero-dependency TypeScript PDF 1.4 generator for server-side PDF output)
- **Testing Stack**: Vitest 3.0+ (unit & integration), Playwright 1.50+ (E2E)
- **Performance & Precision Targets**: RPC p95 `< 150 ms`, PDF generation `< 2 s` for up to 100 line items, `NUMERIC(14, 4)` currency storage rounded via `public.get_currency_exponent(org.currency)`, zero JavaScript float authority for persisted figures
- **Target Priority Scope**: All core workflows in **User Stories 1–6** are **P0**; `Duplicate as Draft` (`FR-014` in US1) is explicitly **P1**; external refunds, approvals, installments, FX, recurring billing, and GL/AP remain **Deferred**

---

## 2. Constitution Check *(Pre- & Post-Design Gate)*

| Principle | Compliance Strategy | Status |
|---|---|:---:|
| **I. Multi-Tenancy & Isolation** | All 7 tables carry `organization_id NOT NULL` + composite `(organization_id, id)` FKs. `ENABLE` + `FORCE ROW LEVEL SECURITY` on every table and `storage.objects` bucket policy. Tenant resolved server-side via `resolveTenantContext(slug)` / `getTenantContext(slug)`; client org IDs and `bizflow_active_org` cookie never trusted. | PASS |
| **II. Financial & Inventory Invariance** | All multi-record writes run inside atomic `SECURITY DEFINER` PostgreSQL RPCs (`OWNER TO postgres`, `SET search_path = pg_catalog, public, pg_temp`). Zero calls to `_execute_inventory_mutation_core`, `inventory`, `stock_movements`, `sales`, or `payments`. Customer & tax parameters, line items, and historical `balance_after_payment` snapshots are immutable. Paid expenses cannot be voided (`P0087`) or altered in amount (`P0084`); financial corrections create an audited linked replacement (`correct_paid_expense`). | PASS |
| **III. Strict Type Safety & Modular Architecture** | Strict TS domain types in `src/types/invoices.ts` and `src/types/expenses.ts`; Zod validation schemas at every Server Action & Route Handler boundary; clean domain separation (`actions/`, `lib/invoices/`, `lib/expenses/`, `components/invoices/`, `components/expenses/`). Zero new npm packages or unnecessary abstractions. | PASS |
| **IV. Defense-in-Depth Security & RBAC** | 16 new colon-notation permissions in `public.permissions` + `SYSTEM_PERMISSIONS`; fail-closed on unknown keys even for Owner. Deny-all DML RLS on all 7 tables; permission-gated `SELECT` RLS only; Route Handler PDF downloads & Storage signed URLs verify `resolveTenantContext` + permission independently. Never reads/exposes `product_costs`. | PASS |
| **V. AI Guardrails** | Feature 006 contains zero autonomous AI financial mutations; all billing, payment, void, and correction operations require explicit authenticated human invocation. | PASS |
| **VI. Operational UX & Ergonomics** | All routes implement Loading, Empty, Error, and Success states, light/dark WCAG 2.1 AA contrast, keyboard navigation, and responsive desktop tables / mobile cards matching existing shadcn patterns. | PASS |
| **VII. Quality Verification** | Dedicated Unit (math, boundaries, rounding, validation, PDF escaping, canonical hash), Database/Integration (RPCs, RLS, cross-tenant, advisory/row locks, concurrent sequences, F-01–F-08 invariants), E2E (Playwright workflows & negative auth), and Feature 001–005 Regression suites. | PASS |

*Complexity Tracking*: Zero constitutional violations or exceptions required.

---

## 3. Repository Impact & Project Structure

### 3.1 Existing Infrastructure Reused vs. Minimal Integration Touchpoints

- **Reused Unmodified**:
  - `src/lib/auth/context.ts` (`resolveTenantContext`, `getTenantContext`)
  - `src/lib/inventory/formatters.ts` (`getCurrencyExponent`, `formatCurrency`)
  - `src/lib/sales/canonical-hash.ts` (`formatCanonicalAmount`, `normalizeReferenceNo`)
  - `src/components/customers/customer-picker.tsx`
  - `public.organizations`, `public.profiles`, `public.organization_audit_events`, `public.customers`, `public.products`, `public.organization_tax_settings`, `public.get_currency_exponent`, `public.handle_updated_at`, `public.is_org_member`, `public.check_user_permission`
- **Minimal Scoped Extensions (Preserving All Feature 001–005 Contracts)**:
  - `src/types/auth.ts` & `src/lib/auth/permissions.ts`: append the 16 Feature 006 permission keys
  - `src/types/database.ts`: update generated/typed table & RPC signatures for the 7 tables and 21 RPCs
  - `src/app/[slug]/layout.tsx`, `src/components/layout/TenantHeader.tsx`, `src/components/layout/tenant-nav.tsx`: pass `canViewInvoices` (`invoices:read`) and `canViewExpenses` (`expenses:read`) to render Invoices and Expenses nav links
  - `src/app/[slug]/customers/[customerId]/page.tsx` & `src/components/customers/customer-detail-view.tsx`: pass `canViewInvoices` and `customerInvoices` for the Customer Invoices tab (`customers:read` + `invoices:read`)

### 3.2 Planned File Layout

```text
specs/006-invoices-expenses/
├── spec.md                         # Approved specification (complete)
├── research.md                     # Technical decisions & repo reuse
├── data-model.md                   # 7 tables, 1 storage bucket, 16 permissions
├── quickstart.md                   # Verification & dev setup guide
├── contracts/
│   ├── database-rpcs.md            # 21 RPC signatures, locks, idempotency, P0070–P0089
│   └── server-actions.md           # Zod schemas, actions, PDF route, signed storage
├── checklists/
│   └── requirements.md             # Complete
└── plan.md                         # This implementation plan

supabase/migrations/
└── 20261128000026_invoices_expenses_schema.sql

src/
├── types/
│   ├── auth.ts                     # +16 PermissionKey entries
│   ├── database.ts                 # Feature 006 schema & RPC types
│   ├── invoices.ts                 # Invoice, Item, Payment, Receipt, CustomerInvoice types
│   └── expenses.ts                 # Expense, Category, Attachment, Summary types
├── lib/
│   ├── auth/permissions.ts         # +16 SYSTEM_PERMISSIONS & ROLE_PERMISSIONS
│   ├── validations/
│   │   ├── invoices.ts             # Zod schemas (create/update/issue/cancel/duplicate/pay/reverse/query)
│   │   └── expenses.ts             # Zod schemas (categories, create/update/pay/void/correct, attachments, summary)
│   ├── invoices/
│   │   ├── error-codes.ts          # P0070–P0089 + shared SQLSTATE mapper
│   │   ├── canonical-hash.ts       # Deterministic payload serialization helpers
│   │   ├── financial-calc.ts       # Line/invoice discount, tax, residual & is_overdue parity
│   │   └── pdf-builder.ts          # Deterministic multi-page PDF 1.4 generator (no new npm deps)
│   └── expenses/
│       └── formatters.ts           # Status badges, safe storage filename sanitization
├── actions/
│   ├── invoice-actions.ts          # 11 invoice & payment server actions
│   ├── expense-actions.ts          # 14 category, expense, correction & attachment actions
│   └── financial-summary-actions.ts# Date-range + as-of-today operational summary action
├── components/
│   ├── invoices/
│   │   ├── invoices-list-view.tsx  # KPI strip (period vs open), search, status/overdue tabs
│   │   ├── invoice-form.tsx        # Draft builder/editor, CustomerPicker, product prefill, live preview
│   │   ├── invoice-detail-view.tsx # Detail, issue/cancel/duplicate(P1) controls, payments, audit links
│   │   ├── invoice-payment-modal.tsx
│   │   ├── reverse-payment-dialog.tsx
│   │   ├── cancel-invoice-dialog.tsx
│   │   ├── invoice-print-view.tsx  # @media print A4/Letter invoice view
│   │   └── payment-receipt-print.tsx # Immutable receipt displaying balance_after_payment
│   ├── expenses/
│   │   ├── expenses-list-view.tsx  # Summary strip, filters (active/voided/corrected), category drawer trigger
│   │   ├── expense-form-modal.tsx  # Create / Edit active expense (locked amount notice when paid)
│   │   ├── mark-paid-dialog.tsx    # Settle unpaid → paid
│   │   ├── void-expense-dialog.tsx # Void unpaid expense only
│   │   ├── correct-paid-expense-modal.tsx # Privileged paid correction creating linked replacement
│   │   ├── expense-attachments-panel.tsx # Active-only upload/delete + signed URL preview/download
│   │   └── expense-categories-modal.tsx  # Category CRUD & archival
│   └── customers/
│       └── customer-detail-view.tsx# Conditional Customer Invoices panel
└── app/[slug]/
    ├── layout.tsx                  # Evaluates invoices:read & expenses:read
    ├── invoices/
    │   ├── page.tsx
    │   ├── new/page.tsx
    │   └── [invoiceId]/
    │       ├── page.tsx
    │       ├── edit/page.tsx
    │       └── pdf/route.ts        # Fail-closed binary PDF endpoint
    ├── expenses/
    │   └── page.tsx
    └── customers/[customerId]/page.tsx # Loads customerInvoices when permitted

tests/
├── unit/invoices/                  # financial-calc, canonical-hash, error-codes, pdf-builder, validations
├── unit/expenses/                  # settlement-validations, summary-date-bounds, permissions
├── integration/invoices/           # lifecycle, payments-and-reversals, concurrency-and-idempotency, rls-and-rbac
├── integration/expenses/           # lifecycle-and-paid-correction, categories-and-attachments, rls-and-summaries
└── e2e/invoices-expenses/          # invoice-billing.e2e.ts, expense-lifecycle.e2e.ts
```

---

## 4. Core Design Architecture

### 4.1 Database & Financial Integrity ([data-model.md](./data-model.md), [database-rpcs.md](./contracts/database-rpcs.md))
- **7 Tenant-Scoped Tables**: `financial_sequences`, `invoices`, `invoice_items`, `invoice_payments`, `expense_categories`, `expenses`, `expense_attachments` — every row anchored by `organization_id`, composite FKs (`customers`, `products`, `invoices`, `expense_categories`, `expenses`), and `ENABLE`/`FORCE ROW LEVEL SECURITY` with deny-all DML.
- **Exact Fixed-Point Math (`D4`, `D5`, `F-08`)**: All amounts use `NUMERIC(14, 4)` and `public.get_currency_exponent(org.currency)`. Proportional invoice discount allocation identifies `k = max(idx where line_net > 0)` to absorb rounding residuals, preventing negative line totals on trailing zero-gross items and skipping division when `net_subtotal <= 0`. Zero-total issued invoices transition directly `draft -> paid`.
- **Immutable Snapshots (`F-02`, `F-03`, `D4`)**: At issuance, `invoices` freezes `customer_name_snapshot`, `customer_email_snapshot`, `customer_phone_snapshot` (explicitly matching `public.customers`; address/tax ID deferred), `tax_name`, `tax_rate`, and `is_tax_inclusive`. Each `invoice_payments` row persists `balance_after_payment` calculated atomically under parent `FOR UPDATE` lock.
- **Audit-Safe Lifecycles (`D2`, `D3`, `F-01`, `F-05`)**:
  - `reverse_invoice_payment` performs internal billing-ledger correction (`status = 'reversed'`), checks idempotency replay before state rejection (`Case C -> A -> B -> D -> P0078`), and creates zero external customer refunds.
  - `void_expense` voids `'unpaid'` active expenses only (`P0087 PAID_EXPENSE_VOID_BLOCKED` on `'paid'`).
  - `correct_paid_expense` preserves the original `'paid'` expense immutably as `'corrected'` (releasing active `reference_no` uniqueness before inserting the linked `'active'` `'paid'` replacement with `supersedes_expense_id`), keeping attachments read-only on non-active expenses.

### 4.2 Concurrency, Idempotency & Security Boundaries
- **Sequences**: `INSERT ... ON CONFLICT (organization_id, sequence_type, date_key) DO UPDATE SET last_number = last_number + 1 RETURNING last_number` guarantees gap-tolerable, collision-free `INV-`, `IPAY-`, and `EXP-` numbering in organization timezone.
- **Advisory Locks + SHA-256 Canonical Hashing**: Applied to all 10 transactional idempotent RPCs (`create_invoice`, `issue_invoice`, `cancel_invoice`, `duplicate_invoice`, `record_invoice_payment`, `reverse_invoice_payment`, `create_expense`, `mark_expense_paid`, `void_expense`, `correct_paid_expense`), strictly enforcing `Case C` cross-record `P0024` before row-level checks and `Case A` replay before state rejection (`P0078`/`P0082`/`P0083`/`P0087`/`P0088`/`P0089`).
- **Row Locks**: Every write RPC locks parent `invoices ... FOR UPDATE` or `expenses ... FOR UPDATE` before balance/status validation.
- **Storage Security (`SEC-009`)**: Bucket `'expense-attachments'` denies unauthenticated/cross-tenant access, validates regex `{org_id}/{expense_id}/{file}`, restricts MIME types and 5 MB max size, and blocks `INSERT`/`DELETE` unless parent `expenses.lifecycle_status = 'active'`. Server downloads generate 60s signed URLs via caller session (zero service-role key).
- **Authorization Matrix (`SEC-005`)**: Every RPC, Server Action, RSC page, PDF route, and Customer Invoices query checks explicit server permissions (`invoices:*`, `invoice_payments:*`, `expenses:*` including canonical `expenses:void`, `expense_categories:*`, `financial_summaries:read`), failing closed (`false` for unknown keys even for Owner).

---

## 5. Phased Implementation Breakdown (`T001`–`T033` P0 Core + Optional `FR-014` P1 Subtasks)

> **P0 Release Independence Rule**: Core tasks `T001`–`T033` deliver 100% of Feature 006 **P0** scope across User Stories 1–6 and can be implemented, tested, and accepted independently. `FR-014` (*Duplicate as Draft*, **P1**) is isolated into explicit optional subtasks (`T005-P1`, `T014-P1`, `T019-P1`, `T027-P1`, `T031-P1`) so P0 completion does not depend on P1 work.

### Phase 1: Database Schema, Security & RPC Foundation (`T001`–`T010`)
**Scope**: Single atomic migration `supabase/migrations/20261128000026_invoices_expenses_schema.sql` establishing all tables, storage bucket, permissions, RLS, financial math, and 20 P0 RPCs (plus optional P1 `duplicate_invoice` in `T005-P1`).  
**Independent Verification**: `npx supabase db reset` succeeds cleanly; schema verification SQL queries in [quickstart.md](./quickstart.md) return `7` tables, `16` permissions, `1` bucket, `20` P0 RPCs (+ `1` optional P1 RPC); existing Feature 001–005 tests stay green.

- **T001** `[Database, Financial]`: Create `public.financial_sequences`, `public.invoices`, `public.invoice_items`, `public.invoice_payments` with all columns, composite FKs (`customers ON DELETE RESTRICT`, `products ON DELETE RESTRICT`), `CHECK` invariants (`due_date >= issue_date`, `paid + outstanding = total`, `balance_after_payment >= 0`, `payment_method`), partial unique indexes (`invoice_number`, active `reference_no` `WHERE status = 'recorded'`, idempotency keys), `handle_updated_at` triggers, and performance indexes.
  - *Files*: `supabase/migrations/20261128000026_invoices_expenses_schema.sql` | *Deps*: None | *Tests*: Schema & constraint integration suite | *Security*: `organization_id NOT NULL`, composite FKs, no `unit_cost` column.
- **T002** `[Database, Financial]`: Create `public.expense_categories`, `public.expenses`, `public.expense_attachments` with lifecycle (`'active' | 'voided' | 'corrected'`), canonical settlement `CHECK` invariant (`F-05`), `void`/`correction` constraints, self-referential composite FKs (`supersedes_expense_id`, `corrected_by_expense_id`), partial unique active category name & active `reference_no` indexes, and idempotency unique indexes.
  - *Files*: same migration | *Deps*: `T001` | *Tests*: Expense & category constraint tests | *Security*: Composite FKs preventing cross-tenant category/parent linking.
- **T003** `[Database, Authorization]`: Seed all 16 Feature 006 permissions (`invoices:*`, `invoice_payments:*`, `expenses:read/create/update/pay/void`, `expense_categories:read/manage`, `financial_summaries:read`) into `public.permissions` & `public.role_permissions` (`admin`, `manager`, `cashier` denied all 16), enable + force RLS on all 7 tables, add deny-all DML policies, add permission-gated `SELECT` policies (`invoices`, `invoice_items`, `invoice_payments`, `expense_categories`, `expenses`, `expense_attachments`), and configure `expense-attachments` private Storage bucket + `SELECT`/`INSERT`/`DELETE` RLS policies (`lifecycle_status = 'active'` enforced on `INSERT`/`DELETE`).
  - *Files*: same migration | *Deps*: `T001`, `T002` | *Tests*: RLS, Cashier denial & Storage RLS integration tests | *Security*: Fail-closed deny-all default; no service-role bypass.
- **T004** `[Database, Financial]`: Implement internal PL/pgSQL helper `_f006_next_sequence(org_id, seq_type, tz)` and `_f006_compute_invoice_totals(org_id, items_jsonb, inv_disc, is_tax_exempt, tax_rate, is_tax_inclusive)` matching exact `get_currency_exponent`, zero-subtotal bypass, `k = max(line_net > 0)` residual absorption (`F-08`), and line-by-line tax reconciliation (`D4`). Restrict helper `EXECUTE` cleanly (`REVOKE FROM PUBLIC, anon, authenticated, service_role`).
  - *Files*: same migration | *Deps*: `T001`, `T003` | *Tests*: Precision unit & DB parity tests (USD, JPY, KWD, zero-gross trailing lines) | *Security*: Internal helper uncallable by clients.
- **T005** `[Database, Backend, Authorization, Financial, P0]`: Implement P0 Invoice lifecycle RPCs: `create_invoice`, `update_invoice`, `delete_draft_invoice`, `issue_invoice`, `cancel_invoice`, and `get_invoice_detail` with `pg_advisory_xact_lock`, `Case C/A/B/D` idempotency precedence, `FOR UPDATE` row locks, `P0070`–`P0076` & `P0086`, zero-total auto-`'paid'` on issuance, derived `is_overdue`, customer & tax snapshots, and `organization_audit_events` logging.
  - *Files*: same migration | *Deps*: `T003`, `T004` | *Tests*: Invoice RPC & concurrency integration tests (`T027`, `T028`) | *Security*: Never touches `sales`, `inventory`, `stock_movements`, or `product_costs`.
  - **Optional P1 Subtask `T005-P1`** `[Database, Backend, Authorization, P1 — FR-014]`: Implement `public.duplicate_invoice(p_org_id, p_source_invoice_id, p_idempotency_key)` enforcing `invoices:create`, advisory-lock idempotency, active customer verification (`P0041`), fresh default dates, and `invoice.duplicated` audit logging. *Deps*: `T005` | *Completion*: Independent of P0 release; P0 invoice creation/issuance succeeds without `T005-P1`.
- **T006** `[Database, Backend, Authorization, Financial]`: Implement Invoice Payment RPCs: `record_invoice_payment` (persisting `balance_after_payment`, updating `paid_amount`/`outstanding_balance`/`status`, `P0074`, `P0075`, `P0057`) and `reverse_invoice_payment` (Case C → A replay → B drift → D `P0078` precedence, internal ledger reversal without refund creation) with `OWNER TO postgres` + grants.
  - *Files*: same migration | *Deps*: `T005` | *Tests*: Concurrent partial payment, reversal idempotency replay & `P0078` tests | *Security*: `created_by`/`reversed_by` strictly `auth.uid()`.
- **T007** `[Database, Backend, Authorization]`: Implement Expense Category RPCs (`seed_default_expense_categories` with advisory lock + `ON CONFLICT DO NOTHING`, `create_expense_category`, `update_expense_category`, `archive_expense_category`) with `P0079`, `P0080`, `23505`, and audit logs.
  - *Files*: same migration | *Deps*: `T002`, `T003` | *Tests*: Concurrent category seeding & archival protection tests.
- **T008** `[Database, Backend, Authorization, Financial]`: Implement Expense & Paid-Correction RPCs (`create_expense`, `update_expense`, `mark_expense_paid`, `void_expense`, `correct_paid_expense`) enforcing canonical settlement (`F-05`), `P0081`–`P0084`, `P0087`–`P0089`, 3-step `UPDATE corrected -> INSERT replacement -> UPDATE link` ordering for reference reuse (`F-01`), and `organization_audit_events`.
  - *Files*: same migration | *Deps*: `T002`, `T003`, `T004`, `T007` | *Tests*: Unpaid void vs paid correction integration tests.
- **T009** `[Database, Backend, Authorization, Financial]`: Implement `register_expense_attachment`, `delete_expense_attachment` (both enforcing `lifecycle_status = 'active'`), and `get_invoices_expenses_summary(p_org_id, p_from_date, p_to_date)` (activity metrics in `[from, to]` vs open/overdue receivables as of org today, excluding `'draft'`, `'cancelled'`, `'voided'`, `'corrected'`) + grant/revoke block across all 21 RPCs.
  - *Files*: same migration | *Deps*: `T005`, `T006`, `T008` | *Tests*: Summary reconciliation & attachment immutability tests.
- **T010** `[Backend, Authorization]`: Update TypeScript auth & DB type registries (`src/types/auth.ts`, `src/lib/auth/permissions.ts`, `src/types/database.ts`, `src/types/invoices.ts`, `src/types/expenses.ts`) with strict no-`any` interfaces and all 16 permissions (`owner`, `admin`, `manager`, `cashier`).
  - *Files*: `src/types/*`, `src/lib/auth/permissions.ts` | *Deps*: `T003` | *Tests*: Permission matrix & unknown-key fail-closed unit tests.

---

### Phase 2: Shared Domain Logic, Validation, PDF Engine & Server Actions (`T011`–`T016`)
**Scope**: Complete server validation, error mapping, decimal parity math, pure-TS PDF 1.4 generator, and Server Actions + PDF Route Handler.  
**Independent Verification**: `npm run typecheck` passes with 0 errors; all Phase 2 unit tests (`financial-calc`, `validations`, `error-codes`, `canonical-hash`, `pdf-builder`) pass 100%.

- **T011** `[Backend, Financial]`: Build `src/lib/invoices/financial-calc.ts` (parity `calculateInvoiceTotals`, `line_net > 0` residual guard, zero-subtotal bypass, `computeIsOverdue`) reusing `getCurrencyExponent`.
  - *Deps*: `T010` | *Tests*: `tests/unit/invoices/financial-calc.test.ts`.
- **T012** `[Backend]`: Build `src/lib/invoices/error-codes.ts` (`P0070`–`P0089` + shared codes) and `src/lib/invoices/canonical-hash.ts` + `src/lib/expenses/formatters.ts` (reusing `formatCanonicalAmount` & `normalizeReferenceNo`).
  - *Deps*: `T010` | *Tests*: `tests/unit/invoices/error-codes.test.ts`, `canonical-hash.test.ts`.
- **T013** `[Backend]`: Implement strict Zod schemas (`src/lib/validations/invoices.ts`, `src/lib/validations/expenses.ts`) enforcing trim bounds, UUID keys, `<= 4` decimals, non-cash reference rules, and attachment MIME/size caps (`5 MB`).
  - *Deps*: `T010` | *Tests*: `tests/unit/invoices/validations.test.ts`, `tests/unit/expenses/validations.test.ts`.
- **T014** `[Backend, Authorization, Financial, P0]`: Implement `src/actions/invoice-actions.ts` covering the 10 P0 invoice & payment actions (`getInvoices`, `getInvoiceDetail`, `getCustomerInvoices`, `createInvoice`, `updateInvoice`, `deleteDraftInvoice`, `issueInvoice`, `cancelInvoice`, `recordInvoicePayment`, `reverseInvoicePayment`) with `resolveTenantContext`, `hasPermission`, Zod checks, RPC calls, error mapping, and `revalidatePath`.
  - *Deps*: `T005`, `T006`, `T011`, `T012`, `T013` | *Tests*: P0 action auth & validation unit tests.
  - **Optional P1 Subtask `T014-P1`** `[Backend, Authorization, P1 — FR-014]`: Implement `duplicateInvoiceAction` (`duplicateInvoiceSchema`) in `src/actions/invoice-actions.ts` checking `invoices:create` and invoking `rpc('duplicate_invoice', ...)`. *Deps*: `T005-P1`, `T013`, `T014` | *Completion*: Independent of P0 action suite.
- **T015** `[Backend, Authorization, Financial]`: Implement `src/actions/expense-actions.ts` (14 typed actions covering category seed/list/CRUD, expense list/detail/create/update/pay/void/correct, active-only attachment upload with compensating Storage cleanup, active-only attachment delete, 60s signed download URL) and `src/actions/financial-summary-actions.ts`.
  - *Deps*: `T007`, `T008`, `T009`, `T012`, `T013` | *Tests*: Attachment & summary action unit tests.
- **T016** `[Backend, Financial]`: Implement `src/lib/invoices/pdf-builder.ts` (multi-page PDF 1.4 binary builder rendering persisted org details, customer snapshot `name/email/phone`, line items, discounts, tax breakdown, paid, balance due, notes, payment instructions, zero cost exposure `SEC-010`, proper PDF escaping) and Route Handler `src/app/[slug]/invoices/[invoiceId]/pdf/route.ts` (`resolveTenantContext` + `invoices:read` fail-closed).
  - *Deps*: `T011`, `T014` | *Tests*: `tests/unit/invoices/pdf-builder.test.ts` (`%PDF-1.4` header, multi-page >100 lines, injection escaping, `< 2s`).

---

### Phase 3: Invoices, Payments, Receipts & PDF UI (`T017`–`T021`) — User Stories 1, 2, 3, 4 (P0; Optional `T019-P1` Duplicate)
**Scope**: Complete all P0 invoice management routes, editor, payment modal, reversal/cancel dialogs, printable invoice, PDF download link, and immutable `balance_after_payment` receipt view (plus isolated optional P1 `Duplicate as Draft` button in `T019-P1`).  
**Independent Verification**: P0 browser flow (create draft → edit → issue → partial payments → print receipt (`balance_after_payment` verified) → PDF download → reverse → cancel) passes independently; `T019-P1` verifies Duplicate as Draft separately.

- **T017** `[Frontend, Authorization]`: Build Invoices Workspace (`src/app/[slug]/invoices/page.tsx` + `src/components/invoices/invoices-list-view.tsx`) with `invoices:read` gate, KPI summary strip (`financial_summaries:read` gated, clearly distinguishing `[from, to]` Period Activity vs Current Open/Overdue `As of Today`), search, status/overdue tabs, customer & date filters, pagination, and Loading/Empty/Error states.
  - *Deps*: `T014`, `T015`.
- **T018** `[Frontend, Financial]`: Build Invoice Builder/Editor (`src/app/[slug]/invoices/new/page.tsx`, `src/app/[slug]/invoices/[invoiceId]/edit/page.tsx`, `src/components/invoices/invoice-form.tsx`) reusing Feature 005 `CustomerPicker` and optional non-mutating active `products` lookup prefill, line editor (qty, price, discount, `is_taxable`), `invoice_discount_amount`, `is_tax_exempt`, live parity preview totals (`calculateInvoiceTotals`), idempotent Save as Draft + Save & Issue actions.
  - *Deps*: `T011`, `T014`.
- **T019** `[Frontend, Authorization, Financial, P0]`: Build P0 Invoice Detail & Lifecycle Actions (`src/app/[slug]/invoices/[invoiceId]/page.tsx`, `src/components/invoices/invoice-detail-view.tsx`, `cancel-invoice-dialog.tsx`) showing status & derived overdue badge, customer snapshot card, line breakdown, audit history, and permission-gated Issue / Edit / Delete Draft / Cancel (blocked message when `paid_amount > 0`).
  - *Deps*: `T014`, `T016`.
  - **Optional P1 Subtask `T019-P1`** `[Frontend, Authorization, P1 — FR-014]`: Add **Duplicate as Draft** button (gated by `invoices:create`) to `invoice-detail-view.tsx`, calling `duplicateInvoiceAction` and navigating to the newly created draft invoice. *Deps*: `T014-P1`, `T019` | *Completion*: Can be implemented or toggled without blocking P0 invoice detail workflows.
- **T020** `[Frontend, Financial]`: Build `invoice-payment-modal.tsx` and `reverse-payment-dialog.tsx` supporting cash/card/bank_transfer/other, mandatory non-cash reference validation, idempotent submit guard, overpayment display, and audited reversal prompt (explicitly noting internal billing-ledger reversal, not customer refund disbursement).
  - *Deps*: `T014`, `T019`.
- **T021** `[Frontend]`: Build `invoice-print-view.tsx` (`@media print` A4/Letter layout matching PDF verbatim) and `payment-receipt-print.tsx` (rendering `IPAY-...`, amount paid, invoice number, and historical `balance_after_payment` unaffected by later payments) + hook PDF download button to `/[slug]/invoices/[invoiceId]/pdf`.
  - *Deps*: `T016`, `T019`, `T020`.

---

### Phase 4: Expenses, Categories, Summary & Integration UI (`T022`–`T025`) — User Stories 5 & 6 (P0)
**Scope**: Complete Expenses workspace, categories, attachments, paid-correction modal, tenant navigation links, and Customer Detail Invoices integration tab.  
**Independent Verification**: Expenses create (unpaid & paid), attach PDF (active only), mark paid, void unpaid, block void on paid + execute `correct_paid_expense`, category archival, dashboard summary reconciliation, Customer Detail Invoices tab, and TenantNav links render cleanly across roles.

- **T022** `[Frontend, Authorization]`: Build Expenses Workspace (`src/app/[slug]/expenses/page.tsx` + `src/components/expenses/expenses-list-view.tsx`) with `expenses:read` gate, active-expense Summary & Category Breakdown strip (`financial_summaries:read`), filters (search, category, `unpaid`/`paid`, `active`/`voided`/`corrected`, `expense_date` range), pagination, and Loading/Empty/Error states.
  - *Deps*: `T015`.
- **T023** `[Frontend, Financial]`: Build Expense Modals & Attachments (`expense-form-modal.tsx`, `mark-paid-dialog.tsx`, `void-expense-dialog.tsx`, `correct-paid-expense-modal.tsx`, `expense-attachments-panel.tsx`, `expense-categories-modal.tsx`) enforcing locked amounts when `'paid'`, active-only upload/delete, `Void` (unpaid only) vs `Correct Paid Expense` linked view (`supersedes_expense_id` / `corrected_by_expense_id`), signed URL downloads, and `expense_categories:manage` CRUD/archival.
  - *Deps*: `T015`, `T022`.
- **T024** `[Frontend, Authorization]`: Wire Tenant Navigation (`src/app/[slug]/layout.tsx`, `src/components/layout/TenantHeader.tsx`, `src/components/layout/tenant-nav.tsx`) to pass `canViewInvoices` (`invoices:read`) & `canViewExpenses` (`expenses:read`) cleanly without altering Feature 001–005 links.
  - *Deps*: `T010`, `T017`, `T022`.
- **T025** `[Frontend, Authorization]`: Extend `src/app/[slug]/customers/[customerId]/page.tsx` and `src/components/customers/customer-detail-view.tsx` with conditional Customer Invoices tab (`customers:read` + `invoices:read`), showing customer invoice history (`issued`, `partially_paid`, `paid`, `cancelled`, badged `draft`) and excluding `draft`/`cancelled` from open/billed totals while preserving Feature 005 purchase history untouched.
  - *Deps*: `T014`.

---

### Phase 5: Comprehensive Automated Testing & Security Verification (`T026`–`T031`)
**Scope**: Execute all Unit, Database/Integration, E2E, Security, Financial Precision, and Feature 001–005 Regression tests.  
**Independent Verification**: Zero failures or skipped assertions across `typecheck`, `lint`, `test:unit`, `test:integration`, and `test:e2e`.

- **T026** `[Testing, Financial]`: Unit test suite (`tests/unit/invoices/*`, `tests/unit/expenses/*`): `calculateInvoiceTotals` (exclusive, inclusive, `is_tax_exempt`, per-line `is_taxable`, line & invoice discounts, `k = max(line_net > 0)` residual guard on trailing zero lines `F-08`, zero-subtotal division guard, JPY 0-dec / KWD 3-dec rounding), `computeIsOverdue` timezone boundaries, Zod validation rules, canonical hashing, error mapper, PDF builder (`< 2s` benchmark + injection escaping), and 16-permission RBAC checks (including unknown-key false for Owner).
  - *Deps*: Phase 2.
- **T027** `[Testing, Database, Financial, P0]`: P0 Database & Financial Integration tests (`tests/integration/invoices/lifecycle-and-payments.test.ts`): Draft creation (`F-07` idempotency), edit, delete, issue snapshot (`F-03`, `tax_settings`), zero-value auto-`'paid'`, immutable rejection `P0072`, empty/inactive catalog rejection `P0073`/`P0086`, multiple partial payments & immutable `balance_after_payment` (`F-02`), reversal `is_replay = true` vs `P0078` + ref reuse + cancel blocked `P0076` → allowed after reversal, overdue timezone query, and Customer FK `23503` protection.
  - *Deps*: Phase 1 (`T001`–`T006`).
  - **Optional P1 Subtask `T027-P1`** `[Testing, Database, P1 — FR-014]`: Separate integration test cases for `duplicate_invoice` (copies lines/discounts/taxability/notes, sets fresh default dates, blocks archived customers `P0041`, and replays idempotently). *Deps*: `T005-P1`, `T027`.
- **T028** `[Testing, Database, Financial]`: Concurrency & Idempotency Integration tests (`tests/integration/invoices/concurrency-and-idempotency.test.ts`): Concurrent 100-request `INV-` / `IPAY-` / `EXP-` sequence numbering, simultaneous partial payments on exact remaining balance (one succeeds, one fails `P0075`), simultaneous `create_invoice` / `issue_invoice` / `reverse_invoice_payment` / `mark_expense_paid` / `correct_paid_expense` under same & drifted idempotency keys (`Case C -> A -> B -> D`), and concurrent first-time `seed_default_expense_categories` (`Audit #7`).
  - *Deps*: Phase 1.
- **T029** `[Testing, Database, Financial]`: Expense & Summary Integration tests (`tests/integration/expenses/lifecycle-and-summaries.test.ts`): Unpaid & immediate-paid creation (`F-05`), optional tax decoupled from sales (`Audit #4`), `mark_expense_paid`, `P0084` locked financial fields, `void_expense` on unpaid (`P0087` on paid), `correct_paid_expense` audit chain & ref reuse & active total non-duplication (`F-01`), category archival (`P0080` + historical preservation), active-only attachments (`Audit #2`), and `get_invoices_expenses_summary` (`F-04` period activity vs As of Today receivables + JPY/KWD parity).
  - *Deps*: Phase 1.
- **T030** `[Testing, Database, Authorization]`: Security, RLS, PDF & Regression Integration suite (`tests/integration/invoices/security-and-regression.test.ts`): Direct PostgREST `INSERT/UPDATE/DELETE` denied (`42501`) on all 7 tables; Cashier denied all privileged RPCs & summary (`42501`); cross-tenant RPC, Storage RLS, & PDF Route Handler returns 404/403 with zero bytes (`AC-14`); invoice operations produce ZERO rows in `sales`, `payments`, `inventory`, `stock_movements` and zero `product_costs` exposure (`AC-12`); full Feature 001–005 integration regression pass (`SC-004`).
  - *Deps*: Phases 1 & 2.
- **T031** `[Testing, Frontend, P0]`: P0 Playwright E2E workflows (`tests/e2e/invoices-expenses/invoice-billing.e2e.ts`, `expense-lifecycle.e2e.ts`): Full P0 UI draft/issue/partial-pay/receipt(`balance_after_payment`)/reverse/cancel/PDF-download, Customer Detail Invoices tab, Expense create/attach/mark-paid/void-blocked/correct-paid/categories, Summary dashboard date-range vs As-Of-Today KPIs, and Cashier permission UI denial.
  - *Deps*: Phases 3 & 4 (core P0 tasks `T017`–`T025`).
  - **Optional P1 Subtask `T031-P1`** `[Testing, Frontend, P1 — FR-014]`: Separate Playwright E2E spec/block verifying **Duplicate as Draft** from Invoice Detail creates an editable draft without requiring P1 for P0 release acceptance. *Deps*: `T019-P1`, `T031`.

---

### Phase 6: Final Quality Gate & Verification (`T032`–`T033`)
**Scope**: Full static checks, full suite run, cleanliness verification, and checklist reconciliation.

- **T032** `[Testing, Frontend, Backend]`: Run full `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`, and `npm run test:e2e`; verify zero `any`, zero unhandled console errors, and zero modifications to Feature 001–005 behavior.
  - *Deps*: Phase 5.
- **T033** `[Documentation]`: Verify `specs/006-invoices-expenses/` artifacts & close out Feature 006 implementation readiness checks without altering approved decisions D1–D5.
  - *Deps*: `T032`.

---

## 6. Traceability Matrices

### 6.1 Requirements to Task Coverage

| Requirement Range | Priority | Planned Tasks |
|---|:---:|---|
| `FR-001`–`FR-013`, `FR-015` (Core Invoices & Overdue) | **P0** | `T001`, `T004`, `T005`, `T011`, `T013`, `T014`, `T017`–`T019`, `T025`, `T027`, `T031` |
| `FR-014` (`Duplicate as Draft`) | **P1** | `T005-P1` → `T014-P1` → `T019-P1` → `T027-P1` / `T031-P1` *(Optional; does not block P0 acceptance)* |
| `FR-016`–`FR-023` (Payments & Reversals) | **P0** | `T001`, `T006`, `T013`, `T014`, `T020`, `T021`, `T027`, `T028`, `T031` |
| `FR-024`–`FR-033` (Expenses, Corrections, Categories, Attachments) | **P0** | `T002`, `T003`, `T007`–`T009`, `T013`, `T015`, `T022`, `T023`, `T029`, `T031` |
| `FR-034`–`FR-039` (Summaries, PDF/Print, Audit) | **P0** | `T005`–`T009`, `T015`–`T017`, `T021`, `T022`, `T029`–`T031` |
| `NFR-001`–`NFR-008` (Performance, Idempotency, UI, Parity, TS) | **P0** | `T001`–`T009`, `T010`–`T016`, `T017`–`T025`, `T026`, `T028`, `T032` |
| `SEC-001`–`SEC-012` (RLS, Composite FKs, Storage, RBAC, No Costs) | **P0** | `T001`–`T003`, `T005`–`T010`, `T014`–`T016`, `T024`, `T025`, `T030`, `T032` |
| `INT-001`–`INT-006` (F001–F005 Clean Integration & Isolation) | **P0** | `T001`, `T003`, `T005`, `T006`, `T010`, `T018`, `T025`, `T030`, `T032` |

### 6.2 Acceptance Criteria (`AC-01`–`AC-16`) Verification Matrix

| AC ID | Primary Test Task | Verification Method |
|---|---|---|
| `AC-01`, `AC-02` | `T027`, `T031` | Integration & E2E: draft/edit/issue snapshot lock + `P0072` immutable check |
| `AC-03`, `AC-10` | `T026`, `T027`, `T029` | Unit + DB Parity: 100% discount auto-`'paid'`, trailing zero-line `k = max(line_net > 0)` residual, JPY/KWD, `[from, to]` vs As-Of-Today |
| `AC-04`, `AC-05`, `AC-06` | `T027`, `T028`, `T031` | Integration & Concurrency: partial payment transitions, immutable `balance_after_payment`, `P0075` overpayment & race serialization |
| `AC-07`, `AC-15` | `T027`, `T028` | Idempotency Matrix: `create_invoice` & `record_invoice_payment` replay (`is_replay = true`) vs `P0024` conflict |
| `AC-08` | `T026`, `T027` | Org-timezone `is_overdue` unit + RPC integration tests |
| `AC-09` | `T027`, `T028`, `T031` | Cancel blocked `P0076`; reversal `Case C/A/B/D` (`P0078`); reference reuse; cancel allowed post-reversal |
| `AC-11`, `AC-16` | `T029`, `T031` | Expense unpaid → paid (`paid_at`/`paid_by`), PDF upload/active-only, category archival `P0080`, `void_expense` blocked `P0087`, `correct_paid_expense` audit chain |
| `AC-12` | `T030` | Integration: zero rows added to `sales`, `payments`, `inventory`, `stock_movements`, zero `product_costs` exposure |
| `AC-13`, `AC-14` | `T026`, `T030`, `T031` | Security: Cashier denial (`42501`), PostgREST direct DML fail, cross-tenant RPC/PDF/Storage fail closed (`404`/`403`, 0 bytes) |

---

## 7. Risks, Mitigations & Readiness Check

| Risk | Severity | Mitigation Planned |
|---|:---:|---|
| Active `(payment_method, reference_no)` unique collision during `correct_paid_expense` if ref reused | High | Explicit 3-step SQL order in `T008`: `UPDATE original SET lifecycle_status = 'corrected'` before `INSERT replacement` before `UPDATE original corrected_by_expense_id`. |
| Floating-point divergence between JS preview/PDF and PostgreSQL | High | Pure TS `financial-calc.ts` mirrors exact PL/pgSQL Pass 1/Pass 2 scaling; PDF & print views render persisted PostgreSQL strings verbatim (`T011`, `T016`). |
| Storage orphan objects if `register_expense_attachment` fails | Medium | Upload requires persisted `'active'` `expense_id` (`expense_attachments_insert` RLS checks parent existence) and `T015` executes compensating `.remove()` on RPC failure. |
| Cross-feature regressions on Customers / POS / Inventory | High | Zero edits to Feature 004/005 migrations or RPCs; composite FK declared on `invoices`; `T030` + `T032` run full F001–F005 regression suite. |

**Post-Design Self-Audit Verification**:
- Checked all counts across `spec.md`, `data-model.md`, `database-rpcs.md`, `server-actions.md`, `quickstart.md`, and `plan.md`: **7** tables, **1** storage bucket, **16** permissions, **20** P0 RPCs + **1** P1 RPC (`21` total), **20** Feature 006 error codes (`P0070`–`P0089`), **6** implementation phases (**33** core P0 tasks `T001`–`T033`, with `FR-014` P1 `duplicate_invoice` isolated into optional subtasks `T005-P1`, `T014-P1`, `T019-P1`, `T027-P1`, `T031-P1`).
- Verified every approved decision (`D1`–`D5`), remediation (`F-01`–`F-08`), and P0/P1/Deferred scope boundary is preserved without modification.

**Verdict**: `PLAN APPROVED — READY FOR /speckit-tasks`
