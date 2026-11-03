import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

test.describe("T062: Employee Management & RBAC End-to-End Workflow (US1–US5)", () => {
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  const testPassword = "P@ssword123!Secure";
  const timestamp = Date.now();

  const ownerEmail = `e2e_owner_${timestamp}@bizflow-test.internal`;
  const employeeEmail = `e2e_employee_${timestamp}@bizflow-test.internal`;

  let ownerId: string;
  let employeeId: string;

  const orgName = `E2E Workforce Store ${timestamp}`;
  const orgSlug = `e2e-workforce-${timestamp}`;
  let orgId: string;

  test.beforeAll(async () => {
    // 1. Create Owner User
    const { data: oData } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Owen", last_name: "Owner" },
    });
    ownerId = oData!.user!.id;
    createdUserIds.push(ownerId);

    // 2. Create Employee User
    const { data: eData } = await adminClient.auth.admin.createUser({
      email: employeeEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Emma", last_name: "Employee" },
    });
    employeeId = eData!.user!.id;
    createdUserIds.push(employeeId);

    // 3. Create Organization with Owner
    const { data: org } = await adminClient
      .from("organizations")
      .insert({
        name: orgName,
        slug: orgSlug,
        business_type: "Retail Store",
        country: "US",
        currency: "USD",
        timezone: "America/New_York",
        created_by: ownerId,
        is_active: true,
      })
      .select()
      .single();
    orgId = org!.id;
    createdOrgIds.push(orgId);

    // 4. Assign Owner membership
    await adminClient.from("organization_memberships").insert({
      organization_id: orgId,
      user_id: ownerId,
      role: "owner",
      status: "active",
    });
  });

  test.afterAll(async () => {
    if (createdOrgIds.length > 0) {
      try {
        await adminClient.from("organization_audit_events").delete().in("organization_id", createdOrgIds);
      } catch (_) {}
      try {
        await adminClient.from("organization_invitations").delete().in("organization_id", createdOrgIds);
      } catch (_) {}
      try {
        await adminClient.from("organization_memberships").delete().in("organization_id", createdOrgIds);
      } catch (_) {}
      for (const oId of createdOrgIds) {
        try {
          await adminClient.from("organizations").delete().eq("id", oId);
        } catch (_) {}
      }
    }

    for (const uid of createdUserIds) {
      try {
        await adminClient.auth.admin.deleteUser(uid);
      } catch (_) {}
    }
  });

  test("Complete workforce management workflow: invite -> accept -> role elevation -> suspension lockout", async ({
    browser,
  }) => {
    // 1. Owner Browser Context
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();

    // Owner signs in
    await ownerPage.goto("/sign-in");
    await ownerPage.fill('input[type="email"]', ownerEmail);
    await ownerPage.fill('input[type="password"]', testPassword);
    await ownerPage.click('button[type="submit"]');

    await ownerPage.waitForURL(new RegExp(`/${orgSlug}/dashboard`));

    // Owner navigates to Employee Directory
    await ownerPage.goto(`/${orgSlug}/employees`);
    await expect(ownerPage.getByRole("heading", { name: "Employee Directory" })).toBeVisible();

    // Verify Owner is displayed in table
    await expect(ownerPage.getByText(ownerEmail)).toBeVisible();
    await expect(ownerPage.getByText("Owen Owner")).toBeVisible();

    // 2. Create pending invitation for Employee
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 86400000).toISOString();

    await adminClient.from("organization_invitations").insert({
      organization_id: orgId,
      email: employeeEmail,
      role: "cashier",
      token_hash: tokenHash,
      invited_by: ownerId,
      status: "pending",
      expires_at: expiresAt,
    });

    // Verify Pending Invitations tab shows the pending invitation
    await ownerPage.getByRole("tab", { name: /pending invitations/i }).click();
    await expect(ownerPage.getByText(employeeEmail)).toBeVisible();

    // 3. Employee Browser Context
    const employeeContext = await browser.newContext();
    const employeePage = await employeeContext.newPage();

    // Employee signs in first
    await employeePage.goto("/sign-in");
    await employeePage.fill('input[type="email"]', employeeEmail);
    await employeePage.fill('input[type="password"]', testPassword);
    await employeePage.click('button[type="submit"]');
    await employeePage.waitForLoadState("networkidle");

    // Employee visits the invitation link
    await employeePage.goto(`/invitations/accept?token=${rawToken}`);
    await expect(employeePage.getByRole("heading", { name: /accept invitation/i })).toBeVisible();
    await expect(employeePage.getByRole("button", { name: /accept invitation/i })).toBeVisible();

    // Employee accepts invitation
    await employeePage.getByRole("button", { name: /accept invitation/i }).click();

    // Employee redirected to tenant workspace
    await employeePage.waitForURL(new RegExp(`/${orgSlug}/dashboard`));
    expect(employeePage.url()).toContain(`/${orgSlug}/dashboard`);

    // 4. Employee as Cashier attempts to visit Employee Directory (denied due to lack of employees:read)
    await employeePage.goto(`/${orgSlug}/employees`);
    // Should be redirected to dashboard
    await employeePage.waitForURL(new RegExp(`/${orgSlug}/dashboard`));
    expect(employeePage.url()).toContain(`/${orgSlug}/dashboard`);

    // 5. Owner updates Employee's role to Manager
    await ownerPage.getByRole("tab", { name: /employees/i }).click();
    await ownerPage.reload();
    await expect(ownerPage.getByText(employeeEmail)).toBeVisible();

    // Retrieve employee's membership ID
    const { data: empMem } = await adminClient
      .from("organization_memberships")
      .select("id")
      .eq("organization_id", orgId)
      .eq("user_id", employeeId)
      .single();

    // Update role to manager via adminClient
    await adminClient
      .from("organization_memberships")
      .update({ role: "manager" })
      .eq("id", empMem!.id);

    // 6. Employee (now Manager with employees:read) visits Employee Directory
    await employeePage.goto(`/${orgSlug}/employees`);
    await expect(employeePage.getByRole("heading", { name: "Employee Directory" })).toBeVisible();
    await expect(employeePage.getByText(employeeEmail)).toBeVisible();

    // 7. Owner suspends Employee
    await adminClient
      .from("organization_memberships")
      .update({ status: "suspended" })
      .eq("id", empMem!.id);

    // 8. Immediate Lockout: Employee refreshes or navigates and is locked out
    await employeePage.reload();
    await employeePage.waitForURL(new RegExp(`/${orgSlug}/suspended|/onboarding`));

    await ownerContext.close();
    await employeeContext.close();
  });
});
