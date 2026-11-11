# BizFlow AI — Feature 004 Phase 5
## Final Closure Audit Report
### Four-Point Consistency Verification

**Auditor role:** Independent Principal Engineer, PostgreSQL/Supabase Security Auditor, Senior Next.js Engineer, QA Architect  
**Branch:** `004-inventory-stock-management`  
**Scope:** Read-only audit of T023/T024 — no source-code changes unless a concrete defect is demonstrated  
**Date:** 2026-11-11  
**Verdict:** ✅ PHASE 5 CLOSED

---

## Check 1 — Idempotency Recovery Boundary

### Source: `src/lib/inventory/restock-storage.ts` (lines 1–77)

| Attribute | Actual Value |
|---|---|
| Storage type | `window.sessionStorage` |
| Storage key | `bizflow_restock_pending_${slug}_${productId}` (line 23) |
| TTL constant | `MAX_PENDING_AGE_MS = 30 * 60 * 1000` (30 minutes, line 20) |
| TTL enforcement | `savePendingRestock` writes `savedAt: Date.now()` (line 44); `loadPendingRestock` discards entries where `Date.now() - saved.savedAt > MAX_PENDING_AGE_MS` (lines 59–62) |

### Source: `src/components/inventory/restock-modal.tsx` (lines 103–125, 209–218, 262–276)

**Recovery detection (lines 103–125):**  
`useEffect` fires when `isOpen` transitions to `true`. Calls `loadPendingRestock(slug, productId)`. If a non-expired pending session exists, sets `hasPendingRestock = true` and pre-fills the form. The form is populated with the previously saved quantity, reason, and referenceId.

**Payload-change detection (lines 209–218):**  
Before saving a new pending session, `handleSubmit` compares:
- `quantity === rawNum`  
- `reason.trim() === data.reason.trim()`  
- `referenceId` equality

If ANY field differs → `clearPendingRestock(slug, productId)` + `crypto.randomUUID()` generates a new idempotency key. The previous key is not reused.

**Cleanup on success (line 276):**  
`clearPendingRestock(slug, productId)` is called in the success branch, removing the pending session before the modal closes.

**Cleanup on fatal client errors (lines 262–268):**  
Called for `FORBIDDEN`, `PRODUCT_ARCHIVED_STOCK_FORBIDDEN`, `PRODUCT_INACTIVE_RESTOCK_BLOCKED`, `INTEGER_QUANTITY_REQUIRED`. These are non-retryable conditions; retrying with the same payload would always fail.

**Network error behaviour (catch block):**  
Pending session is intentionally **preserved** to allow automatic retry on the next open.

### Findings

**F1-A — Tab-close behaviour (by browser spec, not a defect):**  
`sessionStorage` is a tab-scoped, session-scoped store (HTML Living Standard §12.2.4). It is cleared by the browser when the tab or session is closed. Recovery does **not** survive a tab close. This is an intentional design decision: the idempotency key lives in `sessionStorage` specifically to avoid stale keys persisting across browser sessions. If the tab closes after a network error, the user restarts with a fresh key on next open.

**F1-B — `savePendingRestock` called before Zod validation (lines 221–246):**  
`savePendingRestock` is called at lines 221–231, before the Zod `.safeParse()` at lines 246–252. If Zod validation subsequently fails (e.g., reason too short), the session is saved with an unsubmitted payload.

**Assessment:** This is **not a defect**. If the user reopens the modal, `loadPendingRestock` pre-fills the form with the saved values. When the user next submits (after fixing the validation error), the submit handler compares the payload against the stored values. If the payload is the same, the same idempotency key is reused (correct — same intent). If the user changes the payload, the key is rotated. In neither case can the stored key be incorrectly reused for a different successful mutation. No corrective action is needed.

**Check 1 verdict: ✅ PASS — Idempotency recovery boundaries are correct and consistent with spec.**

---

## Check 2 — Database Lock Ordering

### Layer 1: `_execute_inventory_mutation_core`

**Migration 17 (original definition, lines 332–336):**
```sql
-- 1. Row Lock & Inventory ID Resolution
SELECT id, quantity, version INTO v_inventory_id, v_current_qty, v_current_version
FROM public.inventory
WHERE organization_id = p_org_id AND product_id = p_product_id
FOR UPDATE;
```

Migration 17's Layer 1 acquires **only the `inventory` row lock (`FOR UPDATE`)**. It does **not** lock the `products` row. No `products FOR SHARE` lock is taken inside Layer 1 in migration 17.

**Migration 18 (replacement definition):**  
Migration 18's `_execute_inventory_mutation_core` adds `products FOR SHARE` before `inventory FOR UPDATE` within Layer 1 as well, formalising the hierarchy at that level too.

### Layer 2: `execute_stock_movement`

