<!--
Sync Impact Report
Version change: 0.0.0 (Unratified Template) → 1.0.0
List of modified principles:
  - [PRINCIPLE_1_NAME] → I. Multi-Tenancy & Absolute Data Isolation (NON-NEGOTIABLE)
  - [PRINCIPLE_2_NAME] → II. Financial Invariance & Traceable Retail Operations (NON-NEGOTIABLE)
  - [PRINCIPLE_3_NAME] → III. Strict Type Safety & Modular Architecture
  - [PRINCIPLE_4_NAME] → IV. Defense-in-Depth Security & Server-Enforced RBAC
  - [PRINCIPLE_5_NAME] → V. Verified AI Integration & Critical Action Guardrails
  - [Added] → VI. Professional UX & Operational Ergonomics
  - [Added] → VII. Comprehensive Quality Verification & Test Integrity
Added sections:
  - Technical Baseline & Architectural Constraints (SECTION_2_NAME)
  - Development Workflow, Quality Gates & SDD Governance (SECTION_3_NAME)
Removed sections: None
Templates requiring updates:
  - .specify/memory/constitution.md (✅ ratified to v1.0.0)
  - AGENTS.md (✅ updated to reference constitution)
  - .specify/templates/plan-template.md (✅ aligned with constitution gates)
Follow-up TODOs: None
-->

# BizFlow AI Constitution

## Core Principles

### I. Multi-Tenancy & Absolute Data Isolation (NON-NEGOTIABLE)
All data belonging to an organization MUST be strictly isolated at all tiers.
- **Tenant Anchor**: Every database table containing tenant-scoped data MUST have a non-nullable `organization_id` foreign key referencing the `organizations` table, indexed for high-efficiency querying.
- **Row-Level Security (RLS)**: PostgreSQL Row-Level Security MUST be enabled and forced on every tenant table in Supabase. No tenant queries MAY bypass RLS in application-facing paths.
- **Zero-Trust Client Context**: The server MUST NEVER trust an `organization_id` provided in client payloads, headers, or URL parameters. The active organization identity MUST be securely resolved from the authenticated user's verified session and membership records.
- **Multi-Org Membership**: Users MAY belong to multiple organizations with distinct roles in each. Tenant context switching MUST trigger re-authentication and session token boundary re-validation.
- **Key Safeguards**: The Supabase service-role key MUST NEVER be exposed to the client, bundled in client builds, or utilized in client-accessible API routes without strict elevated boundary justification.

### II. Financial Invariance & Traceable Retail Operations (NON-NEGOTIABLE)
Financial and inventory records represent legal business truth and MUST remain mathematically consistent, auditable, and immutable.
- **Atomic Operations**: Operations spanning multiple tables (e.g., checkout deducting inventory, generating sales records, creating invoice snapshots, and logging payments) MUST be wrapped in explicit PostgreSQL database transactions.
- **Double-Entry Stock Tracking**: Every modification to inventory levels MUST produce an immutable `stock_movements` ledger entry recording previous stock, quantity changed, new stock, reason (sale, return, damage, restock), reference document ID, and creator timestamp.
- **Negative Stock Prevention**: Inventory decrement transactions MUST enforce non-negative stock constraints at the database level by default.
- **Historical Snapshots**: Sales lines and invoices MUST store captured snapshots of product names, SKUs, unit cost, sale prices, discount rates, and tax percentages at the moment of sale to insulate historical reporting from future catalog edits.
- **Immutability of Completed Transactions**: Completed sales and issued invoices MUST NOT be silently edited or deleted. Corrections MUST be executed through audited reversal, refund, void, or credit note workflows.
- **Monetary Precision**: All currency amounts MUST be stored using fixed-point representation (e.g., integer minor units/cents or PostgreSQL `NUMERIC(12, 2)` / `DECIMAL`) to eliminate floating-point rounding errors.

### III. Strict Type Safety & Modular Architecture
The system MUST be built as an extensible, maintainable modular monolith emphasizing clarity over premature abstraction.
- **Strict TypeScript**: TypeScript MUST be configured in strict mode (`noImplicitAny`, `strictNullChecks`) across both frontend and backend. The use of `any` is strictly prohibited in production code; use unknown, generics, or precise interfaces.
- **Modular Monolith**: Code MUST be organized by feature domain (e.g., `features/inventory`, `features/sales`, `features/customers`, `features/organizations`) grouping domain logic, validation schemas, server actions, and UI components together.
- **Clean Boundaries**: UI components MUST NOT execute direct database SQL or unvalidated external calls. Separation between UI presentation, application orchestration (Next.js Server Actions / Route Handlers), domain services, and database persistence MUST be maintained.
- **Runtime Schema Validation**: All untrusted external input (client form submissions, route arguments, search parameters, webhook payloads, and AI inputs/outputs) MUST be validated and sanitized using Zod schemas at the application boundary.
- **Simplicity & YAGNI**: No premature microservices, event-driven message buses, or complex repository layers without explicit, documented architectural justification. Choose standard, idiomatic Next.js App Router and PostgreSQL primitives first.

