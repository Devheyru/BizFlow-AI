# Architecture & Technical Research: Feature 006 — Invoices & Expenses

**Branch**: `006-invoices-expenses` | **Date**: 2026-11-28 | **Spec**: [spec.md](./spec.md)

This document resolves technical design decisions grounded in the actual BizFlow AI codebase before schema finalization and implementation planning.

---

## 1. Existing Infrastructure Reused (Zero Duplication)

| Existing Asset | Confirmed Repository Source | Reuse Strategy in Feature 006 |
|---|---|---|
| Tenant & Auth Guards | `src/lib/auth/context.ts` (`resolveTenantContext`, `getTenantContext`) | Every Server Action, Route Handler, and RSC resolves tenant membership and active org status server-side via `resolveTenantContext(slug)` / `getTenantContext(slug)`. |
| RBAC Permission Engine | `src/lib/auth/permissions.ts` (`SYSTEM_PERMISSIONS`, `ROLE_PERMISSIONS`, `hasPermission`) & `public.permissions` / `public.role_permissions` | Register 16 new colon-notation permissions (`^[a-z_]+:[a-z_]+$`); fail-closed semantics preserved for all unknown keys including Owner. |
| Currency Exponent Helper | `supabase/migrations/20261106000010_products_categories_schema.sql` (`public.get_currency_exponent`) & `src/lib/inventory/formatters.ts` (`getCurrencyExponent`) | Directly call `public.get_currency_exponent(org.currency)` in PL/pgSQL and `getCurrencyExponent` in preview/PDF TypeScript calculations. Zero duplicate currency lookup tables. |
| Canonical Hash & Normalization | `src/lib/sales/canonical-hash.ts` (`formatCanonicalAmount`, `normalizeReferenceNo`) | Reuse `formatCanonicalAmount` (`FM9999999990.0000`, `-0.0000 -> "0.0000"`) and `normalizeReferenceNo` (trim / empty-or-whitespace -> `null`) in Feature 006 client/action hash helpers. |
| Timestamp Trigger Helper | `public.handle_updated_at()` | Attached cleanly as `BEFORE UPDATE` triggers on `financial_sequences`, `invoices`, `expense_categories`, and `expenses`. |
| Customers & Tax Settings | `public.customers` (`organization_id, id` composite key), `public.organization_tax_settings`, `src/components/customers/customer-picker.tsx` | Reuse `public.customers` via `ON DELETE RESTRICT` composite FK on `public.invoices` without modifying any Feature 005 migration or table; reuse `CustomerPicker` UI and `organization_tax_settings` baseline at invoice issuance. |
| Audit Event Log | `public.organization_audit_events` (`id, organization_id, actor_id, event_type, metadata, created_at`) | All lifecycle RPCs append immutable audit events directly to `public.organization_audit_events`. |
| UI Primitives | `src/components/ui/*` (Button, Card, Dialog, Input, etc.) & Tailwind CSS tokens | Maintain consistent light/dark contrast, WCAG 2.1 AA semantics, and responsive table/card patterns. |

---

## 2. Technical Decisions & Alternatives Evaluated

### Decision T1 — Server-Side Invoice PDF Generation (`FR-036`, `NFR-003`)

