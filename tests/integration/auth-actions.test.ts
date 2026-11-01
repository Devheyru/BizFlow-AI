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
  const createdOrgIds: string[] = [];
  const testPassword = "Password123!@#Test";

  beforeAll(() => {
    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  afterAll(async () => {
    for (const orgId of createdOrgIds) {
      await adminClient.from("organization_memberships").delete().eq("organization_id", orgId);
      await adminClient.from("organizations").delete().eq("id", orgId);
    }
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

    it("signs in verified user with active organization, sanitizing external redirect attempts", async () => {
      const email = `test_org_owner_${Date.now()}@example.com`;
      const { data: user } = await adminClient.auth.admin.createUser({
        email,
        password: testPassword,
        email_confirm: true,
      });
      if (!user?.user) throw new Error("Failed to create user");
      createdUserIds.push(user.user.id);

      // Seed an active organization and membership for this user
      const orgSlug = `test-org-${Date.now()}`;
      const { data: org, error: orgErr } = await adminClient
        .from("organizations")
        .insert({
          name: "Test Active Retail",
          slug: orgSlug,
          business_type: "Retail",
          country: "US",
          currency: "USD",
          timezone: "UTC",
          created_by: user.user.id,
          is_active: true,
        })
        .select()
        .single();
      expect(orgErr).toBeNull();
      if (org) createdOrgIds.push(org.id);

      const { error: memErr } = await adminClient.from("organization_memberships").insert({
        organization_id: org.id,
        user_id: user.user.id,
        role: "owner",
        status: "active",
      });
      expect(memErr).toBeNull();

      // Attempt sign-in with malicious external redirect target
      const result = await signInAction(
        { email, password: testPassword },
        "https://evil.com/phish"
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasActiveOrganization).toBe(true);
        expect(result.data.activeOrgSlug).toBe(orgSlug);
        // External redirect must be sanitized to default dashboard URL
        expect(result.data.redirectUrl).toBe(`/${orgSlug}/dashboard`);
      }

      // Safe relative redirect within workspace is honored
      const safeRelativeResult = await signInAction(
        { email, password: testPassword },
        `/${orgSlug}/inventory`
      );
      expect(safeRelativeResult.success).toBe(true);
      if (safeRelativeResult.success) {
        expect(safeRelativeResult.data.redirectUrl).toBe(`/${orgSlug}/inventory`);
      }
    });

    it("does not route to a closed organization and falls back to onboarding if user has no active orgs", async () => {
      const email = `test_closed_org_${Date.now()}@example.com`;
      const { data: user } = await adminClient.auth.admin.createUser({
        email,
        password: testPassword,
        email_confirm: true,
      });
      if (!user?.user) throw new Error("Failed to create user");
      createdUserIds.push(user.user.id);

      // Seed a closed (is_active = false) organization
      const closedOrgSlug = `closed-org-${Date.now()}`;
      const { data: org, error: orgErr } = await adminClient
        .from("organizations")
        .insert({
          name: "Closed Store",
          slug: closedOrgSlug,
          business_type: "Retail",
          country: "US",
          currency: "USD",
          timezone: "UTC",
          created_by: user.user.id,
          is_active: false,
          closed_at: new Date().toISOString(),
          closed_by: user.user.id,
        })
        .select()
        .single();
      expect(orgErr).toBeNull();
      if (org) createdOrgIds.push(org.id);

      await adminClient.from("organization_memberships").insert({
        organization_id: org.id,
        user_id: user.user.id,
        role: "owner",
        status: "active",
      });

      const result = await signInAction({
        email,
        password: testPassword,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        // Must NOT consider closed org as active
        expect(result.data.hasActiveOrganization).toBe(false);
        // Must route to onboarding
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
