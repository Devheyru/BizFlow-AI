# Feature 002: Employee Management & Role-Based Access Control — Comprehensive Implementation Audit Report

**Date**: 2026-11-03  
**Auditor**: Antigravity Pair-Programming Agent (DeepMind)  
**Branch**: `002-employee-rbac`  
**Initial Implementation Commit**: `e4c130b5821ef2e2343f47f42c9724c4ac06a07c`  
**Final Remediation Commit**: `eca0b8f04814be8bab70baffad28e8f570435965`  
**Audit Reconciliation Commit**: `d85c7a26ba4cde5e583207363fdc65654b764008` (short SHA: `d85c7a2`)  
**Constitution**: BizFlow AI Constitution v1.1.0  
**Scope**: Full implementation audit across all 10 phases, database RPCs, RLS, Server Actions, UI components, unit tests, integration tests, and E2E workflow.

---

## 1. Executive Summary

This independent code audit evaluated the implementation of **Feature 002: Employee Management & Role-Based Access Control (RBAC)** in BizFlow AI against the project specification, plan, database contracts, server action contracts, and Constitution v1.1.0.

### Key Strengths
- **Database Architecture & PostgreSQL Security**: All 10 stored procedures (`SECURITY DEFINER`) are properly owned by `postgres`, have their `search_path` strictly locked to `pg_catalog, public, pg_temp`, have execution revoked from `PUBLIC` and `anon` by default (with `anon` granted exclusively to `validate_invitation_token` for anonymous pre-flight validation), grant execution to `authenticated` and `service_role`, and enforce robust authorization and input validation independent of client or Zod validation.
- **Strict Multi-Tenancy & RLS**: `FORCE ROW LEVEL SECURITY` is enabled and verified on `organization_invitations`, `permissions`, and `role_permissions`. Client-side direct mutations are denied (`42501`). Multi-tenant isolation is preserved: soft revocation in one organization has zero impact on active memberships in other organizations.
- **Centralized 4-Rule Permission Engine**: The permission engine (`hasPermission`) in TypeScript and `check_user_permission` in PostgreSQL are 100% synchronized and strictly bound to the catalog. Unknown or unregistered permission strings evaluate to `false` for all roles, including Owner.
- **Unit, Integration & E2E Test Coverage**: All 14 unit test files (151 tests) and 15 integration test files (170 tests) pass cleanly (321 automated Vitest tests). In addition, one Playwright end-to-end workflow test passed in Chromium (322 automated tests total across all suites). Zero regressions were introduced to Feature 001.

### Controlled Remediation Summary
All three original audit findings (F-01, F-02, F-03) and three additional database concerns (C-01, C-02, C-03) were fully resolved:
1. **F-01 [Resolved]**: Re-encoded `src/types/database.ts` as UTF-8 without BOM. `next lint` and `next build` pass with 0 errors.
2. **F-02 [Resolved]**: Aligned E2E selectors in `tests/e2e/employee-management.spec.ts` with actual UI headings and 404 Page Not Found / onboarding lockout behaviors. One Playwright end-to-end workflow test executed in Chromium and verified passing (33.6s).
3. **F-03 [Resolved]**: Corrected query parameters in `AcceptInvitationCard.tsx` to `?next=` and `?token=`; updated `signInAction` to preserve `redirectTo` when user has 0 active organizations.
4. **C-01 [Resolved]**: Resolved the revoked membership policy contradiction by implementing a controlled, audited rejoining flow via fresh invitations:
   - `create_organization_invitation()` allows inviting a previously revoked user (while rejecting active members with `P0021` and suspended members with `P0027`).
   - `accept_organization_invitation()` transitions an existing `revoked` membership to `status = 'active'`, updates `role = v_invite.role`, and records an immutable `employee.joined` audit event with rejoining metadata (`rejoined: true, previous_status: 'revoked'`).
   - Direct member modifications via `update_organization_member_role` and `update_organization_member_status` strictly retain terminal guard `P0025` ("Cannot modify a revoked membership. Revocation is terminal.").
   - Suspended memberships cannot be invited (`P0027`) and cannot accept invitations (`MEMBERSHIP_SUSPENDED`).
5. **C-02 [Resolved]**: Restricted `check_user_permission` so that direct authenticated invocations can only query `p_user_id = auth.uid()`, preventing unauthorized permission and role probing. Added 1 regression test.
6. **C-03 [Resolved]**: Replaced static fallback in `resolveTenantContext` with fail-closed (`forbidden`) behavior when database queries fail, and enforced strict array checking in `hasPermission`. Added 1 regression test.

**Current Audit Verdict**: **APPROVED** (See Section 16).

---

## 2. Repository and Commit Verification

| Check | Expected | Actual | Status |
|---|---|---|---|
| **Git Branch** | `002-employee-rbac` | `002-employee-rbac` | PASS |
| **Initial Implementation Commit** | Initial Feature 002 commit | `e4c130b5821ef2e2343f47f42c9724c4ac06a07c` | PASS |
| **Final Remediation Commit** | Audit remediation & policy alignment | `eca0b8f04814be8bab70baffad28e8f570435965` | PASS |
| **Audit Reconciliation Commit** | Audit report reconciliation | `d85c7a26ba4cde5e583207363fdc65654b764008` (short SHA: `d85c7a2`) | PASS |
| **Working Tree** | Clean | Clean | PASS |
| **Commit Scope** | Feature 002 only | Feature 002 RBAC and audit remediations | PASS |
| **Feature 001 Regression** | Zero breaking changes | Strictly backward-compatible additive changes | PASS |

*(Note: Verified in Git reflog/log that the audit reconciliation commit starting with `d85c7a2` has full SHA `d85c7a26ba4cde5e583207363fdc65654b764008`; the 40-character string `d85c7a216262b8a7c0f1c63391d4e0bcfdf26b77` is not a valid commit in the repository object database).*

