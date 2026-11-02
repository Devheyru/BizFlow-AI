import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const adminClient: SupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface MailpitMessageSummary {
  ID: string;
  Subject: string;
  To: Array<{ Address: string }>;
  Created: string;
}

interface MailpitMessageDetail {
  ID: string;
  Text: string;
  HTML: string;
}

async function fetchLatestRecoveryLink(toEmail: string): Promise<string> {
  const listRes = await fetch("http://127.0.0.1:54324/api/v1/messages");
  if (!listRes.ok) {
    throw new Error(`Failed to query Mailpit messages: ${listRes.statusText}`);
  }
  const listData = (await listRes.json()) as { messages: MailpitMessageSummary[] };

  // Find messages addressed to this email with password reset subject
  const match = listData.messages.find(
    (m) =>
      m.To.some((recipient) => recipient.Address.toLowerCase() === toEmail.toLowerCase()) &&
      (m.Subject.toLowerCase().includes("reset") || m.Subject.toLowerCase().includes("password"))
  );

  if (!match) {
    throw new Error(`No password reset email found in Mailpit for ${toEmail}`);
  }

  const detailRes = await fetch(`http://127.0.0.1:54324/api/v1/message/${match.ID}`);
  if (!detailRes.ok) {
    throw new Error(`Failed to fetch Mailpit message detail for ${match.ID}`);
  }
  const detail = (await detailRes.json()) as MailpitMessageDetail;

  // Extract link from Text or HTML
  const linkRegex = /(http:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify[^\s"')<>]+)/;
  const matchLink = detail.Text.match(linkRegex) || detail.HTML.match(linkRegex);

  if (!matchLink || !matchLink[1]) {
    throw new Error(`Could not extract verification link from email content for ${toEmail}`);
  }

  const url = new URL(matchLink[1]);
  url.searchParams.set("redirect_to", "http://localhost:3000/api/auth/callback?next=/reset-password");
  return url.toString();
}

test.describe("T058: Profile Management & Password Recovery E2E (US5)", () => {
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  test.afterAll(async () => {
    // Teardown: revoke memberships and remove orgs and users
    if (createdOrgIds.length > 0) {
      await adminClient
        .from("organization_memberships")
        .update({ status: "revoked" })
        .in("organization_id", createdOrgIds);

      await adminClient.from("organizations").delete().in("id", createdOrgIds);
    }

    for (const uid of createdUserIds) {
      try {
        await adminClient.auth.admin.deleteUser(uid);
      } catch {
        // Ignore deletion errors
      }
    }
  });

  test("Direct access to /reset-password without session displays expired link warning", async ({
    page,
  }) => {
    await page.goto("/reset-password");

    await expect(page.getByRole("heading", { name: /invalid or expired link/i })).toBeVisible();
    await expect(page.getByText(/this password reset link is invalid or has expired/i)).toBeVisible();

    const requestNewButton = page.getByRole("button", { name: /request new reset link/i });
    await expect(requestNewButton).toBeVisible();

    await requestNewButton.click();
    await page.waitForURL(/\/forgot-password/);
  });

  test("Ordinary authenticated session attempting to access /reset-password displays invalid/expired warning", async ({
    page,
  }) => {
    // 1. Create and sign in as normal user
    const email = `ordinary_user_${Date.now()}@bizflow-e2e.internal`;
    const password = "P@ssword123!Normal";
    const { data: uData } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: "Normal", last_name: "User" },
    });
    createdUserIds.push(uData.user!.id);

    // Sign in normally
    await page.goto("/sign-in");
    await page.getByLabel(/email address/i).fill(email);
    await page.getByLabel(/^password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Guided to onboarding or dashboard
    await page.waitForURL(/\/(onboarding|dashboard)/);

    // 2. Now attempt to navigate to /reset-password while authenticated
    await page.goto("/reset-password");

    // Must be blocked with "Invalid or Expired Link" warning because ordinary session lacks recovery authorization
    await expect(page.getByRole("heading", { name: /invalid or expired link/i })).toBeVisible();
    await expect(page.getByText(/this password reset link is invalid or has expired/i)).toBeVisible();
  });

  test("Forgot Password: demonstrates anti-enumeration and validation", async ({ page }) => {
    await page.goto("/forgot-password");

    await expect(page.getByRole("heading", { name: /reset your password/i })).toBeVisible();

    // 1. Submit empty email
    await page.getByRole("button", { name: /send reset link/i }).click();
    await expect(page.getByText(/email address is required/i)).toBeVisible();

    // 2. Submit non-existent email -> should display generic success (anti-enumeration)
    await page.getByLabel(/email address/i).fill("nonexistent-retailer@example.com");
    await page.getByRole("button", { name: /send reset link/i }).click();

    await expect(page.getByRole("heading", { name: /check your inbox/i })).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByText(/if an account exists with this email, a password reset link has been sent/i)
    ).toBeVisible();
  });

  test("Profile Settings: view, update personal details, and verify persistence after reload", async ({
    page,
  }) => {
    const email = `profile_user_${Date.now()}@bizflow-e2e.internal`;
    const password = "P@ssword123!Secure";
    const initialFirst = "ProfileFirst";
    const initialLast = "ProfileLast";

    // Create verified user
    const { data: uData, error: uErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: initialFirst, last_name: initialLast },
    });
    expect(uErr).toBeNull();
    const userId = uData.user!.id;
    createdUserIds.push(userId);

    // Create test organization
    const { data: orgData, error: orgErr } = await adminClient
      .from("organizations")
      .insert({
        name: "Profile Test Store",
        slug: `profile-store-${Date.now()}`,
        business_type: "Retail",
        country: "US",
        currency: "USD",
        timezone: "UTC",
        created_by: userId,
        is_active: true,
      })
      .select()
      .single();
    expect(orgErr).toBeNull();
    const orgId = orgData!.id;
    createdOrgIds.push(orgId);

    await adminClient.from("organization_memberships").insert({
      organization_id: orgId,
      user_id: userId,
      role: "owner",
      status: "active",
    });

    // Sign in
    await page.goto("/sign-in");
    await page.getByLabel(/email address/i).fill(email);
    await page.getByLabel(/^password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Wait until landed in tenant dashboard
    await page.waitForURL(new RegExp(`/${orgData!.slug}/dashboard`), { timeout: 15000 });

    // Click Settings in Tenant Header
    const settingsLink = page.getByRole("link", { name: /account settings/i });
    await expect(settingsLink).toBeVisible();
    await settingsLink.click();

    // Wait for /settings/profile
    await page.waitForURL(/\/settings\/profile/);
    await expect(page.getByRole("heading", { name: /account settings/i })).toBeVisible();

    // Verify email is disabled and marked Verified
    const emailInput = page.locator('input[type="email"]');
    await expect(emailInput).toHaveValue(email);
    await expect(emailInput).toBeDisabled();
    await expect(page.getByText(/^verified$/i)).toBeVisible();

    // Verify initial names
    await expect(page.getByLabel(/first name/i)).toHaveValue(initialFirst);
    await expect(page.getByLabel(/last name/i)).toHaveValue(initialLast);

    // Update names and phone
    const updatedFirst = "UpdatedFirstName";
    const updatedLast = "UpdatedLastName";
    const updatedPhone = "+15559876543";

    await page.getByLabel(/first name/i).fill(updatedFirst);
    await page.getByLabel(/last name/i).fill(updatedLast);
    await page.getByLabel(/phone number/i).fill(updatedPhone);

    const saveButton = page.getByRole("button", { name: /save changes/i });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // Expect success alert
    await expect(page.getByRole("heading", { name: /profile updated/i })).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByText(/your profile has been updated successfully/i)
    ).toBeVisible();

    // Reload the page and assert persistence
    await page.reload();
    await expect(page.getByLabel(/first name/i)).toHaveValue(updatedFirst);
    await expect(page.getByLabel(/last name/i)).toHaveValue(updatedLast);
    await expect(page.getByLabel(/phone number/i)).toHaveValue(updatedPhone);
  });

  test("In-App Password Change: rejects invalid attempts and succeeds with valid credentials", async ({
    page,
  }) => {
    const email = `change_pwd_${Date.now()}@bizflow-e2e.internal`;
    const initialPassword = "P@ssword123!Old";
    const newPassword = "P@ssword456!NewStrong";

    const { data: uData } = await adminClient.auth.admin.createUser({
      email,
      password: initialPassword,
      email_confirm: true,
      user_metadata: { first_name: "Change", last_name: "Tester" },
    });
    const userId = uData.user!.id;
    createdUserIds.push(userId);

    const { data: orgData } = await adminClient
      .from("organizations")
      .insert({
        name: "Change Password Store",
        slug: `change-pwd-store-${Date.now()}`,
        business_type: "Retail",
        country: "US",
        currency: "USD",
        timezone: "UTC",
        created_by: userId,
        is_active: true,
      })
      .select()
      .single();
    const orgId = orgData!.id;
    createdOrgIds.push(orgId);

    await adminClient.from("organization_memberships").insert({
      organization_id: orgId,
      user_id: userId,
      role: "owner",
      status: "active",
    });

    // Sign in and go to settings
    await page.goto("/sign-in");
    await page.getByLabel(/email address/i).fill(email);
    await page.getByLabel(/^password/i).fill(initialPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(new RegExp(`/${orgData!.slug}/dashboard`));

    await page.goto("/settings/profile");
    await expect(page.getByRole("heading", { name: /change password/i })).toBeVisible();

    // 1. Submit with incorrect current password
    await page.getByLabel(/current password/i).fill("WrongCurrentPassword!");
    await page.getByLabel(/^new password/i).fill(newPassword);
    await page.getByLabel(/confirm new password/i).fill(newPassword);
    await page.getByRole("button", { name: /update password/i }).click();

    await expect(page.getByRole("heading", { name: /password change failed/i })).toBeVisible();
    await expect(page.getByText(/current password is incorrect/i)).toBeVisible();

    // 2. Submit with new password identical to current password
    await page.getByLabel(/current password/i).fill(initialPassword);
    await page.getByLabel(/^new password/i).fill(initialPassword);
    await page.getByLabel(/confirm new password/i).fill(initialPassword);
    await page.getByRole("button", { name: /update password/i }).click();

    await expect(
      page.getByText(/new password must be different from current password/i)
    ).toBeVisible();

    // 3. Submit with mismatched confirm password
    await page.getByLabel(/^new password/i).fill(newPassword);
    await page.getByLabel(/confirm new password/i).fill("MismatchedPassword123!");
    await page.getByRole("button", { name: /update password/i }).click();

    await expect(page.getByText(/new passwords do not match/i)).toBeVisible();

    // 4. Submit valid password change
    await page.getByLabel(/current password/i).fill(initialPassword);
    await page.getByLabel(/^new password/i).fill(newPassword);
    await page.getByLabel(/confirm new password/i).fill(newPassword);
    await page.getByRole("button", { name: /update password/i }).click();

    await expect(page.getByRole("heading", { name: /password changed/i })).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByText(/your password has been changed successfully/i)
    ).toBeVisible();

    // 5. Sign out and sign in with the new password
    await page.context().clearCookies();
    await page.goto("/sign-in");
    await page.getByLabel(/email address/i).fill(email);
    await page.getByLabel(/^password/i).fill(newPassword);
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForURL(new RegExp(`/${orgData!.slug}/dashboard`));
  });

  test("End-to-End Password Recovery Flow via Email Link", async ({ page }) => {
    const email = `recovery_e2e_${Date.now()}@bizflow-e2e.internal`;
    const initialPassword = "P@ssword123!OldRecov";
    const resetPassword = "P@ssword999!NewRecov";

    const { data: uData } = await adminClient.auth.admin.createUser({
      email,
      password: initialPassword,
      email_confirm: true,
      user_metadata: { first_name: "Recovery", last_name: "Tester" },
    });
    const userId = uData.user!.id;
    createdUserIds.push(userId);

    // 1. Visit /forgot-password and submit request
    await page.goto("/forgot-password");
    await page.getByLabel(/email address/i).fill(email);
    await page.getByRole("button", { name: /send reset link/i }).click();

    await expect(page.getByRole("heading", { name: /check your inbox/i })).toBeVisible({
      timeout: 15000,
    });

    // 2. Fetch the verification URL from Mailpit
    const recoveryLink = await fetchLatestRecoveryLink(email);
    expect(recoveryLink).toContain("http://127.0.0.1:54321/auth/v1/verify");

    // 3. Navigate to the recovery link in browser
    await page.goto(recoveryLink);

    // The callback route exchanges code and redirects to /reset-password
    await page.waitForURL(/\/reset-password/, { timeout: 15000 });
    await expect(page.getByRole("heading", { name: /create new password/i })).toBeVisible();

    // 4. Fill in new compliant password
    await page.getByLabel(/^new password/i).fill(resetPassword);
    await page.getByLabel(/confirm new password/i).fill(resetPassword);
    await page.getByRole("button", { name: /update password/i }).click();

    // 5. Expect redirection to /sign-in?reset=success
    await page.waitForURL(/\/sign-in\?reset=success/, { timeout: 15000 });
    await expect(page.getByRole("heading", { name: /password updated/i })).toBeVisible();
    await expect(
      page.getByText(/your password has been successfully updated/i)
    ).toBeVisible();

    // 6. Sign in with the old password -> rejected
    await page.getByLabel(/email address/i).fill(email);
    await page.getByLabel(/^password/i).fill(initialPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByText(/invalid email or password/i)).toBeVisible();

    // 7. Sign in with the new password -> succeeds
    await page.getByLabel(/email address/i).fill(email);
    await page.getByLabel(/^password/i).fill(resetPassword);
    await page.getByRole("button", { name: /sign in/i }).click();

    // User has 0 orgs, so guided to /onboarding/create-organization
    await page.waitForURL(/\/onboarding\/create-organization/, { timeout: 15000 });
  });
});
