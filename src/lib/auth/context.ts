import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserActiveOrganizations } from "@/lib/auth/guards";
import type { TenantContext } from "@/types/auth";
import type { SupabaseClient } from "@supabase/supabase-js";

export type TenantResolutionError =
  | "unauthenticated"
  | "unverified"
  | "no_organizations"
  | "not_found"
  | "forbidden";

export type TenantResolutionResult =
  | { ok: true; context: TenantContext }
  | { ok: false; error: TenantResolutionError };

/**
 * Resolves tenant authorization and data context on the server without throwing navigation exceptions.
 * Useful for programmatic checks, server actions, and unit tests.
 *
 * Enforces Constitutional Rules:
 * 1. Resolves caller identity strictly from `supabase.auth.getUser()`, never from client headers.
 * 2. Enforces email verification.
 * 3. Enforces PostgreSQL Row-Level Security: queries using the authenticated user's client.
 * 4. Verifies active organization status (`is_active = true`) and active membership (`status = 'active'`).
 * 5. Resolves user's actual database role (`membership.role`).
 */
export async function resolveTenantContext(
  slug: string,
  options?: { supabaseClient?: SupabaseClient }
): Promise<TenantResolutionResult> {
  const supabase = options?.supabaseClient || (await createClient());

  // 1. Resolve authenticated user identity using auth.getUser() (FR-013)
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, error: "unauthenticated" };
  }

  // 2. Enforce email verification (FR-003, Principle I)
  if (!user.email_confirmed_at) {
    return { ok: false, error: "unverified" };
  }

  const cleanSlug = typeof slug === "string" ? slug.trim() : "";
  if (!cleanSlug) {
    return { ok: false, error: "not_found" };
  }

  // 3. Resolve user's active organizations with RLS
  const activeOrganizations = await getUserActiveOrganizations(user.id);
  if (activeOrganizations.length === 0) {
    return { ok: false, error: "no_organizations" };
  }

  // 4. Resolve requested organization by slug (enforcing RLS & active status)
  const { data: organization, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", cleanSlug)
    .eq("is_active", true)
    .maybeSingle();

  if (orgError || !organization) {
    return { ok: false, error: "not_found" };
  }

  // 5. Verify active membership and resolve actual role (FR-013)
  const { data: membership, error: memError } = await supabase
    .from("organization_memberships")
    .select("*")
    .eq("organization_id", organization.id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (memError || !membership || membership.status !== "active") {
    return { ok: false, error: "forbidden" };
  }

  return {
    ok: true,
    context: {
      user,
      organization,
      membership,
      role: membership.role,
      activeOrganizations,
    },
  };
}

/**
 * Server-Side Tenant Context Resolution Guard (T036, FR-013).
 *
 * Intended for Server Components and Route Layouts:
 * - Redirects unauthenticated visitors to `/sign-in`.
 * - Redirects unverified users to `/verify-email`.
 * - Redirects 0-organization users to `/onboarding/create-organization`.
 * - Triggers `notFound()` (HTTP 404) for non-existent, inactive, or unauthorized organizations (preventing tenant enumeration).
 * - Returns a strongly-typed `TenantContext` containing verified user, organization, membership, and role.
 */
export async function getTenantContext(slug: string): Promise<TenantContext> {
  const result = await resolveTenantContext(slug);

  if (!result.ok) {
    switch (result.error) {
      case "unauthenticated":
        redirect("/sign-in");
      case "unverified":
        redirect("/verify-email");
      case "no_organizations":
        redirect("/onboarding/create-organization");
      case "not_found":
      case "forbidden":
      default:
        // Render 404 Not Found to prevent leaking organization existence to unauthorized users
        notFound();
    }
  }

  return result.context;
}

