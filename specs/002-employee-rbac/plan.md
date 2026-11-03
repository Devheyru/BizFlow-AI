# Implementation Plan: Feature 002 — Employee Management & Role-Based Access Control (RBAC)

**Branch**: `002-employee-rbac` | **Date**: 2026-11-03 | **Spec**: [specs/002-employee-rbac/spec.md](spec.md)  
**Input**: Feature specification from `specs/002-employee-rbac/spec.md`  
**Governing Documents**:
- [BizFlow AI Constitution v1.1.0](../../.specify/memory/constitution.md)
- [Master Project Blueprint](../../docs/MASTER_PROJECT_BLUEPRINT.md)
- [Feature 001 Architecture Review & Report](../001-auth-organization/plan.md)

---

## Summary

Feature 002 implements multi-tenant employee workforce management and granular Role-Based Access Control (RBAC) for BizFlow AI. It extends the completed Feature 001 authentication and organization foundation by:
1. Introducing a **mutable invitation lifecycle state machine** (`organization_invitations`) backed by 256-bit cryptographically secure token hashes and transaction-safe lazy expiration, paired with an **append-only immutable audit trail** (`organization_audit_events`).
2. Establishing a **granular permission model** (`permissions`, `role_permissions`) using colon-separated resource-action verbs (`employees:read`, `employees:invite`, etc.) mapping to the four predefined system roles (`Owner`, `Admin`, `Manager`, `Cashier`).
3. Protecting the system against **privilege escalation** (Admins cannot assign or modify Owners; self-role modification is blocked; the last active Owner invariant is enforced by database triggers).
4. Restricting employee removal to **soft-revocation** (`status = 'revoked'`), immediately revoking tenant access without deleting historical transaction audit trails or disrupting global user sessions.
5. Providing a **clean, accessible UI** for employee directory browsing, email invitations, role administration, and seamless invitation acceptance.

---

## Technical Context

**Language/Version**: TypeScript 5.6+ (Strict mode: `noImplicitAny`, `strictNullChecks`), Node.js 20+  
**Primary Dependencies**: Next.js 15 (React 19, Server Components, Server Actions), `@supabase/supabase-js`, `@supabase/ssr`, `zod`, `tailwind-merge`, `clsx`, `lucide-react`  
**Storage**: PostgreSQL 15+ (hosted on Supabase) with Row-Level Security, foreign keys with referential integrity, and locked PL/pgSQL stored procedures  
**Testing**: Vitest 2.1+ (unit and database integration suites), Playwright 1.48+ (multi-browser E2E testing)  
**Target Platform**: Modern desktop and tablet web browsers (Point-of-Sale & store back-office)  
**Project Type**: Multi-tenant Web SaaS Application  
**Performance Goals**: 
- Server action response latency < 300ms.
- Real-time authorization freshness: 0 seconds propagation delay upon role demotion or membership revocation.  
**Constraints**: 
- Constitution v1.1.0 compliance.
- Universal `FORCE ROW LEVEL SECURITY`.
- Direct client mutations on `organization_memberships` and `organization_invitations` remain strictly denied (`WITH CHECK (false)`).
- Owner invariant non-negotiable (`P0002`).
- External email delivery decoupled from database transactions.

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Multi-Tenancy & Absolute Data Isolation**: Every new tenant table (`organization_invitations`) has non-nullable `organization_id` foreign key referencing `organizations(id)`. PostgreSQL RLS is enabled and forced. Zero-trust client context: tenant identity is resolved strictly server-side via `resolveTenantContext()`. Multi-org switching preserves access across independent memberships.
- [x] **II. Financial & Inventory Invariance**: All multi-record mutations (invitation acceptance, membership creation, role changes, status updates) execute atomically within PostgreSQL stored procedures (RPCs). Every state change records an immutable `organization_audit_events` row.
- [x] **III. Type Safety & Validation**: Strict TypeScript without `any`. All external inputs (invitations, role updates, status changes) are validated at runtime boundaries using Zod schemas.
- [x] **IV. Security & Server-Enforced RBAC**: Access control is enforced server-side using granular colon-separated permission keys (`employees:read`, `employees:invite`, etc.). Dynamic SQL is strictly prohibited; all procedures use typed parameters and locked search paths (`search_path = pg_catalog, public, pg_temp`). Sensitive token hashes are stored (never raw tokens).
- [x] **V. AI Guardrails**: AI assistants are untrusted and strictly prohibited from autonomously issuing invitations, modifying roles, or altering membership statuses.
- [x] **VI. Professional UX & Operational Ergonomics**: UI screens explicitly implement four states: Loading, Empty, Error, and Success. Keyboard navigability, accessible contrast, and responsive layout are enforced.
- [x] **VII. Comprehensive Quality Verification**: Unit tests validate schemas, role hierarchy, and `hasPermission` catalog validation. Integration tests validate RLS policies, transaction-safe expiration, privilege escalation blocking, and owner invariant protection.

