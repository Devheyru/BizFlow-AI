import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const dbUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

test.describe("T094: Customer Profile & Purchase History E2E (US2)", () => {
  let pgClient: PgClient;
  const timestamp = Date.now();
  const testPassword = "Password123!CustTest";

  const ownerEmail = `owner_cust_${timestamp}@example.com`;
  let ownerUserId: string;
  let orgId: string;
  const orgSlug = `cust-org-${timestamp}`;

  const customerName = `Alice Smith ${timestamp}`;
  const customerPhone = `+1415555${Math.floor(1000 + Math.random() * 9000)}`;
  const updatedPhone = `+14155559999`;
  const customerNotes = `VIP wholesale customer notes`;

  test.beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    const uRes = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Customer", last_name: "Manager" },
    });
    ownerUserId = uRes.data.user!.id;

    await pgClient.query(
      "INSERT INTO public.profiles (id, first_name, last_name) VALUES ($1, 'Customer', 'Manager') ON CONFLICT (id) DO NOTHING;",
      [ownerUserId]
    );

    const orgRes = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, created_by)
       VALUES ('Customer Org', $1, 'USD', 'retail', 'US', $2) RETURNING id;`,
      [orgSlug, ownerUserId]
    );
    orgId = orgRes.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active');`,
      [orgId, ownerUserId]
    );
  });

  test.afterAll(async () => {
    try {
      if (orgId) {
        await pgClient.query("DELETE FROM public.customers WHERE organization_id = $1;", [orgId]);
      }
    } finally {
      await pgClient.end();
    }
  });

  test("creates, searches, edits profile, and archives a customer", async ({ page }) => {
    // 1. Sign in
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', ownerEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');

    await page.waitForURL(new RegExp(`/${orgSlug}/dashboard`));

    // 2. Navigate to Customers page
    await page.goto(`/${orgSlug}/customers`);
    await page.waitForLoadState("networkidle");

    // 3. Create customer via dialog
    const addCustomerBtn = page.getByRole("button", { name: "Add Customer" }).first();
    await expect(addCustomerBtn).toBeVisible();
    await addCustomerBtn.click();

    await page.fill('#customer-name, input[name="name"]', customerName);
    await page.fill('#customer-phone, input[name="phone"]', customerPhone);
    await page.fill('#customer-email, input[name="email"]', `alice_${timestamp}@example.com`);

    const submitBtn = page.getByRole("button", { name: "Create Customer" });
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();

    // 4. Verify customer appears in search
    const searchInput = page.getByPlaceholder(/search by name/i);
    await expect(searchInput).toBeVisible();
    await searchInput.fill(customerName);

    const customerRow = page.getByText(customerName).first();
    await expect(customerRow).toBeVisible({ timeout: 10000 });

    // 5. Navigate to Customer detail
    const customerLink = page.getByRole("link", { name: customerName }).first();
    await expect(customerLink).toBeVisible();
    await customerLink.click();
    await page.waitForURL(new RegExp(`/${orgSlug}/customers/`));
    await page.waitForLoadState("networkidle");

    // Verify detail page has customer name and active status badge
    await expect(page.getByRole("heading", { name: customerName, exact: true })).toBeVisible();
    await expect(page.getByText("Active Customer")).toBeVisible();

    // 6. Edit customer profile
    const editBtn = page.getByRole("button", { name: "Edit Profile" });
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    const phoneField = page.locator("#customer-phone");
    await expect(phoneField).toBeVisible();
    await phoneField.fill(updatedPhone);

    const notesField = page.locator("#customer-notes");
    await expect(notesField).toBeVisible();
    await notesField.fill(customerNotes);

    const saveBtn = page.getByRole("button", { name: "Save Changes" });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Verify updated phone and notes are displayed on the detail view
    await expect(page.getByText(updatedPhone).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(customerNotes)).toBeVisible();

    // 7. Archive customer
    const archiveBtn = page.getByRole("button", { name: "Archive" });
    await expect(archiveBtn).toBeVisible();
    await archiveBtn.click();

    const confirmArchiveBtn = page.getByRole("button", { name: "Archive Customer" });
    await expect(confirmArchiveBtn).toBeVisible();
    await confirmArchiveBtn.click();

    // Verify status badge updates to Archived Customer
    await expect(page.getByText("Archived Customer")).toBeVisible({ timeout: 10000 });
  });
});
