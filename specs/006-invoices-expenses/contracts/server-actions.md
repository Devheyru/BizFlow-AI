# Server Action, Route Handler & Validation Contracts: Feature 006

**Branch**: `006-invoices-expenses` | **Date**: 2026-11-28 | **Spec**: [spec.md](../spec.md)

Every Server Action and Route Handler MUST follow Feature 001–005 conventions:
1. `"use server"` + `import "server-only"` (never expose service-role keys).
2. Authoritative `resolveTenantContext(slug)` / `getTenantContext(slug)`.
3. Granular server `hasPermission(context, <key>)` check before touching database/storage.
4. Strict Zod runtime validation (`.trim()`, bounds, finite decimals, UUID format, `due_date >= issue_date`).
5. Never trust client-supplied `organization_id` or `created_by`.
6. Map PostgreSQL SQLSTATE codes (`P0070`–`P0089` + shared codes) cleanly via `mapInvoiceExpenseError`.

---

## 1. Error Mapping Contract (`src/lib/invoices/error-codes.ts`)

Extends Feature 005 error patterns (`src/lib/sales/error-codes.ts`) without modifying Feature 005 error mappings:
- **Reused Codes**: `08001` (401), `42501` (403), `P0001` (403), `P0002` (403), `P0003` (404), `P0007` (422), `P0012` (422), `P0016` (422), `P0024` (409 `IDEMPOTENCY_CONFLICT`), `P0040` (404 `CUSTOMER_NOT_FOUND`), `P0041` (422 `CUSTOMER_ARCHIVED`), `P0047` (422), `P0055` (422), `P0057` (422), `23503`, `23505`, `23514`.
- **Feature 006 Codes (`P0070`–`P0089`)**:
  - `P0070` `INVOICE_NOT_FOUND` (404)
  - `P0071` `INVALID_DATE_RANGE` (422)
  - `P0072` `INVOICE_IMMUTABLE_AFTER_ISSUANCE` (422)
  - `P0073` `INVOICE_EMPTY_ITEMS` (422)
  - `P0074` `INVOICE_NOT_PAYABLE` (422)
  - `P0075` `INVOICE_PAYMENT_EXCEEDS_BALANCE` (422)
  - `P0076` `INVOICE_HAS_ACTIVE_PAYMENTS` (422)
  - `P0077` `INVOICE_PAYMENT_NOT_FOUND` (404)
  - `P0078` `INVOICE_PAYMENT_ALREADY_REVERSED` (422)
  - `P0079` `EXPENSE_CATEGORY_NOT_FOUND` (404)
  - `P0080` `EXPENSE_CATEGORY_ARCHIVED` (422)
  - `P0081` `EXPENSE_NOT_FOUND` (404)
  - `P0082` `EXPENSE_ALREADY_PAID` (422)
  - `P0083` `EXPENSE_VOIDED` (422)
  - `P0084` `PAID_EXPENSE_AMOUNT_LOCKED` (422)
  - `P0085` `INVALID_ATTACHMENT` (422)
  - `P0086` `PRODUCT_UNAVAILABLE_FOR_INVOICE` (422)
  - `P0087` `PAID_EXPENSE_VOID_BLOCKED` (422)
  - `P0088` `EXPENSE_NOT_ACTIVE` (422)
  - `P0089` `EXPENSE_NOT_PAID` (422)

---

## 2. Zod Validation & Math Utilities

### `src/lib/validations/invoices.ts`
- `createInvoiceSchema`: `{ customerId: uuid, issueDate: isoDate, dueDate: isoDate (refine >= issueDate), items: min 1 max 200, invoiceDiscountAmount >= 0 (max 4 decimals), isTaxExempt: boolean, notes?: string(<=1000), paymentInstructions?: string(<=1000), idempotencyKey: uuid }`.
- `updateInvoiceSchema`: same without `idempotencyKey`, plus `invoiceId: uuid`.
- `issueInvoiceSchema`: `{ invoiceId: uuid, idempotencyKey: uuid }`.
- `cancelInvoiceSchema`: `{ invoiceId: uuid, reason: trim 3..255, idempotencyKey: uuid }`.
- `duplicateInvoiceSchema`: `{ sourceInvoiceId: uuid, idempotencyKey: uuid }`.
- `recordInvoicePaymentSchema`: `{ invoiceId: uuid, paymentMethod: 'cash'|'card'|'bank_transfer'|'other', amount > 0 (max 4 decimals), paymentDate: isoDate, referenceNo?: trim<=120, notes?: trim<=500, idempotencyKey: uuid }` + superRefine requiring non-empty `referenceNo` when `paymentMethod !== 'cash'`.
- `reverseInvoicePaymentSchema`: `{ paymentId: uuid, reason: trim 3..255, idempotencyKey: uuid }`.
- `invoiceListQuerySchema`: `{ search?, status?, overdueOnly?, customerId?, issueFrom?, issueTo?, dueFrom?, dueTo?, sort?, page >= 1, pageSize 1..100 }`.

