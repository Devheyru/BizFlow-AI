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

  // Query user's active organizations
  const { data: memberships } = await supabase
    .from("organization_memberships")
    .select("organization_id, role, status")
    .eq("user_id", user.id)
    .eq("status", "active");

  const orgIds = memberships?.map((m) => m.organization_id) || [];
  let activeOrgs: Array<{ id: string; slug: string; name: string }> = [];

  if (orgIds.length > 0) {
    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, slug, name")
      .in("id", orgIds)
      .eq("is_active", true);

    if (orgs) {
      activeOrgs = orgs;
    }
  }

  // 1. If user has 0 active organizations, guide to onboarding
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

  // 2. If user has active organization(s), resolve preference from cookie or select first
  const cookieStore = await getSafeCookieStore();
  const preferredSlug = cookieStore.get("bizflow_active_org")?.value;
  const chosenOrg =
    activeOrgs.find((o) => o.slug === preferredSlug) || fallbackOrg;

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

  const cookieStore = await getSafeCookieStore();
  cookieStore.delete("bizflow_active_org");

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
