# Tasks: Feature 004 — Inventory & Stock Management

**Input**: `specs/004-inventory-stock-management/` — spec.md, plan.md, data-model.md, contracts/, research.md

**Prerequisites**: plan.md ✅ | spec.md ✅ | data-model.md ✅ | contracts/database-rpcs.md ✅ | contracts/server-actions.md ✅

**Branch**: `004-inventory-stock-management`

**Migration File**: `supabase/migrations/20261111000017_inventory_stock_management.sql`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create skeleton files and domain type definitions that all subsequent phases depend on. Zero logic — only structure and types.

- [X] T001 Create empty migration file skeleton with header comment block in `supabase/migrations/20261111000017_inventory_stock_management.sql`
- [X] T002 [P] Create `src/types/inventory.ts` with all domain TypeScript interfaces and error types (`InventoryRow`, `StockMovementRow`, `StockMutationResult`, `InventoryOverview`, `MovementType`, `QuantitySemantics`, `StockStatus`, `InventoryErrorCode`, and all query/filter types)

---

## Phase 2: Foundational — DB Schema & Mutation Engine

**Purpose**: Core database infrastructure that MUST be complete before any server action or UI work can begin.

> **⚠️ CRITICAL**: No user story work can begin until this phase is complete and the migration has been applied successfully.

### 2A — Tables, Constraints, Indexes & RLS

- [X] T003 Implement `public.inventory` and `public.stock_movements` tables (including `inventory_id UUID NOT NULL`, tripartite FK `fk_movements_inventory_composite`, product FK `fk_movements_org_product`, `uq_inventory_org_id_product`, `chk_inventory_quantity_non_negative`, `chk_movement_type_sign`, `chk_movement_delta_zero_rule`, `chk_movement_initial_before_zero`, `uq_stock_movements_initial_per_product`, `uq_movements_org_idempotency`) in `supabase/migrations/20261111000017_inventory_stock_management.sql`
- [X] T004 Implement `public.stock_movement_costs` table (1:1 cost isolation with RLS requiring `inventory:read_valuation` AND `products:read_cost`) in `supabase/migrations/20261111000017_inventory_stock_management.sql`
- [X] T005 Implement `public.zero_delta_stocktakes` table (`id`, `organization_id`, `product_id`, `idempotency_key`, `idempotency_payload_hash`, `target_physical_count NUMERIC(14,4)`, `created_by`, `created_at`, `uq_zero_delta_stocktake_idempotency`) in `supabase/migrations/20261111000017_inventory_stock_management.sql`
- [X] T006 Add forced RLS on all 4 tables with strict SELECT policies and `WITH CHECK (false)` mutation denial; add `inventory:read`, `inventory:history`, `inventory:read_valuation` SELECT policies in `supabase/migrations/20261111000017_inventory_stock_management.sql`
- [X] T007 [P] Seed 5 inventory permissions (`inventory:read`, `inventory:receive`, `inventory:adjust`, `inventory:history`, `inventory:read_valuation`) and role mappings in `supabase/migrations/20261111000017_inventory_stock_management.sql`
- [X] T008 [P] Implement `trg_provision_inventory_anchor` trigger on `public.products` (zero-balance `inventory` row provisioned on INSERT) in `supabase/migrations/20261111000017_inventory_stock_management.sql`

### 2B — Stored Procedures & Mutation Engine

