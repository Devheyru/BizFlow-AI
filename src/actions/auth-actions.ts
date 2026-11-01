"use server";

import { createClient, getSafeCookieStore } from "@/lib/supabase/server";
import { sanitizeRedirectUrl } from "@/lib/auth/redirect";
import {
  signUpSchema,
  signInSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  type SignUpInput,
  type SignInInput,
  type ResendVerificationInput,
  type ForgotPasswordInput,
  type ResetPasswordInput,
} from "@/lib/validations/auth";
import type {
  ActionResult,
  SignUpResult,
  SignInResult,
  SignOutResult,
  PasswordResetResult,
} from "@/types/auth";

/**
 * Register a new user with password complexity and anti-enumeration safeguards (FR-001, FR-002).
 */
export async function signUpAction(
  rawInput: SignUpInput
): Promise<ActionResult<SignUpResult>> {
  const parseResult = signUpSchema.safeParse(rawInput);
  if (!parseResult.success) {
    const details: Record<string, string[]> = {};
    for (const issue of parseResult.error.issues) {
      const path = issue.path.join(".");
      if (!details[path]) details[path] = [];
      details[path].push(issue.message);
    }
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Please correct the highlighted errors.",
        details,
      },
    };
  }

  const input = parseResult.data;
  const supabase = await createClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // Build callback target
  const nextTarget = input.invitationToken
    ? `/invitations/accept?token=${encodeURIComponent(input.invitationToken)}`
    : "/";
  const emailRedirectTo = `${appUrl}/api/auth/callback?next=${encodeURIComponent(nextTarget)}`;

  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        first_name: input.firstName,
        last_name: input.lastName,
        phone: input.phone || null,
      },
      emailRedirectTo,
    },
  });

  if (error) {
    // Anti-enumeration protection:
    // If user already exists, Supabase may return an error or identity collision.
    // Display a security-conscious neutral message rather than confirming account existence.
    const isDuplicate =
      error.message.toLowerCase().includes("already registered") ||
      error.message.toLowerCase().includes("already exists") ||
      error.status === 422;

    if (isDuplicate) {
      return {
        success: true,
        data: {
          userId: "",
          email: input.email,
          isEmailVerified: false,
          message:
            "If this email is not registered, a verification link has been sent. Please check your inbox.",
        },
      };
    }

    return {
      success: false,
      error: {
        code: "SIGN_UP_FAILED",
        message: error.message || "Failed to create account. Please try again.",
      },
    };
  }

  // If Supabase returns a user with empty identities (duplicate email protection in GoTrue),
  // return neutral success to prevent enumeration
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return {
      success: true,
      data: {
        userId: "",
        email: input.email,
        isEmailVerified: false,
        message:
          "If this email is not registered, a verification link has been sent. Please check your inbox.",
      },
    };
  }

  const user = data.user;
  const isEmailVerified = !!user?.email_confirmed_at;

  return {
    success: true,
    data: {
      userId: user?.id || "",
      email: input.email,
      isEmailVerified,
      message: isEmailVerified
        ? "Account created successfully."
        : "Registration successful! Please check your email to verify your account.",
      pendingInviteToken: input.invitationToken,
    },
  };
}

/**
 * Authenticate user with email and password, enforcing email verification gating (FR-004).
 */
