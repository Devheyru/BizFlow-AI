# Quickstart Guide: Authentication & Organization Foundation (Hardened Architecture)

**Feature**: `001-auth-organization`  
**Revision Date**: 2026-11-02  
**Status**: Feature 001 Complete & Verified (Phase 8 Final Polish)  

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

Apply the complete set of 8 database migrations using the Supabase CLI:

```bash
# Start local Supabase containers (PostgreSQL, Auth, Storage)
npx supabase start

# Apply Feature 001 database migrations, triggers, and RLS policies
npx supabase db reset
```

This provisions the complete foundation:
1. **Schema & Types** (`01_auth_organization_schema.sql`):
   - Enums: `app_role` (`owner`, `admin`, `manager`, `cashier`), `membership_status` (`active`, `suspended`, `revoked`).
   - Tables: `profiles`, `organizations`, `organization_memberships`, `organization_audit_events`.
2. **Auth Triggers** (`02_auth_triggers.sql`):
   - User profile auto-creation trigger: `handle_new_user()` on `auth.users`.
   - Single-owner invariant trigger: `trg_check_owner_invariant`.
3. **Security Helpers** (`03_security_helpers.sql` & `06_security_remediation.sql`):
   - Non-recursive security-definer helper functions owned by `postgres`:
     - `is_email_verified()`
     - `get_user_organization_ids()` (filters strictly for `om.status = 'active'` AND `o.is_active = true`)
     - `is_org_member(p_org_id, p_roles)`
4. **Universal FORCE RLS** (`04_rls_policies.sql`):
   - Universal `FORCE ROW LEVEL SECURITY` on all tenant tables.
   - Strict deny-all direct client mutation policies on `organization_memberships` and `organization_audit_events`.
5. **Hardening & Immutability** (`05_security_hardening.sql` & `06_security_remediation.sql`):
   - Immutable fields guard on organizations (`created_by`, `created_at`, `client_mutation_id`).
   - Dropped all temporary test RPCs (`demote_member_role_for_testing`).
6. **Creator-Bound Onboarding RPC** (`07_create_organization_rpc.sql`):
   - `create_organization_with_owner()` with database-level input validation, ISO checks, creator-bound idempotency, and atomic Owner assignment.
7. **Atomic Single-Use Recovery Grants** (`08_recovery_grants.sql`):
   - Table `recovery_grants` with strict RLS and exclusive SECURITY DEFINER access.
   - Atomic stored procedures: `create_recovery_grant()`, `verify_recovery_grant()`, and `consume_recovery_grant()` utilizing PostgreSQL row locking.

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
| **SEC-07** | **Closure Audit Trail** | Owner closes store with matching confirmation name | Sets `is_active = false`, records `closed_at` and `closed_by`. |
| **SEC-08** | **Universal Forced RLS** | Concurrent queries across all tenant tables under `FORCE RLS` | Queries execute under `authenticated` without PostgreSQL recursion errors. |
| **SEC-09** | **Audit Event Immutability** | Client executes direct `INSERT`, `UPDATE`, or `DELETE` on `organization_audit_events` | Rejected by RLS; 0 rows affected. |
| **SEC-10** | **Cross-Tenant URL Isolation** | User A accesses `/[org-b-slug]/dashboard` | Gated by `getTenantContext()`; renders `404 Not Found` (anti-enumeration). |
| **SEC-11** | **Suspended Member Workspace Access** | Suspended user attempts access to tenant workspace | Gated by `getTenantContext()`; renders `404 Not Found`. |
| **SEC-12** | **Closed Org Workspace Access** | User attempts access to closed organization workspace | Gated by `getTenantContext()`; renders `404 Not Found`. |
| **SEC-13** | **Active Org Cookie Manipulation** | User manipulates `bizflow_active_org` cookie to unauthorized org ID | Server action and context resolver reject cookie and route to authorized fallback. |
| **SEC-14** | **Atomic Recovery Nonce Replay** | Concurrent requests submit password reset with identical recovery grant | PostgreSQL row lock consumes nonce atomically; exactly 1 succeeds, second fails with `UNAUTHORIZED_RECOVERY`. |
| **SEC-15** | **Cryptographic Recovery Verification** | Attacker tampers with recovery grant or JWT token | `supabase.auth.getUser()` verifies signature with GoTrue; fails with `unauthorized`. |
| **SEC-16** | **Authoritative Profile Source** | Update user profile while GoTrue user_metadata sync fails | `public.profiles` updates authoritatively; metadata sync failure logged as warning without rollback. |

---

## 6. Automated Verification Gates

Execute all seven verification gates before shipping:

```bash
# 1. Clean Database Reset
npx supabase db reset

# 2. Strict TypeScript Typecheck (Zero bypasses)
npm run typecheck

# 3. Code Style & Linting
npm run lint

# 4. Unit Test Suite (98 tests across 10 suites)
npm run test:unit

# 5. Integration Test Suite (125 tests across 11 suites)
npm run test:integration

# 6. Playwright End-to-End Tests (30 tests across 5 suites)
npx playwright test

# 7. Production Build Verification
npm run build
```
