# BizFlow AI — Production Deployment Guide

> **Target Architecture**: Next.js 15 App Router on Vercel + Managed PostgreSQL & GoTrue Auth on Supabase Cloud + Custom Transactional SMTP Provider.

---

## Table of Contents

1. [Deployment Architecture](#1-deployment-architecture)
2. [Required Accounts and Services](#2-required-accounts-and-services)
3. [Environment Variables Specification](#3-environment-variables-specification)
4. [Supabase Production Setup](#4-supabase-production-setup)
5. [Database Migration Deployment](#5-database-migration-deployment)
6. [Custom SMTP Configuration](#6-custom-smtp-configuration)
7. [Vercel Project Setup](#7-vercel-project-setup)
8. [Supabase Authentication URL Configuration](#8-supabase-authentication-url-configuration)
9. [Custom Domain Setup](#9-custom-domain-setup)
10. [Production Verification Checklist](#10-production-verification-checklist)
11. [Rollback and Disaster Recovery](#11-rollback-and-disaster-recovery)
12. [Common Deployment Issues & Troubleshooting](#12-common-deployment-issues--troubleshooting)

---

## 1. Deployment Architecture

BizFlow AI follows a modern edge-and-cloud multi-tenant SaaS topology:

```
[ Client Web Browser ]
         │
         ▼
[ Vercel Edge Network ]
  ├── Edge Middleware (src/middleware.ts) — Session refresh, route gating, redirect sanitization
  ├── React Server Components (RSC) — Server-side tenant context resolution (src/lib/auth/context.ts)
  └── Server Actions (src/actions/*) — Zod runtime boundary validation & business logic
         │
         ├──► [ Supabase Managed Platform ]
         │     ├── GoTrue Auth Service — Cryptographic JWT signing & PKCE code exchange
         │     └── PostgreSQL 15/17 Engine
         │           ├── Universal FORCE ROW LEVEL SECURITY (RLS) on all tenant tables
         │           ├── Controlled SECURITY DEFINER Stored Procedures & Invariant Triggers
         │           └── Tables: profiles, organizations, organization_memberships,
         │                       organization_audit_events, recovery_grants
         │
         └──► [ Custom Transactional SMTP Provider ]
               └── Resend / SendGrid / Amazon SES / Postmark — Delivery of verification & recovery emails
```

---

## 2. Required Accounts and Services

Before initiating production deployment, ensure access to the following accounts:

1. **GitHub**: Repository hosting with permissions to configure webhooks/deployments.
2. **Vercel Account**: For hosting the Next.js 15 application (Pro or Hobby tier).
3. **Supabase Cloud Account**: Organization and project on [supabase.com](https://supabase.com).
4. **Custom Transactional SMTP Provider**:
   - Recommended: [Resend](https://resend.com), [SendGrid](https://sendgrid.com), [Postmark](https://postmarkapp.com), or [AWS SES](https://aws.amazon.com/ses/).
   - A verified domain with active SPF, DKIM, and DMARC DNS records.
5. **DNS Provider**: Cloudflare, Namecheap, Route 53, or GoDaddy for custom domain mapping.

---

## 3. Environment Variables Specification

The application validates environment variables at runtime using Zod in [`src/lib/env.ts`](../src/lib/env.ts).

### Production Environment Variables

| Variable Name | Scope | Purpose | Example Value | Where to Configure |
| :--- | :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Public / Client & Server | Managed Supabase API Gateway URL | `https://xyzcompany.supabase.co` | Vercel Environment Variables |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public / Client & Server | Supabase anonymous API key safe for browser requests | `eyJhbGciOi...` | Vercel Environment Variables |
| `NEXT_PUBLIC_APP_URL` | Public / Client & Server | Canonical public URL of the application. **Critical for email callback links.** | `https://bizflow.ai` | Vercel Environment Variables |
| `RECOVERY_GRANT_SECRET` | **Server-Only Secret** | Dedicated 32-byte cryptographic secret (represented as 64 hex characters with 256 bits of true entropy, min. 32 chars) strictly used for HMAC-SHA256 signing and verification of password recovery grants. **NEVER expose to client.** | Generate with `openssl rand -hex 32` | Vercel Environment Variables |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-Only Secret** (Optional in Web App) | Privileged admin key. Used server-side for integration test harnesses and database administrative maintenance. **NEVER expose to client.** | `eyJhbGciOi...` | Vercel Environment Variables (Optional for web runtime) |

> **CRITICAL SECURITY NOTE ON SECRET ENTROPY & HANDLING**:
> - **Entropy Requirement**: A 32-character human-readable password does NOT contain 256 bits of entropy. For production, generate a cryptographically random 32-byte secret using `openssl rand -hex 32`. This produces a 64-character hexadecimal string representing 256 bits of true cryptographic entropy.
> - **Direct Vercel Configuration**: Use the generated 64-character hex string directly in Vercel's `RECOVERY_GRANT_SECRET` environment variable for Production and Preview environments.
> - **Zero Fallback & Zero Reuse**: Never reuse the local `.env.local` secret in production. Neither `SUPABASE_SERVICE_ROLE_KEY` nor `SUPABASE_JWT_SECRET` is ever used as a fallback for recovery grants.
> - **Confidentiality**: Never commit real secrets to GitHub, and never paste production secrets into external AI chatbots or third-party loggers.
> - **Server Isolation**: `src/lib/auth/recovery.ts` is explicitly gated with `import "server-only";` to guarantee it cannot be bundled into client components.
> - **Node.js Runtime Enforcement**: Route handlers utilizing Node crypto primitives (such as `src/app/api/auth/callback/route.ts`) explicitly enforce `export const runtime = "nodejs";`.

---

## 4. Supabase Production Setup

### Step 4.1: Create a Production Project

1. Log in to [Supabase Dashboard](https://supabase.com/dashboard).
2. Click **New Project** and select your organization.
3. Choose a project name (e.g., `bizflow-ai-production`).
4. Generate a strong, secure database password and store it in a password manager.
5. Select a geographic region closest to your primary user base (e.g., `us-east-1` or `eu-central-1`).
6. Select **PostgreSQL 15** or **PostgreSQL 17**.

### Step 4.2: Retrieve Production API Keys & Generate Secrets

1. Navigate to **Project Settings** → **API**:
   - **Project URL**: Copy this for `NEXT_PUBLIC_SUPABASE_URL`.
   - **anon public**: Copy this for `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - **service_role secret**: Copy this for `SUPABASE_SERVICE_ROLE_KEY` (if running administrative test suites against the database).
2. Generate your dedicated `RECOVERY_GRANT_SECRET` in a secure terminal:
   ```bash
   openssl rand -hex 32
   ```
   This generates a 64-character hexadecimal string representing 32 random bytes (256 bits of true cryptographic entropy). Store this securely and configure it directly in Vercel as `RECOVERY_GRANT_SECRET`.

---

## 5. Database Migration Deployment

BizFlow AI maintains eight sequential SQL migrations in [`supabase/migrations/`](../supabase/migrations). All migrations are idempotent, contain zero seed data, enforce universal `FORCE ROW LEVEL SECURITY`, and have fixed `search_path` configurations.

### Migration Inventory

| # | Migration File | Purpose |
| :-: | :--- | :--- |
| **01** | `20261031000001_auth_organization_schema.sql` | Enums (`app_role`, `membership_status`), tables (`profiles`, `organizations`, `organization_memberships`, `organization_audit_events`), creator-bound uniqueness |
| **02** | `20261031000002_auth_triggers.sql` | `handle_new_user()` auto-profile trigger, `trg_check_owner_invariant` single-owner trigger |
| **03** | `20261031000003_security_helpers.sql` | `is_email_verified()`, `get_user_organization_ids()`, `is_org_member()` helpers |
| **04** | `20261031000004_rls_policies.sql` | Universal `FORCE ROW LEVEL SECURITY` across all tables, deny-all direct client mutation on memberships |
| **05** | `20261031000005_tenant_isolation_helpers.sql` | Hardened `user_belongs_to_org()` security definer helper |
| **06** | `20261031000006_fix_search_path_and_rls.sql` | Fixed explicit `search_path = public` across all stored procedures |
| **07** | `20261031000007_profile_update_and_audit.sql` | Hardened profile updates and audit logging procedures |
| **08** | `20261031000008_recovery_grants.sql` | `recovery_grants` table, `create_recovery_grant()`, `verify_recovery_grant()`, atomic row-locking `consume_recovery_grant()` |

### Deployment Methods

#### Option A: Supabase CLI (Recommended)

1. Authenticate the CLI with your Supabase account:
   ```bash
   npx supabase login
   ```
2. Link your local project directory to your remote production Supabase project:
   ```bash
   npx supabase link --project-ref <your-production-project-ref>
   ```
3. Push all migrations:
   ```bash
   npx supabase db push
   ```
4. Verify migration status:
   ```bash
   npx supabase migration list
   ```

#### Option B: Supabase Dashboard SQL Editor

If executing migrations manually via the Supabase Dashboard SQL Editor, execute them strictly in numeric sequence (`01` through `08`).

---

## 6. Custom SMTP Configuration

> **WARNING**: Supabase's built-in default email service has a strict rate limit of **30 emails per hour**. In production, using the default service will cause user registration and password recovery emails to fail. A custom SMTP provider is mandatory.

### Setting Up Custom SMTP (Example with Resend)

1. Sign up at [Resend](https://resend.com) and add your custom domain (e.g., `bizflow.ai`).
2. Add the DKIM, SPF, and DMARC records to your DNS provider.
3. Create an API Key in Resend with sending permissions.
4. In the Supabase Dashboard, navigate to **Project Settings** → **Authentication** → **SMTP Settings**:
   - **Enable Custom SMTP**: `ON`
   - **Sender email**: `noreply@bizflow.ai` (or your verified domain email)
   - **Sender name**: `BizFlow AI`
   - **Host**: `smtp.resend.com`
   - **Port**: `465` (SSL) or `587` (TLS)
   - **Username**: `resend`
   - **Password**: `<your-resend-api-key>`
5. Click **Save** and test by clicking **Send test email**.

---

## 7. Vercel Project Setup

### Step 7.1: Import Repository

1. Log in to [Vercel](https://vercel.com).
2. Click **Add New...** → **Project**.
3. Select your Git provider (GitHub) and import `BizFlow-AI`.
4. Configure project settings:
   - **Framework Preset**: Next.js
   - **Root Directory**: `./`
   - **Build Command**: `npm run build` (or leave default `next build`).
   - **Output Directory**: `.next` (default).
   - **Install Command**: `npm install` (default).
   - **Node.js Version**: Select `20.x` or `22.x` under Project Settings → General.

### Step 7.2: Add Environment Variables in Vercel

In the project setup screen (or under **Settings** → **Environment Variables**), add the following:

| Key | Value | Target Environments |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | Production, Preview, Development |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `<production-anon-key>` | Production, Preview, Development |
| `NEXT_PUBLIC_APP_URL` | `https://<your-custom-domain.com>` | Production |
| `RECOVERY_GRANT_SECRET` | `<64-hex-character-secret>` | Production, Preview |
| `SUPABASE_SERVICE_ROLE_KEY` | `<production-service-role-key>` (Optional) | Production, Preview |

> **Preview Environment Note**: For Vercel Preview deployments, set `NEXT_PUBLIC_APP_URL` to `https://$VERCEL_URL` or configure branch-specific environment variables.

### Step 7.3: Deploy

Click **Deploy**. Vercel will clone the repository, run `npm install`, compile the production build (`npm run build`), and provision edge network endpoints.

---

## 8. Supabase Authentication URL Configuration

For security, Supabase Auth will reject callbacks and redirects to domains not explicitly listed in the project's URL Configuration.

In the Supabase Dashboard, navigate to **Authentication** → **URL Configuration**:

### Step 8.1: Site URL
Set the **Site URL** to your canonical production URL:
```text
https://bizflow.ai
```
*(Or your Vercel deployment URL if no custom domain is attached yet, e.g., `https://bizflow-ai.vercel.app`)*

### Step 8.2: Redirect URLs
Add the following exact redirect URLs to the **Redirect URLs** list:

```text
https://bizflow.ai/api/auth/callback
https://bizflow.ai/api/auth/callback?next=/reset-password
https://bizflow-ai.vercel.app/api/auth/callback
https://bizflow-ai.vercel.app/api/auth/callback?next=/reset-password
https://*-your-team.vercel.app/api/auth/callback
https://*-your-team.vercel.app/api/auth/callback?next=/reset-password
```

### Step 8.3: Auth Provider Policies
Under **Authentication** → **Providers** → **Email**:
- **Enable Email provider**: `ON`
- **Confirm email**: `ON` (Mandatory: unverified accounts are blocked by `is_email_verified()`)
- **Secure email change**: `ON`
- **Enable Signups**: `ON`

---

## 9. Custom Domain Setup

1. In Vercel, navigate to **Settings** → **Domains**.
2. Enter your production domain (e.g., `bizflow.ai` and `www.bizflow.ai`).
3. Add the required DNS records at your domain registrar:
   - **Apex Domain (`bizflow.ai`)**: A Record pointing to `76.76.21.21`.
   - **Subdomain (`www.bizflow.ai`)**: CNAME Record pointing to `cname.vercel-dns.com`.
4. Wait for SSL certificate issuance (Vercel automatically provisions Let's Encrypt certificates).
5. Update `NEXT_PUBLIC_APP_URL` in Vercel to `https://bizflow.ai`.
6. Update **Site URL** and **Redirect URLs** in Supabase to match `https://bizflow.ai`.

---

## 10. Production Verification Checklist

Execute this smoke test immediately following deployment:

- [ ] **1. Public Route Access**: Navigate to `https://your-domain.com`. Verify redirect to `/sign-in` or landing page.
- [ ] **2. User Registration**:
  - Register a new account at `/sign-up`.
  - Confirm inline password validation rejects simple passwords (< 8 chars, missing uppercase, missing special characters).
  - Submit valid credentials. Verify transition to `/verify-email`.
- [ ] **3. Email Delivery**:
  - Inspect your inbox. Confirm email sender reflects your custom SMTP sender name and address.
  - Verify confirmation link uses `https://your-domain.com/api/auth/callback`.
- [ ] **4. Email Confirmation & Onboarding**:
  - Click verification link.
  - Confirm PKCE code exchange succeeds and routes to `/onboarding/create-organization`.
- [ ] **5. Organization Provisioning**:
  - Fill store details (Store name, ISO country, currency, timezone).
  - Submit form. Verify atomic creation and transition to `/[slug]/dashboard`.
  - Confirm tenant header displays the store name, owner badge, and user initials.
- [ ] **6. In-App Password Change**:
  - Navigate to `/settings/profile`.
  - Change password with incorrect current password -> confirms rejection.
  - Change password with correct current password -> confirms success and revokes other sessions.
- [ ] **7. Password Recovery**:
  - Sign out.
  - Navigate to `/forgot-password`. Enter registered email.
  - Check inbox for reset link.
  - Click reset link -> confirm `/reset-password` renders password change form.
  - Submit new password -> confirm redirect to `/sign-in?reset=success`.
  - Immediately re-open the same reset link -> confirm page displays **"Invalid or Expired Link"** (verifying atomic single-use nonce consumption).
- [ ] **8. Cross-Tenant Protection**:
  - While signed in as User A, attempt navigating to `https://your-domain.com/non-existent-or-unauthorized-org/dashboard`.
  - Verify page returns **404 Not Found** (confirming anti-enumeration and RLS enforcement).

---

## 11. Rollback and Disaster Recovery

### Vercel Instant Rollback
If an application bug is detected in production:
1. In the Vercel Dashboard, navigate to the **Deployments** tab.
2. Locate the previous stable deployment.
3. Click the three dots (`...`) and select **Instant Rollback**.
4. Traffic is immediately redirected to the prior build with zero downtime.

### Database Recovery
- Supabase Cloud performs automated daily backups (and Point-in-Time Recovery on Pro plans).
- To restore a backup, navigate to **Project Settings** → **Database** → **Backups**.

---

## 12. Common Deployment Issues & Troubleshooting

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| Email verification link redirects to `http://localhost:3000` | `NEXT_PUBLIC_APP_URL` was omitted in Vercel environment variables | Set `NEXT_PUBLIC_APP_URL=https://your-domain.com` in Vercel and redeploy. |
| Supabase returns `error=redirect_uri_not_allowed` on auth link | Callback URL is missing from Supabase Redirect URLs | Add `https://your-domain.com/api/auth/callback` to **Authentication** → **URL Configuration** in Supabase. |
| User receives no confirmation emails | Supabase default mailer rate limit exceeded or SMTP credentials invalid | Configure custom SMTP in Supabase under **Authentication** → **SMTP Settings**. |
| `Invalid environment variables configuration` error during build | Missing `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Add required variables in Vercel Project Settings → Environment Variables. |
| Reset password page displays "Invalid or Expired Link" immediately | User is not arriving from valid recovery flow or nonce was already consumed | Ensure password reset was initiated via `/forgot-password` email link; single-use nonces cannot be replayed. |
| Store dashboard returns 404 for authorized user | Organization slug mismatch or membership inactive | Confirm user has an active membership row (`status = 'active'`) in `organization_memberships`. |