---

## Project Structure

### Documentation (this feature)

```text
specs/002-employee-rbac/
├── plan.md              # This file
├── research.md          # Technical research & architectural decisions
├── data-model.md        # Database schema, RLS policies, and RPC specifications
├── quickstart.md        # Developer setup & testing guide
├── checklists/
│   └── requirements.md  # Specification quality checklist
└── contracts/
    ├── database-rpcs.md       # Stored procedure signatures and JSONB schemas
    ├── employee-actions.md    # Server Action contracts for employee directory and roles
    └── invitation-actions.md  # Server Action contracts for employee invitations
```

### Source Code Targets (repository root)

```text
src/
├── actions/
│   ├── employee-actions.ts          # Server actions for employees (get, update role, update status, remove)
│   └── invitation-actions.ts        # Server actions for invitations (invite, accept, decline, resend, revoke)
├── app/
│   ├── [slug]/
│   │   └── employees/
│   │       ├── page.tsx             # Employee directory and management page
│   │       └── loading.tsx          # Skeleton loading state
│   └── invitations/
│       └── accept/
│           ├── page.tsx             # Invitation landing and acceptance page
│           └── loading.tsx
├── components/
│   ├── employees/
│   │   ├── EmployeeTable.tsx        # Directory data table with status badges and action menus
│   │   ├── InviteEmployeeModal.tsx  # Modal form for issuing email invitations
│   │   ├── RoleSelectorDialog.tsx   # Dialog for role updates with escalation guards
│   │   ├── PendingInvitations.tsx   # Sub-view for listing and managing pending invites
│   │   └── StatusChangeDialog.tsx   # Confirmation dialog for suspension and revocation
│   └── invitations/
│       └── AcceptInvitationCard.tsx # Pre-flight verified acceptance & decline card
├── lib/
│   ├── auth/
│   │   ├── context.ts               # Extended to populate permissions in TenantContext
│   │   └── permissions.ts           # Permission catalog, types, and hasPermission() engine
│   ├── email/
│   │   └── invitation-mailer.ts     # Decoupled transactional invitation email dispatcher
│   └── validations/
│       ├── employee.ts              # Zod schemas for employee management actions
│       └── invitation.ts            # Zod schemas for invitation actions
└── types/
    ├── auth.ts                      # Extended TenantContext with permissions: PermissionKey[]
    └── database.ts                  # Generated Supabase database TypeScript types

supabase/
└── migrations/
    └── 20261103000009_employee_management_rbac.sql # Feature 002 consolidated migration

tests/
├── unit/
│   ├── auth/
│   │   └── permissions.test.ts      # Permission catalog & hasPermission unit tests
│   └── validations/
│       ├── employee.test.ts         # Employee Zod validation tests
│       └── invitation.test.ts       # Invitation Zod validation tests
├── integration/
│   ├── employee-rbac.test.ts        # Stored procedures, privilege escalation, owner invariant
│   └── invitations-rls.test.ts      # RLS policies, token hashing, lazy expiration
└── e2e/
    └── employee-management.spec.ts  # Playwright E2E invitation and role workflow
```