**Migration 17 (lines 598–627):**
```sql
-- Step 10: Acquire Product Row Lock (FOR SHARE)
SELECT status INTO v_prod_status
FROM public.products
WHERE id = p_product_id AND organization_id = p_org_id
FOR SHARE;
...
-- Step 12: Acquire Inventory Row Lock (FOR UPDATE)
SELECT id, quantity INTO v_inventory_id, v_current_stock
FROM public.inventory
WHERE organization_id = p_org_id AND product_id = p_product_id
FOR UPDATE;
```

Migration 17's Layer 2 already enforces `products FOR SHARE → inventory FOR UPDATE` ordering. The lock hierarchy was established at Layer 2 in migration 17.

### Analysis of the Combined Lock Hierarchy

The effective transaction lock order at the time migration 17 was the active schema:

| Layer | products | inventory | Order |
|---|:---:|:---:|---|
| Layer 2 (`execute_stock_movement`) | `FOR SHARE` (Step 10) | `FOR UPDATE` (Step 12) | ✅ products → inventory |
| Layer 1 (`_execute_inventory_mutation_core`, called from L2) | *(none)* | `FOR UPDATE` | — inventory only |

Layer 1 in migration 17 did **not** lock `products` at all; it locked only `inventory`. Layer 2 locked `products FOR SHARE` **before** calling Layer 1. Since `products FOR SHARE` and `inventory FOR UPDATE` are always acquired in that fixed sequence within any single call chain, deadlock cannot occur between two concurrent calls that both follow the Layer 2 path.

However, the previous audit report stated that **Layer 1 itself enforced the `products → inventory` lock hierarchy**. This was inaccurate for migration 17: Layer 1 in migration 17 did not hold a `products` lock at all. The deadlock-prevention guarantee in migration 17 rested entirely on Layer 2's sequential lock ordering. Migration 18 upgraded Layer 1 to also acquire `products FOR SHARE`, making the guarantee stronger (Layer 1 can safely be called directly by trusted internal callers, such as Feature 005, without risk of a lock-order inversion).

> [!IMPORTANT]
> **Report wording correction required (Section 8.2 of `phase-5-implementation-review.md`):**  
> Any statement claiming that Layer 1 in migration 17 "established" or "enforced" the `products → inventory` lock hierarchy is inaccurate. Migration 17's Layer 1 locked only `inventory FOR UPDATE`. The deadlock-prevention guarantee existed at Layer 2, not Layer 1. Migration 18 extended the hierarchy to Layer 1 as a forward-compatibility improvement for direct Layer 1 callers (Feature 005). No locking code change is needed; this is a report-wording correction only.

### No other mutation paths identified

A search across both migrations finds no other path that acquires the `products` and `inventory` locks in reverse order (inventory first, then products). The `update_inventory_thresholds` function (migration 17 lines ~749, migration 18 equivalent) locks only `inventory FOR UPDATE` with no `products` lock. No ABBA inversion is possible from that path.

**Check 2 verdict: ✅ PASS with one report wording correction (see §8.2 note above). No code defect. The lock ordering prevents deadlocks under the documented execution model in both migrations.**

---

## Check 3 — Error Code Contract Consistency

### Codes under review: `P0015`, `P0016`, `P0028`

#### `contracts/database-rpcs.md` — Section 6, Error Code Catalog (lines 511–543)

| Code | Error Name | SQLSTATE | HTTP | Contract Status |
|---|---|:---:|:---:|---|
| `P0015` | `INTEGER_QUANTITY_REQUIRED` | `P0015` | 422 | ✅ **Documented** (line 524) |
| `P0016` | `DECIMAL_PRECISION_EXCEEDED` | `P0016` | 422 | ✅ **Documented** (line 525) |
| `P0028` | `QUANTITY_EXCEEDS_MAXIMUM` | `P0028` | 422 | ✅ **Documented** (line 537) |

All three error codes are present and correctly described in the authoritative contract document.

#### `src/actions/inventory-actions.ts` — `KNOWN_INVENTORY_ERRORS` map (lines 41–69)

| Code | Server-action mapping | Message |
|---|---|---|
| `P0015` | `INTEGER_QUANTITY_REQUIRED` | "Fractional quantities are not permitted for discrete products." (line 51) |
| `P0016` | `DECIMAL_PRECISION_EXCEEDED` | "Quantity cannot exceed 4 decimal places." (line 52) |
| `P0028` | `QUANTITY_EXCEEDS_MAXIMUM` | "Quantity exceeds maximum allowable system limit." (line 64) |

All three codes are present in `KNOWN_INVENTORY_ERRORS`. They are caught by the standard `mapDatabaseError` function (lines 71–89) which does an O(1) lookup by SQLSTATE code.

#### `P0025` naming discrepancy — noted finding

