"use server";

import { z } from "zod";
import { createClient, getSafeCookieStore } from "@/lib/supabase/server";
import {
  createOrganizationSchema,
  switchOrganizationSchema,
  type CreateOrganizationInput,
  type SwitchOrganizationInput,
} from "@/lib/validations/organization";
import type {
  ActionResult,
  OrganizationSummary,
  SwitchOrganizationResult,
} from "@/types/auth";

/**
 * Strict runtime schema validator for create_organization_with_owner() RPC output.
 */
const rpcResponseSchema = z.object({
  organization_id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  business_type: z.string().min(1),
  country: z.string().length(2),
  currency: z.string().length(3),
  timezone: z.string().min(1),
  role: z.enum(["owner", "admin", "manager", "cashier"]),
  is_active: z.boolean(),
  is_idempotent_replay: z.boolean(),
});

/**
 * Known database exception mapping for predictable user-facing error messages.
 */
const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  P0001: "Email verification is required before creating an organization.",
  P0003: "Authentication required to create an organization.",
  P0005: "Caller is no longer an active member of this organization.",
  P0008: "Client mutation identifier is required.",
  P0009: "Invalid organization parameters provided.",
  P0015: "This organization is no longer active.",
  "23505": "An organization with this identifier already exists.",
};

/**
 * Helper to generate a clean, URL-safe slug candidate from an organization name.
 * Stored procedure handles final conflict resolution and uniqueness guarantees.
 */
function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "org";
}

/**
 * Server Action: createOrganizationAction (T030, FR-008, FR-009, FR-010)
 *
 * Atomically creates a new retail organization tenant, assigns the authenticated,
 * email-verified creator as the initial Owner, records an audit event, and sets
 * the active organization session cookie.
 */
export async function createOrganizationAction(
  rawInput: CreateOrganizationInput
): Promise<ActionResult<OrganizationSummary>> {
  // 1. Server-side Zod validation
  const parseResult = createOrganizationSchema.safeParse(rawInput);
  if (!parseResult.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parseResult.error.issues) {
      const path = issue.path.join(".");
      if (!fieldErrors[path]) {
        fieldErrors[path] = [];
      }
      fieldErrors[path].push(issue.message);
    }

    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid organization parameters",
        details: fieldErrors,
      },
    };
  }

  const input = parseResult.data;

  // 2. Authenticate session server-side
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: {
        code: "P0003",
        message: "Authentication required to create an organization",
      },
    };
  }

  // 3. Email verification gate
  if (!user.email_confirmed_at) {
    return {
      success: false,
      error: {
        code: "P0001",
        message: "Email verification required before creating an organization",
      },
    };
  }

  // 4. Ensure non-null client mutation ID
  const clientMutationId =
    input.clientMutationId ||
    (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : undefined);

  if (!clientMutationId) {
    return {
      success: false,
      error: {
        code: "P0008",
        message: "Client mutation identifier is required",
      },
    };
  }

  // 5. Generate slug candidate
  const slug = slugify(input.name);

  // 6. Invoke atomic stored procedure
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "create_organization_with_owner",
    {
      p_name: input.name,
      p_slug: slug,
      p_business_type: input.businessType,
      p_country: input.country,
      p_currency: input.currency,
      p_timezone: input.timezone,
      p_client_mutation_id: clientMutationId,
      p_tax_id: input.taxId,
      p_phone: input.phone,
      p_email: input.email || undefined,
      p_address: input.address,
    }
  );

  if (rpcError) {
    const code = rpcError.code || "DB_ERROR";
    const userMessage = KNOWN_ERROR_MESSAGES[code] || rpcError.message || "Failed to create organization";

    // Log unexpected errors server-side without exposing internal DB details to client
    if (!KNOWN_ERROR_MESSAGES[code]) {
      console.error("[createOrganizationAction] Unexpected database error:", rpcError);
    }

    return {
      success: false,
      error: {
        code,
        message: userMessage,
      },
    };
  }

  // 7. Validate RPC response shape before consumption
  const parsedRpc = rpcResponseSchema.safeParse(rpcData);
  if (!parsedRpc.success) {
    console.error("[createOrganizationAction] Invalid RPC response shape:", parsedRpc.error, rpcData);
    return {
      success: false,
      error: {
        code: "INVALID_RESPONSE",
        message: "Unexpected response format returned from database service",
      },
    };
  }

  const result = parsedRpc.data;

  // 8. Validate organization active status (Defense in depth)
  if (!result.is_active) {
    return {
      success: false,
      error: {
        code: "ORGANIZATION_CLOSED",
        message: "This organization is inactive or closed.",
      },
    };
  }

  // 9. Set active organization cookie preference
  const cookieStore = await getSafeCookieStore();
  cookieStore.set("bizflow_active_org", result.slug, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  const redirectUrl = `/${result.slug}/dashboard`;

  return {
    success: true,
    data: {
      id: result.organization_id,
      name: result.name,
      slug: result.slug,
      businessType: result.business_type,
      country: result.country,
      currency: result.currency,
      timezone: result.timezone,
      role: result.role,
      isActive: result.is_active,
      isIdempotentReplay: result.is_idempotent_replay,
      redirectUrl,
    },
  };
}

/**
 * Server Action: switchOrganizationAction (T043, FR-012, FR-013)
 *
 * Switches the user's active retail organization context preference.
 * Validates authentication, email confirmation, active organization status,
 * and active membership before setting the `bizflow_active_org` cookie.
 */
export async function switchOrganizationAction(
  rawInput: SwitchOrganizationInput
): Promise<ActionResult<SwitchOrganizationResult>> {
  // 1. Zod input validation
  const parseResult = switchOrganizationSchema.safeParse(rawInput);
  if (!parseResult.success) {
    const errorMsg =
      parseResult.error.errors[0]?.message || "Invalid organization switch parameters";
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: errorMsg,
      },
    };
  }

  const { organizationId, slug } = parseResult.data;

  // 2. Server-side session authentication
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: {
        code: "P0003",
        message: "Authentication required to switch organization",
      },
    };
  }

  // 3. Email verification check
  if (!user.email_confirmed_at) {
    return {
      success: false,
      error: {
        code: "P0001",
        message: "Email verification required before switching organization",
      },
    };
  }

  // 4. Resolve target organization (enforcing active status)
  let orgQuery = supabase
    .from("organizations")
    .select("id, name, slug, is_active")
    .eq("is_active", true);

  if (organizationId) {
    orgQuery = orgQuery.eq("id", organizationId);
  } else if (slug) {
    orgQuery = orgQuery.eq("slug", slug);
  }

  const { data: organization, error: orgError } = await orgQuery.maybeSingle();

  if (orgError || !organization) {
    return {
      success: false,
      error: {
        code: "P0015",
        message: "Organization not found or inactive",
      },
    };
  }

  // 5. Verify caller's membership in target organization
  const { data: membership, error: memError } = await supabase
    .from("organization_memberships")
    .select("role, status")
    .eq("organization_id", organization.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (memError || !membership) {
    return {
      success: false,
      error: {
        code: "P0004",
        message: "You are not a member of this organization",
      },
    };
  }

  if (membership.status !== "active") {
    return {
      success: false,
      error: {
        code: "P0005",
        message: "Your membership in this organization is suspended or revoked",
      },
    };
  }

  // 6. Set active organization cookie preference
  const cookieStore = await getSafeCookieStore();
  cookieStore.set("bizflow_active_org", organization.slug, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  const redirectUrl = `/${organization.slug}/dashboard`;

  return {
    success: true,
    data: {
      organizationId: organization.id,
      slug: organization.slug,
      redirectUrl,
    },
  };
}

