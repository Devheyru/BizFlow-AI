-- ============================================================================
-- Migration 01: Core Authentication & Organization Schema
-- Feature: 001-auth-organization
-- Task: T007
-- ============================================================================

-- 1. Custom Enums
CREATE TYPE public.app_role AS ENUM ('owner', 'admin', 'manager', 'cashier');
CREATE TYPE public.membership_status AS ENUM ('active', 'suspended', 'revoked');

-- 2. Extended User Profiles (1:1 with auth.users)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    first_name TEXT NOT NULL CHECK (char_length(trim(first_name)) BETWEEN 1 AND 50),
    last_name TEXT NOT NULL CHECK (char_length(trim(last_name)) BETWEEN 1 AND 50),
    phone TEXT CHECK (phone IS NULL OR char_length(trim(phone)) BETWEEN 7 AND 20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_names ON public.profiles(first_name, last_name);

-- 3. Organizations (Tenants)
CREATE TABLE public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 100),
    slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    business_type TEXT NOT NULL CHECK (char_length(trim(business_type)) BETWEEN 2 AND 50),
    country TEXT NOT NULL CHECK (country ~ '^[A-Z]{2}$'), -- Strict ISO 3166-1 alpha-2
    currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), -- Strict ISO 4217
    timezone TEXT NOT NULL DEFAULT 'UTC',
    tax_id TEXT CHECK (tax_id IS NULL OR char_length(trim(tax_id)) <= 50),
    phone TEXT CHECK (phone IS NULL OR char_length(trim(phone)) <= 30),
    email TEXT CHECK (email IS NULL OR email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    address TEXT CHECK (address IS NULL OR char_length(trim(address)) <= 255),
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    client_mutation_id UUID,
    is_active BOOLEAN NOT NULL DEFAULT true,
    closed_at TIMESTAMPTZ,
    closed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Bound to creator: Prevents user B from claiming or discovering user A's organization via client_mutation_id
    CONSTRAINT uq_org_creator_mutation UNIQUE (created_by, client_mutation_id)
);

CREATE INDEX idx_organizations_slug ON public.organizations(slug);
CREATE INDEX idx_organizations_is_active ON public.organizations(is_active);
CREATE INDEX idx_organizations_created_by ON public.organizations(created_by);

-- 4. Organization Memberships (Join entity linking Users to Tenants)
CREATE TABLE public.organization_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role public.app_role NOT NULL DEFAULT 'cashier',
    status public.membership_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_user_organization UNIQUE (user_id, organization_id)
);

CREATE INDEX idx_org_memberships_user ON public.organization_memberships(user_id) WHERE status = 'active';
CREATE INDEX idx_org_memberships_org ON public.organization_memberships(organization_id) WHERE status = 'active';
CREATE INDEX idx_org_memberships_role ON public.organization_memberships(organization_id, role);

-- 5. Organization Audit Events (Immutable, append-only security log)
CREATE TABLE public.organization_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    event_type TEXT NOT NULL CHECK (char_length(trim(event_type)) BETWEEN 1 AND 100),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_events_org ON public.organization_audit_events(organization_id);
CREATE INDEX idx_audit_events_type ON public.organization_audit_events(organization_id, event_type);
CREATE INDEX idx_audit_events_actor ON public.organization_audit_events(actor_id);

