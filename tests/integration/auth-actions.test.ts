import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  signUpAction,
  signInAction,
  signOutAction,
  resendVerificationAction,
} from "@/actions/auth-actions";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

describe("T017–T019: Authentication Server Actions Integration", () => {
  let adminClient: SupabaseClient;
  const createdUserIds: string[] = [];
  const testPassword = "Password123!@#Test";

  beforeAll(() => {
    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await adminClient.auth.admin.deleteUser(id).catch(() => {});
    }
  });

  describe("signUpAction (T017)", () => {
    it("returns validation error when password does not meet complexity rules", async () => {
      const result = await signUpAction({
        email: "test_weak_pwd@example.com",
        password: "weak",
        firstName: "Test",
        lastName: "User",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
        expect(result.error.details?.password).toBeDefined();
      }
    });

    it("registers a new user successfully and returns confirmation notice", async () => {
      const email = `test_signup_${Date.now()}@example.com`;
      const result = await signUpAction({
        email,
        password: testPassword,
        firstName: "ActionFirst",
        lastName: "ActionLast",
        phone: "+15559876543",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe(email);
        expect(result.data.message).toContain("check your email");
        if (result.data.userId) {
          createdUserIds.push(result.data.userId);
        }
      }
    });

    it("safely handles duplicate email registrations with generic notice (anti-enumeration)", async () => {
      const email = `test_duplicate_${Date.now()}@example.com`;

      // 1. Create first user
      const { data: user1 } = await adminClient.auth.admin.createUser({
        email,
        password: testPassword,
        email_confirm: true,
      });
      if (user1?.user) createdUserIds.push(user1.user.id);

      // 2. Attempt registration with the same email
      const result = await signUpAction({
        email,
        password: testPassword,
        firstName: "Another",
        lastName: "Person",
      });

      // Must return success with neutral confirmation message (not leaking that email exists)
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.message).toContain("check your inbox");
      }
    });
  });

  describe("signInAction (T018)", () => {
    it("rejects invalid credentials with generic message", async () => {
      const result = await signInAction({
        email: "nonexistent_user_xyz@example.com",
        password: "WrongPassword123!",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_CREDENTIALS");
        expect(result.error.message).toBe("Invalid email or password.");
      }
    });

    it("redirects unconfirmed user to /verify-email", async () => {
      const email = `test_unconfirmed_${Date.now()}@example.com`;
      const { data: user } = await adminClient.auth.admin.createUser({
        email,
        password: testPassword,
        email_confirm: false,
      });
      if (user?.user) createdUserIds.push(user.user.id);

      const result = await signInAction({
        email,
        password: testPassword,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isEmailVerified).toBe(false);
        expect(result.data.redirectUrl).toContain("/verify-email");
      }
    });

    it("signs in verified user with 0 organizations and redirects to /onboarding/create-organization", async () => {
      const email = `test_verified_zero_org_${Date.now()}@example.com`;
      const { data: user } = await adminClient.auth.admin.createUser({
        email,
        password: testPassword,
        email_confirm: true,
      });
      if (user?.user) createdUserIds.push(user.user.id);

      const result = await signInAction({
        email,
        password: testPassword,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isEmailVerified).toBe(true);
        expect(result.data.hasActiveOrganization).toBe(false);
        expect(result.data.redirectUrl).toBe("/onboarding/create-organization");
      }
    });
  });

  describe("signOutAction (T019)", () => {
    it("successfully clears session without errors", async () => {
      const result = await signOutAction();
      expect(result.success).toBe(true);
    });
  });

  describe("resendVerificationAction", () => {
    it("returns neutral success message for resending verification", async () => {
      const result = await resendVerificationAction({
        email: "any_email@example.com",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.message).toContain("check your inbox");
      }
    });
  });
});