### Modified Existing Files
- `src/components/layout/TenantHeader.tsx`: Added `<TenantNav slug={organization.slug} role={role} />`.
- `src/lib/auth/context.ts`: Added permission catalog evaluation to `resolveTenantContext` and exported alias `requireTenantContext`.
- `src/types/auth.ts`: Added `InvitationStatus`, `PermissionKey`, and `permissions: PermissionKey[]` to `TenantContext`.
- `src/types/database.ts`: Regenerated Supabase TypeScript types (initial audit UTF-16 BOM defect resolved in remediation commit via clean UTF-8 encoding).
- `specs/002-employee-rbac/tasks.md`: Marked tasks complete.

---

## 3. Phase-by-Phase Findings

### Phase 1: Setup and Prerequisites (`T001`–`T002`)
- **Status**: **PASS**
- **Findings**: `PermissionKey` union and `permissions` array were correctly added to `TenantContext`. Feature 001 authentication and tenant resolution remain intact.

### Phase 2: Database Schema and RLS (`T003`–`T007`)
- **Status**: **PASS**
- **Findings**:
  - `invitation_status` enum created with values `pending`, `accepted`, `declined`, `revoked`, `expired`.
  - `organization_invitations` table created with constraints:
    - Email syntax check: `email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'`
    - Lowercase normalized check: `email = lower(trim(email))`
    - Token hash format check: `token_hash ~ '^[a-f0-9]{64}$'`
    - Partial unique index: `uq_pending_invitation` on `(organization_id, email) WHERE status = 'pending'`
    - Unique token index: `uq_organization_invitations_token_hash` on `(token_hash)`
  - `permissions` catalog table and `role_permissions` join table created with primary keys and constraints.
  - `FORCE ROW LEVEL SECURITY` applied on `organization_invitations`, `permissions`, and `role_permissions`.
  - Direct client mutations explicitly denied via `WITH CHECK (false)` and `USING (false)`.

### Phase 3: Permission Catalog & Seeding (`T008`–`T009`)
- **Status**: **PASS**
- **Findings**: All 7 employee permissions seeded (`employees:read`, `employees:invite`, `employees:update_role`, `employees:suspend`, `employees:remove`, `employees:invitations_read`, `employees:invitations_revoke`). All 7 mapped to `admin`; `employees:read` mapped to `manager`; 0 mapped to `cashier`.

### Phase 4: Database Stored Procedures & Hardening (`T010`–`T020`)
- **Status**: **PASS**
- **Findings**:
  - All 10 functions implemented in `supabase/migrations/20261103000009_employee_management_rbac.sql`:
    1. `create_organization_invitation` (SECURITY DEFINER)
    2. `validate_invitation_token` (SECURITY DEFINER, STABLE)
    3. `accept_organization_invitation` (SECURITY DEFINER)
    4. `decline_organization_invitation` (SECURITY DEFINER)
    5. `resend_organization_invitation` (SECURITY DEFINER)
    6. `revoke_organization_invitation` (SECURITY DEFINER)
    7. `update_organization_member_role` (SECURITY DEFINER)
    8. `update_organization_member_status` (SECURITY DEFINER)
    9. `get_organization_employees` (SECURITY DEFINER, STABLE)
    10. `check_user_permission` (SECURITY DEFINER, STABLE)
  - Ownership set to `postgres`. Search path locked to `pg_catalog, public, pg_temp`.
  - Default execution privileges were revoked from `PUBLIC`. Execution privileges for `anon` were revoked by default on all functions, with an explicit `EXECUTE` grant given to `anon` exclusively on `validate_invitation_token` to permit unauthenticated pre-flight token validation without data disclosure. All 10 functions grant `EXECUTE` to `authenticated` and `service_role`.
  - Verified with 14 automated tests in `tests/integration/database-security.test.ts`.

### Phase 5: Permission Engine and Tenant Context (`T021`–`T022`, `T046`–`T047`)
- **Status**: **PASS**
- **Findings**:
  - `SYSTEM_PERMISSIONS` and `ROLE_PERMISSIONS` defined in `src/lib/auth/permissions.ts`.
  - `hasPermission` enforces the 4-rule engine. Unknown permission keys are rejected for all roles (including Owner).
  - `resolveTenantContext` populates `context.permissions` dynamically.
  - Bidirectional catalog consistency verified via `tests/integration/permissions-catalog.test.ts`.

### Phase 6: Server Actions and Validation (`T023`–`T036`, `T048`–`T049`)
- **Status**: **PASS**
- **Findings**:
  - Zod schemas in `employee.ts` and `invitation.ts` validate inputs.
  - All actions verify authentication, active tenant membership, and permissions server-side.
  - Organization ID cannot be tampered with (derived from server-resolved `context.organization.id`).
  - Email dispatch occurs outside database transactions (`sendInvitationEmail`). Delivery failures return partial warning (`EMAIL_DELIVERY_FAILED`) without rolling back the database transaction.

### Phase 7: Employee Directory UI (`T037`–`T041`)
- **Status**: **PASS**
- **Findings**:
  - `EmployeeTable.tsx` provides search, filtering by role and status, role badges, and status badges.
  - Action dropdown hides forbidden actions (self-modification disabled, Admin modifying Owner disabled).
  - Directory route `/[slug]/employees/page.tsx` checks `hasPermission(context, "employees:read")` and calls `notFound()` if unauthorized.
  - Header navigation in `tenant-nav.tsx` renders "Employees" link only for authorized roles.

### Phase 8: Invitation Management & Acceptance UI (`T042`–`T045`)
- **Initial Audit Status**: **PARTIAL** (Defect F-03 identified)
- **Post-Remediation Status**: **PASS**
- **Findings & Remediation**:
  - `InviteEmployeeModal.tsx` and `PendingInvitations.tsx` handle invitation creation, resend, revoke, and delivery failure warnings.
  - Public acceptance page `/invitations/accept/page.tsx` validates token pre-flight without disclosing tenant metadata.
  - **Remediated (F-03)**: `AcceptInvitationCard.tsx` query parameters were corrected to `?next=` and `?token=`, perfectly aligning with Feature 001 auth routes. `signInAction` was updated to preserve `redirectTo` when the user has 0 active organizations, ensuring seamless post-login acceptance.

