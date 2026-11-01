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

if (!supabaseUrl) {
  throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL");
}
if (!anonKey) {
  throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY");
}
if (!serviceRoleKey) {
  throw new Error("Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY");
}

describe("T027: create_organization_with_owner Integration Tests (US2)", () => {
  let adminClient: SupabaseClient;

  // Authenticated user clients
  let userAClient: SupabaseClient; // Verified User A (Creator)
  let userBClient: SupabaseClient; // Verified User B (Different User)
  let userUnverifiedClient: SupabaseClient; // Authenticated user with unconfirmed email
  let anonClient: SupabaseClient; // Unauthenticated client

  let userAId: string;
  let userBId: string;
  let userUnverifiedId: string;

  const testPassword = "Password123!@#Test";
  const userAEmail = `org_user_a_${Date.now()}@example.com`;
  const userBEmail = `org_user_b_${Date.now()}@example.com`;
  const userUnverifiedEmail = `org_user_unv_${Date.now()}@example.com`;

  // Track created organization IDs for clean teardown
  const createdOrgIds: string[] = [];

  beforeAll(async () => {
    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    anonClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Create Verified User A
    const { data: userAData, error: userAErr } = await adminClient.auth.admin.createUser({
      email: userAEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "OrgCreator", last_name: "Alpha" },
    });
    if (userAErr || !userAData.user) {
      throw new Error(`Failed to create User A: ${userAErr?.message || "Missing user"}`);
    }
    userAId = userAData.user.id;

    // 2. Create Verified User B
    const { data: userBData, error: userBErr } = await adminClient.auth.admin.createUser({
      email: userBEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "OrgCreator", last_name: "Beta" },
    });
    if (userBErr || !userBData.user) {
      throw new Error(`Failed to create User B: ${userBErr?.message || "Missing user"}`);
    }
    userBId = userBData.user.id;

    // 3. Create Unverified User
    const { data: userUnvData, error: userUnvErr } = await adminClient.auth.admin.createUser({
      email: userUnverifiedEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Unverified", last_name: "Pending" },
    });
    if (userUnvErr || !userUnvData.user) {
      throw new Error(`Failed to create Unverified User: ${userUnvErr?.message || "Missing user"}`);
    }
    userUnverifiedId = userUnvData.user.id;

    // Sign in user clients
    userAClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signA, error: signAErr } = await userAClient.auth.signInWithPassword({
      email: userAEmail,
      password: testPassword,
    });
    if (signAErr || !signA.session) throw new Error(`User A sign-in failed: ${signAErr?.message}`);

    userBClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signB, error: signBErr } = await userBClient.auth.signInWithPassword({
      email: userBEmail,
      password: testPassword,
    });
    if (signBErr || !signB.session) throw new Error(`User B sign-in failed: ${signBErr?.message}`);

    userUnverifiedClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signUnv, error: signUnvErr } = await userUnverifiedClient.auth.signInWithPassword({
      email: userUnverifiedEmail,
      password: testPassword,
    });
    if (signUnvErr || !signUnv.session) throw new Error(`Unverified user sign-in failed: ${signUnvErr?.message}`);

    // Clear email_confirmed_at in database so UserUnverified has valid JWT context but unverified email
    const pg = new PgClient({ connectionString: dbUrl });
    await pg.connect();
    try {
      await pg.query("UPDATE auth.users SET email_confirmed_at = NULL WHERE id = $1", [userUnverifiedId]);
    } finally {
      await pg.end();
    }
  });

  afterAll(async () => {
    // Teardown audit events, memberships, organizations, and test users
    if (createdOrgIds.length > 0) {
      try {
        await adminClient.from("organization_audit_events").delete().in("organization_id", createdOrgIds);
      } catch (_) {}
      try {
        await adminClient.from("organization_memberships").delete().in("organization_id", createdOrgIds);
      } catch (_) {}
      for (const orgId of createdOrgIds) {
        try {
          await adminClient.from("organizations").delete().eq("id", orgId);
        } catch (_) {}
      }
    }

    const testUserIds = [userAId, userBId, userUnverifiedId].filter(Boolean);
    for (const userId of testUserIds) {
      try {
        await adminClient.auth.admin.deleteUser(userId);
      } catch (_) {}
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Authorization: Unauthenticated & Unverified Rejection
  // ---------------------------------------------------------------------------
  it("rejects unauthenticated caller attempting to create an organization (P0003)", async () => {
    const { data, error } = await anonClient.rpc("create_organization_with_owner", {
      p_name: "Anon Retail",
      p_slug: "anon-retail",
      p_business_type: "Grocery",
      p_country: "US",
      p_currency: "USD",
      p_timezone: "UTC",
      p_client_mutation_id: "a0000000-0000-0000-0000-000000000099",
    });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/Authentication required|P0003/i);
  });

  it("rejects authenticated user with unverified email (P0001)", async () => {
    const { data, error } = await userUnverifiedClient.rpc("create_organization_with_owner", {
      p_name: "Unverified Store",
      p_slug: `unverified-store-${Date.now()}`,
      p_business_type: "Convenience Store",
      p_country: "US",
      p_currency: "USD",
      p_timezone: "America/New_York",
      p_client_mutation_id: "a0000000-0000-0000-0000-000000000098",
    });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/Email verification required|P0001/i);
  });

  // ---------------------------------------------------------------------------
  // 2. Finding 1: Database-Level Input Validations
  // ---------------------------------------------------------------------------
  describe("Finding 1: Database-Level Input Validations", () => {
    it("rejects null or missing p_client_mutation_id (P0008)", async () => {
      const { data, error } = await userAClient.rpc("create_organization_with_owner", {
        p_name: "Valid Store Name",
        p_slug: `valid-slug-${Date.now()}`,
        p_business_type: "Retail Store",
        p_country: "US",
        p_currency: "USD",
        p_timezone: "UTC",
        p_client_mutation_id: null,
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/client_mutation_id is required|P0008/i);
    });

    it("rejects organization name shorter than 2 characters (P0009)", async () => {
      const { data, error } = await userAClient.rpc("create_organization_with_owner", {
        p_name: "A",
        p_slug: `short-name-${Date.now()}`,
        p_business_type: "Retail Store",
        p_country: "US",
        p_currency: "USD",
        p_timezone: "UTC",
        p_client_mutation_id: "a0000000-0000-0000-0000-000000000011",
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/Organization name must be between 2 and 100 characters|P0009/i);
    });

    it("rejects organization name longer than 100 characters (P0009)", async () => {
      const { data, error } = await userAClient.rpc("create_organization_with_owner", {
        p_name: "X".repeat(101),
        p_slug: `long-name-${Date.now()}`,
        p_business_type: "Retail Store",
        p_country: "US",
        p_currency: "USD",
        p_timezone: "UTC",
        p_client_mutation_id: "a0000000-0000-0000-0000-000000000012",
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/Organization name must be between 2 and 100 characters|P0009/i);
    });

    it("rejects invalid business type shorter than 2 characters or blank (P0009)", async () => {
      const { data, error } = await userAClient.rpc("create_organization_with_owner", {
        p_name: "Valid Store Name",
        p_slug: `valid-slug-${Date.now()}`,
        p_business_type: " ",
        p_country: "US",
        p_currency: "USD",
        p_timezone: "UTC",
        p_client_mutation_id: "a0000000-0000-0000-0000-000000000013",
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/Business type is required and must be between 2 and 50 characters|P0009/i);
    });

    it("rejects invalid timezone not recognized by PostgreSQL (P0009)", async () => {
      const { data, error } = await userAClient.rpc("create_organization_with_owner", {
        p_name: "Valid Store Name",
        p_slug: `valid-slug-${Date.now()}`,
        p_business_type: "Retail",
        p_country: "US",
        p_currency: "USD",
        p_timezone: "Mars/Phobos", // completely unrecognized timezone
        p_client_mutation_id: "a0000000-0000-0000-0000-000000000014",
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/Invalid timezone: must be a recognized IANA timezone|P0009/i);
    });

    it("rejects invalid country code violating strict 2-letter uppercase ISO (P0009)", async () => {
      const { data, error } = await userAClient.rpc("create_organization_with_owner", {
        p_name: "Invalid Country Store",
        p_slug: `invalid-country-${Date.now()}`,
        p_business_type: "Retail",
        p_country: "USA", // 3 letters
        p_currency: "USD",
        p_timezone: "UTC",
        p_client_mutation_id: "a0000000-0000-0000-0000-000000000015",
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/Country must be a 2-letter uppercase ISO 3166-1 alpha-2 code|P0009/i);
    });

    it("rejects invalid currency code violating strict 3-letter uppercase ISO (P0009)", async () => {
      const { data, error } = await userAClient.rpc("create_organization_with_owner", {
        p_name: "Invalid Currency Store",
        p_slug: `invalid-curr-${Date.now()}`,
        p_business_type: "Retail",
        p_country: "US",
        p_currency: "US", // 2 letters
        p_timezone: "UTC",
        p_client_mutation_id: "a0000000-0000-0000-0000-000000000016",
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/Currency must be a 3-letter uppercase ISO 4217 code|P0009/i);
    });

    it("rejects invalid optional email format (P0009)", async () => {
      const { data, error } = await userAClient.rpc("create_organization_with_owner", {
        p_name: "Valid Store Name",
        p_slug: `valid-slug-${Date.now()}`,
        p_business_type: "Retail",
        p_country: "US",
        p_currency: "USD",
        p_timezone: "UTC",
        p_email: "not-an-email",
        p_client_mutation_id: "a0000000-0000-0000-0000-000000000017",
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/Invalid business email format|P0009/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Successful Atomic Organization & Owner Membership Creation
  // ---------------------------------------------------------------------------
  it("atomically creates organization, assigns Owner role, and records audit event", async () => {
    const mutationId = "b0000000-0000-0000-0000-000000000001";
    const testSlug = `alpha-store-${Date.now()}`;

    const { data, error } = await userAClient.rpc("create_organization_with_owner", {
      p_name: "Alpha Retail Store",
      p_slug: testSlug,
      p_business_type: "Supermarket",
      p_country: "US",
      p_currency: "USD",
      p_timezone: "America/New_York",
      p_client_mutation_id: mutationId,
      p_tax_id: "TAX-12345",
      p_phone: "+15551234567",
      p_email: "alpha@store.com",
      p_address: "100 Market St",
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();

    const result = data as {
      organization_id: string;
      name: string;
      slug: string;
      role: string;
      is_active: boolean;
      is_idempotent_replay: boolean;
    };

    expect(result.name).toBe("Alpha Retail Store");
    expect(result.slug).toBe(testSlug);
    expect(result.role).toBe("owner");
    expect(result.is_active).toBe(true);
    expect(result.is_idempotent_replay).toBe(false);
    expect(result.organization_id).toBeDefined();

    createdOrgIds.push(result.organization_id);

    // Verify Organization in database
    const { data: orgRow } = await adminClient
      .from("organizations")
      .select("*")
      .eq("id", result.organization_id)
      .single();

    expect(orgRow).toBeDefined();
    expect(orgRow?.created_by).toBe(userAId);
    expect(orgRow?.country).toBe("US");
    expect(orgRow?.currency).toBe("USD");
    expect(orgRow?.client_mutation_id).toBe(mutationId);

    // Verify Owner Membership in database
    const { data: memberRow } = await adminClient
      .from("organization_memberships")
      .select("*")
      .eq("organization_id", result.organization_id)
      .eq("user_id", userAId)
      .single();

    expect(memberRow).toBeDefined();
    expect(memberRow?.role).toBe("owner");
    expect(memberRow?.status).toBe("active");

    // Verify Audit Event creation in database
    const { data: auditEvents } = await adminClient
      .from("organization_audit_events")
      .select("*")
      .eq("organization_id", result.organization_id)
      .eq("event_type", "organization.created");

    expect(auditEvents).toHaveLength(1);
    expect(auditEvents![0].actor_id).toBe(userAId);
    expect(auditEvents![0].metadata).toMatchObject({
      name: "Alpha Retail Store",
      slug: testSlug,
      client_mutation_id: mutationId,
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Creator-Bound Idempotency
  // ---------------------------------------------------------------------------
  it("returns idempotent replay for duplicate submission with same client_mutation_id by same creator", async () => {
    const mutationId = "b0000000-0000-0000-0000-000000000002";
    const testSlug = `idempotent-store-${Date.now()}`;

    // First call creates organization
    const { data: firstCall, error: firstErr } = await userAClient.rpc("create_organization_with_owner", {
      p_name: "Idempotent Store",
      p_slug: testSlug,
      p_business_type: "Electronics",
      p_country: "US",
      p_currency: "USD",
      p_timezone: "America/Chicago",
      p_client_mutation_id: mutationId,
    });

    expect(firstErr).toBeNull();
    const firstRes = firstCall as { organization_id: string; is_idempotent_replay: boolean };
    expect(firstRes.is_idempotent_replay).toBe(false);
    createdOrgIds.push(firstRes.organization_id);

    // Second call with identical client_mutation_id
    const { data: secondCall, error: secondErr } = await userAClient.rpc("create_organization_with_owner", {
      p_name: "Idempotent Store Updated Name",
      p_slug: `different-slug-${Date.now()}`,
      p_business_type: "Electronics",
      p_country: "US",
      p_currency: "USD",
      p_timezone: "America/Chicago",
      p_client_mutation_id: mutationId,
    });

    expect(secondErr).toBeNull();
    const secondRes = secondCall as {
      organization_id: string;
      name: string;
      slug: string;
      role: string;
      is_idempotent_replay: boolean;
    };

    expect(secondRes.organization_id).toBe(firstRes.organization_id);
    expect(secondRes.slug).toBe(testSlug); // original slug preserved
    expect(secondRes.role).toBe("owner");
    expect(secondRes.is_idempotent_replay).toBe(true);
  });

  it("enforces creator-bound isolation: User B submitting User A's client_mutation_id creates distinct org", async () => {
    const sharedMutationId = "b0000000-0000-0000-0000-000000000003";

    // User A creates org with sharedMutationId
    const { data: userACall, error: userAErr } = await userAClient.rpc("create_organization_with_owner", {
      p_name: "User A Private Store",
      p_slug: `user-a-store-${Date.now()}`,
      p_business_type: "Boutique",
      p_country: "US",
      p_currency: "USD",
      p_timezone: "UTC",
      p_client_mutation_id: sharedMutationId,
    });
    expect(userAErr).toBeNull();
    const userAOrg = userACall as { organization_id: string };
    createdOrgIds.push(userAOrg.organization_id);

    // User B attempts to call with the SAME mutationId
    const { data: userBCall, error: userBErr } = await userBClient.rpc("create_organization_with_owner", {
      p_name: "User B Independent Store",
      p_slug: `user-b-store-${Date.now()}`,
      p_business_type: "Pharmacy",
      p_country: "CA",
      p_currency: "CAD",
      p_timezone: "America/Toronto",
      p_client_mutation_id: sharedMutationId,
    });
    expect(userBErr).toBeNull();
    const userBOrg = userBCall as { organization_id: string; is_idempotent_replay: boolean };
    createdOrgIds.push(userBOrg.organization_id);

    // Assert User B got a completely separate organization, NOT User A's
    expect(userBOrg.organization_id).not.toBe(userAOrg.organization_id);
    expect(userBOrg.is_idempotent_replay).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 5. Finding 2: Rejection of Inactive Organizations on Idempotent Replays
  // ---------------------------------------------------------------------------
  describe("Finding 2: Inactive Organization Rejection on Idempotent Replays", () => {
    it("rejects fast-path idempotent replay if organization was closed (P0015)", async () => {
      const mutationId = "b0000000-0000-0000-0000-000000000021";
      const testSlug = `closed-replay-${Date.now()}`;

      // 1. User A creates organization
      const { data: createData, error: createErr } = await userAClient.rpc("create_organization_with_owner", {
        p_name: "Store to Close",
        p_slug: testSlug,
        p_business_type: "Retail",
        p_country: "US",
        p_currency: "USD",
        p_timezone: "UTC",
        p_client_mutation_id: mutationId,
      });
      expect(createErr).toBeNull();
      const orgId = (createData as { organization_id: string }).organization_id;
      createdOrgIds.push(orgId);

      // 2. Soft-close the organization in database via direct postgres connection using lifecycle flag
      const pg = new PgClient({ connectionString: dbUrl });
      await pg.connect();
      try {
        await pg.query("BEGIN;");
        await pg.query("SET LOCAL bizflow.allow_org_lifecycle_update = 'true';");
        await pg.query(
          "UPDATE public.organizations SET is_active = false, closed_at = now(), closed_by = $1 WHERE id = $2;",
          [userAId, orgId]
        );
        await pg.query("COMMIT;");
      } finally {
        await pg.end();
      }

      // 3. User A attempts idempotent replay on the closed organization
      const { data: replayData, error: replayErr } = await userAClient.rpc("create_organization_with_owner", {
        p_name: "Store to Close",
        p_slug: testSlug,
        p_business_type: "Retail",
        p_country: "US",
        p_currency: "USD",
        p_timezone: "UTC",
        p_client_mutation_id: mutationId,
      });

      expect(replayData).toBeNull();
      expect(replayErr).not.toBeNull();
      expect(replayErr?.message).toMatch(/This organization is no longer active|P0015/i);
    });

    it("rejects idempotent replay if creator is no longer an active member of the organization (P0005)", async () => {
      const mutationId = "b0000000-0000-0000-0000-000000000004";
      const testSlug = `loss-store-${Date.now()}`;

      // 1. User A creates organization
      const { data: createData, error: createErr } = await userAClient.rpc("create_organization_with_owner", {
        p_name: "Loss Scenario Store",
        p_slug: testSlug,
        p_business_type: "Retail",
        p_country: "US",
        p_currency: "USD",
        p_timezone: "UTC",
        p_client_mutation_id: mutationId,
      });
      expect(createErr).toBeNull();
      const orgId = (createData as { organization_id: string }).organization_id;
      createdOrgIds.push(orgId);

      // 2. Add User B as active co-owner first so User A can have status changed without violating last active owner invariant
      const { error: addCoOwnerErr } = await adminClient.from("organization_memberships").insert({
        organization_id: orgId,
        user_id: userBId,
        role: "owner",
        status: "active",
      });
      expect(addCoOwnerErr).toBeNull();

      // Now suspend User A (User B remains active owner)
      const { error: updateMemErr } = await adminClient
        .from("organization_memberships")
        .update({ status: "suspended" })
        .eq("organization_id", orgId)
        .eq("user_id", userAId);
      expect(updateMemErr).toBeNull();

      // 3. User A attempts idempotent replay with the same client_mutation_id
      const { data: replayData, error: replayErr } = await userAClient.rpc("create_organization_with_owner", {
        p_name: "Loss Scenario Store",
        p_slug: testSlug,
        p_business_type: "Retail",
        p_country: "US",
        p_currency: "USD",
        p_timezone: "UTC",
        p_client_mutation_id: mutationId,
      });

      expect(replayData).toBeNull();
      expect(replayErr).not.toBeNull();
      expect(replayErr?.message).toMatch(/no longer an active member|P0005/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Concurrent Duplicate Requests
  // ---------------------------------------------------------------------------
  it("serializes concurrent duplicate creation requests with identical mutation id safely", async () => {
    const concurrentMutationId = "b0000000-0000-0000-0000-000000000005";
    const testSlug = `concurrent-store-${Date.now()}`;

    // Execute two concurrent RPC requests simultaneously from two independent promises
    const [res1, res2] = await Promise.all([
      userAClient.rpc("create_organization_with_owner", {
        p_name: "Concurrent Test Store",
        p_slug: testSlug,
        p_business_type: "Retail",
        p_country: "US",
        p_currency: "USD",
        p_timezone: "UTC",
        p_client_mutation_id: concurrentMutationId,
      }),
      userAClient.rpc("create_organization_with_owner", {
        p_name: "Concurrent Test Store",
        p_slug: testSlug,
        p_business_type: "Retail",
        p_country: "US",
        p_currency: "USD",
        p_timezone: "UTC",
        p_client_mutation_id: concurrentMutationId,
      }),
    ]);

    // Both must succeed without unhandled exceptions
    expect(res1.error).toBeNull();
    expect(res2.error).toBeNull();

    const r1 = res1.data as { organization_id: string; is_idempotent_replay: boolean };
    const r2 = res2.data as { organization_id: string; is_idempotent_replay: boolean };

    // Both must point to the identical organization
    expect(r1.organization_id).toBe(r2.organization_id);
    createdOrgIds.push(r1.organization_id);

    // Exactly one is the initial creation and one is an idempotent replay (or both safe)
    const replayFlags = [r1.is_idempotent_replay, r2.is_idempotent_replay];
    expect(replayFlags).toContain(false);

    // Verify only ONE organization was created in the database
    const { count } = await adminClient
      .from("organizations")
      .select("*", { count: "exact", head: true })
      .eq("client_mutation_id", concurrentMutationId)
      .eq("created_by", userAId);

    expect(count).toBe(1);
  });
});
