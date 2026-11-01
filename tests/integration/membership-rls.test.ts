import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// -----------------------------------------------------------------------------
// Environment validation
// -----------------------------------------------------------------------------
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!anonKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

describe("T035: Direct Client Membership Mutation Denial & RLS Policies (US3)", () => {
  let adminClient: SupabaseClient;

  // Real authenticated JWT clients
  let userAClient: SupabaseClient; // Owner of Org A
  let userBClient: SupabaseClient; // Cashier in Org A
  let userCClient: SupabaseClient; // Owner of Org B

  let userAId: string;
  let userBId: string;
  let userCId: string;

  const testPassword = "P@ssword123!SecureTest";
  const userAEmail = `mem_rls_a_${Date.now()}@bizflow-test.internal`;
  const userBEmail = `mem_rls_b_${Date.now()}@bizflow-test.internal`;
  const userCEmail = `mem_rls_c_${Date.now()}@bizflow-test.internal`;

  let orgAId: string;
  let orgBId: string;
  let membershipBId: string;

  beforeAll(async () => {
    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Create User A (Owner of Org A)
    const { data: uA, error: errA } = await adminClient.auth.admin.createUser({
      email: userAEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Mem", last_name: "Alpha" },
    });
    if (errA || !uA.user) throw new Error(`Failed to create User A: ${errA?.message}`);
    userAId = uA.user.id;

    // 2. Create User B (Cashier in Org A)
    const { data: uB, error: errB } = await adminClient.auth.admin.createUser({
      email: userBEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Mem", last_name: "Beta" },
    });
    if (errB || !uB.user) throw new Error(`Failed to create User B: ${errB?.message}`);
    userBId = uB.user.id;

    // 3. Create User C (Owner of Org B)
    const { data: uC, error: errC } = await adminClient.auth.admin.createUser({
      email: userCEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Mem", last_name: "Charlie" },
    });
    if (errC || !uC.user) throw new Error(`Failed to create User C: ${errC?.message}`);
    userCId = uC.user.id;

    // 4. Authenticate JWT clients
    userAClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await userAClient.auth.signInWithPassword({ email: userAEmail, password: testPassword });

    userBClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await userBClient.auth.signInWithPassword({ email: userBEmail, password: testPassword });

    userCClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await userCClient.auth.signInWithPassword({ email: userCEmail, password: testPassword });

    // 5. Seed Org A and Org B
    const { data: orgA } = await adminClient
      .from("organizations")
      .insert({
        name: "Membership Test Org A",
        slug: `mem-test-a-${Date.now()}`,
        business_type: "Retail",
        country: "US",
        currency: "USD",
        timezone: "UTC",
        created_by: userAId,
        is_active: true,
      })
      .select()
      .single();
    orgAId = orgA!.id;

    const { data: orgB } = await adminClient
      .from("organizations")
      .insert({
        name: "Membership Test Org B",
        slug: `mem-test-b-${Date.now()}`,
        business_type: "Retail",
        country: "GB",
        currency: "GBP",
        timezone: "UTC",
        created_by: userCId,
        is_active: true,
      })
      .select()
      .single();
    orgBId = orgB!.id;

    // 6. Seed Memberships
    await adminClient.from("organization_memberships").insert({
      organization_id: orgAId,
      user_id: userAId,
      role: "owner",
      status: "active",
    });

    const { data: memB } = await adminClient
      .from("organization_memberships")
      .insert({
        organization_id: orgAId,
        user_id: userBId,
        role: "cashier",
        status: "active",
      })
      .select()
      .single();
    membershipBId = memB!.id;

    await adminClient.from("organization_memberships").insert({
      organization_id: orgBId,
      user_id: userCId,
      role: "owner",
      status: "active",
    });
  });

  afterAll(async () => {
    try {
      await adminClient.from("organization_memberships").delete().in("organization_id", [orgAId, orgBId]);
    } catch (_) {}
    try {
      await adminClient.from("organizations").delete().in("id", [orgAId, orgBId]);
    } catch (_) {}
    for (const uid of [userAId, userBId, userCId]) {
      if (uid) {
        try {
          await adminClient.auth.admin.deleteUser(uid);
        } catch (_) {}
      }
    }
  });

  // ===========================================================================
  // 1. Direct Client INSERT Denial (memberships_insert_deny_direct)
  // ===========================================================================
  describe("Direct Client INSERT Denial", () => {
    it("User A (Owner) attempting direct INSERT into organization_memberships is denied by RLS (42501)", async () => {
      const { data, error } = await userAClient.from("organization_memberships").insert({
        organization_id: orgAId,
        user_id: userCId,
        role: "admin",
        status: "active",
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
    });

    it("User B (Cashier) attempting direct INSERT into organization_memberships is denied by RLS (42501)", async () => {
      const { data, error } = await userBClient.from("organization_memberships").insert({
        organization_id: orgAId,
        user_id: userCId,
        role: "cashier",
        status: "active",
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
    });
  });

  // ===========================================================================
  // 2. Direct Client UPDATE Denial (memberships_update_deny_direct)
  // ===========================================================================
  describe("Direct Client UPDATE Denial", () => {
    it("User A (Owner) attempting direct UPDATE on membership role/status is denied (modifies 0 rows / 42501)", async () => {
      const { data, error } = await userAClient
        .from("organization_memberships")
        .update({ role: "admin" })
        .eq("id", membershipBId)
        .select();

      // WITH CHECK (false) / USING (false) policy prevents modifications
      if (error) {
        expect(error.code).toBe("42501");
      } else {
        expect(data).toHaveLength(0);
      }

      // Verify User B's role remains unchanged
      const { data: check } = await adminClient
        .from("organization_memberships")
        .select("role")
        .eq("id", membershipBId)
        .single();
      expect(check?.role).toBe("cashier");
    });

    it("User B (Cashier) attempting privilege escalation (updating own role to owner) is denied", async () => {
      const { data, error } = await userBClient
        .from("organization_memberships")
        .update({ role: "owner" })
        .eq("id", membershipBId)
        .select();

      if (error) {
        expect(error.code).toBe("42501");
      } else {
        expect(data).toHaveLength(0);
      }

      // Verify User B is still cashier
      const { data: check } = await adminClient
        .from("organization_memberships")
        .select("role")
        .eq("id", membershipBId)
        .single();
      expect(check?.role).toBe("cashier");
    });
  });

  // ===========================================================================
  // 3. Direct Client DELETE Denial (memberships_delete_deny_direct)
  // ===========================================================================
  describe("Direct Client DELETE Denial", () => {
    it("User A (Owner) attempting direct DELETE on membership row is denied (deletes 0 rows / 42501)", async () => {
      const { data, error } = await userAClient
        .from("organization_memberships")
        .delete()
        .eq("id", membershipBId)
        .select();

      if (error) {
        expect(error.code).toBe("42501");
      } else {
        expect(data).toHaveLength(0);
      }

      // Verify membership still exists
      const { data: check } = await adminClient
        .from("organization_memberships")
        .select("id")
        .eq("id", membershipBId)
        .single();
      expect(check?.id).toBe(membershipBId);
    });

    it("User B (Cashier) attempting to delete own membership is denied", async () => {
      const { data, error } = await userBClient
        .from("organization_memberships")
        .delete()
        .eq("id", membershipBId)
        .select();

      if (error) {
        expect(error.code).toBe("42501");
      } else {
        expect(data).toHaveLength(0);
      }
    });
  });

  // ===========================================================================
  // 4. Membership SELECT Scopes (memberships_select_own & memberships_select_peers)
  // ===========================================================================
  describe("Membership SELECT Scopes", () => {
    it("User B can select own membership record (memberships_select_own)", async () => {
      const { data, error } = await userBClient
        .from("organization_memberships")
        .select("id, organization_id, user_id, role, status")
        .eq("user_id", userBId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      const row = data?.[0];
      expect(row?.id).toBe(membershipBId);
    });

    it("User B can see peers in Org A (memberships_select_peers)", async () => {
      const { data, error } = await userBClient
        .from("organization_memberships")
        .select("id, organization_id, user_id, role, status")
        .eq("organization_id", orgAId);

      expect(error).toBeNull();
      expect(data?.length).toBeGreaterThanOrEqual(2);
      const userIds = data?.map((m) => m.user_id);
      expect(userIds).toContain(userAId);
      expect(userIds).toContain(userBId);
    });

    it("User B CANNOT see memberships in Org B (returns 0 rows)", async () => {
      const { data, error } = await userBClient
        .from("organization_memberships")
        .select("id, organization_id, user_id")
        .eq("organization_id", orgBId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("Suspended member loses membership SELECT visibility in Org A (returns 0 rows)", async () => {
      // Suspend User B via adminClient
      await adminClient
        .from("organization_memberships")
        .update({ status: "suspended" })
        .eq("id", membershipBId);

      // Under Migration 06 policy (memberships_select_active_org), a suspended member
      // has no active organizations returned by get_user_organization_ids(), so
      // querying organization_memberships returns 0 rows!
      const { data, error } = await userBClient
        .from("organization_memberships")
        .select("id, user_id")
        .eq("organization_id", orgAId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });
  });
});

