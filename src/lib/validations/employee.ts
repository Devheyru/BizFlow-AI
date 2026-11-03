import { z } from "zod";

/**
 * Validation schema for updating an organization member's role (T023, FR-025)
 */
export const updateMemberRoleSchema = z.object({
  organizationId: z.string().uuid("Invalid organization ID"),
  membershipId: z.string().uuid("Invalid membership ID"),
  newRole: z.enum(["owner", "admin", "manager", "cashier"]),
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

/**
 * Validation schema for updating member status: suspension and reactivation (T023, FR-027)
 * Terminal revocation is handled exclusively via removeMemberSchema.
 */
export const updateMemberStatusSchema = z.object({
  organizationId: z.string().uuid("Invalid organization ID"),
  membershipId: z.string().uuid("Invalid membership ID"),
  status: z.enum(["active", "suspended"]),
});

export type UpdateMemberStatusInput = z.infer<typeof updateMemberStatusSchema>;

/**
 * Validation schema for employee removal (soft revocation) (T023, FR-029)
 */
export const removeMemberSchema = z.object({
  organizationId: z.string().uuid("Invalid organization ID"),
  membershipId: z.string().uuid("Invalid membership ID"),
});

export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;
