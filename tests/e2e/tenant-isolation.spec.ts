import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

test.describe("T040: Multi-Tenant Workspace Isolation & Context Resolution (US3)", () => {
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  const testPassword = "P@ssword123!Secure";
  const userAEmail = `e2e_tenant_a_${Date.now()}@bizflow-test.internal`;
  const userBEmail = `e2e_tenant_b_${Date.now()}@bizflow-test.internal`;
  const userCEmail = `e2e_tenant_c_${Date.now()}@bizflow-test.internal`; // Suspended user
  const userUnvEmail = `e2e_tenant_unv_${Date.now()}@bizflow-test.internal`;

  let userAId: string;
  let userBId: string;
  let userCId: string;
  let userUnvId: string;

  const orgAName = `Alpha Store ${Date.now()}`;
  const orgBName = `Beta Boutique ${Date.now()}`;
  const orgASlug = `alpha-store-${Date.now()}`;
  const orgBSlug = `beta-boutique-${Date.now()}`;

  let orgAId: string;
  let orgBId: string;

  test.beforeAll(async () => {
    // 1. Create User A (Owner of Org A)
    const { data: uA } = await adminClient.auth.admin.createUser({
      email: userAEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Alice", last_name: "Alpha" },
    });
    userAId = uA!.user!.id;
    createdUserIds.push(userAId);

    // 2. Create User B (Owner of Org B)
    const { data: uB } = await adminClient.auth.admin.createUser({
      email: userBEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Bob", last_name: "Beta" },
    });
    userBId = uB!.user!.id;
    createdUserIds.push(userBId);

    // 3. Create User C (Suspended member in Org A)
    const { data: uC } = await adminClient.auth.admin.createUser({
      email: userCEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Charlie", last_name: "Cashier" },
    });
    userCId = uC!.user!.id;
    createdUserIds.push(userCId);

    // 4. Create Unverified User
    const { data: uUnv } = await adminClient.auth.admin.createUser({
      email: userUnvEmail,
      password: testPassword,
      email_confirm: false,
      user_metadata: { first_name: "Uma", last_name: "Unverified" },
    });
    userUnvId = uUnv!.user!.id;
    createdUserIds.push(userUnvId);

    // 5. Create Org A and Org B
    const { data: orgA } = await adminClient
      .from("organizations")
      .insert({
        name: orgAName,
        slug: orgASlug,
        business_type: "Grocery Store",
        country: "US",
        currency: "USD",
        timezone: "America/New_York",
        created_by: userAId,
        is_active: true,
      })
      .select()
      .single();
    orgAId = orgA!.id;
    createdOrgIds.push(orgAId);

    const { data: orgB } = await adminClient
      .from("organizations")
      .insert({
        name: orgBName,
        slug: orgBSlug,
        business_type: "Jewelry Boutique",
        country: "GB",
        currency: "GBP",
        timezone: "Europe/London",
        created_by: userBId,
        is_active: true,
      })
      .select()
      .single();
    orgBId = orgB!.id;
    createdOrgIds.push(orgBId);

    // 6. Assign memberships
    await adminClient.from("organization_memberships").insert([
      { organization_id: orgAId, user_id: userAId, role: "owner", status: "active" },
      { organization_id: orgAId, user_id: userCId, role: "cashier", status: "suspended" }, // Suspended member!
      { organization_id: orgBId, user_id: userBId, role: "owner", status: "active" },
    ]);
  });

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

  test("1. Unauthenticated visitor is redirected to sign-in with next parameter", async ({ page }) => {
    await page.goto(`/${orgASlug}/dashboard`);
    await page.waitForURL(/\/sign-in/);
    expect(page.url()).toContain(`next=%2F${orgASlug}%2Fdashboard`);
  });

  test("2. Unverified user is redirected to verify-email", async ({ page }) => {
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', userUnvEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');

    await page.waitForURL(/\/verify-email/);
    expect(page.url()).toContain("/verify-email");
    await expect(page.getByRole("heading", { name: /verify your email/i })).toBeVisible();
  });

  test("3. Authorized owner can access their own workspace and see metadata & role", async ({ page }) => {
    // Sign in as User A
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', userAEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');

    // Should redirect to active dashboard
    await page.waitForURL(new RegExp(`/${orgASlug}/dashboard`));
    expect(page.url()).toContain(`/${orgASlug}/dashboard`);

    // Verify workspace layout & dashboard elements
    await expect(page.getByRole("heading", { name: orgAName })).toBeVisible();
    await expect(page.getByLabel("Your role: Owner")).toBeVisible();
    await expect(page.getByRole("banner").getByText(userAEmail)).toBeVisible();
    await expect(page.getByRole("main").getByText("Grocery Store", { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByText("USD")).toBeVisible();
  });

  test("4. Cross-Tenant Protection: User A cannot access Org B by tampering with URL slug", async ({ page }) => {
    // Sign in as User A
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', userAEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');

    await page.waitForURL(new RegExp(`/${orgASlug}/dashboard`));

    // User A attempts to tamper with URL slug to access Org B
    const response = await page.goto(`/${orgBSlug}/dashboard`);

    // Should render 404 Not Found (server-side notFound())
    expect(response?.status()).toBe(404);
    await expect(page.getByText("Page Not Found")).toBeVisible();

    // Verify Org B proprietary data is NOT leaked in the page
    const content = await page.content();
    expect(content).not.toContain(orgBName);
    expect(content).not.toContain("Jewelry Boutique");
  });

  test("5. Suspended member (User C) is denied workspace access", async ({ page }) => {
    // Sign in as User C (suspended in Org A)
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', userCEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');

    // User C has no active organizations, so sign-in action or guard redirects to onboarding
    await page.waitForURL(/\/onboarding\/create-organization/);

    // If User C manually navigates to Org A's dashboard
    const response = await page.goto(`/${orgASlug}/dashboard`);
    // Should render 404 (or redirect to onboarding)
    const url = page.url();
    if (url.includes("/onboarding/create-organization")) {
      expect(url).toContain("/onboarding/create-organization");
    } else {
      expect(response?.status()).toBe(404);
    }
  });

  test("6. Manipulating active-organization cookie cannot bypass server-side authorization", async ({
    page,
    context,
  }) => {
    // Sign in as User A
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', userAEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');

    await page.waitForURL(new RegExp(`/${orgASlug}/dashboard`));

    // Manipulate the cookie to point to Org B
    await context.addCookies([
      {
        name: "bizflow_active_org",
        value: orgBSlug,
        domain: "localhost",
        path: "/",
      },
    ]);

    // Navigate to Org B dashboard -> must still return 404
    const responseB = await page.goto(`/${orgBSlug}/dashboard`);
    expect(responseB?.status()).toBe(404);
    await expect(page.getByText("Page Not Found")).toBeVisible();

    // Navigate to Org A dashboard -> should work normally despite manipulated cookie
    const responseA = await page.goto(`/${orgASlug}/dashboard`);
    expect(responseA?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: orgAName })).toBeVisible();
  });
});

