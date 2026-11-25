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

test.describe("T096: Void & Return Workflows E2E (US4, US6, US7)", () => {
  let pgClient: PgClient;
  const timestamp = Date.now();
  const testPassword = "Password123!VoidReturn";

  const ownerEmail = `owner_vr_${timestamp}@example.com`;
  let ownerUserId: string;
  let orgId: string;
  const orgSlug = `vr-org-${timestamp}`;

  let productId: string;
  let voidSaleId: string;
  let voidSaleNumber: string;
  let returnSaleId: string;
  let returnSaleNumber: string;
  let cardSaleId: string;
  let cardSaleNumber: string;

  test.beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    const uRes = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "VR", last_name: "Owner" },
    });
    ownerUserId = uRes.data.user!.id;

    await pgClient.query(
      "INSERT INTO public.profiles (id, first_name, last_name) VALUES ($1, 'VR', 'Owner') ON CONFLICT (id) DO NOTHING;",
      [ownerUserId]
    );

    const orgRes = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, created_by)
       VALUES ('VR Org', $1, 'USD', 'retail', 'US', $2) RETURNING id;`,
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
       VALUES ($1, 'Return Widget', $2, 35.0000, 'piece', 'active', $3, $3) RETURNING id;`,
      [orgId, `SKU-VR-${timestamp}`, ownerUserId]
    );
    productId = prodRes.rows[0].id;

    await pgClient.query(
      "UPDATE public.inventory SET quantity = 100 WHERE organization_id = $1 AND product_id = $2;",
      [orgId, productId]
    );

    const client = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await client.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

    // Sale 1: for Void Workflow
    const sale1Res = await client.rpc("execute_sale", {
      p_org_id: orgId,
      p_customer_id: null,
      p_items: [{ product_id: productId, quantity: "2.0000", line_discount_amount: "0.0000" }],
      p_payments: [{ payment_method: "cash", amount: "70.0000", amount_tendered: "70.0000", change_due: "0.0000" }],
      p_order_discount_amount: 0,
      p_idempotency_key: randomUUID(),
    });
    voidSaleId = sale1Res.data.sale_id;
    voidSaleNumber = sale1Res.data.sale_number;

    // Sale 2: for Line-Item Return Workflow
    const sale2Res = await client.rpc("execute_sale", {
      p_org_id: orgId,
      p_customer_id: null,
      p_items: [{ product_id: productId, quantity: "3.0000", line_discount_amount: "0.0000" }],
      p_payments: [{ payment_method: "cash", amount: "105.0000", amount_tendered: "105.0000", change_due: "0.0000" }],
      p_order_discount_amount: 0,
      p_idempotency_key: randomUUID(),
    });
    returnSaleId = sale2Res.data.sale_id;
    returnSaleNumber = sale2Res.data.sale_number;

    // Sale 3: for Non-Cash Refund Workflow
    const sale3Res = await client.rpc("execute_sale", {
      p_org_id: orgId,
      p_customer_id: null,
      p_items: [{ product_id: productId, quantity: "2.0000", line_discount_amount: "0.0000" }],
      p_payments: [{ payment_method: "card", amount: "70.0000", amount_tendered: "70.0000", change_due: "0.0000", reference_no: "AUTH-CARD-777" }],
      p_order_discount_amount: 0,
      p_idempotency_key: randomUUID(),
    });
    cardSaleId = sale3Res.data.sale_id;
    cardSaleNumber = sale3Res.data.sale_number;
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

  test("Workflow 1: executes void sale with justification and restores inventory", async ({ page }) => {
    // 1. Sign in
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', ownerEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(new RegExp(`/${orgSlug}/dashboard`));

    // 2. Navigate to Sale Detail
    await page.goto(`/${orgSlug}/sales/${voidSaleId}`);
    await page.waitForLoadState("networkidle");

    // Assert initial state is Completed
    await expect(page.getByText(voidSaleNumber)).toBeVisible();
    await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible();

    // 3. Click Void Sale button
    const voidBtn = page.getByRole("button", { name: /Void Sale/i });
    await expect(voidBtn).toBeVisible();
    await voidBtn.click();

    // 4. Fill Reason for Voiding
    const reasonTextarea = page.getByPlaceholder(/Enter the business justification for voiding/i);
    await expect(reasonTextarea).toBeVisible();
    await reasonTextarea.fill("Customer walked away before taking items");

    // 5. Confirm Void
    const confirmVoidBtn = page.getByRole("button", { name: "Confirm Void" });
    await expect(confirmVoidBtn).toBeVisible();
    await confirmVoidBtn.click();

    // 6. Assert status updates to Voided
    await expect(page.getByText("Sale voided successfully!")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Voided", { exact: true }).first()).toBeVisible({ timeout: 10000 });

    // Assert banner explains stock restoration
    await expect(page.getByText(/This sale was voided\. All line item quantities have been restored to inventory\./i)).toBeVisible();

    // Verify stock movement in database
    const smRes = await pgClient.query(
      "SELECT movement_type, quantity_delta, reference_id FROM public.stock_movements WHERE organization_id = $1 AND product_id = $2 AND movement_type = 'return' AND reference_id = $3;",
      [orgId, productId, `void:${voidSaleId}`]
    );
    expect(smRes.rows.length).toBeGreaterThan(0);
    expect(Number(smRes.rows[0].quantity_delta)).toBe(2);
  });

  test("Workflow 2: executes line-item return with restock and updates status to partially returned", async ({ page }) => {
    // 1. Sign in
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', ownerEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(new RegExp(`/${orgSlug}/dashboard`));

    // 2. Navigate to Sale Detail
    await page.goto(`/${orgSlug}/sales/${returnSaleId}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(returnSaleNumber)).toBeVisible();

    // 3. Initiate return
    const returnActionBtn = page.getByRole("button", { name: /Process Return/i });
    await expect(returnActionBtn).toBeVisible();
    await returnActionBtn.click();

    // 4. Fill return reason
    const reasonInput = page.getByPlaceholder(/Enter customer return reason/i);
    await expect(reasonInput).toBeVisible();
    await reasonInput.fill("Customer returned one defective widget");

    // 5. Verify restock checkbox is checked by default
    const restockCheckbox = page.getByLabel(/Restock to inventory/i);
    await expect(restockCheckbox).toBeChecked();

    // 6. Confirm Return
    const confirmReturnBtn = page.getByRole("button", { name: /Confirm Return/i });
    await expect(confirmReturnBtn).toBeVisible();
    await confirmReturnBtn.click();

    // 7. Verify modal closes and status updates to Partially Returned
    await expect(page.getByText("Partially Returned", { exact: true }).first()).toBeVisible({ timeout: 10000 });

    // 8. Open Returns & Refunds tab
    const returnsTab = page.getByRole("button", { name: /Returns & Refunds/i });
    await expect(returnsTab).toBeVisible();
    await returnsTab.click();

    // Assert return record card shows the return reason
    await expect(page.getByText("Customer returned one defective widget")).toBeVisible();
  });

  test("Workflow 3: completes non-cash card refund confirmation lifecycle", async ({ page }) => {
    // 1. Sign in
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', ownerEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(new RegExp(`/${orgSlug}/dashboard`));

    // 2. Navigate to Sale Detail
    await page.goto(`/${orgSlug}/sales/${cardSaleId}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(cardSaleNumber)).toBeVisible();

    // 3. Initiate return for card sale
    const returnActionBtn = page.getByRole("button", { name: /Process Return/i });
    await expect(returnActionBtn).toBeVisible();
    await returnActionBtn.click();

    // Select Card as refund method
    const cardMethodBtn = page.getByRole("button", { name: /^card$/i });
    await expect(cardMethodBtn).toBeVisible();
    await cardMethodBtn.click();

    // Fill return reason
    const reasonInput = page.getByPlaceholder(/Enter customer return reason/i);
    await expect(reasonInput).toBeVisible();
    await reasonInput.fill("Customer requested card reimbursement");

    // Confirm Return
    const confirmReturnBtn = page.getByRole("button", { name: /Confirm Return/i });
    await expect(confirmReturnBtn).toBeVisible();
    await confirmReturnBtn.click();

    // 4. Navigate to Returns & Refunds tab
    await expect(page.getByRole("button", { name: /Process Return/i })).toBeVisible({ timeout: 10000 });
    const returnsTab = page.getByRole("button", { name: /Returns & Refunds/i });
    await expect(returnsTab).toBeVisible();
    await returnsTab.click();

    // 5. Non-cash card refund creates a pending confirmation record
    await expect(page.getByText("Pending Confirmation").first()).toBeVisible();

    // 6. Click Confirm button on the pending refund
    const confirmBtn = page.getByRole("button", { name: /^Confirm$/i });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // 7. Fill external reversal reference in Confirm dialog
    const refInput = page.getByRole("textbox", { name: /External Reversal Reference/i });
    await expect(refInput).toBeVisible();
    await refInput.fill("CARD-REV-AUTH-999888");

    // 8. Submit reimbursement confirmation
    const submitReimbursementBtn = page.getByRole("button", { name: "Confirm Reimbursement" });
    await expect(submitReimbursementBtn).toBeVisible();
    await submitReimbursementBtn.click();

    // 9. Verify refund status updates to Completed
    await expect(page.getByText("Completed").first()).toBeVisible({ timeout: 10000 });
  });
});
