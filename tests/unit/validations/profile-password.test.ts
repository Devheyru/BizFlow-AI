import { describe, it, expect } from "vitest";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
  changePasswordSchema,
} from "@/lib/validations/auth";

describe("T048: Profile Management & Password Recovery Validation Schemas (US5)", () => {
  describe("forgotPasswordSchema", () => {
    it("accepts valid email addresses and normalizes to lowercase", () => {
      const result = forgotPasswordSchema.safeParse({
        email: " User.Account@Example.COM ",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe("user.account@example.com");
      }
    });

    it("rejects empty or whitespace-only email", () => {
      const result = forgotPasswordSchema.safeParse({ email: "   " });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain("Email address is required");
      }
    });

    it("rejects invalid email formats", () => {
      const invalidEmails = ["notanemail", "user@", "@domain.com", "user@domain", "user space@test.com"];
      for (const email of invalidEmails) {
        const result = forgotPasswordSchema.safeParse({ email });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain("valid email address");
        }
      }
    });
  });

  describe("resetPasswordSchema", () => {
    it("accepts matching, compliant newPassword and confirmPassword", () => {
      const result = resetPasswordSchema.safeParse({
        newPassword: "ValidP@ssword123",
        confirmPassword: "ValidP@ssword123",
      });
      expect(result.success).toBe(true);
    });

    it("rejects when confirmPassword is missing or omitted", () => {
      const result = resetPasswordSchema.safeParse({
        newPassword: "StrongP@ssw0rd!",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const confirmIssue = result.error.issues.find((i) => i.path.includes("confirmPassword"));
        expect(confirmIssue).toBeDefined();
        expect(confirmIssue?.message).toContain("Password confirmation is required");
      }
    });

    it("rejects when confirmPassword is empty", () => {
      const result = resetPasswordSchema.safeParse({
        newPassword: "StrongP@ssw0rd!",
        confirmPassword: "",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const confirmIssue = result.error.issues.find((i) => i.path.includes("confirmPassword"));
        expect(confirmIssue).toBeDefined();
        expect(confirmIssue?.message).toContain("Password confirmation is required");
      }
    });

    it("rejects mismatched confirmPassword", () => {
      const result = resetPasswordSchema.safeParse({
        newPassword: "ValidP@ssword123",
        confirmPassword: "DifferentP@ssword123",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const confirmIssue = result.error.issues.find((i) => i.path.includes("confirmPassword"));
        expect(confirmIssue).toBeDefined();
        expect(confirmIssue?.message).toBe("Passwords do not match");
      }
    });

    it("rejects passwords failing complexity rules even if confirmPassword matches", () => {
      const weakPasswords = [
        "short1!", // < 8 chars
        "alllowercase1!", // missing uppercase
        "ALLUPPERCASE1!", // missing lowercase
        "NoNumberP@ss", // missing digit
        "NoSpecialChar123", // missing symbol
      ];

      for (const newPassword of weakPasswords) {
        const result = resetPasswordSchema.safeParse({
          newPassword,
          confirmPassword: newPassword,
        });
        expect(result.success).toBe(false);
      }
    });
  });

  describe("updateProfileSchema", () => {
    it("accepts valid first name, last name, and phone number", () => {
      const result = updateProfileSchema.safeParse({
        firstName: "  Jane  ",
        lastName: "  Doe  ",
        phone: "+1234567890",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.firstName).toBe("Jane");
        expect(result.data.lastName).toBe("Doe");
        expect(result.data.phone).toBe("+1234567890");
      }
    });

    it("accepts profile without phone or with empty phone string", () => {
      const withoutPhone = updateProfileSchema.safeParse({
        firstName: "John",
        lastName: "Smith",
      });
      expect(withoutPhone.success).toBe(true);

      const emptyPhone = updateProfileSchema.safeParse({
        firstName: "John",
        lastName: "Smith",
        phone: "",
      });
      expect(emptyPhone.success).toBe(true);
    });

    it("rejects empty or whitespace-only first and last names", () => {
      const emptyFirst = updateProfileSchema.safeParse({
        firstName: "   ",
        lastName: "Smith",
      });
      expect(emptyFirst.success).toBe(false);

      const emptyLast = updateProfileSchema.safeParse({
        firstName: "John",
        lastName: "   ",
      });
      expect(emptyLast.success).toBe(false);
    });

    it("rejects names exceeding 50 characters", () => {
      const longName = "A".repeat(51);
      const result = updateProfileSchema.safeParse({
        firstName: longName,
        lastName: "Smith",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain("cannot exceed 50 characters");
      }
    });

    it("enforces phone length constraints when provided (7-20 chars)", () => {
      const shortPhone = updateProfileSchema.safeParse({
        firstName: "John",
        lastName: "Smith",
        phone: "12345", // < 7
      });
      expect(shortPhone.success).toBe(false);
      if (!shortPhone.success) {
        expect(shortPhone.error.issues[0]?.message).toContain("between 7 and 20 characters");
      }

      const longPhone = updateProfileSchema.safeParse({
        firstName: "John",
        lastName: "Smith",
        phone: "1".repeat(21), // > 20
      });
      expect(longPhone.success).toBe(false);
      if (!longPhone.success) {
        expect(longPhone.error.issues[0]?.message).toContain("between 7 and 20 characters");
      }
    });
  });

  describe("changePasswordSchema", () => {
    it("accepts valid current password and compliant new password", () => {
      const result = changePasswordSchema.safeParse({
        currentPassword: "OldP@ssword123",
        newPassword: "NewP@ssword456!",
        confirmPassword: "NewP@ssword456!",
      });
      expect(result.success).toBe(true);
    });

    it("rejects when current password is empty", () => {
      const result = changePasswordSchema.safeParse({
        currentPassword: "",
        newPassword: "NewP@ssword456!",
        confirmPassword: "NewP@ssword456!",
      });
      expect(result.success).toBe(false);
    });

    it("rejects when new password matches current password", () => {
      const result = changePasswordSchema.safeParse({
        currentPassword: "SameP@ssword123!",
        newPassword: "SameP@ssword123!",
        confirmPassword: "SameP@ssword123!",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.includes("newPassword"));
        expect(issue?.message).toContain("must be different from current password");
      }
    });

    it("rejects when confirmPassword does not match newPassword", () => {
      const result = changePasswordSchema.safeParse({
        currentPassword: "OldP@ssword123",
        newPassword: "NewP@ssword456!",
        confirmPassword: "DifferentP@ssword456!",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.includes("confirmPassword"));
        expect(issue?.message).toBe("New passwords do not match");
      }
    });
  });
});