### Phase 9: Automated Testing & Security Verification (`T046`–`T062`)
- **Initial Audit Status**: **PARTIAL** (Defect F-02 identified)
- **Post-Remediation Status**: **PASS**
- **Findings & Remediation**:
  - **T046–T061 (Automated Test Tasks)**: All 16 automated test tasks pass cleanly (100% clean). Automated test coverage across the project comprises:
    - 14 unit test files / 151 unit test cases
    - 15 integration test files / 170 integration test cases
    - 321 total automated Vitest test cases
  - **Remediated (F-02 / T062)**: `tests/e2e/employee-management.spec.ts` was updated to match the production UI headings (`Workforce & Employees`), tab buttons, scoped table cells, and the authoritative HTTP 404 (`Page Not Found`) directory lockout for Cashiers and suspended members. One Playwright end-to-end workflow test executed live in Chromium and passed cleanly (33.6s).
  - **Overall Automated Test Total**: 322 total automated test cases across all suites (151 unit test cases + 170 integration test cases + 1 Playwright E2E workflow test).

### Phase 10: Polish & Regression Gate (`T063`–`T065`)
- **Initial Audit Status**: **PARTIAL** (Defect F-01 / T063 identified)
- **Post-Remediation Status**: **PASS**
- **Findings & Remediation**:
  - T064 passes: All Feature 001 test suites pass with 0 regressions.
  - T065 passes: Manual walkthrough documented in `quickstart.md`.
  - **Remediated (F-01 / T063)**: `src/types/database.ts` was re-encoded as UTF-8 without BOM. `npm run lint` (`✔ No ESLint warnings or errors`) and `npm run build` (`exit code 0`) pass cleanly.

---

## 4. Task-by-Task Status (T001–T065)

