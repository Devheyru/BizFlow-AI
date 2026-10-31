# Tasks: Authentication and Organization Foundation

**Feature**: `001-auth-organization` | **Input**: Design documents from `specs/001-auth-organization/`  
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)  
**Scope for Current Iteration**: User registration, email verification, sign-in/out session management, password recovery with session revocation, profile management, organization onboarding, atomic Owner assignment, multi-tenant PostgreSQL RLS isolation, server-side context resolution, and organization switching.  
**Deferred Work**: Organization invitations, invitation acceptance/revocation, and advanced membership administration remain deferred to a future feature.

---

## Architectural Principles & Authorization Boundaries

To ensure consistent implementation across all tasks, the system strictly enforces a three-tier defense-in-depth model:
1. **Next.js 15 Middleware (`src/middleware.ts`)**:
   - Manages Supabase session token refresh via `@supabase/ssr`.
   - Handles client route redirection (e.g., unauthenticated visitors to `/sign-in`, unverified users to `/verify-email`).
   - Extracts route parameters (`/[slug]/...`) and validates session existence.
   - **⚠️ Security Rule**: Never rely on middleware alone for tenant isolation or security authorization.
2. **Server-Side Helpers & Server Actions (`src/lib/auth/context.ts`, `src/actions/`)**:
   - Resolves user identity on the server using `supabase.auth.getUser()` (never trust unverified client tokens).
   - Validates email verification status (`is_email_verified()`).
   - Resolves active organization membership and role from verified cookies/database.
   - Enforces RBAC permissions and rejects unauthorized tenant operations.
3. **PostgreSQL Row-Level Security (`supabase/migrations/`)**:
   - Non-bypassable, final tenant data-access enforcement layer directly inside the database engine.
   - Universal `FORCE ROW LEVEL SECURITY` across all tenant tables.
   - Non-recursive security helpers owned by `postgres` (`BYPASSRLS`).
   - Direct client mutations on `organization_memberships` are denied (`USING (false)`); all changes route through hardened RPCs.

---

## Format: `- [ ] [TaskID] [P?] [Story?] Description with file path`

- **[P]**: Can run in parallel (different files, no blocking dependencies on incomplete tasks)
- **[Story]**: Mapped user story (`[US1]`, `[US2]`, `[US3]`, `[US4]`, `[US5]`)
- **Testing Rule**: Test authoring may proceed in parallel, but test execution tasks are strictly sequenced after the required migrations, schemas, or server actions are in place.
- **Tenant Testing Rule**: Tenant security integration tests MUST use separate authenticated client sessions with real JWT contexts. Never use the Supabase service-role client to claim that RLS is working.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, framework configuration, environment settings, local Supabase environment, and testing harness.

- [X] T001 Initialize Next.js 15+ App Router application with TypeScript and Tailwind CSS in package.json and tsconfig.json
- [X] T002 [P] Install core runtime and UI dependencies (@supabase/supabase-js, @supabase/ssr, zod, react-hook-form, @hookform/resolvers/zod, clsx, tailwind-merge, lucide-react) in package.json
- [X] T003 [P] Configure Vitest unit testing framework and Playwright e2e runner in vitest.config.ts and playwright.config.ts
- [X] T004 [P] Configure environment variable validation schema and template in src/lib/env.ts and .env.example
- [X] T005 Setup and verify local Supabase development and test environment via supabase start in supabase/config.toml

---

## Phase 2: Foundational (Blocking Prerequisites & Database Migrations)

**Purpose**: Core database migrations, Supabase SSR client utilities, RLS security helpers, and shared UI primitives.

**⚠️ CRITICAL SEQUENTIAL ORDER**: Database migrations MUST execute in exact numeric order (`01` → `02` → `03` → `04`) to satisfy foreign keys, triggers, and policy dependencies. No user story implementation can begin until Phase 2 is complete.

