# Database RPC Contracts: Feature 002 — Employee Management & RBAC

**Feature Branch**: `002-employee-rbac`  
**Date**: 2026-11-03  
**Status**: Completed  
**Governing Documents**:
- [BizFlow AI Constitution v1.1.0](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/.specify/memory/constitution.md)
- [Feature 002 Specification](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/specs/002-employee-rbac/spec.md)
- [Data Model & Schema](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/specs/002-employee-rbac/data-model.md)

All stored procedures execute with `SECURITY DEFINER`, search path locked to `pg_catalog, public, pg_temp`, and ownership assigned to `postgres`. Execution permissions are explicitly defined per procedure; default `PUBLIC` execution is revoked.

Every privileged stored procedure independently validates caller identity (`auth.uid() IS NOT NULL`), verified active membership, and granular role/permission gates at the database level without relying on client or application-layer assertions.

### Database Permission Resolution Rule
When a stored procedure verifies permissions (e.g., `employees:read`, `employees:invite`, `employees:update_role`, `employees:suspend`, `employees:remove`, `employees:invitations_revoke`):
1. **Catalog Existence Requirement**: The evaluated permission key MUST exist in `public.permissions`. If the key does not exist in the permissions catalog, access is denied for all roles, including `Owner`.
2. **Owner Automatic Access**: For registered permissions, an active `Owner` dynamically and automatically receives access.
3. **Other Roles**: For `Admin`, `Manager`, and `Cashier`, the procedure queries `public.role_permissions` for `(caller_role, permission_id)`.
4. **Unknown Permissions Denied**: Unknown or unregistered permission keys are always denied (`false` / `P0005`).

---

## 1. `create_organization_invitation`

### Function Signature
```sql
CREATE OR REPLACE FUNCTION public.create_organization_invitation(
    p_org_id UUID,
    p_email TEXT,
    p_role public.app_role,
    p_token_hash TEXT,
    p_expires_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp;
```

### Database-Level Input Validation
- `p_org_id`: Must be a valid, non-null UUID (Error: `P0009`).
- `p_email`: Must be non-null, normalized lowercase (`lower(trim(p_email))`), length between 5 and 255 characters, and conform to RFC 5322 regex: `^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$` (Error: `P0009`).
- `p_token_hash`: Must be non-null, exactly 64 lowercase hexadecimal characters matching `^[a-f0-9]{64}$` (Error: `P0009`).
- `p_expires_at`: Must be strictly in the future and enforce a maximum invitation lifetime of exactly 7 days at the database boundary (`now() < p_expires_at AND p_expires_at <= now() + INTERVAL '7 days'`) (Error: `P0009`).
- `p_role`: Must be a valid `public.app_role` enum value (`'admin'`, `'manager'`, `'cashier'`, `'owner'`).

### Caller Identity & Authorization Checks
1. `auth.uid() IS NOT NULL` (Error: `P0003` - Authentication required).
2. Caller must hold an active membership (`status = 'active'`) in active organization `p_org_id` (`is_active = true`) (Error: `P0004` - Not an active member).
3. Caller must possess `employees:invite` permission (Owner or Admin) (Error: `P0005` - Insufficient permission).
4. **Privilege Escalation Prevention**: If caller holds `admin` role, `p_role` MUST NOT be `'owner'` (Error: `P0020` - Admins cannot invite Owners).
5. **Existing Active Member Check**: `p_email` must not match any user who currently holds an `active` membership in `p_org_id` (Error: `P0021` - User is already an active member).
6. **Concurrent Duplicate Check**: Handled by pre-check and atomic trapping of `unique_violation` from partial unique index `uq_pending_invitation` on `(organization_id, lower(email)) WHERE status = 'pending'` (Error: `P0022` - An active invitation is already pending for this email address).

### Execution Privileges
```sql
ALTER FUNCTION public.create_organization_invitation OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_organization_invitation FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_organization_invitation TO authenticated;
```

### Return Payload (JSONB)
```json
{
  "invitation_id": "00000000-0000-0000-0000-000000000000",
  "organization_id": "00000000-0000-0000-0000-000000000000",
  "email": "employee@store.com",
  "role": "manager",
  "status": "pending",
  "expires_at": "2026-11-10T12:00:00Z"
}
```

---

## 2. `validate_invitation_token`

