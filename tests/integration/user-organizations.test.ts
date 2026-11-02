import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!anonKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

describe("T042: Multi-Organization User Context & get_user_organization_ids() (US4)", () => {
  let adminClient: SupabaseClient;
  let anonClient: SupabaseClient;

  // Real authenticated JWT clients
  let userAClient: SupabaseClient; // Multi-org user
  let userBClient: SupabaseClient; // Single-org user

  let userAId: string;
  let userBId: string;

  const testPassword = "P@ssword123!SecureTest";
  const userAEmail = `multiorg_a_${Date.now()}@bizflow-test.internal`;
  const userBEmail = `multiorg_b_${Date.now()}@bizflow-test.internal`;

  let orgA1Id: string; // Active org, User A is Owner
  let orgA2Id: string; // Active org, User A is Manager
  let orgA3Id: string; // Active org, User A is Suspended
  let orgA4Id: string; // Inactive/Closed org, User A is Owner
  let orgB1Id: string; // Active org, User B is Owner

  beforeAll(async () => {
    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    anonClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Create Verified User A (Multi-org user)
    const { data: uA, error: errA } = await adminClient.auth.admin.createUser({
      email: userAEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Multi", last_name: "Alpha" },
    });
    if (errA || !uA.user) throw new Error(`Failed to create User A: ${errA?.message}`);
    userAId = uA.user.id;

    // 2. Create Verified User B (Single-org user)
    const { data: uB, error: errB } = await adminClient.auth.admin.createUser({
      email: userBEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Single", last_name: "Beta" },
    });
    if (errB || !uB.user) throw new Error(`Failed to create User B: ${errB?.message}`);
    userBId = uB.user.id;

    // 3. Create Organizations
    // Org A1: Active, owned by User A
    const { data: oA1, error: errOA1 } = await adminClient
      .from("organizations")
      .insert({
        name: "Alpha Store 1 (Owner)",
        slug: `alpha-store-1-${Date.now()}`,
        business_type: "Retail Store",
        country: "US",
        currency: "USD",
        timezone: "America/New_York",
        is_active: true,
        created_by: userAId,
      })
      .select()
      .single();
    if (errOA1 || !oA1) throw new Error(`Failed to create Org A1: ${errOA1?.message}`);
    orgA1Id = oA1.id;

    // Org A2: Active, User A is Manager
    const { data: oA2, error: errOA2 } = await adminClient
      .from("organizations")
      .insert({
        name: "Alpha Store 2 (Manager)",
        slug: `alpha-store-2-${Date.now()}`,
        business_type: "Supermarket",
        country: "US",
        currency: "USD",
        timezone: "America/New_York",
        is_active: true,
        created_by: userAId,
      })
      .select()
      .single();
    if (errOA2 || !oA2) throw new Error(`Failed to create Org A2: ${errOA2?.message}`);
    orgA2Id = oA2.id;

    // Org A3: Active, User A is Suspended
    const { data: oA3, error: errOA3 } = await adminClient
      .from("organizations")
      .insert({
        name: "Alpha Store 3 (Suspended)",
        slug: `alpha-store-3-${Date.now()}`,
        business_type: "Hardware",
        country: "US",
        currency: "USD",
        timezone: "America/New_York",
        is_active: true,
        created_by: userAId,
      })
      .select()
      .single();
    if (errOA3 || !oA3) throw new Error(`Failed to create Org A3: ${errOA3?.message}`);
    orgA3Id = oA3.id;

    // Org A4: Inactive / Closed
    const { data: oA4, error: errOA4 } = await adminClient
      .from("organizations")
      .insert({
        name: "Alpha Store 4 (Closed)",
        slug: `alpha-store-4-${Date.now()}`,
        business_type: "Bakery",
        country: "US",
        currency: "USD",
        timezone: "America/New_York",
        is_active: false,
        created_by: userAId,
        closed_at: new Date().toISOString(),
        closed_by: userAId,
      })
      .select()
      .single();
    if (errOA4 || !oA4) throw new Error(`Failed to create Org A4: ${errOA4?.message}`);
    orgA4Id = oA4.id;

    // Org B1: Active, owned by User B
    const { data: oB1, error: errOB1 } = await adminClient
      .from("organizations")
      .insert({
        name: "Beta Store 1 (Owner)",
        slug: `beta-store-1-${Date.now()}`,
        business_type: "Bookstore",
        country: "US",
        currency: "USD",
        timezone: "America/Chicago",
        is_active: true,
        created_by: userBId,
      })
      .select()
      .single();
    if (errOB1 || !oB1) throw new Error(`Failed to create Org B1: ${errOB1?.message}`);
    orgB1Id = oB1.id;

    // 4. Seed Memberships with strict verification
    const { data: mems, error: memErr } = await adminClient
      .from("organization_memberships")
      .insert([
        {
          organization_id: orgA1Id,
          user_id: userAId,
          role: "owner",
          status: "active",
        },
        {
          organization_id: orgA2Id,
          user_id: userAId,
          role: "manager",
          status: "active",
        },
        {
          organization_id: orgA3Id,
          user_id: userAId,
          role: "cashier",
          status: "suspended",
        },
        {
          organization_id: orgA4Id,
          user_id: userAId,
          role: "owner",
          status: "active",
        },
        {
          organization_id: orgB1Id,
          user_id: userBId,
          role: "owner",
          status: "active",
        },
      ])
      .select();
    if (memErr || !mems || mems.length !== 5) {
      throw new Error(`Failed to seed memberships: ${memErr?.message || "Incomplete insertion"}`);
    }

    // 5. Establish Authenticated JWT Sessions
    userAClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signErrA } = await userAClient.auth.signInWithPassword({
      email: userAEmail,
      password: testPassword,
    });
    if (signErrA) throw new Error(`Failed to sign in User A: ${signErrA.message}`);

    userBClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signErrB } = await userBClient.auth.signInWithPassword({
      email: userBEmail,
      password: testPassword,
    });
    if (signErrB) throw new Error(`Failed to sign in User B: ${signErrB.message}`);
  });

  afterAll(async () => {
    // Clean up created entities with error logging and status verification
    if (adminClient) {
      const orgIdsToDelete = [orgA1Id, orgA2Id, orgA3Id, orgA4Id, orgB1Id].filter(Boolean);
      if (orgIdsToDelete.length > 0) {
        try {
          await adminClient
            .from("organization_memberships")
            .update({ status: "revoked" })
            .in("organization_id", orgIdsToDelete);
          await adminClient
            .from("organization_memberships")
            .delete()
            .in("organization_id", orgIdsToDelete);
        } catch (_) {}

        const { error: delOrgErr } = await adminClient
          .from("organizations")
          .delete()
          .in("id", orgIdsToDelete);
        if (delOrgErr) {
          console.error("[user-organizations teardown] Error deleting orgs:", delOrgErr);
        }
      }

      if (userAId) {
        const { error: delUserAErr } = await adminClient.auth.admin.deleteUser(userAId);
        if (delUserAErr) {
          console.error("[user-organizations teardown] Error deleting User A:", delUserAErr);
        }
      }
      if (userBId) {
        const { error: delUserBErr } = await adminClient.auth.admin.deleteUser(userBId);
        if (delUserBErr) {
          console.error("[user-organizations teardown] Error deleting User B:", delUserBErr);
        }
      }
    }
  });

  describe("get_user_organization_ids() RPC", () => {
    it("returns all active tenant IDs where User A has an active membership", async () => {
      const { data, error } = await userAClient.rpc("get_user_organization_ids");

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);

      const returnedIds = (data as string[]) || [];
      expect(returnedIds).toContain(orgA1Id);
      expect(returnedIds).toContain(orgA2Id);
      expect(returnedIds.length).toBe(2);
    });

    it("excludes organizations where User A has a suspended membership", async () => {
      const { data, error } = await userAClient.rpc("get_user_organization_ids");

      expect(error).toBeNull();
      const returnedIds = (data as string[]) || [];
      expect(returnedIds).not.toContain(orgA3Id);
    });

    it("excludes organizations that are closed/inactive even if User A has active membership", async () => {
      const { data, error } = await userAClient.rpc("get_user_organization_ids");

      expect(error).toBeNull();
      const returnedIds = (data as string[]) || [];
      expect(returnedIds).not.toContain(orgA4Id);
    });

    it("returns only User B's active organizations when executed in User B's JWT context", async () => {
      const { data, error } = await userBClient.rpc("get_user_organization_ids");

      expect(error).toBeNull();
      const returnedIds = (data as string[]) || [];
      expect(returnedIds).toEqual([orgB1Id]);
      expect(returnedIds).not.toContain(orgA1Id);
      expect(returnedIds).not.toContain(orgA2Id);
    });

    it("denies unauthenticated execution of get_user_organization_ids()", async () => {
      const { data, error } = await anonClient.rpc("get_user_organization_ids");
      // Because anon is not authenticated, RPC should return error or empty set
      if (error) {
        expect(error.message).toBeDefined();
      } else {
        expect(data).toEqual([]);
      }
    });
  });

  describe("is_org_member() helper under multi-org context", () => {
    it("returns true for User A in Org A1 (owner)", async () => {
      const { data, error } = await userAClient.rpc("is_org_member", {
        p_org_id: orgA1Id,
      });
      expect(error).toBeNull();
      expect(data).toBe(true);
    });

    it("returns true for User A in Org A2 (manager)", async () => {
      const { data, error } = await userAClient.rpc("is_org_member", {
        p_org_id: orgA2Id,
      });
      expect(error).toBeNull();
      expect(data).toBe(true);
    });

    it("validates specific role matches for is_org_member", async () => {
      // Check User A is owner of Org A1
      const { data: isOwner } = await userAClient.rpc("is_org_member", {
        p_org_id: orgA1Id,
        p_roles: ["owner"],
      });
      expect(isOwner).toBe(true);

      // Check User A is not owner of Org A2 (manager)
      const { data: isOwnerOfA2 } = await userAClient.rpc("is_org_member", {
        p_org_id: orgA2Id,
        p_roles: ["owner"],
      });
      expect(isOwnerOfA2).toBe(false);

      // Check User A is manager of Org A2
      const { data: isManagerOfA2 } = await userAClient.rpc("is_org_member", {
        p_org_id: orgA2Id,
        p_roles: ["manager"],
      });
      expect(isManagerOfA2).toBe(true);
    });

    it("returns false for suspended organization membership", async () => {
      const { data, error } = await userAClient.rpc("is_org_member", {
        p_org_id: orgA3Id,
      });
      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it("returns false for closed organization", async () => {
      const { data, error } = await userAClient.rpc("is_org_member", {
        p_org_id: orgA4Id,
      });
      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it("returns false for organizations where the user has no membership", async () => {
      const { data, error } = await userAClient.rpc("is_org_member", {
        p_org_id: orgB1Id,
      });
      expect(error).toBeNull();
      expect(data).toBe(false);
    });
  });

  describe("Row-Level Security on organizations table for multi-org user", () => {
    it("allows User A to select exactly their active organizations (Org A1 and Org A2)", async () => {
      const { data, error } = await userAClient
        .from("organizations")
        .select("id, name, is_active");

      expect(error).toBeNull();
      expect(data).toBeDefined();

      const ids = data?.map((o) => o.id) || [];
      expect(ids).toContain(orgA1Id);
      expect(ids).toContain(orgA2Id);
      expect(ids).not.toContain(orgA3Id);
      expect(ids).not.toContain(orgA4Id);
      expect(ids).not.toContain(orgB1Id);
    });

    it("allows User B to select only their active organization (Org B1)", async () => {
      const { data, error } = await userBClient
        .from("organizations")
        .select("id, name, is_active");

      expect(error).toBeNull();
      expect(data).toBeDefined();

      const ids = data?.map((o) => o.id) || [];
      expect(ids).toEqual([orgB1Id]);
      expect(ids).not.toContain(orgA1Id);
      expect(ids).not.toContain(orgA2Id);
    });
  });
});

