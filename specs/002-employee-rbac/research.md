# Research & Technical Decisions: Feature 002 — Employee Management & RBAC

**Feature Branch**: `002-employee-rbac`  
**Date**: 2026-11-03  
**Status**: Completed  
**Governing Documents**:
- [BizFlow AI Constitution v1.1.0](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/.specify/memory/constitution.md)
- [Master Project Blueprint](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/docs/MASTER_PROJECT_BLUEPRINT.md)
- [Feature 002 Specification](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/specs/002-employee-rbac/spec.md)

---

## 1. Technical Decisions & Research Findings

### Decision 1: Role-Based Access Control Architecture (Hybrid Model)

- **Context**: The system must enforce granular access control for employee management and establish an extensible pattern for future modules (Products, Inventory, Sales, Finance), while preserving existing Feature 001 database triggers (`check_owner_invariant`) and RLS policies (`is_org_member`).
- **Decision**: Implement a **hybrid RBAC model**:
  1. Retain `role public.app_role` (`'owner'`, `'admin'`, `'manager'`, `'cashier'`) on `public.organization_memberships` as the baseline primary role.
  2. Introduce `public.permissions` (system-wide catalog of colon-separated permission keys: `employees:read`, `employees:invite`, etc.) and `public.role_permissions` (mapping `public.app_role` to `permission_id`).
  3. Authoritative Permission Resolution:
     - Require the permission key to exist in `public.permissions` before granting access to any role, including Owner.
     - For registered permissions, the `Owner` role receives access automatically (`hasPermission` returns `true`).
     - For other roles (`Admin`, `Manager`, `Cashier`), check `public.role_permissions` for the caller's role and permission key.
     - Unknown or unregistered permission keys MUST always be denied (`false`) for all roles, including Owner.
     - Apply this resolution logic consistently across database RPC contracts and the TypeScript `hasPermission` resolver design.
- **Rationale**:
  - Preserves 100% backward compatibility with Feature 001 triggers (`check_owner_invariant()`), foreign keys, and RLS policies (`is_org_member`).
  - Decouples application authorization logic from hardcoded role names.
  - Guarantees that typos or unregistered permissions fail securely (evaluating to `false` for all roles, including Owner).
- **Alternatives Considered**:
  - *Full dynamic custom roles*: Creating custom roles per organization (`roles` table). Rejected for MVP because Master Blueprint Section 4 defines four primary roles for retail operations; custom roles add significant schema and UI complexity without immediate operational necessity.
  - *Hardcoded role checks in UI/actions (`role === 'admin' || role === 'owner'`)*: Fragile, scatters role logic throughout the codebase, and violates Constitution Principle IV.

---

### Decision 2: Mutable Invitation Lifecycle vs. Append-Only Audit Trail & Lazy Expiration

- **Context**: Invitations expire 7 days after creation. When an expired invitation is accessed or attempted, the system must reject the acceptance and durably record `status = 'expired'` in the database without requiring cron jobs or scheduled workers.
- **Architectural Distinction**:
  - `organization_invitations` is a **mutable lifecycle state machine**: records transition through `pending` $\rightarrow$ `accepted`, `declined`, `revoked`, or `expired`.
  - `organization_audit_events` is the **immutable, append-only audit trail**: every status change, invitation dispatch, and role adjustment records an immutable audit log entry.
- **Problem**: In PostgreSQL, if an atomic stored procedure updates `status = 'expired'` and then raises an unhandled exception (`RAISE EXCEPTION`), the entire transaction aborts and rolls back the `UPDATE`, leaving the record in `'pending'` status.
- **Decision**: The database stored procedure `accept_organization_invitation()` MUST employ a **structured response pattern**:
  - The procedure acquires a row-level lock (`SELECT ... FOR UPDATE`).
  - If `expires_at <= now()`, the procedure executes `UPDATE organization_invitations SET status = 'expired', updated_at = now() WHERE id = ...;` and returns a structured JSONB payload:
    `jsonb_build_object('success', false, 'code', 'INVITATION_EXPIRED', 'message', 'This invitation has expired.')`.
  - Because no `RAISE EXCEPTION` occurs, the transaction commits cleanly: the `'expired'` status transition persists durably to disk, and no membership row is created.
  - The Server Action inspects `result.success === false`, maps the error code `INVITATION_EXPIRED`, and returns an actionable error to the client.
- **Rationale**: Guarantees durable status persistence upon lazy evaluation while ensuring ACID transactional consistency, fully resolving the PostgreSQL transaction rollback concern.
- **Alternatives Considered**:
  - *Background Cron Job (pg_cron or Vercel Cron)*: Periodically polling and expiring records. Rejected as unnecessary infrastructure overhead that adds moving parts and cloud costs for a state transition that can be lazily verified at query time.
  - *Autonomous database trigger*: Triggers cannot run without DML events; cannot self-trigger on clock time.