---

## Detailed Implementation Phases

### Phase 1: Database Migration (`20261103000009_employee_management_rbac.sql`)

1. **Custom Enums**:
   - Create `public.invitation_status` enum (`'pending'`, `'accepted'`, `'declined'`, `'revoked'`, `'expired'`).
2. **Tables & Indexes**:
   - `public.organization_invitations` table with partial unique index `uq_pending_invitation` on `(organization_id, lower(email)) WHERE status = 'pending'`.
   - `public.permissions` table (primary key `id` in colon notation).
   - `public.role_permissions` mapping table (composite primary key `(role, permission_id)`).
3. **Seed Data**:
   - Insert 7 core employee management permissions (`employees:read`, `employees:invite`, `employees:update_role`, `employees:suspend`, `employees:remove`, `employees:invitations_read`, `employees:invitations_revoke`).
   - Map permissions to `admin` and `manager` roles.
4. **Row-Level Security Policies**:
   - Universal `FORCE ROW LEVEL SECURITY` on `organization_invitations`, `permissions`, and `role_permissions`.
   - Direct client mutation denial on `organization_invitations` (`WITH CHECK (false)` / `USING (false)`).
   - SELECT policy on `organization_invitations` restricting visibility to active Owners and Admins of the organization.
   - Public authenticated read access for `permissions` and `role_permissions`.
5. **Stored Procedures (PL/pgSQL, `SECURITY DEFINER`, search_path locked to `pg_catalog, public, pg_temp`)**:
   - *Independent Database-Level Validation*: All RPCs independently validate caller authentication (`auth.uid()`), active membership, regex formats (UUID, email, 64-char hex token hashes), and parameter bounds.
   - `create_organization_invitation(...)`: Enforces active caller with `employees:invite`, enforces maximum invitation lifetime of exactly 7 days at the database RPC boundary (`now() < p_expires_at AND p_expires_at <= now() + INTERVAL '7 days'` returning `P0009` if exceeded), prevents duplicate pending invites via partial unique index `uq_pending_invitation` (trapping `unique_violation` with `P0022`), checks existing active members (`P0021`), prevents Admin from inviting Owners (`P0020`), inserts pending invite, and logs audit event.
   - `validate_invitation_token(...)`: Pre-flight validation returning `{ is_valid, is_expired, status }` with strict zero-metadata disclosure (omits org name, ID, email, role) to prevent token harvesting. Granted to `anon, authenticated, service_role`.
   - `accept_organization_invitation(...)`: Row lock (`FOR UPDATE`), transaction-safe lazy expiration returning `{ success: false, code: 'INVITATION_EXPIRED' }` without rollback, verified email matching with generic privacy-preserving `EMAIL_MISMATCH` rejection, atomic membership creation (`status = 'active'`), invitation status update to `'accepted'`, and audit logging.
   - `decline_organization_invitation(...)`: Validates email match with generic `EMAIL_MISMATCH` privacy protection, transitions status to `'declined'`, logs audit.
   - `resend_organization_invitation(...)`: Validates caller holds `employees:invite`, enforces maximum invitation lifetime of exactly 7 days at the database RPC boundary (`now() < p_new_expires_at AND p_new_expires_at <= now() + INTERVAL '7 days'` returning `P0009` if exceeded), generates new token hash, updates record, logs audit.
   - `revoke_organization_invitation(...)`: Validates caller holds `employees:invitations_revoke`, sets status to `'revoked'`, invalidates token hash immediately, logs audit.
   - `update_organization_member_role(...)`: Prevents self-modification, prevents Admin from assigning/modifying Owner, enforces `check_owner_invariant`, enforces terminal `revoked` guard (`P0025` rejection on revoked memberships), updates role, logs audit.
   - `update_organization_member_status(...)`: Enforces permitted status transitions (`active` $\leftrightarrow$ `suspended`, `active` $\rightarrow$ `revoked`, `suspended` $\rightarrow$ `revoked`), enforces terminal `revoked` guard (`P0025` rejection), prevents self-modification, enforces `check_owner_invariant`, updates status, logs audit.
   - `get_organization_employees(...)`: Enforces authoritative `employees:read` permission gate at the database level: requires permission key to exist in `public.permissions` catalog (if missing, rejects with `P0005`); Owner receives access automatically for registered permissions; for other roles, checks `role_permissions`; unknown or unregistered permissions are always denied. Returns sanitized minimal field projection (`organization_memberships` + `profiles` + `auth.users(email)`).

