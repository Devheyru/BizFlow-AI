# Developer Quickstart: Feature 006 — Invoices & Expenses

**Branch**: `006-invoices-expenses` | **Date**: 2026-11-28 | **Spec**: [spec.md](./spec.md)

---

## Prerequisites

- Node.js 18+ and npm
- Supabase CLI linked to local project (`npx supabase start`)
- Git checked out on branch `006-invoices-expenses`
- Completed migrations `01`–`25` already applied

## Setup & Verification Steps

### 1. Dependencies

```bash
npm install
```

No new npm packages are required for Feature 006.

### 2. Apply Database Migration (Once Implemented)

```bash
npx supabase db reset
```

Verifies clean creation of `supabase/migrations/20261128000026_invoices_expenses_schema.sql` alongside existing Features 001–005 migrations.

### 3. Schema & Storage Verification Queries

```sql
-- 1. Expect 7 tables
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
  'financial_sequences', 'invoices', 'invoice_items', 'invoice_payments',
  'expense_categories', 'expenses', 'expense_attachments'
)
ORDER BY table_name;

-- 2. Expect 16 permissions
SELECT id FROM public.permissions
WHERE id LIKE 'invoices:%'
   OR id LIKE 'invoice_payments:%'
   OR id LIKE 'expenses:%'
   OR id LIKE 'expense_categories:%'
   OR id = 'financial_summaries:read'
ORDER BY id;

-- 3. Expect 1 private bucket
SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'expense-attachments';

-- 4. Expect 20 P0 Feature 006 RPCs (+ 1 optional P1 RPC 'duplicate_invoice' = 21 total)
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name IN (
  'create_invoice', 'update_invoice', 'delete_draft_invoice', 'issue_invoice',
  'cancel_invoice', 'duplicate_invoice', 'get_invoice_detail',
  'record_invoice_payment', 'reverse_invoice_payment',
  'seed_default_expense_categories', 'create_expense_category',
  'update_expense_category', 'archive_expense_category',
  'create_expense', 'update_expense', 'mark_expense_paid',
  'void_expense', 'correct_paid_expense',
  'register_expense_attachment', 'delete_expense_attachment',
  'get_invoices_expenses_summary'
)
ORDER BY routine_name;
```

### 4. Verification Commands

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run test:e2e
```

### 5. Application Routes

| Route | Permission Required | Purpose |
|---|---|---|
| `/[slug]/invoices` | `invoices:read` | Invoice list, overdue filter, period & open summary strip |
| `/[slug]/invoices/new` | `invoices:create` | Create draft / Save & Issue invoice |
| `/[slug]/invoices/[invoiceId]` | `invoices:read` | Detail, payment collection/reversal, printable invoice & receipts |
| `/[slug]/invoices/[invoiceId]/edit` | `invoices:update` | Edit unissued `'draft'` invoice |
| `/[slug]/invoices/[invoiceId]/pdf` | `invoices:read` | Authenticated PDF binary download |
| `/[slug]/expenses` | `expenses:read` | Expense list, category management, create/edit/pay/void/correct, summary |
| `/[slug]/customers/[customerId]` | `customers:read` + `invoices:read` | Existing customer detail + Customer Invoices section |
