"use server";

import { createClient } from "@/lib/supabase/server";
import {
  updateProfileSchema,
  changePasswordSchema,
  type UpdateProfileInput,
  type ChangePasswordInput,
} from "@/lib/validations/auth";
import type {
  ActionResult,
  UserProfile,
  ChangePasswordExecutionResult,
} from "@/types/auth";

/**
 * Fetch current user profile.
 */
export async function getProfileAction(): Promise<ActionResult<UserProfile>> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be signed in to view your profile.",
      },
    };
  }

  const { data: profile, error: dbError } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, phone, created_at, updated_at")
    .eq("id", user.id)
    .single();

  if (dbError || !profile) {
    return {
      success: false,
      error: {
        code: "PROFILE_NOT_FOUND",
        message: "Profile record could not be retrieved.",
      },
    };
  }

  return {
    success: true,
    data: {
      id: profile.id,
      email: user.email || "",
      firstName: profile.first_name,
      lastName: profile.last_name,
      phone: profile.phone,
      isEmailVerified: !!user.email_confirmed_at,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
    },
  };
}

/**
 * Update authenticated user personal profile (FR-007, US5, T054).
 */
export async function updateProfileAction(
  rawInput: UpdateProfileInput
): Promise<ActionResult<UserProfile>> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be signed in to update your profile.",
      },
    };
  }

  const parseResult = updateProfileSchema.safeParse(rawInput);
  if (!parseResult.success) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message:
          parseResult.error.issues[0]?.message || "Invalid profile data provided.",
      },
    };
  }

  const { firstName, lastName, phone } = parseResult.data;
  const normalizedPhone = phone && phone.trim().length > 0 ? phone.trim() : null;

  // 1. Update public.profiles under user's own RLS context
  // public.profiles is the authoritative store of record for user profiles in BizFlow AI
  const { data: updatedProfile, error: updateError } = await supabase
    .from("profiles")
    .update({
      first_name: firstName,
      last_name: lastName,
      phone: normalizedPhone,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id)
    .select("id, first_name, last_name, phone, created_at, updated_at")
    .single();

  if (updateError || !updatedProfile) {
    console.error("[updateProfileAction] Database update error:", updateError);
    return {
      success: false,
      error: {
        code: "UPDATE_FAILED",
        message: "Failed to update profile information. Please verify your input and try again.",
      },
    };
  }

  // 2. Best-effort sync to Supabase Auth user_metadata
  // public.profiles is authoritative. Any auth metadata sync error is non-fatal and logged
  // without attempting distributed rollback.
  try {
    const { error: metaError } = await supabase.auth.updateUser({
      data: {
        first_name: firstName,
        last_name: lastName,
      },
    });

    if (metaError) {
      console.warn("[updateProfileAction] Best-effort auth metadata sync warning:", metaError);
    }
  } catch (err) {
    console.warn("[updateProfileAction] Best-effort auth metadata sync exception:", err);
  }

  return {
    success: true,
    data: {
      id: updatedProfile.id,
      email: user.email || "",
      firstName: updatedProfile.first_name,
      lastName: updatedProfile.last_name,
      phone: updatedProfile.phone,
      isEmailVerified: !!user.email_confirmed_at,
      createdAt: updatedProfile.created_at,
      updatedAt: updatedProfile.updated_at,
    },
  };
}

/**
 * Authenticated password change (FR-006, US5 Scenario 6).
 * Re-authenticates current credentials before updating and revokes other active sessions.
 */
export async function changePasswordAction(
  rawInput: ChangePasswordInput
): Promise<ActionResult<ChangePasswordExecutionResult>> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user || !user.email) {
    return {
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be signed in to change your password.",
      },
    };
  }

  const parseResult = changePasswordSchema.safeParse(rawInput);
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

  const { currentPassword, newPassword } = parseResult.data;

  // 1. Re-authenticate with current credentials
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });

  if (verifyError) {
    return {
      success: false,
      error: {
        code: "INVALID_CURRENT_PASSWORD",
        message: "Current password is incorrect.",
      },
    };
  }

  // 2. Update to new password
  const { error: updateError } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (updateError) {
    return {
      success: false,
      error: {
        code: "PASSWORD_UPDATE_FAILED",
        message: "Failed to update password. Please check complexity rules and try again.",
      },
    };
  }

  // 3. Terminate other active sessions (FR-006)
  const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });

  if (signOutError) {
    console.error("[changePasswordAction] Other session revocation warning:", signOutError);
    return {
      success: true,
      data: {
        message:
          "Your password has been changed successfully, but terminating other active sessions failed.",
        revocationStatus: "failed",
        warning: "Failed to sign out other active sessions.",
      },
    };
  }

  return {
    success: true,
    data: {
      message:
        "Your password has been changed successfully. Other active sessions have been signed out.",
      revocationStatus: "revoked",
    },
  };
}