---

### Phase 2: Core Domain Services, Validations & Context Extensions

1. **Permission Engine (`src/lib/auth/permissions.ts`)**:
   - Define strictly-typed `PermissionKey` union type.
   - Implement `hasPermission(context: TenantContext, permission: PermissionKey): boolean`:
     - Requires `permission` to exist in `SYSTEM_PERMISSIONS` (the registered `public.permissions` catalog). If not registered or unknown, returns `false` unconditionally.
     - For registered permissions, the `Owner` role receives access automatically (returns `true`).
     - For other roles (`Admin`, `Manager`, `Cashier`), checks `context.permissions.includes(permission)` (mapped from `public.role_permissions`).
     - Unknown or unregistered permission keys are always denied (`false`).
2. **Context Resolution Update (`src/lib/auth/context.ts`)**:
   - Extend `resolveTenantContext()` to query `role_permissions` for the caller's role and populate `context.permissions`.
   - For `Owner`, populate with all registered permission keys.
3. **Zod Validation Schemas**:
   - `src/lib/validations/employee.ts`: `updateMemberRoleSchema`, `updateMemberStatusSchema`, `removeMemberSchema`.
   - `src/lib/validations/invitation.ts`: `inviteEmployeeSchema`, `acceptInvitationSchema`, `declineInvitationSchema`, `resendInvitationSchema`, `revokeInvitationSchema`.
4. **Decoupled Email Dispatcher (`src/lib/email/invitation-mailer.ts`)**:
   - Formats invitation acceptance URL.
   - Dispatches transactional email via configured SMTP / API provider.
   - Catches errors gracefully without failing database transactions.

---

### Phase 3: Server Actions

1. **`src/actions/employee-actions.ts`**:
   - `getEmployeesAction()`: Gated by `employees:read`. Calls `get_organization_employees`.
   - `updateMemberRoleAction()`: Gated by `employees:update_role`. Validates hierarchy. Calls `update_organization_member_role`.
   - `updateMemberStatusAction()`: Gated by `employees:suspend`. Calls `update_organization_member_status`.
   - `removeMemberAction()`: Gated by `employees:remove`. Sets status to `'revoked'`.
2. **`src/actions/invitation-actions.ts`**:
   - `inviteEmployeeAction()`: Gated by `employees:invite`. Generates 256-bit token + SHA-256 hash. Calls stored procedure. Dispatches email outside transaction.
   - `acceptInvitationAction()`: Hashes token, calls `accept_organization_invitation`. Handles structured results (`INVITATION_EXPIRED`, `EMAIL_MISMATCH`). Sets active org cookie.
   - `declineInvitationAction()`: Calls `decline_organization_invitation`.
   - `resendInvitationAction()`: Gated by `employees:invite`. Generates fresh token, resets expiry.
   - `revokeInvitationAction()`: Gated by `employees:invitations_revoke`. Calls `revoke_organization_invitation`.
   - `validateInvitationTokenAction()`: Pre-flight token check without revealing tenant metadata to unauthenticated users.

