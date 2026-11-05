"use server";

import crypto from "node:crypto";
import { createClient, getSafeCookieStore } from "@/lib/supabase/server";
import { resolveTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { sendInvitationEmail, buildInvitationUrl } from "@/lib/email/invitation-mailer";
import {
  inviteEmployeeSchema,
  resendInvitationSchema,
  revokeInvitationSchema,
  acceptInvitationSchema,
  declineInvitationSchema,
  validateInvitationTokenSchema,
  type InviteEmployeeInput,
  type ResendInvitationInput,
  type RevokeInvitationInput,
  type AcceptInvitationInput,
  type DeclineInvitationInput,
  type ValidateInvitationTokenInput,
} from "@/lib/validations/invitation";
import type { ActionResult, AppRole, InvitationStatus } from "@/types/auth";

// ============================================================================
// Types
// ============================================================================

export interface InviteEmployeeResult {
  invitationId: string;
  organizationId: string;
  email: string;
  role: AppRole;
  status: "pending";
  expiresAt: string;
  warning?: "EMAIL_DELIVERY_FAILED";
}

export interface ResendInvitationResult {
  invitationId: string;
  organizationId: string;
  email: string;
  role: AppRole;
  status: "pending";
  expiresAt: string;
  warning?: "EMAIL_DELIVERY_FAILED";
}

export interface RevokeInvitationResult {
  invitationId: string;
  status: "revoked";
}

export interface PendingInvitationItem {
  id: string;
  email: string;
  role: AppRole;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  invitedBy: string;
}

export interface ValidateInvitationTokenResult {
  isValid: boolean;
  isExpired: boolean;
  status: InvitationStatus | null;
}

export interface AcceptInvitationResult {
  organizationId: string;
  organizationSlug: string;
  role: AppRole;
  status: "active";
  redirectUrl: string;
}

export interface DeclineInvitationResult {
  invitationId: string;
  status: "declined";
}

const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  P0001: "Email verification is required.",
  P0003: "Authentication required.",
  P0004: "Caller is not an active member of this organization.",
  P0005: "Insufficient permissions to manage invitations.",
  P0009: "Invalid request parameters provided.",
  P0020: "Admins cannot invite users with the Owner role.",
  P0021: "User is already an active member of this organization.",
  P0022: "An active invitation is already pending for this email address.",
  P0026: "Cannot resend an accepted, declined, or revoked invitation.",
  P0027: "User is a suspended member of this organization.",
};

// ============================================================================
// Server Actions
// ============================================================================

/**
 * Issues an employee invitation and dispatches invitation email (T030, FR-005 to FR-012, FR-015)
 */