Pre-flight token validation used before rendering acceptance screens. Strictly omits sensitive tenant and role metadata to unauthenticated callers to prevent token fishing and enumeration.

### Function Signature
```sql
CREATE OR REPLACE FUNCTION public.validate_invitation_token(
    p_token_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, pg_temp;
```

### Database-Level Input Validation
- `p_token_hash`: Must be non-null and match `^[a-f0-9]{64}$`. If malformed or null, returns `{ "is_valid": false, "is_expired": false, "status": null }`.

### Internal Logic
1. Queries `public.organization_invitations` where `token_hash = p_token_hash`.
2. If record does not exist: returns `{ "is_valid": false, "is_expired": false, "status": null }`.
3. If `status = 'pending'` and `expires_at > now()`: returns `{ "is_valid": true, "is_expired": false, "status": "pending" }`.
4. If `expires_at <= now()`: returns `{ "is_valid": false, "is_expired": true, "status": "expired" }`.
5. If `status` in (`'accepted'`, `'declined'`, `'revoked'`): returns `{ "is_valid": false, "is_expired": false, "status": v_status }`.

### Disclosure Restrictions
- Does **NOT** return organization name, organization ID, invitee email, or assigned role. This prevents arbitrary visitors from harvesting tenant information.
- Pre-flight validation is informational only. `accept_organization_invitation` and `decline_organization_invitation` independently re-validate the token under row locks.

### Execution Privileges
```sql
ALTER FUNCTION public.validate_invitation_token OWNER TO postgres;
REVOKE ALL ON FUNCTION public.validate_invitation_token FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_invitation_token TO anon, authenticated, service_role;
```

---

## 3. `accept_organization_invitation`

### Function Signature
```sql
CREATE OR REPLACE FUNCTION public.accept_organization_invitation(
    p_token_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp;
```

### Database-Level Input Validation
- `p_token_hash`: Must match `^[a-f0-9]{64}$` (Error: `P0009`).

### Caller Identity & Authorization Checks
1. `auth.uid() IS NOT NULL` (Error: `P0003` - Authentication required).
2. Caller email must be confirmed (`public.is_email_verified()` is true) (Error: `P0001` - Email verification required).
3. Acquires row-level lock on invitation record:
   `SELECT * INTO v_invite FROM public.organization_invitations WHERE token_hash = p_token_hash FOR UPDATE;`
4. If invitation not found: returns `{ "success": false, "code": "INVITATION_NOT_FOUND", "message": "Invalid invitation link." }`.
5. If `v_invite.status != 'pending'`: returns `{ "success": false, "code": "INVITATION_NOT_PENDING", "message": "This invitation has already been processed.", "status": v_invite.status }`.
6. **Transaction-Safe Lazy Expiration**:
   - If `v_invite.expires_at <= now()`:
     - `UPDATE public.organization_invitations SET status = 'expired', updated_at = now() WHERE id = v_invite.id;`
     - Returns `{ "success": false, "code": "INVITATION_EXPIRED", "message": "This invitation has expired." }`.
     - *Guarantee*: Transaction commits cleanly, permanently recording `'expired'` status without rollback.
7. **Email Mismatch Privacy Protection**:
   - Asserts caller's verified email matches `lower(trim(v_invite.email))`.
   - If mismatched, returns:
     `{ "success": false, "code": "EMAIL_MISMATCH", "message": "The authenticated account does not match the invitation recipient." }`
   - *Privacy Rule*: Strictly omits expected or actual email addresses to prevent email enumeration or identity leakage.
8. **Atomic Membership Creation & State Transition**:
   - Inserts row into `public.organization_memberships` with `role = v_invite.role` and `status = 'active'`.
   - Updates `organization_invitations` status to `'accepted'`.
   - Inserts immutable audit event into `public.organization_audit_events` with `event_type = 'employee:joined'`.

### Execution Privileges
```sql
ALTER FUNCTION public.accept_organization_invitation OWNER TO postgres;
REVOKE ALL ON FUNCTION public.accept_organization_invitation FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_organization_invitation TO authenticated;
```

### Return Payload (JSONB)
```json
{
  "success": true,
  "organization_id": "00000000-0000-0000-0000-000000000000",
  "organization_slug": "central-market",
  "role": "manager",
  "status": "active"
}
```

---

## 4. `decline_organization_invitation`

