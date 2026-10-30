# Research & Technical Decisions: Authentication & Organization Foundation (Hardened)

**Feature**: `001-auth-organization`  
**Revision Date**: 2026-10-30  
**Status**: Final Authorization, Audit & Timestamp Revision (Pass 4)  

---

## 1. Membership Mutation Governance: Denying Direct Client SQL

### Identified Risk
RLS policies allowing direct client `UPDATE` or `DELETE` on `organization_memberships` create severe bypass vectors:
1. Malicious clients can attempt direct SQL updates to change their own or peer roles without business logic validation.
2. Direct updates bypass the promote-before-demote ownership transfer protocol.
3. Direct deletes bypass the organization-level lock and audit checks.

### Selected Solution
1. **Zero Direct Client Mutations**:
   - `organization_memberships` has explicit denying policies:
     ```sql
     CREATE POLICY "memberships_insert_deny_direct" ON organization_memberships FOR INSERT TO authenticated WITH CHECK (false);
     CREATE POLICY "memberships_update_deny_direct" ON organization_memberships FOR UPDATE TO authenticated USING (false);
     CREATE POLICY "memberships_delete_deny_direct" ON organization_memberships FOR DELETE TO authenticated USING (false);
     ```
2. **Dedicated, Hardened Database RPCs**:
   All membership lifecycle operations are routed through explicit, authenticated stored procedures:
   - `transfer_organization_ownership(p_org_id, p_new_owner_id)`
   - `update_member_role(p_org_id, p_target_user_id, p_new_role)`
   - `update_member_status(p_org_id, p_target_user_id, p_new_status)`
   - `remove_member(p_org_id, p_target_user_id)`
   - `accept_organization_invitation(p_token_hash)`
3. **Immutability of Key Associations**:
   None of the RPCs permit altering `user_id` or `organization_id` on existing membership rows.

### Verification Strategy
Integration tests attempting direct `supabase.from('organization_memberships').update(...)` or `.delete(...)` as both owner and admin; assert PostgreSQL RLS rejects all direct client statements with 0 rows affected.

---

## 2. Owner Concurrency & Uniform Lock Order Protocol

### Identified Risk
Deadlocks and race conditions occur when multiple concurrent transactions lock tables in conflicting orders (e.g. Transaction A locks membership then organization, while Transaction B locks organization then membership).

### Selected Solution
1. **Uniform Lock Hierarchy**:
   Every RPC that modifies, inspects, or demotes an Owner or alters membership state MUST follow an identical, strictly ordered lock sequence:
   ```text
   Step 1: SELECT 1 FROM public.organizations WHERE id = p_org_id FOR UPDATE;
   Step 2: SELECT * FROM public.organization_memberships WHERE organization_id = p_org_id AND user_id = ... FOR UPDATE;
   ```
2. **PostgreSQL Isolation Assumptions**:
   Under PostgreSQL's default `Read Committed` isolation level, row-level locks acquired with `FOR UPDATE` force concurrent transactions to block at Step 1 until the active transaction commits. When unblocked, the waiting transaction re-evaluates the query using the newly committed state, preventing phantom or conflicting demotions.
3. **Database Invariant Trigger as Defense-in-Depth**:
   The `check_owner_invariant()` trigger remains attached to `organization_memberships` as a final automated safeguard against accidental developer oversight.

### Verification Strategy
Concurrency integration test using two independent PostgreSQL connections:
Connection 1 begins a transaction and demotes Owner A in a 2-owner store; Connection 2 simultaneously attempts to demote Owner B. Assert Connection 2 blocks, resumes after Connection 1 commits, and aborts with `P0002` (cannot demote last active owner).

---

## 3. Creator-Bound Idempotency Architecture

### Identified Risk
A global `client_mutation_id` lookup on `organizations` allowed an authenticated user to submit an arbitrary UUID and potentially discover or receive back details of another user's private organization, while hardcoding `role: 'owner'` even if the caller was not the owner.

### Selected Solution
1. **Creator Binding**:
   - Added `created_by UUID NOT NULL REFERENCES public.profiles(id)` to `organizations`.
   - Added composite unique constraint: `CONSTRAINT uq_org_creator_mutation UNIQUE (created_by, client_mutation_id)`.
2. **Caller Scoped Verification**:
   - `create_organization_with_owner()` matches idempotency strictly against `WHERE client_mutation_id = p_client_mutation_id AND created_by = v_user_id`.
   - Dynamically queries `organization_memberships` to return the caller's actual active role (`v_caller_role`), rather than hardcoding `'owner'`.
   - If an organization was previously closed, returns `is_active: false`.

### Verification Strategy
Integration test: User B submits User A's `client_mutation_id`; assert the database does NOT return User A's organization, but proceeds to create User B's distinct organization safely.

---

## 4. Owner-Only Organization Closure & Auditability

### Identified Risk
Allowing Admins to update `organizations` metadata could allow an Admin to set `is_active = false`, unilaterally closing down a retail store.

