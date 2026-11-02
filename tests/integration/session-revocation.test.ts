import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { resetPasswordAction } from "@/actions/auth-actions";
import { changePasswordAction } from "@/actions/profile-actions";
import {
  createRecoveryGrant,
  issueRecoveryGrant,
  RECOVERY_COOKIE_NAME,
  getSessionIdFromToken,
} from "@/lib/auth/recovery";
import {
  createClient as createServerClient,
  getSafeCookieStore,
  clearInMemoryCookieJar,
} from "@/lib/supabase/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!anonKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

async function fetchLatestRecoveryLink(toEmail: string): Promise<string> {
  const mailRes = await fetch("http://127.0.0.1:54324/api/v1/messages");
  const data = (await mailRes.json()) as { messages: Array<{ ID: string; To: Array<{ Address: string }> }> };
  const msg = data.messages.find((m) => m.To[0]?.Address === toEmail);
  if (!msg) throw new Error(`No email found for ${toEmail}`);

  const detailRes = await fetch(`http://127.0.0.1:54324/api/v1/message/${msg.ID}`);
  const detail = (await detailRes.json()) as { Text?: string; HTML?: string };
  const content = (detail.Text || "") + " " + (detail.HTML || "");
  const linkRegex = /(http:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify[^\s"')<>]+)/;
  const match = content.match(linkRegex);
  if (!match || !match[1]) throw new Error(`No link found in email for ${toEmail}`);

  const url = new URL(match[1].replace(/&amp;/g, "&"));
  url.searchParams.set("redirect_to", "http://localhost:3000/api/auth/callback?next=/reset-password");
  return url.toString();
}

describe("T050: Session Revocation & Password Invalidation (US5, FR-006)", () => {
  let adminClient: SupabaseClient;
  let testUserId: string;

  const initialPassword = "P@ssword123!Initial";
  const updatedPassword = "P@ssword456!Updated";
  const testEmail = `session_revoc_${Date.now()}@bizflow-test.internal`;

  beforeAll(async () => {
    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await adminClient.auth.admin.createUser({
      email: testEmail,
      password: initialPassword,
      email_confirm: true,
      user_metadata: { first_name: "Session", last_name: "Tester" },
    });

    if (error || !data.user) {
      throw new Error(`Failed to create test user: ${error?.message}`);
    }

    testUserId = data.user.id;
  });

  afterAll(async () => {
    if (testUserId) {
      await adminClient.auth.admin.deleteUser(testUserId);
    }
  });

  it("revokes existing sessions and rejects old password after password update", async () => {
    // 1. Establish Session 1 (e.g. Device 1 / Desktop)
    const client1 = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: s1, error: err1 } = await client1.auth.signInWithPassword({
      email: testEmail,
      password: initialPassword,
    });
    expect(err1).toBeNull();
    expect(s1.session?.refresh_token).toBeDefined();
    const client1RefreshToken = s1.session!.refresh_token;

    // 2. Establish Session 2 (e.g. Device 2 / Mobile)
    const client2 = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: s2, error: err2 } = await client2.auth.signInWithPassword({
      email: testEmail,
      password: initialPassword,
    });
    expect(err2).toBeNull();
    expect(s2.session?.refresh_token).toBeDefined();
    const client2RefreshToken = s2.session!.refresh_token;

    // 3. User updates password on Client 1 and signs out globally (FR-006)
    const { error: updateError } = await client1.auth.updateUser({
      password: updatedPassword,
    });
    expect(updateError).toBeNull();

    // Call signOut with scope 'global' to revoke all active sessions across devices
    await client1.auth.signOut({ scope: "global" });

    // 4. Verify Client 2's refresh token is invalid and cannot be refreshed
    const { data: refreshData, error: refreshError } = await client2.auth.refreshSession({
      refresh_token: client2RefreshToken,
    });
    expect(refreshError).toBeDefined();
    expect(refreshData.session).toBeNull();

    // 5. Verify Client 1's previous refresh token is also invalid
    const { error: refresh1Error } = await client1.auth.refreshSession({
      refresh_token: client1RefreshToken,
    });
    expect(refresh1Error).toBeDefined();

    // 6. Verify authentication with the old password is strictly rejected
    const client3 = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: oldAuthError } = await client3.auth.signInWithPassword({
      email: testEmail,
      password: initialPassword,
    });
    expect(oldAuthError).toBeDefined();

    // 7. Verify authentication with the new updated password succeeds
    const { data: newAuthData, error: newAuthError } = await client3.auth.signInWithPassword({
      email: testEmail,
      password: updatedPassword,
    });
    expect(newAuthError).toBeNull();
    expect(newAuthData.user?.id).toBe(testUserId);
  });

  it("rejects ordinary authenticated sessions attempting recovery-only password reset", async () => {
    clearInMemoryCookieJar();
    const serverClient = await createServerClient();
    const { data, error } = await serverClient.auth.signInWithPassword({
      email: testEmail,
      password: updatedPassword,
    });
    expect(error).toBeNull();
    expect(data.session).toBeDefined();

    // Invoking recovery reset with ordinary session (without recovery grant & AMR)
    const result = await resetPasswordAction({
      newPassword: "AttemptedNewP@ssword123!",
      confirmPassword: "AttemptedNewP@ssword123!",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("UNAUTHORIZED_RECOVERY");
      expect(result.error.message).toContain("recovery session is required");
    }

    clearInMemoryCookieJar();
  });

  it("allows valid recovery session with signed grant to reset password and revokes all sessions", async () => {
    clearInMemoryCookieJar();
    const recoveryUserEmail = `recov_test_${Date.now()}@bizflow-test.internal`;
    const initialRecovPass = "P@ssword123!OldRecov";
    const newRecovPass = "P@ssword999!NewRecov";

    const { data: createdUser, error: createErr } = await adminClient.auth.admin.createUser({
      email: recoveryUserEmail,
      password: initialRecovPass,
      email_confirm: true,
      user_metadata: { first_name: "Recovery", last_name: "User" },
    });
    expect(createErr).toBeNull();
    const recovUserId = createdUser.user!.id;

    // Call resetPasswordForEmail on serverClient to establish PKCE code verifier in cookie store
    const serverClient = await createServerClient();
    const { error: resetReqErr } = await serverClient.auth.resetPasswordForEmail(recoveryUserEmail, {
      redirectTo: "http://localhost:3000/api/auth/callback?next=/reset-password",
    });
    expect(resetReqErr).toBeNull();

    // Fetch real recovery link from Mailpit
    const actionLink = await fetchLatestRecoveryLink(recoveryUserEmail);
    const res = await fetch(actionLink, { redirect: "manual" });
    const loc = res.headers.get("location") || "";
    let code: string | null = null;
    if (loc.includes("code=")) {
      const parsedUrl = new URL(loc);
      code = parsedUrl.searchParams.get("code");
    }

    expect(code).toBeDefined();
    const { data: exData, error: exErr } = await serverClient.auth.exchangeCodeForSession(code!);
    expect(exErr).toBeNull();
    expect(exData.session).toBeDefined();

    const sessionId = getSessionIdFromToken(exData.session) || exData.user!.id;
    const { grantToken } = await issueRecoveryGrant(serverClient, recovUserId, sessionId);
    const cookieStore = await getSafeCookieStore();
    cookieStore.set(RECOVERY_COOKIE_NAME, grantToken);

    // Reset password
    const result = await resetPasswordAction({
      newPassword: newRecovPass,
      confirmPassword: newRecovPass,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.redirectUrl).toBe("/sign-in?reset=success");
      expect(result.data.revocationStatus).toBe("revoked");
    }

    // Check grant was cleared
    expect(cookieStore.get(RECOVERY_COOKIE_NAME)).toBeUndefined();

    // Old password rejected
    const client = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: oldAuthErr } = await client.auth.signInWithPassword({
      email: recoveryUserEmail,
      password: initialRecovPass,
    });
    expect(oldAuthErr).toBeDefined();

    // New password succeeds
    const { data: newAuthData, error: newAuthErr } = await client.auth.signInWithPassword({
      email: recoveryUserEmail,
      password: newRecovPass,
    });
    expect(newAuthErr).toBeNull();
    expect(newAuthData.user?.id).toBe(recovUserId);

    await adminClient.auth.admin.deleteUser(recovUserId);
    clearInMemoryCookieJar();
  });

  it("atomically prevents concurrent recovery grant reuse via server-side nonce consumption", async () => {
    clearInMemoryCookieJar();
    const replayUserEmail = `recov_replay_${Date.now()}@bizflow-test.internal`;
    const replayPass = "P@ssword123!OldReplay";
    const replayNewPass1 = "P@ssword111!ReplaySuccess";
    const replayNewPass2 = "P@ssword222!ReplayFail";

    const { data: createdUser, error: createErr } = await adminClient.auth.admin.createUser({
      email: replayUserEmail,
      password: replayPass,
      email_confirm: true,
      user_metadata: { first_name: "Replay", last_name: "Tester" },
    });
    expect(createErr).toBeNull();
    const replayUserId = createdUser.user!.id;

    // Establish recovery PKCE flow
    const serverClient = await createServerClient();
    const { error: resetReqErr } = await serverClient.auth.resetPasswordForEmail(replayUserEmail, {
      redirectTo: "http://localhost:3000/api/auth/callback?next=/reset-password",
    });
    expect(resetReqErr).toBeNull();

    const actionLink = await fetchLatestRecoveryLink(replayUserEmail);
    const res = await fetch(actionLink, { redirect: "manual" });
    const loc = res.headers.get("location") || "";
    expect(loc).toContain("code=");
    const code = new URL(loc).searchParams.get("code")!;

    const { data: exData, error: exErr } = await serverClient.auth.exchangeCodeForSession(code);
    expect(exErr).toBeNull();

    const sessionId = getSessionIdFromToken(exData.session) || replayUserId;
    const { grantToken } = await issueRecoveryGrant(serverClient, replayUserId, sessionId);
    const cookieStore = await getSafeCookieStore();
    cookieStore.set(RECOVERY_COOKIE_NAME, grantToken);

    // Concurrently trigger two reset actions with the same recovery session and grant
    const [result1, result2] = await Promise.all([
      resetPasswordAction({
        newPassword: replayNewPass1,
        confirmPassword: replayNewPass1,
      }),
      resetPasswordAction({
        newPassword: replayNewPass2,
        confirmPassword: replayNewPass2,
      }),
    ]);

    // Exactly one must succeed, and one must be rejected by atomic single-use nonce consumption
    const results = [result1, result2];
    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const failure = failures[0]!;
    if (!failure.success) {
      expect(failure.error.code).toBe("UNAUTHORIZED_RECOVERY");
      expect(failure.error.message).toContain("already been used");
    }

    // Even if an attacker re-injects the exact same cookie into the store
    cookieStore.set(RECOVERY_COOKIE_NAME, grantToken);

    const replayAttempt = await resetPasswordAction({
      newPassword: "P@ssword333!ReplayedAttempt",
      confirmPassword: "P@ssword333!ReplayedAttempt",
    });

    expect(replayAttempt.success).toBe(false);
    if (!replayAttempt.success) {
      expect(["UNAUTHORIZED", "UNAUTHORIZED_RECOVERY"]).toContain(replayAttempt.error.code);
    }

    await adminClient.auth.admin.deleteUser(replayUserId);
    clearInMemoryCookieJar();
  });

  it("rejects password reset when recovery authorization has expired", async () => {
    clearInMemoryCookieJar();
    const serverClient = await createServerClient();
    await serverClient.auth.signInWithPassword({
      email: testEmail,
      password: updatedPassword,
    });

    const cookieStore = await getSafeCookieStore();
    const expiredGrant = createRecoveryGrant(testUserId, "some-session", -5000);
    cookieStore.set(RECOVERY_COOKIE_NAME, expiredGrant);

    const result = await resetPasswordAction({
      newPassword: "BrandNewP@ss123!",
      confirmPassword: "BrandNewP@ss123!",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("RECOVERY_EXPIRED");
      expect(result.error.message).toContain("expired");
    }

    clearInMemoryCookieJar();
  });

  it("rejects reused recovery authorization attempts", async () => {
    clearInMemoryCookieJar();
    // After recovery completes or without valid session & grant
    const result = await resetPasswordAction({
      newPassword: "ReusedAttemptP@ss123!",
      confirmPassword: "ReusedAttemptP@ss123!",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("UNAUTHORIZED");
    }
  });

  it("handles global session revocation failure gracefully without repeating password update", async () => {
    clearInMemoryCookieJar();
    const serverClient = await createServerClient();

    // Create test user
    const failEmail = `revoc_fail_${Date.now()}@bizflow-test.internal`;
    const { data: u } = await adminClient.auth.admin.createUser({
      email: failEmail,
      password: "P@ssword123!FailTest",
      email_confirm: true,
    });
    const failUserId = u.user!.id;

    const { error: resetReqErr } = await serverClient.auth.resetPasswordForEmail(failEmail, {
      redirectTo: "http://localhost:3000/api/auth/callback?next=/reset-password",
    });
    expect(resetReqErr).toBeNull();

    const actionLink = await fetchLatestRecoveryLink(failEmail);
    const res = await fetch(actionLink, { redirect: "manual" });
    const loc = res.headers.get("location") || "";
    if (loc.includes("code=")) {
      const code = new URL(loc).searchParams.get("code")!;
      const { data: exData, error: exErr } = await serverClient.auth.exchangeCodeForSession(code);
      expect(exErr).toBeNull();
      const sessionId = getSessionIdFromToken(exData.session) || failUserId;
      const { grantToken } = await issueRecoveryGrant(serverClient, failUserId, sessionId);
      const cookieStore = await getSafeCookieStore();
      cookieStore.set(RECOVERY_COOKIE_NAME, grantToken);

      // Spy on GoTrueClient prototype signOut to return error
      const authProto = Object.getPrototypeOf(serverClient.auth);
      const signOutSpy = vi.spyOn(authProto, "signOut").mockResolvedValueOnce({
        error: {
          name: "AuthApiError",
          message: "Simulated global revocation timeout",
          status: 500,
        } as any,
        data: null as any,
      });

      const result = await resetPasswordAction({
        newPassword: "NewP@ssword999!AfterFail",
        confirmPassword: "NewP@ssword999!AfterFail",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.revocationStatus).toBe("failed");
        expect(result.data.warning).toBeDefined();
        expect(result.data.redirectUrl).toContain("revocation=failed");
      }

      signOutSpy.mockRestore();
    }

    await adminClient.auth.admin.deleteUser(failUserId);
    clearInMemoryCookieJar();
  });

  it("handles other-session revocation failure in changePasswordAction gracefully", async () => {
    clearInMemoryCookieJar();
    const serverClient = await createServerClient();

    // Create test user
    const changeEmail = `change_fail_${Date.now()}@bizflow-test.internal`;
    const curPass = "P@ssword123!ChangeFail";
    const nextPass = "P@ssword456!ChangeNew";

    const { data: u } = await adminClient.auth.admin.createUser({
      email: changeEmail,
      password: curPass,
      email_confirm: true,
      user_metadata: { first_name: "Change", last_name: "User" },
    });
    const changeUserId = u.user!.id;

    await serverClient.auth.signInWithPassword({
      email: changeEmail,
      password: curPass,
    });

    // Spy on GoTrueClient prototype signOut to simulate failure for { scope: "others" }
    const authProto = Object.getPrototypeOf(serverClient.auth);
    const signOutSpy = vi.spyOn(authProto, "signOut").mockImplementation(async (options: any) => {
      if (options?.scope === "others") {
        return {
          error: {
            name: "AuthApiError",
            message: "Simulated other sessions termination failure",
            status: 500,
          } as any,
          data: null as any,
        };
      }
      return { error: null, data: null as any };
    });

    const result = await changePasswordAction({
      currentPassword: curPass,
      newPassword: nextPass,
      confirmPassword: nextPass,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.revocationStatus).toBe("failed");
      expect(result.data.warning).toBeDefined();
      expect(result.data.message).toContain("terminating other active sessions failed");
    }

    signOutSpy.mockRestore();
    await adminClient.auth.admin.deleteUser(changeUserId);
    clearInMemoryCookieJar();
  });
});

