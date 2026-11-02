# BizFlow AI

> **An enterprise-grade, multi-tenant retail management SaaS platform engineered with Next.js 15, React 19, Supabase, and PostgreSQL Row-Level Security.**

[![Next.js](https://img.shields.io/badge/Next.js-15.1.6-black?style=flat&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.0.0-blue?style=flat&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7.3-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4.17-38B2AC?style=flat&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-Auth_%26_PostgreSQL-3ECF8E?style=flat&logo=supabase&logoColor=white)](https://supabase.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?style=flat&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Vitest](https://img.shields.io/badge/Vitest-3.0.4-6E9F18?style=flat&logo=vitest&logoColor=white)](https://vitest.dev/)
[![Playwright](https://img.shields.io/badge/Playwright-1.50.1-2EAD33?style=flat&logo=playwright&logoColor=white)](https://playwright.dev/)
[![Tests Passing](https://img.shields.io/badge/Tests-278_Passing-brightgreen?style=flat)](#testing-and-verification)
[![Status](https://img.shields.io/badge/Status-Feature_001_Complete-success?style=flat)](#current-development-status)

---

## Table of Contents

- [Product Overview](#product-overview)
- [Current Development Status](#current-development-status)
- [Feature Roadmap](#feature-roadmap)
- [Technology Stack](#technology-stack)
- [Architecture Overview](#architecture-overview)
- [Security Architecture](#security-architecture)
- [Database Design](#database-design)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation and Local Setup](#installation-and-local-setup)
- [Environment Variables](#environment-variables)
- [Running the Application](#running-the-application)
- [Testing and Verification](#testing-and-verification)
- [Development Workflow](#development-workflow)
- [Contributing](#contributing)
- [License](#license)

---

## Product Overview

Retail businesses frequently struggle with fragmented operational tooling: one system for point-of-sale, another for inventory, spreadsheets for tracking employees, and disjointed software for analytics. This fragmentation creates data silos, causes stock discrepancies, slows checkout throughput, and limits operational visibility.

**BizFlow AI** is designed to solve this by providing a unified, multi-tenant retail management platform. The long-term product vision encompasses:
- Centralized store and branch management across multiple retail locations.
- Real-time inventory tracking with immutable stock movement audit trails.
- High-efficiency Point of Sale (POS) with receipt issuance and cash-drawer management.
- Granular Role-Based Access Control (RBAC) separating Owners, Admins, Managers, and Cashiers.
- AI-assisted business workflows, automated reordering suggestions, and executive operational insights.

---

## Current Development Status

The platform is being constructed using **Spec-Driven Development (SDD)** with formal constitutional rules and strict verification gates.

### ✅ Completed: Feature 001 — Authentication & Organization Foundation

All 65 tasks across Feature 001 are fully implemented and verified against automated unit, integration, and end-to-end test suites:

- **Authentication Infrastructure**:
  - Secure registration with client- and server-side Zod password complexity validation (min. 8 characters, uppercase, lowercase, numbers, special characters).
  - Mandatory email verification gating; unverified accounts cannot create or access tenant workspaces.
  - Credential authentication with constant-time anti-enumeration error handling.
  - Supabase PKCE (Proof Key for Code Exchange) auth callbacks with open-redirect sanitization.
  - Global session termination and single-device sign-out flows.
- **Organization Onboarding & Provisioning**:
  - Store provisioning wizard with database-enforced ISO 3166-1 alpha-2 country, ISO 4217 currency, and IANA timezone validation.
  - Creator-bound idempotency via `(created_by, client_mutation_id)` composite constraints.
  - Atomic database transactions assigning the creator as `owner` upon organization creation.
  - Single-owner invariant enforcement preventing organizations from ever becoming ownerless.
- **Multi-Tenant Context & Routing**:
  - Multi-organization membership support: users can belong to multiple stores with independent roles.
  - In-app organization switcher with dynamic workspace navigation.
  - Persistent active organization tracking via sanitized `bizflow_active_org` preference cookies with deterministic oldest-membership fallback.
  - Server-side tenant context resolution (`getTenantContext()`) in Next.js Server Components.
  - Anti-enumeration route protection: non-member or inactive store requests render `404 Not Found` rather than leaking tenant existence.
- **Profile Management & Password Recovery**:
  - Personal profile viewing and editing with phone number formatting and validation.
  - In-app authenticated password updates requiring current password verification and revoking other active sessions.
  - Cryptographically verified password recovery flow utilizing Supabase Auth AMR claims.
  - Atomic single-use recovery nonce tracking in PostgreSQL preventing concurrent replay attacks.
  - Dedicated `RECOVERY_GRANT_SECRET` cryptographically isolating recovery tokens from Supabase keys.
  - Global session revocation upon password reset across all active user devices.

> **Note on Scope**: Feature modules for employee invitations, inventory management, POS sales, invoicing, expenses, and AI analytics are planned for subsequent milestones and are not yet active in this repository.

---

## Feature Roadmap

```
┌────────────────────────────────────────────────────────────────────────┐
│ COMPLETED                                                              │
├────────────────────────────────────────────────────────────────────────┤
│ [x] Feature 001: Authentication, Onboarding & Multi-Tenant Foundation │
└────────────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────────────┐
│ PLANNED MILESTONES                                                     │
├────────────────────────────────────────────────────────────────────────┤
│ [ ] Feature 002: Team Member Invitations & RBAC Management             │
│ [ ] Feature 003: Retail Dashboard & Performance Metrics                │
│ [ ] Feature 004: Product Catalog & Category Taxonomy                  │
│ [ ] Feature 005: Real-Time Inventory & Stock Movement Audit Log        │
│ [ ] Feature 006: Customer Relationship Management (CRM)                │
│ [ ] Feature 007: Point of Sale (POS), Orders & Payment Processing      │
│ [ ] Feature 008: Invoicing, Receipts & Tax Compliance                  │
│ [ ] Feature 009: Expense Management & Financial Ledger                 │
│ [ ] Feature 010: Business Intelligence, Analytics & AI Assistant       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

### Core Framework & Runtime
- **Next.js 15.1.6**: React framework utilizing the App Router, React Server Components (RSC), Server Actions, and Edge Middleware.
- **React 19.0.0 / React DOM 19.0.0**: Foundation for interactive component state, server rendering, and form action primitives.
- **TypeScript 5.7.3**: Strict static type checking with zero `any` assertions across all application and test code.

### Styling & UI Components
- **Tailwind CSS 3.4.17**: Utility-first styling framework.
- **Lucide React 0.474.0**: Accessible iconography suite.
- **clsx 2.1.1 & tailwind-merge 2.6.0**: Dynamic CSS class composition and conflict resolution.

### Form Handling & Data Validation
- **React Hook Form 7.54.2**: High-performance, un-opinionated form state management.
- **Zod 3.24.1**: Schema-first validation library enforcing contracts at runtime boundaries across forms, server actions, and environment variables.
- **@hookform/resolvers 3.10.0**: Zod validation integration bridge for React Hook Form.

### Database, Auth & Backend Services
- **PostgreSQL 17**: Relational database engine configured via the local Supabase CLI stack.
- **Supabase Auth (GoTrue)**: User identity service with PKCE email confirmations, recovery flows, and JWT issuance.
- **@supabase/ssr 0.5.2**: Cookie-based server client adapter for Next.js App Router and Server Actions.
- **@supabase/supabase-js 2.48.1**: Isomorphic Supabase client library.
- **pg 8.23.1**: PostgreSQL client driver for direct database verification in test suites.

### Testing & Verification Tooling
- **Vitest 3.0.4**: Unit and integration test runner executing across Node.js and JSDOM environments.
- **@testing-library/react 16.2.0**: Component behavior testing primitives.
- **Playwright 1.50.1**: Headless Chromium end-to-end browser test automation framework.
- **ESLint 9.19.0 & eslint-config-next 15.1.6**: Static code analysis and linting.

---

## Architecture Overview

BizFlow AI enforces strict separation between client-side rendering, server-side authorization, and database-level multi-tenancy.

```mermaid
flowchart TD
    Client["Client Browser\n(React 19 / Client Components)"]

    subgraph Edge["Next.js Server Runtime (App Router)"]
        MW["Edge Middleware (src/middleware.ts)\n• Session token refresh\n• Unauthenticated redirects\n• Safe return URL preservation"]
        SC["Server Components & Layouts\n• src/app/[slug]/layout.tsx\n• src/app/(auth)/*\n• src/app/settings/*"]
        TC["Tenant Context Guard (src/lib/auth/context.ts)\n• getUser() verified identity\n• Email confirmation check\n• Active org & membership resolution\n• 404 anti-enumeration on unauthorized"]
        SA["Server Actions (src/actions/*)\n• auth-actions.ts\n• organization-actions.ts\n• profile-actions.ts\n• Zod runtime validation"]
    end

    subgraph SupabasePlatform["Supabase & PostgreSQL Platform (Docker Local / Cloud)"]
        AuthSvc["Supabase GoTrue Auth Server\n• Cryptographic JWT signing\n• PKCE authorization exchange\n• Global session revocation"]

        subgraph PostgresEngine["PostgreSQL Database (Port 54322)"]
            RLS["Universal FORCE ROW LEVEL SECURITY\n• profiles (own & peer read, own update)\n• organizations (member-only read)\n• organization_memberships (deny-all direct client mutation)\n• organization_audit_events (deny-all direct mutation)\n• recovery_grants (deny-all direct client access)"]

            DBRPC["Stored Procedures & Triggers (SECURITY DEFINER)\n• create_organization_with_owner()\n• create_recovery_grant()\n• verify_recovery_grant()\n• consume_recovery_grant() (atomic row lock)\n• trg_check_owner_invariant"]

            Tables["PostgreSQL Tables\n• profiles\n• organizations\n• organization_memberships\n• organization_audit_events\n• recovery_grants"]
        end
    end

    Client -->|"HTTPS / Cookie Session"| MW
    MW -->|"Session Refreshed"| SC
    MW -->|"API Route / PKCE Exchange"| AuthSvc
    SC --> TC
    SC --> SA
    TC -->|"Authenticated Client (ANON key + Cookie)"| RLS
    SA -->|"Zod Validated Mutation"| DBRPC
    DBRPC --> Tables
    RLS --> Tables
    AuthSvc -.->|"Session & AMR verification"| SC
```

### Architectural Principles

1. **Server Actions for Mutations**: All state modifications (registration, sign-in, store creation, profile edits, password resets) occur via Next.js Server Actions with strict Zod validation before database execution.
2. **Server-Side Tenant Resolution**: Workspace routes (`src/app/[slug]/...`) resolve tenant access server-side via `getTenantContext()`. Client-supplied tenant IDs or cookies are never trusted for authorization.
3. **Database as the Ultimate Authority**: Even if application code were compromised, PostgreSQL Row-Level Security prevents cross-tenant data leakage.

---

## Security Architecture

The platform adheres to non-negotiable security requirements defined in the BizFlow AI Constitution:

1. **PostgreSQL Row-Level Security with FORCE RLS**:
   All tenant tables have `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`. This ensures RLS rules apply to table owners and authenticated clients alike, guaranteeing that no query returns data outside the caller's active memberships.
2. **Deny-All Direct Client Mutations on Memberships**:
   `organization_memberships` denies direct client `INSERT`, `UPDATE`, and `DELETE` via RLS policies (`WITH CHECK (false)`). Role modifications must execute through authorized, audited server stored procedures.
3. **Single-Owner Invariant Protection**:
   A database trigger (`trg_check_owner_invariant`) enforces an organization-level row lock on any role update or deletion. It is impossible to delete or demote the last remaining `owner` of an organization.
4. **Creator-Bound Idempotency**:
   The `organizations` table enforces a composite unique constraint `(created_by, client_mutation_id)`. Replaying an organization creation request returns the creator's existing store, preventing duplicate store creation while blocking other users from hijacking or discovering mutations.
5. **Anti-Enumeration Gating**:
   - Authentication errors for non-existent vs. wrong-password credentials return generic alerts.
   - Accessing unauthorized or closed tenant slugs triggers `notFound()` (HTTP 404), preventing malicious actors from probing whether an organization exists.
   - Password reset requests return identical success notifications regardless of whether the email is registered.
6. **Atomic Single-Use Recovery Nonce Consumption**:
   Password reset links establish a cryptographic recovery grant stored in PostgreSQL (`recovery_grants`). When resetting a password, an atomic `UPDATE` with row locking consumes the grant. Concurrent requests with the same token race on the lock; exactly one succeeds, and the other is rejected with `UNAUTHORIZED_RECOVERY`.
7. **Cryptographic JWT Verification**:
   The recovery pipeline validates authentication sessions using `supabase.auth.getUser()`, requiring the Supabase Auth server to cryptographically verify token signatures, expiry, and AMR (`method: "recovery"`) claims.
8. **Decoupled Authoritative Profile Store**:
   `public.profiles` is the authoritative source of record for user profiles. Synchronization with Supabase Auth `user_metadata` is handled best-effort with non-fatal logging, eliminating distributed two-phase rollback hazards.
9. **Dedicated Secrets & Zero Service-Role Exposure**:
   `RECOVERY_GRANT_SECRET` is a dedicated, server-only 256-bit secret (min 32 characters) used exclusively for signing and verifying recovery grants. `SUPABASE_SERVICE_ROLE_KEY` is never used as a recovery fallback and is never referenced in client-side bundles or client components. Client operations strictly use the Supabase Anon key combined with verified HTTP-only session cookies.
10. **Clean Production Surface**:
    Temporary development/testing RPCs (such as `demote_member_role_for_testing`) are permanently dropped from the database schema.

---

## Database Design

The PostgreSQL database schema is managed via sequential Supabase migrations in `supabase/migrations/`:

```mermaid
erDiagram
    AUTH_USERS ||--|| PROFILES : "has profile (1:1)"
    PROFILES ||--o{ ORGANIZATIONS : "created by (1:N)"
    PROFILES ||--o{ ORGANIZATIONS : "closed by (0:1)"
    PROFILES ||--o{ ORGANIZATION_MEMBERSHIPS : "belongs to (1:N)"
    ORGANIZATIONS ||--|{ ORGANIZATION_MEMBERSHIPS : "has members (1:N)"
    ORGANIZATIONS ||--o{ ORGANIZATION_AUDIT_EVENTS : "logs (1:N)"
    PROFILES ||--o{ ORGANIZATION_AUDIT_EVENTS : "acted by (1:N)"
    AUTH_USERS ||--o{ RECOVERY_GRANTS : "issues (1:N)"

    PROFILES {
        uuid id PK "references auth.users(id)"
        text first_name "1-50 chars"
        text last_name "1-50 chars"
        text phone "nullable, 7-20 chars"
        timestamptz created_at
        timestamptz updated_at
    }

    ORGANIZATIONS {
        uuid id PK
        text name "2-100 chars"
        text slug "unique"
        text business_type "2-50 chars"
        text country "ISO 3166-1 alpha-2"
        text currency "ISO 4217"
        text timezone "IANA timezone"
        text tax_id "nullable"
        text phone "nullable"
        text email "nullable"
        text address "nullable"
        uuid created_by FK
        uuid client_mutation_id "idempotency key"
        boolean is_active "default true"
        timestamptz closed_at "nullable"
        uuid closed_by FK "nullable"
        timestamptz created_at
        timestamptz updated_at
    }

    ORGANIZATION_MEMBERSHIPS {
        uuid id PK
        uuid organization_id FK
        uuid user_id FK
        app_role role "owner | admin | manager | cashier"
        membership_status status "active | suspended | revoked"
        timestamptz created_at
        timestamptz updated_at
    }

    ORGANIZATION_AUDIT_EVENTS {
        uuid id PK
        uuid organization_id FK
        uuid actor_id FK
        text event_type "1-100 chars"
        jsonb metadata
        timestamptz created_at
    }

    RECOVERY_GRANTS {
        uuid id PK
        uuid user_id FK
        text session_id
        text nonce_hash "unique SHA-256"
        timestamptz expires_at
        timestamptz consumed_at "nullable, single-use"
        timestamptz created_at
    }
```

### Custom PostgreSQL Types

- **`public.app_role`**: Enum (`'owner'`, `'admin'`, `'manager'`, `'cashier'`).
- **`public.membership_status`**: Enum (`'active'`, `'suspended'`, `'revoked'`).

---

## Project Structure

```
BizFlow-AI/
├── .specify/                  # Spec Kit constitutional rules, scripts, & extensions
├── specs/                     # Formal feature specifications & implementation plans
│   └── 001-auth-organization/ # Feature 001 spec, plan, tasks, data-model, & quickstart
├── src/
│   ├── actions/               # Server Actions (Zod-validated boundary mutations)
│   │   ├── auth-actions.ts          # Sign-up, sign-in, sign-out, password recovery
│   │   ├── organization-actions.ts  # Store creation, organization switching
│   │   └── profile-actions.ts       # Profile updates, authenticated password change
│   ├── app/                   # Next.js 15 App Router pages, layouts, & route handlers
│   │   ├── (auth)/                  # Auth group (sign-in, sign-up, verify-email, etc.)
│   │   ├── api/auth/callback/       # PKCE authentication callback route handler
│   │   ├── onboarding/              # Store onboarding wizard pages
│   │   ├── settings/profile/        # User profile and account security settings
│   │   ├── [slug]/                  # Multi-tenant workspace layouts and dashboards
│   │   ├── globals.css              # Tailwind CSS styles and custom utilities
│   │   ├── layout.tsx               # Root HTML layout shell
│   │   ├── not-found.tsx            # Global 404 Not Found screen
│   │   └── page.tsx                 # Root landing redirect resolver
│   ├── components/            # Reusable React components
│   │   ├── auth/                    # Auth forms (sign-in, sign-up, password reset)
│   │   ├── layout/                  # Tenant header, organization switcher
│   │   ├── organization/            # Store creation forms
│   │   ├── settings/                # Profile editing & password change forms
│   │   └── ui/                      # Accessible UI primitives (Button, Card, Input, etc.)
│   ├── lib/                   # Shared business logic and platform adapters
│   │   ├── auth/                    # Tenant context resolver, guards, recovery helpers
│   │   ├── supabase/                # SSR client, middleware client, server client
│   │   ├── validations/             # Zod schemas for auth and organization models
│   │   ├── env.ts                   # Runtime environment variable validation
│   │   └── utils.ts                 # CSS class merger utilities
│   ├── types/                 # TypeScript type definitions
│   │   ├── auth.ts                  # Application domain types & action results
│   │   └── database.ts              # Generated Supabase database schema types
│   └── middleware.ts          # Edge middleware for session refresh & routing
├── supabase/
│   ├── config.toml            # Local Supabase service definitions & port mappings
│   └── migrations/            # Ordered PostgreSQL migration files (01 through 08)
├── tests/
│   ├── e2e/                   # Playwright end-to-end browser user journey tests
│   ├── integration/           # Vitest integration tests against local Supabase / RLS
│   ├── unit/                  # Vitest unit tests for schemas, utilities, & components
│   └── setup.ts               # Test environment initialization and matchers
├── .env.example               # Template for required environment variables
├── next.config.ts             # Next.js configuration
├── package.json               # Package dependencies and npm scripts
├── playwright.config.ts       # Playwright E2E configuration
├── tailwind.config.ts         # Tailwind CSS design system tokens
├── tsconfig.json              # Strict TypeScript compiler options
└── vitest.config.ts           # Vitest test runner configuration
```

---

## Prerequisites

Before running the project locally, ensure the following software is installed:

- **Node.js**: `v20.x` or later (tested on Node.js v22).
- **npm**: `v10.x` or later.
- **Git**: `v2.x` or later.
- **Docker Desktop**: Required to run the local Supabase container stack (PostgreSQL, GoTrue, Mailpit).
- **Supabase CLI**: Required for database migration and local service management. You can install it globally or run it via `npx supabase`:
  ```bash
  npm install -g supabase
  ```

---

## Installation and Local Setup

Follow these steps to configure and run BizFlow AI on your local development machine:

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/BizFlow-AI.git
cd BizFlow-AI
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start Local Supabase Stack

Ensure Docker Desktop is running, then start the Supabase local container services:

```bash
npx supabase start
```

Upon startup, the Supabase CLI outputs your local service URLs and development keys:
- **API URL**: `http://127.0.0.1:54321`
- **GraphQL URL**: `http://127.0.0.1:54321/graphql/v1`
- **DB URL**: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- **Studio URL**: `http://127.0.0.1:54323`
- **Inbucket / Mailpit**: `http://127.0.0.1:54324`
- **anon key**: `<your-local-anon-key>`
- **service_role key**: `<your-local-service-role-key>`

### 4. Configure Environment Variables

Create a local environment file by copying `.env.example`:

```bash
cp .env.example .env.local
```

Populate `.env.local` with the values printed by `supabase start`:

```ini
# Supabase Public API (Accessible by client & server)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-local-anon-key

# Application Base URL (Used for auth redirects and callbacks)
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Supabase Service Role Key (Server-only; used for integration test seeding; NEVER exposed to browser)
SUPABASE_SERVICE_ROLE_KEY=your-local-service-role-key

# Dedicated Server-Only Recovery Secret (min 32 characters; NEVER exposed to browser)
RECOVERY_GRANT_SECRET=bizflow-local-recovery-grant-secret-at-least-32-chars-long
```

> **Warning**: Never commit `.env.local` to version control. The repository's `.gitignore` explicitly excludes all `.env*.local` files.

### 5. Apply Database Migrations

Apply the sequential database migrations, triggers, and Row-Level Security policies:

```bash
npx supabase db reset
```

This applies migrations `01` through `08` cleanly onto your local PostgreSQL database.

### 6. Start the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to view the application.

---

## Environment Variables

| Variable | Scope | Purpose | Required | Default |
| :--- | :--- | :--- | :---: | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Public / Browser | URL of the Supabase API Gateway | **Yes** | `http://127.0.0.1:54321` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public / Browser | Anonymous API key safe for browser client requests | **Yes** | — |
| `NEXT_PUBLIC_APP_URL` | Public / Browser | Root URL of the Next.js app for auth callbacks | No | `http://localhost:3000` |
| `RECOVERY_GRANT_SECRET` | Server-Only | Dedicated 256-bit secret (min 32 chars) for recovery token HMAC signing | **Yes** | — |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-Only | Privileged admin key for integration test harness seeding | **Yes** (Tests) | — |

---

## Running the Application

All available scripts from `package.json`:

```bash
# Start local Next.js development server with hot-reload
npm run dev

# Compile an optimized production build
npm run build

# Start production server from compiled build
npm run start

# Run strict TypeScript compiler verification without emitting files
npm run typecheck

# Run Next.js and ESLint code quality checks
npm run lint

# Run all unit tests with Vitest
npm run test:unit

# Run all integration tests against local Supabase / RLS
npm run test:integration

# Run all tests (unit + integration)
npm test

# Run Playwright end-to-end browser test suites
npm run test:e2e
```

---

## Testing and Verification

BizFlow AI maintains a comprehensive, three-tier automated verification architecture. All 278 automated tests pass cleanly:

```text
================================================================================
Test Category         Runner      Scope                            Count   Result
================================================================================
Unit Tests            Vitest      Schemas, utilities, components   123     PASS
Integration Tests     Vitest      Real Supabase JWT / RLS checks   125     PASS
End-to-End Tests      Playwright  Full browser user journeys        30     PASS
────────────────────────────────────────────────────────────────────────────────
Total Automated Tests Passing:                                     278     PASS
================================================================================
```

### 1. Unit Tests (`npm run test:unit`)
- Validates Zod boundary schemas: registration, sign-in, ISO country/currency rules, profile edits, password complexity.
- Tests foundational UI primitives (`Button`, `Card`, `Input`, `Form`, `Alert`).
- Tests environment variable validation and safe redirect URL sanitization.
- Tests dedicated recovery grant secret isolation: enforces minimum 32 characters, prevents fallback to other keys, and verifies token minting and signature validation.

### 2. Integration Tests (`npm run test:integration`)
- Executes against the live local PostgreSQL instance using real Supabase JWT sessions.
- **RLS Multi-Tenant Isolation**: Confirms User A cannot read or modify User B's store data under `FORCE ROW LEVEL SECURITY`.
- **Membership Direct Mutation Denial**: Verifies direct client `INSERT`/`UPDATE`/`DELETE` calls are rejected with 0 rows affected.
- **Creator-Bound Idempotency**: Asserts replaying store creation with the same `client_mutation_id` returns the existing store without duplicating rows.
- **Atomic Single-Use Recovery Nonce Consumption**: Concurrently executes two password reset submissions with the same grant; verifies PostgreSQL row locks allow exactly one to succeed while rejecting the competitor.
- **Profile Decoupling**: Verifies profile updates persist authoritatively even if auth metadata sync fails.

### 3. End-to-End Browser Tests (`npm run test:e2e`)
Playwright tests simulate complete user journeys across Chromium:
- **`auth-flow.spec.ts`**: Registration, verification pending card, email resend, invalid credentials rejection, and route protection.
- **`onboarding-flow.spec.ts`**: Store creation wizard, inline form validation, store provisioning, and dashboard transition.
- **`organization-switch.spec.ts`**: Multi-store navigation, organization switching, active preference cookie persistence, fallback resolution, and tampered cookie rejection.
- **`profile-password.spec.ts`**: Profile detail editing, in-app password changes, and complete email link password recovery with session revocation.
- **`tenant-isolation.spec.ts`**: Cross-tenant URL slug tampering rejection, suspended user gating, and verified tenant context resolution.

---

## Development Workflow

The project follows **Spec-Driven Development (SDD)** with structured specifications located in `specs/`:

1. **Constitution & Principles**: `.specify/memory/constitution.md` sets non-negotiable architectural rules (PostgreSQL RLS, financial invariants, strict TypeScript, server-side authorization).
2. **Feature Branching**: Development proceeds on dedicated feature branches (e.g., `001-auth-organization`).
3. **Specification & Contracts**: Before implementation, `spec.md`, `plan.md`, `data-model.md`, and contracts in `contracts/` define requirements and acceptance scenarios.
4. **Task-Driven Execution**: `tasks.md` breaks implementation into sequential phases with explicit dependencies and checkpoints.
5. **Quality Gates**: Every pull request must satisfy the seven mandatory verification gates: clean database migration, typecheck, lint, unit tests, integration tests, E2E tests, and production build.

---

## Contributing

Contributions from collaborators and team members are welcome. Please follow this workflow:

1. **Check Prerequisites**: Ensure Docker Desktop and the Supabase CLI are operational.
2. **Create a Feature Branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Adhere to Code Standards**:
   - Write strict TypeScript with zero `any` assertions.
   - Validate all server action inputs using Zod.
   - Maintain multi-tenant isolation; never query tenant tables without enforcing `organization_id` via RLS.
4. **Run Verification Gates**:
   ```bash
   npm run typecheck
   npm run lint
   npm run test:unit
   npm run test:integration
   npm run test:e2e
   npm run build
   ```
5. **Submit a Pull Request**: Provide a detailed description of the changes, referencing the relevant specification or issue.

---

## License

This project is currently private and does not have an open-source license assigned. All rights are reserved. Unauthorized copying, distribution, modification, or commercial deployment of this software is strictly prohibited without prior written permission from the project owner.

---

## Summary

BizFlow AI is engineered from the ground up for high reliability, strict multi-tenant security, and scalable retail operations. With Feature 001 complete, the platform provides a verified foundation for upcoming business management and AI-assisted workflows.
