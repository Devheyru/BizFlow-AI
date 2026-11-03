import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

if (!anonKey || !serviceRoleKey) {
  throw new Error("Missing required Supabase environment keys (NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY)");
}

describe("T020: Database Security Posture & Hardening Verification (FR-008, FR-034)", () => {
  let pgClient: PgClient;
  let anonClient: SupabaseClient;
  let authenticatedClient: SupabaseClient;
  let adminClient: SupabaseClient;
  let testUserId: string;
  const testEmail = `db_sec_user_${Date.now()}@example.com`;
  const testPassword = "Password123!@#Secure";

  const feature002Functions = [
    "create_organization_invitation",
    "validate_invitation_token",
    "accept_organization_invitation",
    "decline_organization_invitation",
    "resend_organization_invitation",
    "revoke_organization_invitation",
    "update_organization_member_role",
    "update_organization_member_status",
    "get_organization_employees",
    "check_user_permission",
  ];

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    anonClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Create verified test user
    const { data: userData, error: userError } = await adminClient.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Security", last_name: "Tester" },
    });

    if (userError || !userData.user) {
      throw new Error(`Failed to create test user: ${userError?.message}`);
    }
    testUserId = userData.user.id;

    authenticatedClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: signInError } = await authenticatedClient.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    });
    if (signInError) {
      throw new Error(`Failed to sign in test user: ${signInError.message}`);
    }
  });

  afterAll(async () => {
    if (testUserId) {
      await adminClient.auth.admin.deleteUser(testUserId);
    }
    await pgClient.end();
  });

  describe("1. Function Ownership & Search Path Hardening", () => {
    it("all Feature 002 stored procedures are owned by postgres role", async () => {
      const res = await pgClient.query(`
        SELECT p.proname, r.rolname AS owner
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_roles r ON r.oid = p.proowner
        WHERE n.nspname = 'public'
          AND p.proname = ANY($1::text[]);
      `, [feature002Functions]);

      expect(res.rows.length).toBe(feature002Functions.length);
      for (const row of res.rows) {
        expect(row.owner).toBe("postgres");
      }
    });

    it("all Feature 002 stored procedures have locked search_path (pg_catalog, public, pg_temp)", async () => {
      const res = await pgClient.query(`
        SELECT p.proname, p.proconfig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = ANY($1::text[]);
      `, [feature002Functions]);

      expect(res.rows.length).toBe(feature002Functions.length);
      for (const row of res.rows) {
        expect(row.proconfig).toBeDefined();
        const hasLockedPath = row.proconfig.some((c: string) =>
          c.startsWith("search_path=") &&
          c.includes("pg_catalog") &&
          c.includes("public") &&
          c.includes("pg_temp")
        );
        expect(hasLockedPath).toBe(true);
      }
    });
  });

  describe("2. Execution Privileges & PUBLIC Revocation", () => {
    it("default execution privilege to PUBLIC is revoked for all 10 functions", async () => {
      const res = await pgClient.query(`
        SELECT p.proname,
               has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = ANY($1::text[]);
      `, [feature002Functions]);

      expect(res.rows.length).toBe(feature002Functions.length);
      for (const row of res.rows) {
        expect(row.public_execute).toBe(false);
      }
    });

    it("validate_invitation_token is explicitly granted to anon, authenticated, and service_role", async () => {
      const res = await pgClient.query(`
        SELECT p.proname,
               has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_execute,
               has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'validate_invitation_token';
      `);

      expect(res.rows.length).toBe(1);
      expect(res.rows[0].anon_execute).toBe(true);
      expect(res.rows[0].auth_execute).toBe(true);
      expect(res.rows[0].service_execute).toBe(true);
    });

    it("privileged functions are NOT granted to anon role", async () => {
      const privilegedFunctions = feature002Functions.filter(f => f !== "validate_invitation_token");
      const res = await pgClient.query(`
        SELECT p.proname,
               has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_execute
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = ANY($1::text[]);
      `, [privilegedFunctions]);

      expect(res.rows.length).toBe(privilegedFunctions.length);
      for (const row of res.rows) {
        expect(row.anon_execute).toBe(false);
        expect(row.auth_execute).toBe(true);
      }
    });
  });

  describe("3. Row-Level Security Enablement & Force Enforcement", () => {
    it("organization_invitations, permissions, and role_permissions have FORCE ROW LEVEL SECURITY enabled", async () => {
      const tables = ["organization_invitations", "permissions", "role_permissions"];
      const res = await pgClient.query(`
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = ANY($1::text[]);
      `, [tables]);

      expect(res.rows.length).toBe(tables.length);
      for (const row of res.rows) {
        expect(row.relrowsecurity).toBe(true);
        expect(row.relforcerowsecurity).toBe(true);
      }
    });
  });

  describe("4. Client Mutation Denial via RLS", () => {
    it("denies direct client INSERT on organization_invitations", async () => {
      const { data, error } = await authenticatedClient
        .from("organization_invitations")
        .insert({
          organization_id: "00000000-0000-0000-0000-000000000001",
          email: "hacker@example.com",
          role: "owner",
          token_hash: "a".repeat(64),
          invited_by: testUserId,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        })
        .select();

      // RLS denial: error code 42501 or empty returned rows with error
      expect(error).toBeDefined();
      expect(data).toBeNull();
    });

    it("denies direct client UPDATE on organization_invitations", async () => {
      const { data } = await authenticatedClient
        .from("organization_invitations")
        .update({ status: "accepted" })
        .eq("status", "pending")
        .select();

      expect(data).toHaveLength(0);
    });

    it("denies direct client DELETE on organization_invitations", async () => {
      const { data } = await authenticatedClient
        .from("organization_invitations")
        .delete()
        .eq("status", "pending")
        .select();

      expect(data).toHaveLength(0);
    });

    it("denies direct client mutations on permissions catalog", async () => {
      const { error: insertErr } = await authenticatedClient
        .from("permissions")
        .insert({
          id: "fake:permission",
          category: "fake",
          description: "Malicious insertion",
        });
      expect(insertErr).toBeDefined();
    });

    it("denies direct client mutations on role_permissions mappings", async () => {
      const { error: insertErr } = await authenticatedClient
        .from("role_permissions")
        .insert({
          role: "cashier",
          permission_id: "employees:remove",
        });
      expect(insertErr).toBeDefined();
    });
  });

  describe("5. Unauthorized Direct RPC Invocation Rejection", () => {
    it("rejects create_organization_invitation from unauthorized caller without active membership (P0004)", async () => {
      const fakeOrgId = "00000000-0000-0000-0000-000000000001";
      const { error } = await authenticatedClient.rpc("create_organization_invitation", {
        p_org_id: fakeOrgId,
        p_email: "test@example.com",
        p_role: "cashier",
        p_token_hash: "b".repeat(64),
        p_expires_at: new Date(Date.now() + 86400000).toISOString(),
      });

      expect(error).toBeDefined();
      expect(error?.code).toBe("P0004");
    });

    it("rejects anon caller attempting to invoke privileged RPCs", async () => {
      const { error } = await anonClient.rpc("get_organization_employees", {
        p_org_id: "00000000-0000-0000-0000-000000000001",
      });

      expect(error).toBeDefined();
    });

    it("restricts check_user_permission: authenticated user cannot probe another user's permissions (returns false)", async () => {
      const fakeOrgId = "00000000-0000-0000-0000-000000000001";
      const otherUserId = "00000000-0000-0000-0000-000000000002";

      // Direct RPC invocation by testUserId attempting to probe otherUserId's authorization info
      const { data, error } = await authenticatedClient.rpc("check_user_permission", {
        p_org_id: fakeOrgId,
        p_user_id: otherUserId,
        p_permission: "employees:read",
      });

      expect(error).toBeNull();
      expect(data).toBe(false);
    });
  });
});