| Task ID | Component / File | Expected Behavior | Actual Behavior | Tests | Status |
|---|---|---|---|---|---|
| **T001** | Supabase CLI | Verify DB stack & baseline migrations | Local Supabase migrations 01–08 verified | CLI / DB status | **PASS** |
| **T002** | `src/types/auth.ts` | Define `PermissionKey`, update `TenantContext` | Types exported with 7 keys & context updated | `tsc --noEmit` | **PASS** |
| **T003** | Migration 09 | Create `invitation_status` enum | Enum created with 5 statuses | Migration execution | **PASS** |
| **T004** | Migration 09 | Create `organization_invitations` table | Table, regex checks, hash check, partial index created | `invitations-rls.test.ts` | **PASS** |
| **T005** | Migration 09 | Create `permissions` & `role_permissions` | Tables, FKs, colon constraint created | `database-security.test.ts` | **PASS** |
| **T006** | Migration 09 | FORCE RLS on `organization_invitations` | Force RLS enabled, direct mutations denied | `database-security.test.ts` | **PASS** |
| **T007** | Migration 09 | FORCE RLS on permissions catalog | Force RLS enabled, direct mutations denied | `database-security.test.ts` | **PASS** |
| **T008** | Migration 09 | Seed 7 employee permissions | Seeded with ON CONFLICT DO NOTHING | `permissions-catalog.test.ts` | **PASS** |
| **T009** | Migration 09 | Seed role mappings (admin: 7, manager: 1) | Seeded with ON CONFLICT DO NOTHING | `permissions-catalog.test.ts` | **PASS** |
| **T010** | Migration 09 | RPC: `create_organization_invitation` | 7-day bound, lazy expiry, P0020/P0021/P0022 | `invitations-rls.test.ts` | **PASS** |
| **T011** | Migration 09 | RPC: `validate_invitation_token` | Zero metadata disclosure, status check | `invitations-rls.test.ts` | **PASS** |
| **T012** | Migration 09 | RPC: `accept_organization_invitation` | FOR UPDATE lock, lazy expiry, generic mismatch | `invitations-rls.test.ts` | **PASS** |
| **T013** | Migration 09 | RPC: `decline_organization_invitation` | Terminal transition to declined, audit event | `invitations-rls.test.ts` | **PASS** |
| **T014** | Migration 09 | RPC: `resend_organization_invitation` | 7-day bound, token rotation, audit event | `invitations-rls.test.ts` | **PASS** |
| **T015** | Migration 09 | RPC: `revoke_organization_invitation` | Status transition to revoked, audit event | `invitations-rls.test.ts` | **PASS** |
| **T016** | Migration 09 | RPC: `update_organization_member_role` | Self-mod (P0023), terminal (P0025), P0020, P0002 | `employee-rbac.test.ts` | **PASS** |
| **T017** | Migration 09 | RPC: `update_organization_member_status`| Self-mod (P0024), terminal (P0025), P0020, P0002 | `employee-rbac.test.ts` | **PASS** |
| **T018** | Migration 09 | RPC: `get_organization_employees` | employees:read gate, minimal projection | `employee-rbac.test.ts` | **PASS** |
| **T019** | Migration 09 | DB Hardening: search path, postgres owner | search_path locked, PUBLIC/anon revoked | `database-security.test.ts` | **PASS** |
| **T020** | `database-security.test.ts` | Verify DB security posture & grants | 14 integration tests asserting catalog metadata | Passes (14/14) | **PASS** |
| **T021** | `permissions.ts` | Implement `hasPermission` 4-rule engine | Catalog bounding, active check, Owner access | `permissions.test.ts` | **PASS** |
| **T022** | `context.ts` | Populate `context.permissions` | Dynamic resolution in `resolveTenantContext` | `context.test.ts` | **PASS** |
| **T023** | `validations/employee.ts` | Employee Zod schemas | Role, status, removal schemas | `employee.test.ts` | **PASS** |
| **T024** | `validations/invitation.ts` | Invitation Zod schemas | Email regex, token, expiration schemas | `invitation.test.ts` | **PASS** |
| **T025** | `invitation-mailer.ts` | Decoupled email mailer | Asynchronous external mail dispatch | Action tests | **PASS** |
| **T026** | `employee-actions.ts` | Action: `getEmployeesAction` | Context resolution, permission gate, RPC call | Integration tests | **PASS** |
| **T027** | `employee-actions.ts` | Action: `updateMemberRoleAction` | Schema parse, self-mod guard, RPC call | `employee-rbac.test.ts` | **PASS** |
| **T028** | `employee-actions.ts` | Action: `updateMemberStatusAction` | Schema parse, permission check, RPC call | `employee-rbac.test.ts` | **PASS** |
| **T029** | `employee-actions.ts` | Action: `removeMemberAction` | Schema parse, last-owner check, RPC call | `employee-rbac.test.ts` | **PASS** |
| **T030** | `invitation-actions.ts` | Action: `inviteEmployeeAction` | Crypto random token, RPC call, mail dispatch | `invitations-rls.test.ts` | **PASS** |
| **T031** | `invitation-actions.ts` | Action: `resendInvitationAction` | Token rotation, 7-day bound, mail dispatch | `invitations-rls.test.ts` | **PASS** |
| **T032** | `invitation-actions.ts` | Action: `revokeInvitationAction` | Schema parse, permission check, RPC call | `invitations-rls.test.ts` | **PASS** |
| **T033** | `invitation-actions.ts` | Action: `acceptInvitationAction` | SHA-256 hash, RPC call, active org cookie | `invitations-rls.test.ts` | **PASS** |
| **T034** | `invitation-actions.ts` | Action: `getPendingInvitationsAction` | Omit token_hash, filter expired, permission gate | `invitations-rls.test.ts` | **PASS** |
| **T035** | `invitation-actions.ts` | Action: `declineInvitationAction` | SHA-256 hash, RPC call, generic mismatch | `invitations-rls.test.ts` | **PASS** |
| **T036** | `invitation-actions.ts` | Action: `validateInvitationTokenAction` | Pre-flight validation, zero disclosure | `invitations-rls.test.ts` | **PASS** |
| **T037** | `EmployeeTable.tsx` | Employee directory table UI | Search, filter, badges, action dropdown | Visual / Unit | **PASS** |
| **T038** | `RoleSelectorDialog.tsx` | Role selector dialog UI | Role options, Admin Owner escalation guard | Visual / Unit | **PASS** |
| **T039** | `StatusChangeDialog.tsx` | Status change dialog UI | Suspend/reactivate/remove confirmation | Visual / Unit | **PASS** |
| **T040** | `[slug]/employees/page.tsx`| Employee directory route | employees:read gate, notFound() 404 guard | Unit / Integration | **PASS** |
| **T041** | `tenant-nav.tsx` | Tenant navigation item | "Employees" link rendered for authorized roles | Visual / Unit | **PASS** |
| **T042** | `InviteEmployeeModal.tsx` | Invite employee modal UI | Email validation, warning banner on mail fail | Visual / Unit | **PASS** |
| **T043** | `PendingInvitations.tsx` | Pending invitations tab UI | Resend and revoke triggers, loading states | Visual / Unit | **PASS** |
| **T044** | `AcceptInvitationCard.tsx` | Accept invitation card UI | Auth prompts, query params aligned to ?next= and ?token= | Route tests / E2E | **PASS** |
| **T045** | `invitations/accept/page.tsx`| Invitation acceptance route | Pre-flight validation, zero metadata disclosure | Route tests | **PASS** |
| **T046** | `permissions.test.ts` | Unit: 4-rule hasPermission | 11 tests verifying catalog bounding & rules | Passes (11/11) | **PASS** |
| **T047** | `permissions-catalog.test.ts`| Integration: Catalog consistency | 3 tests verifying DB public.permissions sync | Passes (3/3) | **PASS** |
| **T048** | `employee.test.ts` | Unit: Employee Zod schemas | 8 tests verifying role/status input validation | Passes (8/8) | **PASS** |
| **T049** | `invitation.test.ts` | Unit: Invitation Zod schemas | 8 tests verifying email/token/expiration | Passes (8/8) | **PASS** |
| **T050** | `invitations-rls.test.ts` | Integration: Invitation lifecycle & RLS | Direct insert denial, RPC creation with 7d bound | Passes | **PASS** |
| **T051** | `invitations-rls.test.ts` | Integration: RPC input bypass rejection | P0009 on malformed email, hash, expiration | Passes | **PASS** |
| **T052** | `invitations-rls.test.ts` | Integration: Pre-flight zero disclosure | Anon queries validate_invitation_token | Passes | **PASS** |
| **T053** | `invitations-rls.test.ts` | Integration: Concurrency & expired reinvite| P0022 duplicate rejection; expired transition | Passes | **PASS** |
| **T054** | `invitations-rls.test.ts` | Integration: Replay prevention | INVITATION_NOT_PENDING on replay attempts | Passes | **PASS** |
| **T055** | `invitations-rls.test.ts` | Integration: Email mismatch privacy | Generic EMAIL_MISMATCH without address leak | Passes | **PASS** |
| **T056** | `invitations-rls.test.ts` | Integration: Resend behavior & rotation | New token hash, old token invalidated, 7d bound | Passes | **PASS** |
| **T057** | `employee-rbac.test.ts` | Integration: Role escalation & last owner | P0020 on Admin Owner escalation, P0023, P0002 | Passes | **PASS** |
| **T058** | `employee-rbac.test.ts` | Integration: Suspension & soft revocation | P0024 self-mod, P0025 terminal revoked guard | Passes | **PASS** |
| **T059** | `employee-rbac.test.ts` | Integration: Multi-tenant isolation | Revoking in Org A leaves Org B active | Passes | **PASS** |
| **T060** | `employee-rbac.test.ts` | Integration: Authorization freshness | Immediate lockout on next request (0s delay) | Passes | **PASS** |
| **T061** | `employee-rbac.test.ts` | Integration: Tenant isolation & directory | Cashier denied (P0005), revoked excluded | Passes | **PASS** |
| **T062** | `employee-management.spec.ts`| Playwright E2E workflow test | One end-to-end workflow test in live Chromium | Passes (33.6s) | **PASS** |
| **T063** | `src/types/database.ts` | Regenerate Supabase TypeScript types | Re-encoded as UTF-8 without BOM | tsc & next build pass | **PASS** |
| **T064** | Test suites | Feature 001 regression tests | 14 unit test files (151 test cases) + 15 integration test files (170 test cases) pass | Passes (321/321) | **PASS** |
| **T065** | `quickstart.md` | Developer walkthrough | Step-by-step verification instructions verified | Document review | **PASS** |