### Selected Solution
1. **Direct `is_active` Mutation Denied**:
   - RLS policy `organizations_update_admin` explicitly enforces:
     `WITH CHECK (is_active = (SELECT o.is_active FROM public.organizations o WHERE o.id = organizations.id))`.
   - Admins can update contact info, timezone, and business metadata, but cannot alter `is_active`.
2. **Dedicated `close_organization()` RPC**:
   - Restricts execution strictly to active, verified Owners.
   - Enforces exact store name confirmation parameter.
   - Sets `is_active = false`, records `closed_at = now()`, and `closed_by = auth.uid()`.
   - Atomically revokes all pending invitations (`status = 'revoked'`).

### Verification Strategy
Integration tests attempting: (a) Admin updating `is_active = false` via direct update (aborts via RLS check), (b) Admin invoking `close_organization()` (aborts with `P0004`), (c) Owner invoking `close_organization()` with mismatched name (aborts with `P0014`), (d) Owner with correct name (succeeds, logs audit fields, revokes pending invites).

---

## 5. Invitation State-Machine Order of Operations

### Identified Risk
Evaluating expiration before status caused accepted, declined, or revoked invitations to be re-classified and overwritten as `'expired'`.

### Selected Solution
`accept_organization_invitation()` enforces strict sequential status checks before evaluating expiration:
1. If `status = 'accepted'` → return `ALREADY_ACCEPTED` (status unchanged).
2. If `status = 'revoked'` → return `INVITATION_REVOKED` (status unchanged).
3. If `status = 'declined'` → return `INVITATION_DECLINED` (status unchanged).
4. If `status = 'expired'` → return `ALREADY_EXPIRED` (status unchanged).
5. **Only if `status = 'pending'`**:
   - Check `expires_at <= timezone('utc'::text, now())`.
   - If expired: update `status = 'expired'`, commit transaction, and return `INVITATION_EXPIRED`.
   - If valid: check email match, lock organization, check existing membership state, mark `accepted`, and upsert membership.

### Verification Strategy
Integration tests asserting: (a) accepted invite remains `'accepted'` after expiration date passes, (b) revoked invite remains `'revoked'`, (c) expired pending invite commits as `'expired'`.

---

## 6. Privileged `SECURITY DEFINER` Function Audit Matrix

| Function Name | Owner | Search Path | Granted Roles | Bypasses RLS? | Justification & Minimum Privilege |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `is_email_verified()` | `postgres` | `pg_catalog, auth, pg_temp` | `authenticated` | Yes (reads `auth.users`) | Required to read `auth.users.email_confirmed_at` safely without exposing the `auth` schema to client roles. |
| `get_user_organization_ids()` | `postgres` | `pg_catalog, public, pg_temp` | `authenticated` | Yes (reads `memberships`) | Prevents RLS recursion when `FORCE RLS` is enabled on `organization_memberships`. Returns only calling user's org IDs. |
| `is_org_member()` | `postgres` | `pg_catalog, public, pg_temp` | `authenticated` | Yes (reads `memberships`) | Core RLS helper evaluating tenant authorization without policy recursion. |
| `create_organization_with_owner()` | `postgres` | `pg_catalog, public, pg_temp` | `authenticated` | Yes | Atomically inserts organization and initial owner membership where direct client inserts are barred by RLS. |
| `transfer_organization_ownership()` | `postgres` | `pg_catalog, public, pg_temp` | `authenticated` | Yes | Atomic two-row role swap under exclusive organization lock where direct updates are barred by RLS. |
| `update_member_role()` | `postgres` | `pg_catalog, public, pg_temp` | `authenticated` | Yes | Controlled role modification preventing Admin privilege escalation where direct updates are barred. |
| `update_member_status()` | `postgres` | `pg_catalog, public, pg_temp` | `authenticated` | Yes | Controlled suspension/revocation preventing Admin privilege escalation where direct updates are barred. |
| `remove_member()` | `postgres` | `pg_catalog, public, pg_temp` | `authenticated` | Yes | Owner-only deletion enforcing owner invariants where direct client deletes are barred. |
| `close_organization()` | `postgres` | `pg_catalog, public, pg_temp` | `authenticated` | Yes | Owner-only soft-closure setting audit timestamps and revoking pending invites. |
| `accept_organization_invitation()` | `postgres` | `pg_catalog, public, pg_temp` | `authenticated` | Yes | Multi-table atomic redemption (invitation status update + membership upsert + token hash verification). |
| `revoke_invitation()` | `postgres` | `pg_catalog, public, pg_temp` | `authenticated` | Yes | Owner/Admin-only invitation revocation where direct client updates are barred. Validates pending status and records audit event. |
| `handle_new_user()` | `postgres` | `pg_catalog, public, pg_temp` | Trigger only | Yes | Trigger on `auth.users` synchronizing new accounts into `public.profiles`. |

---

## 7. Timestamp Convention: `now()` vs `timezone('utc'::text, now())`

### Identified Risk
Using `timezone('utc'::text, now())` as a `TIMESTAMPTZ` column default produces a `TIMESTAMP WITHOUT TIME ZONE` value. PostgreSQL then re-interprets this value according to the session `timezone` when storing it into a `TIMESTAMPTZ` column, which can introduce silent conversion errors if the session timezone is not UTC.

