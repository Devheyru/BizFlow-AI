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

test.describe("T025: Authentication End-to-End User Flows", () => {
  const createdUserIds: string[] = [];

  test.afterAll(async () => {
    // Clean up seeded test users
    for (const uid of createdUserIds) {
      try {
        await adminClient.auth.admin.deleteUser(uid);
      } catch {
        // Ignore deletion errors during cleanup
      }
    }
  });

  test("Registration Flow: validates form and displays verification pending state", async ({
    page,
  }) => {
    await page.goto("/sign-up");

    // Check heading
    await expect(page.getByRole("heading", { name: /create your account/i })).toBeVisible();

    // 1. Submit empty form to trigger validation errors
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page.getByText(/first name is required/i)).toBeVisible();
    await expect(page.getByText(/last name is required/i)).toBeVisible();
    await expect(page.getByText(/email address is required/i)).toBeVisible();

    // 2. Submit password that fails complexity
    await page.getByLabel(/first name/i).fill("Alex");
    await page.getByLabel(/last name/i).fill("Retailer");
    await page.getByLabel(/email address/i).fill("alex.retailer@example.internal");
    await page.getByLabel(/^password/i).fill("simple");
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(
      page.getByText(/password must be at least 8 characters/i)
    ).toBeVisible();

    // 3. Complete registration with compliant credentials
    const uniqueEmail = `alex.retailer.${Date.now()}@bizflow-e2e.internal`;
    await page.getByLabel(/email address/i).fill(uniqueEmail);
    await page.getByLabel(/^password/i).fill("P@ssword123!");
    await page.getByRole("button", { name: /create account/i }).click();

    // 4. Verification pending screen displays
    await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(/verification pending/i)).toBeVisible();
  });

  test("Email Verification Screen: allows resending verification link", async ({ page }) => {
    await page.goto("/verify-email?email=test-owner@retailflow.internal");

    await expect(page.getByRole("heading", { name: /verify your email/i })).toBeVisible();
    await expect(page.locator('input[type="email"]')).toHaveValue(
      "test-owner@retailflow.internal"
    );

    // Trigger resend
    await page.getByRole("button", { name: /resend verification email/i }).click();

    // Verify neutral success alert
    await expect(page.getByRole("heading", { name: /^email sent$/i })).toBeVisible();
    await expect(page.getByText(/if an account exists/i)).toBeVisible();
  });

  test("Sign-In Flow: rejects invalid credentials with secure generic alert", async ({ page }) => {
    await page.goto("/sign-in");

    await page.getByLabel(/email address/i).fill("nonexistent@bizflow.internal");
    await page.getByLabel(/^password/i).fill("WrongPassword123!");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  });

  test("Sign-In Flow: redirects unverified user to /verify-email", async ({ page }) => {
    const unverifiedEmail = `unverified.${Date.now()}@bizflow-e2e.internal`;
    const password = "P@ssword123!";

    const { data: userData, error: createError } = await adminClient.auth.admin.createUser({
      email: unverifiedEmail,
      password,
      email_confirm: false,
      user_metadata: { first_name: "Unverified", last_name: "User" },
    });

    expect(createError).toBeNull();
    if (userData.user) {
      createdUserIds.push(userData.user.id);
    }

    await page.goto("/sign-in");
    await page.getByLabel(/email address/i).fill(unverifiedEmail);
    await page.getByLabel(/^password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Expect redirect to /verify-email
    await page.waitForURL(/\/verify-email/);
    await expect(page.getByRole("heading", { name: /verify your email/i })).toBeVisible();
  });

  test("Sign-In Flow: verified user with 0 orgs is routed to /onboarding/create-organization", async ({
    page,
  }) => {
    const verifiedEmail = `verified0org.${Date.now()}@bizflow-e2e.internal`;
    const password = "P@ssword123!";

    const { data: userData, error: createError } = await adminClient.auth.admin.createUser({
      email: verifiedEmail,
      password,
      email_confirm: true,
      user_metadata: { first_name: "Verified", last_name: "Owner" },
    });

    expect(createError).toBeNull();
    if (userData.user) {
      createdUserIds.push(userData.user.id);
    }

    await page.goto("/sign-in");
    await page.getByLabel(/email address/i).fill(verifiedEmail);
    await page.getByLabel(/^password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Expect navigation to onboarding route
    await page.waitForURL(/\/onboarding\/create-organization/, { timeout: 15000 });
  });

  test("Route Protection: unauthenticated visitor is redirected to /sign-in", async ({ page }) => {
    // Try visiting protected onboarding page directly
    await page.goto("/onboarding/create-organization");
    await page.waitForURL(/\/sign-in/);
    expect(page.url()).toContain("/sign-in");

    // Try visiting protected tenant dashboard page directly
    await page.goto("/acme-store/dashboard");
    await page.waitForURL(/\/sign-in/);
    expect(page.url()).toContain("/sign-in");
  });
});

