# Developer Quickstart: Feature 005 — Customers & Sales

**Branch**: `005-customers-sales` | **Date**: 2026-11-17 | **Spec**: [spec.md](./spec.md)

---

## Prerequisites

- Node.js 18+ and npm
- Supabase CLI installed and linked to local project
- PostgreSQL 15+ (via Supabase local dev)
- Git on branch `005-customers-sales`

## Setup Steps

### 1. Install Dependencies

```bash
npm install
```

No new npm dependencies are required for Feature 005. All existing dependencies suffice:
- `@supabase/ssr`, `@supabase/supabase-js` — Database client
- `zod` — Validation schemas
- `react-hook-form`, `@hookform/resolvers` — Form handling
- `lucide-react` — Icons
- `server-only` — Server action guard

### 2. Apply Database Migration

```bash
npx supabase db reset
```

This resets the local database and applies all migrations in order, including the new:
- `20261117000021_customers_sales_schema.sql`

Verify migration success:

```bash
npx supabase db diff --linked
```

### 3. Verify Schema

After migration, confirm the 9 new tables exist:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
  'customers', 'organization_tax_settings', 'sales', 'sale_items',
  'payments', 'sale_returns', 'sale_return_items', 'refunds', 'sale_sequences'
)
ORDER BY table_name;
```

Expected: 9 rows.

### 4. Verify Permissions

```sql
SELECT key FROM public.permissions
WHERE key LIKE 'customers:%' OR key LIKE 'sales:%'
   OR key LIKE 'returns:%' OR key LIKE 'payments:%'
   OR key LIKE 'refunds:%' OR key LIKE 'tax_settings:%'
ORDER BY key;
```

Expected: 12 permissions.

### 5. Verify RPCs

```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name IN (
  'execute_sale', 'void_sale', 'execute_sale_return',
  'confirm_refund_reimbursement', 'record_refund_failure',
  'issue_replacement_refund', 'create_customer', 'update_customer',
  'archive_customer', 'update_tax_settings', 'get_sale_detail'
)
ORDER BY routine_name;
```

Expected: 11 RPCs.

### 6. Run Existing Tests

```bash
npm run test
```

All 905+ existing tests must continue to pass. Feature 005 migration must not break F001–F004.

### 7. Start Development Server

```bash
npm run dev
```

Navigate to `http://localhost:3000/<org-slug>/` to begin UI development.

---

## Key Development References

| Artifact | Path |
|---|---|
| Feature Specification | `specs/005-customers-sales/spec.md` |
| Implementation Plan | `specs/005-customers-sales/plan.md` |
| Data Model | `specs/005-customers-sales/data-model.md` |
| Database RPC Contracts | `specs/005-customers-sales/contracts/database-rpcs.md` |
| Server Action Contracts | `specs/005-customers-sales/contracts/server-actions.md` |
| Constitution | `.specify/memory/constitution.md` |
| Feature 004 Plan (reference) | `specs/004-inventory-stock-management/plan.md` |
| Inventory Actions (pattern) | `src/actions/inventory-actions.ts` |
| Inventory Types (pattern) | `src/types/inventory.ts` |
| Inventory Validations (pattern) | `src/lib/validations/inventory.ts` |

---

## Testing Strategy

### Unit Tests (Vitest)

```bash
npm run test -- --reporter=verbose
```

Target files:
- `tests/unit/validations/customers.test.ts`
- `tests/unit/validations/sales.test.ts`
- `tests/unit/sales/tax-calculation.test.ts`
- `tests/unit/sales/discount-allocation.test.ts`
- `tests/unit/sales/canonical-hash.test.ts`
- `tests/unit/sales/error-codes.test.ts`

### Integration Tests (Vitest + pg)

```bash
npm run test:integration
```

Target files:
- `tests/integration/sales/execute-sale.test.ts`
- `tests/integration/sales/void-sale.test.ts`
- `tests/integration/sales/execute-return.test.ts`
- `tests/integration/sales/refund-lifecycle.test.ts`
- `tests/integration/sales/idempotency.test.ts`
- `tests/integration/sales/concurrency.test.ts`
- `tests/integration/customers/customer-crud.test.ts`
- `tests/integration/sales/rls-policies.test.ts`

### E2E Tests (Playwright)

```bash
npx playwright test
```

Target files:
- `tests/e2e/pos-checkout.spec.ts`
- `tests/e2e/customer-management.spec.ts`
- `tests/e2e/void-return.spec.ts`

---

## Troubleshooting

| Issue | Resolution |
|---|---|
| Migration fails on `_execute_inventory_mutation_core` | Ensure F004 migration `20261111000017` was applied first |
| RLS denies all reads | Verify user has active membership and correct role permissions |
| `check_user_permission` not found | Ensure F002 migration `20261103000009` was applied |
| `get_currency_exponent` not found | Ensure F003 migration `20261106000010` was applied |
| `handle_updated_at` trigger function missing | Ensure F001 migration `20261031000001` was applied |
