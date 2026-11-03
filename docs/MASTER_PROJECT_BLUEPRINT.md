# BIZFLOW AI
## Master Product Development & Portfolio Plan

**Project:** BizFlow AI  
**Product Type:** AI-Powered Retail Business Management SaaS  
**Platforms:** Web Application + Flutter Mobile Application  
**Development Approach:** Specification-Driven Development (SDD)  
**Project Status:** Feature 001 completed; production deployment successful  
**Primary Objective:** Build a production-quality, multi-tenant retail management platform suitable for real-world use and international freelance portfolio presentation.

---

# 1. Product Vision

BizFlow AI is a multi-tenant business management platform designed to help small and medium-sized retail businesses manage their daily operations from one centralized system.

The platform will combine traditional business management capabilities with AI-powered business insights.

A business owner should be able to manage products, inventory, employees, customers, sales, expenses, invoices, and business performance without relying on multiple disconnected applications.

The system will consist of:

1. **Web Application:** The primary business management platform.
2. **Flutter Mobile Application:** A companion application for business owners and employees who need access to important operations while away from their computers.
3. **Shared Backend:** One centralized backend, database, authentication system, and business logic layer.
4. **AI Assistant:** A business intelligence interface that provides useful insights from authorized business data.

## Product Goals

- Provide a complete retail business management solution.
- Support multiple businesses under one user account.
- Ensure strict organization-level data isolation.
- Provide role-based employee permissions.
- Synchronize web and mobile operations.
- Deliver useful AI-powered business insights.
- Maintain a scalable, secure, and maintainable architecture.
- Produce a professional portfolio project demonstrating full-stack and mobile development capabilities.

---

# 2. Technology Stack

## 2.1 Web Application

| Area | Technology |
|---|---|
| Framework | Next.js App Router |
| Language | TypeScript (Strict Mode) |
| Styling | Tailwind CSS |
| UI Components | shadcn/ui |
| Forms | React Hook Form |
| Validation | Zod |
| Data Fetching | TanStack Query |
| Charts | Recharts |
| Authentication | Supabase Auth |
| Database | PostgreSQL (Supabase) |
| Backend | Next.js Server Actions and Route Handlers |
| AI Integration | OpenAI API |
| PDF Generation | Server-side PDF generation |
| Testing | Vitest and Playwright |
| Hosting | Vercel |

## 2.2 Mobile Application

| Area | Technology |
|---|---|
| Framework | Flutter |
| Language | Dart |
| Architecture | Feature-first, layered architecture |
| State Management | Riverpod |
| Navigation | GoRouter |
| Networking | Dio |
| Authentication | Supabase Auth |
| Local Storage | Secure storage + local database where appropriate |
| Models | Freezed / JSON serialization |
| Charts | fl_chart |
| Notifications | Firebase Cloud Messaging |
| Testing | Flutter Test and integration tests |
| Distribution | Google Play Store and Apple App Store |

## 2.3 Backend and Infrastructure

- Supabase PostgreSQL.
- Supabase Authentication.
- PostgreSQL Row-Level Security (RLS).
- Database functions for atomic operations.
- Next.js server-side business logic.
- Versioned REST API for mobile and external clients.
- Vercel deployment.
- OpenAI API integration.
- GitHub for version control and CI/CD.

**Important architectural decision:** The web application and mobile application must use the same business logic and data source. The Flutter app must not create a separate database or duplicate the business rules.

---

# 3. System Architecture

The project will follow a modular monolith architecture.

The system will have separate business modules while maintaining one deployable backend.

## 3.1 High-Level Architecture

```text
                   BIZFLOW AI
                       |
          +------------+------------+
          |                         |
      Web Client                Mobile Client
      Next.js                    Flutter
          |                         |
          +------------+------------+
                       |
                 Backend Layer
                       |
          +------------+------------+
          |            |            |
       Auth/RBAC    REST API    Server Actions
          |            |            |
          +------------+------------+
                       |
                Business Services
                       |
          +------------+------------+
          |            |            |
       Products     Inventory     Sales
       Customers    Employees     Reports
          |            |            |
          +------------+------------+
                       |
               Supabase PostgreSQL
                       |
              Row-Level Security
                       |
              Organization Data
                       |
                AI Integration
```

