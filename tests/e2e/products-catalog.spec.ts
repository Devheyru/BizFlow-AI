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

test.describe("T057: Complete Product Catalog Retail Journey E2E (FR-001–FR-042, SC-001–SC-011)", () => {
  let pgClient: PgClient;
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  const testPassword = "P@ssword123!RetailCatalog";
  const timestamp = Date.now();

  const ownerEmail = `owner_retail_${timestamp}@bizflow-test.internal`;
  let ownerId: string;

  const orgName = `Retail Journey Store ${timestamp}`;
  const orgSlug = `retail-journey-${timestamp}`;
  let orgId: string;

  let seededCategoryId: string;
  const categoryName = `Beverages ${timestamp}`;
  const productSku = `SPARK-${timestamp}`;
  const productName = `Organic Sparkling Water ${timestamp}`;

  test.beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    // 1. Create Owner User
    const { data: oData } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Rachel", last_name: "Retail" },
    });
    ownerId = oData!.user!.id;
    createdUserIds.push(ownerId);

    // 2. Create Organization with Owner
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

    // 3. Assign Owner membership
    await adminClient.from("organization_memberships").insert({
      organization_id: orgId,
      user_id: ownerId,
      role: "owner",
      status: "active",
    });

    // 4. Seed Category via pgClient
    const resCat = await pgClient.query(
      `INSERT INTO public.product_categories (organization_id, name, description, status, created_by, updated_by)
       VALUES ($1, $2, 'Cold beverage assortment', 'active', $3, $3)
       RETURNING id;`,
      [orgId, categoryName, ownerId]
    );
    seededCategoryId = resCat.rows[0].id;
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

  test("Complete Retail Journey: creation -> category persistence -> OCC conflict modal -> search -> filtering -> archival", async ({
    browser,
  }) => {
    test.setTimeout(90000);

    const ownerContext = await browser.newContext();
    const page = await ownerContext.newPage();

    // 1. Sign in as Owner
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', ownerEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');

    await page.waitForURL(new RegExp(`/${orgSlug}/dashboard`));

    // 2. Navigate to Catalog Page
    await page.goto(`/${orgSlug}/products`);
    await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();

    // 3. Initiate Product Creation
    await page.getByRole("link", { name: /register product/i }).click();
    await page.waitForURL(new RegExp(`/${orgSlug}/products/new`));
    await expect(page.getByRole("heading", { name: /register new product/i })).toBeVisible();

    // Fill Product Creation Form
    await page.fill("#product-name", productName);
    await page.fill("#product-sku", productSku);
    await page.selectOption("#product-category", seededCategoryId);
    await page.fill("#product-selling-price", "3.50");
    await page.fill("#product-cost-price", "1.20");
    await page.selectOption("#product-uom", "unit");
    await page.fill("#product-description", "Naturally flavored effervescent water");

    // Submit Registration Form
    await page.click('button:has-text("Register Product")');

    // Wait for redirect to products catalog or detail view
    await page.waitForURL(new RegExp(`/${orgSlug}/products`), { timeout: 15000 });

    // Verify product appears in catalog table
    await page.goto(`/${orgSlug}/products`);
    await expect(page.getByText(productName)).toBeVisible();
    await expect(page.getByText(productSku)).toBeVisible();
    await expect(page.getByText("$3.50")).toBeVisible();
    await expect(page.getByRole("table").getByText(categoryName)).toBeVisible();

    // 4. Retrieve Product ID from database
    const resProd = await pgClient.query(`SELECT id, version FROM public.products WHERE organization_id = $1 AND sku = $2;`, [
      orgId,
      productSku,
    ]);
    expect(resProd.rows).toHaveLength(1);
    const createdProductId = resProd.rows[0].id;
    expect(resProd.rows[0].version).toBe(1);

    // 5. Navigate to Product Detail View & Verify Category and Financials
    await page.goto(`/${orgSlug}/products/${createdProductId}`);
    await expect(page.getByRole("heading", { name: productName })).toBeVisible();
    await expect(page.getByText(categoryName)).toBeVisible();
    await expect(page.getByText("$3.50")).toBeVisible();
    // Verify Cost and Gross Margin panels visible to Owner
    await expect(page.getByText("$1.20")).toBeVisible();
    await expect(page.getByText("65.7%")).toBeVisible();

    // 6. Test Real Database OCC Concurrency Conflict Recovery
    await page.goto(`/${orgSlug}/products/${createdProductId}/edit`);
    await expect(page.getByRole("heading", { name: /edit product/i })).toBeVisible();
    await expect(page.locator("#name")).toHaveValue(productName);

    // In the background, simulate a concurrent transaction incrementing version to 2
    await pgClient.query(
      `UPDATE public.products 
       SET name = $1, version = version + 1, updated_at = clock_timestamp() 
       WHERE id = $2;`,
      [`${productName} (Remote Updated)`, createdProductId]
    );

    // Now attempt to submit edit form using stale version 1
    await page.fill("#name", `${productName} (Local Stale Edit)`);
    await page.click('button[type="submit"]:has-text("Save Product")');

    // Assert Concurrency Conflict Modal is triggered
    await expect(page.locator("#concurrency-modal-title")).toBeVisible();
    await expect(page.getByText(/stale update conflict/i)).toBeVisible();
    await expect(page.getByText(/P0010/i)).toBeVisible();

    // Click Reload Latest Data
    await page.click('button:has-text("Reload Latest Data")');
    await page.reload();

    // Verify latest database state is rendered (preventing silent overwrite)
    await expect(page.locator("#name")).toHaveValue(`${productName} (Remote Updated)`);
    await expect(page.getByText("v2")).toBeVisible();

    // 7. Search Verification (Prefix & Substring)
    await page.goto(`/${orgSlug}/products`);
    const searchInput = page.locator('input[aria-label="Search catalog"]');

    // 7a. Prefix search (2 chars)
    await searchInput.fill("SP");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    await expect(page.getByText(productSku)).toBeVisible();

    // 7b. Substring search (3+ chars)
    await searchInput.fill("Water");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    await expect(page.getByText(productSku)).toBeVisible();

    // 7c. Non-matching search query
    await searchInput.fill("NONEXISTENTQUERY999");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    await expect(page.getByText(productSku)).toHaveCount(0);

    // Clear search
    await searchInput.fill("");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    await expect(page.getByText(productSku)).toBeVisible();

    // 8. Category & Status Filtering
    const categorySelect = page.locator("select").first();
    // Select Beverages category
    await categorySelect.selectOption(seededCategoryId);
    await page.waitForTimeout(500);
    await expect(page.getByText(productSku)).toBeVisible();

    // Select Uncategorized
    await categorySelect.selectOption("uncategorized");
    await page.waitForTimeout(500);
    await expect(page.getByText(productSku)).toHaveCount(0);

    // Reset Category filter
    await categorySelect.selectOption("");
    await page.waitForTimeout(500);
    await expect(page.getByText(productSku)).toBeVisible();

    // Status Tab: Active vs Archived
    await page.click('button:has-text("Archived")');
    await page.waitForTimeout(500);
    // Product is currently active, so not in archived list
    await expect(page.getByText(productSku)).toHaveCount(0);

    // Switch back to Active
    await page.click('button:has-text("Active")');
    await page.waitForTimeout(500);
    await expect(page.getByText(productSku)).toBeVisible();

    // 9. Product Archival Lifecycle
    // Click Archive button on the product row
    const archiveTrigger = page.locator(`button[aria-label*="Archive"]`).first();
    await archiveTrigger.click();

    // Verify accessible archive confirmation dialog
    await expect(page.locator("#archive-dialog-title")).toBeVisible();
    await expect(page.getByText(/permanent identifier reservation/i)).toBeVisible();

    // Confirm Archival
    await page.click('div[role="dialog"] button:has-text("Archive Product")');

    // Verify modal closes and product status updates in DB
    await page.waitForTimeout(1000);
    const resArchived = await pgClient.query(`SELECT status FROM public.products WHERE id = $1;`, [createdProductId]);
    expect(resArchived.rows[0].status).toBe("archived");

    // In UI, navigate to Archived tab and verify archived product appears with Restore button
    await page.goto(`/${orgSlug}/products?status=archived`);
    await expect(page.getByText(productSku)).toBeVisible();
    await expect(page.getByRole("button", { name: /restore/i })).toBeVisible();
  });
});
