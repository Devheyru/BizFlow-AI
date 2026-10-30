# Implementation Plan: Authentication and Organization Foundation (Hardened Architecture)

**Branch**: `001-auth-organization` | **Date**: 2026-10-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-auth-organization/spec.md`  
**Revision Status**: Final Authorization, Audit & Timestamp Revision (Pass 4) Completed  

---

## Summary

Feature 001 establishes the foundational multi-tenant identity and organization framework for BizFlow AI. Following deep security analysis, the technical architecture has been hardened with:
1. **Denial of Direct Membership Mutations**: Direct client `INSERT`, `UPDATE`, and `DELETE` on `organization_memberships` are denied via RLS. All role changes, status modifications, removals, and ownership transfers are routed through authenticated database stored procedures.
2. **Uniform Lock Ordering & Concurrency Protocol**: All RPCs modifying membership state acquire an exclusive row lock on the organization (`PERFORM 1 FROM public.organizations WHERE id = p_org_id FOR UPDATE`) before acquiring row locks on memberships. This serializes concurrent operations and eliminates race conditions.
3. **Creator-Bound Idempotency**: `client_mutation_id` on `organizations` is constrained by a composite unique constraint `(created_by, client_mutation_id)`. Replayed submissions return the caller's actual role dynamically, preventing foreign tenant discovery.
4. **Owner-Only Store Closure Lifecycle**: Direct client updates to `is_active` are denied by RLS. Store closure is managed exclusively through `close_organization()`, which enforces name confirmation, sets audit timestamps (`closed_at`, `closed_by`), and revokes pending invitations atomically.
5. **Strict Invitation State Handling**: `accept_organization_invitation()` verifies existing status before evaluating expiration, preventing accepted or revoked invites from being re-labeled as `'expired'`. Structured JSON return allows expired status updates to commit permanently.
6. **Hardened `SECURITY DEFINER` Execution**: All privileged functions are owned by `postgres`, have locked `search_path = pg_catalog, public, pg_temp`, explicit execution grants, and universal `FORCE RLS` on every tenant table without policy recursion.
7. **Organization Audit Events**: Immutable, append-only `organization_audit_events` table with `FORCE RLS`; only Owners and Admins can read; direct client writes denied. Critical lifecycle events (ownership transfers, member removals, organization closures, invitation revocations) are recorded atomically within their respective RPCs.
8. **Consistent RPC Authorization Protocol**: Every protected RPC independently validates authentication (`auth.uid()`), email verification (`is_email_verified()`), active organization (`is_active = true`), caller's active membership and required role. No lifecycle-mutating operations are permitted on closed organizations. Direct client invitation mutations are denied; revocation uses `revoke_invitation()` RPC.

---

## Technical Context

**Language/Version**: TypeScript 5.x with `strict: true` (strictly no `any`).

**Primary Dependencies**: Next.js 15+ (App Router, React 19, React Server Components), `@supabase/supabase-js`, `@supabase/ssr`, `zod`, `react-hook-form`, `@hookform/resolvers/zod`, `tailwind-merge`, `clsx`, `lucide-react`, `shadcn/ui` (Radix UI primitives).

**Storage**: PostgreSQL 15+ hosted on Supabase Cloud; PostgreSQL Row-Level Security (RLS) policies on all tenant tables; Supabase Auth for identity management.

**Testing**: Vitest for unit validation tests; Supabase local container for RLS policy, concurrency, and trigger integration tests; Playwright for end-to-end browser workflows.

**Target Platform**: Modern web browsers (desktop point-of-sale displays and mobile-responsive devices); deployment target on Vercel with edge-ready middleware.

**Project Type**: Multi-Tenant SaaS Web Application (Modular Monolith architecture).

**Performance Goals**: Page transitions and server action responses < 300ms p95; initial client JS bundle < 150KB; active organization context switch < 1 second.

**Constraints**: Enforce database-level tenant isolation via universal `FORCE RLS`; active tenant context must be resolved strictly on the server from verified session cookies; zero exposure of Supabase service-role keys to client-side bundles.

**Scale/Scope**: Foundational MVP release supporting individual store owners and multi-store operators managing up to dozens of store locations.

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Multi-Tenancy**: All organization-owned tables (`organizations`, `organization_memberships`, `organization_invitations`) are partitioned with `organization_id`; PostgreSQL RLS is enabled and forced on **every** tenant table; tenant context is resolved strictly on the server from authenticated sessions. Non-recursive policy architecture guarantees zero policy recursion. *(Passes Gate)*
- [x] **II. Financial & Inventory Invariance**: Atomic operations enforced via database stored procedure (`create_organization_with_owner()`); promote-before-demote ownership transfer preserves owner invariant at all times. *(Passes Gate)*
- [x] **III. Type Safety & Validation**: Strict TypeScript without `any`; runtime Zod validation schemas (`signUpSchema`, `signInSchema`, `createOrganizationSchema`, `inviteMemberSchema`, `acceptInvitationSchema`, `updateMemberRoleSchema`) enforce strict contracts (including symbols and ISO regex) on all boundaries. *(Passes Gate)*
- [x] **IV. Security & RBAC**: Direct client membership mutations are completely barred; granular role hierarchy (`owner`, `admin`, `manager`, `cashier`) enforced via authenticated database RPCs; owner invariants prevent orphaned tenants; no service-role keys exposed to client; organization audit events provide an immutable audit trail for critical lifecycle operations; session cookies protected via `HTTP-only` and `SameSite=Lax`. *(Passes Gate)*
- [x] **V. AI Guardrails**: No autonomous AI execution capabilities in Feature 001; all tenant actions require explicit human authentication and server-side RBAC validation. *(Passes Gate)*

---

## Exact Database Invariants & Concurrency Strategy

### 1. Invariant: Guaranteed Active Owner
Every active organization MUST have at least one active member with `role = 'owner'`.
- **Enforcement Mechanism**:
  1. Direct client `UPDATE` and `DELETE` on `organization_memberships` are denied by RLS (`USING (false)`).
  2. Role modifications must use `transfer_organization_ownership()`, `update_member_role()`, `update_member_status()`, or `remove_member()`.
  3. Every RPC enforces uniform lock ordering: locks `organizations` row first (`FOR UPDATE`), then membership row(s) (`FOR UPDATE`).
  4. Ownership transfer promotes target first (count = 2), then demotes caller (count = 1).
  5. The `check_owner_invariant()` trigger serves as an automated defensive safeguard.

### 2. Invariant: Immutable Membership Foreign Keys
`user_id` and `organization_id` on existing membership rows are immutable. Membership changes can only alter `role`, `status`, and `updated_at`.

### 3. Invariant: Membership State Machine (No Silent Role Overwrites)
- Active members cannot be demoted or altered by accepting an invitation (`ALREADY_ACTIVE_MEMBER`).
- Disciplinary suspensions cannot be bypassed or reactivated via invitations (`ACCOUNT_SUSPENDED`).
- Invitations cannot grant the `owner` role (enforced via table check constraint).

---

## Updated RLS Policy Matrix

| Table | Policy Name | Command | Target Role | Using Expression | Check Expression |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `profiles` | `profiles_select_own` | SELECT | `authenticated` | `auth.uid() = id` | - |
| `profiles` | `profiles_select_peers` | SELECT | `authenticated` | `id IN (SELECT om.user_id FROM organization_memberships om WHERE om.organization_id IN (SELECT get_user_organization_ids()) AND om.status = 'active')` | - |
| `profiles` | `profiles_update_own` | UPDATE | `authenticated` | `auth.uid() = id` | `auth.uid() = id` |
| `profiles` | `profiles_insert_deny` | INSERT | `authenticated` | - | `false` (handled by trigger) |
| `profiles` | `profiles_delete_deny` | DELETE | `authenticated` | `false` | - |
| `organizations` | `organizations_select_member` | SELECT | `authenticated` | `id IN (SELECT get_user_organization_ids())` | - |
| `organizations` | `organizations_update_admin` | UPDATE | `authenticated` | `is_org_member(id, ARRAY['owner', 'admin'])` | `is_org_member(id, ARRAY['owner', 'admin']) AND is_active = (SELECT o.is_active FROM organizations o WHERE o.id = organizations.id)` |
| `organizations` | `organizations_insert_deny` | INSERT | `authenticated` | - | `false` (must use RPC) |
| `organizations` | `organizations_delete_deny` | DELETE | `authenticated` | `false` (must use closure RPC) | - |
| `organization_memberships` | `memberships_select_own` | SELECT | `authenticated` | `user_id = (SELECT auth.uid())` | - |
| `organization_memberships` | `memberships_select_peers` | SELECT | `authenticated` | `organization_id IN (SELECT get_user_organization_ids())` | - |
| `organization_memberships` | `memberships_update_deny_direct` | UPDATE | `authenticated` | `false` (must use RPC) | `false` |
| `organization_memberships` | `memberships_insert_deny_direct` | INSERT | `authenticated` | - | `false` (must use RPC) |
| `organization_memberships` | `memberships_delete_deny_direct` | DELETE | `authenticated` | `false` (must use RPC) | - |
| `organization_invitations` | `invitations_select_admin` | SELECT | `authenticated` | `is_org_member(organization_id, ARRAY['owner', 'admin'])` | - |
| `organization_invitations` | `invitations_insert_admin` | INSERT | `authenticated` | - | `is_org_member(organization_id, ARRAY['owner', 'admin']) AND invited_by = auth.uid() AND role IN ('admin', 'manager', 'cashier')` |
| `organization_invitations` | `invitations_update_deny_direct` | UPDATE | `authenticated` | `false` (must use `revoke_invitation()` RPC) | - |
| `organization_invitations` | `invitations_delete_deny` | DELETE | `authenticated` | `false` (revocation preferred) | - |
| `organization_audit_events` | `audit_events_select_admin` | SELECT | `authenticated` | `is_org_member(organization_id, ARRAY['owner', 'admin'])` | - |
| `organization_audit_events` | `audit_events_insert_deny` | INSERT | `authenticated` | - | `false` (written by RPCs only) |
| `organization_audit_events` | `audit_events_update_deny` | UPDATE | `authenticated` | `false` | - |
| `organization_audit_events` | `audit_events_delete_deny` | DELETE | `authenticated` | `false` | - |

---

## Exact RPC Authorization Boundaries

| Stored Procedure | Required Caller Role | Minimum Preconditions | Mutated Entities | Concurrency Lock |
| :--- | :--- | :--- | :--- | :--- |
| `create_organization_with_owner()` | `authenticated` | Email confirmed | `organizations`, `organization_memberships` | Idempotent on `(created_by, client_mutation_id)` |
| `transfer_organization_ownership()` | `owner` | Authenticated; email confirmed; org active; caller is active owner; target is active member | `organization_memberships` (2 rows), `organization_audit_events` | `organizations` row lock `FOR UPDATE` |
| `update_member_role()` | `owner` or `admin` | Authenticated; email confirmed; org active; caller active; target != owner; Admins cannot modify/assign owner/admin | `organization_memberships` (1 row) | `organizations` row lock `FOR UPDATE` |
| `update_member_status()` | `owner` or `admin` | Authenticated; email confirmed; org active; caller active; target != owner; Admins cannot suspend/revoke peer admins | `organization_memberships` (1 row) | `organizations` row lock `FOR UPDATE` |
| `remove_member()` | `owner` | Authenticated; email confirmed; org active; caller active owner; caller != target; target != owner | `organization_memberships` (1 row), `organization_audit_events` | `organizations` row lock `FOR UPDATE` |
| `close_organization()` | `owner` | Authenticated; email confirmed; org active; caller active owner; exact name confirmation | `organizations`, `organization_invitations`, `organization_audit_events` | `organizations` row lock `FOR UPDATE` |
| `accept_organization_invitation()` | `authenticated` | Email confirmed; token valid & pending; email matches recipient; org active | `organization_invitations`, `organization_memberships` | Invitation row lock + Org row lock `FOR UPDATE` |
| `revoke_invitation()` | `owner` or `admin` | Authenticated; email confirmed; org active; invitation pending | `organization_invitations`, `organization_audit_events` | Invitation row lock + Org row lock `FOR UPDATE` |

---

## Required Security Integration Tests

1. **Direct Mutation Denial**: Assert direct SQL updates and deletes on `organization_memberships` fail under `authenticated` role.
2. **Uniform Locking Serialization**: Assert concurrent demotions across independent PostgreSQL sessions are serialized by the organization row lock.
3. **Idempotency Bound to Creator**: Assert User B cannot access User A's organization using User A's `client_mutation_id`.
4. **Owner-Only Closure**: Assert Admins cannot close organizations via direct SQL update or RPC; assert Owner closure sets audit fields and revokes pending invitations.
5. **Invitation Status-Before-Expiry**: Assert accepted or revoked invitations past their expiration date return their actual status and are not overwritten as `'expired'`.
6. **Active Role & Suspension Protection**: Assert Cashier invites cannot downgrade active Owners or reactivate suspended accounts.
7. **Universal Forced RLS**: Assert RLS is forced across all 4 tables without policy recursion.
8. **RPC Authorization Independence**: Assert every RPC (`transfer_organization_ownership`, `update_member_role`, `update_member_status`, `remove_member`, `close_organization`, `revoke_invitation`) independently rejects unauthenticated callers, unverified-email callers, and operations against closed organizations.
9. **Owner Removal Protection**: Assert `remove_member()` rejects removal of any member with `role = 'owner'` with error `P0011`.
10. **Invitation Mutation Denial**: Assert direct client `UPDATE` on `organization_invitations` is rejected by RLS; assert `revoke_invitation()` only succeeds for pending invitations.
11. **Audit Event Immutability**: Assert direct client `INSERT`, `UPDATE`, and `DELETE` on `organization_audit_events` are rejected by RLS; assert audit events are created by RPCs for ownership transfers, member removals, organization closures, and invitation revocations.

---

## Constitutional Deviations

**Zero Deviations.** The hardened architecture strictly implements all requirements of the BizFlow AI Constitution without exceptions. Forced Row-Level Security is enabled across all tenant tables, multi-record mutations are atomic, direct client membership mutations are completely blocked, and zero client-supplied identifiers are trusted.