- [X] T009 Implement Layer 1 core function `public._execute_inventory_mutation_core` (row lock `FOR UPDATE` on `inventory`, resolve `inventory_id`, balance update, negative-stock guard `INSUFFICIENT_STOCK`, immutable ledger insert into `stock_movements`, cost snapshot into `stock_movement_costs`, OCC `version` increment) in `supabase/migrations/20261111000017_inventory_stock_management.sql`
- [X] T010 Implement Layer 2 public wrapper `public.execute_stock_movement` with the corrected execution order: (1) auth.uid() guard → (2) active org → (3) active membership → (4) movement type scope boundary (reject `sale`/`return` with `INVALID_MOVEMENT_TYPE`) → (5) RBAC permission check → (6) explicit PL/pgSQL quantity-semantics validation (`IF ... RAISE EXCEPTION USING ERRCODE='P0033', MESSAGE='INVALID_QUANTITY_SEMANTICS'`) → (7) canonical payload hash → (8) advisory lock `pg_advisory_xact_lock` → (9) idempotency replay check (both `stock_movements` and `zero_delta_stocktakes`) — return cached result immediately if matched → FOR NEW MUTATIONS ONLY: (10) acquire product `FOR SHARE` lock → (11) apply immediate lifecycle restrictions: block `initial`/`restock`/`internal_use` for archived products (`PRODUCT_ARCHIVED_STOCK_FORBIDDEN`), block `restock`/`internal_use` for inactive products (`PRODUCT_INACTIVE_RESTOCK_BLOCKED` / `PRODUCT_INACTIVE_INTERNAL_USE_BLOCKED`) → (12) acquire inventory `FOR UPDATE` lock → (13) calculate actual signed delta (for `target_physical_count`: delta = target − current_stock; for `quantity_delta`: delta = p_quantity) → (14) apply archived-product calculated-delta restriction: reject positive deltas (`PRODUCT_ARCHIVED_STOCK_FORBIDDEN`), permit negative-delta write-offs and zero-delta stocktakes → (15) handle zero-delta persistence in `zero_delta_stocktakes` without ledger insert → (16) delegate valid non-zero mutations to Layer 1 in `supabase/migrations/20261111000017_inventory_stock_management.sql`
- [X] T011 [P] Implement `public.update_inventory_thresholds` RPC (OCC `expected_version` check, `reorder_point` and `reorder_quantity` update) in `supabase/migrations/20261111000017_inventory_stock_management.sql`
- [X] T012 Add parameter-qualified `DROP FUNCTION IF EXISTS` for all legacy overloads, then exact-signature `GRANT`/`REVOKE` for `execute_stock_movement`, `_execute_inventory_mutation_core`, and `update_inventory_thresholds` in `supabase/migrations/20261111000017_inventory_stock_management.sql`

### 2C — Apply & Verify Migration

- [X] T013 Apply migration against the **local development Supabase database only** (`npx supabase migration up` — do NOT apply to any linked, staging, or production database without separate explicit authorization) and run Phase 1 & 2 database verification checks: negative-stock prevention, tripartite FK deferral, anchor provisioning trigger, RLS access denial, semantics validation (`P0033`), zero-delta stocktake persistence, archived adjustment delta evaluation (negative-delta write-off permitted, positive-delta rejected), OCC `STALE_VERSION_CONFLICT`

**Checkpoint**: Database foundation complete — server action and UI work can now begin.

---

## Phase 3: Server Actions & Zod Validations

**Purpose**: Application-layer foundation — Zod schemas, canonical hashing, formatters, and all 6 server actions. Blocks UI phases.

- [X] T014 Create `src/lib/validations/inventory.ts` with all 4 Zod schemas: `stockMovementInputSchema` (movement type, quantity bounds 0.0001–999999999.9999, semantics enum, reason max 500 chars, UOM integer check for `restock`/`initial`), `inventoryThresholdInputSchema` (non-negative reorder point/quantity, expected_version), `inventoryQuerySchema` (pagination, sort, stock status, lifecycle, search, include_archived), `movementHistoryQuerySchema` (product_id filter, movement type, date range, pagination)
- [X] T015 [P] Create `src/lib/inventory/canonical-hash.ts` with deterministic lexicographical JSON serialization (`canonical_quantity, movement_type, organization_id, product_id, quantity_semantics, reason, reference_id` key order) and SHA-256 digest matching the 3 regression fixtures: Fixture 1 `822dbc78...` (stocktake target count), Fixture 2 `7e2b1129...` (adjustment delta), Fixture 3 `596a7609...` (quotes & backslashes)
- [X] T016 [P] Create `src/lib/inventory/formatters.ts` with UOM display helpers, `NUMERIC(14,4)` precision formatters, currency formatters, and stock status display utilities
- [X] T017 Create `src/actions/inventory-actions.ts` with all 6 server actions: `getInventoryOverviewAction` (metric aggregation; computes combined valuation permission server-side — includes Total Valuation only when caller holds BOTH `inventory:read_valuation` AND `products:read_cost`; never returns cost data on `inventory:read_valuation` alone), `getInventoryListAction` (paginated, filtered, sortable, `include_archived`), `getInventoryProductAction` (single product inventory for summary card; resolves combined valuation permission server-side), `recordStockMovementAction` (canonical hash construction, RPC call, `revalidatePath`), `updateInventoryThresholdsAction` (OCC versioning, `revalidatePath`), `getMovementHistoryAction` (filtered audit ledger; computes combined valuation permission server-side — returns acquisition-cost fields only when caller holds BOTH `inventory:read_valuation` AND `products:read_cost`; never returns cost data on either permission alone)