## 3.2 Architectural Principles

1. Multi-tenancy must be enforced at the database level.
2. Every organization-owned record must have an organization identifier.
3. RLS must prevent unauthorized cross-organization access.
4. Business-critical operations must execute transactionally.
5. The backend must validate every request.
6. Mobile and web must share the same business rules.
7. Sensitive operations must be performed server-side.
8. AI must only access data authorized for the active organization.
9. All important business changes must have an audit trail.
10. External integrations must be isolated behind service interfaces.

---

# 4. User Roles and Permissions

The initial system will support four primary organization roles.

| Role | Responsibilities |
|---|---|
| Owner | Full organization control |
| Admin | Manage business operations and employees within assigned permissions |
| Manager | Manage daily business operations |
| Cashier | Handle customer sales and assigned transactions |

Permissions will be granular rather than relying only on role names.

Examples:

- products.read
- products.create
- products.update
- products.delete
- inventory.read
- inventory.adjust
- sales.read
- sales.create
- sales.refund
- customers.read
- employees.manage
- reports.read
- expenses.manage
- settings.manage

The Owner must retain ultimate organization control.

The backend must enforce permissions independently of the user interface.

---

# 5. Development Roadmap

The roadmap is divided into implementation features. Each feature must have its own specification, implementation plan, tasks, testing, and completion review.

## PHASE 1 — WEB APPLICATION FOUNDATION

### Feature 001 — Authentication & Organizations

**Status: COMPLETED**

Implemented capabilities:

- User registration.
- Email verification.
- Sign-in and sign-out.
- Password recovery.
- Profile foundation.
- Organization creation.
- Owner membership assignment.
- Multiple organization support.
- Organization switching.
- Active organization context.
- Multi-tenant RLS.
- Protected routes.
- Secure server-side context resolution.
- Audit/security foundation.

Production deployment and initial smoke tests completed.

### Feature 002 — Employee Management & RBAC

**Priority: P1**

**Objective:** Allow organization owners to manage employees and control access to business functionality.

Functional requirements:

- Employee management page.
- Invite employees through email.
- Accept and reject invitations.
- Assign employee roles.
- Create and manage custom roles where appropriate.
- Configure granular permissions.
- Activate and deactivate memberships.
- Remove employees from an organization.
- Display employee status.
- Track membership changes.
- Prevent unauthorized role escalation.
- Protect the last active Owner invariant.

Important workflows:

1. Owner sends an employee invitation.
2. Employee receives an invitation.
3. Employee accepts the invitation.
4. Employee becomes an organization member.
5. Owner assigns or changes the employee's role.
6. Employee accesses only authorized features.

**Database entities:**

- organization_invitations
- organization_memberships
- roles
- permissions
- role_permissions
- membership_role_assignments

The existing membership model must be reviewed before introducing new role tables.

**Acceptance criteria:**

- Invitations are organization-scoped.
- Invitations expire and cannot be reused.
- Users cannot grant themselves additional permissions.
- Employees cannot access another organization's records.
- Permission checks work on both web and API endpoints.

### Feature 003 — Products & Categories

**Priority: P1**

**Objective:** Create a complete product catalog.

Functional requirements:

- Create products.
- Edit product information.
- Archive or deactivate products.
- Delete products only when business rules allow it.
- Create and manage categories.
- Search products.
- Filter and sort products.
- Product images.
- SKU management.
- Barcode support.
- Product pricing.
- Cost price.
- Selling price.
- Product status.
- Product details page.
- Pagination.

Suggested product attributes:

- Product name.
- Description.
- SKU.
- Barcode.
- Category.
- Cost price.
- Selling price.
- Image.
- Unit of measurement.
- Status.
- Created and updated timestamps.

**Database entities:**

- categories
- products
- product_images

**Acceptance criteria:**

- Product records belong to an organization.
- SKU uniqueness is enforced within the appropriate organization scope.
- Products cannot be accessed across organizations.
- Product search and filtering work correctly.

### Feature 004 — Inventory Management

**Priority: P1**

**Objective:** Track stock levels and inventory movements.