---

## 5. Database Security Assessment

### Function Hardening Matrix

| Function | Owner | Search Path | Default Privileges | Explicit Grants |
|---|---|---|---|---|
| `check_user_permission` | `postgres` | `pg_catalog, public, pg_temp` | Revoked from PUBLIC, anon | `authenticated`, `service_role` |
| `create_organization_invitation` | `postgres` | `pg_catalog, public, pg_temp` | Revoked from PUBLIC, anon | `authenticated`, `service_role` |
| `validate_invitation_token` | `postgres` | `pg_catalog, public, pg_temp` | Revoked from PUBLIC | `anon`, `authenticated`, `service_role` |
| `accept_organization_invitation` | `postgres` | `pg_catalog, public, pg_temp` | Revoked from PUBLIC, anon | `authenticated`, `service_role` |
| `decline_organization_invitation` | `postgres` | `pg_catalog, public, pg_temp` | Revoked from PUBLIC, anon | `authenticated`, `service_role` |
| `resend_organization_invitation` | `postgres` | `pg_catalog, public, pg_temp` | Revoked from PUBLIC, anon | `authenticated`, `service_role` |
| `revoke_organization_invitation` | `postgres` | `pg_catalog, public, pg_temp` | Revoked from PUBLIC, anon | `authenticated`, `service_role` |
| `update_organization_member_role` | `postgres` | `pg_catalog, public, pg_temp` | Revoked from PUBLIC, anon | `authenticated`, `service_role` |
| `update_organization_member_status` | `postgres` | `pg_catalog, public, pg_temp` | Revoked from PUBLIC, anon | `authenticated`, `service_role` |
| `get_organization_employees` | `postgres` | `pg_catalog, public, pg_temp` | Revoked from PUBLIC, anon | `authenticated`, `service_role` |

### Security Evaluation
- **Search Path Isolation**: All 10 functions set `SET search_path = pg_catalog, public, pg_temp`, completely preventing search-path hijacking attacks.
- **Role Permissions & Default Privileges**: Default execution privileges were revoked from `PUBLIC`. Execution privileges for `anon` were revoked by default on all functions, with an explicit `EXECUTE` grant given to `anon` exclusively on `validate_invitation_token` to permit unauthenticated pre-flight token validation without disclosing tenant or user data. All 10 functions grant `EXECUTE` to `authenticated` and `service_role`.
- **Direct Mutation Immunity**: Authenticated client roles attempting direct SQL `INSERT`, `UPDATE`, or `DELETE` on `organization_invitations`, `permissions`, or `role_permissions` receive PostgreSQL RLS error `42501` (permission denied).

---

## 6. Tenant Isolation Assessment

- **Multi-Tenant Boundaries**: Every tenant query enforces `organization_id = context.organization.id`.
- **Cross-Organization Protection**: Verified by test `T059`. When a user holds memberships in Org A and Org B, revoking their membership in Org A immediately returns HTTP 404 for Org A while leaving Org B membership `active` and accessible.
- **Directory Discovery Prevention**: Cashiers and non-members querying `get_organization_employees` or browsing to `/[slug]/employees` receive HTTP 404 (`notFound()`), preventing workforce enumeration.
- **Revoked Membership Exclusion**: Revoked memberships are strictly filtered out (`status != 'revoked'`) in `get_organization_employees`.

---

## 7. Permission and RBAC Assessment

### 4-Rule Engine Alignment
The TypeScript resolver (`hasPermission`) and PostgreSQL helper (`check_user_permission`) strictly enforce the identical 4-rule hierarchy:
1. **Catalog Bounding**: The evaluated permission string MUST exist in the catalog (`SYSTEM_PERMISSIONS` / `public.permissions`). Unknown keys are denied for all roles, including Owner.
2. **Active Membership**: The caller must have an active membership (`status = 'active'`) in an active organization (`is_active = true`).
3. **Dynamic Owner Access**: Active Owners automatically receive access to all registered permissions in the catalog.
4. **Deterministic Role Evaluation**: Evaluated against deterministic role mappings (`admin: 7`, `manager: 1`, `cashier: 0`).

### Privilege Escalation Safeguards
- **Admin Promoting to Owner**: Rejected in PostgreSQL with `P0020` ("Admins cannot promote members to Owner").
- **Admin Modifying Owner**: Rejected in PostgreSQL with `P0020` ("Admins cannot modify the role/status of an Owner").
- **Admin Inviting Owner**: Rejected in PostgreSQL with `P0020` ("Admins cannot invite users with the Owner role").
- **Self-Modification**: Rejected in PostgreSQL with `P0023` ("Users cannot modify their own role") and `P0024` ("Users cannot modify their own membership status").
- **Last Active Owner Protection**: Demoting or suspending the sole Owner triggers `check_owner_invariant` raising `P0002` ("An organization must have at least one active owner").

---

## 8. Invitation Lifecycle Assessment

```
                      +-------------------+
                      |      Pending      |
                      +---------+---------+
                                |
        +---------------+-------+-------+---------------+
        |               |               |               |
        v               v               v               v
  +-----------+   +-----------+   +-----------+   +-----------+
  | Accepted  |   | Declined  |   |  Revoked  |   |  Expired  |
  +-----+-----+   +-----+-----+   +-----+-----+   +-----+-----+
        |               |               |               |
        v               v               v               v
 [Active Member]    [Terminal]      [Terminal]      [Re-invitable]
```