export async function inviteEmployeeAction(
  slug: string,
  input: InviteEmployeeInput
): Promise<ActionResult<InviteEmployeeResult>> {
  try {
    const parsed = inviteEmployeeSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid invitation parameters.",
          details: parsed.error.flatten().fieldErrors,
        },
      };
    }

    const tenantRes = await resolveTenantContext(slug);
    if (!tenantRes.ok) {
      return {
        success: false,
        error: { code: tenantRes.error.toUpperCase(), message: "Organization not found or access denied." },
      };
    }

    const { context } = tenantRes;
    if (!hasPermission(context, "employees:invite")) {
      return {
        success: false,
        error: { code: "FORBIDDEN", message: "Insufficient permissions to invite employees." },
      };
    }

    // Privilege escalation prevention
    if (context.role === "admin" && parsed.data.role === "owner") {
      return {
        success: false,
        error: { code: "FORBIDDEN", message: "Admins cannot invite users with the Owner role." },
      };
    }

    // Generate 256-bit cryptographically secure random token and SHA-256 hash
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_organization_invitation", {
      p_org_id: context.organization.id,
      p_email: parsed.data.email,
      p_role: parsed.data.role,
      p_token_hash: tokenHash,
      p_expires_at: expiresAt,
    });

    if (error) {
      const message = KNOWN_ERROR_MESSAGES[error.code] || error.message || "Failed to create invitation.";
      return {
        success: false,
        error: { code: error.code || "RPC_ERROR", message },
      };
    }

    const rpcData = data as {
      invitation_id: string;
      organization_id: string;
      email: string;
      role: AppRole;
      status: "pending";
      expires_at: string;
    };

    // Construct normalized invitation link using URL API
    let invitationUrl: string;
    try {
      invitationUrl = buildInvitationUrl(rawToken);
    } catch (urlErr) {
      console.error(
        "[INVITATION URL] Construction failed:",
        urlErr instanceof Error ? urlErr.message : "Invalid URL configuration"
      );
      const result: InviteEmployeeResult = {
        invitationId: rpcData.invitation_id,
        organizationId: rpcData.organization_id,
        email: rpcData.email,
        role: rpcData.role,
        status: "pending",
        expiresAt: rpcData.expires_at,
        warning: "EMAIL_DELIVERY_FAILED",
      };
      return { success: true, data: result };
    }

    // Dispatched decoupled outside transaction
    const emailRes = await sendInvitationEmail({
      recipientEmail: parsed.data.email,
      organizationName: context.organization.name,
      role: parsed.data.role,
      invitationUrl,
    });

    const result: InviteEmployeeResult = {
      invitationId: rpcData.invitation_id,
      organizationId: rpcData.organization_id,
      email: rpcData.email,
      role: rpcData.role,
      status: "pending",
      expiresAt: rpcData.expires_at,
    };

    if (!emailRes.success) {
      result.warning = "EMAIL_DELIVERY_FAILED";
    }

    return { success: true, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

/**
 * Resends an existing pending or expired invitation with a fresh token (T031, FR-014, FR-015)
 */
export async function resendInvitationAction(
  slug: string,
  input: ResendInvitationInput
): Promise<ActionResult<ResendInvitationResult>> {
  try {
    const parsed = resendInvitationSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid invitation ID.",
          details: parsed.error.flatten().fieldErrors,
        },
      };
    }

    const tenantRes = await resolveTenantContext(slug);
    if (!tenantRes.ok) {
      return {
        success: false,
        error: { code: tenantRes.error.toUpperCase(), message: "Organization not found or access denied." },
      };
    }

    const { context } = tenantRes;
    if (!hasPermission(context, "employees:invite")) {
      return {
        success: false,
        error: { code: "FORBIDDEN", message: "Insufficient permissions to resend invitations." },
      };
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("resend_organization_invitation", {
      p_invitation_id: parsed.data.invitationId,
      p_new_token_hash: tokenHash,
      p_new_expires_at: newExpiresAt,
    });

    if (error) {
      const message = KNOWN_ERROR_MESSAGES[error.code] || error.message || "Failed to resend invitation.";
      return {
        success: false,
        error: { code: error.code || "RPC_ERROR", message },
      };
    }

    const rpcData = data as {
      invitation_id: string;
      organization_id: string;
      email: string;
      role: AppRole;
      status: "pending";
      expires_at: string;
    };

    // Construct normalized invitation link using URL API
    let invitationUrl: string;
    try {
      invitationUrl = buildInvitationUrl(rawToken);
    } catch (urlErr) {
      console.error(
        "[INVITATION URL] Construction failed:",
        urlErr instanceof Error ? urlErr.message : "Invalid URL configuration"
      );
      const result: ResendInvitationResult = {
        invitationId: rpcData.invitation_id,
        organizationId: rpcData.organization_id,
        email: rpcData.email,
        role: rpcData.role,
        status: "pending",
        expiresAt: rpcData.expires_at,
        warning: "EMAIL_DELIVERY_FAILED",
      };
      return { success: true, data: result };
    }

    const emailRes = await sendInvitationEmail({
      recipientEmail: rpcData.email,
      organizationName: context.organization.name,
      role: rpcData.role,
      invitationUrl,
    });

    const result: ResendInvitationResult = {
      invitationId: rpcData.invitation_id,
      organizationId: rpcData.organization_id,
      email: rpcData.email,
      role: rpcData.role,
      status: "pending",
      expiresAt: rpcData.expires_at,
    };

    if (!emailRes.success) {
      result.warning = "EMAIL_DELIVERY_FAILED";
    }

    return { success: true, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

/**
 * Revokes a pending invitation (T032, FR-013)
 */
export async function revokeInvitationAction(
  slug: string,
  input: RevokeInvitationInput
): Promise<ActionResult<RevokeInvitationResult>> {
  try {
    const parsed = revokeInvitationSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid invitation ID.",
          details: parsed.error.flatten().fieldErrors,
        },
      };
    }

    const tenantRes = await resolveTenantContext(slug);
    if (!tenantRes.ok) {
      return {
        success: false,
        error: { code: tenantRes.error.toUpperCase(), message: "Organization not found or access denied." },
      };
    }

    const { context } = tenantRes;
    if (!hasPermission(context, "employees:invitations_revoke")) {
      return {
        success: false,
        error: { code: "FORBIDDEN", message: "Insufficient permissions to revoke invitations." },
      };
    }

    const supabase = await createClient();
    const { error } = await supabase.rpc("revoke_organization_invitation", {
      p_invitation_id: parsed.data.invitationId,
    });

    if (error) {
      const message = KNOWN_ERROR_MESSAGES[error.code] || error.message || "Failed to revoke invitation.";
      return {
        success: false,
        error: { code: error.code || "RPC_ERROR", message },
      };
    }

    return {
      success: true,
      data: {
        invitationId: parsed.data.invitationId,
        status: "revoked",
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

/**
 * Retrieves pending invitations for the employee directory (T034, FR-008, FR-034)
 */
export async function getPendingInvitationsAction(
  slug: string
): Promise<ActionResult<PendingInvitationItem[]>> {
  try {
    const tenantRes = await resolveTenantContext(slug);
    if (!tenantRes.ok) {
      return {
        success: false,
        error: { code: tenantRes.error.toUpperCase(), message: "Organization not found or access denied." },
      };
    }

    const { context } = tenantRes;
    if (!hasPermission(context, "employees:invitations_read")) {
      return {
        success: false,
        error: { code: "FORBIDDEN", message: "Insufficient permissions to view invitations." },
      };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("organization_invitations")
      .select("id, email, role, status, expires_at, created_at, invited_by")
      .eq("organization_id", context.organization.id)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      return {
        success: false,
        error: { code: error.code || "QUERY_ERROR", message: error.message || "Failed to load invitations." },
      };
    }

    const invitations: PendingInvitationItem[] = (data || []).map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role as AppRole,
      status: row.status as InvitationStatus,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      invitedBy: row.invited_by,
    }));

    return { success: true, data: invitations };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

/**
 * Pre-flight token validation without disclosing tenant or invitee metadata (T024, FR-016)
 */
export async function validateInvitationTokenAction(
  input: ValidateInvitationTokenInput
): Promise<ActionResult<ValidateInvitationTokenResult>> {
  try {
    const parsed = validateInvitationTokenSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: true,
        data: { isValid: false, isExpired: false, status: null },
      };
    }

    const tokenHash = crypto.createHash("sha256").update(parsed.data.token).digest("hex");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("validate_invitation_token", {
      p_token_hash: tokenHash,
    });

    if (error || !data) {
      return {
        success: true,
        data: { isValid: false, isExpired: false, status: null },
      };
    }

    const payload = data as {
      is_valid: boolean;
      is_expired: boolean;
      status: InvitationStatus | null;
    };

    return {
      success: true,
      data: {
        isValid: payload.is_valid,
        isExpired: payload.is_expired,
        status: payload.status,
      },
    };
  } catch {
    return {
      success: true,
      data: { isValid: false, isExpired: false, status: null },
    };
  }
}