**Checkpoint**: Server action layer complete — UI phases can begin in parallel.

---

## Phase 4: User Story 1 — View Inventory Overview & Stock Balances (Priority: P1) 🎯 MVP

**Goal**: Paginated inventory table with metric tiles (Total Products, In-Stock, Low-Stock, Out-of-Stock, Total Valuation), multi-filter controls, deterministic stock status priority sort, and valuation protection for Cashier role.

**Independent Test**: Navigate to `/[slug]/inventory`; verify metric tiles render, table paginates, low-stock badge appears, Cashier sees no valuation tile, archived products hidden by default.

### Implementation for User Story 1

- [ ] T018 [US1] Create `src/app/[slug]/inventory/page.tsx` (RSC layout; calls `getInventoryOverviewAction` and `getInventoryListAction`; composes metric tiles + filter bar + inventory table; resolves combined valuation permission server-side — passes `canViewValuation` boolean prop (true only when caller holds BOTH `inventory:read_valuation` AND `products:read_cost`) to metric tiles; UI visibility derives from server-computed flag, not from client-side permission checks)
- [ ] T019 [P] [US1] Create `src/app/[slug]/inventory/loading.tsx` (skeleton states for metric tiles and table rows)
- [ ] T020 [P] [US1] Create `src/components/inventory/inventory-metrics-tiles.tsx` (4 metric cards: Total Products, In-Stock count, Low-Stock count, Out-of-Stock count; conditionally renders Total Valuation tile only when `canViewValuation` prop is true — this prop is a server-computed boolean requiring BOTH `inventory:read_valuation` AND `products:read_cost`; component never re-evaluates permissions independently; uses `recharts` sparkline for valuation trend)
- [ ] T021 [P] [US1] Create `src/components/inventory/inventory-filters.tsx` (search input, category dropdown, stock status dropdown, lifecycle status dropdown, `Include Archived` toggle; emits filter state via URL search params)
- [ ] T022 [US1] Create `src/components/inventory/inventory-table.tsx` (paginated, sortable inventory table; stock status badges `In Stock` / `Low Stock` / `Out of Stock` / `[Archived]`; deterministic priority sort: `out_of_stock=1`, `low_stock=2`, `in_stock=3`; reorder alert row highlight; action column for mutation triggers)

**Checkpoint**: US1 fully functional. Inventory overview is independently verifiable.

---

## Phase 5: User Story 2 — Receive Stock / Restock Inventory (Priority: P1)

**Goal**: Authorized store managers can submit inbound deliveries via `restock-modal`, blocked on inactive/archived products; UOM integer enforcement for applicable products.

**Independent Test**: Open restock modal on an in-stock product; submit a valid quantity; verify stock balance increments and a `restock` movement appears in history.

### Implementation for User Story 2

