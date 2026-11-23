# Tasks: Feature 005 — Customers & Sales

**Input**: Design documents from `specs/005-customers-sales/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/database-rpcs.md, contracts/server-actions.md, quickstart.md, checklists/requirements.md

**Tests**: Test tasks are included per specification requirements. The spec mandates integration tests for RPCs, unit tests for Zod schemas, E2E tests for critical flows, and concurrency/security/financial precision test suites.

**Organization**: Tasks are grouped by user story (US1–US7 from spec.md) with foundational phases first.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (strictly different files, no shared state or unmet dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

### Execution Rules

1. **Same-File Sequential Rule**: Tasks that modify the same file must NEVER be executed in parallel. They must always be implemented sequentially in strict dependency order.
2. **Sequential Migration Rule**: All tasks modifying `supabase/migrations/20261117000021_customers_sales_schema.sql` (T001–T028) must be implemented sequentially in dependency order within the migration file. Parallel implementation of migration-file tasks is strictly prohibited regardless of logical independence.
3. **Parallel Eligibility**: Parallel implementation (`[P]`) is allowed only for independent work across completely separate files where prerequisites have already been satisfied.

---

> [!IMPORTANT]
> **Sequential migration rule**: All tasks modifying `supabase/migrations/20261117000021_customers_sales_schema.sql` (T001–T028) must be implemented sequentially in dependency order within a single migration file. The `[P]` marker applies only to tasks producing independent work in separate files. Parallel implementation of migration-file tasks is prohibited regardless of logical independence.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Database migration — 9 tables, 11 RPCs, 12 permissions, column-level security, RLS

- [x] T001 Create migration file `supabase/migrations/20261117000021_customers_sales_schema.sql` with header comments and transaction wrapper
- [x] T002 Define `public.customers` table with all columns, CHECK constraints, composite unique indexes (`uq_customers_org_id`, `uq_customers_org_phone`, `uq_customers_org_email`), and composite FK to `organizations` per `specs/005-customers-sales/data-model.md` Table 1
- [x] T003 Define `public.organization_tax_settings` table with PK `(organization_id)`, CHECK constraints on `tax_rate` (0–100) and `tax_name`, FK to `organizations`, per `data-model.md` Table 2
- [x] T004 Define `public.sale_sequences` table with composite PK `(organization_id, sequence_type, date_key)`, CHECK on `sequence_type IN ('sale', 'return')`, DEFAULT 0, per `data-model.md` Table 9
- [x] T005 Define `public.sales` table with all columns, composite FKs (`fk_sales_org`, `fk_sales_org_customer`), composite unique indexes, CHECK constraints on monetary columns, per `data-model.md` Table 3
- [x] T006 Define `public.sale_items` table with all columns including `unit_cost NUMERIC(14,4) NULL`, composite FKs (`fk_sale_items_org_sale`, `fk_sale_items_org_product`), composite unique indexes (`uq_sale_items_org_id`, `uq_sale_items_org_sale_item_prod`, `uq_sale_items_sale_product`), FK to `stock_movements`, per `data-model.md` Table 4
- [x] T007 Define `public.payments` table with all columns, composite FK, partial unique index on `(organization_id, payment_method, reference_no) WHERE reference_no IS NOT NULL`, CHECK constraints, per `data-model.md` Table 5
- [x] T008 Define `public.sale_returns` table with all columns, composite FKs (`fk_sale_returns_org_sale`), composite unique indexes (`uq_sale_returns_org_id`, `uq_sale_returns_org_sale_id`), per `data-model.md` Table 6
- [x] T009 Define `public.sale_return_items` table with all columns, composite FKs (`fk_return_items_org_return_sale`, `fk_return_items_org_sale_item_prod`), CHECK constraints, per `data-model.md` Table 7
- [x] T010 Define `public.refunds` table with all columns including `obligation_refund_id UUID NOT NULL`, composite FKs with `fk_refunds_org_obligation` as `DEFERRABLE INITIALLY DEFERRED`, partial unique indexes (`uq_refunds_org_obligation_active`, `uq_refunds_org_confirmation_key`, `uq_refunds_org_idempotency_key`), per `data-model.md` Table 8
- [x] T011 Enable and force RLS on all 9 tables: `ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY; ALTER TABLE public.<table> FORCE ROW LEVEL SECURITY;`
- [x] T012 Create RLS SELECT policies using `check_user_permission(organization_id, auth.uid(), '<permission>')` for all 9 tables per `data-model.md` RLS Policies sections
- [x] T013 Create RLS deny-all DML policies (`FOR ALL TO authenticated USING (false) WITH CHECK (false)`) for all 9 tables
- [x] T014 Implement column-level security on `sale_items`: `REVOKE SELECT ON TABLE public.sale_items FROM authenticated, anon, PUBLIC;` then `GRANT SELECT (id, organization_id, sale_id, product_id, quantity, unit_price, line_discount_amount, allocated_order_disc, taxable_amount, allocated_tax_amount, total_price, movement_id, created_at) ON TABLE public.sale_items TO authenticated;` per `data-model.md` Security Grants section
- [x] T015 Create `updated_at` triggers for `customers`, `organization_tax_settings`, `sales`, `refunds`, `sale_sequences` using `handle_updated_at()` per `data-model.md` Updated Trigger section
- [x] T016 Insert 12 permissions into `public.permissions` and role-permission mappings into `public.role_permissions` per `data-model.md` Permissions section
- [x] T017 Implement RPC `public.execute_sale` with full PL/pgSQL body per `contracts/database-rpcs.md` §1 (18 preconditions, canonical hash, inventory mutation, sequence generation, tax calculation, payment recording)
- [x] T018 Implement RPC `public.void_sale` with full PL/pgSQL body per `contracts/database-rpcs.md` §2 (ascending product_id locks, inventory restoration, cash/external refund creation with self-referencing deferred obligation FK, F005-038/039 reconciliation)
- [x] T019 Implement RPC `public.execute_sale_return` with full PL/pgSQL body per `contracts/database-rpcs.md` §3 (proportional refund, restock toggle, sequence generation, self-referencing deferred obligation FK, F005-039 reconciliation)
- [x] T020 Implement RPC `public.confirm_refund_reimbursement` with full PL/pgSQL body per `contracts/database-rpcs.md` §4 (F005-046 Cases A–E, advisory lock, cross-refund collision check, confirmation hash)
- [x] T021 Implement RPC `public.record_refund_failure` with full PL/pgSQL body per `contracts/database-rpcs.md` §5 (status transition, F005-039 reconciliation)
- [x] T022 Implement RPC `public.issue_replacement_refund` with full PL/pgSQL body per `contracts/database-rpcs.md` §6 (unconditional obligation advisory lock, lineage inheritance, F005-044 obligation tracking)
- [x] T023 Implement RPC `public.create_customer` with full PL/pgSQL body per `contracts/database-rpcs.md` §7 (normalization, partial uniqueness, tenant scoping)
- [x] T024 Implement RPC `public.update_customer` with full PL/pgSQL body per `contracts/database-rpcs.md` §8
- [x] T025 Implement RPC `public.archive_customer` with full PL/pgSQL body per `contracts/database-rpcs.md` §9 (idempotent archival, uniqueness release)
- [x] T026 Implement RPC `public.update_tax_settings` with full PL/pgSQL body per `contracts/database-rpcs.md` §10 (upsert, Owner/Admin authorization)
- [x] T027 Implement RPC `public.get_sale_detail` with full PL/pgSQL body per `contracts/database-rpcs.md` §11 (SECURITY DEFINER, dual-permission cost evaluation: `inventory:read_valuation` AND `products:read_cost`, conditional unit_cost projection)
- [x] T028 Set ownership (`OWNER TO postgres`), security (`SECURITY DEFINER`, `SET search_path`), and grants (`REVOKE ALL FROM PUBLIC, anon, service_role; GRANT EXECUTE TO authenticated`) for all 11 RPCs per `contracts/database-rpcs.md` Common Conventions
- [x] T029 Verify migration: run `npx supabase db reset`, confirm all 905+ existing F001–F004 tests pass, run schema verification queries from `quickstart.md`

**Checkpoint**: Database foundation is complete. All 9 tables, 11 RPCs, 12 permissions, column security, and RLS policies are deployed. `npx supabase db reset` succeeds with zero F001–F004 regressions.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Application-level permission registration, domain types, Zod validation schemas, and error code mapping that all user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T030 Add 12 new permission keys (`customers:read`, `customers:create`, `customers:update`, `customers:archive`, `sales:read`, `sales:create`, `sales:void`, `returns:read`, `returns:create`, `payments:read`, `refunds:read`, `tax_settings:update`) to `SYSTEM_PERMISSIONS` array in `src/lib/auth/permissions.ts`
- [x] T031 Add F005 role-permission mappings (Owner 12, Admin 12, Manager 11, Cashier 7) to `ROLE_PERMISSIONS` map in `src/lib/auth/permissions.ts` per `data-model.md` Permissions section
- [x] T032 [P] Extend `PermissionKey` union type with 12 new keys in `src/types/auth.ts`
- [x] T033 [P] Define customer domain types (`CustomerRecord`, `CustomerDetail`, `PaginatedCustomerResult`, `CustomerSearchQuery`) in `src/types/customers.ts` per `contracts/server-actions.md` §1
- [x] T034 [P] Define sales domain types (`SaleResult`, `SaleDetail`, `SaleItemRecord`, `PaymentRecord`, `ReturnRecord`, `RefundRecord`, `PaginatedSalesList`, `ReturnHistory`) in `src/types/sales.ts` per `contracts/server-actions.md` §2
- [x] T035 [P] Create customer Zod schemas (`createCustomerSchema`, `updateCustomerSchema`, `customerSearchSchema`) in `src/lib/validations/customers.ts` with E.164 phone regex, email format, name 1–255 chars per `contracts/server-actions.md` §4
- [x] T036 [P] Create sales Zod schemas (`executeSaleSchema`, `voidSaleSchema`, `executeSaleReturnSchema`, `confirmRefundSchema`, `recordRefundFailureSchema`, `issueReplacementRefundSchema`, `salesListQuerySchema`, `updateTaxSettingsSchema`) in `src/lib/validations/sales.ts` per `contracts/server-actions.md` §4
- [x] T037 [P] Create SQLSTATE → domain error code mapper `mapSalesError()` in `src/lib/sales/error-codes.ts` mapping P0011–P0067 and 23503/23505/22012 per spec error catalog
- [x] T038 Verify TypeScript compilation passes with all new types, schemas, and permissions: `npx tsc --noEmit`

**Checkpoint**: Foundation ready — all domain types, validation schemas, permission keys, and error mappers are compiled. User story implementation can begin.

---

## Phase 3: User Story 2 — Customer Profile Management & Purchase History (Priority: P1) 🎯 MVP

**Goal**: Create, search, update, and archive customer profiles with tenant-scoped uniqueness and purchase history

**Independent Test**: Create customer "John Smith" with phone "+15550199" and email "John.Smith@Example.COM", confirm normalization, retrieve profile, perform a linked sale, verify purchase history.

### Implementation for User Story 2

- [x] T039 [US2] Implement `createCustomerAction` server action in `src/actions/customer-actions.ts` per `contracts/server-actions.md` §1 (permission: `customers:create`, RPC: `create_customer`, revalidation)
- [x] T040 [US2] Implement `updateCustomerAction` server action in `src/actions/customer-actions.ts` per `contracts/server-actions.md` §1
- [x] T041 [US2] Implement `archiveCustomerAction` server action in `src/actions/customer-actions.ts` per `contracts/server-actions.md` §1
- [x] T042 [US2] Implement `searchCustomersAction` server action in `src/actions/customer-actions.ts` per `contracts/server-actions.md` §1 (PostgREST `.from('customers')` with ilike search, pagination)
- [x] T043 [US2] Implement `getCustomerDetailAction` server action in `src/actions/customer-actions.ts` per `contracts/server-actions.md` §1 (includes purchase count and last purchase date)
- [x] T044 [US2] Build customer list page with search bar, pagination, and status filter in `src/app/[slug]/customers/page.tsx`
- [x] T045 [US2] Build create/edit customer modal component in `src/components/customers/customer-form.tsx` with phone E.164 validation and email normalization feedback
- [x] T046 [US2] Build customer detail page with info tab and purchase history tab in `src/app/[slug]/customers/[customerId]/page.tsx`
- [x] T047 [US2] Build inline POS customer picker component in `src/components/customers/customer-picker.tsx` (search + inline creation modal for Phase 7 POS integration)

**Checkpoint**: Customer CRUD is fully functional. Customers can be created, searched, updated, archived. Independently testable via customer management UI.

---

## Phase 4: User Story 1 — POS Cart & Atomic Multi-Item Checkout (Priority: P1) 🎯 MVP

**Goal**: Atomic multi-item checkout with server-authoritative pricing, tax calculation, inventory deduction, and idempotency

**Independent Test**: Select 2 active products, add to cart for walk-in guest, tender full cash payment, confirm sale `completed`, items snapshotted, inventory decremented, stock movements created.

### Implementation for User Story 1

- [x] T048 [US1] Implement `executeSaleAction` server action in `src/actions/sales-actions.ts` per `contracts/server-actions.md` §2 (permission: `sales:create`, RPC: `execute_sale`, idempotency key forwarding)
- [x] T049 [US1] Implement client-side canonical hash utility in `src/lib/sales/canonical-hash.ts` per `contracts/server-actions.md` §2 (deterministic sorting of items by product_id, payments by 5 fields, numeric formatting, reference_no normalization)

### User Story 3 — Multi-Method & Split Payments (Priority: P1) 🎯 MVP

> **Note**: US3 is integrated directly into US1 checkout since payments are an atomic part of the checkout transaction. The `execute_sale` RPC and POS UI handle multi-tender, cash change calculation, and reference validation natively.

- [x] T050 [US1] Build POS cart page with product search (name, SKU) in `src/app/[slug]/pos/page.tsx`
- [x] T051 [US1] Build cart item row component with quantity editing and line discount input in `src/components/pos/cart-item-row.tsx`
- [x] T052 [US1] Build order-level discount input and checkout summary component (subtotal, discounts, tax preview, total) in `src/components/pos/checkout-summary.tsx`
- [x] T053 [US1] Integrate customer picker from Phase 3 into POS page (optional customer attachment, inline creation per CUS-009/CUS-010)
- [x] T054 [US1] Build payment modal with multi-tender support (cash change calculation, card/bank/other reference entry, running balance display) in `src/components/pos/payment-modal.tsx`
- [x] T055 [US1] Implement idempotency key generation (client UUID) and checkout submit handler with canonical hash in `src/components/pos/checkout-handler.tsx`
- [x] T056 [US1] Build receipt display component (shown after successful checkout) in `src/components/pos/checkout-receipt.tsx`
- [x] T057 [US1] Build error display with actionable domain error messages (insufficient stock, payment mismatch, archived product) in `src/components/pos/checkout-errors.tsx`

**Checkpoint**: POS checkout is fully functional end-to-end. Walk-in and registered customer sales with single or split payments complete atomically. Independently testable.

---

## Phase 5: User Story 5 — Sales Transaction History, Filtering & Printable Receipt (Priority: P2)

**Goal**: Searchable sales history, full sale detail view, and printable thermal receipt

**Independent Test**: Navigate to Sales History, filter by date/cashier, click a sale to view full breakdown, generate printable receipt.

### Implementation for User Story 5

- [x] T058 [US5] Implement `updateTaxSettingsAction` and `getTaxSettingsAction` server actions in `src/actions/tax-settings-actions.ts` per `contracts/server-actions.md` §3
- [x] T059 [US5] Build tax settings form and page in `src/components/settings/tax-settings-form.tsx` and `src/app/[slug]/settings/tax/page.tsx`
- [x] T060 [US5] Implement `getSalesListAction` server action in `src/actions/sales-actions.ts` per `contracts/server-actions.md` §2 (PostgREST query with date, status, customer, cashier, search filters; database-enforced cost protection: direct SELECT on `unit_cost` revoked)
- [x] T061 [US5] Implement `getSaleDetailAction` server action in `src/actions/sales-actions.ts` per `contracts/server-actions.md` §2 (RPC call: `supabase.rpc('get_sale_detail', { p_org_id, p_sale_id })`, database-enforced dual-permission cost masking)
- [x] T062 [US5] Implement `getReturnHistoryAction` server action in `src/actions/sales-actions.ts` per `contracts/server-actions.md` §2
- [x] T063 [US5] Build sales history page with filters (date range, status, customer, cashier, sale number search) in `src/app/[slug]/sales/page.tsx`
- [x] T064 [US5] Build sale detail page with items, payments, returns, refunds tabs in `src/app/[slug]/sales/[saleId]/page.tsx`
- [x] T065 [US5] Build printable thermal receipt component (80mm/58mm layout: org header, currency, receipt number, date/time in org timezone, cashier, customer, line items, subtotal, discount, tax, total, tender, change, return policy) in `src/components/sales/receipt-print.tsx`

**Checkpoint**: Sales history browsable, detail view complete with cost masking enforced at DB level, thermal receipt printable. Independently testable.

---

## Phase 6: User Story 6 — Sale Void / Cancellation (Priority: P3)

**Goal**: Void erroneous sales, restore inventory atomically, create reversal refund records with pending external reimbursement lifecycle

**Independent Test**: Complete a sale with cash, void it as Manager, confirm status `voided`/`refunded`, inventory restored, refund record created, subsequent returns blocked.

### Implementation for User Story 6

- [x] T066 [US6] Implement `voidSaleAction` server action in `src/actions/sales-actions.ts` per `contracts/server-actions.md` §2 (permission: `sales:void`, RPC: `void_sale`, idempotency key)
- [x] T067 [US6] Build void confirmation dialog with reason input, optional reversal reference entry, and permission gating in `src/components/sales/void-dialog.tsx`
- [x] T068 [US6] Integrate void button into sale detail page (Phase 5 T064) with permission visibility check (`sales:void`)

**Checkpoint**: Voids work for cash (immediate) and external (pending) payments. Cashiers blocked. Returns blocked after void. Independently testable.

---

## Phase 7: User Story 4 — Line-Item Returns, Restock Restoration & Refunds (Priority: P2)

**Goal**: Process customer returns with item selection, restock toggle, proportional refund, and audit trail

**Independent Test**: Complete a sale of 3 units, return 1 with restock, verify return record, refund record, inventory increment, stock movement. Attempt excess return (rejected).

### Implementation for User Story 4

- [x] T069 [US4] Implement `executeSaleReturnAction` server action in `src/actions/sales-actions.ts` per `contracts/server-actions.md` §2 (permission: `returns:create`, RPC: `execute_sale_return`, idempotency key)
- [x] T070 [US4] Build return dialog with line-item selection checkboxes, quantity inputs, restock toggle per item, refund method selection, and proportional refund calculation preview in `src/components/sales/return-dialog.tsx`
- [x] T071 [US4] Integrate return button into sale detail page (Phase 5 T064) with permission visibility check (`returns:create`) and void-state blocking

**Checkpoint**: Returns work for partial quantities with/without restock. Excess quantity and duplicate items rejected. Inactive product restock blocked. Independently testable.

---

## Phase 8: User Story 7 — Replacement Reimbursement Lifecycle & Idempotency Safeguards (Priority: P2)

**Goal**: Confirm external refunds, record failures, issue replacements with obligation tracking and idempotency

**Independent Test**: Create void/return with external refund, mark failed, issue replacement, attempt duplicate (rejected P0064), complete obligation, attempt replacement on completed obligation (rejected P0067).

### Implementation for User Story 7

- [ ] T072 [US7] Implement `confirmRefundAction` server action in `src/actions/sales-actions.ts` per `contracts/server-actions.md` §2 (permission: `refunds:read` AND (`sales:void` OR `returns:create`), RPC: `confirm_refund_reimbursement`, idempotency key)
- [ ] T073 [US7] Implement `recordRefundFailureAction` server action in `src/actions/sales-actions.ts` per `contracts/server-actions.md` §2 (permission: `sales:void` OR `returns:create`, RPC: `record_refund_failure`)
- [ ] T074 [US7] Implement `issueReplacementRefundAction` server action in `src/actions/sales-actions.ts` per `contracts/server-actions.md` §2 (permission: `sales:void` OR `returns:create`, RPC: `issue_replacement_refund`, idempotency key)
- [ ] T075 [US7] Build refund lifecycle management UI in `src/components/sales/refund-actions.tsx` (pending refund list → confirm dialog with external reference → failure dialog with reason → replacement dialog with method selection)
- [ ] T076 [US7] Integrate refund lifecycle actions into sale detail page (Phase 5 T064) refunds tab

**Checkpoint**: Full refund lifecycle (confirm/fail/replace) operational. Obligation tracking, advisory locks, and idempotency safeguards enforced. Independently testable.

---

## Phase 9: Automated Test Suite & Final Verification

**Purpose**: Comprehensive test coverage for all RPCs, RLS, column privileges, concurrency, security, financial precision, and E2E

### Unit Tests

- [ ] T077 [P] Write unit tests for all customer Zod schemas (name boundaries, E.164 phone, email format, search query) in `tests/unit/validations/customers.test.ts`
- [ ] T078 [P] Write unit tests for all sales Zod schemas (cart items, payment methods, quantities, discounts, amounts, UOM precision) in `tests/unit/validations/sales.test.ts`
- [ ] T079 [P] Write unit tests for tax calculation (exclusive, inclusive, zero-rate, rounding, JPY exponent 0, KWD exponent 3) in `tests/unit/sales/tax-calculation.test.ts`
- [ ] T080 [P] Write unit tests for discount allocation (line, order, proportional, zero-subtotal guard) in `tests/unit/sales/discount-allocation.test.ts`
- [ ] T081 [P] Write unit tests for canonical hash construction (payment normalization, reference_no null/empty/whitespace, array sort determinism, amount_tendered/change_due sensitivity) in `tests/unit/sales/canonical-hash.test.ts`
- [ ] T082 [P] Write unit tests for refund calculation (proportional, residual absorption on final return, cumulative cap) in `tests/unit/sales/refund-calculation.test.ts`

### Integration Tests — RPCs

- [ ] T083 [P] Write integration tests for `execute_sale` RPC in `tests/integration/sales/execute-sale.test.ts`: walk-in guest (tax-exclusive), registered customer (tax-inclusive), split payment, cash change, zero-value sale, idempotency replay/conflict, insufficient stock, archived/inactive product, duplicate product, empty cart, payment under/overpayment, payment reference validation, concurrent last-unit checkout
- [ ] T084 [P] Write integration tests for `void_sale` RPC in `tests/integration/sales/void-sale.test.ts`: cash void (immediate), external void with/without reference (pending), void blocked if returns exist, void blocked if already voided, cashier rejection, void idempotency, inventory restoration verification
- [ ] T085 [P] Write integration tests for `execute_sale_return` RPC in `tests/integration/sales/execute-sale-return.test.ts`: partial return with/without restock, excess quantity, duplicate return item, inactive product restock blocked, cross-sale FK enforcement, return idempotency, split-tender ceiling, cumulative refund cap, proportional refund math
- [ ] T086 [P] Write integration tests for `confirm_refund_reimbursement` RPC in `tests/integration/sales/confirm-refund.test.ts`: F005-046 Cases A (replay), B (conflict payload), C (cross-refund collision), D (already settled), E (concurrent serialization)
- [ ] T087 [P] Write integration tests for `record_refund_failure` and `issue_replacement_refund` RPCs in `tests/integration/sales/refund-lifecycle.test.ts`: failure recording, replacement with obligation tracking (F005-044), unconditional obligation lock, P0064 (active attempt), P0067 (completed obligation), multi-failure chain R1→R2→R3, cross-sale parent refund FK, concurrent replacement serialization
- [ ] T088 [P] Write integration tests for customer RPCs (`create_customer`, `update_customer`, `archive_customer`) in `tests/integration/customers/customer-crud.test.ts`: normalization, duplicate phone/email, tenant-scoped uniqueness, archival with history, idempotent archive
- [ ] T089 [P] Write integration tests for `update_tax_settings` and `get_sale_detail` RPCs in `tests/integration/sales/tax-and-detail.test.ts`: upsert behavior, rate validation, `get_sale_detail` cost masking (dual-permission check)

### Integration Tests — Security, RLS & Column Privileges

- [ ] T090 Write integration tests for RLS and column privileges in `tests/integration/security/rls-and-column-security.test.ts`: S08a (cashier direct PostgREST `unit_cost` → `42501`), S08b (cashier RPC → null), S08c (valuation-only → null), S08d (product-cost-only → null), S08e (both permissions → actual cost), S08f (cross-tenant → P0048), S08g (safe columns via PostgREST → success), S01–S07 (permission rejections, deny-all DML, cross-tenant isolation), S09 (service role key check)

### Integration Tests — Concurrency & Foreign Key Integrity

- [ ] T091 Write integration tests for concurrency and FK integrity in `tests/integration/concurrency/obligation-and-fk.test.ts`: C44-01 through C44-05 (obligation lock serialization), C45-01 through C45-07 (composite FK integrity including deferred obligation FK), C46-A through C46-E (confirmation idempotency), C47-01 through C47-05 (payment canonical normalization)

### Integration Tests — Financial Precision

- [ ] T092 Write integration tests for financial precision in `tests/integration/financial/precision.test.ts`: F01–F11 (tax-exclusive/inclusive, zero-rate, multi-item rounding, currency exponents JPY/KWD, max quantity, decimal precision, discrete UOM, proportional return, final remaining absorption)

### E2E Tests

- [ ] T093 [P] Write E2E test for POS checkout flow in `tests/e2e/sales/pos-checkout.e2e.ts`: product search, cart add, quantity edit, discount, customer attach, split payment, receipt display
- [ ] T094 [P] Write E2E test for customer management flow in `tests/e2e/customers/customer-management.e2e.ts`: create, search, edit, archive, purchase history
- [ ] T095 [P] Write E2E test for sales history and receipt in `tests/e2e/sales/sales-history.e2e.ts`: list filter, detail view, thermal receipt print
- [ ] T096 Write E2E test for void and return flow in `tests/e2e/sales/void-and-return.e2e.ts`: complete sale, void, return with restock, refund lifecycle

### Final Verification

- [ ] T097 Run full regression suite: `npm run test && npx playwright test`
- [ ] T098 Run schema verification queries from `specs/005-customers-sales/quickstart.md` to confirm 9 tables, 11 RPCs, 12 permissions
- [ ] T099 Verify zero regression in F001–F004 test suites

**Checkpoint**: All tests pass. Zero regressions. Feature 005 is complete.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately. BLOCKS everything.
- **Foundational (Phase 2)**: Depends on Phase 1 completion — BLOCKS all user stories.
- **User Story 2 (Phase 3)**: Depends on Phase 2. Can start immediately after foundation.
- **User Story 1+3 (Phase 4)**: Depends on Phase 2 AND Phase 3 (customer picker needed).
- **User Story 5 (Phase 5)**: Depends on Phase 4 (needs sales data to display). Tax settings actions independent of US1.
- **User Story 6 (Phase 6)**: Depends on Phase 4 (needs completed sales to void).
- **User Story 4 (Phase 7)**: Depends on Phase 4 (needs completed sales). Depends on Phase 6 (void prevents returns).
- **User Story 7 (Phase 8)**: Depends on Phase 6 and Phase 7 (needs refund records from voids/returns).
- **Test Suite (Phase 9)**: Depends on all prior phases.

### User Story Dependencies

- **US2 (Customers)**: Independent after foundation. No other story dependency.
- **US1+3 (Checkout+Payments)**: Depends on US2 (customer picker component).
- **US5 (History/Receipt)**: Depends on US1 (needs sale data).
- **US6 (Void)**: Depends on US1 (needs completed sales).
- **US4 (Returns)**: Depends on US1 (needs completed sales), integrates with US6 (void blocks returns).
- **US7 (Refund Lifecycle)**: Depends on US6 and US4 (needs refund records).

### Within Each User Story

- Server actions before UI components
- Core logic before integration
- Story complete before moving to next priority

### Parallel Opportunities

- **Phase 1 (Database Migration)**: **NO PARALLEL EXECUTION**. All tasks (T001–T028) modify a single file (`supabase/migrations/20261117000021_customers_sales_schema.sql`) and MUST be implemented sequentially in strict dependency order (tables → constraints → triggers → permissions → RPCs → grants). T029 verifies the combined result.
- **Phase 2 (Foundational)**: T030 and T031 both modify `src/lib/auth/permissions.ts` and must be sequential. Once completed, T032–T037 modify separate files (`src/types/auth.ts`, `src/types/customers.ts`, `src/types/sales.ts`, `src/lib/validations/customers.ts`, `src/lib/validations/sales.ts`, `src/lib/sales/error-codes.ts`) and can execute in parallel.
- **Phase 3 (User Story 2)**: Server actions T039–T043 all modify `src/actions/customer-actions.ts` and must be implemented sequentially. Once actions are complete, UI components across separate files (T044, T045, T046, T047) can be developed independently.
- **Phase 4 (User Stories 1 & 3)**: T048 (`src/actions/sales-actions.ts`) and T049 (`src/lib/sales/canonical-hash.ts`) are in separate files and can run in parallel. POS UI components across separate files (T050, T051, T052, T054, T056, T057) can be built in parallel once data contracts are established.
- **Phase 5 (User Story 5)**: Server actions T060–T062 all modify `src/actions/sales-actions.ts` and must be sequential. T058 modifies `src/actions/tax-settings-actions.ts`.
- **Phase 8 (User Story 7)**: Server actions T072–T074 all modify `src/actions/sales-actions.ts` and must be sequential.
- **Phase 9 (Test Suite)**: High parallelization across separate test files — Unit tests (T077–T082), Integration tests (T083–T089), and E2E tests (T093–T095) all target distinct files and can run concurrently.

---

## Parallel Example: User Story 1

```text
# Pre-requisite: Foundation complete (Phase 2), US2 customer actions complete in src/actions/customer-actions.ts

