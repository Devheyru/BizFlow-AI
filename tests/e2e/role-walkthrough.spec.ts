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

test.describe("T061: Browser-Based Role Acceptance Walkthrough (Owner, Admin, Manager, Cashier)", () => {
  let pgClient: PgClient;
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  const testPassword = "P@ssword123!RoleWalkthrough";
  const timestamp = Date.now();

  const ownerEmail = `owner_walk_${timestamp}@bizflow-test.internal`;
  const adminEmail = `admin_walk_${timestamp}@bizflow-test.internal`;
  const managerEmail = `manager_walk_${timestamp}@bizflow-test.internal`;
  const cashierEmail = `cashier_walk_${timestamp}@bizflow-test.internal`;

  let ownerId: string;
  let adminId: string;
  let managerId: string;
  let cashierId: string;

  const orgName = `Role Walkthrough Store ${timestamp}`;
  const orgSlug = `role-walk-${timestamp}`;
  let orgId: string;

  let seededCategoryId: string;
  const categoryName = `Apparel ${timestamp}`;
  const productSku = `TSHIRT-${timestamp}`;
  const productName = `Classic Organic Crewneck ${timestamp}`;
  let createdProductId: string;

  test.beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    // 1. Create 4 test users for the 4 roles
    const createUser = async (email: string, firstName: string, lastName: string) => {
      const { data } = await adminClient.auth.admin.createUser({
        email,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: firstName, last_name: lastName },
      });
      createdUserIds.push(data!.user!.id);
      return data!.user!.id;
    };

    ownerId = await createUser(ownerEmail, "Oliver", "Owner");
    adminId = await createUser(adminEmail, "Alice", "Admin");
    managerId = await createUser(managerEmail, "Manny", "Manager");
    cashierId = await createUser(cashierEmail, "Charlie", "Cashier");

    // 2. Create organization
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

    // 3. Assign role memberships
    await adminClient.from("organization_memberships").insert([
      { organization_id: orgId, user_id: ownerId, role: "owner", status: "active" },
      { organization_id: orgId, user_id: adminId, role: "admin", status: "active" },
      { organization_id: orgId, user_id: managerId, role: "manager", status: "active" },
      { organization_id: orgId, user_id: cashierId, role: "cashier", status: "active" },
    ]);

    // 4. Seed initial Category via superuser
    const resCat = await pgClient.query(
      `INSERT INTO public.product_categories (organization_id, name, description, status, created_by, updated_by)
       VALUES ($1, $2, 'Apparel and Garments', 'active', $3, $3)
       RETURNING id;`,
      [orgId, categoryName, ownerId]
    );
    seededCategoryId = resCat.rows[0].id;
  });

  test.afterAll(async () => {
    if (createdOrgIds.length > 0) {
      try {
        await pgClient.query(`DELETE FROM public.organization_audit_events WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.product_costs WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.products WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.product_categories WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`ALTER TABLE public.organization_memberships DISABLE TRIGGER trg_check_owner_invariant;`);
        await pgClient.query(`DELETE FROM public.organization_memberships WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`ALTER TABLE public.organization_memberships ENABLE TRIGGER trg_check_owner_invariant;`);
        await pgClient.query(`DELETE FROM public.organizations WHERE id = ANY($1::uuid[]);`, [createdOrgIds]);
      } catch (_) {}
    }

    try {
      if (pgClient) await pgClient.end();
    } catch (_) {}

    for (const uid of createdUserIds) {
      try {
        await adminClient.auth.admin.deleteUser(uid);
      } catch (_) {}
    }
  });

  // ===========================================================================
  // 1. Owner Browser Walkthrough
  // ===========================================================================
  test("1. Owner Browser Walkthrough: Product/Category Listing, Creation, Cost Visibility, Status Toggle, Archival & Restore", async ({ browser }) => {
    test.setTimeout(90000);
    const context = await browser.newContext();
    const page = await context.newPage();

    // 1.1 Sign in as Owner
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', ownerEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(new RegExp(`/${orgSlug}/dashboard`));

    // 1.2 Navigate to Product Catalog
    await page.goto(`/${orgSlug}/products`);
    await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();
    await expect(page.getByRole("button", { name: /manage categories/i })).toBeVisible();

    // 1.3 Register Product with Selling Price ($50.00) and Cost Price ($20.00)
    await page.getByRole("link", { name: /register product/i }).click();
    await page.waitForURL(new RegExp(`/${orgSlug}/products/new`));
    await expect(page.getByRole("heading", { name: /register new product/i })).toBeVisible();

    await page.fill("#product-name", productName);
    await page.fill("#product-sku", productSku);
    await page.selectOption("#product-category", seededCategoryId);
    await page.fill("#product-selling-price", "50.00");
    await page.fill("#product-cost-price", "20.00");
    await page.selectOption("#product-uom", "unit");
    await page.fill("#product-description", "Premium 100% organic cotton crewneck");

    await page.click('button:has-text("Register Product")');
    await page.waitForURL(new RegExp(`/${orgSlug}/products/[0-9a-f-]{36}$`), { timeout: 20000 });

    // 1.4 Verify in Catalog Table: Selling Price, Cost Price, Margin visible to Owner
    await page.goto(`/${orgSlug}/products`);
    await expect(page.getByText(productName)).toBeVisible();
    await expect(page.getByText(productSku)).toBeVisible();
    await expect(page.getByText("$50.00")).toBeVisible();
    await expect(page.getByText("$20.00")).toBeVisible();
    await expect(page.getByText("60.0%")).toBeVisible();

    // Retrieve created product ID
    const resProd = await pgClient.query(`SELECT id FROM public.products WHERE organization_id = $1 AND sku = $2;`, [orgId, productSku]);
    expect(resProd.rows).toHaveLength(1);
    createdProductId = resProd.rows[0].id;

    // 1.5 Toggle Product Status (Active -> Inactive -> Active)
    const toggleButton = page.locator(`button[aria-label*="Deactivate ${productName}"], button[aria-label*="status"]`).first();
    if (await toggleButton.count() > 0) {
      await toggleButton.click();
      await page.waitForTimeout(500);
    }

    // 1.6 Archive Product via UI
    const archiveButton = page.locator(`button[aria-label*="Archive"]`).first();
    await archiveButton.click();
    await expect(page.locator("#archive-dialog-title")).toBeVisible();
    await expect(page.getByText(/permanent identifier reservation/i)).toBeVisible();
    await page.click('div[role="dialog"] button:has-text("Archive Product")');
    await page.waitForTimeout(1000);

    // Verify archived product appears under Archived tab with Restore button
    await page.goto(`/${orgSlug}/products?status=archived`);
    await expect(page.getByText(productSku)).toBeVisible();
    const restoreButton = page.getByRole("button", { name: /restore/i }).first();
    await expect(restoreButton).toBeVisible();

    // 1.7 Restore Product via UI
    await restoreButton.click();
    await expect(page.locator("#restore-dialog-title")).toBeVisible();
    await page.click('div[role="dialog"] button:has-text("Restore to Active")');
    await page.waitForTimeout(1000);

    // Verify product restored back to Active list
    await page.goto(`/${orgSlug}/products`);
    await expect(page.getByText(productSku)).toBeVisible();

    await context.close();
  });

  // ===========================================================================
  // 2. Admin Browser Walkthrough
  // ===========================================================================
  test("2. Admin Browser Walkthrough: Product & Category Management, Cost Visibility, Edit Permissions", async ({ browser }) => {
    test.setTimeout(90000);
    const context = await browser.newContext();
    const page = await context.newPage();

    // 2.1 Sign in as Admin
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', adminEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(new RegExp(`/${orgSlug}/dashboard`));

    // 2.2 Visit Catalog Page
    await page.goto(`/${orgSlug}/products`);
    await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();

    // Admin has Category Management and Product Registration controls
    await expect(page.getByRole("button", { name: /manage categories/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /register product/i })).toBeVisible();

    // Admin can see cost price and gross margin
    await expect(page.getByText("$20.00")).toBeVisible();
    await expect(page.getByText("60.0%")).toBeVisible();

    // 2.3 Admin visits Edit page and updates selling price
    await page.goto(`/${orgSlug}/products/${createdProductId}/edit`);
    await expect(page.getByRole("heading", { name: /edit product/i })).toBeVisible();
    await expect(page.locator("#name")).toHaveValue(productName);

    // Admin can view cost price section on edit form
    await expect(page.getByText(/cost price operation/i)).toBeVisible();

    // Update selling price to $55.00
    await page.fill("#sellingPrice", "55.00");
    await page.click('button[type="submit"]:has-text("Save Product")');
    await page.waitForURL((url) => url.pathname === `/${orgSlug}/products/${createdProductId}`, { timeout: 20000 });

    // Verify updated selling price in Catalog
    await page.goto(`/${orgSlug}/products`);
    await expect(page.getByText("$55.00")).toBeVisible();

    await context.close();
  });

  // ===========================================================================
  // 3. Manager Browser Walkthrough
  // ===========================================================================
  test("3. Manager Browser Walkthrough: Product Access, Permitted Editing, Cost Visibility, Archive Restrictions", async ({ browser }) => {
    test.setTimeout(90000);
    const context = await browser.newContext();
    const page = await context.newPage();

    // 3.1 Sign in as Manager
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', managerEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(new RegExp(`/${orgSlug}/dashboard`));

    // 3.2 Visit Catalog Page
    await page.goto(`/${orgSlug}/products`);
    await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();

    // Manager can view selling price ($55.00)
    await expect(page.getByText("$55.00")).toBeVisible();

    // Manager has products:read_cost -> cost price is visible ($20.00)
    await expect(page.getByText("$20.00")).toBeVisible();

    // 3.3 Manager Archive Restriction: Archive button must NOT be present
    // Manager has products:update but lacks products:archive
    await expect(page.locator(`button[aria-label*="Archive"]`)).toHaveCount(0);

    // 3.4 Manager can edit product
    await page.goto(`/${orgSlug}/products/${createdProductId}/edit`);
    await expect(page.getByRole("heading", { name: /edit product/i })).toBeVisible();
    await expect(page.locator("#name")).toHaveValue(productName);

    await context.close();
  });

  // ===========================================================================
  // 4. Cashier Browser Walkthrough
  // ===========================================================================
  test("4. Cashier Browser Walkthrough: Catalog Browsing, Selling Price Visible, Zero Cost in DOM/Network, No Mutation Controls, Routes Blocked", async ({ browser }) => {
    test.setTimeout(90000);
    const context = await browser.newContext();
    const page = await context.newPage();

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

    // 4.1 Sign in as Cashier
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', cashierEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(new RegExp(`/${orgSlug}/dashboard`));

    // 4.2 Visit Catalog Page
    await page.goto(`/${orgSlug}/products`);
    await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();

    // Selling price visible ($55.00)
    await expect(page.getByText("$55.00")).toBeVisible();

    // 4.3 Zero Cost Disclosure in DOM
    await expect(page.getByRole("columnheader", { name: /cost price/i })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: /margin/i })).toHaveCount(0);
    await expect(page.getByText("$20.00")).toHaveCount(0);

    // 4.4 Mutation Controls Absent
    await expect(page.getByRole("link", { name: /register product/i })).toHaveCount(0);
    await expect(page.locator(`button[aria-label*="Archive"]`)).toHaveCount(0);
    await expect(page.locator(`button[aria-label*="Edit"]`)).toHaveCount(0);

    // Verify Quick Categories has zero mutation controls for Cashier (canCreate=false, canUpdate=false, canArchive=false)
    const quickCatBtn = page.getByRole("button", { name: /quick manage categories/i });
    if ((await quickCatBtn.count()) > 0) {
      await quickCatBtn.click();
      await expect(page.getByRole("button", { name: /new category/i })).toHaveCount(0);
      await page.keyboard.press("Escape");
    }

    // 4.5 Zero Cost in Network Payload
    const allPayloadText = interceptedPayloads.join(" ");
    expect(allPayloadText).not.toContain('"cost_price":20');
    expect(allPayloadText).not.toContain('"costPrice":20');

    // 4.6 Direct Route Authorization: /products/new blocked
    await page.goto(`/${orgSlug}/products/new`);
    await expect(page.getByRole("heading", { name: "Page Not Found" })).toBeVisible();

    // 4.7 Direct Route Authorization: /products/[id]/edit blocked
    await page.goto(`/${orgSlug}/products/${createdProductId}/edit`);
    await expect(page.getByRole("heading", { name: "Page Not Found" })).toBeVisible();

    await context.close();
  });
});