- [ ] T023 [US2] Create `src/components/inventory/restock-modal.tsx` (react-hook-form + `stockMovementInputSchema` for `restock` movement type; quantity field with UOM integer enforcement; supplier reference and reason fields; calls `recordStockMovementAction`; toast confirmation on success; blocks on `PRODUCT_INACTIVE_RESTOCK_BLOCKED` / `PRODUCT_ARCHIVED_STOCK_FORBIDDEN` server errors; requires `inventory:receive` permission)
- [ ] T024 [US2] Wire `restock-modal` trigger button into `inventory-table.tsx` action column (visible only when `inventory:receive` permission present; passes `productId`, `currentVersion`, `currentStock`, `uomClass` props)

**Checkpoint**: US2 fully functional. Restock flow independently verifiable.

---

## Phase 6: User Story 3 — Record Initial Opening Stock (Priority: P2)

**Goal**: Managers can record a one-time opening stock balance for a product that has never had a stock movement; singularity constraint prevents duplicate initial entries.

**Independent Test**: Submit initial stock on a zero-balance product; verify balance set; attempt a second initial stock submission; verify rejection.

### Implementation for User Story 3

- [ ] T025 [US3] Add `initial` movement type mode to `restock-modal.tsx` (conditional UI label "Opening Stock" vs "Restock"; quantity field with same UOM integer enforcement; `movement_type = 'initial'` payload; calls `recordStockMovementAction`; surfaces `INITIAL_STOCK_ALREADY_RECORDED` error from `uq_stock_movements_initial_per_product` unique violation; button available only when `inventory:receive` and current stock is 0 with no prior `initial` movement)

**Checkpoint**: US3 fully functional. Initial stock singularity independently verifiable.

---

## Phase 7: User Story 4 — Perform Controlled Stock Adjustments & Stocktake (Priority: P2)

**Goal**: Managers can record authorized write-offs (damage, loss, internal use) and perform cycle-count stocktake reconciliation. Zero-delta stocktakes are idempotently confirmed without ledger entries.

**Independent Test**: Submit a damage write-off; verify negative delta; perform stocktake with target equal to current stock (zero-delta); verify no ledger row but replay returns `matched_quantity`; reactivate inactive product then record internal use.

### Implementation for User Story 4

- [ ] T026 [P] [US4] Create `src/components/inventory/adjust-stock-modal.tsx` (movement type selector: `damage` / `loss` / `internal_use` / `adjustment` delta mode; reason field required; `quantity_semantics: 'quantity_delta'` for all modes; surfaces `PRODUCT_INACTIVE_INTERNAL_USE_BLOCKED` (HTTP 422) for `internal_use` on inactive products; surfaces `INSUFFICIENT_STOCK` on over-deduction; requires `inventory:adjust` permission)
- [ ] T027 [P] [US4] Create `src/components/inventory/stocktake-modal.tsx` (physical count input with live difference preview `target - current`; `movement_type: 'adjustment'`, `quantity_semantics: 'target_physical_count'`; calls `recordStockMovementAction`; handles `status: 'matched'` zero-delta response displaying `matched_quantity` and `current_stock`; requires `inventory:adjust` permission)
- [ ] T028 [US4] Create `src/app/[slug]/inventory/stocktake/page.tsx` (cycle-count workflow page; lists all products with current stock; embeds `stocktake-modal` trigger per row; accessible via inventory dashboard action)
- [ ] T029 [P] [US4] Create `src/components/inventory/reorder-threshold-modal.tsx` (reorder point and replenishment quantity inputs; non-negative validation; passes `expected_version` for OCC; calls `updateInventoryThresholdsAction`; surfaces `STALE_VERSION_CONFLICT` on concurrent update; requires `inventory:adjust` permission)
- [ ] T030 [US4] Wire adjustment and stocktake modal trigger buttons into `inventory-table.tsx` action column (visible only when `inventory:adjust` permission present)

**Checkpoint**: US4 fully functional. All adjustment and stocktake flows independently verifiable.

---

## Phase 8: User Story 5 — Audit Stock Movement History (Priority: P3)

**Goal**: Authorized staff can view a chronological, filterable movement history ledger. Acquisition cost columns are protected — Cashiers see masked/omitted costs; Managers see full snapshots.

