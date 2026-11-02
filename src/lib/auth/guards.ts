import { redirect } from "next/navigation";
import { createClient, getSafeCookieStore } from "@/lib/supabase/server";
import type { OrganizationSummary, AppRole } from "@/types/auth";

/**
 * Resolves the authenticated user's active organizations with strict RLS
 * and active status filtering (Migration 06 & FR-011, FR-013).
 */
export async function getUserActiveOrganizations(userId: string): Promise<OrganizationSummary[]> {
  const supabase = await createClient();

  // 1. Query active memberships ordered deterministically (oldest active membership first)
  const { data: memberships, error: memError } = await supabase
    .from("organization_memberships")
    .select("organization_id, role, status, created_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (memError || !memberships || memberships.length === 0) {
    return [];
  }

  const orderedOrgIds = Array.from(new Set(memberships.map((m) => m.organization_id)));

  // 2. Query matching active organizations
  const { data: orgs, error: orgError } = await supabase
    .from("organizations")
    .select("id, name, slug, business_type, country, currency, timezone, is_active, created_at")
    .in("id", orderedOrgIds)
    .eq("is_active", true);

  if (orgError || !orgs || orgs.length === 0) {
    return [];
  }

  // 3. Map to OrganizationSummary preserving deterministic membership order
  const roleMap = new Map<string, AppRole>();
  for (const m of memberships) {
    roleMap.set(m.organization_id, m.role);
  }

  const orgMap = new Map<string, (typeof orgs)[number]>();
  for (const o of orgs) {
    orgMap.set(o.id, o);
  }

  return orderedOrgIds
    .map((id) => orgMap.get(id))
    .filter((o): o is NonNullable<typeof o> => !!o)
    .map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      businessType: o.business_type,
      country: o.country,
      currency: o.currency,
      timezone: o.timezone,
      isActive: o.is_active,
      role: roleMap.get(o.id) || "cashier",
    }));
}

/**
 * Route guard: Requires an authenticated and email-verified user session.
 * Redirects unauthenticated visitors to /sign-in, and unverified users to /verify-email.
 */
export async function requireVerifiedUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  if (!user.email_confirmed_at) {
    redirect("/verify-email");
  }

  return { supabase, user };
}

/**
 * Route guard: For onboarding pages (/onboarding/create-organization).
 * Ensures authenticated and verified user.
 */
export async function requireOnboardingContext() {
  const { supabase, user } = await requireVerifiedUser();
  const activeOrgs = await getUserActiveOrganizations(user.id);

  return { supabase, user, activeOrgs };
}

/**
 * Route guard: For workspace tenant routes (/[slug]/...).
 * Redirects 0-organization users to /onboarding/create-organization (T032, FR-013).
 * Enforces cross-tenant protection: verifies user has active membership in `slug`.
 */
export async function requireWorkspaceAccess(expectedSlug?: string): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: Awaited<ReturnType<typeof requireVerifiedUser>>["user"];
  currentOrg: OrganizationSummary;
  activeOrgs: OrganizationSummary[];
}> {
  const { supabase, user } = await requireVerifiedUser();
  const activeOrgs = await getUserActiveOrganizations(user.id);

  const fallbackOrg = activeOrgs[0];
  // 1. If user has 0 active organizations, redirect to onboarding
  if (!fallbackOrg || activeOrgs.length === 0) {
    redirect("/onboarding/create-organization");
  }

  // 2. If a specific slug is requested, verify active membership
  if (expectedSlug) {
    const targetOrg = activeOrgs.find((o) => o.slug === expectedSlug);
    if (!targetOrg) {
      // User is not a member of expectedSlug or it is inactive:
      // Redirect safely to their first active organization dashboard
      redirect(`/${fallbackOrg.slug}/dashboard`);
    }

    return { supabase, user, currentOrg: targetOrg, activeOrgs };
  }

  // 3. If no specific slug requested, resolve preferred from cookie or fallback
  const cookieStore = await getSafeCookieStore();
  const preferredSlug = cookieStore.get("bizflow_active_org")?.value;
  const currentOrg = activeOrgs.find((o) => o.slug === preferredSlug) || fallbackOrg;

  return { supabase, user, currentOrg, activeOrgs };
}