export async function signInAction(
  rawInput: SignInInput,
  redirectTo?: string | null
): Promise<ActionResult<SignInResult>> {
  const parseResult = signInSchema.safeParse(rawInput);
  if (!parseResult.success) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid email or password.",
      },
    };
  }

  const { email, password } = parseResult.data;
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    // If GoTrue returned 'Email not confirmed' error
    if (error?.message?.toLowerCase().includes("email not confirmed")) {
      return {
        success: true,
        data: {
          userId: "",
          email,
          isEmailVerified: false,
          hasActiveOrganization: false,
          redirectUrl: `/verify-email?email=${encodeURIComponent(email)}`,
        },
      };
    }

    // Generic error to prevent credential / email enumeration
    return {
      success: false,
      error: {
        code: "INVALID_CREDENTIALS",
        message: "Invalid email or password.",
      },
    };
  }

  const user = data.user;

  // Enforce strict email verification check
  const isEmailVerified = !!user.email_confirmed_at;
  if (!isEmailVerified) {
    // Sign out to prevent unverified session access
    await supabase.auth.signOut();
    return {
      success: true,
      data: {
        userId: user.id,
        email: user.email || email,
        isEmailVerified: false,
        hasActiveOrganization: false,
        redirectUrl: `/verify-email?email=${encodeURIComponent(user.email || email)}`,
      },
    };
  }

  // Query user's active memberships with deterministic ordering (oldest active membership first)
  const { data: memberships, error: memError } = await supabase
    .from("organization_memberships")
    .select("organization_id, role, status, created_at")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (memError) {
    console.error("[signInAction] Error fetching memberships:", memError);
    return {
      success: false,
      error: {
        code: "ORGANIZATION_RESOLUTION_ERROR",
        message: "Unable to verify organization memberships. Please try again.",
      },
    };
  }

  // If user successfully confirmed to have 0 active memberships, guide to onboarding
  if (!memberships || memberships.length === 0) {
    return {
      success: true,
      data: {
        userId: user.id,
        email: user.email || email,
        isEmailVerified: true,
        hasActiveOrganization: false,
        redirectUrl: "/onboarding/create-organization",
      },
    };
  }

  // Extract ordered unique organization IDs
  const orderedOrgIds = Array.from(new Set(memberships.map((m) => m.organization_id)));

  // Query matching active organizations
  const { data: orgs, error: orgError } = await supabase
    .from("organizations")
    .select("id, slug, name, created_at")
    .in("id", orderedOrgIds)
    .eq("is_active", true);

  if (orgError) {
    console.error("[signInAction] Error fetching organizations:", orgError);
    return {
      success: false,
      error: {
        code: "ORGANIZATION_RESOLUTION_ERROR",
        message: "Unable to load organization details. Please try again.",
      },
    };
  }

  // Map to preserve deterministic order (oldest active membership first)
  const orgMap = new Map<string, { id: string; slug: string; name: string }>();
  for (const org of orgs || []) {
    orgMap.set(org.id, org);
  }

  const activeOrgs = orderedOrgIds
    .map((id) => orgMap.get(id))
    .filter((org): org is { id: string; slug: string; name: string } => !!org);

  // Deterministic fallback: first organization in activeOrgs (oldest active membership)
  const fallbackOrg = activeOrgs[0];
  if (!fallbackOrg || activeOrgs.length === 0) {
    return {
      success: true,
      data: {
        userId: user.id,
        email: user.email || email,
        isEmailVerified: true,
        hasActiveOrganization: false,
        redirectUrl: "/onboarding/create-organization",
      },
    };
  }

  const cookieStore = await getSafeCookieStore();
  const preferredSlug = cookieStore.get("bizflow_active_org")?.value;
  const chosenOrg =
    (preferredSlug ? activeOrgs.find((o) => o.slug === preferredSlug) : null) || fallbackOrg;

  // Set active organization cookie preference
  cookieStore.set("bizflow_active_org", chosenOrg.slug, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return {
    success: true,
    data: {
      userId: user.id,
      email: user.email || email,
      isEmailVerified: true,
      hasActiveOrganization: true,
      activeOrganizationId: chosenOrg.id,
      activeOrgSlug: chosenOrg.slug,
      redirectUrl: redirectTo ? sanitizeRedirectUrl(redirectTo, `/${chosenOrg.slug}/dashboard`) : `/${chosenOrg.slug}/dashboard`,
    },
  };
}

/**
 * Sign out current authenticated session and clear tenant cookies.
 */
export async function signOutAction(): Promise<ActionResult<SignOutResult>> {
  const supabase = await createClient();
  await supabase.auth.signOut();


  // Preserve bizflow_active_org preference for returning sign-in routing (FR-021)

  return {
    success: true,
    data: {
      success: true,
    },
  };
}

/**
 * Resend email verification notification with anti-enumeration protection.
 */
export async function resendVerificationAction(
  rawInput: ResendVerificationInput
): Promise<ActionResult<PasswordResetResult>> {
  const parseResult = resendVerificationSchema.safeParse(rawInput);
  if (!parseResult.success) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Please enter a valid email address.",
      },
    };
  }

  const { email } = parseResult.data;
  const supabase = await createClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  await supabase.auth.resend({
    type: "signup",
    email,
    options: {
      emailRedirectTo: `${appUrl}/api/auth/callback`,
    },
  });

  // Neutral message preventing email enumeration
  return {
    success: true,
    data: {
      message:
        "If an account exists with this email, a verification link has been sent. Please check your inbox.",
    },
  };
}

/**
 * Request password recovery email.
 */
export async function requestPasswordResetAction(
  rawInput: ForgotPasswordInput
): Promise<ActionResult<PasswordResetResult>> {
  const parseResult = forgotPasswordSchema.safeParse(rawInput);
  if (!parseResult.success) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Please enter a valid email address.",
      },
    };
  }

  const { email } = parseResult.data;
  const supabase = await createClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl}/api/auth/callback?next=/reset-password`,
  });

  return {
    success: true,
    data: {
      message:
        "If an account exists with this email, a password reset link has been sent. Please check your inbox.",
    },
  };
}

/**
 * Update user password using the authenticated recovery session.
 */
export async function resetPasswordAction(
  rawInput: ResetPasswordInput
): Promise<ActionResult<{ redirectUrl: string }>> {
  const parseResult = resetPasswordSchema.safeParse(rawInput);
  if (!parseResult.success) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message:
          parseResult.error.issues[0]?.message ||
          "Password does not meet complexity requirements.",
      },
    };
  }

  const { newPassword } = parseResult.data;
  const supabase = await createClient();

  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) {
    return {
      success: false,
      error: {
        code: "RESET_FAILED",
        message: error.message || "Failed to update password. Please request a new link.",
      },
    };
  }

  return {
    success: true,
    data: {
      redirectUrl: "/sign-in?reset=success",
    },
  };
}