The contract document (line 534) names this error `INITIAL_STOCK_ALREADY_ESTABLISHED`, but the server-action maps it as `INITIAL_STOCK_ALREADY_RECORDED` (line 61). The server-action also includes a unique-constraint fallback (lines 76–78): when the PostgreSQL `23505` unique-violation on `uq_stock_movements_initial_per_product` fires, it is mapped to `INITIAL_STOCK_ALREADY_RECORDED` (using the `P0025` definition). This discrepancy between the contract name `ALREADY_ESTABLISHED` and the implementation name `ALREADY_RECORDED` was first identified in the Phase 5 implementation report and was noted as a documentation alignment issue. It does not affect runtime correctness because the SQLSTATE `P0025` lookup finds the correct entry regardless of the display name.

**No new gap identified.** The three codes under review are consistent across contract, SQL migration, and server-action mapping.

**Check 3 verdict: ✅ PASS — `P0015`, `P0016`, `P0028` are fully documented in the contract and correctly mapped in the server action. No documentation update is needed for these three codes.**

---

## Check 4 — Phase 6 Readiness

### Source: `specs/004-inventory-stock-management/tasks.md` (lines 1–271)

**Phase 5 completion status:**
- T023 `[X]` — RestockModal component (line 91)
- T024 `[X]` — InventoryTable integration (line 92)
- Phase 5 checkpoint: *"US2 fully functional. Restock flow independently verifiable."* (line 94)
- No outstanding Phase 5 checklist items.

**Next incomplete task:**

```
Task ID:   T025
Phase:     Phase 6 — User Story 3: Record Initial Opening Stock (Priority P2)
```

#### T025 Full Specification

| Attribute | Detail |
|---|---|
| **Task** | `[US3] Add 'initial' movement type mode to restock-modal.tsx` |
| **File to modify** | `src/components/inventory/restock-modal.tsx` |
| **UI change** | Conditional label "Opening Stock" (mode=`initial`) vs "Restock" (mode=`restock`) |
| **UOM enforcement** | Same discrete/fractional validation as T023 |
| **Payload** | `movement_type = 'initial'`, calls `recordStockMovementAction` |
| **Error to surface** | `INITIAL_STOCK_ALREADY_RECORDED` (from `uq_stock_movements_initial_per_product` unique violation or `P0025` RPC error) |
| **Button availability** | Visible only when: caller has `inventory:receive` AND current stock is 0 AND no prior `initial` movement exists |
| **Dependencies** | T022 (complete ✅), T023 (complete ✅), T024 (complete ✅), Phase 3 (complete ✅) |

**Phase 6 prerequisite check:**
- Phase 3 complete ✅
- T023 base modal complete ✅
- T024 table integration complete ✅

All T025 dependencies are satisfied. Phase 6 may begin immediately.

**Check 4 verdict: ✅ PASS — Phase 5 is fully closed. T025 (Phase 6) is the exact next task. All its dependencies are met.**

---

## Summary of All Findings

| Check | Finding | Status | Action Required |
|---|---|:---:|---|
| C1 — Idempotency recovery boundary | Storage key, TTL, payload comparison, cleanup all correct. Tab-close is intentional (sessionStorage). Pre-Zod-save is benign. | ✅ PASS | None |
| C2 — Database lock ordering | L2 enforced `products → inventory` order in migration 17. L1 did not lock products in migration 17 (added in migration 18). No ABBA inversion possible in any path. | ✅ PASS | Correct Section 8.2 wording in phase-5-implementation-review.md |
| C3 — Error-code contract consistency | P0015, P0016, P0028 documented in contract and correctly mapped in server action. P0025 name discrepancy noted (pre-existing finding). | ✅ PASS | None |
| C4 — Phase 6 readiness | T023 ✅, T024 ✅. Next task is T025. All dependencies satisfied. | ✅ PASS | None |

---

## Report Wording Correction — Section 8.2 of `phase-5-implementation-review.md`

The sentence in Section 8.2 that states Layer 1 established the `products → inventory` lock hierarchy should be corrected to accurately reflect that:

- **Migration 17 Layer 1** locked only `inventory FOR UPDATE` — no `products` lock.
- **Migration 17 Layer 2** established the `products FOR SHARE → inventory FOR UPDATE` ordering that prevents deadlocks.
- **Migration 18** extended this hierarchy to Layer 1 as well, making Layer 1 safe for direct invocation by future callers (Feature 005 POS integration).

This correction has been recorded in this closure report. No source-code or migration change is needed.

---

## Final Phase 5 Closure Verdict

**PHASE 5 — USER STORY 2: RECEIVE STOCK / RESTOCK INVENTORY — ✅ CLOSED**

- T023 (RestockModal): Complete, verified, audited.
- T024 (InventoryTable integration): Complete, verified, audited.
- All acceptance criteria met.
- All quality gates passed (typecheck, lint, 684 unit tests, 14 integration tests, build).
- Security audit: tenant isolation, RLS, server-side discrete UOM guard, fail-closed error handling — all verified.
- One pre-existing documentation naming discrepancy (P0025) carried forward from Phase 5 implementation report. No runtime impact.
- One report wording correction for Section 8.2 (lock hierarchy attribution). No code impact.

**Next task: T025 — Phase 6, User Story 3: Record Initial Opening Stock.**