---

### Phase 4: User Interface Implementation

1. **Employee Management View (`src/app/[slug]/employees/page.tsx`)**:
   - Server Component resolving `getTenantContext(slug)`.
   - Validates `hasPermission(context, 'employees:read')` (404 Not Found if unauthorized).
   - Renders `EmployeeTable` displaying full name, email, phone (or "None"), role badge, status badge, joined date.
   - If caller holds `employees:invite`, renders "Invite Employee" button opening `InviteEmployeeModal`.
   - Actions menu on employee rows: "Change Role", "Suspend / Reactivate", "Remove Employee" (rendered conditionally based on caller permissions).
   - "Pending Invitations" tab displaying active invitations with "Resend" and "Revoke" actions.
2. **Invitation Acceptance View (`src/app/invitations/accept/page.tsx`)**:
   - Publicly accessible page with token parameter.
   - Validates token hash before exposing organization or role details.
   - If unauthenticated, renders sign-in / sign-up prompts preserving invitation token.
   - If authenticated with matching email, displays organization name and invited role with "Accept" and "Decline" buttons.
   - If authenticated with mismatched email, displays warning and account switch prompt.
   - Displays clear error screen if token is invalid, revoked, or expired.
3. **Tenant Header Navigation (`src/components/layout/TenantHeader.tsx`)**:
   - Renders the "Employees" link in navigation if caller has `employees:read`.

---

### Phase 5: Verification & Quality Assurance

1. **Unit Tests**:
   - `tests/unit/auth/permissions.test.ts`: Tests `hasPermission` with registered keys, unregistered keys (asserts `false` even for Owner), Owner omnipotence, and role mappings.
   - `tests/unit/validations/employee.test.ts`: Tests input validation bounds for employee actions.
   - `tests/unit/validations/invitation.test.ts`: Tests email formatting, role validation, token schemas.
2. **Integration Tests**:
   - `tests/integration/employee-rbac.test.ts`: Tests stored procedures, Admin promotion rejection to Owner, Owner invariant protection, and self-demotion rejection.
   - `tests/integration/invitations-rls.test.ts`: Tests direct client mutation denial (42501), transaction-safe lazy expiration persistence, duplicate invite prevention, email mismatch rejection, and token replay prevention.
3. **End-to-End Tests**:
   - `tests/e2e/employee-management.spec.ts`: Full automated browser flow (Owner creates store $\rightarrow$ invites employee $\rightarrow$ employee accepts invite $\rightarrow$ verifies employee in directory $\rightarrow$ Owner changes role $\rightarrow$ Owner suspends employee $\rightarrow$ verifies lockout).

---

## Complexity Tracking

| Architectural Trade-Off | Selected Approach | Justification |
|---|---|---|
| **Dynamic Custom Roles vs. Predefined Roles** | Predefined Roles (`public.app_role`) mapped to granular permissions | Custom roles add unnecessary schema complexity for MVP retail operations. Predefined roles with granular permission mappings decouple authorization cleanly while preserving Feature 001 database triggers and RLS policies. |
| **Transaction-Safe Expiration vs. Background Crons** | Structured JSONB returns from stored procedure | Calling `UPDATE ... status = 'expired'` followed by returning `{ success: false, code: 'INVITATION_EXPIRED' }` cleanly commits the expiration to disk without requiring external cron schedulers or cloud functions. |
| **Membership Removal: Soft Revocation vs. Hard Deletion** | Soft-revocation (`status = 'revoked'`) | Hard deletions violate foreign keys in retail transaction ledgers (e.g. historical sales and audit events). Soft revocation guarantees immediate tenant lockout while preserving business truth. |
| **Decoupled Email Dispatch vs. In-Transaction Webhook** | Post-commit external email dispatch | Database transactions must never wait on third-party HTTP network calls. If email dispatch fails, the invitation remains valid and can be resent without rolling back database state. |