Functional requirements:

- View inventory overview.
- Track stock quantity.
- Add stock.
- Reduce stock.
- Adjust stock.
- Record stock movements.
- Track stock history.
- Low-stock alerts.
- Out-of-stock indicators.
- Inventory search and filtering.
- Stock adjustment reasons.
- Inventory valuation.
- Stock movement history.

Suggested stock movement types:

- Initial stock.
- Purchase/restock.
- Sale.
- Manual adjustment.
- Return.
- Damage or loss.

**Database entities:**

- inventory
- stock_movements
- inventory_adjustments

**Important business rules:**

- Inventory changes must be transactional.
- Stock movement history must be preserved.
- Stock quantities must not become inconsistent.
- Concurrent sales must not cause incorrect stock calculations.
- Every adjustment must have an audit record.

### Feature 005 — Customers & Sales

**Priority: P1**

**Objective:** Manage customers and complete retail sales transactions.

Customer functionality:

- Create customers.
- Update customer information.
- View customer profiles.
- Search customers.
- View purchase history.
- Track customer contact information.
- Archive customers.

Sales functionality:

- Create sales transactions.
- Add products to a sale.
- Calculate subtotals.
- Apply discounts according to permissions.
- Calculate applicable taxes.
- Select payment methods.
- Complete sales.
- View transaction history.
- Cancel or void transactions according to business rules.
- Process returns and refunds where supported.
- Generate sales receipts.

Payment methods should be configurable, with support for cash, bank transfer, and other payment types as appropriate.

**Database entities:**

- customers
- sales
- sale_items
- payments
- refunds

**Important business rules:**

- A completed sale and its stock deduction must be atomic.
- Payment totals must reconcile with the sale total.
- Historical transaction records must not be silently overwritten.
- Refunds must reference original transactions.
- Financial operations must have audit records.

### Feature 006 — Invoices & Expenses

**Priority: P1**

**Objective:** Provide financial document generation and expense tracking.

Invoice functionality:

- Generate invoices.
- Assign invoice numbers.
- Add customer details.
- Add product/service lines.
- Calculate subtotal.
- Apply discounts and taxes.
- Calculate final totals.
- Download invoices as PDF.
- View invoice history.
- Track invoice status.

Suggested invoice statuses:

- Draft.
- Issued.
- Paid.
- Partially paid.
- Overdue.
- Cancelled.

Expense functionality:

- Record expenses.
- Categorize expenses.
- Add descriptions.
- Record expense dates.
- Attach supporting documents where appropriate.
- Edit or archive expenses.
- Filter expenses.
- View expense history.

**Database entities:**

- invoices
- invoice_items
- expense_categories
- expenses

### Feature 007 — Dashboard & Analytics

**Priority: P1**

**Objective:** Give business owners an overview of business performance.

Dashboard components:

- Total sales.
- Total revenue.
- Total expenses.
- Gross profit.
- Net profit where supported by the accounting model.
- Total products.
- Low-stock products.
- Out-of-stock products.
- Total customers.
- Recent transactions.
- Sales trends.
- Revenue trends.
- Top-selling products.
- Sales by category.
- Expense breakdown.

Reporting functionality:

- Daily reports.
- Weekly reports.
- Monthly reports.
- Custom date ranges.
- Sales reports.
- Inventory reports.
- Expense reports.
- Profitability reports.
- Export reports.

**Important:** Financial metrics must have explicit definitions. Revenue, gross profit, net profit, cash received, and outstanding invoices must not be treated as interchangeable values.

### Feature 008 — AI Business Assistant

**Priority: P2**

**Objective:** Provide natural-language business intelligence.

Example questions:

- How much did my store sell this month?
- Which products sold the most?
- Which products are running low?
- How did this month compare with last month?
- What were my biggest expenses?
- Which product categories generated the most revenue?
- Summarize my recent business performance.

AI capabilities:

- Natural-language questions.
- Business performance summaries.
- Sales analysis.
- Inventory insights.
- Expense analysis.
- Trend identification.
- Actionable recommendations.
- Report summaries.

**AI security requirements:**