- **Cryptographic Randomness**: Tokens are generated using `crypto.randomBytes(32).toString('hex')`.
- **Hash-Only Storage**: Raw tokens are never stored; only SHA-256 hashes (`^[a-f0-9]{64}$`) are persisted in `organization_invitations.token_hash`.
- **Expiration Enforcement**: Maximum lifetime of exactly 7 days is strictly validated at both Zod and database boundaries (`now() < expires_at <= now() + 7 days`).
- **Transaction-Safe Lazy Expiration**: If an expired invitation is accessed during acceptance, decline, or reinvitation, it transitions to `'expired'` and logs `employee.invitation_expired` without transaction rollback.
- **Identity Privacy Protection**: If an authenticated user's email does not match the invitation recipient, `EMAIL_MISMATCH` is returned with a generic notice omitting expected or actual emails.
- **Replay Invariance**: Once an invitation leaves `pending` status, subsequent acceptance attempts fail with `INVITATION_NOT_PENDING`.

---

## 9. Server Actions and UI Assessment

### Server Actions
- All Server Actions verify tenant context and permissions server-side.
- Actions catch database error codes (`P0001`–`P0026`) and return human-readable user messages without exposing stack traces.
- Cookie management for active organization switching (`bizflow_active_org`) is safely set upon invitation acceptance.

### Initial Audit Finding — Resolved in Final Remediation: Query Parameter Incompatibility in `AcceptInvitationCard.tsx` (Finding F-03)
- **Initial Finding**: In `src/components/invitations/AcceptInvitationCard.tsx`, authentication links used query parameters `returnTo` and `pendingInviteToken`, whereas Feature 001 auth pages expect `?next=` and `?token=`.
- **Status**: **RESOLVED** in Final Remediation (`eca0b8f04814be8bab70baffad28e8f570435965`).
- **Resolution**: Corrected query parameters in `AcceptInvitationCard.tsx` to `?next=` and `?token=`, and updated `signInAction` in `src/actions/auth-actions.ts` to preserve `redirectTo` when an invited user has 0 active organizations.
- **Verification**: Verified passing across unit, integration, and live Playwright E2E test execution.

---

## 10. Automated Test Quality Assessment

| Test File | Type | Tests | Status | Verification Quality |
|---|---|---|---|---|
| `tests/unit/auth/permissions.test.ts` | Unit | 11 | PASS | Genuinely exercises all 4 rules, unknown keys, Owner access |
| `tests/unit/validations/employee.test.ts` | Unit | 8 | PASS | Asserts UUIDs, roles, status transitions |
| `tests/unit/validations/invitation.test.ts` | Unit | 8 | PASS | Asserts RFC email regex, token length, UUIDs |
| `tests/integration/permissions-catalog.test.ts` | Integration | 3 | PASS | Real PostgreSQL queries comparing TS catalog vs DB table |
| `tests/integration/database-security.test.ts` | Integration | 14 | PASS | Real PostgreSQL queries on `pg_proc`, RLS `42501` denial, caller restriction |
| `tests/integration/invitations-rls.test.ts` | Integration | 11 | PASS | Real Supabase clients: 7d bounds, duplicate P0022, mismatch, rejoining |
| `tests/integration/employee-rbac.test.ts` | Integration | 14 | PASS | Real Supabase clients: P0020, P0023, P0024, P0025, P0002 |
| `tests/e2e/employee-management.spec.ts` | E2E | 1 | PASS (Remediated) | One Playwright end-to-end workflow test passed in Chromium (initial FAIL resolved in remediation) |

---

## 11. Feature 001 Regression Assessment

- **Authentication & Sessions**: All existing Feature 001 auth triggers, session revocation tests, and profile password tests pass 100%.
- **Organization Creation & Onboarding**: All Feature 001 onboarding and organization switching tests pass 100%.
- **Historical Feature 001 Baseline**: The original Feature 001 baseline comprises 123 unit test cases (across 11 test files) and 128 integration test cases (across 11 test files), totaling 251 automated baseline tests. All 251 baseline tests continue to execute and pass cleanly with zero regressions.
- **Clarification on Pre-Remediation Totals**: The previously cited figures of "150 unit tests and 166 integration tests" (316 total tests) represented the outdated pre-remediation project-wide test count from initial implementation commit `e4c130b`, rather than the Feature 001 baseline alone. Following the Round 1 remediation (commit `eca0b8f`), 1 additional unit test and 4 additional integration tests were added to verify security and rejoining invariants. The full project test suite now stands at 151 unit test cases (14 files) and 170 integration test cases (15 files), totaling 321 automated Vitest tests (plus 1 Playwright E2E workflow test), all passing with 100% success.

---

## 12. Critical and High-Severity Findings

### Initial Audit Finding — Resolved in Final Remediation: Finding F-01 — `src/types/database.ts` UTF-16 LE Binary Encoding Breaks `next build` and `next lint`
- **Initial Severity**: **HIGH**
- **Initial Status**: **DEFECT**
- **Final Status**: **RESOLVED** (Remediation Commit `eca0b8f04814be8bab70baffad28e8f570435965`)
- **Affected File**: [`src/types/database.ts`](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/src/types/database.ts)
- **Description**: Running `npx supabase gen types typescript --local > src/types/database.ts` in Windows PowerShell created the file with UTF-16 LE (Little Endian with BOM) encoding.
- **Evidence**:
  ```bash
  $ npm run lint
  ./src/types/database.ts
  Error: Parsing error: File appears to be binary.

  $ npm run build
  Failed to compile.
  ./src/types/database.ts
  Error: Parsing error: File appears to be binary.
  ```
- **Impact**: Production build cannot be compiled. CI/CD pipeline fails. Playwright cannot run against `npm run start`.
- **Resolution**: Re-encoded `src/types/database.ts` as standard UTF-8 without BOM.
- **Verification**: Verified via `npm run lint` (`✔ No ESLint warnings or errors`) and `npm run build` (`Compiled successfully in 17.4s`, exit code 0).

---

## 13. Medium and Low-Severity Findings

