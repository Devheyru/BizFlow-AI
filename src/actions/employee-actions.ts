"use server";

import { createClient } from "@/lib/supabase/server";
import { resolveTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import {
  updateMemberRoleSchema,
  updateMemberStatusSchema,
  removeMemberSchema,
  type UpdateMemberRoleInput,
  type UpdateMemberStatusInput,
  type RemoveMemberInput,
} from "@/lib/validations/employee";
import type { ActionResult, AppRole, MembershipStatus } from "@/types/auth";

// ============================================================================
// Types
// ============================================================================

export interface EmployeeListItem {
  membershipId: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  role: AppRole;
  status: MembershipStatus;
  joinedAt: string;
}

export interface UpdateMemberRoleResult {
  membershipId: string;
  userId: string;
  role: AppRole;
  status: MembershipStatus;
}

export interface UpdateMemberStatusResult {
  membershipId: string;
  userId: string;
  role: AppRole;
  status: MembershipStatus;
}

export interface RemoveMemberResult {
  membershipId: string;
  status: "revoked";
}

const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  P0001: "Email verification required.",
  P0002: "Cannot complete action: organization must retain at least one active Owner.",
  P0003: "Authentication required.",
  P0004: "Caller is not an active member of this organization.",
  P0005: "Insufficient permissions to perform this action.",
  P0009: "Invalid request parameters provided.",
  P0020: "Admins cannot modify or assign the Owner role.",
  P0021: "User is already an active member of this organization.",
  P0023: "You cannot modify your own role.",
  P0024: "You cannot modify your own membership status.",
  P0025: "Cannot modify a revoked membership. Revocation is terminal.",
};

// ============================================================================
// Server Actions
// ============================================================================

/**
 * Retrieves the employee directory for an organization (T026, FR-001, FR-002, FR-003)
 */
export async function getEmployeesAction(
  slug: string
): Promise<ActionResult<EmployeeListItem[]>> {
  try {
    const tenantRes = await resolveTenantContext(slug);
    if (!tenantRes.ok) {
      return {
        success: false,
        error: { code: tenantRes.error.toUpperCase(), message: "Organization not found or access denied." },
      };
    }

    const { context } = tenantRes;
    if (!hasPermission(context, "employees:read")) {
      return {
        success: false,
        error: { code: "FORBIDDEN", message: "Insufficient permissions to view employee directory." },
      };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_organization_employees", {
      p_org_id: context.organization.id,
    });

    if (error) {
      const message = KNOWN_ERROR_MESSAGES[error.code] || error.message || "Failed to load employees.";
      return {
        success: false,
        error: { code: error.code || "RPC_ERROR", message },
      };
    }

    const employees: EmployeeListItem[] = (data || []).map((row) => ({
      membershipId: row.membership_id,
      userId: row.user_id,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      phone: row.phone,
      role: row.role as AppRole,
      status: row.status as MembershipStatus,
      joinedAt: row.joined_at,
    }));

    return { success: true, data: employees };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

/**
 * Updates an employee's organizational role (T027, FR-024, FR-025, FR-026)
 */
export async function updateMemberRoleAction(
  slug: string,
  input: UpdateMemberRoleInput
): Promise<ActionResult<UpdateMemberRoleResult>> {
  try {
    const parsed = updateMemberRoleSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid input parameters.",
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
    if (!hasPermission(context, "employees:update_role")) {
      return {
        success: false,
        error: { code: "FORBIDDEN", message: "Insufficient permissions to update employee roles." },
      };
    }

    // Invariant: Self-modification prevention
    if (context.membership.id === parsed.data.membershipId) {
      return {
        success: false,
        error: { code: "SELF_MODIFICATION_BLOCKED", message: "You cannot modify your own role." },
      };
    }

    // Invariant: Admin privilege boundary
    if (context.role === "admin" && parsed.data.newRole === "owner") {
      return {
        success: false,
        error: { code: "FORBIDDEN", message: "Admins cannot promote employees to the Owner role." },
      };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("update_organization_member_role", {
      p_org_id: context.organization.id,
      p_target_membership_id: parsed.data.membershipId,
      p_new_role: parsed.data.newRole,
    });

    if (error) {
      const message = KNOWN_ERROR_MESSAGES[error.code] || error.message || "Failed to update member role.";
      return {
        success: false,
        error: { code: error.code || "RPC_ERROR", message },
      };
    }

    const rpcPayload = data as {
      membership_id: string;
      user_id: string;
      role: AppRole;
      status: MembershipStatus;
    };

    return {
      success: true,
      data: {
        membershipId: rpcPayload.membership_id,
        userId: rpcPayload.user_id,
        role: rpcPayload.role,
        status: rpcPayload.status,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

/**
 * Suspends or reactivates an employee membership (T028, FR-027, FR-028)
 */
export async function updateMemberStatusAction(
  slug: string,
  input: UpdateMemberStatusInput
): Promise<ActionResult<UpdateMemberStatusResult>> {
  try {
    const parsed = updateMemberStatusSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid input parameters.",
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
    if (!hasPermission(context, "employees:suspend")) {
      return {
        success: false,
        error: { code: "FORBIDDEN", message: "Insufficient permissions to change employee status." },
      };
    }

    // Invariant: Self-modification prevention
    if (context.membership.id === parsed.data.membershipId) {
      return {
        success: false,
        error: { code: "SELF_MODIFICATION_BLOCKED", message: "You cannot modify your own membership status." },
      };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("update_organization_member_status", {
      p_org_id: context.organization.id,
      p_target_membership_id: parsed.data.membershipId,
      p_new_status: parsed.data.status,
    });

    if (error) {
      const message = KNOWN_ERROR_MESSAGES[error.code] || error.message || "Failed to update member status.";
      return {
        success: false,
        error: { code: error.code || "RPC_ERROR", message },
      };
    }

    const rpcPayload = data as {
      membership_id: string;
      user_id: string;
      role: AppRole;
      status: MembershipStatus;
    };

    return {
      success: true,
      data: {
        membershipId: rpcPayload.membership_id,
        userId: rpcPayload.user_id,
        role: rpcPayload.role,
        status: rpcPayload.status,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}

/**
 * Removes an employee from an organization via terminal soft revocation (T029, FR-029, FR-030, FR-031)
 */
export async function removeMemberAction(
  slug: string,
  input: RemoveMemberInput
): Promise<ActionResult<RemoveMemberResult>> {
  try {
    const parsed = removeMemberSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid input parameters.",
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
    if (!hasPermission(context, "employees:remove")) {
      return {
        success: false,
        error: { code: "FORBIDDEN", message: "Insufficient permissions to remove employees." },
      };
    }

    // Invariant: Self-removal prevention if last owner
    if (context.membership.id === parsed.data.membershipId && context.role === "owner") {
      return {
        success: false,
        error: {
          code: "LAST_OWNER_REMOVAL_BLOCKED",
          message: "Cannot remove yourself: organization must retain at least one active Owner.",
        },
      };
    }

    const supabase = await createClient();
    const { error } = await supabase.rpc("update_organization_member_status", {
      p_org_id: context.organization.id,
      p_target_membership_id: parsed.data.membershipId,
      p_new_status: "revoked",
    });

    if (error) {
      const message = KNOWN_ERROR_MESSAGES[error.code] || error.message || "Failed to remove employee.";
      return {
        success: false,
        error: { code: error.code || "RPC_ERROR", message },
      };
    }

    return {
      success: true,
      data: {
        membershipId: parsed.data.membershipId,
        status: "revoked",
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    return { success: false, error: { code: "INTERNAL_ERROR", message } };
  }
}