- **Decision**: Implement a zero-dependency pure-TypeScript deterministic **PDF 1.4 generator** (`src/lib/invoices/pdf-builder.ts`) served by an authenticated Next.js Route Handler at `src/app/[slug]/invoices/[invoiceId]/pdf/route.ts`, alongside `@media print` browser-printable React views (`invoice-print-view.tsx` and `payment-receipt-print.tsx`).
- **Rationale**:
  1. **Repo Discipline & Dependency Control**: `package.json` contains no PDF library (`pdfkit`, `jspdf`, `@react-pdf/renderer`, or `puppeteer`). Adding headless Chromium/Puppeteer introduces massive bundle bloat and Vercel Serverless cold-start/binary compatibility failures.
  2. **Deterministic Exact Totals & Performance**: Rendering stored PostgreSQL strings (`invoice_number`, `customer_name_snapshot`, `subtotal`, `tax_amount`, `total_amount`, `paid_amount`, `outstanding_balance`) formatted with `getCurrencyExponent` guarantees 0% floating-point drift, clean multi-page pagination for 100+ items in `< 50 ms` (well inside the `< 2 s` `NFR-003` SLA), and proper PDF text literal escaping (`\`, `(`, `)`, sanitized control chars).
  3. **Security Boundary (`SEC-005`, `SEC-010`)**: The Route Handler independently executes `resolveTenantContext(slug)` and checks `hasPermission(context, "invoices:read")`, reads exclusively from `get_invoice_detail` RPC (which omits any cost fields), returns HTTP `404`/`403` with zero body bytes on unauthorized/cross-tenant requests, and sets `Cache-Control: private, no-store`.
- **Alternatives Considered**:
  - *Headless Browser (`puppeteer` / `playwright` in prod)*: Rejected due to Serverless size limits (`> 50 MB`) and operational fragility.
  - *External SaaS PDF API*: Rejected due to PII egress, network latency, and third-party dependency constraints.

### Decision T2 — Authoritative Tax & Residual Allocation Parity (`D4`, `F-08`)

- **Decision**: Mirror Feature 005's exact SQL Pass 1 → Pass 2 rounding pipeline in PL/pgSQL (`public._compute_invoice_totals` helper or inline inside `create_invoice` / `update_invoice` / `issue_invoice`) and TypeScript (`src/lib/invoices/financial-calc.ts`), extended for Feature 006's `is_tax_exempt` and per-line `is_taxable` rules and the `line_net_k > 0.0000` last-line residual guard.
- **Rationale**:
  1. Sorting lines deterministically by `(sort_order ASC, id ASC)` during allocation guarantees identical PostgreSQL and client preview calculations even when draft lines share no `product_id`.
  2. Targeting residual invoice-discount allocation to `k = max(idx where line_net > 0.0000)` prevents trailing zero-gross/complimentary lines from absorbing a negative discount and causing constraint violations (`CHECK (total_price >= 0)`).
  3. When `subtotal = 0.0000` or `net_subtotal = 0.0000`, proportional division is skipped cleanly (`allocated_invoice_disc = 0.0000`), and issuance with `total_amount = 0.0000` atomically sets `status = 'paid'`, `outstanding_balance = 0.0000`, and `paid_at = issued_at = now()`.
- **Alternatives Considered**:
  - *Computing totals in TypeScript and writing raw values to SQL*: Rejected per Constitution Principle II (server PostgreSQL calculations are authoritative).

### Decision T3 — Expense Lifecycle Separation & Linked Paid-Correction Chain (`D3`, `F-01`, `F-05`)

- **Decision**: Implement `correct_paid_expense` using explicit ordered non-deferred writes under row lock (`SELECT ... FROM public.expenses WHERE organization_id = p_org_id AND id = p_expense_id FOR UPDATE`):
  1. Lock original active paid expense (`status = 'active'`, `payment_status = 'paid'`).
  2. Allocate sequential `expense_number` (`EXP-{YYYYMMDD}-{XXXX}`) for replacement record.
  3. Insert replacement record with `lifecycle_status = 'active'`, `payment_status = 'paid'`, `supersedes_expense_id = original.id`, updated financial/metadata fields, canonical settlement fields (`payment_date`, `payment_method`, `reference_no`, `paid_at = now()`, `paid_by = auth.uid()`).
  4. Update original row setting `lifecycle_status = 'corrected'`, `corrected_by_expense_id = replacement.id`, `correction_reason = trim(p_reason)`, `correct_idempotency_key = p_idempotency_key`, `correct_idempotency_hash = v_hash`, while keeping its original `net_amount`, `tax_amount`, `total_amount`, `payment_*`, and `expense_attachments` intact and immutable.
  5. Note on `reference_no` uniqueness under correction: Updating original `lifecycle_status` to `'corrected'` before or within the same transaction allows partial unique index `uq_expenses_org_method_ref_active ON public.expenses(organization_id, payment_method, reference_no) WHERE reference_no IS NOT NULL AND lifecycle_status = 'active'`! **Crucial SQL ordering subtlety**: If the replacement reuses the *same* `(payment_method, reference_no)` as the original row, Step (3) (`UPDATE original SET lifecycle_status = 'corrected'`) **MUST execute BEFORE** Step (4) (`INSERT replacement`) unless the index is deferrable! Executing `UPDATE original SET lifecycle_status = 'corrected'` first releases `(payment_method, reference_no)` cleanly on the non-deferrable partial unique index, and if `fk_expenses_corrected_by` is omitted until after insert or set in a second `UPDATE` after inserting the replacement (`UPDATE original SET corrected_by_expense_id = v_new_id`), there is zero circular FK or partial-unique collision! Let's encode this exact 3-step SQL order in `contracts/database-rpcs.md`:
     - `UPDATE original SET lifecycle_status = 'corrected', correction_reason = ..., correct_idempotency_key = ..., correct_idempotency_hash = ..., updated_by = auth.uid(), updated_at = now()` (exits `'active'` index immediately!)
     - `INSERT INTO public.expenses (...) VALUES (v_new_id, ..., 'active', 'paid', ..., original.id)`
     - `UPDATE original SET corrected_by_expense_id = v_new_id`
- **Rationale**: Avoids `DEFERRABLE` constraints on partial unique indexes (which PostgreSQL does not support on `CREATE UNIQUE INDEX ... WHERE ...`) and preserves strict atomic rollback on any failure.
- **Alternatives Considered**:
  - *Deferrable unique exclusion constraint*: Unnecessary complexity compared to `UPDATE status -> INSERT replacement -> UPDATE link` inside a single `FOR UPDATE` PL/pgSQL transaction.

### Decision T4 — Expense Receipt Attachment Upload/Delete Flow (`SEC-009`, `FR-032`)

- **Decision**:
  1. Dedicated private bucket `'expense-attachments'` (`public = false`, `file_size_limit = 5242880`, `allowed_mime_types = {'application/pdf', 'image/jpeg', 'image/png', 'image/webp'}`), mirroring `20261106000010_products_categories_schema.sql`'s `'product-images'` bucket pattern.
  2. Upload happens **only against an existing active expense** (either from Expense Detail/Edit, or seamlessly right after `create_expense` returns `expense_id` in the UI save flow): the authenticated Server Action or authorized client uploads the sanitized path `{org_id}/{expense_id}/{uuid}-{safeFilename}` via Supabase Storage (`expense_attachments_insert` RLS verifies `is_org_member`, `expenses:create OR expenses:update`, MIME/size metadata, and `EXISTS (... lifecycle_status = 'active')`), then calls `public.register_expense_attachment` RPC to persist `public.expense_attachments` + write the `expense_attachment.added` audit event.
  3. Downloads generate short-lived (`60 s`) signed URLs on the server inside `getExpenseAttachmentSignedUrlAction(slug, attachmentId)` after resolving `resolveTenantContext(slug)`, checking `expenses:read`, and fetching the tenant-scoped `expense_attachments` row (`storage.objects` `SELECT` RLS also verifies tenant + `expenses:read`).
  4. Deletion is blocked on `'voided'` (`P0083`) and `'corrected'` (`P0088`) expenses; on `'active'` expenses (`expenses:update`), `delete_expense_attachment` RPC removes the DB metadata row and writes `expense_attachment.removed`, followed by `supabase.storage.from('expense-attachments').remove([storagePath])` using the authenticated caller's session under `expense_attachments_delete` RLS (`lifecycle_status = 'active'`). Zero service-role usage!

### Decision T5 — Schema Integration with Feature 005 (`INT-005`, `FR-012`)

- **Decision**: Add `public.invoices` with composite FK `(organization_id, customer_id) REFERENCES public.customers(organization_id, id) ON DELETE RESTRICT`, keeping Feature 005 migrations (`21`–`25`) completely untouched. Customer Detail (`src/app/[slug]/customers/[customerId]/page.tsx` and `src/components/customers/customer-detail-view.tsx`) adds a conditional `invoices:read` panel/tab alongside `purchaseHistory`, showing historical invoices and derived `is_overdue` badges while excluding `draft` and `cancelled` invoices from billed/receivable customer totals.
- **Rationale**: Zero risk of Feature 005 regressions; `archive_customer` continues to operate cleanly, and hard-deletion of customers with historical invoices fails closed at the FK boundary (`23503`).

### Decision T6 — Idempotent & Race-Safe Default Category Seeding (`FR-025`, Edge Case #7)

- **Decision**: Extract `public.seed_default_expense_categories(p_org_id UUID)` as an idempotent SECURITY DEFINER RPC callable by holders of `expense_categories:read` or `expense_categories:manage` (and automatically invoked if an organization has zero active categories on first `/expenses` load). Uses `pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext('seed_default_expense_categories'))` plus `INSERT ... ON CONFLICT DO NOTHING` on `uq_expense_categories_org_name_active` (`lower(trim(name)) WHERE status = 'active'`).
- **Rationale**: Concurrent first-page loads by two managers in a newly created organization never collide with `23505`.