### Initial Audit Finding — Resolved in Final Remediation: Finding F-02 — `tests/e2e/employee-management.spec.ts` Contains Broken Redirect Assertions
- **Initial Severity**: **MEDIUM**
- **Initial Status**: **DEFECT**
- **Final Status**: **RESOLVED** (Remediation Commit `eca0b8f04814be8bab70baffad28e8f570435965`)
- **Affected File**: [`tests/e2e/employee-management.spec.ts`](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/tests/e2e/employee-management.spec.ts) (lines 142, 172)
- **Description**:
  - Line 142 expected `await employeePage.waitForURL(new RegExp('/${orgSlug}/dashboard'))` when a Cashier visits `/[slug]/employees`. In reality, the server calls `notFound()`, serving HTTP 404 to prevent directory discovery.
  - Line 172 expected `await employeePage.waitForURL(new RegExp('/${orgSlug}/suspended|/onboarding'))` when a suspended member accesses the workspace. In reality, `getTenantContext` calls `notFound()` (404 Not Found).
- **Impact**: The E2E test timed out even when the application was functioning properly.
- **Resolution**: Updated Playwright test assertions to match production UI headings (`Workforce & Employees`), tab buttons, scoped table cells, and authoritative HTTP 404 (`Page Not Found`) directory lockout.
- **Verification**: One Playwright end-to-end workflow test executed live in Chromium and passed cleanly in 33.6s.

### Initial Audit Finding — Resolved in Final Remediation: Finding F-03 — Query Parameter Incompatibility in `AcceptInvitationCard.tsx`
- **Initial Severity**: **MEDIUM**
- **Initial Status**: **DEFECT**
- **Final Status**: **RESOLVED** (Remediation Commit `eca0b8f04814be8bab70baffad28e8f570435965`)
- **Affected File**: [`src/components/invitations/AcceptInvitationCard.tsx`](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/src/components/invitations/AcceptInvitationCard.tsx) (lines 157, 164, 248)
- **Description**:
  - The card linked to `/sign-in?returnTo=...` instead of `/sign-in?next=...`.
  - The card linked to `/sign-up?pendingInviteToken=...` instead of `/sign-up?token=...`.
- **Impact**: When unauthenticated users clicked these buttons to sign in or sign up, Feature 001 auth pages did not read `returnTo` or `pendingInviteToken`, causing the user to lose their return flow to the invitation acceptance screen.
- **Resolution**: Changed `returnTo` to `next` and `pendingInviteToken` to `token` in `AcceptInvitationCard.tsx`; updated `signInAction` in `src/actions/auth-actions.ts` to preserve `redirectTo` when user has 0 active organizations.
- **Verification**: Verified in unit, integration, and live Playwright E2E test execution.

---

## 14. Additional Database Concerns Investigated and Resolved

### Concern C-01: `accept_organization_invitation` Membership Lifecycle, Terminal Revocation & Rejoining Flow
- **Investigation**: 
  - `accept_organization_invitation` previously used `INSERT ... ON CONFLICT (user_id, organization_id) DO UPDATE SET role = EXCLUDED.role, status = 'active'`. This unrestricted upsert allowed bypassing membership lifecycle invariants.
  - Furthermore, an apparent policy contradiction existed between the terminal revocation rule (that direct status modifications on revoked memberships are blocked with `P0025`) and the product requirement that a former/removed employee may rejoin an organization through a fresh invitation.
- **Correction Made**:
  1. Resolved the contradiction by establishing a strict architectural separation between direct member modification and authorized re-invitation:
     - Direct member modifications via `update_organization_member_role` and `update_organization_member_status` strictly retain the terminal revocation guard `P0025` ("Cannot modify a revoked membership. Revocation is terminal."). An admin cannot simply click "reactivate" on a removed employee.
     - Rejoining through a formal, authorized, cryptographic invitation is supported. `create_organization_invitation` permits inviting a user whose prior membership is `status = 'revoked'` (while actively rejecting active members with `P0021` and suspended members with `P0027`).
  2. Updated `accept_organization_invitation()` to acquire an exclusive row lock on any existing `organization_memberships` record for `(v_caller_id, v_invite.organization_id)`:
     - If `status = 'active'`, rejects acceptance with `{ success: false, code: 'ALREADY_ACTIVE_MEMBER', message: 'You are already an active member of this organization.' }`.
     - If `status = 'suspended'`, rejects acceptance with `{ success: false, code: 'MEMBERSHIP_SUSPENDED', message: 'Your membership in this organization is currently suspended.' }`.
     - If `status = 'revoked'`, executes a controlled, audited rejoining flow: atomically transitions `organization_memberships` from `revoked` to `active`, updates `role = v_invite.role`, updates `updated_at = now()`, marks the invitation `accepted`, and records an immutable `employee.joined` audit event with rejoining metadata (`rejoined: true, previous_status: 'revoked'`).
     - If no membership exists, cleanly inserts a new `organization_memberships` row (`status = 'active'`). Unrestricted `ON CONFLICT DO UPDATE` was completely removed.
- **Regression Tests Added & Verified**:
  - `tests/integration/invitations-rls.test.ts`:
    - `allows a previously revoked employee to rejoin via a new invitation and records rejoining audit metadata`
    - `rejects invitation acceptance when user has a suspended membership (MEMBERSHIP_SUSPENDED)`
    - `rejects creating invitation when user already has an active (P0021) or suspended (P0027) membership`

### Concern C-02: `check_user_permission` Direct Invocation & Authorization Leakage
- **Investigation**: `check_user_permission(p_org_id, p_user_id, p_permission)` accepted an arbitrary `p_user_id` and had `GRANT EXECUTE TO authenticated`. An authenticated user could directly invoke the RPC passing another user's UUID and arbitrary organization UUIDs, probing whether that user belonged to the organization and what permissions/role they held without possessing `employees:read`.
- **Correction Made**:
  - Added an authorization check to `check_user_permission`:
    ```sql
    IF auth.uid() IS NOT NULL AND auth.role() = 'authenticated' AND p_user_id != auth.uid() THEN
        RETURN FALSE;
    END IF;
    ```
  - Authenticated callers can only inspect their own permissions (`p_user_id = auth.uid()`). Any attempt to inspect another user's permissions immediately returns `FALSE`.
  - Internal calls from other `SECURITY DEFINER` functions continue to execute without disruption (as they pass `v_caller_id = auth.uid()`), and `service_role` retains administrative inspection access.