### IV. Defense-in-Depth Security & Server-Enforced RBAC
Security and authorization controls MUST be enforced comprehensively on the server.
- **Server-Side Authorization**: UI-based role checks (e.g., hiding buttons or menu links) are purely cosmetic UX affordances. Every server action, API route handler, and database query MUST independently authenticate the caller and verify granular role-action permissions.
- **Granular RBAC**: Access control MUST follow granular resource-action verbs (e.g., `inventory:read`, `inventory:adjust`, `sales:create`, `settings:update`). Predefined system roles (Owner, Admin, Manager, Cashier) MUST map deterministically to explicit permission sets.
- **Least Privilege**: Users and processes MUST operate with the minimum permissions required to perform their designated duties.
- **Data Protection & Sanitization**: Sensitive credentials, access tokens, customer PII, and organization secrets MUST be encrypted in transit (TLS) and at rest. All user-supplied text MUST be sanitized against XSS and injection vulnerabilities.

### V. Verified AI Integration & Critical Action Guardrails
Artificial Intelligence assistance MUST be safe, sandboxed, and auxiliary to deterministic business logic.
- **Untrusted Output**: AI-generated responses (e.g., summary insights, automated categorization, retail recommendations) MUST be treated as untrusted and potentially hallucinated data. They MUST NOT be persisted to the database without explicit user review or structural validation.
- **Zero Privilege Escalation**: AI query generators or assistant pipelines MUST strictly operate within the requesting user's active tenant and RBAC boundaries, querying data exclusively through RLS-enforced database channels.
- **Critical Action Barrier**: AI models MUST NEVER autonomously execute financial transactions, invoice voids, inventory deletions, or permission alterations. Any AI-suggested operational action MUST require explicit, confirmed human-in-the-loop approval followed by standard server-side validation.
- **Data Privacy & Redaction**: Prompts dispatched to external LLM providers (e.g., OpenAI API) MUST be scrubbed of unnecessary Personally Identifiable Information (PII), payment credentials, and internal system secrets. Prompts MUST NEVER cross-pollinate data between distinct tenants.

### VI. Professional UX & Operational Ergonomics
The user interface MUST deliver high operational efficiency, predictability, and responsiveness tailored for retail store environments.
- **Deterministic UI States**: Every asynchronous data screen MUST explicitly handle four fundamental states: Loading (skeleton/spinner), Empty (actionable onboarding/guidance), Error (actionable recovery message), and Success/Data.
- **Operational Speed**: Retail checkout, product search, and barcode scanning workflows MUST be optimized for low-latency feedback and complete keyboard navigability.
- **Design System Consistency**: UI development MUST utilize reusable components from shadcn/ui and Tailwind CSS utility classes, adhering to standardized spacing, typography, status badges, and dialog patterns.
- **Accessibility & Responsiveness**: Interfaces MUST comply with WCAG 2.1 AA standards (sufficient contrast, semantic HTML, screen reader labels) and render seamlessly across desktop point-of-sale displays, tablets, and mobile screens.

### VII. Comprehensive Quality Verification & Test Integrity
Quality is guaranteed through deterministic automated verification across all system tiers.
- **Mandatory Test Coverage**:
  - **Unit Tests**: Pure domain logic, financial math, discount calculations, tax formulas, and utility functions MUST have complete unit test coverage.
  - **Integration Tests**: Multi-tenant database RLS policies, authorization guards, and complex multi-step database transactions MUST be tested against realistic isolated tenant databases.
  - **End-to-End Tests**: Critical retail happy-paths (authentication, tenant selection, full POS sale lifecycle, stock adjustment, invoice generation) MUST be validated with automated browser flows.
- **Definition of Done**: A feature or user story MUST NOT be marked complete solely because its visual component renders without syntax errors. Completion requires passing all acceptance scenarios, verified tenant isolation, passing lint/type checks, and automated test coverage for critical paths.

## Technical Baseline & Architectural Constraints

The BizFlow AI codebase is standardized on the following technical baseline. Deviations require an amendment to this constitution.

1. **Frontend Architecture**:
   - **Framework**: Next.js App Router (React 19+, React Server Components by default).
   - **Styling**: Tailwind CSS with standard design tokens.
   - **Component Library**: shadcn/ui (Radix UI primitives).
   - **State & Forms**: React Hook Form with `@hookform/resolvers/zod` for declarative client-side and server-side form validation.
   - **Visualization**: Recharts for business performance, revenue, and inventory trend visualization.
