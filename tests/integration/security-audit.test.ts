import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";

// -----------------------------------------------------------------------------
// Environment validation (fails immediately with clear messages if missing)
// -----------------------------------------------------------------------------
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

if (!supabaseUrl) {
  throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL");
}
if (!anonKey) {
  throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY");
}
if (!serviceRoleKey) {
  throw new Error("Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY");
}

describe("Targeted Security Remediation Verification (T006–T010)", () => {
  let adminClient: SupabaseClient;

  // Authenticated user clients (using JWT contexts, never service-role for tenant queries)
  let userAClient: SupabaseClient; // Owner of Org A
  let userBClient: SupabaseClient; // Owner of Org B (different tenant)
  let userCClient: SupabaseClient; // Active peer in Org A
  let userDClient: SupabaseClient; // Suspended member of Org A
  let userUnverifiedClient: SupabaseClient; // Authenticated user with unconfirmed email

  let userAId: string;
  let userBId: string;
  let userCId: string;
  let userDId: string;
  let userUnverifiedId: string;

  const testPassword = "Password123!@#Test";
  const userAEmail = `audit_user_a_${Date.now()}@example.com`;
  const userBEmail = `audit_user_b_${Date.now()}@example.com`;
  const userCEmail = `audit_user_c_${Date.now()}@example.com`;
  const userDEmail = `audit_user_d_${Date.now()}@example.com`;
  const userUnverifiedEmail = `audit_user_unverified_${Date.now()}@example.com`;

  let orgAId: string;
  let orgBId: string;
  let closedOrgId: string;
  let concurrencyOrgId: string;
  let auditRetentionOrgId: string;

  beforeAll(async () => {
    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Create User A (verified owner for Org A)
    const { data: userAData, error: userAErr } = await adminClient.auth.admin.createUser({
      email: userAEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "AuditAlpha", last_name: "Owner" },
    });
    if (userAErr || !userAData.user) {
      throw new Error(`Failed to create User A fixture: ${userAErr?.message || "User missing"}`);
    }
    userAId = userAData.user.id;

    // 2. Create User B (verified owner for Org B)
    const { data: userBData, error: userBErr } = await adminClient.auth.admin.createUser({
      email: userBEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "AuditBeta", last_name: "Owner" },
    });
    if (userBErr || !userBData.user) {
      throw new Error(`Failed to create User B fixture: ${userBErr?.message || "User missing"}`);
    }
    userBId = userBData.user.id;

    // 3. Create User C (verified, active peer for Org A)
    const { data: userCData, error: userCErr } = await adminClient.auth.admin.createUser({
      email: userCEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "AuditCharlie", last_name: "Cashier" },
    });
    if (userCErr || !userCData.user) {
      throw new Error(`Failed to create User C fixture: ${userCErr?.message || "User missing"}`);
    }
    userCId = userCData.user.id;

    // 4. Create User D (verified, suspended member for Org A)
    const { data: userDData, error: userDErr } = await adminClient.auth.admin.createUser({
      email: userDEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "AuditDelta", last_name: "Suspended" },
    });
    if (userDErr || !userDData.user) {
      throw new Error(`Failed to create User D fixture: ${userDErr?.message || "User missing"}`);
    }
    userDId = userDData.user.id;

    // 5. Create User Unverified (authenticated context with unconfirmed email):
    // In local Supabase with enable_confirmations = true, GoTrue prevents signInWithPassword
    // if email is unconfirmed. Therefore, we create the user with email_confirm: true initially,
    // establish an authentic session, and then clear email_confirmed_at in auth.users.
    const { data: userUnvData, error: userUnvErr } = await adminClient.auth.admin.createUser({
      email: userUnverifiedEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "AuditUnv", last_name: "Pending" },
    });
    if (userUnvErr || !userUnvData.user) {
      throw new Error(`Failed to create unverified user fixture: ${userUnvErr?.message || "User missing"}`);
    }
    userUnverifiedId = userUnvData.user.id;

    // Authenticate user clients and verify session creation
    userAClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: signAData, error: signAErr } = await userAClient.auth.signInWithPassword({
      email: userAEmail,
      password: testPassword,
    });
    if (signAErr || !signAData.session) throw new Error(`User A sign-in failed: ${signAErr?.message || "No session"}`);

    userBClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: signBData, error: signBErr } = await userBClient.auth.signInWithPassword({
      email: userBEmail,
      password: testPassword,
    });
    if (signBErr || !signBData.session) throw new Error(`User B sign-in failed: ${signBErr?.message || "No session"}`);

    userCClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: signCData, error: signCErr } = await userCClient.auth.signInWithPassword({
      email: userCEmail,
      password: testPassword,
    });
    if (signCErr || !signCData.session) throw new Error(`User C sign-in failed: ${signCErr?.message || "No session"}`);

    userDClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: signDData, error: signDErr } = await userDClient.auth.signInWithPassword({
      email: userDEmail,
      password: testPassword,
    });
    if (signDErr || !signDData.session) throw new Error(`User D sign-in failed: ${signDErr?.message || "No session"}`);

    userUnverifiedClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: signUnvData, error: signUnvErr } = await userUnverifiedClient.auth.signInWithPassword({
      email: userUnverifiedEmail,
      password: testPassword,
    });
    if (signUnvErr || !signUnvData.session) throw new Error(`Unverified user sign-in failed: ${signUnvErr?.message || "No session"}`);

    // Clear email_confirmed_at in auth.users so the authenticated user is genuinely unconfirmed
    const pgSetup = new PgClient({ connectionString: dbUrl });
    await pgSetup.connect();
    try {
      await pgSetup.query("UPDATE auth.users SET email_confirmed_at = NULL WHERE id = $1", [userUnverifiedId]);
    } finally {
      await pgSetup.end();
    }

    // Seed Org A (User A is active owner, User C is active cashier, User D is suspended cashier)
    const { data: orgA, error: orgAErr } = await adminClient
      .from("organizations")
      .insert({
        name: "Security Audit Org A",
        slug: `audit-org-a-${Date.now()}`,
        business_type: "Retail Store",
        country: "US",
        currency: "USD",
        timezone: "America/New_York",
        created_by: userAId,
      })
      .select()
      .single();
    if (orgAErr || !orgA) throw new Error(`Failed to insert Org A: ${orgAErr?.message || "Missing org"}`);
    orgAId = orgA.id;

    // Seed Org B (User B is active owner)
    const { data: orgB, error: orgBErr } = await adminClient
      .from("organizations")
      .insert({
        name: "Security Audit Org B",
        slug: `audit-org-b-${Date.now()}`,
        business_type: "Apparel Store",
        country: "GB",
        currency: "GBP",
        timezone: "Europe/London",
        created_by: userBId,
      })
      .select()
      .single();
    if (orgBErr || !orgB) throw new Error(`Failed to insert Org B: ${orgBErr?.message || "Missing org"}`);
    orgBId = orgB.id;

    // Memberships for Org A:
    const { error: memAErr } = await adminClient.from("organization_memberships").insert([
      { organization_id: orgAId, user_id: userAId, role: "owner", status: "active" },
      { organization_id: orgAId, user_id: userCId, role: "cashier", status: "active" },
      { organization_id: orgAId, user_id: userDId, role: "cashier", status: "suspended" },
    ]);
    if (memAErr) throw new Error(`Failed to insert memberships for Org A: ${memAErr.message}`);

    // Membership for Org B:
    const { error: memBErr } = await adminClient.from("organization_memberships").insert({
      organization_id: orgBId,
      user_id: userBId,
      role: "owner",
      status: "active",
    });
    if (memBErr) throw new Error(`Failed to insert membership for Org B: ${memBErr.message}`);

    // Seed Closed Organization (User A is owner, but is_active = false)
    const { data: closedOrg, error: closedOrgErr } = await adminClient
      .from("organizations")
      .insert({
        name: "Closed Retail Store",
        slug: `closed-org-${Date.now()}`,
        business_type: "Former Retail",
        country: "US",
        currency: "USD",
        timezone: "UTC",
        created_by: userAId,
        is_active: false,
        closed_at: new Date().toISOString(),
        closed_by: userAId,
      })
      .select()
      .single();
    if (closedOrgErr || !closedOrg) throw new Error(`Failed to insert closed org: ${closedOrgErr?.message || "Missing org"}`);
    closedOrgId = closedOrg.id;

    const { error: closedMemErr } = await adminClient.from("organization_memberships").insert({
      organization_id: closedOrgId,
      user_id: userAId,
      role: "owner",
      status: "active",
    });
    if (closedMemErr) throw new Error(`Failed to insert membership for closed org: ${closedMemErr.message}`);

    const { error: closedAuditErr } = await adminClient.from("organization_audit_events").insert({
      organization_id: closedOrgId,
      actor_id: userAId,
      event_type: "organization.closed",
      metadata: { reason: "test closure" },
    });
    if (closedAuditErr) throw new Error(`Failed to insert audit event for closed org: ${closedAuditErr.message}`);

    // Seed dedicated Org for Concurrency Testing (co-owned by User A and User C)
    const { data: concOrg, error: concOrgErr } = await adminClient
      .from("organizations")
      .insert({
        name: "Concurrency Test Org",
        slug: `concurrency-org-${Date.now()}`,
        business_type: "Supermarket",
        country: "US",
        currency: "USD",
        timezone: "UTC",
        created_by: userAId,
      })
      .select()
      .single();
    if (concOrgErr || !concOrg) throw new Error(`Failed to insert concurrency org: ${concOrgErr?.message || "Missing org"}`);
    concurrencyOrgId = concOrg.id;

    const { error: concMemErr } = await adminClient.from("organization_memberships").insert([
      { organization_id: concurrencyOrgId, user_id: userAId, role: "owner", status: "active" },
      { organization_id: concurrencyOrgId, user_id: userCId, role: "owner", status: "active" },
    ]);
    if (concMemErr) throw new Error(`Failed to insert concurrency memberships: ${concMemErr.message}`);

    // Seed dedicated Org for Audit Retention Testing
    const { data: retOrg, error: retOrgErr } = await adminClient
      .from("organizations")
      .insert({
        name: "Audit Retention Test Org",
        slug: `retention-org-${Date.now()}`,
        business_type: "Jewelry",
        country: "US",
        currency: "USD",
        timezone: "UTC",
        created_by: userAId,
      })
      .select()
      .single();
    if (retOrgErr || !retOrg) throw new Error(`Failed to insert retention org: ${retOrgErr?.message || "Missing org"}`);
    auditRetentionOrgId = retOrg.id;
  }, 30000);

  afterAll(async () => {
    // Teardown test fixtures in strict foreign-key order:
    // 1. Audit events (ON DELETE RESTRICT from organizations & auth.users)
    // 2. Memberships
    // 3. Organizations (created_by / closed_by references auth.users)
    // 4. Auth users
    const orgIds = [auditRetentionOrgId, concurrencyOrgId, closedOrgId, orgAId, orgBId].filter(
      (id): id is string => typeof id === "string" && id.length > 0
    );
    const userIds = [userAId, userBId, userCId, userDId, userUnverifiedId].filter(
      (id): id is string => typeof id === "string" && id.length > 0
    );

    // Step 1: Explicitly remove all audit events for test organizations
    if (orgIds.length > 0) {
      try {
        await adminClient
          .from("organization_audit_events")
          .delete()
          .in("organization_id", orgIds);
      } catch (_) {}
    }

    // Step 2: Explicitly remove all memberships for test organizations
    if (orgIds.length > 0) {
      try {
        await adminClient
          .from("organization_memberships")
          .delete()
          .in("organization_id", orgIds);
      } catch (_) {}
    }

    // Step 3: Remove test organizations
    for (const orgId of orgIds) {
      try {
        await adminClient.from("organizations").delete().eq("id", orgId);
      } catch (_) {}
    }

    // Step 4: Remove all test users from auth.users
    for (const userId of userIds) {
      try {
        await adminClient.auth.admin.deleteUser(userId);
      } catch (_) {}
    }
  }, 30000);

  describe("Finding 1: Privileged Testing RPC Removal & Role Mutation Defense", () => {
    it("confirms public.demote_member_role_for_testing has been dropped and cannot be called", async () => {
      const { error } = await userAClient.rpc("demote_member_role_for_testing", {
        p_org_id: orgAId,
        p_user_id: userAId,
        p_new_role: "cashier",
      });
      // PostgREST returns PGRST202 when an RPC function does not exist in schema cache
      expect(error).not.toBeNull();
      expect(error?.code).toBe("PGRST202");
    });

    it("prevents ordinary authenticated user from directly updating membership roles", async () => {
      // User A attempts direct client UPDATE on membership role
      const { data } = await userAClient
        .from("organization_memberships")
        .update({ role: "owner" })
        .eq("organization_id", orgAId)
        .eq("user_id", userCId)
        .select();

      // Denied by RLS: 0 rows modified
      expect(data).toEqual([]);

      // Verify the role was NOT modified in the database
      const { data: checkMem, error: checkErr } = await adminClient
        .from("organization_memberships")
        .select("role")
        .eq("organization_id", orgAId)
        .eq("user_id", userCId)
        .single();
      expect(checkErr).toBeNull();
      expect(checkMem?.role).toBe("cashier");
    });
  });

  describe("Finding 2: Active Organization Status Enforcement", () => {
    it("prevents authenticated user from accessing a closed organization via organizations query", async () => {
      // User A owns closedOrgId, but is_active = false
      const { data, error } = await userAClient
        .from("organizations")
        .select("*")
        .eq("id", closedOrgId);

      expect(error).toBeNull();
      // Must return 0 rows (filtered out by RLS because is_active = false)
      expect(data).toEqual([]);
    });

    it("prevents authenticated user from accessing memberships of a closed organization", async () => {
      const { data, error } = await userAClient
        .from("organization_memberships")
        .select("*")
        .eq("organization_id", closedOrgId);

      expect(error).toBeNull();
      // Must return 0 rows
      expect(data).toEqual([]);
    });

    it("prevents authenticated user from accessing audit events of a closed organization", async () => {
      const { data, error } = await userAClient
        .from("organization_audit_events")
        .select("*")
        .eq("organization_id", closedOrgId);

      expect(error).toBeNull();
      // Must return 0 rows
      expect(data).toEqual([]);
    });

    it("is_org_member returns false for a closed organization", async () => {
      const { data, error } = await userAClient.rpc("is_org_member", {
        p_org_id: closedOrgId,
      });
      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it("get_user_organization_ids excludes closed organizations", async () => {
      const { data, error } = await userAClient.rpc("get_user_organization_ids");
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toContain(orgAId);
      expect(data).not.toContain(closedOrgId);
    });

    it("get_user_organization_ids ignores suspended memberships", async () => {
      // User D has a suspended membership in Org A
      const { data: userDOrgs, error } = await userDClient.rpc("get_user_organization_ids");
      expect(error).toBeNull();
      expect(userDOrgs).toEqual([]);
    });

    it("is_email_verified returns false for authenticated user with unverified email and true for verified user", async () => {
      // 1. Verify userAClient is an authenticated session and returns true
      const { data: userACheck, error: userAErr } = await userAClient.auth.getUser();
      expect(userAErr).toBeNull();
      expect(userACheck?.user?.id).toBe(userAId);

      const { data: verifiedResult, error: verifiedErr } = await userAClient.rpc("is_email_verified");
      expect(verifiedErr).toBeNull();
      expect(verifiedResult).toBe(true);

      // 2. Verify userUnverifiedClient has a valid authenticated JWT context (auth.uid() = userUnverifiedId)
      const { data: unvCheck, error: unvErr } = await userUnverifiedClient.auth.getUser();
      expect(unvErr).toBeNull();
      expect(unvCheck?.user?.id).toBe(userUnverifiedId);

      // 3. Verify is_email_verified() returns false for this authenticated user
      const { data: unverifiedResult, error: unverifiedErr } = await userUnverifiedClient.rpc("is_email_verified");
      expect(unverifiedErr).toBeNull();
      expect(unverifiedResult).toBe(false);
    });
  });

  describe("Finding 4: Owner Invariant Concurrency via Direct PostgreSQL Transactions", () => {
    it("serializes concurrent owner demotions using row lock and prevents demoting the last active owner", async () => {
      // Connect two independent direct PostgreSQL clients for concurrent transactions, plus an inspector client
      const client1 = new PgClient({ connectionString: dbUrl });
      const client2 = new PgClient({ connectionString: dbUrl });
      const inspectorClient = new PgClient({ connectionString: dbUrl });

      await client1.connect();
      await client2.connect();
      await inspectorClient.connect();

      // Retrieve backend PID for client2 using standard PostgreSQL function
      const { rows: pidRows } = await client2.query("SELECT pg_backend_pid() AS pid");
      const client2Pid = pidRows[0].pid;

      let client1TxOpen = false;
      let client2TxOpen = false;

      try {
        // Begin transactions on both sessions
        await client1.query("BEGIN");
        client1TxOpen = true;

        await client2.query("BEGIN");
        client2TxOpen = true;

        // Transaction 1: Demote User A to cashier.
        // check_owner_invariant() trigger fires and executes:
        // PERFORM 1 FROM public.organizations WHERE id = v_org_id FOR UPDATE;
        await client1.query(
          "UPDATE public.organization_memberships SET role = $1 WHERE organization_id = $2 AND user_id = $3",
          ["cashier", concurrencyOrgId, userAId]
        );

        // Transaction 2: Concurrently attempt to demote User C to cashier.
        // Its check_owner_invariant() trigger attempts to acquire the FOR UPDATE lock on the same organization row,
        // which must block because client1 holds the row lock.
        let client2Error: any = null;
        let client2Finished = false;
        const tx2Promise = client2
          .query(
            "UPDATE public.organization_memberships SET role = $1 WHERE organization_id = $2 AND user_id = $3",
            ["cashier", concurrencyOrgId, userCId]
          )
          .then(() => {
            client2Finished = true;
          })
          .catch((err) => {
            client2Error = err;
            client2Finished = true;
          });

        // Deterministic synchronization:
        // Use inspectorClient to poll pg_locks and pg_stat_activity until client2 is confirmed waiting on the row lock.
        let client2IsWaiting = false;
        const startTime = Date.now();
        const maxWaitMs = 5000;

        while (Date.now() - startTime < maxWaitMs) {
          const lockCheck = await inspectorClient.query(
            "SELECT locktype, mode, granted FROM pg_locks WHERE pid = $1 AND NOT granted",
            [client2Pid]
          );
          if (lockCheck.rows.length > 0) {
            client2IsWaiting = true;
            break;
          }
          const activityCheck = await inspectorClient.query(
            "SELECT wait_event_type, wait_event FROM pg_stat_activity WHERE pid = $1",
            [client2Pid]
          );
          if (activityCheck.rows[0]?.wait_event_type === "Lock") {
            client2IsWaiting = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 10));
        }

        // Assert deterministically: Transaction 2 is actively waiting on the organization row lock BEFORE Transaction 1 commits
        expect(client2IsWaiting).toBe(true);
        expect(client2Finished).toBe(false);

        // Transaction 1 commits, releasing the organization row lock
        await client1.query("COMMIT");
        client1TxOpen = false;

        // Wait for Transaction 2 to resume execution, evaluate the owner count under the released lock, and settle
        await tx2Promise;

        // Transaction 2 must have failed with exception P0002 because demoting User C would leave 0 active owners
        expect(client2Error).not.toBeNull();
        expect(client2Error.code).toBe("P0002");
        expect(client2Error.message).toContain("Cannot remove or demote the last active owner");

        await client2.query("ROLLBACK");
        client2TxOpen = false;

        // Verify database state: User C remains an active owner (exactly 1 active owner)
        const { data: remainingOwners, error: remainingErr } = await adminClient
          .from("organization_memberships")
          .select("user_id, role, status")
          .eq("organization_id", concurrencyOrgId)
          .eq("role", "owner")
          .eq("status", "active");

        expect(remainingErr).toBeNull();
        expect(remainingOwners).toBeDefined();
        expect(remainingOwners?.length).toBe(1);
        expect(remainingOwners?.[0]?.user_id).toBe(userCId);
      } finally {
        if (client1TxOpen) {
          await client1.query("ROLLBACK").catch(() => {});
        }
        if (client2TxOpen) {
          await client2.query("ROLLBACK").catch(() => {});
        }
        await client1.end().catch(() => {});
        await client2.end().catch(() => {});
        await inspectorClient.end().catch(() => {});
      }
    });
  });

  describe("Protected Fields & Database-Level Immutability Enforcement", () => {
    it("blocks updating created_by at database trigger level", async () => {
      const fakeCreatorId = "00000000-0000-0000-0000-000000000000";
      const { error } = await userAClient
        .from("organizations")
        .update({ created_by: fakeCreatorId })
        .eq("id", orgAId);

      expect(error).not.toBeNull();
      expect(error?.message).toContain("created_by is immutable");
    });

    it("blocks updating is_active directly without authorized lifecycle procedure", async () => {
      const { error } = await userAClient
        .from("organizations")
        .update({ is_active: false })
        .eq("id", orgAId);

      expect(error).not.toBeNull();
      expect(error?.message).toContain("Organization lifecycle fields");
    });

    it("blocks updating closed_at or closed_by directly", async () => {
      const { error: errClosedAt } = await userAClient
        .from("organizations")
        .update({ closed_at: new Date().toISOString() })
        .eq("id", orgAId);
      expect(errClosedAt).not.toBeNull();
      expect(errClosedAt?.message).toContain("Organization lifecycle fields");

      const { error: errClosedBy } = await userAClient
        .from("organizations")
        .update({ closed_by: userAId })
        .eq("id", orgAId);
      expect(errClosedBy).not.toBeNull();
      expect(errClosedBy?.message).toContain("Organization lifecycle fields");
    });

    it("allows owner to update standard organization metadata", async () => {
      const { data, error } = await userAClient
        .from("organizations")
        .update({ name: "Renamed Security Org A" })
        .eq("id", orgAId)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data.name).toBe("Renamed Security Org A");
    });
  });

  describe("Audit Event Retention & Foreign Key ON DELETE RESTRICT", () => {
    it("prevents hard-deleting an organization that contains audit records", async () => {
      // Insert an audit record for auditRetentionOrgId via service-role
      const { error: auditInsertErr } = await adminClient
        .from("organization_audit_events")
        .insert({
          organization_id: auditRetentionOrgId,
          actor_id: userAId,
          event_type: "organization.created",
          metadata: { action: "initial_setup" },
        });
      expect(auditInsertErr).toBeNull();

      // Attempt to hard-delete auditRetentionOrgId via admin client
      const { error: deleteOrgErr } = await adminClient
        .from("organizations")
        .delete()
        .eq("id", auditRetentionOrgId);

      // Must be rejected by foreign key constraint ON DELETE RESTRICT
      expect(deleteOrgErr).not.toBeNull();
      expect(deleteOrgErr?.message).toContain("violates foreign key constraint");

      // Verify audit record is still intact
      const { data: auditEvents, error: auditFetchErr } = await adminClient
        .from("organization_audit_events")
        .select("id")
        .eq("organization_id", auditRetentionOrgId);
      expect(auditFetchErr).toBeNull();
      expect(auditEvents?.length).toBe(1);
    });
  });

  describe("Cross-Tenant Isolation (SELECT, INSERT, UPDATE, DELETE)", () => {
    it("User A cannot update or delete Org B (organizations table)", async () => {
      // UPDATE Org B
      const { data: updateData, error: updateErr } = await userAClient
        .from("organizations")
        .update({ name: "Tampered By User A" })
        .eq("id", orgBId)
        .select();
      expect(updateErr).toBeNull();
      expect(updateData).toEqual([]);

      // DELETE Org B
      const { data: deleteData, error: deleteErr } = await userAClient
        .from("organizations")
        .delete()
        .eq("id", orgBId)
        .select();
      expect(deleteErr).toBeNull();
      expect(deleteData).toEqual([]);
    });

    it("User A cannot update or delete Org B memberships", async () => {
      // UPDATE Org B membership
      const { data: updateData, error: updateErr } = await userAClient
        .from("organization_memberships")
        .update({ role: "cashier" })
        .eq("organization_id", orgBId)
        .select();
      expect(updateErr).toBeNull();
      expect(updateData).toEqual([]);

      // DELETE Org B membership
      const { data: deleteData, error: deleteErr } = await userAClient
        .from("organization_memberships")
        .delete()
        .eq("organization_id", orgBId)
        .select();
      expect(deleteErr).toBeNull();
      expect(deleteData).toEqual([]);
    });

    it("User A cannot read Org B audit events", async () => {
      // Seed audit event in Org B
      const { error: seedErr } = await adminClient.from("organization_audit_events").insert({
        organization_id: orgBId,
        actor_id: userBId,
        event_type: "organization.created",
        metadata: { secret: "org_b_secret_data" },
      });
      expect(seedErr).toBeNull();

      const { data: orgBAudit, error: auditReadErr } = await userAClient
        .from("organization_audit_events")
        .select("*")
        .eq("organization_id", orgBId);
      expect(auditReadErr).toBeNull();
      expect(orgBAudit).toEqual([]);
    });

    it("User A can read active peer profile, but cannot read suspended peer profile or cross-tenant profile", async () => {
      // User C is an active peer in Org A
      const { data: activePeerProfile, error: activeErr } = await userAClient
        .from("profiles")
        .select("id, first_name")
        .eq("id", userCId)
        .single();
      expect(activeErr).toBeNull();
      expect(activePeerProfile).not.toBeNull();
      expect(activePeerProfile?.first_name).toBe("AuditCharlie");

      // User D is a SUSPENDED peer in Org A -> User A cannot read User D's profile
      const { data: suspendedPeerProfile, error: suspendedErr } = await userAClient
        .from("profiles")
        .select("id")
        .eq("id", userDId);
      expect(suspendedErr).toBeNull();
      expect(suspendedPeerProfile).toEqual([]);

      // User B is in Org B (different tenant) -> User A cannot read User B's profile
      const { data: crossTenantProfile, error: crossErr } = await userAClient
        .from("profiles")
        .select("id")
        .eq("id", userBId);
      expect(crossErr).toBeNull();
      expect(crossTenantProfile).toEqual([]);
    });
  });
});