- [X] T006 Create Supabase SSR client utilities for browser, server, and middleware contexts in src/lib/supabase/client.ts, src/lib/supabase/server.ts, and src/lib/supabase/middleware.ts
- [X] T007 Implement core database migration 01 for enums (app_role, membership_status) and base tables (profiles, organizations, organization_memberships, organization_audit_events) in supabase/migrations/20261031000001_auth_organization_schema.sql
- [X] T008 Implement database migration 02 for handle_new_user() trigger on auth.users syncing into public.profiles (depends on T007) in supabase/migrations/20261031000002_auth_triggers.sql
- [X] T009 Implement database migration 03 for non-recursive security helper functions (is_email_verified, get_user_organization_ids, is_org_member) with locked search_path (depends on T007, T008) in supabase/migrations/20261031000003_security_helpers.sql
- [X] T010 Implement database migration 04 for universal FORCE ROW LEVEL SECURITY and base RLS policies for profiles, organizations, organization_memberships, and organization_audit_events (depends on T009) in supabase/migrations/20261031000004_rls_policies.sql
- [ ] T011 Verify sequential clean-database migration execution from empty database (supabase db reset) in supabase/migrations/
- [ ] T012 [P] Create shared TypeScript types, database schema definitions, and action result interfaces in src/types/database.ts and src/types/auth.ts
- [ ] T013 [P] Implement base UI component primitives (Button, Input, Form, Label, Card, Alert, DropdownMenu) in src/components/ui/

**Checkpoint**: Foundation ready — database schema, RLS policies, Supabase SSR clients, and base primitives are established and verified against a clean Supabase database.

---

## Phase 3: User Story 1 - User Registration, Verification & Authentication (Priority: P1) 🎯 MVP

**Goal**: Provide secure account registration with password complexity enforcement, automated profile generation, email verification gating, cookie-based session management, sign-out, and route protection.

**Independent Test**: Register an account with valid credentials; verify profile created in database; confirm unverified user is blocked from workspace routes and guided to `/verify-email`; confirm email verification; authenticate via sign-in; verify secure HTTP-only cookies; test sign-out and route guard redirection.

### Tests for User Story 1 ⚠️
*(Note: Tests authored here; executed in T025 after implementation components exist)*

- [ ] T014 [P] [US1] Author unit tests for registration and sign-in Zod validation schemas in tests/unit/validations/auth.test.ts
- [ ] T015 [P] [US1] Author integration tests for handle_new_user() trigger and is_email_verified() security helper in tests/integration/auth-trigger.test.ts

### Implementation for User Story 1

- [ ] T016 [P] [US1] Define authentication Zod schemas (signUpSchema, signInSchema) with password symbol rules in src/lib/validations/auth.ts
- [ ] T017 [US1] Implement server action signUpAction with anti-enumeration protection in src/actions/auth-actions.ts
- [ ] T018 [US1] Implement server action signInAction with email verification gate and organization routing in src/actions/auth-actions.ts
- [ ] T019 [US1] Implement server action signOutAction clearing session cookies in src/actions/auth-actions.ts
- [ ] T020 [P] [US1] Implement PKCE Auth Callback route with open-redirect sanitization in src/app/api/auth/callback/route.ts
- [ ] T021 [P] [US1] Implement Next.js session validation and route protection middleware for session refresh in src/middleware.ts
- [ ] T022 [P] [US1] Build Registration page and form component with inline validation in src/app/(auth)/sign-up/page.tsx and src/components/auth/SignUpForm.tsx
- [ ] T023 [P] [US1] Build Sign-In page and form component with credential error handling in src/app/(auth)/sign-in/page.tsx and src/components/auth/SignInForm.tsx
- [ ] T024 [P] [US1] Build Email Verification pending screen with resend link in src/app/(auth)/verify-email/page.tsx and src/components/auth/VerifyEmailCard.tsx
- [ ] T025 [US1] Execute unit, integration, and end-to-end browser tests for registration, verification, sign-in, and sign-out in tests/e2e/auth-flow.spec.ts

**Checkpoint**: User Story 1 is fully functional and testable independently (MVP Milestone).

---

## Phase 4: User Story 2 - Organization Creation & Onboarding (Priority: P1)

**Goal**: Enable newly registered and verified business owners with 0 organizations to configure their retail store, enforcing creator-bound idempotency, atomic Owner assignment, and workspace transition.

**Independent Test**: Sign in with an email-verified user belonging to 0 organizations; verify automatic redirect to `/onboarding/create-organization`; submit valid store parameters (ISO country, currency, timezone); verify atomic creation of organization and membership row with `role = 'owner'`; verify replayed submission with identical `client_mutation_id` safely returns existing organization.

### Tests for User Story 2 ⚠️
*(Note: Tests authored here; executed in T033 after migration and implementation exist)*

- [ ] T026 [P] [US2] Author unit tests for organization creation Zod schema (ISO 3166-1 alpha-2, ISO 4217, name length) in tests/unit/validations/organization.test.ts
- [ ] T027 [P] [US2] Author integration tests for create_organization_with_owner() verifying unauthenticated, unverified, duplicate, concurrent, creator-bound idempotent replay, and membership loss scenarios in tests/integration/create-organization.test.ts

