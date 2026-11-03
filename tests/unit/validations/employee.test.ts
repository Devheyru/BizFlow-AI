import { describe, it, expect } from "vitest";
import {
  updateMemberRoleSchema,
  updateMemberStatusSchema,
  removeMemberSchema,
} from "@/lib/validations/employee";

describe("T048: Employee Validation Schemas (FR-024, FR-027, FR-029)", () => {
  const validOrgId = "11111111-1111-4111-8111-111111111111";
  const validMemberId = "22222222-2222-4222-8222-222222222222";

  describe("updateMemberRoleSchema", () => {
    it("accepts valid UUIDs and valid roles", () => {
      const roles = ["owner", "admin", "manager", "cashier"] as const;
      for (const role of roles) {
        const result = updateMemberRoleSchema.safeParse({
          organizationId: validOrgId,
          membershipId: validMemberId,
          newRole: role,
        });
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid UUIDs", () => {
      const result = updateMemberRoleSchema.safeParse({
        organizationId: "not-a-uuid",
        membershipId: validMemberId,
        newRole: "manager",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid roles", () => {
      const result = updateMemberRoleSchema.safeParse({
        organizationId: validOrgId,
        membershipId: validMemberId,
        newRole: "superadmin",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("updateMemberStatusSchema", () => {
    it("accepts active and suspended status", () => {
      const statuses = ["active", "suspended"] as const;
      for (const status of statuses) {
        const result = updateMemberStatusSchema.safeParse({
          organizationId: validOrgId,
          membershipId: validMemberId,
          status,
        });
        expect(result.success).toBe(true);
      }
    });

    it("rejects revoked status (must use removeMemberAction instead)", () => {
      const result = updateMemberStatusSchema.safeParse({
        organizationId: validOrgId,
        membershipId: validMemberId,
        status: "revoked",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid status", () => {
      const result = updateMemberStatusSchema.safeParse({
        organizationId: validOrgId,
        membershipId: validMemberId,
        status: "unknown",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("removeMemberSchema", () => {
    it("accepts valid UUIDs", () => {
      const result = removeMemberSchema.safeParse({
        organizationId: validOrgId,
        membershipId: validMemberId,
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing or invalid UUIDs", () => {
      const result = removeMemberSchema.safeParse({
        organizationId: "invalid",
        membershipId: validMemberId,
      });
      expect(result.success).toBe(false);
    });
  });
});
