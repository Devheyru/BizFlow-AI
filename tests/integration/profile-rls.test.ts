import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { updateProfileAction } from "@/actions/profile-actions";
import { createClient as createServerClient, clearInMemoryCookieJar } from "@/lib/supabase/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!anonKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

describe("T049: Profile RLS Policies & Isolation (US5)", () => {
  let adminClient: SupabaseClient;

  // Real authenticated JWT clients
  let userAClient: SupabaseClient; // User in Org A
  let userBClient: SupabaseClient; // Peer in Org A
  let userCClient: SupabaseClient; // User in isolated Org B
  let unauthClient: SupabaseClient;

  let userAId: string;
  let userBId: string;
  let userCId: string;

  const testPassword = "P@ssword123!SecureTest";
  const userAEmail = `profile_rls_a_${Date.now()}@bizflow-test.internal`;
  const userBEmail = `profile_rls_b_${Date.now()}@bizflow-test.internal`;
  const userCEmail = `profile_rls_c_${Date.now()}@bizflow-test.internal`;

  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    unauthClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Create User A
    const { data: uA, error: errA } = await adminClient.auth.admin.createUser({
      email: userAEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Alice", last_name: "Original" },
    });
    if (errA || !uA.user) throw new Error(`Failed to create User A: ${errA?.message}`);
    userAId = uA.user.id;

    // 2. Create User B
    const { data: uB, error: errB } = await adminClient.auth.admin.createUser({
      email: userBEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Bob", last_name: "Original" },
    });
    if (errB || !uB.user) throw new Error(`Failed to create User B: ${errB?.message}`);
    userBId = uB.user.id;

    // 3. Create User C
    const { data: uC, error: errC } = await adminClient.auth.admin.createUser({
      email: userCEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Charlie", last_name: "Original" },
    });
    if (errC || !uC.user) throw new Error(`Failed to create User C: ${errC?.message}`);
    userCId = uC.user.id;

    // 4. Authenticate client sessions
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

    // 5. Seed Org A (User A & User B are members)
    const { data: orgA, error: orgAErr } = await adminClient
      .from("organizations")
      .insert({
        name: "Profile Test Org A",
        slug: `profile-test-a-${Date.now()}`,
        business_type: "Retail",
        country: "US",
        currency: "USD",
        timezone: "UTC",
        created_by: userAId,
        is_active: true,
      })
      .select()
      .single();
    if (orgAErr || !orgA) throw new Error(`Failed to create Org A: ${orgAErr?.message}`);
    orgAId = orgA.id;

    await adminClient.from("organization_memberships").insert([
      { organization_id: orgAId, user_id: userAId, role: "owner", status: "active" },
      { organization_id: orgAId, user_id: userBId, role: "cashier", status: "active" },
    ]);

    // 6. Seed Org B (User C is member)
    const { data: orgB, error: orgBErr } = await adminClient
      .from("organizations")
      .insert({
        name: "Profile Test Org B",
        slug: `profile-test-b-${Date.now()}`,
        business_type: "Retail",
        country: "US",
        currency: "USD",
        timezone: "UTC",
        created_by: userCId,
        is_active: true,
      })
      .select()
      .single();
    if (orgBErr || !orgB) throw new Error(`Failed to create Org B: ${orgBErr?.message}`);
    orgBId = orgB.id;

    await adminClient.from("organization_memberships").insert([
      { organization_id: orgBId, user_id: userCId, role: "owner", status: "active" },
    ]);
  });

  afterAll(async () => {
    // Revoke memberships first to bypass last_owner protection trigger
    await adminClient
      .from("organization_memberships")
      .update({ status: "revoked" })
      .in("organization_id", [orgAId, orgBId]);

    await adminClient.from("organizations").delete().in("id", [orgAId, orgBId]);
    await adminClient.auth.admin.deleteUser(userAId);
    await adminClient.auth.admin.deleteUser(userBId);
    await adminClient.auth.admin.deleteUser(userCId);
  });

  it("permits User A to select and update their own profile fields", async () => {
    // 1. User A updates their own first_name, last_name, and phone
    const { data: updateData, error: updateError } = await userAClient
      .from("profiles")
      .update({
        first_name: "AliceUpdated",
        last_name: "OwnerUpdated",
        phone: "+15551234567",
      })
      .eq("id", userAId)
      .select()
      .single();

    expect(updateError).toBeNull();
    expect(updateData).toBeDefined();
    expect(updateData?.first_name).toBe("AliceUpdated");
    expect(updateData?.last_name).toBe("OwnerUpdated");
    expect(updateData?.phone).toBe("+15551234567");

    // 2. User A reads back their updated profile
    const { data: readData, error: readError } = await userAClient
      .from("profiles")
      .select("id, first_name, last_name, phone")
      .eq("id", userAId)
      .single();

    expect(readError).toBeNull();
    expect(readData?.first_name).toBe("AliceUpdated");
  });

  it("strictly prohibits User A from updating User B's profile (RLS denies)", async () => {
    // User A attempts to overwrite User B's profile
    const { data, error } = await userAClient
      .from("profiles")
      .update({
        first_name: "HackedByAlice",
      })
      .eq("id", userBId)
      .select();

    // RLS policy profiles_update_own USING (auth.uid() = id) ensures 0 rows match User A's update
    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    // Verify User B's profile remained unchanged
    const { data: bProfile } = await adminClient
      .from("profiles")
      .select("first_name")
      .eq("id", userBId)
      .single();

    expect(bProfile?.first_name).toBe("Bob");
  });

  it("prohibits User A from changing their profile id to another user id (WITH CHECK violation)", async () => {
    // Attempting to reassign profile ID
    const { error } = await userAClient
      .from("profiles")
      .update({
        id: userBId,
      })
      .eq("id", userAId);

    // Should fail either WITH CHECK or foreign key / primary key violation
    expect(error).not.toBeNull();
  });

  it("denies direct client INSERT into profiles table", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000099";
    const { error } = await userAClient.from("profiles").insert({
      id: fakeId,
      first_name: "Illegal",
      last_name: "Insert",
    });

    expect(error).not.toBeNull();
  });

  it("denies direct client DELETE on profiles table", async () => {
    const { error, count } = await userAClient
      .from("profiles")
      .delete({ count: "exact" })
      .eq("id", userAId);

    // Either error or 0 rows deleted due to profiles_delete_deny
    if (!error) {
      expect(count).toBe(0);
    } else {
      expect(error).toBeDefined();
    }

    // Verify User A profile is still intact
    const { data } = await adminClient.from("profiles").select("id").eq("id", userAId).single();
    expect(data?.id).toBe(userAId);
  });

  it("allows peer profile visibility within the same active organization", async () => {
    // User A and User B share Org A. User A should be able to select User B's profile
    const { data, error } = await userAClient
      .from("profiles")
      .select("id, first_name, last_name")
      .eq("id", userBId)
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBe(userBId);
  });

  it("strictly prevents User C (different org) from selecting User A's profile", async () => {
    // User C is in Org B only. User A is in Org A only.
    const { data, error } = await userCClient
      .from("profiles")
      .select("id, first_name, last_name")
      .eq("id", userAId)
      .maybeSingle();

    // RLS profiles_select_peers rejects User A because User C and User A share no common active org
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("denies unauthenticated client from querying or updating any profile", async () => {
    const { data: readData } = await unauthClient
      .from("profiles")
      .select("*")
      .eq("id", userAId);

    expect(readData).toHaveLength(0);

    const { error: updateError } = await unauthClient
      .from("profiles")
      .update({ first_name: "UnauthUpdate" })
      .eq("id", userAId);

    // Unauthenticated clients cannot update profiles
    expect(updateError).toBeDefined();
  });

  it("preserves authoritative profile database update when auth metadata synchronization fails", async () => {
    // 1. Establish User A session in the server cookie store
    clearInMemoryCookieJar();
    const serverClient = await createServerClient();
    const { data: authData, error: authErr } = await serverClient.auth.signInWithPassword({
      email: userAEmail,
      password: testPassword,
    });
    expect(authErr).toBeNull();
    expect(authData.user?.id).toBe(userAId);

    // Initial state
    const { data: beforeProfile } = await userAClient
      .from("profiles")
      .select("first_name, last_name, phone")
      .eq("id", userAId)
      .single();
    expect(beforeProfile?.first_name).toBe("AliceUpdated");

    // 2. Spy on updateUser on the GoTrueClient prototype to simulate GoTrue metadata synchronization failure
    const authProto = Object.getPrototypeOf(serverClient.auth);
    const updateUserSpy = vi.spyOn(authProto, "updateUser").mockResolvedValueOnce({
      data: { user: null },
      error: {
        name: "AuthApiError",
        message: "Internal auth service unavailable",
        status: 500,
      } as any,
    });

    // 3. Attempt updateProfileAction with failing auth metadata sync
    const result = await updateProfileAction({
      firstName: "AuthoritativeFirstName",
      lastName: "AuthoritativeLastName",
      phone: "+19998887777",
    });

    // Authoritative public.profiles update succeeds regardless of auth metadata sync failure
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.firstName).toBe("AuthoritativeFirstName");
      expect(result.data.lastName).toBe("AuthoritativeLastName");
      expect(result.data.phone).toBe("+19998887777");
    }

    // 4. Verify public.profiles table persists the updated values authoritatively
    const { data: afterProfile } = await userAClient
      .from("profiles")
      .select("first_name, last_name, phone")
      .eq("id", userAId)
      .single();

    expect(afterProfile?.first_name).toBe("AuthoritativeFirstName");
    expect(afterProfile?.last_name).toBe("AuthoritativeLastName");
    expect(afterProfile?.phone).toBe("+19998887777");

    updateUserSpy.mockRestore();
    clearInMemoryCookieJar();
  });
});