---

### Decision 3: Invitation Token Generation, Storage & Pre-Flight Validation

- **Context**: Invitation links must be secure against brute-force guessing, token harvesting, and tenant metadata disclosure.
- **Decision**:
  - **Token Generation**: 32 bytes of cryptographically secure random bytes generated via `crypto.randomBytes(32)` (or Web Crypto `crypto.getRandomValues()`), encoded as a 64-character hexadecimal string (256 bits of entropy).
  - **Storage**: Only the SHA-256 hash (`crypto.createHash('sha256').update(rawToken).digest('hex')`) is stored in `organization_invitations.token_hash`. Raw tokens are never logged or stored in the database.
  - **Pre-Flight Validation**: When a visitor accesses `/invitations/accept?token=...`, a lightweight RPC `validate_invitation_token(p_token_hash)` checks that the token hash exists, is in `pending` status, and has not expired. Crucially, the landing page does not reveal tenant names or assigned roles to unauthenticated visitors; it prompts for authentication with the invited email address first.
  - **Maximum 7-Day Lifetime Boundary**: The database stored procedure RPC boundary strictly enforces a maximum invitation lifetime of exactly seven days (`p_expires_at > now() AND p_expires_at <= now() + INTERVAL '7 days'`) for both `create_organization_invitation` and `resend_organization_invitation`. Any expiration timestamp in the past or exceeding 7 days is rejected with validation error `P0009`.
- **Rationale**: Prevents enumeration attacks, timing attacks, and information disclosure regarding store names or internal organizational roles to arbitrary internet visitors.
- **Alternatives Considered**:
  - *JWT-signed invitation links*: Embedding payload in a signed JWT. Rejected because revoking an unexpired invitation would require a distributed token blacklist; database-backed token hashes support immediate, centralized revocation and resend invalidation.

---

### Decision 4: Privilege Escalation Prevention & Role Hierarchy

- **Context**: In multi-user retail environments, Admins must be able to manage Cashiers and Managers, but MUST NOT be able to escalate their own privileges or usurp ownership.
- **Decision**: Enforce a strict role hierarchy in both Server Actions and database stored procedures:
  1. `Owner` (Rank 4): Can assign/update/remove any role (`Owner`, `Admin`, `Manager`, `Cashier`).
  2. `Admin` (Rank 3): Can assign/update/remove only `Admin`, `Manager`, and `Cashier`. Cannot assign or promote anyone to `Owner`. Cannot modify or demote any user holding the `Owner` role.
  3. `Manager` (Rank 2): Cannot modify roles or manage memberships.
  4. `Cashier` (Rank 1): Cannot modify roles or manage memberships.
  5. *Self-Modification Prohibition*: No user (including Owner) may modify their own role. Demoting an Owner requires another active Owner to execute the action.
  6. *Owner Invariant*: The PostgreSQL trigger `check_owner_invariant()` remains the non-bypassable database safety net, rejecting any demotion, deactivation, or revocation of the last active Owner with error `P0002`.
- **Rationale**: Multi-layered defense preventing lateral and vertical privilege escalation.
- **Alternatives Considered**:
  - *Relying solely on UI role selectors*: Completely insecure; easily bypassed via direct API or server action invocations.

---

### Decision 5: Membership Removal Invariant (Soft Revocation) & Permitted Status Transitions

- **Context**: When an employee leaves a retail organization, access must be terminated immediately while maintaining legal and financial auditability.
- **Decision**: Membership removal is executed strictly as **soft-revocation** (`status = 'revoked'`).
  - Hard deletion (`DELETE FROM organization_memberships`) is prohibited.
  - The user's global Supabase authentication account (`auth.users`) is NOT affected.
  - The user's memberships in other retail organizations remain active.
  - On the user's very next request, `resolveTenantContext()` filters for `status = 'active'`. A revoked membership immediately triggers HTTP 404 (Not Found), terminating tenant workspace access with zero propagation delay.
- **Permitted Membership Status Transitions**:
  - `active` $\leftrightarrow$ `suspended` (Suspension and Reactivation)
  - `active` $\rightarrow$ `revoked` (Removal)
  - `suspended` $\rightarrow$ `revoked` (Removal from suspended state)
- **Terminal Revocation Invariant**:
  - In Feature 002, `status = 'revoked'` is strictly terminal.
  - Any attempt to update the role (`update_organization_member_role`) or change status (`update_organization_member_status`) of a revoked membership MUST be rejected with error `P0025` ("Cannot modify a revoked membership").
  - The database trigger `check_owner_invariant()` continues to strictly prevent demoting, suspending, or revoking the last active Owner (`P0002`).