### `src/lib/validations/expenses.ts`
- `expenseCategorySchema`: `{ name: trim 1..100, description?: trim<=500 }`.
- `createExpenseSchema`: `{ title: trim 1..255, categoryId: uuid, netAmount > 0 (max 4 decimals), taxAmount >= 0 (default 0, max 4 decimals), expenseDate: isoDate, payeeName?: trim<=255, description?: trim<=1000, paymentStatus: 'unpaid'|'paid', paymentDate?: isoDate, paymentMethod?, referenceNo?, idempotencyKey: uuid }` + superRefine enforcing `payment_date`, `payment_method`, and non-cash `reference_no` when `'paid'` and disallowing them when `'unpaid'`.
- `updateExpenseSchema`: `{ expenseId: uuid, title, categoryId, netAmount, taxAmount, expenseDate, payeeName?, description? }`.
- `markExpensePaidSchema`: `{ expenseId: uuid, paymentDate, paymentMethod, referenceNo?, idempotencyKey: uuid }`.
- `voidExpenseSchema`: `{ expenseId: uuid, reason: trim 3..255, idempotencyKey: uuid }`.
- `correctPaidExpenseSchema`: combines `expenseId: uuid`, `reason: trim 3..255`, updated expense + settlement fields, `idempotencyKey: uuid`.
- `attachmentValidation`: `ALLOWED_ATTACHMENT_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])`, `MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024`.
- `summaryDateRangeSchema`: `{ fromDate: isoDate, toDate: isoDate (refine >= fromDate) }`.

### `src/lib/invoices/financial-calc.ts`
- Pure TypeScript mirror of SQL Section 1 pipeline (`calculateInvoiceTotals`), reusing `getCurrencyExponent` from `src/lib/inventory/formatters.ts`.
- Enforces `k = max(idx where line_net > 0)` residual absorption (`F-08`).
- Helper `computeIsOverdue(status, dueDate, orgTimezone, now?)`: derives overdue state using `Intl.DateTimeFormat('en-CA', { timeZone: orgTimezone })` (`YYYY-MM-DD`).

---

## 3. Server Actions

### `src/actions/invoice-actions.ts`
| Action | Required Permission | Backend Call / Query |
|---|---|---|
| `getInvoicesAction(slug, query)` | `invoices:read` | Filtered paginated query on `public.invoices` + `organizations.timezone` for derived `is_overdue` |
| `getInvoiceDetailAction(slug, invoiceId)` | `invoices:read` | `rpc('get_invoice_detail', { p_org_id, p_invoice_id })` |
| `getCustomerInvoicesAction(slug, customerId)` | `customers:read` AND `invoices:read` | Customer-scoped invoice query returning `issued`, `partially_paid`, `paid`, `cancelled` + badged `draft` records & open balance summary (excluding `draft`/`cancelled`) |
| `createInvoiceAction(slug, input)` | `invoices:create` | `rpc('create_invoice', ...)` + `revalidatePath` |
| `updateInvoiceAction(slug, input)` | `invoices:update` | `rpc('update_invoice', ...)` + `revalidatePath` |
| `deleteDraftInvoiceAction(slug, invoiceId)` | `invoices:update` | `rpc('delete_draft_invoice', ...)` + `revalidatePath` |
| `issueInvoiceAction(slug, input)` | `invoices:issue` | `rpc('issue_invoice', ...)` + `revalidatePath` |
| `cancelInvoiceAction(slug, input)` | `invoices:cancel` | `rpc('cancel_invoice', ...)` + `revalidatePath` |
| `duplicateInvoiceAction(slug, input)` *(P1)* | `invoices:create` | `rpc('duplicate_invoice', ...)` + `revalidatePath` |
| `recordInvoicePaymentAction(slug, input)` | `invoice_payments:create` | `rpc('record_invoice_payment', ...)` + `revalidatePath` |
| `reverseInvoicePaymentAction(slug, input)` | `invoice_payments:reverse` | `rpc('reverse_invoice_payment', ...)` + `revalidatePath` |