- **Regression Tests Added**:
  - `tests/integration/database-security.test.ts`:
    - `restricts check_user_permission: authenticated user cannot probe another user's permissions (returns false)`

### Concern C-03: `resolveTenantContext` Fail-Closed Permission Resolution
- **Investigation**: `resolveTenantContext()` previously fell back to static `ROLE_PERMISSIONS` if the database query to `role_permissions` failed or returned an error. This was fail-open behavior that concealed database errors and risked granting inconsistent permissions.
- **Correction Made**:
  1. Updated `resolveTenantContext()` in `src/lib/auth/context.ts` to implement strict fail-closed semantics:
     - For `owner`, queries `public.permissions` catalog from the database; on database query error or missing data, returns `{ ok: false, error: 'forbidden' }`.
     - For non-owner roles, queries `public.role_permissions` from the database; on database query error or missing data, returns `{ ok: false, error: 'forbidden' }`.
     - Removed all static `ROLE_PERMISSIONS` fallbacks on error.
  2. Updated `hasPermission()` in `src/lib/auth/permissions.ts` so that when `Array.isArray(context.permissions)`, it strictly evaluates `context.permissions.includes(...)` without falling back to static constants when the permissions array is empty (e.g. for Cashier or restricted roles).
- **Regression Tests Added**:
  - `tests/unit/auth/context.test.ts`:
    - `fails closed (forbidden) when database permission query returns an error`

---

## 15. Controlled Remediation Round 1 (Completed)

All findings from the initial audit report and the three additional database concerns were remediated:

| Finding / Concern | Issue | File(s) Modified | Correction | Regression Test |
|---|---|---|---|---|
| **F-01** [High] | UTF-16 LE BOM encoding broke `next build` and `next lint` | `src/types/database.ts` | Re-encoded to valid UTF-8 without BOM | Verified via `npm run lint` and `npm run build` |
| **F-02** [Medium] | E2E assertions expected redirects instead of HTTP 404 Page Not Found | `tests/e2e/employee-management.spec.ts` | Updated selectors to match `Workforce & Employees`, `Active Directory`, and `Page Not Found` | One Playwright end-to-end workflow test passed in Chromium (33.6s) |
| **F-03** [Medium] | Query params `returnTo` and `pendingInviteToken` mismatched Feature 001 auth routes | `src/components/invitations/AcceptInvitationCard.tsx`, `src/actions/auth-actions.ts` | Aligned to `?next=` and `?token=`; updated `signInAction` to preserve `redirectTo` when user has 0 active organizations | Covered in Playwright E2E and invitation acceptance tests |
| **C-01** [High] | Policy contradiction: terminal revocation vs revoked rejoining | `supabase/migrations/20261103000009_employee_management_rbac.sql`, `specs/002-employee-rbac/` | Allowed fresh invite creation for revoked members; implemented controlled audited rejoining in `accept_organization_invitation`; retained terminal guard `P0025` for direct member updates | `tests/integration/invitations-rls.test.ts` (3 tests verifying rejoining & suspension blocks) |
| **C-02** [Medium] | `check_user_permission` exposed other users' authorization info to authenticated callers | `supabase/migrations/20261103000009_employee_management_rbac.sql` | Restricted direct authenticated invocation to `auth.uid() = p_user_id` | `tests/integration/database-security.test.ts` (1 test added) |
| **C-03** [Medium] | `resolveTenantContext` fail-open fallback on database permission query failure | `src/lib/auth/context.ts`, `src/lib/auth/permissions.ts` | Implemented fail-closed (`forbidden`) on DB errors; strict array evaluation | `tests/unit/auth/context.test.ts` (1 test added) |

### Verification Results Summary

1. **TypeScript Typecheck (`npm run typecheck`)**:
   - Status: **PASSED** (0 errors).
2. **ESLint (`npm run lint`)**:
   - Status: **PASSED** (`✔ No ESLint warnings or errors`).
3. **Unit Tests (`npm run test:unit`)**:
   - Status: **PASSED** (14 test files, 151 tests passed, 0 failed).
4. **Integration Tests (`npm run test:integration`)**:
   - Status: **PASSED** (15 test files, 170 tests passed, 0 failed).
5. **Playwright E2E Tests (`npx playwright test tests/e2e/employee-management.spec.ts`)**:
   - Status: **PASSED** (One end-to-end workflow test passed in Chromium, 33.6s duration).
   - Verified complete multi-step workflow in Chromium: owner sign-in $\rightarrow$ directory navigation $\rightarrow$ invitation creation $\rightarrow$ employee sign-in $\rightarrow$ invitation acceptance $\rightarrow$ cashier directory lockout (404 Page Not Found) $\rightarrow$ manager elevation $\rightarrow$ directory access $\rightarrow$ suspension lockout.
6. **Production Build (`npm run build`)**:
   - Status: **PASSED** (exit code 0; all 13 routes optimized, static pages generated).
7. **Database Security Verification (`tests/integration/database-security.test.ts`)**:
   - Status: **PASSED** (all 14 security tests passing: function ownership, search_path locking, PUBLIC revocation, execution grants, FORCE RLS, client mutation denial, RPC permission restriction).

---

## 16. Final Readiness Verdict

### **APPROVED**

**Reasoning**:  
All three original findings (F-01, F-02, F-03) and all three additional database-level security concerns (C-01, C-02, C-03) have been fully investigated, corrected, and verified with dedicated regression tests.

The full automated test suite (151 unit tests, 170 integration tests [321 automated Vitest tests], plus one Playwright end-to-end workflow test in Chromium — 322 automated tests total across all suites) passes cleanly with 0 failures. TypeScript type checking and ESLint pass with 0 errors/warnings, and the production build (`next build`) compiles cleanly. Database security posture, PostgreSQL row-level security, tenant isolation, and the 4-rule permission engine parity are completely intact and verified.

Feature 002 is production-ready and approved for merge review.