### Implementation for User Story 2

- [ ] T028 [US2] Implement database migration 05 for create_organization_with_owner() stored procedure with email verification check, creator-bound idempotency, and atomic Owner assignment in supabase/migrations/20261031000005_create_organization_rpc.sql
- [ ] T029 [P] [US2] Define organization creation Zod schema (createOrganizationSchema) in src/lib/validations/organization.ts
- [ ] T030 [US2] Implement server action createOrganizationAction invoking create_organization_with_owner() in src/actions/organization-actions.ts
- [ ] T031 [P] [US2] Build Organization Onboarding page and creation form in src/app/onboarding/create-organization/page.tsx and src/components/organization/CreateOrganizationForm.tsx
- [ ] T032 [US2] Implement onboarding route guard redirecting verified 0-organization users to onboarding in src/lib/auth/guards.ts
- [ ] T033 [US2] Execute unit, integration, and end-to-end browser tests for organization creation, validation, and dashboard redirection in tests/e2e/onboarding-flow.spec.ts

**Checkpoint**: User Stories 1 and 2 operate seamlessly together. Users can register, verify, create their store, and land on their workspace.

---

## Phase 5: User Story 3 - Multi-Tenant Isolation & Server Context Resolution (Priority: P1)

**Goal**: Guarantee complete tenant data isolation using PostgreSQL Row-Level Security, resolve tenant context strictly on the server from verified session cookies, and protect tenant routes from unauthorized access.

**Independent Test**: Sign in as User A (belonging only to Org A); attempt to query Org B data via direct database query; verify PostgreSQL RLS returns 0 rows; attempt to access URL `/[org-b-slug]/dashboard`; verify server-side middleware and context resolution deny access and redirect safely.

### Tests for User Story 3 ⚠️
*(Note: Tests authored here; executed in T040. Must use separate authenticated user sessions with JWTs; never use service-role key)*

- [ ] T034 [P] [US3] Author integration tests verifying tenant data isolation under FORCE RLS using separate authenticated user sessions and JWT contexts (never service-role) in tests/integration/tenant-isolation.test.ts
- [ ] T035 [P] [US3] Author integration tests verifying direct client INSERT/UPDATE/DELETE on organization_memberships are denied by RLS in tests/integration/membership-rls.test.ts

### Implementation for User Story 3

- [ ] T036 [US3] Implement server-side tenant context resolution helper getTenantContext() validating user identity and active membership on the server in src/lib/auth/context.ts
- [ ] T037 [US3] Implement tenant navigation middleware enforcing session refresh and slug routing (delegating tenant authorization to server components) in src/middleware.ts
- [ ] T038 [P] [US3] Build Tenant Workspace layout and header shell with server-side authorization check in src/app/[slug]/layout.tsx and src/components/layout/TenantHeader.tsx
- [ ] T039 [P] [US3] Build Tenant Dashboard overview page rendering store metadata and user role in src/app/[slug]/dashboard/page.tsx
- [ ] T040 [US3] Execute integration and end-to-end tests verifying multi-tenant isolation, organization slug tampering, and cookie manipulation rejection in tests/e2e/tenant-isolation.spec.ts

**Checkpoint**: Core multi-tenant boundary is active and verified. Tenant isolation is strictly enforced at database and server layers.

---

## Phase 6: User Story 4 - Multi-Organization Navigation & Context Switching (Priority: P2)

**Goal**: Support users who own or work at multiple retail stores, provide a global store switcher in the header, persist active store preference in secure cookies, and route returning users to their last active store.

**Independent Test**: Seed User A with active memberships in Org A and Org B; sign in; verify Organization Switcher displays both stores; switch context to Org B; verify `bizflow_active_org` cookie is set to Org B and dashboard reloads under Org B; sign out and sign back in; verify automatic routing to Org B.

### Tests for User Story 4 ⚠️
*(Note: Tests authored here; executed in T047 after actions and switcher exist)*

- [ ] T041 [P] [US4] Author unit tests for organization switching Zod schema in tests/unit/validations/organization-switch.test.ts
- [ ] T042 [P] [US4] Author integration tests verifying get_user_organization_ids() returns all active tenant IDs for multi-org user in tests/integration/user-organizations.test.ts

### Implementation for User Story 4