### Function Signature
```sql
CREATE OR REPLACE FUNCTION public.decline_organization_invitation(
    p_token_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp;
```

### Invariants & Privacy
- Validates token hash format.
- Requires authenticated user whose verified email matches `lower(trim(invitation.email))` (returns generic `EMAIL_MISMATCH` if mismatched).
- Acquires row lock `FOR UPDATE`.
- Enforces transaction-safe lazy expiration (`expires_at <= now()`).
- Updates `status = 'declined'`.
- Inserts audit event `employee:invitation_declined`.

### Execution Privileges
```sql
ALTER FUNCTION public.decline_organization_invitation OWNER TO postgres;
REVOKE ALL ON FUNCTION public.decline_organization_invitation FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decline_organization_invitation TO authenticated;
```

---

## 5. `resend_organization_invitation`

### Function Signature
```sql
CREATE OR REPLACE FUNCTION public.resend_organization_invitation(
    p_invitation_id UUID,
    p_new_token_hash TEXT,
    p_new_expires_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp;
```

### Database-Level Input Validation
- `p_invitation_id`: Valid UUID (Error: `P0009`).
- `p_new_token_hash`: Exactly 64 lowercase hex characters `^[a-f0-9]{64}$` (Error: `P0009`).
- `p_new_expires_at`: Must be strictly in the future and enforce a maximum invitation lifetime of exactly 7 days at the database boundary (`now() < p_new_expires_at AND p_new_expires_at <= now() + INTERVAL '7 days'`) (Error: `P0009`).

### Caller Identity & Authorization Checks
- Caller must be an active member of the target organization holding `employees:invite` permission (Owner or Admin) (Error: `P0005`).
- Target invitation must exist and be in `pending` or `expired` status (Error: `P0026` - Cannot resend an accepted, declined, or revoked invitation).
- Updates `token_hash = p_new_token_hash`, `expires_at = p_new_expires_at`, `status = 'pending'`, `updated_at = now()`.
- Logs audit event `employee:invitation_resent`.

### Execution Privileges
```sql
ALTER FUNCTION public.resend_organization_invitation OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resend_organization_invitation FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resend_organization_invitation TO authenticated;
```

---

## 6. `revoke_organization_invitation`

### Function Signature
```sql
CREATE OR REPLACE FUNCTION public.revoke_organization_invitation(
    p_invitation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp;
```

### Invariants Enforced
- Caller must hold active membership with `employees:invitations_revoke` permission (Owner or Admin).
- Target invitation must currently be in `pending` status.
- Transitions status to `'revoked'`, immediately rendering the token hash unusable.
- Logs `employee:invitation_revoked` audit event.

### Execution Privileges
```sql
ALTER FUNCTION public.revoke_organization_invitation OWNER TO postgres;
REVOKE ALL ON FUNCTION public.revoke_organization_invitation FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_organization_invitation TO authenticated;
```

---

## 7. `update_organization_member_role`

### Function Signature
```sql
CREATE OR REPLACE FUNCTION public.update_organization_member_role(
    p_org_id UUID,
    p_target_membership_id UUID,
    p_new_role public.app_role
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp;
```

### Database-Level Validation & Invariants
1. `p_org_id` and `p_target_membership_id` must be valid UUIDs (Error: `P0009`).
2. `p_new_role` must be a valid `public.app_role` enum value.
3. Caller must be an active member of `p_org_id` with `employees:update_role` permission (Error: `P0005`).
4. **Self-Modification Prevention**: Caller cannot modify their own membership role (`v_caller_mem.id != p_target_membership_id`) (Error: `P0023`).
5. **Permitted Target Status Check**: Target membership must exist in `p_org_id`. If target membership `status = 'revoked'`, REJECT with error `P0025` ("Cannot modify a revoked membership. Revocation is terminal.").
6. **Privilege Escalation Boundaries**:
   - If caller holds `admin` role:
     - Target member's current role cannot be `Owner` (Error: `P0020` - Admins cannot demote Owners).
     - `p_new_role` cannot be `Owner` (Error: `P0020` - Admins cannot promote to Owner).
     - Target role must be `'admin'`, `'manager'`, or `'cashier'`.
7. **Last Active Owner Invariant**:
   - If target member is `Owner` and `p_new_role != 'owner'`:
     - Database trigger `check_owner_invariant` executes automatically, locks `organizations` row `FOR UPDATE`, and aborts with `P0002` if this would leave the organization with 0 active owners.
