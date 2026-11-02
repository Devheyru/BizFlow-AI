import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

test.describe("T047: Multi-Organization Switching & Persistent Routing (US4)", () => {
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  const testPassword = "P@ssword123!Secure";

  // Test users
  const multiEmail = `e2e_multi_${Date.now()}@bizflow-test.internal`;
  let multiUserId: string;

  const singleEmail = `e2e_single_${Date.now()}@bizflow-test.internal`;
  let singleUserId: string;

  const zeroOrgEmail = `e2e_zero_${Date.now()}@bizflow-test.internal`;

  const suspendedEmail = `e2e_susp_${Date.now()}@bizflow-test.internal`;
  let suspendedUserId: string;

  const revokedEmail = `e2e_revk_${Date.now()}@bizflow-test.internal`;
  let revokedUserId: string;

  const victimOwnerEmail = `e2e_victim_${Date.now()}@bizflow-test.internal`;
  let victimOwnerId: string;

  // Organizations
  const orgMulti1Name = `Downtown Store 1 ${Date.now()}`;
  const orgMulti1Slug = `downtown-store-1-${Date.now()}`;
  let orgMulti1Id: string;

  const orgMulti2Name = `Uptown Store 2 ${Date.now()}`;
  const orgMulti2Slug = `uptown-store-2-${Date.now()}`;
  let orgMulti2Id: string;

  const orgSingleName = `Single Store ${Date.now()}`;
  const orgSingleSlug = `single-store-${Date.now()}`;
  let orgSingleId: string;

  const orgSuspendedName = `Suspended Store ${Date.now()}`;
  const orgSuspendedSlug = `suspended-store-${Date.now()}`;
  let orgSuspendedId: string;

  const orgRevokedName = `Revoked Store ${Date.now()}`;
  const orgRevokedSlug = `revoked-store-${Date.now()}`;
  let orgRevokedId: string;

  const orgClosedName = `Closed Store ${Date.now()}`;
  const orgClosedSlug = `closed-store-${Date.now()}`;
  let orgClosedId: string;

  const victimOrgName = `Victim Store ${Date.now()}`;
  const victimOrgSlug = `victim-store-${Date.now()}`;
  let victimOrgId: string;

  test.beforeAll(async () => {
    // 1. Create Users
    const usersToCreate = [
      { email: multiEmail, meta: { first_name: "Morgan", last_name: "Multi" } },
      { email: singleEmail, meta: { first_name: "Sam", last_name: "Single" } },
      { email: zeroOrgEmail, meta: { first_name: "Zoe", last_name: "Zero" } },
      { email: suspendedEmail, meta: { first_name: "Seth", last_name: "Suspended" } },
      { email: revokedEmail, meta: { first_name: "Rachel", last_name: "Revoked" } },
      { email: victimOwnerEmail, meta: { first_name: "Victor", last_name: "Victim" } },
    ];

    for (const u of usersToCreate) {
      const { data, error } = await adminClient.auth.admin.createUser({
        email: u.email,
        password: testPassword,
        email_confirm: true,
        user_metadata: u.meta,
      });
      if (error || !data.user) {
        throw new Error(`Failed to create test user ${u.email}: ${error?.message}`);
      }
      createdUserIds.push(data.user.id);

      if (u.email === multiEmail) multiUserId = data.user.id;
      if (u.email === singleEmail) singleUserId = data.user.id;
      if (u.email === suspendedEmail) suspendedUserId = data.user.id;
      if (u.email === revokedEmail) revokedUserId = data.user.id;
      if (u.email === victimOwnerEmail) victimOwnerId = data.user.id;
    }

    // 2. Create Organizations
    interface OrgFixtureConfig {
      name: string;
      slug: string;
      created_by: string;
      is_active: boolean;
      closed_at?: string;
      closed_by?: string;
    }

    const orgsToCreate: OrgFixtureConfig[] = [
      { name: orgMulti1Name, slug: orgMulti1Slug, created_by: multiUserId, is_active: true },
      { name: orgMulti2Name, slug: orgMulti2Slug, created_by: multiUserId, is_active: true },
      { name: orgSingleName, slug: orgSingleSlug, created_by: singleUserId, is_active: true },
      { name: orgSuspendedName, slug: orgSuspendedSlug, created_by: suspendedUserId, is_active: true },
      { name: orgRevokedName, slug: orgRevokedSlug, created_by: revokedUserId, is_active: true },
      { name: orgClosedName, slug: orgClosedSlug, created_by: multiUserId, is_active: false, closed_at: new Date().toISOString(), closed_by: multiUserId },
      { name: victimOrgName, slug: victimOrgSlug, created_by: victimOwnerId, is_active: true },
    ];

    for (const org of orgsToCreate) {
      const { data, error } = await adminClient
        .from("organizations")
        .insert({
          name: org.name,
          slug: org.slug,
          business_type: "Retail Store",
          country: "US",
          currency: "USD",
          timezone: "America/New_York",
          is_active: org.is_active,
          created_by: org.created_by,
          closed_at: org.closed_at,
          closed_by: org.closed_by,
        })
        .select()
        .single();
      if (error || !data) {
        throw new Error(`Failed to create org ${org.name}: ${error?.message}`);
      }
      createdOrgIds.push(data.id);

      if (org.slug === orgMulti1Slug) orgMulti1Id = data.id;
      if (org.slug === orgMulti2Slug) orgMulti2Id = data.id;
      if (org.slug === orgSingleSlug) orgSingleId = data.id;
      if (org.slug === orgSuspendedSlug) orgSuspendedId = data.id;
      if (org.slug === orgRevokedSlug) orgRevokedId = data.id;
      if (org.slug === orgClosedSlug) orgClosedId = data.id;
      if (org.slug === victimOrgSlug) victimOrgId = data.id;
    }

    // 3. Seed Memberships with explicit verification
    const membershipsToCreate = [
      // multiUser: Owner in orgMulti1 (oldest), Manager in orgMulti2, Owner in orgClosed (inactive)
      { organization_id: orgMulti1Id, user_id: multiUserId, role: "owner", status: "active" },
      { organization_id: orgMulti2Id, user_id: multiUserId, role: "manager", status: "active" },
      { organization_id: orgClosedId, user_id: multiUserId, role: "owner", status: "active" },

      // singleUser: Owner in orgSingle
      { organization_id: orgSingleId, user_id: singleUserId, role: "owner", status: "active" },

      // suspendedUser: Owner in orgMulti1, but Suspended in orgSuspended
      { organization_id: orgMulti1Id, user_id: suspendedUserId, role: "owner", status: "active" },
      { organization_id: orgSuspendedId, user_id: suspendedUserId, role: "cashier", status: "suspended" },

      // revokedUser: Owner in orgMulti1, but Revoked in orgRevoked
      { organization_id: orgMulti1Id, user_id: revokedUserId, role: "owner", status: "active" },
      { organization_id: orgRevokedId, user_id: revokedUserId, role: "cashier", status: "revoked" },

      // victimOwner: Owner in victimOrg
      { organization_id: victimOrgId, user_id: victimOwnerId, role: "owner", status: "active" },
    ];

    const { data: memData, error: memErr } = await adminClient
      .from("organization_memberships")
      .insert(membershipsToCreate)
      .select();

    if (memErr || !memData || memData.length !== membershipsToCreate.length) {
      throw new Error(`Failed to seed test memberships: ${memErr?.message}`);
    }
  });

  test.afterAll(async () => {
    if (createdOrgIds.length > 0) {
      try {
        await adminClient.from("organization_audit_events").delete().in("organization_id", createdOrgIds);
      } catch (_) {}
      try {
        // Revoke active status first so prevent_last_owner_removal invariant allows deletion
        await adminClient
          .from("organization_memberships")
          .update({ status: "revoked" })
          .in("organization_id", createdOrgIds);
        await adminClient.from("organization_memberships").delete().in("organization_id", createdOrgIds);
      } catch (_) {}
      try {
        await adminClient.from("organizations").delete().in("id", createdOrgIds);
      } catch (_) {}
    }

    for (const uid of createdUserIds) {
      try {
        await adminClient.auth.admin.deleteUser(uid);
      } catch (_) {}
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Multi-Store Navigation, Context Switching & Workspace Refresh Persistence
  // ---------------------------------------------------------------------------
  test("Scenario 1: Multi-Store Navigation, Switch, and Workspace Refresh", async ({ page, context }) => {
    await page.goto("/sign-in");
    await page.getByLabel(/email address/i).fill(multiEmail);
    await page.getByLabel(/^password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Redirection lands on deterministic oldest organization (orgMulti1)
    await page.waitForURL(new RegExp(`/${orgMulti1Slug}/dashboard`), { timeout: 20000 });
    await expect(page.getByRole("heading", { name: new RegExp(orgMulti1Name, "i") })).toBeVisible();

    const switcherTrigger = page.getByTestId("org-switcher-trigger");
    await expect(switcherTrigger).toBeVisible();
    await expect(switcherTrigger).toContainText(orgMulti1Name);
    await expect(switcherTrigger.getByLabel(/Your role: Owner/i)).toBeVisible();

    // Open switcher dropdown
    await switcherTrigger.click();
    const dropdown = page.getByTestId("org-switcher-dropdown");
    await expect(dropdown).toBeVisible();

    // Switch context to Org Multi 2
    await page.getByTestId(`org-item-${orgMulti2Slug}`).click();

    // Verify workspace loaded under Org Multi 2
    await page.waitForURL(new RegExp(`/${orgMulti2Slug}/dashboard`), { timeout: 15000 });
    await expect(page.getByRole("heading", { name: new RegExp(orgMulti2Name, "i") })).toBeVisible();
    await expect(switcherTrigger).toContainText(orgMulti2Name);
    await expect(switcherTrigger.getByLabel(/Your role: Manager/i)).toBeVisible();

    // Verify cookie persisted
    const cookiesAfterSwitch = await context.cookies();
    const activeOrgCookie = cookiesAfterSwitch.find((c) => c.name === "bizflow_active_org");
    expect(activeOrgCookie?.value).toBe(orgMulti2Slug);

    // Refresh workspace and verify state remains stable
    await page.reload();
    await expect(page.getByRole("heading", { name: new RegExp(orgMulti2Name, "i") })).toBeVisible();
    await expect(switcherTrigger).toContainText(orgMulti2Name);
    await expect(switcherTrigger.getByLabel(/Your role: Manager/i)).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // 2. Persistent Routing across Sign-Out and Re-Authentication (FR-021)
  // ---------------------------------------------------------------------------
  test("Scenario 2: Persistent Routing across Sign-Out and Re-Authentication", async ({ page }) => {
    // 1. Sign in as multiUser
    await page.goto("/sign-in");
    await page.getByLabel(/email address/i).fill(multiEmail);
    await page.getByLabel(/^password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 20000 });

    // 2. Switch to Org Multi 2
    await page.getByTestId("org-switcher-trigger").click();
    await page.getByTestId(`org-item-${orgMulti2Slug}`).click();
    await page.waitForURL(new RegExp(`/${orgMulti2Slug}/dashboard`), { timeout: 15000 });

    // 3. Sign out
    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL(/\/sign-in/, { timeout: 15000 });

    // 4. Sign back in
    await page.getByLabel(/email address/i).fill(multiEmail);
    await page.getByLabel(/^password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();

    // 5. Must automatically restore session to Org Multi 2 (FR-021)
    await page.waitForURL(new RegExp(`/${orgMulti2Slug}/dashboard`), { timeout: 20000 });
    await expect(page.getByRole("heading", { name: new RegExp(orgMulti2Name, "i") })).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // 3. Invalid or Stale Organization Preference on Sign-In
  // ---------------------------------------------------------------------------
  test("Scenario 3: Invalid or Stale Organization Preference Falls Back to Deterministic Org", async ({
    page,
    context,
  }) => {
    // Inject stale / nonexistent organization preference
    await context.addCookies([
      {
        name: "bizflow_active_org",
        value: "nonexistent-deleted-store-slug",
        domain: "localhost",
        path: "/",
      },
    ]);

    await page.goto("/sign-in");
    await page.getByLabel(/email address/i).fill(multiEmail);
    await page.getByLabel(/^password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Must ignore stale cookie and fall back deterministically to oldest active organization (Org Multi 1)
    await page.waitForURL(new RegExp(`/${orgMulti1Slug}/dashboard`), { timeout: 20000 });
    await expect(page.getByRole("heading", { name: new RegExp(orgMulti1Name, "i") })).toBeVisible();

    // Verify cookie was updated to valid org
    const cookies = await context.cookies();
    const activeCookie = cookies.find((c) => c.name === "bizflow_active_org");
    expect(activeCookie?.value).toBe(orgMulti1Slug);
  });

  // ---------------------------------------------------------------------------
  // 4. Tampered Organization Cookie Manipulation Attack
  // ---------------------------------------------------------------------------
  test("Scenario 4: Tampered Organization Cookie Manipulation Cannot Bypass Authorization", async ({
    page,
    context,
  }) => {
    // Sign in as singleUser (belongs only to orgSingle)
    await page.goto("/sign-in");
    await page.getByLabel(/email address/i).fill(singleEmail);
    await page.getByLabel(/^password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(new RegExp(`/${orgSingleSlug}/dashboard`), { timeout: 20000 });

    // Attack: Set active org cookie to victim's store
    await context.addCookies([
      {
        name: "bizflow_active_org",
        value: victimOrgSlug,
        domain: "localhost",
        path: "/",
      },
    ]);

    // Attempt to access victim's workspace URL directly
    const response = await page.goto(`/${victimOrgSlug}/dashboard`);

    // Must be rejected by server-side authorization (getTenantContext triggers notFound 404)
    expect([404, 200]).toContain(response?.status());
    await expect(page.getByText(/404|not found|page could not be found/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: new RegExp(victimOrgName, "i") })).not.toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // 5. Suspended Membership Exclusion
  // ---------------------------------------------------------------------------
  test("Scenario 5: Suspended Membership is Excluded from Switcher and Direct Access Denied", async ({
    page,
    context,
  }) => {
    await page.goto("/sign-in");
    await page.getByLabel(/email address/i).fill(suspendedEmail);
    await page.getByLabel(/^password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(new RegExp(`/${orgMulti1Slug}/dashboard`), { timeout: 20000 });

    // Verify switcher does not show suspended store
    await page.getByTestId("org-switcher-trigger").click();
    await expect(page.getByTestId(`org-item-${orgSuspendedSlug}`)).not.toBeVisible();

    // Attempt direct URL access to suspended store
    await context.addCookies([
      {
        name: "bizflow_active_org",
        value: orgSuspendedSlug,
        domain: "localhost",
        path: "/",
      },
    ]);

    await page.goto(`/${orgSuspendedSlug}/dashboard`);
    await expect(page.getByText(/404|not found|page could not be found/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: new RegExp(orgSuspendedName, "i") })).not.toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // 6. Revoked Membership Exclusion
  // ---------------------------------------------------------------------------
  test("Scenario 6: Revoked Membership is Excluded from Switcher and Direct Access Denied", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page.getByLabel(/email address/i).fill(revokedEmail);
    await page.getByLabel(/^password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(new RegExp(`/${orgMulti1Slug}/dashboard`), { timeout: 20000 });

    // Verify switcher does not show revoked store
    await page.getByTestId("org-switcher-trigger").click();
    await expect(page.getByTestId(`org-item-${orgRevokedSlug}`)).not.toBeVisible();

    // Attempt direct URL navigation
    await page.goto(`/${orgRevokedSlug}/dashboard`);
    await expect(page.getByText(/404|not found|page could not be found/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: new RegExp(orgRevokedName, "i") })).not.toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // 7. Closed Organization Inaccessibility
  // ---------------------------------------------------------------------------
  test("Scenario 7: Closed Organization is Excluded from Switcher and Direct Access Denied", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page.getByLabel(/email address/i).fill(multiEmail);
    await page.getByLabel(/^password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(new RegExp(`/${orgMulti1Slug}/dashboard`), { timeout: 20000 });

    // Verify switcher does not show closed store
    await page.getByTestId("org-switcher-trigger").click();
    await expect(page.getByTestId(`org-item-${orgClosedSlug}`)).not.toBeVisible();

    // Direct access to closed store
    await page.goto(`/${orgClosedSlug}/dashboard`);
    await expect(page.getByText(/404|not found|page could not be found/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: new RegExp(orgClosedName, "i") })).not.toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // 8. Single-Organization Sign-In Routing
  // ---------------------------------------------------------------------------
  test("Scenario 8: Single-Organization User Routes Directly to Workspace", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel(/email address/i).fill(singleEmail);
    await page.getByLabel(/^password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Must route directly to single store
    await page.waitForURL(new RegExp(`/${orgSingleSlug}/dashboard`), { timeout: 20000 });
    await expect(page.getByRole("heading", { name: new RegExp(orgSingleName, "i") })).toBeVisible();

    // Switcher shows current store and allows creating another
    const switcher = page.getByTestId("org-switcher-trigger");
    await expect(switcher).toContainText(orgSingleName);
    await switcher.click();
    await expect(page.getByTestId("create-new-store-button")).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // 9. Zero-Organization Sign-In Routing
  // ---------------------------------------------------------------------------
  test("Scenario 9: Verified User with Zero Organizations Routes to Onboarding", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel(/email address/i).fill(zeroOrgEmail);
    await page.getByLabel(/^password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Must route straight to onboarding
    await page.waitForURL(/\/onboarding\/create-organization/, { timeout: 20000 });
    await expect(page.getByRole("heading", { name: /set up your retail store/i })).toBeVisible();
  });
});