**Independent Test**: Navigate to `/[slug]/inventory/history`; verify movements appear in reverse chronological order; apply product and date filters; verify Cashier session omits cost columns.

### Implementation for User Story 5

- [ ] T031 [US5] Create `src/app/[slug]/inventory/history/page.tsx` (RSC; calls `getMovementHistoryAction` with query params; composes `movement-history-table` with filter controls; requires `inventory:history` permission; computes combined valuation permission server-side — passes `canViewValuation` boolean (true only when caller holds BOTH `inventory:read_valuation` AND `products:read_cost`) to the history table; `getMovementHistoryAction` strips acquisition-cost fields from the response payload when `canViewValuation` is false, so cost data never reaches the client for unauthorized callers)
- [ ] T032 [US5] Create `src/components/inventory/movement-history-table.tsx` (filterable ledger table: product name, movement type badge, quantity delta with sign, reason, reference, performed by, timestamp; unit cost and total cost columns rendered only when `canViewValuation` prop is true — this is a server-computed boolean requiring BOTH `inventory:read_valuation` AND `products:read_cost`; component never re-evaluates permissions; because `getMovementHistoryAction` already strips cost fields server-side, absence of data is the primary guard — UI visibility is a secondary UX concern only; pagination and date-range filter controls)

**Checkpoint**: US5 fully functional. History ledger and valuation protection independently verifiable.

---

## Phase 9: User Story 6 — Configure Reorder Points & Low-Stock Alerts (Priority: P3)

**Goal**: Managers can configure per-product reorder thresholds. Low-stock badges display dynamically in the inventory table when on-hand stock falls at or below the reorder point.

**Independent Test**: Set a reorder point higher than current stock; verify the product shows `Low Stock` badge in the inventory table; verify metric tile count increments.

### Implementation for User Story 6

- [ ] T033 [US6] Wire `reorder-threshold-modal` trigger into `inventory-table.tsx` action column (visible when `inventory:adjust` present; pre-fills current `reorder_point`, `reorder_quantity`, and `version`)
- [ ] T034 [US6] Add low-stock badge logic to `inventory-table.tsx` (badge renders when `quantity > 0 AND quantity <= reorder_point`; `Out of Stock` badge when `quantity = 0`; badge tooltip shows configured reorder threshold value)

**Checkpoint**: US6 fully functional. Threshold configuration and badge display independently verifiable.

---

## Phase 10: Product Details Integration

**Purpose**: Embedded inventory summary card on the existing product details page (Feature 003 route).

- [ ] T035 Create `src/app/[slug]/products/[productId]/components/inventory-summary-card.tsx` (embedded card showing current stock, stock status badge, reorder threshold, last movement date; calls `getInventoryProductAction`; gracefully omits when caller lacks `inventory:read`; conditionally shows valuation figures only when `canViewValuation` is true — server-computed boolean requiring BOTH `inventory:read_valuation` AND `products:read_cost`; `getInventoryProductAction` strips cost fields from the response before serialization when combined permission is absent)

---

## Phase 11: Automated Test Suite

**Purpose**: Vitest unit and integration tests plus Playwright E2E — grouped as a final verification suite per plan.md Phase 7.

> Tests are **explicitly required** by the Feature 004 specification.

### Unit Tests

- [ ] T036 [P] Create `tests/unit/validations/inventory.test.ts` (Vitest; tests for all 4 Zod schemas: quantity bounds 0.0001 and 999,999,999.9999, integer enforcement, `movement_type` enum exhaustiveness, `quantity_semantics` enum, reason length 500 chars, `expected_version` non-negative)
- [ ] T037 [P] Create `tests/unit/inventory/canonical-hash.test.ts` (Vitest; exact SHA-256 regression assertions: Fixture 1 `822dbc7818bb44882daff5f29396366a9d5f9eb571938eb36fd60270a5f108a6` stocktake target count, Fixture 2 `7e2b11299620db0e9531afe7b999c1d1096b39b7f860d67be5efc531eed9f707` adjustment delta, Fixture 3 `596a760972b11657cebb84a84a5b4541252b3f5c1d1d781a00c4686aeb7c0a3f` quotes & backslashes; verify key ordering is strictly lexicographical)