- AI requests must be organization-scoped.
- AI must not access unauthorized records.
- Database access must be mediated through authorized backend services.
- Never expose API keys to clients.
- Do not allow AI-generated SQL to execute directly against production data.
- AI responses must distinguish facts from estimates and recommendations.
- Financial calculations must use validated backend data rather than model-generated arithmetic.

---

# 6. PHASE 2 — FLUTTER MOBILE APPLICATION

The mobile app will be developed after the core web application and shared APIs are stable.

It will not be a separate retail management system. It will be another client of the same BizFlow AI backend.

## Feature 009 — Mobile Application Foundation

**Objective:** Establish the Flutter application architecture and backend integration.

Functional requirements:

- Flutter project setup.
- Environment configuration.
- App architecture.
- Authentication integration.
- Secure token/session management.
- Organization selection.
- Active organization context.
- API client.
- Error handling.
- Loading and empty states.
- Navigation.
- Theme system.
- Responsive layouts.
- Offline/network status handling.

Suggested structure:

```text
lib/
  app/
    router/
    theme/
    config/

  core/
    network/
    auth/
    storage/
    errors/
    widgets/
    utils/

  features/
    authentication/
    organizations/
    dashboard/
    products/
    inventory/
    customers/
    sales/
    notifications/
    profile/

  shared/
    models/
    services/
    widgets/

  main.dart
```

## Feature 010 — Mobile Dashboard

Capabilities:

- Business overview.
- Revenue summary.
- Sales summary.
- Low-stock alerts.
- Recent transactions.
- Sales charts.
- Organization switching.
- Date-range filtering.

## Feature 011 — Mobile Product Management

Capabilities:

- Browse products.
- Search products.
- View product details.
- View stock quantity.
- View pricing.
- Scan supported product barcodes.
- Add or update products if permitted.

## Feature 012 — Mobile Inventory Management

Capabilities:

- View inventory.
- Search inventory.
- View stock history.
- Adjust stock with permission.
- Receive low-stock notifications.
- Scan product barcodes.

## Feature 013 — Mobile Sales & Customers

Capabilities:

- View customers.
- Search customers.
- Create customers if permitted.
- View sales history.
- Record sales.
- View transaction details.
- View receipts.
- Process permitted transaction operations.

## Feature 014 — Mobile Notifications & Profile

Capabilities:

- Push notifications.
- Low-stock notifications.
- Relevant sales notifications.
- Employee invitation notifications.
- Profile management.
- Account settings.
- Session management.

## Mobile Product Strategy

The mobile application should prioritize fast, practical workflows.

The web application will remain the primary environment for advanced administration, analytics, configuration, and complex management.

The mobile application will focus on:

- Quick business overview.
- Product lookup.
- Stock monitoring.
- Sales operations.
- Customer lookup.
- Notifications.

Mobile offline support must be introduced carefully. Cached data can be displayed offline, but critical stock and financial operations must be validated against the server before being considered complete.

---

# 7. Shared Backend & API Strategy

Both applications must use the same backend.

## API Architecture

The backend will expose versioned REST endpoints for mobile clients and external integrations.

Example structure:

```text
/api/v1/
  auth/
  organizations/
  employees/
  roles/
  permissions/
  products/
  categories/
  inventory/
  customers/
  sales/
  payments/
  invoices/
  expenses/
  reports/
  ai/
  notifications/
```

The web application may use Server Actions for appropriate web-specific operations, but shared business logic should live in reusable server-side service modules.

## API Requirements

- Authentication through Supabase sessions/tokens.
- Server-side authorization.
- Organization context validation.
- Permission validation.
- Zod request validation.
- Consistent response formats.
- Pagination.
- Filtering and sorting.
- Error handling.
- Rate limiting for sensitive endpoints.
- Audit logging.
- API versioning.

Example response:

```json
{
  "success": true,
  "data": {},
  "message": "Operation completed successfully"
}
```

The actual response contract should be documented and standardized before mobile integration.

---

# 8. Database Design Strategy

The database will use PostgreSQL with a multi-tenant relational model.

Core entities:

## Identity and Organization

- profiles
- organizations
- organization_memberships
- organization_invitations
- organization_audit_events

## Access Control

