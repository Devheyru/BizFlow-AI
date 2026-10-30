# Quickstart Guide: Authentication & Organization Foundation (Hardened Architecture)

**Feature**: `001-auth-organization`  
**Revision Date**: 2026-10-30  
**Status**: Final Authorization, Audit & Timestamp Revision (Pass 4)  

---

## 1. Prerequisites

- **Node.js**: `v20.x` or later
- **npm** / **pnpm** / **bun**
- **Docker**: For running local Supabase with PostgreSQL 15+, Auth, and real RLS:
  ```bash
  npm install -g supabase
  ```

---

## 2. Environment Configuration

Create a `.env.local` file at the repository root based on `.env.example`:

```bash
# Supabase Public API (Accessible by client & server)
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321" # Or Supabase Cloud URL
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"

# Supabase Service Role Key (Used ONLY for local test seeding & migrations; NEVER exposed in client code)
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# Application Base URL (Used for auth redirects)
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

---

## 3. Database Migration & RLS Deployment

Apply the Feature 001 database migration using the Supabase CLI:

```bash
# Start local Supabase containers (PostgreSQL, Auth, Storage)
supabase start

# Apply Feature 001 database migrations, triggers, and RLS policies
supabase db reset
```

This provisions:
1. Enum types: `app_role`, `membership_status`, `invitation_status`.
2. Tables with universal `FORCE ROW LEVEL SECURITY`: `profiles`, `organizations`, `organization_memberships`, `organization_invitations`.
3. Non-recursive security-definer helper functions owned by `postgres` (`BYPASSRLS`): `is_email_verified()`, `get_user_organization_ids()`, `is_org_member()`.
4. Invariant trigger: `trg_check_owner_invariant` with organization-level row locking.
5. Controlled database RPCs enforcing uniform lock ordering:
   - `create_organization_with_owner()` with creator-bound idempotency and email verification.
   - `transfer_organization_ownership()` with promote-before-demote ordering under organization lock.
   - `update_member_role()` & `update_member_status()` preventing privilege escalation.
   - `remove_member()` enforcing owner invariants.
   - `close_organization()` enforcing owner confirmation, audit timestamps, and invitation revocations.
   - `accept_organization_invitation()` with strict status-before-expiry checks and membership state protection.
6. User profile sync trigger: `handle_new_user()` on `auth.users`.
7. Audit events table: `organization_audit_events` with universal `FORCE RLS` and immutable client-side policies.
8. Invitation revocation RPC: `revoke_invitation()` with pending-status validation and audit event recording.

---

## 4. Running the Development Server

```bash
# Install dependencies
npm install

# Start Next.js development server
npm run dev
```

Application runs at `http://localhost:3000`.

---

## 5. Security & Invariant Verification Matrix

| Test ID | Test Scenario | Execution Method | Expected Security Outcome |
| :--- | :--- | :--- | :--- |
| **SEC-01** | **Email Verification Gate** | Call `create_organization_with_owner()` from unconfirmed account | Aborts with `P0001: Email verification required`. |
| **SEC-02** | **Direct Mutation Denial** | Client executes direct `UPDATE` or `DELETE` on `organization_memberships` | Rejected by RLS (`memberships_update_deny_direct`); 0 rows affected. |
| **SEC-03** | **Single-Owner Transfer** | Call `transfer_organization_ownership()` in 1-owner organization | Target promoted first, caller demoted second; invariant passes without violation. |
| **SEC-04** | **Concurrent Demotions** | Two parallel transactions demote two Owners in same org | Organization-level row lock serializes transactions; second transaction aborts with `P0002`. |
| **SEC-05** | **Creator-Bound Idempotency** | User B attempts creation replay using User A's `client_mutation_id` | Does NOT return User A's organization; creates distinct organization for User B. |
| **SEC-06** | **Owner-Only Store Closure** | Admin attempts direct update to `is_active` or calls `close_organization()` | Rejected by RLS / aborts with `P0004: Only verified organization owners can close`. |
| **SEC-07** | **Closure Audit Trail** | Owner closes store with matching confirmation name | Sets `is_active = false`, records `closed_at` and `closed_by`, revokes all pending invitations. |
| **SEC-08** | **Status-Before-Expiry Check** | Call `accept_organization_invitation()` on an accepted or revoked invite past expiry | Returns `ALREADY_ACCEPTED` or `INVITATION_REVOKED`; existing status is NOT overwritten with `expired`. |
| **SEC-09** | **Active Role Protection** | Accept Cashier invite while already an active Owner/Admin | Aborts with `ALREADY_ACTIVE_MEMBER`; existing role is NOT modified. |
| **SEC-10** | **Suspension Protection** | Accept invite while membership `status = 'suspended'` | Aborts with `ACCOUNT_SUSPENDED`; account is NOT reactivated. |
| **SEC-11** | **Universal Forced RLS** | Concurrent queries across all tenant tables under `FORCE RLS` | Queries execute under `authenticated` without PostgreSQL recursion errors. |
| **SEC-12** | **RPC Authorization Independence** | Call `update_member_role()`, `update_member_status()`, `remove_member()` without authentication | Aborts with `P0003: Authentication required`. |
| **SEC-13** | **RPC Email Verification Gate** | Call `transfer_organization_ownership()`, `remove_member()`, `close_organization()` from unverified account | Aborts with `P0001: Email verification required`. |
| **SEC-14** | **Closed Organization Guard** | Call any membership-mutating RPC against a closed organization (`is_active = false`) | Aborts with `P0015: Cannot modify a closed organization`. |
| **SEC-15** | **Owner Removal Protection** | Call `remove_member()` targeting a member with `role = 'owner'` | Aborts with `P0011: Cannot remove an Owner`. |
| **SEC-16** | **Invitation Mutation Denial** | Client executes direct `UPDATE` on `organization_invitations` | Rejected by RLS (`invitations_update_deny_direct`); 0 rows affected. |
| **SEC-17** | **Invitation Revocation RPC** | Call `revoke_invitation()` on a pending invitation as Owner/Admin | Succeeds; invitation status set to `revoked`; audit event recorded. |
| **SEC-18** | **Audit Event Immutability** | Client executes direct `INSERT`, `UPDATE`, or `DELETE` on `organization_audit_events` | Rejected by RLS; 0 rows affected. |
| **SEC-19** | **Audit Event Recording** | Owner closes organization via `close_organization()` | Audit event `organization.closed` recorded with actor, confirmation name, and timestamp. |
| **SEC-20** | **Transfer Authorization Order** | Unauthenticated caller invokes `transfer_organization_ownership(org_id, same_user_id)` | Aborts with `P0003` or `P0004`; does NOT return `no_change_same_user`. |
| **SEC-21** | **Active Organization Gate on Invitation** | Accept invitation to a closed organization | Returns `ORGANIZATION_CLOSED`; membership NOT created. |

---

## 6. Automated Testing

```bash
# Run unit & schema tests (Zod validation, token hashing, ISO code rules)
npm run test

# Run RLS tenant isolation, locking, and trigger integration tests in Supabase emulator
npm run test:integration

# Run Playwright end-to-end browser tests
npm run test:e2e
```