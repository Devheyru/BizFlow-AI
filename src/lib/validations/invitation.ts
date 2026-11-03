import { z } from "zod";

/**
 * Validation schema for issuing a new employee invitation (T024, FR-005, FR-006)
 */
export const inviteEmployeeSchema = z.object({
  organizationId: z.string().uuid("Invalid organization ID"),
  email: z
    .string()
    .trim()
    .min(5, "Email must be at least 5 characters")
    .max(255, "Email must not exceed 255 characters")
    .regex(
      /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/,
      "Please enter a valid email address"
    )
    .toLowerCase(),
  role: z.enum(["owner", "admin", "manager", "cashier"]),
});

export type InviteEmployeeInput = z.infer<typeof inviteEmployeeSchema>;

/**
 * Validation schema for resending an invitation (T024, FR-014)
 */
export const resendInvitationSchema = z.object({
  invitationId: z.string().uuid("Invalid invitation ID"),
});

export type ResendInvitationInput = z.infer<typeof resendInvitationSchema>;

/**
 * Validation schema for revoking an invitation (T024, FR-013)
 */
export const revokeInvitationSchema = z.object({
  invitationId: z.string().uuid("Invalid invitation ID"),
});

export type RevokeInvitationInput = z.infer<typeof revokeInvitationSchema>;

/**
 * Validation schema for accepting an invitation (T024, FR-016)
 */
export const acceptInvitationSchema = z.object({
  token: z.string().min(32, "Invalid invitation token"),
});

export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

/**
 * Validation schema for declining an invitation (T024, FR-020)
 */
export const declineInvitationSchema = z.object({
  token: z.string().min(32, "Invalid invitation token"),
});

export type DeclineInvitationInput = z.infer<typeof declineInvitationSchema>;

/**
 * Validation schema for pre-flight token validation (T024, FR-016)
 */
export const validateInvitationTokenSchema = z.object({
  token: z.string().min(32, "Invalid token format"),
});

export type ValidateInvitationTokenInput = z.infer<
  typeof validateInvitationTokenSchema
>;
