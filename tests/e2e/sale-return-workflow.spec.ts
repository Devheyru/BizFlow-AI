import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { randomUUID } from "node:crypto";

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

test.describe("Feature 005 — Phase 7 E2E: Sale Return & Refund Workflow (T069–T071, US4)", () => {
  let pgClient: PgClient;
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  const testPassword = "P@ssword123!ReturnE2E";
  const timestamp = Date.now();

  const ownerEmail = `owner_ret_e2e_${timestamp}@bizflow-test.internal`;
  const cashierEmail = `cashier_ret_e2e_${timestamp}@bizflow-test.internal`;

  let ownerId: string;
  let cashierId: string;

  const orgName = `Return E2E Store ${timestamp}`;
  const orgSlug = `ret-e2e-${timestamp}`;
  let orgId: string;

  let customerId: string;
  let productId: string;
  const testSku = `SKU-RET-${timestamp}`;

  let saleId1: string; // Eligible Cash Sale
  let saleNumber1: string;

  let saleId2: string; // Eligible Card Sale
  let saleNumber2: string;

  let saleId3: string; // Voided Sale (ineligible for return)
  let saleNumber3: string;

  let ownerClient: any;

  test.beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    // 1. Create Owner User
    const { data: oData, error: oErr } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Rita", last_name: "Owner" },
    });
    if (oErr || !oData.user) throw new Error(`Failed to create owner: ${oErr?.message}`);
    ownerId = oData.user.id;
    createdUserIds.push(ownerId);

    // 2. Create Cashier User
    const { data: cData, error: cErr } = await adminClient.auth.admin.createUser({
      email: cashierEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Carl", last_name: "Cashier" },
    });
    if (cErr || !cData.user) throw new Error(`Failed to create cashier: ${cErr?.message}`);
    cashierId = cData.user.id;
    createdUserIds.push(cashierId);

    // 3. User Profiles
    await pgClient.query(
      `INSERT INTO public.profiles (id, first_name, last_name)
       VALUES ($1, 'Rita', 'Owner'), ($2, 'Carl', 'Cashier')
       ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name;`,
      [ownerId, cashierId]
    );

    // 4. Create Organization
    const { data: org, error: orgErr } = await adminClient
      .from("organizations")
      .insert({
        name: orgName,
        slug: orgSlug,
        business_type: "retail",
        country: "US",
        currency: "USD",
        timezone: "America/New_York",
        created_by: ownerId,
        is_active: true,
      })
      .select()
      .single();
    if (orgErr || !org) throw new Error(`Failed to create org: ${orgErr?.message}`);
    orgId = org.id;
    createdOrgIds.push(orgId);

    // 5. Memberships
    await adminClient.from("organization_memberships").insert([
      { organization_id: orgId, user_id: ownerId, role: "owner", status: "active" },
      { organization_id: orgId, user_id: cashierId, role: "cashier", status: "active" },
    ]);

    // 6. Tax Settings: 10% exclusive
    await pgClient.query(
      `INSERT INTO public.organization_tax_settings (organization_id, tax_name, default_tax_rate, is_tax_inclusive, updated_by)
       VALUES ($1, 'State Tax', 10.0000, false, $2)
       ON CONFLICT (organization_id) DO UPDATE
       SET tax_name = 'State Tax', default_tax_rate = 10.0000, is_tax_inclusive = false;`,
      [orgId, ownerId]
    );

    // 7. Seed Customer
    const custRes = await pgClient.query(
      `INSERT INTO public.customers (organization_id, name, phone, email, status)
       VALUES ($1, 'Return Customer', '+14155554321', 'customer@ret-test.internal', 'active')
       RETURNING id;`,
      [orgId]
    );
    customerId = custRes.rows[0].id;

    // 8. Seed Product with Inventory
    const prodRes = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
       VALUES ($1, 'Returnable Widget', $2, 50.0000, 'unit', 'active', $3, $3)
       RETURNING id;`,
      [orgId, testSku, ownerId]
    );
    productId = prodRes.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.inventory (organization_id, product_id, quantity)
       VALUES ($1, $2, 100.0000)
       ON CONFLICT (organization_id, product_id) DO UPDATE SET quantity = 100.0000;`,
      [orgId, productId]
    );

    const anonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE2OTE2NjgxODEsImV4cCI6MjAwNzI0NDE4MX0.X_hT2p4qZ6W_Z87C9o6j66zZzM833p67U5gN6Fh_mFs";
    ownerClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: oSignErr } = await ownerClient.auth.signInWithPassword({
      email: ownerEmail,
      password: testPassword,
    });
    if (oSignErr) throw oSignErr;

    // Helper to seed sale via execute_sale RPC
    async function seedCompletedSale(
      qty: number,
      payments: Array<{ payment_method: string; amount: number; reference_no?: string | null; amount_tendered?: number; change_due?: number }>
    ) {
      const { data, error } = await ownerClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: customerId,
        p_items: [
          {
            product_id: productId,
            quantity: qty,
            unit_price: 50.0,
            line_discount_amount: 0,
          },
        ],
        p_payments: payments,
        p_order_discount_amount: 0,
        p_idempotency_key: randomUUID(),
        p_notes: "E2E return test sale",
      });
      if (error || !data) throw new Error(`Failed to execute test sale: ${error?.message}`);
      return { saleId: data.sale_id, saleNumber: data.sale_number };
    }

    // 9. Seed Sale 1: Cash sale for 2 widgets (Total = $110.00)
    const s1 = await seedCompletedSale(2, [
      { payment_method: "cash", amount: 110.0, amount_tendered: 120.0, change_due: 10.0 },
    ]);
    saleId1 = s1.saleId;
    saleNumber1 = s1.saleNumber;

    // 10. Seed Sale 2: Card sale for 2 widgets (Total = $110.00)
    const s2 = await seedCompletedSale(2, [
      { payment_method: "card", amount: 110.0, reference_no: "AUTH-CARD-E2E" },
    ]);
    saleId2 = s2.saleId;
    saleNumber2 = s2.saleNumber;

    // 11. Seed Sale 3: Voided Sale
    const s3 = await seedCompletedSale(1, [
      { payment_method: "cash", amount: 55.0, amount_tendered: 55.0, change_due: 0.0 },
    ]);
    saleId3 = s3.saleId;
    saleNumber3 = s3.saleNumber;
    await ownerClient.rpc("void_sale", {
      p_org_id: orgId,
      p_sale_id: saleId3,
      p_void_reason: "Voided sale for return guard test",
      p_idempotency_key: randomUUID(),
    });
  });

  test.afterAll(async () => {
    if (pgClient) {
      try {
        await pgClient.query(`SET session_replication_role = 'replica';`);
        await pgClient.query(`DELETE FROM public.refunds WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.sale_return_items WHERE return_id IN (SELECT id FROM public.sale_returns WHERE organization_id = ANY($1::uuid[]));`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.sale_returns WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.payments WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.sale_items WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.sales WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.stock_movements WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.inventory WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.products WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.customers WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.organization_tax_settings WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.organization_memberships WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.organizations WHERE id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`SET session_replication_role = 'origin';`);
      } catch (_) {}
      try {
        await pgClient.end();
      } catch (_) {}
    }

    for (const uid of createdUserIds) {
      try {
        await adminClient.auth.admin.deleteUser(uid);
      } catch (_) {}
    }
  });

  async function signIn(page: any, email: string) {
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(new RegExp(`/${orgSlug}/dashboard`));
  }

  test("1. Cashier Role: 'Process Return' button is hidden (returns:create required)", async ({
    page,
  }) => {
    await signIn(page, cashierEmail);

    // Navigate to eligible cash sale
    await page.goto(`/${orgSlug}/sales/${saleId1}`);
    await expect(page.getByText(saleNumber1)).toBeVisible();

    // Verify Cashier does NOT see 'Process Return' button
    await expect(page.getByRole("button", { name: /Process Return/i })).toBeHidden();
  });

  test("2. Voided Sale: 'Process Return' button is hidden", async ({ page }) => {
    await signIn(page, ownerEmail);

    // Navigate to voided sale
    await page.goto(`/${orgSlug}/sales/${saleId3}`);
    await expect(page.getByText(saleNumber3)).toBeVisible();

    // Verify 'Process Return' button is hidden on voided sale
    await expect(page.getByRole("button", { name: /Process Return/i })).toBeHidden();
    await expect(page.getByText(/This sale was voided/i)).toBeVisible();
  });

  test("3. Authorized Owner: Process partial return with inventory restock and cash refund", async ({
    page,
  }) => {
    await signIn(page, ownerEmail);

    // Navigate to Sale 1
    await page.goto(`/${orgSlug}/sales/${saleId1}`);
    await expect(page.getByText(saleNumber1)).toBeVisible();

    // Record inventory before return
    const invBefore = await pgClient.query(
      `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, productId]
    );
    const qtyBefore = Number(invBefore.rows[0].quantity);

    // Verify Owner sees 'Process Return' button
    const returnBtn = page.getByRole("button", { name: /Process Return/i });
    await expect(returnBtn).toBeVisible();

    // Click 'Process Return' to open dialog
    await returnBtn.click();

    // Verify dialog header
    await expect(page.getByRole("heading", { name: new RegExp(`Process Return for ${saleNumber1}`, "i") })).toBeVisible();
    await expect(page.getByRole("dialog").getByText("Returnable Widget", { exact: true })).toBeVisible();

    // Verify validation: Confirm button is disabled when reason is empty or < 3 chars
    const confirmBtn = page.getByRole("button", { name: /Confirm Return/i });
    await expect(confirmBtn).toBeDisabled();

    const reasonInput = page.getByLabel(/Reason for Return/i);
    await reasonInput.fill("ab");
    await expect(confirmBtn).toBeDisabled();

    // Enter valid reason
    await reasonInput.fill("Customer returned 1 item due to wrong color");
    await expect(confirmBtn).toBeEnabled();

    // Set return quantity to 1 (default is 1)
    // Submit return
    await confirmBtn.click();

    // Verify success banner appears in modal
    await expect(page.getByText(/Return processed successfully!/i)).toBeVisible();

    // Wait for auto-close and page refresh
    await expect(page.getByRole("heading", { name: new RegExp(`Process Return for ${saleNumber1}`, "i") })).toBeHidden({ timeout: 5000 });

    // Verify status updated on page
    await expect(page.getByText(/Partially Returned/i)).toBeVisible();
    await expect(page.getByText(/Partially Refunded/i)).toBeVisible();

    // Verify inventory increased by 1 in database after restock
    const invAfter = await pgClient.query(
      `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, productId]
    );
    expect(Number(invAfter.rows[0].quantity)).toBe(qtyBefore + 1.0);

    // Switch to Returns & Refunds tab
    await page.getByRole("button", { name: /Returns & Refunds/i }).click();

    // Verify return record is displayed
    await expect(page.getByText(/Customer returned 1 item due to wrong color/i)).toBeVisible();
    await expect(page.getByText(/Restocked/i)).toBeVisible();
    await expect(page.getByText(/Completed/i)).toBeVisible();
  });

  test("4. Authorized Owner: Process return on card sale with pending refund", async ({ page }) => {
    await signIn(page, ownerEmail);

    // Navigate to Sale 2 (Card sale)
    await page.goto(`/${orgSlug}/sales/${saleId2}`);
    await expect(page.getByText(saleNumber2)).toBeVisible();

    // Open Return dialog
    await page.getByRole("button", { name: /Process Return/i }).click();
    await expect(page.getByRole("heading", { name: new RegExp(`Process Return for ${saleNumber2}`, "i") })).toBeVisible();

    // Select Card tender method
    await page.getByRole("button", { name: /^Card$/i }).click();

    // Fill external reference
    const refInput = page.getByPlaceholder(/REV-AUTH-12345/i);
    await refInput.fill("ARN-E2E-CARD-REV");

    // Fill reason
    await page.getByLabel(/Reason for Return/i).fill("Full card return for defective shipment");

    // Submit
    await page.getByRole("button", { name: /Confirm Return/i }).click();
    await expect(page.getByText(/Return processed successfully!/i)).toBeVisible();

    // Wait for auto-close
    await expect(page.getByRole("heading", { name: new RegExp(`Process Return for ${saleNumber2}`, "i") })).toBeHidden({ timeout: 5000 });

    // Switch to Returns tab
    await page.getByRole("button", { name: /Returns & Refunds/i }).click();

    // Verify pending confirmation badge
    await expect(page.getByText(/Pending Confirmation/i)).toBeVisible();
  });

  test("5. Authorized Owner: Process return WITHOUT restocking (leaves inventory unchanged, sets Returned status)", async ({
    page,
  }) => {
    await signIn(page, ownerEmail);

    // Navigate to Sale 1 (which now has 1 remaining item from test 3)
    await page.goto(`/${orgSlug}/sales/${saleId1}`);
    await expect(page.getByText(saleNumber1)).toBeVisible();

    const invBefore = await pgClient.query(
      `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, productId]
    );
    const qtyBefore = Number(invBefore.rows[0].quantity);

    // Open Return dialog for final remaining item
    await page.getByRole("button", { name: /Process Return/i }).click();
    await expect(page.getByRole("heading", { name: new RegExp(`Process Return for ${saleNumber1}`, "i") })).toBeVisible();

    // Uncheck "Restock to inventory"
    const restockCheckbox = page.getByRole("dialog").getByRole("checkbox", { name: /Restock to inventory/i });
    await restockCheckbox.uncheck();
    await expect(restockCheckbox).not.toBeChecked();

    // Fill reason
    await page.getByLabel(/Reason for Return/i).fill("Final item damaged beyond repair do not restock");

    // Submit
    await page.getByRole("button", { name: /Confirm Return/i }).click();
    await expect(page.getByText(/Return processed successfully!/i)).toBeVisible();

    // Wait for modal auto-close
    await expect(page.getByRole("heading", { name: new RegExp(`Process Return for ${saleNumber1}`, "i") })).toBeHidden({ timeout: 5000 });

    // Verify status updated to fully Returned and Refunded
    await expect(page.getByText(/^Returned$/i)).toBeVisible();
    await expect(page.getByText(/^Refunded$/i)).toBeVisible();

    // Verify inventory in database was NOT changed (no restocking)
    const invAfter = await pgClient.query(
      `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, productId]
    );
    expect(Number(invAfter.rows[0].quantity)).toBe(qtyBefore);

    // Switch to Returns & Refunds tab
    await page.getByRole("button", { name: /Returns & Refunds/i }).click();

    // Verify "No Restock" badge is displayed
    await expect(page.getByText(/No Restock/i)).toBeVisible();
  });

  test("6. Excess Return Validation: Rejects return quantity exceeding available returnable quantity", async ({
    page,
  }) => {
    await signIn(page, ownerEmail);

    // Navigate to Sale 2
    await page.goto(`/${orgSlug}/sales/${saleId2}`);
    await expect(page.getByText(saleNumber2)).toBeVisible();

    // Open Return dialog
    await page.getByRole("button", { name: /Process Return/i }).click();
    await expect(page.getByRole("heading", { name: new RegExp(`Process Return for ${saleNumber2}`, "i") })).toBeVisible();

    // Fill return quantity with 10 (sold was 2)
    const qtyInput = page.getByRole("dialog").getByLabel(/Return Qty:/i);
    await qtyInput.fill("10");

    // Fill valid reason
    await page.getByLabel(/Reason for Return/i).fill("Attempting excess return");

    // Submit
    await page.getByRole("button", { name: /Confirm Return/i }).click();

    // Verify validation error banner appears
    await expect(page.getByText(/exceeds remaining unreturned quantity/i)).toBeVisible();

    // Verify dialog remains open
    await expect(page.getByRole("heading", { name: new RegExp(`Process Return for ${saleNumber2}`, "i") })).toBeVisible();
  });

  test("7. Server Action and RPC Guards: Unauthorized caller rejected with 42501, voided sale rejected with P0050", async () => {
    // 1. Direct RPC invocation as Cashier (lacking returns:create)
    const cashierClient = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A_error", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await cashierClient.auth.signInWithPassword({
      email: cashierEmail,
      password: testPassword,
    });

    const s1ItemQuery = await pgClient.query(
      `SELECT id FROM public.sale_items WHERE sale_id = $1 LIMIT 1;`,
      [saleId1]
    );
    const sale1ItemId = s1ItemQuery.rows[0].id;

    const unauthRes = await cashierClient.rpc("execute_sale_return", {
      p_org_id: orgId,
      p_sale_id: saleId1,
      p_return_items: [{ sale_item_id: sale1ItemId, quantity: 1, restock_to_inventory: true }],
      p_refund_method: "cash",
      p_reason: "Unauthorized attempt",
      p_idempotency_key: randomUUID(),
    });

    expect(unauthRes.error).not.toBeNull();
    expect(unauthRes.error!.code).toBe("42501");
    expect(unauthRes.error!.message).toContain("INSUFFICIENT_PERMISSIONS");

    // 2. Direct RPC invocation against voided sale (saleId3)
    const s3ItemQuery = await pgClient.query(
      `SELECT id FROM public.sale_items WHERE sale_id = $1 LIMIT 1;`,
      [saleId3]
    );
    const sale3ItemId = s3ItemQuery.rows[0].id;

    const voidReturnRes = await ownerClient.rpc("execute_sale_return", {
      p_org_id: orgId,
      p_sale_id: saleId3,
      p_return_items: [{ sale_item_id: sale3ItemId, quantity: 1, restock_to_inventory: true }],
      p_refund_method: "cash",
      p_reason: "Void return attempt",
      p_idempotency_key: randomUUID(),
    });

    expect(voidReturnRes.error).not.toBeNull();
    expect(voidReturnRes.error!.code).toBe("P0050");
    expect(voidReturnRes.error!.message).toContain("SALE_ALREADY_VOIDED");
  });
});
