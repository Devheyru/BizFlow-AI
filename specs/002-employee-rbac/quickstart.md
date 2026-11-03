# Developer Quickstart: Feature 002 — Employee Management & RBAC

**Feature Branch**: `002-employee-rbac`  
**Date**: 2026-11-03  
**Status**: Ready for Implementation  

This guide provides step-by-step instructions for developers to verify and test Feature 002 locally and in automated test environments.

---

## 1. Prerequisites

1. Local Supabase CLI running (`supabase status`).
2. Node.js 20+ and npm dependencies installed.
3. Feature 001 migrations (01 through 08) applied cleanly.

---

## 2. Database Migration & Permissions Seeding

Apply the Feature 002 database migration:

```bash
# Reset local database to verify clean migration application
supabase db reset

# Verify all migrations applied cleanly including Feature 002
supabase migration list
```

Verify that the `permissions` table and `role_permissions` mapping table are populated:

```sql
SELECT count(*) FROM public.permissions; -- Expect 7 initial permissions
SELECT role, count(*) FROM public.role_permissions GROUP BY role; -- admin: 7, manager: 1
```

---

## 3. Automated Test Execution

### 3.1 Unit Tests (Schemas & Permissions)
Run unit tests verifying Zod schemas, role hierarchy boundaries, and the `hasPermission` resolution engine:

```bash
npm run test:unit -- tests/unit/auth/permissions.test.ts tests/unit/validations/employee.test.ts
```

### 3.2 Integration Tests (RPCs, RLS & Invariants)
Run database integration tests against local Supabase:

```bash
npm run test:integration -- tests/integration/invitations-rls.test.ts tests/integration/employee-rbac.test.ts
```

Key test scenarios executed:
- **`invitations_insert_deny_direct`**: Direct client `INSERT` into `organization_invitations` is rejected with `42501`.
- **Privilege Escalation**: Admin attempting to invite or promote an `Owner` is rejected.
- **Maximum Lifetime Boundary**: Attempting to issue or resend an invitation with `p_expires_at > now() + INTERVAL '7 days'` is rejected with `P0009`.
- **Transaction-Safe Expiration**: Invitation past 7 days returns `INVITATION_EXPIRED` and status is durably committed to `expired`.
- **Email Mismatch Rejection**: Authenticated user with different email cannot accept invitation (returns generic `EMAIL_MISMATCH` privacy code).
- **Owner Permission Catalog Bounding**: Querying an unregistered permission key returns `false` / `P0005` for all roles including Owner; registered permissions grant Owner access automatically.
- **Last Active Owner Invariant**: Demoting or suspending the sole Owner is aborted with `P0002`.
- **Immediate Lockout**: Suspended or revoked member immediately fails `resolveTenantContext()`.

---

## 4. Manual Verification Flow (Browser Testing)

1. **Sign In as Store Owner**:
   - Navigate to `http://localhost:3000/sign-in`.
   - Access store workspace: `http://localhost:3000/[slug]/dashboard`.
2. **Access Employee Directory**:
   - Click **Employees** in the navigation header (`/[slug]/employees`).
   - Confirm your Owner record is visible with `Active` badge.
3. **Send an Invitation**:
   - Click **Invite Employee**.
   - Enter email: `manager.test@store.com`, select role: `Manager`.
   - Submit. Verify pending invitation card appears in the list.
4. **Accept Invitation**:
   - Copy the invitation link from terminal/mail log (`/invitations/accept?token=...`).
   - Open incognito window, sign up or sign in as `manager.test@store.com`.
   - Click **Accept Invitation**.
   - Verify immediate redirect to `/[slug]/dashboard` as Manager.
5. **Verify Role & Permission Boundaries**:
   - As Manager, navigate to `/[slug]/employees`: verify employee list is visible (`employees:read`).
   - Verify the **Invite Employee** and **Change Role** buttons are NOT rendered.
   - Attempting to submit role changes via server actions returns `403 Forbidden`.
6. **Suspend & Remove**:
   - As Owner, click **Suspend** on the Manager: verify badge changes to `Suspended`.
   - In the Manager's session, refresh the page: verify immediate `404 Not Found` lockout.