- roles
- permissions
- role_permissions
- membership_role_assignments

## Products and Inventory

- categories
- products
- product_images
- inventory
- stock_movements

## Customers and Sales

- customers
- sales
- sale_items
- payments
- refunds

## Financial Management

- invoices
- invoice_items
- expense_categories
- expenses

## Supporting Entities

- notifications
- audit_events
- organization_settings

The final schema must be created incrementally as each feature is specified.

Database design requirements:

- Appropriate foreign keys.
- Unique constraints.
- Check constraints.
- Indexes.
- Transactional operations.
- RLS policies.
- Organization-level isolation.
- Consistent timestamp handling.
- Auditability.
- Referential integrity.

Do not create all future tables prematurely. Each feature should introduce the schema required for its own scope.

---

# 9. UI/UX Design Direction

BizFlow AI should have a professional SaaS dashboard interface.

## Web Application Design

Primary layout:

- Sidebar navigation.
- Top navigation bar.
- Organization switcher.
- User profile menu.
- Main content area.
- Search and filtering.
- Data tables.
- Statistics cards.
- Charts.
- Forms and dialogs.

Primary navigation:

1. Overview
2. Products
3. Inventory
4. Sales
5. Customers
6. Invoices
7. Expenses
8. Employees
9. Reports
10. AI Assistant
11. Settings

Only implemented and authorized modules should appear as active navigation destinations.

## Design Principles

- Professional SaaS appearance.
- Consistent spacing and typography.
- Clear information hierarchy.
- Reusable components.
- Accessible contrast.
- Responsive layouts.
- Meaningful empty states.
- Useful loading states.
- Clear validation messages.
- Confirmation for destructive actions.
- Consistent status indicators.

The design references supplied by the project owner should be used as inspiration, not copied directly.

## Mobile Application Design

- Material 3-inspired interface.
- Bottom navigation for primary mobile workflows.
- Compact business overview.
- Touch-friendly controls.
- Fast search.
- Clear transaction flows.
- Consistent branding with the web application.

---

# 10. Security, Reliability & Quality Requirements

Security is a core product requirement, not a final development phase.

## Security

- Supabase Auth.
- PostgreSQL RLS.
- Organization-level data isolation.
- Server-side permission checks.
- Secure session handling.
- Secure environment variables.
- No client-side service-role key.
- Input validation.
- Rate limiting.
- Audit logging.
- Secure invitation workflows.
- Secure password recovery.
- Safe file upload validation.
- Protection against common web vulnerabilities.

## Reliability

- Transactional financial operations.
- Atomic stock updates.
- Idempotency for retryable operations.
- Proper error handling.
- Database constraints.
- Consistent API responses.
- Backup and recovery strategy.
- Monitoring and logging.

## Testing

Web:

- Unit tests with Vitest.
- Integration tests.
- Database/RLS tests.
- API tests.
- End-to-end tests with Playwright.

Mobile:

- Unit tests.
- Widget tests.
- Integration tests.
- Authentication tests.
- API integration tests.
- Critical workflow tests.

Cross-platform:

- Organization isolation.
- Role and permission enforcement.
- Shared data consistency.
- Transaction integrity.
- Session handling.
- Error handling.

Every feature must pass its required tests before being marked complete.

---

# 11. Deployment & Infrastructure

## Web

- GitHub repository.
- Vercel production deployment.
- Supabase production project.
- Environment separation.
- Production environment variables.
- Domain configuration.
- Deployment monitoring.

## Mobile

- Android release builds.
- iOS release builds.
- Application signing.
- App icons and splash screens.
- Store screenshots.
- Privacy policy.
- Google Play Store submission.
- Apple App Store submission.

## Environments

Maintain separate development, staging/preview, and production configurations where practical.

Never test destructive operations against production data.

---

# 12. Development Methodology

The project will continue using Specification-Driven Development with Spec Kit.

Each feature follows this workflow:

1. Specify.
2. Clarify.
3. Review requirements.
4. Plan architecture.
5. Research technical decisions.
6. Generate implementation tasks.
7. Analyze for inconsistencies.
8. Implement incrementally.
9. Run tests.
10. Perform security review.
11. Review acceptance criteria.
12. Commit and merge.
13. Deploy.
14. Perform production verification.
15. Update project documentation.

