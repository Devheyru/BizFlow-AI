import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { signInAction } from "@/actions/auth-actions";
import { createOrganizationAction } from "@/actions/organization-actions";

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

describe("T030: createOrganizationAction Server Action Integration Tests (US2)", () => {
  let adminClient: SupabaseClient;
  let verifiedUserId: string;
  let unverifiedUserId: string;

  const testPassword = "Password123!@#Action";
  const verifiedUserEmail = `action_verified_${Date.now()}@example.com`;
  const unverifiedUserEmail = `action_unverified_${Date.now()}@example.com`;

  const createdOrgIds: string[] = [];

  beforeAll(async () => {
    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Create verified user
    const { data: vData, error: vErr } = await adminClient.auth.admin.createUser({
      email: verifiedUserEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Action", last_name: "Owner" },
    });
    if (vErr || !vData.user) throw new Error(`Failed to create verified user: ${vErr?.message}`);
    verifiedUserId = vData.user.id;

    // 2. Create unverified user
    const { data: uvData, error: uvErr } = await adminClient.auth.admin.createUser({
      email: unverifiedUserEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Action", last_name: "Unverified" },
    });
    if (uvErr || !uvData.user) throw new Error(`Failed to create unverified user: ${uvErr?.message}`);
    unverifiedUserId = uvData.user.id;

    const pg = new PgClient({ connectionString: dbUrl });
    await pg.connect();
    try {
      await pg.query("UPDATE auth.users SET email_confirmed_at = NULL WHERE id = $1", [unverifiedUserId]);
    } finally {
      await pg.end();
    }
  });

  afterAll(async () => {
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

    for (const uId of [verifiedUserId, unverifiedUserId].filter(Boolean)) {
      try {
        await adminClient.auth.admin.deleteUser(uId);
      } catch (_) {}
    }
  });

  it("rejects creation with validation errors when given invalid payload", async () => {
    const result = await createOrganizationAction({
      name: "",
      businessType: "",
      country: "USA", // invalid ISO
      currency: "US", // invalid ISO
      timezone: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect(result.error.details).toBeDefined();
    }
  });

  it("rejects unauthenticated caller attempting to invoke createOrganizationAction (P0003)", async () => {
    const result = await createOrganizationAction({
      name: "Unauthenticated Store",
      businessType: "Retail",
      country: "US",
      currency: "USD",
      timezone: "America/New_York",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("P0003");
      expect(result.error.message).toMatch(/Authentication required/i);
    }
  });

  it("rejects authenticated user with unverified email (P0001)", async () => {
    // 1. Set email_confirmed_at temporarily so signInAction succeeds and sets session cookies
    const pg = new PgClient({ connectionString: dbUrl });
    await pg.connect();
    try {
      await pg.query("UPDATE auth.users SET email_confirmed_at = now() WHERE id = $1", [unverifiedUserId]);
      const signRes = await signInAction({
        email: unverifiedUserEmail,
        password: testPassword,
      });
      expect(signRes.success).toBe(true);

      // 2. Clear email_confirmed_at so user has valid session token but unconfirmed email
      await pg.query("UPDATE auth.users SET email_confirmed_at = NULL WHERE id = $1", [unverifiedUserId]);
    } finally {
      await pg.end();
    }

    const result = await createOrganizationAction({
      name: "Unverified Store Action",
      businessType: "Retail",
      country: "US",
      currency: "USD",
      timezone: "UTC",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("P0001");
      expect(result.error.message).toMatch(/Email verification required/i);
    }
  });

  it("successfully creates organization for verified user, returning redirectUrl and setting active org cookie", async () => {
    // Sign in as verified user
    const signInRes = await signInAction({
      email: verifiedUserEmail,
      password: testPassword,
    });
    expect(signInRes.success).toBe(true);

    const mutationId = "c0000000-0000-0000-0000-000000000001";
    const result = await createOrganizationAction({
      name: "Sunrise Retail Hub",
      businessType: "Grocery Store",
      country: "US",
      currency: "USD",
      timezone: "America/New_York",
      clientMutationId: mutationId,
      taxId: "TAX-778899",
      phone: "+15551239876",
      email: "contact@sunriseretail.com",
      address: "500 Market St, Suite 10",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Sunrise Retail Hub");
      expect(result.data.role).toBe("owner");
      expect(result.data.isActive).toBe(true);
      expect(result.data.isIdempotentReplay).toBe(false);
      expect(result.data.redirectUrl).toBe(`/${result.data.slug}/dashboard`);

      createdOrgIds.push(result.data.id);
    }
  });

  it("returns idempotent replay when invoking action again with identical clientMutationId", async () => {
    const mutationId = "c0000000-0000-0000-0000-000000000001"; // same mutation ID as above

    const replayResult = await createOrganizationAction({
      name: "Sunrise Retail Hub Renamed",
      businessType: "Grocery Store",
      country: "US",
      currency: "USD",
      timezone: "America/New_York",
      clientMutationId: mutationId,
    });

    expect(replayResult.success).toBe(true);
    if (replayResult.success) {
      expect(replayResult.data.name).toBe("Sunrise Retail Hub"); // original name preserved
      expect(replayResult.data.role).toBe("owner");
      expect(replayResult.data.isActive).toBe(true);
      expect(replayResult.data.isIdempotentReplay).toBe(true);
    }
  });

  it("rejects idempotent replay if organization was closed (P0015)", async () => {
    const mutationId = "c0000000-0000-0000-0000-000000000002";

    // 1. Create org
    const createRes = await createOrganizationAction({
      name: "Store to Close via Action",
      businessType: "Retail",
      country: "US",
      currency: "USD",
      timezone: "America/New_York",
      clientMutationId: mutationId,
    });
    expect(createRes.success).toBe(true);
    if (createRes.success) createdOrgIds.push(createRes.data.id);

    // 2. Soft-close organization via direct postgres connection using lifecycle flag
    const pg = new PgClient({ connectionString: dbUrl });
    await pg.connect();
    try {
      await pg.query("BEGIN;");
      await pg.query("SET LOCAL bizflow.allow_org_lifecycle_update = 'true';");
      await pg.query(
        "UPDATE public.organizations SET is_active = false, closed_at = now(), closed_by = $1 WHERE id = $2;",
        [verifiedUserId, (createRes as { success: true; data: { id: string } }).data.id]
      );
      await pg.query("COMMIT;");
    } finally {
      await pg.end();
    }

    // 3. Attempt replay on closed organization
    const replayRes = await createOrganizationAction({
      name: "Store to Close via Action",
      businessType: "Retail",
      country: "US",
      currency: "USD",
      timezone: "America/New_York",
      clientMutationId: mutationId,
    });

    expect(replayRes.success).toBe(false);
    if (!replayRes.success) {
      expect(replayRes.error.code).toBe("P0015");
      expect(replayRes.error.message).toMatch(/no longer active/i);
    }
  });
});