2. **Backend & Persistence**:
   - **Database**: PostgreSQL 15+ hosted on Supabase.
   - **Authentication**: Supabase Auth with secure JWT session handling in HTTP-only cookies.
   - **Authorization Engine**: PostgreSQL Row-Level Security (RLS) coupled with a centralized RBAC role-permission schema.
   - **Storage**: Supabase Storage with bucket-level RLS policies for receipts, product images, and export files.
   - **Migrations**: Declarative, version-controlled SQL migrations managed through the Supabase CLI. Manual, un-migrated schema mutations in production are strictly forbidden.
3. **AI Pipeline**:
   - **Provider**: OpenAI API via official Node.js / TypeScript SDK.
   - **Architecture**: Structured output generation (JSON mode / Zod response parsing) with strict token and latency budgets.
4. **Hosting & Deployment**:
   - **Hosting Platform**: Vercel for the Next.js application, Supabase Cloud for backend infrastructure.
   - **Environment Management**: Strict separation between Development, Staging, and Production environments with isolated Supabase projects and cryptographic secrets.

## Development Workflow, Quality Gates & SDD Governance

All development on BizFlow AI strictly follows the **Spec-Driven Development (SDD)** lifecycle. Work proceeds through discrete, verifiable gates:

```
[1. Constitution] → [2. Specify] → [3. Clarify] → [4. Plan] → [5. Tasks] → [6. Analyze] → [7. Implement] → [8. Converge]
```

1. **Phase 1: Constitution (`speckit-constitution`)**:
   - Permanently enshrines non-negotiable architectural, security, and quality principles.
2. **Phase 2: Specify (`speckit-specify`)**:
   - Creates `specs/[###-feature]/spec.md` defining prioritized user stories (P1, P2, P3...), independent testing criteria, and explicit Given/When/Then acceptance scenarios.
   - Implementation MUST NOT begin at this stage.
3. **Phase 3: Clarify (`speckit-clarify`)**:
   - Identifies underspecified edge cases, data limits, and business ambiguities through targeted questions before planning.
4. **Phase 4: Plan (`speckit-plan`)**:
   - Produces technical design artifacts (`plan.md`, `research.md`, `data-model.md`, `contracts/`).
   - Every plan MUST include a mandatory **Constitution Check** verifying compliance with Multi-Tenancy (Principle I), Financial Invariance (Principle II), Security (Principle IV), and Architecture (Principle III).
5. **Phase 5: Tasks (`speckit-tasks`)**:
   - Deconstructs the plan into actionable, dependency-ordered tasks grouped by user story with explicit file targets.
6. **Phase 6: Analyze (`speckit-analyze`)**:
   - Conducts non-destructive cross-artifact consistency checks between `spec.md`, `plan.md`, and `tasks.md`.
7. **Phase 7: Implement (`speckit-implement`)**:
   - Executes approved tasks in strict sequence. No out-of-spec code, unapproved dependencies, or unauthorized scope expansions are permitted.
8. **Phase 8: Converge & Verify**:
   - Validates the implementation against the original acceptance criteria and automated tests.

### Non-Negotiable Governance Rules
- **No Premature Implementation**: Code MUST NOT be written before the corresponding specification and plan pass all verification gates.
- **Scope Discipline (MVP Boundary)**: Feature proposals that introduce non-essential enterprise abstractions, multi-warehouse global routing, or unneeded third-party integrations during the MVP phase MUST be rejected.
- **Architectural Escalation**: Any feature requiring a violation of constitutional principles MUST be documented in the implementation plan's `Complexity Tracking` table with explicit trade-off justification before proceeding.

## Governance

This Constitution is the supreme engineering authority for BizFlow AI. It supersedes informal agreements, ad-hoc tickets, and temporary convenience shortcuts.

1. **Amendment Procedure**:
   - Any modification to this Constitution requires an explicit proposal, architectural impact review, and ratification.
   - Every amendment MUST document the rationale, affected systems, and a transition/migration plan for existing code and specifications.
2. **Versioning Policy**:
   - Semantic versioning (`MAJOR.MINOR.PATCH`) is enforced:
     - **MAJOR**: Incompatible principle alterations, removal of core security/isolation gates, or foundational architectural pivots.
     - **MINOR**: Addition of new engineering principles, new functional domains, or material expansion of governance standards.
     - **PATCH**: Clarifications, formatting refinements, typographical corrections, or non-semantic wording updates.
3. **Compliance & Review**:
   - All Pull Requests, code reviews, and automated CI workflows MUST verify constitutional adherence.
   - Reviewers MUST block any code introducing cross-tenant vulnerabilities, unvalidated mutations, untracked inventory alterations, or bypassed server authorization.

**Version**: 1.0.0 | **Ratified**: 2026-10-30 | **Last Amended**: 2026-10-30