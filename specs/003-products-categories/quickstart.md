# Developer Quickstart: Feature 003 — Products & Categories

**Feature Branch**: `003-products-categories`  
**Date**: 2026-11-06 (Reconciled with Approved Specification)  
**Status**: Authoritative Developer Quickstart  
**Governing Documents**:
- [BizFlow AI Constitution v1.1.0](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/.specify/memory/constitution.md)
- [Feature 003 Specification](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/specs/003-products-categories/spec.md)
- [Feature 003 Implementation Plan](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/specs/003-products-categories/plan.md)

---

## 1. Prerequisites & Environment Setup

Ensure your local development environment has completed Feature 001 (Auth & Organization) and Feature 002 (Employee Management & RBAC):

```bash
# 1. Switch to feature branch
git checkout 003-products-categories

# 2. Ensure dependencies are installed
npm install

# 3. Ensure local Supabase stack is running
npx supabase status
# If not running:
npx supabase start
```

---

## 2. Database Migration & Storage Verification

Apply the database migration to provision the schema, triggers, RLS policies, permissions, and private storage bucket:

```bash
# Apply pending database migrations
npx supabase migration up
```

Verify that the 9 catalog permissions exist:
```bash
npx supabase db query --sql "SELECT key, resource, action FROM public.permissions WHERE resource IN ('products', 'categories') ORDER BY key;"
```
Expected output:
- `categories:archive`
- `categories:create`
- `categories:read`
- `categories:update`
- `products:archive`
- `products:create`
- `products:read`
- `products:read_cost`
- `products:update`

Verify that the private storage bucket `product-images` is created with private access and 5 MB limit:
```bash
npx supabase db query --sql "SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'product-images';"
```
Expected: `public = false`, `file_size_limit = 5242880`, allowed MIME types array of 4 image types.

---

## 3. Running Automated Test Suites

### 3.1 Unit Tests (Validations, Calculations, & Actions)
```bash
npm run test:unit -- tests/unit/validations/product.test.ts tests/unit/validations/category.test.ts tests/unit/actions/product-actions.test.ts
```

### 3.2 Integration Tests (PostgreSQL RLS, RPCs, & Permissions)
```bash
npm run test:integration -- tests/integration/products-categories-rls.test.ts tests/integration/product-rpcs.test.ts
```

### 3.3 End-to-End Tests (Playwright)
```bash
npm run test:e2e -- tests/e2e/products-catalog.spec.ts
```

---

## 4. Manual Testing Walkthrough

1. **Sign In as Owner or Admin**:
   - Navigate to `http://localhost:3000/sign-in`.
   - Log in with credentials belonging to an active store Owner or Admin.
   - Navigate to `/[slug]/products`.

2. **Category Management**:
   - Open Categories view (`/[slug]/products/categories` or Category Manager modal).
   - Create a category: "Apparel". Verify it appears in active category selectors.
   - Try creating "apparel" again: verify validation error `P0006` (`IDENTIFIER_EXISTS` — duplicate category name).

3. **Product Registration & UOM**:
   - Navigate to `/[slug]/products/new`.
   - Create a product:
     - Name: "Classic White T-Shirt"
     - SKU: "TSHIRT-WHT-001" (automatically normalized to uppercase)
     - Unit of Measure: "piece" (selected from the 13 allowed retail UOM values)
     - Selling Price: "25.00"
     - Cost Price: "10.00"
     - Category: "Apparel"
     - Image URL: External HTTPS URL (`https://example.com/tshirt.png`) or upload thumbnail to private storage.
   - Submit form. Verify product appears in catalog with status `active`. Note that initial creation strictly produces an active product; supplying a cost price automatically creates the confidential `public.product_costs` record.

4. **Permanent Identifier Reservation Check**:
   - Archive the product "Classic White T-Shirt".
   - Navigate to `/[slug]/products/new` and attempt to create a different product with SKU "TSHIRT-WHT-001".
   - Verify that the creation is rejected with error `P0006` (`IDENTIFIER_EXISTS`), proving that archiving permanently retains the SKU reservation.

5. **Confidentiality Check (Sign In as Cashier)**:
   - Log in as a user with the `Cashier` role.
   - Navigate to `/[slug]/products`.
   - Verify product list displays selling price ($25.00) and that cost price and gross margins are completely absent from both the DOM and network payloads.
   - Verify creation and archiving buttons are hidden.

6. **Optimistic Concurrency Control (OCC) Check**:
   - Open the edit form `/[slug]/products/[productId]/edit` in two browser tabs.
   - In Tab A: Update selling price to $28.00 and save (increments version from 1 to 2).
   - In Tab B: Without refreshing, update description and save with `expected_version = 1`.
   - Verify Tab B displays the `CONCURRENCY_CONFLICT` (`P0010`) banner prompting the user to reload.

7. **Lifecycle State Conflict Check**:
   - Attempting to update an archived product or assign an archived category raises error `P0015` (`STATE_CONFLICT`).
   - Attempting to change an organization's currency when catalog products exist raises error `P0015` (`STATE_CONFLICT`).

8. **Performance Benchmark Verification**:
   - Verify that on a catalog of 10,000 items, search queries execute with database execution time $< 100$ms (p95) and end-to-end response time $< 400$ms.
