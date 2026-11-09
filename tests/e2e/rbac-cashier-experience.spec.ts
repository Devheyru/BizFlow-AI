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

test.describe("T056: Cashier Security & Cost Price Confidentiality E2E (FR-039, SC-004)", () => {
  let pgClient: PgClient;
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  const testPassword = "P@ssword123!CashierE2E";
  const timestamp = Date.now();

  const ownerEmail = `owner_e2e_cashier_${timestamp}@bizflow-test.internal`;
  const cashierEmail = `cashier_e2e_${timestamp}@bizflow-test.internal`;

  let ownerId: string;
  let cashierId: string;

  const orgName = `Cashier Security Store ${timestamp}`;
  const orgSlug = `cashier-sec-${timestamp}`;
  let orgId: string;

  let seededCategoryId: string;
  let seededProductId: string;
  const testSku = `SKU-CASH-${timestamp}`;
  const testProductName = `Cashier Catalog Test Item ${timestamp}`;
  const testSellingPrice = 100.0;
  const testCostPrice = 45.0; // Strictly confidential supplier cost

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

    // 2. Create Cashier User
    const { data: cData } = await adminClient.auth.admin.createUser({
      email: cashierEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Casey", last_name: "Cashier" },
    });
    cashierId = cData!.user!.id;
    createdUserIds.push(cashierId);

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

    // 4. Assign Memberships
    await adminClient.from("organization_memberships").insert([
      {
        organization_id: orgId,
        user_id: ownerId,
        role: "owner",
        status: "active",
      },
      {
        organization_id: orgId,
        user_id: cashierId,
        role: "cashier",
        status: "active",
      },
    ]);

    // 5. Seed Category via pgClient (superuser bypasses RLS on catalog tables)
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    const resCat = await pgClient.query(
      `INSERT INTO public.product_categories (organization_id, name, description, status, created_by, updated_by)
       VALUES ($1, 'General Merchandise', 'Standard retail merchandise', 'active', $2, $2)
       RETURNING id;`,
      [orgId, ownerId]
    );
    seededCategoryId = resCat.rows[0].id;

    // 6. Seed Product with Confidential Cost via pgClient
    const resProd = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, category_id, status, version, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'unit', $5, 'active', 1, $6, $6)
       RETURNING id;`,
      [orgId, testProductName, testSku, testSellingPrice, seededCategoryId, ownerId]
    );
    seededProductId = resProd.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.product_costs (organization_id, product_id, cost_price)
       VALUES ($1, $2, $3);`,
      [orgId, seededProductId, testCostPrice]
    );
  });

  test.afterAll(async () => {
    if (createdOrgIds.length > 0) {
      try {
        await pgClient.query(`DELETE FROM public.organization_audit_events WHERE organization_id = ANY($1::uuid[]);`, [
          createdOrgIds,
        ]);
        await pgClient.query(`DELETE FROM public.product_costs WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.products WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.product_categories WHERE organization_id = ANY($1::uuid[]);`, [
          createdOrgIds,
        ]);
        await pgClient.query(`DELETE FROM public.organization_memberships WHERE organization_id = ANY($1::uuid[]);`, [
          createdOrgIds,
        ]);
        await pgClient.query(`DELETE FROM public.organizations WHERE id = ANY($1::uuid[]);`, [createdOrgIds]);
      } catch (_) {}
    }

    try {
      if (pgClient) {
        await pgClient.end();
      }
    } catch (_) {}

    for (const uid of createdUserIds) {
      try {
        await adminClient.auth.admin.deleteUser(uid);
      } catch (_) {}
    }
  });

  test("Cashier Catalog Experience: selling price visible, zero cost data in DOM and network, mutation controls absent, direct URL navigation blocked", async ({
    browser,
  }) => {
    const cashierContext = await browser.newContext();
    const page = await cashierContext.newPage();

    // Track network payloads to verify zero cost disclosures
    const interceptedPayloads: string[] = [];
    page.on("response", async (response) => {
      const url = response.url();
      if (
        url.includes("/products") ||
        url.includes("/api/") ||
        response.headers()["content-type"]?.includes("text/x-component") ||
        response.headers()["content-type"]?.includes("application/json")
      ) {
        try {
          const text = await response.text();
          interceptedPayloads.push(text);
        } catch (_) {}
      }
    });

    // 1. Cashier signs in
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', cashierEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');

    await page.waitForURL(new RegExp(`/${orgSlug}/dashboard`));

    // 2. Cashier navigates to Product Catalog
    await page.goto(`/${orgSlug}/products`);
    await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();

    // 3. Verify Product Details & Selling Price are displayed
    await expect(page.getByText(testProductName)).toBeVisible();
    await expect(page.getByText(testSku)).toBeVisible();
    // Selling price should be visible ($100.00)
    await expect(page.getByText("$100.00")).toBeVisible();

    // 4. Verify Cost Price and Gross Margin columns are ABSENT from the DOM
    await expect(page.getByRole("columnheader", { name: /cost price/i })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: /margin/i })).toHaveCount(0);

    // Verify confidential numeric cost string ($45.00 or 45.00) does NOT appear anywhere on the page
    await expect(page.getByText("$45.00")).toHaveCount(0);
    await expect(page.getByText("45.00%")).toHaveCount(0);
    await expect(page.getByText("55.00%")).toHaveCount(0);

    // 5. Verify Mutation Action Controls are ABSENT
    // "Register Product" button must not exist
    await expect(page.getByRole("link", { name: /register product/i })).toHaveCount(0);
    // Table action buttons (Edit, Archive) must not exist for Cashier
    await expect(page.getByRole("button", { name: /archive product/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /edit product/i })).toHaveCount(0);

    // 6. Verify Network Responses contain zero confidential cost data
    const allPayloadText = interceptedPayloads.join(" ");
    expect(allPayloadText).not.toContain('"cost_price":45');
    expect(allPayloadText).not.toContain('"costPrice":45');
    expect(allPayloadText).not.toContain('"cost_price":"45');
    expect(allPayloadText).not.toContain('"costPrice":"45');

    // 7. Direct URL Navigation Protection: /products/new returns 404 / Page Not Found
    await page.goto(`/${orgSlug}/products/new`);
    await expect(page.getByRole("heading", { name: "Page Not Found" })).toBeVisible();
    await expect(page.getByText(/could not be found/i)).toBeVisible();
    // Ensure product creation form is not accessible
    await expect(page.getByRole("button", { name: /create product/i })).toHaveCount(0);

    // 8. Direct URL Navigation Protection: /products/[productId]/edit returns 404 / Page Not Found
    await page.goto(`/${orgSlug}/products/${seededProductId}/edit`);
    await expect(page.getByRole("heading", { name: "Page Not Found" })).toBeVisible();
    await expect(page.getByText(/could not be found/i)).toBeVisible();
    // Ensure edit form is not accessible
    await expect(page.getByRole("button", { name: /save changes/i })).toHaveCount(0);
  });
});
