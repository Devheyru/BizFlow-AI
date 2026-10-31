import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Use environment variables loaded from .env.local
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

describe("Phase 2 Stage A: Foundational Schema, Triggers, Helpers, and RLS", () => {
  let adminClient: SupabaseClient;
  let userAClient: SupabaseClient;
  let userBClient: SupabaseClient;

  let userAId: string;
  let userBId: string;
  const userAEmail = `test_user_a_${Date.now()}@example.com`;
  const userBEmail = `test_user_b_${Date.now()}@example.com`;
  const testPassword = "Password123!@#Test";

  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    // Admin client (service-role) is ONLY used for test fixture setup & teardown
    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Create User A (verified)
    const { data: userAData, error: userAError } = await adminClient.auth.admin.createUser({
      email: userAEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Alpha", last_name: "Owner" },
    });
    if (userAError || !userAData.user) {
      throw new Error(`Failed to create test User A: ${userAError?.message}`);
    }
    userAId = userAData.user.id;

    // 2. Create User B (verified)
    const { data: userBData, error: userBError } = await adminClient.auth.admin.createUser({
      email: userBEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Beta", last_name: "Owner" },
    });
    if (userBError || !userBData.user) {
      throw new Error(`Failed to create test User B: ${userBError?.message}`);
    }
    userBId = userBData.user.id;

    // 3. Authenticate User A client
    userAClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInAError } = await userAClient.auth.signInWithPassword({
      email: userAEmail,
      password: testPassword,
    });
    if (signInAError) throw new Error(`User A sign-in failed: ${signInAError.message}`);

    // 4. Authenticate User B client
    userBClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInBError } = await userBClient.auth.signInWithPassword({
      email: userBEmail,
      password: testPassword,
    });
    if (signInBError) throw new Error(`User B sign-in failed: ${signInBError.message}`);

    // 5. Seed Org A and Org B fixtures using admin client
    const { data: orgA, error: orgAErr } = await adminClient
      .from("organizations")
      .insert({
        name: "Alpha Retail",
        slug: `alpha-retail-${Date.now()}`,
        business_type: "Retail Store",
        country: "US",
        currency: "USD",
        timezone: "America/New_York",
        created_by: userAId,
      })
      .select()
      .single();
    if (orgAErr || !orgA) throw new Error(`Failed to insert Org A: ${orgAErr?.message}`);
    orgAId = orgA.id;

    const { data: orgB, error: orgBErr } = await adminClient
      .from("organizations")
      .insert({
        name: "Beta Boutique",
        slug: `beta-boutique-${Date.now()}`,
        business_type: "Apparel Store",
        country: "GB",
        currency: "GBP",
        timezone: "Europe/London",
        created_by: userBId,
      })
      .select()
      .single();
    if (orgBErr || !orgB) throw new Error(`Failed to insert Org B: ${orgBErr?.message}`);
    orgBId = orgB.id;

    // Add User A as owner of Org A
    const { error: memAErr } = await adminClient.from("organization_memberships").insert({
      organization_id: orgAId,
      user_id: userAId,
      role: "owner",
      status: "active",
    });
    if (memAErr) throw new Error(`Failed to insert User A membership: ${memAErr.message}`);

    // Add User B as owner of Org B
    const { error: memBErr } = await adminClient.from("organization_memberships").insert({
      organization_id: orgBId,
      user_id: userBId,
      role: "owner",
      status: "active",
    });
    if (memBErr) throw new Error(`Failed to insert User B membership: ${memBErr.message}`);
  });

  afterAll(async () => {
    // Teardown test fixtures
    if (orgAId) await adminClient.from("organizations").delete().eq("id", orgAId);
    if (orgBId) await adminClient.from("organizations").delete().eq("id", orgBId);
    if (userAId) await adminClient.auth.admin.deleteUser(userAId);
    if (userBId) await adminClient.auth.admin.deleteUser(userBId);
  });

  describe("T008: Profile Trigger (handle_new_user)", () => {
    it("automatically creates a public.profiles record upon auth.users creation", async () => {
      const { data: profile, error } = await adminClient
        .from("profiles")
        .select("*")
        .eq("id", userAId)
        .single();

      expect(error).toBeNull();
      expect(profile).not.toBeNull();
      expect(profile.id).toBe(userAId);
      expect(profile.first_name).toBe("Alpha");
      expect(profile.last_name).toBe("Owner");
    });
  });

  describe("T009: Security Helper Functions", () => {
    it("is_email_verified returns true for verified user", async () => {
      const { data, error } = await userAClient.rpc("is_email_verified");
      expect(error).toBeNull();
      expect(data).toBe(true);
    });

    it("get_user_organization_ids returns only organizations where user is an active member", async () => {
      const { data, error } = await userAClient.rpc("get_user_organization_ids");
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toContain(orgAId);
      expect(data).not.toContain(orgBId);
    });

    it("is_org_member returns true for owned org and false for unassociated org", async () => {
      const { data: isMemberA, error: errA } = await userAClient.rpc("is_org_member", {
        p_org_id: orgAId,
      });
      expect(errA).toBeNull();
      expect(isMemberA).toBe(true);

      const { data: isMemberB, error: errB } = await userAClient.rpc("is_org_member", {
        p_org_id: orgBId,
      });
      expect(errB).toBeNull();
      expect(isMemberB).toBe(false);
    });
  });

  describe("T010: Row-Level Security Policies", () => {
    it("allows a user to read their own profile but not another user's profile", async () => {
      // User A reads own profile
      const { data: ownProfile, error: ownErr } = await userAClient
        .from("profiles")
        .select("*")
        .eq("id", userAId)
        .single();
      expect(ownErr).toBeNull();
      expect(ownProfile.id).toBe(userAId);

      // User A attempts to read User B's profile (RLS filters out)
      const { data: otherProfile } = await userAClient
        .from("profiles")
        .select("*")
        .eq("id", userBId);
      expect(otherProfile).toEqual([]);
    });

    it("allows a user to update their own profile first_name and last_name", async () => {
      const { data, error } = await userAClient
        .from("profiles")
        .update({ first_name: "AlphaUpdated" })
        .eq("id", userAId)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data.first_name).toBe("AlphaUpdated");
    });

    it("prevents direct client INSERT into public.profiles (WITH CHECK false)", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const { error } = await userAClient.from("profiles").insert({
        id: fakeId,
        first_name: "Hacker",
        last_name: "Bad",
      });
      expect(error).not.toBeNull();
    });

    it("enforces tenant isolation on organizations: User A cannot read Org B", async () => {
      // User A can read Org A
      const { data: orgAData, error: orgAErr } = await userAClient
        .from("organizations")
        .select("*")
        .eq("id", orgAId);
      expect(orgAErr).toBeNull();
      expect(orgAData?.length).toBe(1);
      expect(orgAData?.[0].id).toBe(orgAId);

      // User A attempts to read Org B (RLS filters out)
      const { data: orgBData } = await userAClient
        .from("organizations")
        .select("*")
        .eq("id", orgBId);
      expect(orgBData).toEqual([]);
    });

    it("enforces tenant isolation on organization_memberships: User A cannot read Org B members", async () => {
      // User A can read Org A memberships
      const { data: memAData, error: memAErr } = await userAClient
        .from("organization_memberships")
        .select("*")
        .eq("organization_id", orgAId);
      expect(memAErr).toBeNull();
      expect(memAData?.length).toBe(1);
      expect(memAData?.[0].user_id).toBe(userAId);

      // User A attempts to read Org B memberships (RLS filters out)
      const { data: memBData } = await userAClient
        .from("organization_memberships")
        .select("*")
        .eq("organization_id", orgBId);
      expect(memBData).toEqual([]);
    });

    it("denies direct client mutations (INSERT/UPDATE/DELETE) on organization_memberships", async () => {
      // 1. Attempt direct client INSERT (fails WITH CHECK false)
      const { error: insertErr } = await userAClient.from("organization_memberships").insert({
        organization_id: orgAId,
        user_id: userBId,
        role: "admin",
        status: "active",
      });
      expect(insertErr).not.toBeNull();

      // 2. Attempt direct client UPDATE (RLS USING false blocks any rows from updating)
      const { data: updateData } = await userAClient
        .from("organization_memberships")
        .update({ role: "cashier" })
        .eq("organization_id", orgAId)
        .eq("user_id", userAId)
        .select();
      expect(updateData).toEqual([]);

      // Verify that database row was NOT modified
      const { data: checkMem } = await adminClient
        .from("organization_memberships")
        .select("role")
        .eq("organization_id", orgAId)
        .eq("user_id", userAId)
        .single();
      expect(checkMem?.role).toBe("owner");

      // 3. Attempt direct client DELETE (RLS USING false blocks any rows from deleting)
      const { data: deleteData } = await userAClient
        .from("organization_memberships")
        .delete()
        .eq("organization_id", orgAId)
        .eq("user_id", userAId)
        .select();
      expect(deleteData).toEqual([]);

      // Verify that row still exists
      const { data: checkStillExists } = await adminClient
        .from("organization_memberships")
        .select("id")
        .eq("organization_id", orgAId)
        .eq("user_id", userAId)
        .single();
      expect(checkStillExists).not.toBeNull();
    });

    it("denies direct client INSERT into organization_audit_events", async () => {
      const { error } = await userAClient.from("organization_audit_events").insert({
        organization_id: orgAId,
        actor_id: userAId,
        event_type: "fake.event",
        payload: {},
      });
      expect(error).not.toBeNull();
    });
  });
});