### `src/actions/expense-actions.ts`
| Action | Required Permission | Backend Call / Query |
|---|---|---|
| `getExpenseCategoriesAction(slug, includeArchived?)` | `expense_categories:read` | Calls `seed_default_expense_categories` if count = 0, returns ordered categories |
| `createExpenseCategoryAction(slug, input)` | `expense_categories:manage` | `rpc('create_expense_category', ...)` + `revalidatePath` |
| `updateExpenseCategoryAction(slug, input)` | `expense_categories:manage` | `rpc('update_expense_category', ...)` + `revalidatePath` |
| `archiveExpenseCategoryAction(slug, categoryId)` | `expense_categories:manage` | `rpc('archive_expense_category', ...)` + `revalidatePath` |
| `getExpensesAction(slug, query)` | `expenses:read` | Paginated query on `public.expenses` joined with category name |
| `getExpenseDetailAction(slug, expenseId)` | `expenses:read` | Expense row + attachments + `supersedes`/`corrected_by` linked metadata |
| `createExpenseAction(slug, input)` | `expenses:create` | `rpc('create_expense', ...)` + `revalidatePath` |
| `updateExpenseAction(slug, input)` | `expenses:update` | `rpc('update_expense', ...)` + `revalidatePath` |
| `markExpensePaidAction(slug, input)` | `expenses:pay` | `rpc('mark_expense_paid', ...)` + `revalidatePath` |
| `voidExpenseAction(slug, input)` | `expenses:void` | `rpc('void_expense', ...)` + `revalidatePath` |
| `correctPaidExpenseAction(slug, input)` | `expenses:void` | `rpc('correct_paid_expense', ...)` + `revalidatePath` |
| `uploadExpenseAttachmentAction(slug, expenseId, formData)` | `expenses:create` or `expenses:update` | Validates file MIME & size `<= 5 MB`, uploads to `${orgId}/${expenseId}/${uuid}-${safeName}` via authenticated Storage client (RLS checks active expense), calls `rpc('register_expense_attachment', ...)` (compensating storage delete if RPC fails) |
| `deleteExpenseAttachmentAction(slug, attachmentId)` | `expenses:update` | Calls `rpc('delete_expense_attachment', ...)` (fails if parent not `'active'`), then removes object from Storage |
| `getExpenseAttachmentDownloadUrlAction(slug, attachmentId)` | `expenses:read` | Reads `expense_attachments` scoped to active org, creates `60s` signed URL via authenticated client |

### `src/actions/financial-summary-actions.ts`
| Action | Required Permission | Backend Call |
|---|---|---|
| `getInvoicesExpensesSummaryAction(slug, fromDate, toDate)` | `financial_summaries:read` | `rpc('get_invoices_expenses_summary', { p_org_id, p_from_date, p_to_date })` |

---

## 4. Authenticated PDF Route Handler (`src/app/[slug]/invoices/[invoiceId]/pdf/route.ts`)

- **Method**: `GET /[slug]/invoices/[invoiceId]/pdf`
- **Authorization**: Calls `resolveTenantContext(slug)` → checks `hasPermission(context, 'invoices:read')`; returns HTTP `401`/`403`/`404` with empty JSON/no bytes on failure.
- **Data Fetch**: Calls `rpc('get_invoice_detail', { p_org_id: context.organization.id, p_invoice_id: invoiceId })`; returns HTTP `404` on `P0070`. Blocks draft PDF export unless `?preview=draft` or returns persisted snapshot cleanly with `DRAFT` watermark if status is `'draft'`.
- **Output**: Invokes `buildInvoicePdfBuffer(detail)` (`src/lib/invoices/pdf-builder.ts`) and responds with:
  - `Content-Type: application/pdf`
  - `Content-Disposition: attachment; filename="INV-....pdf"`
  - `Cache-Control: private, no-store`