## Git Strategy

- `main`: stable production branch.
- `develop`: integration branch where appropriate.
- Feature branches: isolated implementation work.
- Pull requests: review and merge feature changes.
- Conventional commit messages.
- No direct unreviewed feature work on production main.

## Feature Completion Rule

A feature is not complete merely because its UI exists.

It must have:

- Approved specification.
- Database implementation.
- Backend implementation.
- Frontend implementation.
- Authorization and security checks.
- Tests.
- Documentation.
- Successful integration.
- Acceptance criteria verified.

---

# 13. Final Portfolio Deliverables

The final portfolio should demonstrate the product as a real software system, not just a collection of screenshots.

## Deliverable 1 — Live Web Application

- Publicly accessible production URL.
- Functional authentication.
- Multi-organization support.
- Complete retail workflows.
- Responsive dashboard.
- AI business assistant.

## Deliverable 2 — Flutter Mobile Application

- Android application.
- iOS application where feasible.
- Authentication.
- Organization switching.
- Business overview.
- Product and inventory management.
- Sales and customer workflows.
- Push notifications.

## Deliverable 3 — Technical Documentation

- Product Requirements Document.
- Software Requirements Specification.
- System Architecture Document.
- Database ERD.
- API Documentation.
- Authentication and Authorization Design.
- Deployment Guide.
- Testing Documentation.

## Deliverable 4 — Project Case Study

The case study should contain:

1. Project overview.
2. Business problem.
3. Target users.
4. Proposed solution.
5. Main features.
6. Architecture.
7. Technology stack.
8. Database design.
9. Security implementation.
10. Web application screenshots.
11. Mobile application screenshots.
12. Development challenges.
13. Key technical decisions.
14. Results and lessons learned.

## Deliverable 5 — Portfolio Presentation

- Professional project landing page.
- Live demo link.
- Web screenshots.
- Mobile screenshots.
- Architecture diagram.
- Feature overview.
- GitHub repository.
- Short demo video.
- Case study.

---

# 14. Final Definition of Done

BizFlow AI will be considered portfolio-ready when:

- The web application supports complete core retail workflows.
- Organization data is properly isolated.
- Employee roles and permissions are enforced.
- Product and inventory management work correctly.
- Sales and payments are reliable.
- Invoices and expenses are functional.
- Business reports use accurate calculations.
- AI insights are grounded in authorized business data.
- The Flutter application integrates with the same backend.
- Critical workflows are tested on both platforms.
- Production deployment is stable.
- Technical documentation is complete.
- The portfolio case study and demo are ready.

---

# 15. Current Project Status

| Area | Status |
|---|---|
| Project specification and foundation | Completed |
| Feature 001 — Authentication & Organizations | Completed |
| Production Supabase database | Deployed |
| Production web deployment | Deployed |
| Initial production smoke tests | Passed |
| Feature 002 — Employee Management & RBAC | Not started |
| Feature 003 — Products & Categories | Not started |
| Feature 004 — Inventory Management | Not started |
| Feature 005 — Customers & Sales | Not started |
| Feature 006 — Invoices & Expenses | Not started |
| Feature 007 — Dashboard & Analytics | Not started |
| Feature 008 — AI Business Assistant | Not started |
| Flutter mobile application | Not started |
| Final portfolio and case study | Not started |

---

# 16. Project Execution Commitment

This document is the master reference for the BizFlow AI project.

Development will proceed feature by feature.

Before beginning each feature:

- Review this master blueprint.
- Review existing implementation and database structure.
- Identify dependencies.
- Create a detailed feature specification.
- Confirm scope and acceptance criteria.

After implementation:

- Verify the feature against its requirements.
- Update the project status.
- Record architectural changes.
- Update documentation where necessary.

Do not unnecessarily repeat completed planning work. Do not implement future features outside the approved scope of the current feature.

**Immediate next milestone: Feature 002 — Employee Management & Role-Based Access Control.**

The long-term objective is to deliver one integrated, secure, production-quality retail management SaaS across web and mobile platforms.
