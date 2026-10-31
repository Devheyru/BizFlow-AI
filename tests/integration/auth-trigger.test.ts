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

if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!anonKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

describe("T015: Auth Triggers and Security Helpers Integration", () => {
  let adminClient: SupabaseClient;
  let testUserVerifiedId: string;
  let testUserUnverifiedId: string;
  const testPassword = "Password123!@#Test";
  const verifiedEmail = `trigger_verified_${Date.now()}@example.com`;
  const unverifiedEmail = `trigger_unverified_${Date.now()}@example.com`;

  let verifiedClient: SupabaseClient;
  let unverifiedClient: SupabaseClient;

  beforeAll(async () => {
    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Create a verified user
    const { data: verData, error: verErr } = await adminClient.auth.admin.createUser({
      email: verifiedEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: {
        first_name: "TriggerFirst",
        last_name: "TriggerLast",
        phone: "+15551234567",
      },
    });
    if (verErr || !verData.user) {
      throw new Error(`Failed to create verified user fixture: ${verErr?.message}`);
    }
    testUserVerifiedId = verData.user.id;

    // 2. Create an unverified user with initial session then clear confirmed_at
    const { data: unvData, error: unvErr } = await adminClient.auth.admin.createUser({
      email: unverifiedEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: {
        first_name: "UnverifiedFirst",
        last_name: "UnverifiedLast",
      },
    });
    if (unvErr || !unvData.user) {
      throw new Error(`Failed to create unverified user fixture: ${unvErr?.message}`);
    }
    testUserUnverifiedId = unvData.user.id;

    // Authenticate clients
    verifiedClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signVerErr } = await verifiedClient.auth.signInWithPassword({
      email: verifiedEmail,
      password: testPassword,
    });
    if (signVerErr) throw new Error(`Sign-in failed for verified user: ${signVerErr.message}`);

    unverifiedClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signUnvErr } = await unverifiedClient.auth.signInWithPassword({
      email: unverifiedEmail,
      password: testPassword,
    });
    if (signUnvErr) throw new Error(`Sign-in failed for unverified user: ${signUnvErr.message}`);

    // Clear confirmed_at for unverified user
    const pg = new PgClient({ connectionString: dbUrl });
    await pg.connect();
    try {
      await pg.query("UPDATE auth.users SET email_confirmed_at = NULL WHERE id = $1", [testUserUnverifiedId]);
    } finally {
      await pg.end();
    }
  }, 30000);

  afterAll(async () => {
    if (testUserVerifiedId) {
      await adminClient.auth.admin.deleteUser(testUserVerifiedId).catch(() => {});
    }
    if (testUserUnverifiedId) {
      await adminClient.auth.admin.deleteUser(testUserUnverifiedId).catch(() => {});
    }
  }, 30000);

  describe("handle_new_user() Trigger on auth.users", () => {
    it("automatically creates a public.profiles record with metadata fields", async () => {
      const { data: profile, error } = await adminClient
        .from("profiles")
        .select("*")
        .eq("id", testUserVerifiedId)
        .single();

      expect(error).toBeNull();
      expect(profile).not.toBeNull();
      expect(profile.id).toBe(testUserVerifiedId);
      expect(profile.first_name).toBe("TriggerFirst");
      expect(profile.last_name).toBe("TriggerLast");
      expect(profile.phone).toBe("+15551234567");
      expect(profile.created_at).toBeDefined();
      expect(profile.updated_at).toBeDefined();
    });

    it("creates a profile with null phone if phone is omitted", async () => {
      const { data: profile, error } = await adminClient
        .from("profiles")
        .select("*")
        .eq("id", testUserUnverifiedId)
        .single();

      expect(error).toBeNull();
      expect(profile).not.toBeNull();
      expect(profile.id).toBe(testUserUnverifiedId);
      expect(profile.first_name).toBe("UnverifiedFirst");
      expect(profile.last_name).toBe("UnverifiedLast");
      expect(profile.phone).toBeNull();
    });
  });

  describe("is_email_verified() Security Helper", () => {
    it("returns true for authenticated user with confirmed email", async () => {
      const { data, error } = await verifiedClient.rpc("is_email_verified");
      expect(error).toBeNull();
      expect(data).toBe(true);
    });

    it("returns false for authenticated user with unconfirmed email", async () => {
      const { data, error } = await unverifiedClient.rpc("is_email_verified");
      expect(error).toBeNull();
      expect(data).toBe(false);
    });
  });
});