### Integration Tests

- [ ] T038 [P] Create `tests/integration/inventory/execute-stock-movement.test.ts` (Vitest against local Supabase; covers restock, initial singularity violation, damage write-off, `INSUFFICIENT_STOCK`, `PRODUCT_ARCHIVED_STOCK_FORBIDDEN` for positive delta on archived, negative-delta write-off on archived permitted, `PRODUCT_INACTIVE_RESTOCK_BLOCKED`, `PRODUCT_INACTIVE_INTERNAL_USE_BLOCKED`, `INVALID_QUANTITY_SEMANTICS` P0033, `INVALID_MOVEMENT_TYPE` for `sale`/`return`, `STALE_VERSION_CONFLICT` P0027)
- [ ] T047 [P] Create `tests/integration/inventory/security.test.ts` (Vitest against local Supabase; verifies database-enforced behavior — not merely UI visibility: (1) cross-organization inventory access denial: authenticated user from org A cannot read or mutate org B inventory rows via RLS; (2) inactive/revoked membership rejection: user with `status != 'active'` in `organization_memberships` receives auth error from `execute_stock_movement`; (3) missing `inventory:receive` permission: role without `inventory:receive` cannot call `execute_stock_movement` with `movement_type = 'restock'`; (4) missing `inventory:adjust` permission: role without `inventory:adjust` cannot call `execute_stock_movement` with `movement_type = 'adjustment'`; (5) direct execution denial for `public._execute_inventory_mutation_core(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, TEXT, UUID, INTEGER)` — exact signature from approved RPC contract: confirm that the `anon` role and the `authenticated` role each receive `permission denied` when attempting to call Layer 1 directly; do NOT use `SET ROLE public` or treat PUBLIC as an ordinary database role — instead query `pg_proc` using `aclexplode(proacl)` to assert that grantee OID 0 (the PUBLIC pseudo-role) holds no EXECUTE privilege on this exact function signature; separately confirm that the function owner retains EXECUTE privilege so the `SECURITY DEFINER` Layer 2 wrapper (`execute_stock_movement`) can invoke Layer 1 without privilege errors; (6) exact-signature GRANT/REVOKE verification: confirm `public.execute_stock_movement(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, INTEGER, TEXT)` is callable by the `authenticated` role and denied to `anon`; confirm `public.update_inventory_thresholds(UUID, UUID, NUMERIC, NUMERIC, INTEGER)` follows the same grant pattern; use `aclexplode(proacl)` on `pg_proc` to assert the ACL entries, not runtime `SET ROLE` calls)
- [ ] T039 [P] Create `tests/integration/inventory/idempotency.test.ts` (Vitest; covers normal movement replay, zero-delta stocktake replay returning `matched_quantity` + live `current_stock`, `IDEMPOTENCY_CONFLICT` on reused key with differing payload, concurrent concurrent advisory lock serialization, replay after product archival)
- [ ] T040 [P] Create `tests/integration/inventory/cost-isolation.test.ts` (Vitest; verifies `stock_movement_costs` RLS: Cashier session returns 0 rows; Manager with `inventory:read_valuation` + `products:read_cost` returns full cost snapshot; Manager missing either permission returns 0 rows)

### End-to-End Tests

- [ ] T041 Create `tests/e2e/inventory-workflow.spec.ts` (Playwright; full retail walkthroughs: (1) restock flow end-to-end with toast confirmation, (2) stocktake zero-delta confirmation UI, (3) damage write-off with balance update, (4) movement history with Cashier cost omission, (5) reorder threshold configuration with low-stock badge appearance)

---

## Phase 12: Polish & Cross-Cutting Verification

**Purpose**: Final integration checks and manual sign-off against the quickstart guide and requirement traceability matrix.