- [ ] T043 [US4] Implement server action switchOrganizationAction validating membership before setting bizflow_active_org cookie in src/actions/organization-actions.ts
- [ ] T044 [P] [US4] Build Organization Switcher dropdown component in src/components/layout/OrganizationSwitcher.tsx
- [ ] T045 [US4] Integrate Organization Switcher into Tenant Navigation Header in src/components/layout/TenantHeader.tsx
- [ ] T046 [US4] Update signInAction and middleware to route multi-org users to their last active store preference in src/actions/auth-actions.ts and src/middleware.ts
- [ ] T047 [US4] Execute end-to-end browser tests for multi-organization switching and persistent routing in tests/e2e/organization-switch.spec.ts

**Checkpoint**: Multi-store navigation and switching is functional, responsive, and persistent.

---

## Phase 7: User Story 5 - Account Profile Management & Password Recovery (Priority: P2)

**Goal**: Provide secure password recovery with complexity rules and session revocation across all active devices, alongside account profile viewing and editing.

**Independent Test**: Submit password reset request for registered email; verify generic anti-enumeration response; exchange recovery token via callback; reset password with strong symbol-containing password; verify existing sessions revoked; authenticate with new password; navigate to profile settings and update name/phone; verify updated data persists.

### Tests for User Story 5 ⚠️
*(Note: Tests authored here; executed in T058 after profile actions and pages exist)*

- [ ] T048 [P] [US5] Author unit tests for forgot-password, reset-password, and profile update Zod schemas in tests/unit/validations/profile-password.test.ts
- [ ] T049 [P] [US5] Author integration tests verifying profiles_update_own RLS policy permits updating own profile only in tests/integration/profile-rls.test.ts
- [ ] T050 [P] [US5] Author integration tests verifying password reset triggers Supabase session revocation across all existing client sessions in tests/integration/session-revocation.test.ts

### Implementation for User Story 5

- [ ] T051 [P] [US5] Define password recovery and profile Zod schemas (forgotPasswordSchema, resetPasswordSchema, updateProfileSchema) in src/lib/validations/auth.ts
- [ ] T052 [US5] Implement server action requestPasswordResetAction with anti-enumeration response in src/actions/auth-actions.ts
- [ ] T053 [US5] Implement server action resetPasswordAction updating credentials and triggering refresh token revocation in src/actions/auth-actions.ts
- [ ] T054 [US5] Implement server action updateProfileAction for personal name and phone modifications in src/actions/profile-actions.ts
- [ ] T055 [P] [US5] Build Forgot Password page and form in src/app/(auth)/forgot-password/page.tsx and src/components/auth/ForgotPasswordForm.tsx
- [ ] T056 [P] [US5] Build Reset Password page and form in src/app/(auth)/reset-password/page.tsx and src/components/auth/ResetPasswordForm.tsx
- [ ] T057 [P] [US5] Build User Profile settings page and form in src/app/settings/profile/page.tsx and src/components/settings/ProfileForm.tsx
- [ ] T058 [US5] Execute unit, integration, and end-to-end browser tests for password recovery, session revocation, and profile editing in tests/e2e/profile-password.spec.ts

**Checkpoint**: User self-service account management and recovery is complete.

---

## Phase 8: Polish & Explicit Final Verification

**Purpose**: Execute automated verification of database security invariants, multi-tenant isolation, build integrity, and performance targets across all implemented user stories.

- [ ] T059 Run clean-database migration verification (supabase db reset) asserting all migrations execute cleanly in supabase/migrations/
- [ ] T060 Run strict TypeScript compiler verification without any type bypasses (npm run typecheck) in tsconfig.json
- [ ] T061 Run ESLint and code style checks (npm run lint) in package.json
- [ ] T062 Run full unit test suite (npm run test:unit) in vitest.config.ts
- [ ] T063 Run integration test suite verifying RLS tenant isolation, idempotency, and session revocation using separate authenticated JWT contexts (npm run test:integration) in tests/integration/
- [ ] T064 Run Playwright end-to-end browser test suite (npm run test:e2e) in playwright.config.ts
- [ ] T065 Run Next.js production build verification (npm run build) in package.json

---

## Dependencies & Execution Order

### Phase Dependencies

```mermaid
flowchart TD
    P1["Phase 1: Setup"] --> P2["Phase 2: Foundational (Sequential Migrations)"]
    P2 --> P3["Phase 3: US1 - Registration & Auth (MVP)"]
    P2 --> P4["Phase 4: US2 - Org Creation & Onboarding"]
    P3 --> P4
    P4 --> P5["Phase 5: US3 - Multi-Tenant Isolation & Context"]
    P5 --> P6["Phase 6: US4 - Multi-Org Navigation & Switcher"]
    P3 --> P7["Phase 7: US5 - Profile & Password Recovery"]
    P6 --> P8["Phase 8: Polish & Explicit Final Verification"]
    P7 --> P8
```