8. Updates `role = p_new_role, updated_at = now()`.
9. Logs `employee:role_updated` audit event with previous role, new role, and actor ID.

### Execution Privileges
```sql
ALTER FUNCTION public.update_organization_member_role OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_organization_member_role FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_organization_member_role TO authenticated;
```

---

## 8. `update_organization_member_status`

### Function Signature
```sql
CREATE OR REPLACE FUNCTION public.update_organization_member_status(
    p_org_id UUID,
    p_target_membership_id UUID,
    p_new_status public.membership_status
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp;
```

### Database-Level Validation & Status Transition Rules
1. `p_org_id` and `p_target_membership_id` must be valid UUIDs (Error: `P0009`).
2. `p_new_status` must be `'active'`, `'suspended'`, or `'revoked'`.
3. Caller must be an active member of `p_org_id`.
4. **Self-Modification Prevention**: Caller cannot change their own membership status (`v_caller_mem.id != p_target_membership_id`) (Error: `P0024`).
5. **Permitted Status Transitions & Terminal Revocation**:
   - Target membership current status cannot be `'revoked'`. If current status is `'revoked'`, REJECT with error `P0025` ("Cannot modify a revoked membership. Revocation is terminal.").
   - Permitted transitions:
     - `active` $\rightarrow$ `suspended` (Requires `employees:suspend` permission)
     - `suspended` $\rightarrow$ `active` (Requires `employees:suspend` permission)
     - `active` $\rightarrow$ `revoked` (Requires `employees:remove` permission)
     - `suspended` $\rightarrow$ `revoked` (Requires `employees:remove` permission)
     - Any other transition is rejected with `P0009` ("Invalid membership status transition").
6. **Privilege Boundaries**:
   - If caller holds `admin` role: target member cannot be `Owner` (Error: `P0020`).
7. **Last Active Owner Invariant**:
   - If target member is `Owner`: database trigger `check_owner_invariant` aborts with `P0002` if deactivation or revocation would leave 0 active owners.
8. Updates `status = p_new_status, updated_at = now()`.
9. Logs `employee:suspended`, `employee:reactivated`, or `employee:removed` audit event.

### Execution Privileges
```sql
ALTER FUNCTION public.update_organization_member_status OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_organization_member_status FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_organization_member_status TO authenticated;
```

---

## 9. `get_organization_employees`

### Function Signature
```sql
CREATE OR REPLACE FUNCTION public.get_organization_employees(
    p_org_id UUID
)
RETURNS TABLE (
    membership_id UUID,
    user_id UUID,
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    phone TEXT,
    role public.app_role,
    status public.membership_status,
    joined_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, pg_temp;
```

### Authoritative Permission & Security Enforcement
1. Caller authentication: `auth.uid() IS NOT NULL` (Error: `P0003`).
2. Caller membership: Caller must hold an active membership (`status = 'active'`) in active organization `p_org_id` (`is_active = true`) (Error: `P0004`).
3. **Authoritative `employees:read` Permission Check**:
   - Procedure evaluates whether caller holds `employees:read`:
     - Requires `'employees:read'` to exist in `public.permissions` catalog (if missing, REJECT with error `P0005`).
     - If caller has `role = 'owner'`, access is granted automatically for registered permissions.
     - For other roles (`admin`, `manager`, `cashier`), queries `public.role_permissions` for caller's `role` and `permission_id = 'employees:read'`.
     - Unknown or unregistered permission keys are strictly denied for all roles, including Owner.
     - If permission is not held (e.g. caller has role `cashier`), REJECT with error `P0005` ("Insufficient permissions to view employee directory").
4. **Sanitized Minimal Field Projection**:
   - Performs inner join across `organization_memberships`, `profiles`, and `auth.users(email)`.
   - Returns strictly the operational columns: `membership_id`, `user_id`, `first_name`, `last_name`, `email`, `phone` (nullable), `role`, `status`, `joined_at` (`created_at`).
   - Excludes `revoked` memberships by default to focus on the active workforce.
   - Omits passwords, tokens, metadata, and memberships in other organizations.

### Execution Privileges
```sql
ALTER FUNCTION public.get_organization_employees OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_organization_employees FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_organization_employees TO authenticated;
```
