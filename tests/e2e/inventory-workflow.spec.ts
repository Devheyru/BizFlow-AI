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

test.describe("T041: End-to-End Inventory & Stock Management Workflows", () => {
  let pgClient: PgClient;
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  const testPassword = "P@ssword123!E2EInventory";
  const timestamp = Date.now();

  const ownerEmail = `e2e_owner_${timestamp}@bizflow-test.internal`;
  const cashierEmail = `e2e_cashier_${timestamp}@bizflow-test.internal`;

  let ownerId: string;
  let cashierId: string;

  const orgName = `E2E Inventory Retail Store ${timestamp}`;
  const orgSlug = `e2e-inv-${timestamp}`;
  let orgId: string;

  let seededCategoryId: string;
  let seededProductId: string;
  const testSku = `SKU-E2E-${timestamp}`;
  const testProductName = `Retail E2E Widget ${timestamp}`;
  const testSellingPrice = 50.0;
  const testCostPrice = 25.0;

  test.beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

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

    // 3. Create Organization
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

    // 5. Seed Category
    const resCat = await pgClient.query(
      `INSERT INTO public.product_categories (organization_id, name, description, status, created_by, updated_by)
       VALUES ($1, 'General Inventory', 'Retail items', 'active', $2, $2)
       RETURNING id;`,
      [orgId, ownerId]
    );
    seededCategoryId = resCat.rows[0].id;

    // 6. Seed Product with Inventory Anchor
    const resProd = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, category_id, status, version, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'piece', $5, 'active', 1, $6, $6)
       RETURNING id;`,
      [orgId, testProductName, testSku, testSellingPrice, seededCategoryId, ownerId]
    );
    seededProductId = resProd.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.product_costs (organization_id, product_id, cost_price)
       VALUES ($1, $2, $3);`,
      [orgId, seededProductId, testCostPrice]
    );

    // 7. Grant inventory:history to cashier role for Workflow 4 test
    await pgClient.query(
      `INSERT INTO public.role_permissions (role, permission_id)
       VALUES ('cashier', 'inventory:history')
       ON CONFLICT DO NOTHING;`
    );
  });

  test.afterAll(async () => {
    try {
      await pgClient.query(
        `DELETE FROM public.role_permissions WHERE role = 'cashier' AND permission_id = 'inventory:history';`
      );
    } catch (_) { }

    if (createdOrgIds.length > 0) {
      try {
        await pgClient.query(`DELETE FROM public.zero_delta_stocktakes WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.stock_movement_costs WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.stock_movements WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.inventory WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.product_costs WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.products WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.product_categories WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.organization_memberships WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.organizations WHERE id = ANY($1::uuid[]);`, [createdOrgIds]);
      } catch (_) { }
    }

    try {
      if (pgClient) await pgClient.end();
    } catch (_) { }

    for (const uid of createdUserIds) {
      try {
        await adminClient.auth.admin.deleteUser(uid);
      } catch (_) { }
    }
  });

  test("Comprehensive Inventory Retail Walkthroughs (Workflows 1 through 5)", async ({
    browser,
  }) => {
    test.setTimeout(120000);
    const ownerContext = await browser.newContext();
    const page = await ownerContext.newPage();

    // ------------------------------------------------------------------------
    // WORKFLOW 1: Restock flow end-to-end with toast / in-modal confirmation
    // ------------------------------------------------------------------------
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', ownerEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');

    await page.waitForURL(new RegExp(`/${orgSlug}/dashboard`));

    // Navigate to Inventory page
    await page.goto(`/${orgSlug}/inventory`);
    await expect(page.getByTestId("inventory-table")).toBeVisible();
    await expect(page.getByTestId(`inventory-row-${seededProductId}`)).toBeVisible();

    // Trigger Restock Modal
    await page.click(`[data-testid="restock-btn-${seededProductId}"]`);
    await expect(page.getByTestId("restock-modal")).toBeVisible();

    // Enter Restock details: +50 units
    await page.fill('[data-testid="restock-quantity-input"]', "50");
    await page.fill('[data-testid="restock-reason-input"]', "Initial delivery from primary distributor");
    await page.fill('[data-testid="restock-reference-input"]', "PO-E2E-1001");

    // Submit restock
    await page.click('[data-testid="restock-submit-btn"]');

    // Verify success banner appears
    await expect(page.getByTestId("restock-success-banner")).toBeVisible();

    // Close restock modal
    if (await page.getByTestId("restock-close-btn").isVisible()) {
      await page.click('[data-testid="restock-close-btn"]');
    }
    await expect(page.getByTestId("restock-modal")).not.toBeVisible();

    // Verify inventory balance updated in the table to 50
    try {
      await expect(page.getByTestId(`inventory-quantity-${seededProductId}`)).toContainText("50", {
        timeout: 10000,
      });
    } catch {
      await page.reload();
      await expect(page.getByTestId(`inventory-quantity-${seededProductId}`)).toContainText("50", {
        timeout: 10000,
      });
    }

    // ------------------------------------------------------------------------
    // WORKFLOW 2: Stocktake zero-delta confirmation UI
    // ------------------------------------------------------------------------
    await page.click(`[data-testid="stocktake-btn-${seededProductId}"]`);
    await expect(page.getByTestId("stocktake-modal")).toBeVisible();

    // Enter target physical count exactly matching recorded stock (50)
    await page.fill('[data-testid="stocktake-physical-count-input"]', "50");

    // Verify zero variance preview
    await expect(page.getByTestId("stocktake-variance-display")).toBeVisible();

    // Fill reason
    await page.fill('[data-testid="stocktake-reason-input"]', "Cycle count audit matches recorded on-hand quantity");

    // Submit stocktake
    await page.click('[data-testid="stocktake-submit-button"]');

    // Verify zero-delta matched success view
    await expect(page.getByTestId("stocktake-success-matched")).toBeVisible();
    await expect(page.getByText("Stock Count Verified & Matched!")).toBeVisible();

    // Close stocktake modal
    await page.click('[data-testid="stocktake-close-button"]');
    await expect(page.getByTestId("stocktake-modal")).not.toBeVisible();

    // ------------------------------------------------------------------------
    // WORKFLOW 3: Damage write-off with balance update
    // ------------------------------------------------------------------------
    await page.click(`[data-testid="adjust-btn-${seededProductId}"]`);
    await expect(page.getByTestId("adjust-stock-modal")).toBeVisible();

    // Select damage movement type
    await page.click('[data-testid="movement-type-damage"]');

    // Deduct 5 units
    await page.fill('[data-testid="adjust-quantity-input"]', "5");
    await page.fill('[data-testid="adjust-reason-input"]', "Damaged packaging during inventory transfer");

    // Submit adjustment
    await page.click('[data-testid="adjust-submit-button"]');

    // Verify adjustment success alert
    await expect(page.getByTestId("adjust-success-alert")).toBeVisible();

    // Close adjust modal using close modal button
    const closeBtn = page.locator('[data-testid="adjust-stock-modal"] button[title="Close modal"]');
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    }
    await expect(page.getByTestId("adjust-stock-modal")).not.toBeVisible();

    // Verify inventory balance decremented to 45
    try {
      await expect(page.getByTestId(`inventory-quantity-${seededProductId}`)).toContainText("45", {
        timeout: 10000,
      });
    } catch {
      await page.reload();
      await expect(page.getByTestId(`inventory-quantity-${seededProductId}`)).toContainText("45", {
        timeout: 10000,
      });
    }

    // ------------------------------------------------------------------------
    // WORKFLOW 5: Reorder threshold configuration with low-stock badge appearance
    // ------------------------------------------------------------------------
    // Configure reorder threshold: set reorder point to 60 (current stock is 45, so 45 <= 60 triggers Low Stock)
    await page.click(`[data-testid="thresholds-btn-${seededProductId}"]`);
    await expect(page.getByTestId("reorder-threshold-modal")).toBeVisible();

    await page.fill('[data-testid="reorder-point-input"]', "60");
    await page.fill('[data-testid="reorder-quantity-input"]', "50");

    await page.click('[data-testid="reorder-threshold-submit-button"]');
    await expect(page.getByTestId("reorder-threshold-success-alert")).toBeVisible();

    // Close threshold modal
    await page.click('[data-testid="reorder-threshold-close-button"]');
    await expect(page.getByTestId("reorder-threshold-modal")).not.toBeVisible();

    // Verify low-stock badge appears on product row
    const badge = page.getByTestId(`stock-status-badge-${seededProductId}`);
    try {
      await expect(badge).toBeVisible();
      await expect(badge).toContainText("Low Stock", { timeout: 10000 });
    } catch {
      await page.reload();
      await expect(badge).toBeVisible();
      await expect(badge).toContainText("Low Stock", { timeout: 10000 });
    }

    await ownerContext.close();

    // ------------------------------------------------------------------------
    // WORKFLOW 4: Movement history with Cashier cost omission & network boundary verification
    // ------------------------------------------------------------------------
    const cashierContext = await browser.newContext();
    const cashierPage = await cashierContext.newPage();

    await cashierPage.goto("/sign-in");
    await cashierPage.fill('input[type="email"]', cashierEmail);
    await cashierPage.fill('input[type="password"]', testPassword);
    await cashierPage.click('button[type="submit"]');

    await cashierPage.waitForURL(new RegExp(`/${orgSlug}/dashboard`));

    // Intercept network responses during cashier history navigation
    const interceptedPayloads: string[] = [];
    cashierPage.on("response", async (res) => {
      try {
        const u = res.url();
        if (u.includes("/inventory/history") || u.includes("_rsc")) {
          const body = await res.text();
          interceptedPayloads.push(body);
        }
      } catch (_) { }
    });

    // Cashier navigates to Movement History
    const mainNavResponse = await cashierPage.goto(`/${orgSlug}/inventory/history`);
    await expect(cashierPage.getByTestId("movement-history-table")).toBeVisible();

    // 1. Network Boundary Verification: Assert response body contains no confidential cost data
    expect(mainNavResponse).not.toBeNull();
    const mainNavHtml = (await mainNavResponse!.text()) || "";
    expect(mainNavHtml).not.toContain("$25.00");
    expect(mainNavHtml).not.toContain("25.00");
    expect(mainNavHtml).not.toContain('"totalCost":');
    // Verify that unitCost is explicitly serialized as null and never contains a numeric value
    expect(mainNavHtml).toMatch(/unitCost[\\"]*:\s*null/);
    expect(mainNavHtml).not.toMatch(/unitCost[\\"]*:\s*[0-9]/);

    // Assert across all intercepted responses
    for (const payload of interceptedPayloads) {
      expect(payload).not.toContain("$25.00");
      expect(payload).not.toContain("25.00");
      expect(payload).not.toMatch(/unitCost[\\"]*:\s*[0-9]/);
    }

    // 2. DOM Verification: Verify cost headers and confidential cost figures are completely absent
    await expect(cashierPage.getByTestId("col-unit-cost")).toHaveCount(0);
    await expect(cashierPage.getByTestId("col-total-cost")).toHaveCount(0);
    await expect(cashierPage.getByText("$25.00")).toHaveCount(0);

    await cashierContext.close();
  });
});