### Selected Solution
All `TIMESTAMPTZ` column defaults and comparisons use `now()` directly. PostgreSQL stores `TIMESTAMPTZ` values internally as UTC microseconds since the Unix epoch, regardless of the session `timezone` setting. Using `now()` produces a proper `TIMESTAMPTZ` value that is stored correctly under all session configurations.

### Verification Strategy
Integration test: Set session timezone to a non-UTC value (e.g., `SET timezone = 'US/Eastern'`); create an organization; verify `created_at` is stored as the correct UTC time. Verify `expires_at <= now()` comparisons on invitations produce correct results regardless of session timezone.

---

## 8. Reconciled Standards & Lifecycle Protocols

1. **Password Complexity**:
   - Reconciled across specification and Zod schemas: minimum 8 characters, at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character (`[!@#$%^&*(),.?":{}|<>]`).
2. **ISO Code Validation**:
   - Country: ISO 3166-1 alpha-2 validated by Zod `/^[A-Z]{2}$/` and DB check `country ~ '^[A-Z]{2}$'`.
   - Currency: ISO 4217 validated by Zod `/^[A-Z]{3}$/` and DB check `currency ~ '^[A-Z]{3}$'`.
3. **Invitation Token Registration Lifecycle**:
   - When an unauthenticated invitee accesses `/invitations/accept?token=<TOKEN>`, the app preserves the raw token in `?next=/invitations/accept?token=<TOKEN>` through registration and Supabase Auth email confirmation redirect (`emailRedirectTo`). Upon email confirmation, the user is authenticated, verified, and redirected back to accept the invitation seamlessly.
4. **Session Revocation on Password Reset**:
   - Supabase Auth rotates the refresh token family upon password reset, terminating sessions across all devices. Open-redirect protection sanitizes callback parameters.

---

## 9. Organization Audit Events & Invitation Mutation Governance

### Identified Risk
1. Critical lifecycle operations (organization closure, ownership transfer, member removal) lacked a persistent audit trail at the database level.
2. Direct client `UPDATE` on `organization_invitations` allowed broad modifications to invitation fields (status, role, email, expires_at), bypassing the intended invitation lifecycle.

### Selected Solution
1. **Immutable Audit Table**: `organization_audit_events` records lifecycle events (closures, ownership transfers, member removals, invitation revocations) atomically within their respective RPCs. Direct client `INSERT`, `UPDATE`, and `DELETE` are denied by RLS; only `SECURITY DEFINER` RPCs can write audit entries.
2. **Invitation Mutation Denial**: Direct client `UPDATE` on `organization_invitations` is denied by RLS (`USING (false)`). Invitation revocation is handled exclusively by `revoke_invitation()`, which validates authentication, email verification, active organization, caller role (owner/admin), and pending status before revoking.
3. **Consistent RPC Authorization**: Every protected RPC independently validates authentication, email verification, active organization, and caller role. No lifecycle-mutating operations are permitted on closed organizations.

### Verification Strategy
Integration tests: (a) Assert direct client `UPDATE` on `organization_invitations` fails with 0 rows affected; (b) Assert `revoke_invitation()` rejects non-pending invitations; (c) Assert audit events are created for ownership transfers, member removals, organization closures, and invitation revocations; (d) Assert direct client writes to `organization_audit_events` are denied.

---

## 10. Consistent RPC Authorization Enforcement

### Identified Risk
Several RPCs (`update_member_role`, `update_member_status`, `remove_member`) did not independently verify authentication, email confirmation, or organization active status. An unauthenticated or unverified caller could potentially invoke these functions if they bypassed the Server Action layer. Additionally, `transfer_organization_ownership()` returned a success-looking no-op response to unauthorized callers when `caller == target` before checking ownership.

### Selected Solution
1. **Uniform Authorization Preamble**: Every protected RPC follows a consistent sequence: (1) Authenticate `auth.uid()`, (2) Verify email `is_email_verified()`, (3) Lock and validate organization `is_active`, (4) Verify caller role and membership, (5) Then proceed with business logic.
2. **Transfer Authorization Fix**: `transfer_organization_ownership()` now performs authentication, email verification, organization locking/validation, and caller ownership verification BEFORE handling the same-user no-op. Unauthorized callers receive an exception, never a success-looking JSON response.
3. **Owner Removal Protection**: `remove_member()` now rejects removal of any member with `role = 'owner'`. Ownership changes MUST go through `transfer_organization_ownership()`.
4. **Closed Organization Guard**: All lifecycle-mutating RPCs reject operations on organizations where `is_active = false` with error code `P0015`.

### Verification Strategy
Integration tests for each RPC: (a) Assert unauthenticated call raises `P0003`; (b) Assert unverified-email call raises `P0001`; (c) Assert call against closed organization raises `P0015`; (d) Assert `transfer_organization_ownership()` with `caller = target` raises `P0004` when caller is not owner; (e) Assert `remove_member()` rejects removal of any Owner with `P0011`.