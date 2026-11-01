import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

test.describe("T033: Organization Onboarding End-to-End User Flows (US2)", () => {
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  test.afterAll(async () => {
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

    for (const uid of createdUserIds) {
      try {
        await adminClient.auth.admin.deleteUser(uid);
      } catch (_) {}
    }
  });

  test("Route Protection: unauthenticated visitor is blocked from onboarding", async ({ page }) => {
    await page.goto("/onboarding/create-organization");
    await page.waitForURL(/\/sign-in/);
    expect(page.url()).toContain("next=%2Fonboarding%2Fcreate-organization");
  });

  test("Validation: blocks submission with empty name and displays error", async ({ page }) => {
    const email = `onboarding_val_${Date.now()}@bizflow-e2e.internal`;
    const password = "P@ssword123!";

    const { data: userData } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: "Val", last_name: "User" },
    });
    if (userData?.user) createdUserIds.push(userData.user.id);

    // Sign in to reach onboarding
    await page.goto("/sign-in");
    await page.getByLabel(/email address/i).fill(email);
    await page.getByLabel(/^password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForURL(/\/onboarding\/create-organization/, { timeout: 15000 });

    // Submit without filling name
    await page.getByRole("button", { name: /create workspace/i }).click();
    await expect(page.getByText(/organization name must be at least 2 characters/i)).toBeVisible();
  });

  test("Successful Store Creation: provisions store and transitions to tenant dashboard", async ({ page }) => {
    const email = `onboarding_owner_${Date.now()}@bizflow-e2e.internal`;
    const password = "P@ssword123!";
    const storeName = `Metro Mart ${Date.now()}`;

    const { data: userData } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: "Metro", last_name: "Owner" },
    });
    if (userData?.user) createdUserIds.push(userData.user.id);

    // 1. Sign in
    await page.goto("/sign-in");
    await page.getByLabel(/email address/i).fill(email);
    await page.getByLabel(/^password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();

    // 2. Automatically guided to onboarding
    await page.waitForURL(/\/onboarding\/create-organization/, { timeout: 15000 });
    await expect(page.getByRole("heading", { name: /set up your retail store/i })).toBeVisible();

    // 3. Complete form
    await page.getByLabel(/business \/ store name/i).fill(storeName);
    await page.getByLabel(/business category \/ type/i).fill("Supermarket");
    await page.getByLabel(/country/i).selectOption("US");
    await page.getByLabel(/currency/i).selectOption("USD");

    // 4. Submit
    await page.getByRole("button", { name: /create workspace/i }).click();

    // 5. Verify redirection to tenant dashboard
    await page.waitForURL(/\/dashboard/, { timeout: 20000 });
    await expect(page.getByRole("heading", { name: new RegExp(storeName, "i") })).toBeVisible();
    await expect(page.getByText(/owner/i)).toBeVisible();

    // Retrieve created org ID for teardown
    const { data: orgData } = await adminClient
      .from("organizations")
      .select("id")
      .eq("created_by", userData!.user!.id)
      .single();
    if (orgData?.id) createdOrgIds.push(orgData.id);
  });
});