- [ ] T042 [P] Run quickstart.md verification steps: apply migration, verify anchor provisioning, verify RLS denials, verify stored procedure error codes against `quickstart.md` test script
- [ ] T043 Run `npm run test:unit && npm run test:integration` and confirm all Vitest suites pass
- [ ] T044 Run `npm run test:e2e` and confirm all Playwright workflows pass
- [ ] T045 Verify all 30 functional requirements (`FR-INV-001` through `FR-INV-030`) are covered in the requirement traceability matrix and have passing test evidence
- [ ] T046 [P] Verify performance benchmarks: DB mutation RPC p95 < 100 ms, Server Actions p95 < 350 ms, UI confirmation p95 < 500 ms

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup) ──────────────────────────────────────────────► No dependencies — start immediately
Phase 2 (DB Foundation) ──────────────────────────────────────► Depends on Phase 1 ⚠️ BLOCKS ALL
Phase 3 (Server Actions) ─────────────────────────────────────► Depends on Phase 2 completion
Phase 4–10 (User Stories + Integration) ──────────────────────► Depend on Phase 3 completion
Phase 11 (Automated Tests) ───────────────────────────────────► Depend on Phases 1–10
Phase 12 (Polish & Verification) ─────────────────────────────► Depends on Phase 11
```

### User Story Independence

| Story | Priority | Can Start After | Integration Points |
|---|:---:|---|---|
| US1 — Inventory Overview | P1 🎯 | Phase 3 | None |
| US2 — Restock | P1 | Phase 3 | Extends US1 table action column |
| US3 — Initial Stock | P2 | Phase 3 | Extends restock-modal |
| US4 — Adjustments & Stocktake | P2 | Phase 3 | Extends US1 table action column |
| US5 — Movement History | P3 | Phase 3 | Independent route |
| US6 — Reorder Thresholds | P3 | Phase 3 | Extends US1 table badge logic |

### Within-Phase Parallelism

- **Phase 2**: T007, T008 parallelizable with T003–T006; T011 parallelizable with T009–T010; T012 always last
- **Phase 3**: T015, T016 parallelizable with T014; T017 depends on T014–T016
- **Phase 4**: T019, T020, T021 parallelizable with T018; T022 depends on T018
- **Phase 5**: T023 parallelizable with T024; T024 depends on T022 (table)
- **Phase 7**: T026, T027, T029 parallelizable; T028 depends on T027; T030 depends on T022 (table)
- **Phase 11**: T036, T037, T038, T039, T040, T047 all fully parallelizable

---

## MVP Delivery Strategy

### MVP (P1 Stories Only)

1. ✅ Complete Phase 1: Setup
2. ✅ Complete Phase 2: DB Foundation (migration applied and verified)
3. ✅ Complete Phase 3: Server Actions
4. ✅ Complete Phase 4: US1 — Inventory Overview
5. ✅ Complete Phase 5: US2 — Restock
6. **STOP and VALIDATE**: Both P1 stories functional end-to-end
7. Demo / Deploy

### Incremental Delivery Beyond MVP

8. Phase 6: US3 — Initial Stock → validate independently
9. Phase 7: US4 — Adjustments & Stocktake → validate independently
10. Phase 8: US5 — History Ledger → validate independently
11. Phase 9: US6 — Reorder Alerts → validate independently
12. Phase 10: Product Details Card
13. Phase 11: Automated Test Suite
14. Phase 12: Final Polish & Sign-off

---

## Notes

- `[P]` tasks operate on different files with no incomplete dependencies — safe to execute concurrently
- `[US1]`–`[US6]` story labels appear only in user story phases (Phases 4–9)
- Tests are grouped in Phase 11, not per-story, per the Feature 004 plan
- The constitution's non-negotiable rules govern all code: RLS on every table, atomic financial operations, TypeScript strict no-`any`, server-side RBAC, AI guardrails
- The governing plan is `specs/004-inventory-stock-management/plan.md`
- Do not begin any implementation until the migration in T013 is verified