- **Rationale**:
  - Hard deletion causes cascading deletions or foreign key constraint violations against retail transactions (e.g., historical sales, cashier receipts, and audit events where the user acted as cashier).
  - Soft-revocation preserves the legal retail record while enforcing immediate operational lockout.
- **Alternatives Considered**:
  - *Revoking the user's entire Supabase session*: In a multi-tenant platform, revoking global user sessions disrupts access to other legitimate stores the user owns or works for.

---

### Decision 6: Transactional Email Delivery Decoupling

- **Context**: Invitations require emailing a link to the invitee. External email providers (SMTP / Resend) can experience network latency or transient downtime.
- **Decision**: Decouple email dispatch from the database transaction:
  1. The Server Action initiates the database RPC `create_organization_invitation()`, which validates authorization, inserts the invitation record in `'pending'` status, records the audit event, and commits.
  2. After database commit, the Server Action dispatches the email via the transactional email service.
  3. If email dispatch fails:
     - The database record remains saved in `'pending'` status.
     - The Server Action catches the email error and returns a partial success response: `{ success: true, warning: "EMAIL_DELIVERY_FAILED", invitationId: "..." }`.
     - The UI informs the store manager: "Invitation created, but notification email could not be delivered. You may resend or share the link directly."
     - The manager can click "Resend Invitation" at any time.
- **Rationale**: Holding database transactions open during external HTTP calls causes database connection pool exhaustion and slow response times. Rolling back a valid invitation because of a transient SMTP hiccup frustrates store managers.
- **Alternatives Considered**:
  - *Synchronous in-transaction webhook*: Highly fragile; risks rolling back valid invitations upon SMTP rate-limits.

---

### Decision 7: Real-Time Permission Evaluation & Tenant Context Integration

- **Context**: Changes to an employee's role or status must be reflected immediately without stale client-side permission drift.
- **Decision**:
  - Extend `TenantContext` in `src/types/auth.ts`:
    ```typescript
    export interface TenantContext {
      user: User;
      organization: Organization;
      membership: OrganizationMembership;
      role: AppRole;
      permissions: PermissionKey[]; // Resolved server-side
      activeOrganizations: OrganizationSummary[];
    }
    ```
  - During server-side context resolution in `src/lib/auth/context.ts`, after verifying active membership, the system queries the registered permissions for `membership.role` (or assigns all catalog permissions if `role === 'owner'`).
  - Helper function `hasPermission(context: TenantContext, permission: PermissionKey): boolean`:
    1. Requires the permission key to exist in `public.permissions` (the system permissions catalog). If unregistered or unknown, returns `false` unconditionally.
    2. For registered permissions, if `context.role === 'owner'`, returns `true` automatically.
    3. For other roles (`admin`, `manager`, `cashier`), checks `context.permissions.includes(permission)` (mapped from `public.role_permissions`).
    4. Unknown or unregistered permission keys are always denied (`false`).
- **Rationale**: Resolving permissions server-side on every request ensures zero caching drift: when an Owner demotes a Manager to Cashier, the Manager's very next request immediately operates with Cashier permissions.

---

### Decision 8: Employee Directory Query Strategy (Authoritative Permission & Secure RPC View)

- **Context**: The employee directory needs to display employee names, emails, optional phones, roles, and statuses. In Supabase, `public.profiles` contains names and `phone`, while email resides in `auth.users(email)`. Direct queries across `auth.users` from the client are blocked.
- **Decision**: Implement a dedicated `SECURITY DEFINER` function `public.get_organization_employees(p_org_id UUID)`:
  - Validates caller authentication (`auth.uid() IS NOT NULL`).
  - Validates caller active membership in `p_org_id`.
  - **Authoritative `employees:read` Permission Check**: Evaluates caller's role against `employees:read`:
    1. Requires `employees:read` to exist in `public.permissions`. If not found, fails with permission denied (`P0005`).
    2. If caller is an active `Owner`, granted automatically for registered permissions.
    3. For other roles (`admin`, `manager`, `cashier`), queries `public.role_permissions` for caller's role and `permission_id = 'employees:read'`.
    4. Unknown or unregistered permissions are strictly denied for all roles, including Owner.
    5. Unauthorized callers (e.g. `cashier`) are rejected with error `P0005`.
  - Performs a secure inner join between `public.organization_memberships`, `public.profiles`, and `auth.users`.
  - Returns only the sanitized projection: `membership_id`, `user_id`, `first_name`, `last_name`, `email`, `phone`, `role`, `status`, `created_at`.
  - Excludes password hashes, recovery nonces, and unneeded metadata.
- **Rationale**: Prevents cross-tenant profile enumeration while avoiding the need to expose `auth.users` directly to authenticated clients, ensuring directory access is governed authoritatively by `employees:read` at both database and application layers.

