import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { randomUUID } from "node:crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE2OTE2NjgxODEsImV4cCI6MjAwNzI0NDE4MX0.X_hT2p4qZ6W_Z87C9o6j66zZzM833p67U5gN6Fh_mFs";
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

test.describe("T095: Sales History, Filters & Thermal Receipt Print E2E (US5)", () => {
  let pgClient: PgClient;
  const timestamp = Date.now();
  const testPassword = "Password123!SalesHist";

  const ownerEmail = `owner_hist_${timestamp}@example.com`;
  let ownerUserId: string;
  let orgId: string;
  const orgSlug = `sales-hist-${timestamp}`;

  let sale1Id: string;
  let sale1Number: string;
  let sale2Number: string;

  test.beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    const uRes = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Hist", last_name: "Owner" },
    });
    ownerUserId = uRes.data.user!.id;

    await pgClient.query(
      "INSERT INTO public.profiles (id, first_name, last_name) VALUES ($1, 'Hist', 'Owner') ON CONFLICT (id) DO NOTHING;",
      [ownerUserId]
    );

    const orgRes = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, created_by)
       VALUES ('Sales Hist Org', $1, 'USD', 'retail', 'US', $2) RETURNING id;`,
      [orgSlug, ownerUserId]
    );
    orgId = orgRes.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active');`,
      [orgId, ownerUserId]
    );

    const prodRes = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
       VALUES ($1, 'History Product', $2, 45.0000, 'piece', 'active', $3, $3) RETURNING id;`,
      [orgId, `SKU-HIST-${timestamp}`, ownerUserId]
    );
    const productId = prodRes.rows[0].id;

    await pgClient.query(
      "UPDATE public.inventory SET quantity = 100 WHERE organization_id = $1 AND product_id = $2;",
      [orgId, productId]
    );

    // Create 2 completed sales via direct client RPC
    const client = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await client.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

    const sale1Res = await client.rpc("execute_sale", {
      p_org_id: orgId,
      p_customer_id: null,
      p_items: [{ product_id: productId, quantity: "2.0000", line_discount_amount: "0.0000" }],
      p_payments: [{ payment_method: "cash", amount: "90.0000", amount_tendered: "90.0000", change_due: "0.0000" }],
      p_order_discount_amount: 0,
      p_idempotency_key: randomUUID(),
    });
    sale1Id = sale1Res.data.sale_id;
    sale1Number = sale1Res.data.sale_number;

    const sale2Res = await client.rpc("execute_sale", {
      p_org_id: orgId,
      p_customer_id: null,
      p_items: [{ product_id: productId, quantity: "1.0000", line_discount_amount: "0.0000" }],
      p_payments: [{ payment_method: "cash", amount: "45.0000", amount_tendered: "45.0000", change_due: "0.0000" }],
      p_order_discount_amount: 0,
      p_idempotency_key: randomUUID(),
    });
    sale2Number = sale2Res.data.sale_number;
  });

  test.afterAll(async () => {
    try {
      if (orgId) {
        await pgClient.query("DELETE FROM public.refunds WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.sale_returns WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.sale_return_items WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.payments WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.sale_items WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.sales WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.stock_movements WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.inventory WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.products WHERE organization_id = $1;", [orgId]);
      }
    } finally {
      await pgClient.end();
    }
  });

  test("browses sales list, filters by search and date, opens sale detail, and triggers thermal print modal", async ({ page }) => {
    // 1. Sign in
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', ownerEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');

    await page.waitForURL(new RegExp(`/${orgSlug}/dashboard`));

    // 2. Navigate to Sales History
    await page.goto(`/${orgSlug}/sales`);
    await page.waitForLoadState("networkidle");

    // 3. Verify both sales appear in the initial list
    await expect(page.getByText(sale1Number)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(sale2Number)).toBeVisible({ timeout: 10000 });

    // 4. Search Filter: Search for Sale 1 only
    const searchInput = page.getByPlaceholder(/search by sale number/i);
    await expect(searchInput).toBeVisible();
    await searchInput.fill(sale1Number);

    const filterBtn = page.getByRole("button", { name: "Filter" });
    await expect(filterBtn).toBeVisible();
    await filterBtn.click();
    await page.waitForLoadState("networkidle");

    // Assert Sale 1 is visible, Sale 2 is filtered out
    await expect(page.getByText(sale1Number)).toBeVisible();
    await expect(page.getByText(sale2Number)).not.toBeVisible();

    // 5. Reset Filter
    const resetBtn = page.getByRole("button", { name: "Reset" });
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();
    await page.waitForLoadState("networkidle");

    // Assert both sales visible again
    await expect(page.getByText(sale1Number)).toBeVisible();
    await expect(page.getByText(sale2Number)).toBeVisible();

    // 6. Date Filter: Filter with future date (2099-01-01)
    const fromDateInput = page.locator('input[type="date"]').first();
    await expect(fromDateInput).toBeVisible();
    await fromDateInput.fill("2099-01-01");
    await page.waitForLoadState("networkidle");

    // Assert empty state or 0 records
    await expect(page.getByText(sale1Number)).not.toBeVisible();
    await expect(page.getByText(sale2Number)).not.toBeVisible();

    // Reset date filter
    await resetBtn.click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(sale1Number)).toBeVisible();

    // 7. Click Sale 1 to open detail page
    await page.getByText(sale1Number).click();
    await page.waitForURL(new RegExp(`/${orgSlug}/sales/${sale1Id}`));
    await page.waitForLoadState("networkidle");

    // 8. Verify detail page header, total amount
    await expect(page.getByText(sale1Number)).toBeVisible();
    await expect(page.getByText("$90.00").first()).toBeVisible();

    // 9. Click Print Receipt button to open modal
    const printBtn = page.getByRole("button", { name: /print receipt/i });
    await expect(printBtn).toBeVisible();
    await printBtn.click();

    // 10. Verify modal contains thermal receipt preview
    await expect(page.getByText(/thermal receipt|receipt preview|Receipt #/i).first()).toBeVisible();
  });
});
