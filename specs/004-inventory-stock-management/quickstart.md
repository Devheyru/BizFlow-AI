# Developer Quickstart: Feature 004 — Inventory & Stock Management

**Feature Branch**: `004-inventory-stock-management`  
**Date**: 2026-11-10  
**Status**: Authoritative Developer Quickstart  
**Governing Documents**:
- [BizFlow AI Constitution v1.1.0](.specify/memory/constitution.md)
- [Feature 004 Specification](specs/004-inventory-stock-management/spec.md)
- [Feature 004 Data Model](specs/004-inventory-stock-management/data-model.md)
- [Feature 004 Database Contracts](specs/004-inventory-stock-management/contracts/database-rpcs.md)

---

## 1. Prerequisites & Environment Setup

Ensure your local development environment has completed Feature 001 (Auth & Org), Feature 002 (RBAC), and Feature 003 (Catalog):

```bash
# 1. Switch to feature branch
git checkout 004-inventory-stock-management

# 2. Ensure dependencies are installed
npm install

# 3. Ensure local Supabase stack is running
npx supabase status
# If stopped:
npx supabase start
```

---

## 2. Database Migration & Permissions Verification

Apply the database migration for Feature 004 to create `inventory`, `stock_movements`, `stock_movement_costs`, `zero_delta_stocktakes`, RLS policies, permissions, triggers, and stored procedures:

```bash
# Apply migrations
npx supabase migration up
```

Verify that the 5 inventory permissions are registered in `public.permissions`:
```bash
npx supabase db query --sql "SELECT id, category, description FROM public.permissions WHERE category = 'inventory' ORDER BY id;"
```
Expected output:
- `inventory:adjust`
- `inventory:history`
- `inventory:read`
- `inventory:read_valuation`
- `inventory:receive`

Verify that the stored procedures exist with exact parameter signatures and secure ownership:
```bash
npx supabase db query --sql "
SELECT proname, prosecdef, proowner::regrole, pg_get_function_identity_arguments(oid) as args
FROM pg_proc
WHERE proname IN ('_execute_inventory_mutation_core', 'execute_stock_movement', 'update_inventory_thresholds');"
```
Expected:
- `_execute_inventory_mutation_core`: `prosecdef = true`, `proowner = postgres`
- `execute_stock_movement`: `prosecdef = true`, `proowner = postgres`, 9 arguments with `p_quantity_semantics`
- `update_inventory_thresholds`: `prosecdef = true`, `proowner = postgres`, 5 arguments

---

## 3. Running Automated Test Suites

### 3.1 Unit Tests (Validations, Hashing, & Calculations)
```bash
npm run test:unit -- tests/unit/validations/inventory.test.ts tests/unit/inventory/canonical-hash.test.ts
```

### 3.2 Integration Tests (PostgreSQL RLS, RPCs, & Invariants)
```bash
npm run test:integration -- tests/integration/inventory/execute-stock-movement.test.ts tests/integration/inventory/idempotency.test.ts tests/integration/inventory/cost-isolation.test.ts
```

### 3.3 End-to-End Tests (Playwright Browser Flows)
```bash
npm run test:e2e -- tests/e2e/inventory-workflow.spec.ts
```

---

## 4. Key Verification SQL Queries

### 4.1 Verify Anchor Provisioning Trigger
Create a product and verify that an anchor `inventory` row is provisioned with 0 balance:
```bash
npx supabase db query --sql "
SELECT p.name, p.sku, inv.quantity, inv.version
FROM public.products p
JOIN public.inventory inv ON inv.product_id = p.id
ORDER BY inv.created_at DESC LIMIT 1;"
```

### 4.2 Verify Cost Table Isolation for Cashiers
Simulate Cashier role query on `public.stock_movement_costs` to verify 0 rows are returned:
```bash
npx supabase db query --sql "
SET ROLE authenticated;
SET request.jwt.claim.sub = '<CASHIER_PROFILE_ID>';
SELECT count(*) FROM public.stock_movement_costs;
RESET ROLE;"
```
Expected output: `count = 0`.

### 4.3 Verify Regression Canonical Hashes
Execute node script to verify deterministic SHA-256 calculation across all regression fixtures:
```bash
node -e "
const crypto = require('crypto');
const payload1 = '{\"canonical_quantity\":\"45.0000\",\"movement_type\":\"adjustment\",\"organization_id\":\"a0000000-0000-0000-0000-000000000001\",\"product_id\":\"b0000000-0000-0000-0000-000000000002\",\"quantity_semantics\":\"target_physical_count\",\"reason\":\"Quarterly stocktake\",\"reference_id\":null}';
const hash1 = crypto.createHash('sha256').update(payload1, 'utf8').digest('hex');
console.assert(hash1 === '822dbc7818bb44882daff5f29396366a9d5f9eb571938eb36fd60270a5f108a6', 'Hash 1 failed');

const payload2 = '{\"canonical_quantity\":\"45.0000\",\"movement_type\":\"adjustment\",\"organization_id\":\"a0000000-0000-0000-0000-000000000001\",\"product_id\":\"b0000000-0000-0000-0000-000000000002\",\"quantity_semantics\":\"quantity_delta\",\"reason\":\"Quarterly stocktake\",\"reference_id\":null}';
const hash2 = crypto.createHash('sha256').update(payload2, 'utf8').digest('hex');
console.assert(hash2 === '7e2b11299620db0e9531afe7b999c1d1096b39b7f860d67be5efc531eed9f707', 'Hash 2 failed');

const payload3 = '{\"canonical_quantity\":\"12.5000\",\"movement_type\":\"damage\",\"organization_id\":\"a0000000-0000-0000-0000-000000000001\",\"product_id\":\"b0000000-0000-0000-0000-000000000002\",\"quantity_semantics\":\"quantity_delta\",\"reason\":\"Broken \\\"glass\\\" & \\\\backslashes\\\\\",\"reference_id\":\"REF \\\"A-12\\\\34\\\"\"}';
const hash3 = crypto.createHash('sha256').update(payload3, 'utf8').digest('hex');
console.assert(hash3 === '596a760972b11657cebb84a84a5b4541252b3f5c1d1d781a00c4686aeb7c0a3f', 'Hash 3 failed');
console.log('All 3 regression hash fixtures verified successfully.');
"
```

