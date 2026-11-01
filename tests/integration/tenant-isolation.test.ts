import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";

// -----------------------------------------------------------------------------
// Environment validation
// -----------------------------------------------------------------------------
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!anonKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

describe("T034: Tenant Data Isolation under FORCE RLS (US3)", () => {
  let adminClient: SupabaseClient;

  // Real authenticated JWT clients (never service-role for assertions!)
  let userAClient: SupabaseClient; // Owner of Org A
  let userBClient: SupabaseClient; // Owner of Org B
  let userCClient: SupabaseClient; // Cashier in Org A (Active -> Suspended -> Revoked)
  let userUnverifiedClient: SupabaseClient; // Authenticated user with unverified email
  let anonClient: SupabaseClient; // Anonymous unauthenticated visitor

  let userAId: string;
  let userBId: string;
  let userCId: string;
  let userUnverifiedId: string;

  const testPassword = "P@ssword123!SecureTest";
  const userAEmail = `tenant_a_${Date.now()}@bizflow-test.internal`;
  const userBEmail = `tenant_b_${Date.now()}@bizflow-test.internal`;
  const userCEmail = `tenant_c_${Date.now()}@bizflow-test.internal`;
  const userUnverifiedEmail = `tenant_unv_${Date.now()}@bizflow-test.internal`;

  let orgAId: string;
  let orgBId: string;
  const orgASlug = `org-a-tenant-${Date.now()}`;
  const orgBSlug = `org-b-tenant-${Date.now()}`;

  let membershipCId: string;

  beforeAll(async () => {
    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    anonClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Create Verified User A
    const { data: uA, error: errA } = await adminClient.auth.admin.createUser({
      email: userAEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Tenant", last_name: "Alpha" },
    });
    if (errA || !uA.user) throw new Error(`Failed to create User A: ${errA?.message}`);
    userAId = uA.user.id;

    // 2. Create Verified User B
    const { data: uB, error: errB } = await adminClient.auth.admin.createUser({
      email: userBEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Tenant", last_name: "Beta" },
    });
    if (errB || !uB.user) throw new Error(`Failed to create User B: ${errB?.message}`);
    userBId = uB.user.id;

    // 3. Create Verified User C
    const { data: uC, error: errC } = await adminClient.auth.admin.createUser({
      email: userCEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Tenant", last_name: "Charlie" },
    });
    if (errC || !uC.user) throw new Error(`Failed to create User C: ${errC?.message}`);
    userCId = uC.user.id;

    // 4. Create Unverified User (initial confirm true to sign in, then clear in db)
    const { data: uUnv, error: errUnv } = await adminClient.auth.admin.createUser({
      email: userUnverifiedEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Tenant", last_name: "Unverified" },
    });
    if (errUnv || !uUnv.user) throw new Error(`Failed to create Unverified User: ${errUnv?.message}`);
    userUnverifiedId = uUnv.user.id;

    // 5. Authenticate clients with real JWT sessions
    userAClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signAErr } = await userAClient.auth.signInWithPassword({
      email: userAEmail,
      password: testPassword,
    });
    if (signAErr) throw new Error(`User A sign-in failed: ${signAErr.message}`);

    userBClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signBErr } = await userBClient.auth.signInWithPassword({
      email: userBEmail,
      password: testPassword,
    });
    if (signBErr) throw new Error(`User B sign-in failed: ${signBErr.message}`);

    userCClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signCErr } = await userCClient.auth.signInWithPassword({
      email: userCEmail,
      password: testPassword,
    });
    if (signCErr) throw new Error(`User C sign-in failed: ${signCErr.message}`);

    userUnverifiedClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signUnvErr } = await userUnverifiedClient.auth.signInWithPassword({
      email: userUnverifiedEmail,
      password: testPassword,
    });
    if (signUnvErr) throw new Error(`Unverified User sign-in failed: ${signUnvErr.message}`);

    // Clear email_confirmed_at in auth.users so user is genuinely unconfirmed
    const pgSetup = new PgClient({ connectionString: dbUrl });
    await pgSetup.connect();
    try {
      await pgSetup.query("UPDATE auth.users SET email_confirmed_at = NULL WHERE id = $1;", [userUnverifiedId]);
    } finally {
      await pgSetup.end();
    }

    // 6. Seed Org A and Org B fixtures
    const { data: orgA, error: orgAErr } = await adminClient
      .from("organizations")
      .insert({
        name: "Alpha Retail Store",
        slug: orgASlug,
        business_type: "Retail Store",
        country: "US",
        currency: "USD",
        timezone: "America/New_York",
        created_by: userAId,
        is_active: true,
      })
      .select()
      .single();
    if (orgAErr || !orgA) throw new Error(`Failed to insert Org A: ${orgAErr?.message}`);
    orgAId = orgA.id;

    const { data: orgB, error: orgBErr } = await adminClient
      .from("organizations")
      .insert({
        name: "Beta Boutique Store",
        slug: orgBSlug,
        business_type: "Fashion Boutique",
        country: "GB",
        currency: "GBP",
        timezone: "Europe/London",
        created_by: userBId,
        is_active: true,
      })
      .select()
      .single();
    if (orgBErr || !orgB) throw new Error(`Failed to insert Org B: ${orgBErr?.message}`);
    orgBId = orgB.id;

    // Seed Owner membership for User A in Org A
    const { error: memAErr } = await adminClient.from("organization_memberships").insert({
      organization_id: orgAId,
      user_id: userAId,
      role: "owner",
      status: "active",
    });
    if (memAErr) throw new Error(`Failed to insert User A membership: ${memAErr.message}`);

    // Seed Cashier membership for User C in Org A
    const { data: memC, error: memCErr } = await adminClient
      .from("organization_memberships")
      .insert({
        organization_id: orgAId,
        user_id: userCId,
        role: "cashier",
        status: "active",
      })
      .select()
      .single();
    if (memCErr || !memC) throw new Error(`Failed to insert User C membership: ${memCErr?.message}`);
    membershipCId = memC.id;

    // Seed Owner membership for User B in Org B
    const { error: memBErr } = await adminClient.from("organization_memberships").insert({
      organization_id: orgBId,
      user_id: userBId,
      role: "owner",
      status: "active",
    });
    if (memBErr) throw new Error(`Failed to insert User B membership: ${memBErr.message}`);

    // Seed audit event in Org A
    await adminClient.from("organization_audit_events").insert({
      organization_id: orgAId,
      actor_id: userAId,
      event_type: "test_event_a",
      metadata: { note: "Org A confidential audit" },
    });

    // Seed audit event in Org B
    await adminClient.from("organization_audit_events").insert({
      organization_id: orgBId,
      actor_id: userBId,
      event_type: "test_event_b",
      metadata: { note: "Org B confidential audit" },
    });
  });

  afterAll(async () => {
    // 1. Delete audit events first
    try {
      await adminClient.from("organization_audit_events").delete().in("organization_id", [orgAId, orgBId]);
    } catch (_) {}

    // 2. Delete memberships
    try {
      await adminClient.from("organization_memberships").delete().in("organization_id", [orgAId, orgBId]);
    } catch (_) {}

    // 3. Delete organizations
    try {
      await adminClient.from("organizations").delete().in("id", [orgAId, orgBId]);
    } catch (_) {}

    // 4. Delete test users
    for (const uid of [userAId, userBId, userCId, userUnverifiedId]) {
      if (uid) {
        try {
          await adminClient.auth.admin.deleteUser(uid);
        } catch (_) {}
      }
    }
  });

  // ===========================================================================
  // 1. Cross-Tenant SELECT Isolation
  // ===========================================================================
  describe("Cross-Tenant SELECT Isolation (organizations)", () => {
    it("User A can select Org A records with full metadata", async () => {
      const { data, error } = await userAClient
        .from("organizations")
        .select("id, name, slug, currency, timezone, is_active")
        .eq("id", orgAId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      const row = data?.[0];
      expect(row?.id).toBe(orgAId);
      expect(row?.name).toBe("Alpha Retail Store");
    });

    it("User A CANNOT select Org B records by ID (returns 0 rows under RLS)", async () => {
      const { data, error } = await userAClient
        .from("organizations")
        .select("id, name, slug")
        .eq("id", orgBId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("User A CANNOT select Org B records by manipulated URL slug (returns 0 rows)", async () => {
      const { data, error } = await userAClient
        .from("organizations")
        .select("id, name, slug")
        .eq("slug", orgBSlug);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("User B can select Org B, but CANNOT select Org A (returns 0 rows)", async () => {
      // User B selects Org B
      const { data: dataB, error: errB } = await userBClient
        .from("organizations")
        .select("id, name, slug")
        .eq("id", orgBId);
      expect(errB).toBeNull();
      expect(dataB).toHaveLength(1);

      // User B attempts to query Org A
      const { data: dataA, error: errA } = await userBClient
        .from("organizations")
        .select("id, name, slug")
        .eq("id", orgAId);
      expect(errA).toBeNull();
      expect(dataA).toHaveLength(0);
    });

    it("Anonymous visitor CANNOT select any organization records (returns 0 rows)", async () => {
      const { data, error } = await anonClient
        .from("organizations")
        .select("id, name, slug")
        .in("id", [orgAId, orgBId]);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });
  });

  // ===========================================================================
  // 2. Cross-Tenant Membership & Audit Event Isolation
  // ===========================================================================
  describe("Cross-Tenant Membership & Audit Event Isolation", () => {
    it("User A can select memberships belonging to Org A (own & peers)", async () => {
      const { data, error } = await userAClient
        .from("organization_memberships")
        .select("id, organization_id, user_id, role, status")
        .eq("organization_id", orgAId);

      expect(error).toBeNull();
      expect(data?.length).toBeGreaterThanOrEqual(2); // User A and User C
      const userIds = data?.map((m) => m.user_id);
      expect(userIds).toContain(userAId);
      expect(userIds).toContain(userCId);
    });

    it("User A CANNOT select memberships belonging to Org B (returns 0 rows)", async () => {
      const { data, error } = await userAClient
        .from("organization_memberships")
        .select("id, organization_id, user_id, role, status")
        .eq("organization_id", orgBId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("User A can view audit events for Org A, but CANNOT view Org B audit events", async () => {
      // Org A audit events
      const { data: eventsA, error: errA } = await userAClient
        .from("organization_audit_events")
        .select("id, organization_id, event_type, metadata")
        .eq("organization_id", orgAId);

      expect(errA).toBeNull();
      expect(eventsA).toHaveLength(1);
      const ev = eventsA?.[0];
      expect(ev?.event_type).toBe("test_event_a");

      // Org B audit events
      const { data: eventsB, error: errB } = await userAClient
        .from("organization_audit_events")
        .select("id, organization_id, event_type, metadata")
        .eq("organization_id", orgBId);

      expect(errB).toBeNull();
      expect(eventsB).toHaveLength(0);
    });

    it("User B CANNOT view Org A audit events (returns 0 rows)", async () => {
      const { data, error } = await userBClient
        .from("organization_audit_events")
        .select("id, organization_id, event_type")
        .eq("organization_id", orgAId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });
  });

  // ===========================================================================
  // 3. Cross-Tenant Mutation Denial (UPDATE & DELETE)
  // ===========================================================================
  describe("Cross-Tenant Mutation Denial (UPDATE, DELETE, direct INSERT)", () => {
    it("User A CANNOT update Org B records (modifies 0 rows)", async () => {
      const { data, error } = await userAClient
        .from("organizations")
        .update({ name: "Hacked Beta Boutique" })
        .eq("id", orgBId)
        .select();

      expect(error).toBeNull();
      expect(data).toHaveLength(0);

      // Verify Org B name remains unmodified
      const { data: check } = await adminClient.from("organizations").select("name").eq("id", orgBId).single();
      expect(check?.name).toBe("Beta Boutique Store");
    });

    it("User A CANNOT delete Org B records (deletes 0 rows)", async () => {
      const { data, error } = await userAClient
        .from("organizations")
        .delete()
        .eq("id", orgBId)
        .select();

      expect(error).toBeNull();
      expect(data).toHaveLength(0);

      // Verify Org B still exists
      const { data: check } = await adminClient.from("organizations").select("id").eq("id", orgBId).single();
      expect(check?.id).toBe(orgBId);
    });

    it("User A CANNOT insert direct audit events into Org B (denied by RLS)", async () => {
      const { error } = await userAClient.from("organization_audit_events").insert({
        organization_id: orgBId,
        actor_id: userAId,
        event_type: "forged_event",
        metadata: { forged: true },
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
    });
  });

  // ===========================================================================
  // 4. Security Helpers Multi-Tenant Boundary
  // ===========================================================================
  describe("Security Helpers Multi-Tenant Enforcement", () => {
    it("get_user_organization_ids() returns exclusively caller's active orgs", async () => {
      const { data: orgIdsA, error: errA } = await userAClient.rpc("get_user_organization_ids");
      expect(errA).toBeNull();
      expect(orgIdsA).toContain(orgAId);
      expect(orgIdsA).not.toContain(orgBId);

      const { data: orgIdsB, error: errB } = await userBClient.rpc("get_user_organization_ids");
      expect(errB).toBeNull();
      expect(orgIdsB).toContain(orgBId);
      expect(orgIdsB).not.toContain(orgAId);
    });

    it("is_org_member() returns true only for member organizations", async () => {
      const { data: isMemAInA } = await userAClient.rpc("is_org_member", { p_org_id: orgAId });
      expect(isMemAInA).toBe(true);

      const { data: isMemAInB } = await userAClient.rpc("is_org_member", { p_org_id: orgBId });
      expect(isMemAInB).toBe(false);

      const { data: isMemBInA } = await userBClient.rpc("is_org_member", { p_org_id: orgAId });
      expect(isMemBInA).toBe(false);
    });
  });

  // ===========================================================================
  // 5. Suspended and Revoked Member Isolation
  // ===========================================================================
  describe("Suspended and Revoked Member Isolation", () => {
    it("Active User C can initially access Org A", async () => {
      const { data, error } = await userCClient.from("organizations").select("id, name").eq("id", orgAId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("Suspended member (User C) is immediately denied access to Org A", async () => {
      // Suspend User C in Org A via adminClient
      const { error: suspendErr } = await adminClient
        .from("organization_memberships")
        .update({ status: "suspended" })
        .eq("id", membershipCId);
      expect(suspendErr).toBeNull();

      // User C queries Org A -> 0 rows
      const { data: orgData, error: orgErr } = await userCClient
        .from("organizations")
        .select("id, name")
        .eq("id", orgAId);
      expect(orgErr).toBeNull();
      expect(orgData).toHaveLength(0);

      // User C queries peers in Org A -> 0 rows
      const { data: peerData } = await userCClient
        .from("organization_memberships")
        .select("id")
        .eq("organization_id", orgAId);
      expect(peerData).toHaveLength(0);

      // is_org_member returns false
      const { data: isMem } = await userCClient.rpc("is_org_member", { p_org_id: orgAId });
      expect(isMem).toBe(false);

      // get_user_organization_ids returns empty
      const { data: orgIds } = await userCClient.rpc("get_user_organization_ids");
      expect(orgIds).toHaveLength(0);
    });

    it("Revoked member (User C) is immediately denied access to Org A", async () => {
      // Revoke User C in Org A
      const { error: revokeErr } = await adminClient
        .from("organization_memberships")
        .update({ status: "revoked" })
        .eq("id", membershipCId);
      expect(revokeErr).toBeNull();

      // User C queries Org A -> 0 rows
      const { data: orgData } = await userCClient
        .from("organizations")
        .select("id, name")
        .eq("id", orgAId);
      expect(orgData).toHaveLength(0);

      // is_org_member returns false
      const { data: isMem } = await userCClient.rpc("is_org_member", { p_org_id: orgAId });
      expect(isMem).toBe(false);
    });
  });

  // ===========================================================================
  // 6. Closed Organization Isolation
  // ===========================================================================
  describe("Closed Organization Isolation", () => {
    it("Closing Org B completely isolates it from queries even for its Owner", async () => {
      // Close Org B using PostgreSQL session setting bypass
      const pgClient = new PgClient({ connectionString: dbUrl });
      await pgClient.connect();
      try {
        await pgClient.query("BEGIN;");
        await pgClient.query("SET LOCAL bizflow.allow_org_lifecycle_update = 'true';");
        await pgClient.query(
          "UPDATE public.organizations SET is_active = false, closed_at = NOW(), closed_by = $1 WHERE id = $2;",
          [userBId, orgBId]
        );
        await pgClient.query("COMMIT;");
      } finally {
        await pgClient.end();
      }

      // User B (Owner) queries Org B -> returns 0 rows under RLS!
      const { data: orgData, error: orgErr } = await userBClient
        .from("organizations")
        .select("id, name, is_active")
        .eq("id", orgBId);
      expect(orgErr).toBeNull();
      expect(orgData).toHaveLength(0);

      // User B checking is_org_member -> false
      const { data: isMem } = await userBClient.rpc("is_org_member", { p_org_id: orgBId });
      expect(isMem).toBe(false);

      // User B querying audit events of closed Org B -> 0 rows
      const { data: auditData } = await userBClient
        .from("organization_audit_events")
        .select("id")
        .eq("organization_id", orgBId);
      expect(auditData).toHaveLength(0);
    });
  });

  // ===========================================================================
  // 7. Unverified User Tenant Isolation
  // ===========================================================================
  describe("Unverified User Isolation", () => {
    it("Unverified user cannot access any organizations", async () => {
      const { data: orgData } = await userUnverifiedClient
        .from("organizations")
        .select("id, name")
        .in("id", [orgAId, orgBId]);
      expect(orgData).toHaveLength(0);

      const { data: isVerified } = await userUnverifiedClient.rpc("is_email_verified");
      expect(isVerified).toBe(false);
    });
  });
});

