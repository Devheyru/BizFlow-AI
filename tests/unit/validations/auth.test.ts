import { describe, it, expect } from "vitest";
import {
  signUpSchema,
  signInSchema,
  resendVerificationSchema,
  passwordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "@/lib/validations/auth";

describe("T014: Authentication Validation Schemas", () => {
  describe("passwordSchema Complexity Enforcement (FR-002)", () => {
    it("rejects passwords shorter than 8 characters", () => {
      const result = passwordSchema.safeParse("Aa1!xyz");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain("at least 8 characters");
      }
    });

    it("rejects passwords without an uppercase letter", () => {
      const result = passwordSchema.safeParse("password123!");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain("uppercase letter");
      }
    });

    it("rejects passwords without a lowercase letter", () => {
      const result = passwordSchema.safeParse("PASSWORD123!");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain("lowercase letter");
      }
    });

    it("rejects passwords without a number", () => {
      const result = passwordSchema.safeParse("Password!Test");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain("number");
      }
    });

    it("rejects passwords without a special character or symbol", () => {
      const result = passwordSchema.safeParse("Password1234");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain("special character");
      }
    });

    it("accepts strong, compliant passwords", () => {
      const compliantPasswords = [
        "P@ssword123",
        "BizFlow#2026",
        "Str0ng!Pass",
        "Retail$Store99",
      ];
      for (const pwd of compliantPasswords) {
        expect(passwordSchema.safeParse(pwd).success).toBe(true);
      }
    });
  });

  describe("signUpSchema (FR-001)", () => {
    const validSignUpData = {
      email: "RetailOwner@Example.com",
      password: "SecurePassword123!",
      firstName: "John",
      lastName: "Doe",
      phone: "+1234567890",
    };

    it("accepts valid registration data and lowercases/trims email", () => {
      const result = signUpSchema.safeParse({
        ...validSignUpData,
        email: "  RetailOwner@Example.COM  ",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe("retailowner@example.com");
        expect(result.data.firstName).toBe("John");
        expect(result.data.lastName).toBe("Doe");
      }
    });

    it("rejects invalid email formats", () => {
      const invalidEmails = ["not-an-email", "@example.com", "user@", "user@.com"];
      for (const email of invalidEmails) {
        const result = signUpSchema.safeParse({ ...validSignUpData, email });
        expect(result.success).toBe(false);
      }
    });

    it("requires firstName and lastName to be non-empty", () => {
      const emptyFirst = signUpSchema.safeParse({ ...validSignUpData, firstName: "" });
      expect(emptyFirst.success).toBe(false);

      const emptyLast = signUpSchema.safeParse({ ...validSignUpData, lastName: "" });
      expect(emptyLast.success).toBe(false);
    });

    it("accepts optional phone and optional invitationToken", () => {
      const withoutOptional = signUpSchema.safeParse({
        email: "test@example.com",
        password: "ValidPassword123!",
        firstName: "Alice",
        lastName: "Smith",
      });
      expect(withoutOptional.success).toBe(true);

      const withToken = signUpSchema.safeParse({
        email: "test@example.com",
        password: "ValidPassword123!",
        firstName: "Alice",
        lastName: "Smith",
        invitationToken: "inv_token_abc_123",
      });
      expect(withToken.success).toBe(true);
      if (withToken.success) {
        expect(withToken.data.invitationToken).toBe("inv_token_abc_123");
      }
    });
  });

  describe("signInSchema (FR-004)", () => {
    it("accepts valid sign-in input and transforms email", () => {
      const result = signInSchema.safeParse({
        email: "  USER@domain.COM ",
        password: "any-password",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe("user@domain.com");
      }
    });

    it("rejects empty email or password", () => {
      expect(signInSchema.safeParse({ email: "", password: "pwd" }).success).toBe(false);
      expect(signInSchema.safeParse({ email: "user@example.com", password: "" }).success).toBe(false);
    });
  });

  describe("resendVerificationSchema & Password Recovery Schemas", () => {
    it("validates resend verification email", () => {
      expect(resendVerificationSchema.safeParse({ email: "user@example.com" }).success).toBe(true);
      expect(resendVerificationSchema.safeParse({ email: "invalid" }).success).toBe(false);
    });

    it("validates forgotPasswordSchema", () => {
      expect(forgotPasswordSchema.safeParse({ email: "user@example.com" }).success).toBe(true);
      expect(forgotPasswordSchema.safeParse({ email: "invalid" }).success).toBe(false);
    });

    it("validates resetPasswordSchema using passwordSchema rules", () => {
      expect(resetPasswordSchema.safeParse({ newPassword: "Valid123!Password" }).success).toBe(true);
      expect(resetPasswordSchema.safeParse({ newPassword: "weak" }).success).toBe(false);
    });
  });
});