/**
 * Accepts an invitation with atomic membership creation and lazy expiration (T033, FR-017 to FR-023)
 */
export async function acceptInvitationAction(
  input: AcceptInvitationInput
): Promise<ActionResult<AcceptInvitationResult>> {
  try {
    const parsed = acceptInvitationSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid invitation token format.",
          details: parsed.error.flatten().fieldErrors,
        },
      };
    }

    const tokenHash = crypto.createHash("sha256").update(parsed.data.token).digest("hex");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("accept_organization_invitation", {
      p_token_hash: tokenHash,
    });

    if (error) {
      return {
        success: false,
        error: { code: error.code || "RPC_ERROR", message: error.message || "Failed to process invitation." },
      };
    }

    const res = data as {
      success: boolean;
      code?: string;
      message?: string;
      organization_id?: string;
      organization_slug?: string;
      role?: AppRole;
      status?: "active";
    };

    if (!res.success) {
      // Generic privacy message for email mismatch without leaking addresses
      const message =
        res.code === "EMAIL_MISMATCH"
          ? "The authenticated account does not match the invitation recipient."
          : res.message || "Failed to accept invitation.";

      return {
        success: false,
        error: { code: res.code || "ACCEPT_FAILED", message },
      };
    }

    // Set active organization cookie preference
    if (res.organization_slug) {
      const cookieStore = await getSafeCookieStore();
      cookieStore.set("bizflow_active_org", res.organization_slug, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 30, // 30 days
      });
    }

    return {
      success: true,
      data: {
        organizationId: res.organization_id!,
        organizationSlug: res.organization_slug!,
        role: res.role!,
        status: "active",
        redirectUrl: `/${res.organization_slug}/dashboard`,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

/**
 * Declines an invitation (T035, FR-020, FR-023)
 */
export async function declineInvitationAction(
  input: DeclineInvitationInput
): Promise<ActionResult<DeclineInvitationResult>> {
  try {
    const parsed = declineInvitationSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid invitation token format.",
          details: parsed.error.flatten().fieldErrors,
        },
      };
    }

    const tokenHash = crypto.createHash("sha256").update(parsed.data.token).digest("hex");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("decline_organization_invitation", {
      p_token_hash: tokenHash,
    });

    if (error) {
      return {
        success: false,
        error: { code: error.code || "RPC_ERROR", message: error.message || "Failed to process decline." },
      };
    }

    const res = data as {
      success: boolean;
      code?: string;
      message?: string;
      invitation_id?: string;
      status?: "declined";
    };

    if (!res.success) {
      const message =
        res.code === "EMAIL_MISMATCH"
          ? "The authenticated account does not match the invitation recipient."
          : res.message || "Failed to decline invitation.";

      return {
        success: false,
        error: { code: res.code || "DECLINE_FAILED", message },
      };
    }

    return {
      success: true,
      data: {
        invitationId: res.invitation_id!,
        status: "declined",
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}