1. **Setup (Phase 1)**: Must run first; provisions project packages, linting, testing dependencies, and local Supabase setup.
2. **Foundational (Phase 2)**: Core blocking prerequisites. Database migrations MUST execute sequentially:
   `T007` (Migration 01: Schema) → `T008` (Migration 02: Triggers) → `T009` (Migration 03: Security Helpers) → `T010` (Migration 04: RLS Policies) → `T011` (Clean DB Reset Verification).
3. **User Story 1 (Phase 3)**: MVP Milestone. User identity and authentication foundation. Test authoring (`T014`, `T015`) may happen in parallel with schemas, but execution (`T025`) runs after implementation.
4. **User Story 2 (Phase 4)**: Depends on US1 (verified user session required to create organization). Migration `T028` (`05_create_organization_rpc`) executes on top of Phase 2 migrations.
5. **User Story 3 (Phase 5)**: Depends on US2 (requires organizations to enforce tenant context). Integration tests (`T034`, `T035`) execute under separate authenticated sessions.
6. **User Story 4 (Phase 6)**: Depends on US3 (requires active tenant resolution to switch between multiple organizations).
7. **User Story 5 (Phase 7)**: Depends on US1 (requires authenticated user and profile trigger). Can run in parallel with US3/US4.
8. **Polish (Phase 8)**: Explicit, independent verification gates covering migrations, TypeScript, linting, unit tests, integration tests with real JWT contexts, e2e browser flows, and production build.

---

## Parallel Opportunities

- **Phase 1 (Setup)**: T002, T003, and T004 can proceed concurrently.
- **Phase 2 (Foundational)**: T012 (TypeScript types) and T013 (UI primitives) can proceed in parallel once migrations are established.
- **Phase 3 (US1)**: Test authoring T014, T015, Schema T016, Callback T020, Middleware T021, and UI pages T022, T023, T024 can be authored in parallel once T006–T013 complete.
- **Phase 4 (US2)**: Test authoring T026, T027, Schema T029, and UI page T031 can proceed in parallel with RPC T028.
- **Phase 5 (US3)**: Test authoring T034, T035, Layout T038, and Dashboard page T039 can proceed in parallel with Context resolver T036.
- **Phase 6 (US4)**: Test authoring T041, T042, and Switcher component T044 can proceed in parallel with server action T043.
- **Phase 7 (US5)**: Test authoring T048, T049, T050, Schemas T051, and Pages T055, T056, T057 can proceed in parallel with Actions T052, T053, T054.
- **Phase 8 (Polish)**: Tests T062 and T063 can run concurrently before final build T065.

---

## Implementation Strategy & Milestones

### Milestone 1: Minimum Viable Product (Phase 1 to Phase 3) 🎯
- **Scope**: Setup, sequential database migrations (01–04), clean DB reset verification, User Registration, Email Verification screen, Sign-In, Sign-Out, Session Cookie management, and Protected Route redirection.
- **Validation**: Run `npm run test:unit`, `tests/integration/auth-trigger.test.ts`, and `tests/e2e/auth-flow.spec.ts`. Verify complete user lifecycle without errors.

### Milestone 2: Single-Tenant Business Onboarding (Phase 4 & Phase 5)
- **Scope**: Store Creation with strict ISO codes, creator-bound idempotency, atomic Owner assignment, FORCE RLS tenant isolation, and `/[slug]/dashboard` server context resolution.
- **Validation**: Run `tests/integration/create-organization.test.ts`, `tests/integration/tenant-isolation.test.ts` (using separate JWTs), `tests/e2e/onboarding-flow.spec.ts`, and `tests/e2e/tenant-isolation.spec.ts`. Confirm cross-tenant data requests return 0 rows.

### Milestone 3: Multi-Store Operations & Account Self-Service (Phase 6 to Phase 8)
- **Scope**: Organization Switcher header, last-active-store persistent routing, Password Reset with Supabase session revocation across all devices, User Profile management, and explicit final verification gates.
- **Validation**: Run full security verification suite `tests/integration/security-matrix.test.ts`, Playwright e2e suite, clean DB migration check, and Next.js production build (`npm run build`).