# 1. Server action & canonical hash in separate files can execute concurrently:
Task T048: executeSaleAction in src/actions/sales-actions.ts
Task T049: Canonical hash utility in src/lib/sales/canonical-hash.ts

# 2. Once contracts are settled, POS UI components across separate files can execute in parallel:
Task T051: Cart item row in src/components/pos/cart-item-row.tsx
Task T052: Checkout summary in src/components/pos/checkout-summary.tsx
Task T054: Payment modal in src/components/pos/payment-modal.tsx
Task T056: Receipt display in src/components/pos/checkout-receipt.tsx
Task T057: Error display in src/components/pos/checkout-errors.tsx

# Note: Tasks modifying the same file (e.g., T039–T043 in customer-actions.ts or T001–T028 in the migration SQL)
# must always be executed sequentially in dependency order, never in parallel.
```

---

## Implementation Strategy

### MVP First (User Stories 1+2+3)

1. Complete Phase 1: Database Migration (all 9 tables, 11 RPCs, column security)
2. Complete Phase 2: Foundational (types, schemas, permissions)
3. Complete Phase 3: Customer Management (US2)
4. Complete Phase 4: POS Checkout with Split Payments (US1+US3)
5. **STOP and VALIDATE**: Test customer creation, POS checkout, split payment, inventory deduction independently
6. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US2 (Customers) → Test independently → MVP increment
3. Add US1+US3 (Checkout+Payments) → Test independently → Core MVP!
4. Add US5 (History/Receipt) → Test independently → Reporting
5. Add US6 (Void) → Test independently → Corrections
6. Add US4 (Returns) → Test independently → Returns
7. Add US7 (Refund Lifecycle) → Test independently → Full lifecycle
8. Add Test Suite (Phase 9) → Full coverage

### Parallel Team Strategy

With multiple developers after Foundational:
- Developer A: US2 (Customers) → US1+US3 (Checkout)
- Developer B: US5 (History/Receipt) → US6 (Void)
- Developer C: US4 (Returns) → US7 (Refund Lifecycle)
- All: Phase 9 (Tests — parallelizable by test file)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
- All monetary arithmetic uses `NUMERIC(14,4)` — zero floating-point in financial paths
- All 11 RPCs are `SECURITY DEFINER` owned by `postgres` with restricted grants
- `sale_items.unit_cost` is database-protected via column privilege revocation (SQLSTATE 42501) and `get_sale_detail` RPC with dual-permission evaluation
- `fk_refunds_org_obligation` is `DEFERRABLE INITIALLY DEFERRED` for self-referencing original refund inserts
