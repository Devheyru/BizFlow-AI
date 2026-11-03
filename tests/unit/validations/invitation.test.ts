import { describe, it, expect } from "vitest";
import {
  inviteEmployeeSchema,
  resendInvitationSchema,
  revokeInvitationSchema,
  acceptInvitationSchema,
  declineInvitationSchema,
  validateInvitationTokenSchema,
} from "@/lib/validations/invitation";

describe("T049: Invitation Validation Schemas (FR-006, FR-007, FR-009)", () => {
  const validOrgId = "11111111-1111-4111-8111-111111111111";
  const validInvId = "22222222-2222-4222-8222-222222222222";
  const validToken = "a".repeat(64);

  describe("inviteEmployeeSchema", () => {
    it("accepts valid invitation inputs and normalizes email", () => {
      const result = inviteEmployeeSchema.safeParse({
        organizationId: validOrgId,
        email: "  Employee.Test@EXAMPLE.com  ",
        role: "manager",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe("employee.test@example.com");
      }
    });

    it("rejects invalid emails", () => {
      const invalidEmails = ["not-an-email", "@example.com", "user@", "user@.com"];
      for (const email of invalidEmails) {
        const result = inviteEmployeeSchema.safeParse({
          organizationId: validOrgId,
          email,
          role: "cashier",
        });
        expect(result.success).toBe(false);
      }
    });

    it("accepts all valid application roles", () => {
      const roles = ["owner", "admin", "manager", "cashier"] as const;
      for (const role of roles) {
        const result = inviteEmployeeSchema.safeParse({
          organizationId: validOrgId,
          email: "valid@example.com",
          role,
        });
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid roles", () => {
      const result = inviteEmployeeSchema.safeParse({
        organizationId: validOrgId,
        email: "valid@example.com",
        role: "guest",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("resendInvitationSchema and revokeInvitationSchema", () => {
    it("accepts valid invitation UUIDs", () => {
      expect(resendInvitationSchema.safeParse({ invitationId: validInvId }).success).toBe(true);
      expect(revokeInvitationSchema.safeParse({ invitationId: validInvId }).success).toBe(true);
    });

    it("rejects non-UUID strings", () => {
      expect(resendInvitationSchema.safeParse({ invitationId: "invalid-id" }).success).toBe(false);
      expect(revokeInvitationSchema.safeParse({ invitationId: "invalid-id" }).success).toBe(false);
    });
  });

  describe("acceptInvitationSchema, declineInvitationSchema, and validateInvitationTokenSchema", () => {
    it("accepts valid token formats", () => {
      expect(acceptInvitationSchema.safeParse({ token: validToken }).success).toBe(true);
      expect(declineInvitationSchema.safeParse({ token: validToken }).success).toBe(true);
      expect(validateInvitationTokenSchema.safeParse({ token: validToken }).success).toBe(true);
    });

    it("rejects tokens that are too short", () => {
      expect(acceptInvitationSchema.safeParse({ token: "short" }).success).toBe(false);
      expect(declineInvitationSchema.safeParse({ token: "short" }).success).toBe(false);
      expect(validateInvitationTokenSchema.safeParse({ token: "short" }).success).toBe(false);
    });
  });
});
