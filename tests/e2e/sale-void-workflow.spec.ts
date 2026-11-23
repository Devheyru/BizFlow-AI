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

test.describe("Feature 005 — Phase 6 E2E: Sale Void & Cancellation Workflow (T066–T068, US6)", () => {
  let pgClient: PgClient;
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  const testPassword = "P@ssword123!VoidE2E";
  const timestamp = Date.now();

  const ownerEmail = `owner_void_e2e_${timestamp}@bizflow-test.internal`;
  const cashierEmail = `cashier_void_e2e_${timestamp}@bizflow-test.internal`;

  let ownerId: string;
  let cashierId: string;

  const orgName = `Void E2E Store ${timestamp}`;
  const orgSlug = `void-e2e-${timestamp}`;
  let orgId: string;

  let customerId: string;
  let productId: string;
  const testSku = `SKU-VOID-${timestamp}`;

  let saleId1: string; // Eligible Cash Sale
  let saleNumber1: string;

  let saleId2: string; // Eligible Split Sale (Cash + Card)
  let saleNumber2: string;

  let saleId3: string; // Ineligible Sale with existing returns
  let saleNumber3: string;

  let saleId4: string; // Sale for failed void error handling verification
  let saleNumber4: string;

  let saleId5: string; // Sale for repeated interaction & replay verification
  let saleNumber5: string;

  let ownerClient: any;

  test.beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    // 1. Create Owner User
    const { data: oData, error: oErr } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Oscar", last_name: "Owner" },
    });
    if (oErr || !oData.user) throw new Error(`Failed to create owner: ${oErr?.message}`);
    ownerId = oData.user.id;
    createdUserIds.push(ownerId);

    // 2. Create Cashier User
    const { data: cData, error: cErr } = await adminClient.auth.admin.createUser({
      email: cashierEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Charlie", last_name: "Cashier" },
    });
    if (cErr || !cData.user) throw new Error(`Failed to create cashier: ${cErr?.message}`);
    cashierId = cData.user.id;
    createdUserIds.push(cashierId);

    // 3. User Profiles
    await pgClient.query(
      `INSERT INTO public.profiles (id, first_name, last_name)
       VALUES ($1, 'Oscar', 'Owner'), ($2, 'Charlie', 'Cashier')
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
       VALUES ($1, 'Jane Customer', '+14155551234', 'jane@bizflow-test.internal', 'active')
       RETURNING id;`,
      [orgId]
    );
    customerId = custRes.rows[0].id;

    // 8. Seed Product with Inventory
    const prodRes = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
       VALUES ($1, 'Voidable Item', $2, 40.0000, 'unit', 'active', $3, $3)
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
      payments: Array<{ payment_method: string; amount: number; reference_no?: string | null; amount_tendered?: number; change_due?: number }>
    ) {
      const { data, error } = await ownerClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: customerId,
        p_items: [
          {
            product_id: productId,
            quantity: 1,
            unit_price: 40.0,
            line_discount_amount: 0,
          },
        ],
        p_payments: payments,
        p_order_discount_amount: 0,
        p_idempotency_key: randomUUID(),
        p_notes: "E2E void test sale",
      });
      if (error || !data) throw new Error(`Failed to execute test sale: ${error?.message}`);
      return { saleId: data.sale_id, saleNumber: data.sale_number };
    }

    // 9. Seed Sale 1: Cash sale ($44.00)
    const s1 = await seedCompletedSale([
      { payment_method: "cash", amount: 44.0, amount_tendered: 50.0, change_due: 6.0 },
    ]);
    saleId1 = s1.saleId;
    saleNumber1 = s1.saleNumber;

    // 10. Seed Sale 2: Split sale ($20 Cash, $24 Card)
    const s2 = await seedCompletedSale([
      { payment_method: "cash", amount: 20.0, amount_tendered: 20.0, change_due: 0.0 },
      { payment_method: "card", amount: 24.0, reference_no: "AUTH-E2E-CARD" },
    ]);
    saleId2 = s2.saleId;
    saleNumber2 = s2.saleNumber;

    // 11. Seed Sale 3: Sale with processed return
    const s3 = await seedCompletedSale([
      { payment_method: "cash", amount: 44.0, amount_tendered: 44.0, change_due: 0.0 },
    ]);
    saleId3 = s3.saleId;
    saleNumber3 = s3.saleNumber;

    // 12. Seed Sale 4: Sale for failed void error handling verification ($44.00)
    const s4 = await seedCompletedSale([
      { payment_method: "cash", amount: 44.0, amount_tendered: 50.0, change_due: 6.0 },
    ]);
    saleId4 = s4.saleId;
    saleNumber4 = s4.saleNumber;

    // 13. Seed Sale 5: Sale for repeated interaction & replay verification ($44.00)
    const s5 = await seedCompletedSale([
      { payment_method: "cash", amount: 44.0, amount_tendered: 50.0, change_due: 6.0 },
    ]);
    saleId5 = s5.saleId;
    saleNumber5 = s5.saleNumber;

    // Add a return against Sale 3
    const returnId = randomUUID();
    await pgClient.query(
      `INSERT INTO public.sale_returns (
         id, organization_id, return_number, sale_id, total_refund_amount, reason, idempotency_key, idempotency_hash, created_by
       ) VALUES (
         $1, $2, $3, $4, 22.0000, 'Customer returned half', gen_random_uuid(), 'dummy_hash', $5
       );`,
      [returnId, orgId, `RET-V3-${timestamp}`, saleId3, ownerId]
    );
  });

  test.afterAll(async () => {
    if (pgClient) {
      try {
        await pgClient.query(`SET session_replication_role = 'replica';`);
        await pgClient.query(`DELETE FROM public.refunds WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
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

  test("1. Cashier Role & Ineligible Sales: 'Void Sale' button is hidden (Req 2, 3)", async ({
    page,
  }) => {
    // Sign in as Cashier
    await signIn(page, cashierEmail);

    // Navigate to eligible cash sale
    await page.goto(`/${orgSlug}/sales/${saleId1}`);
    await expect(page.getByText(saleNumber1)).toBeVisible();

    // Verify Cashier does NOT see 'Void Sale' button
    await expect(page.getByRole("button", { name: /Void Sale/i })).toBeHidden();

    // Navigate to sale with existing returns
    await page.goto(`/${orgSlug}/sales/${saleId3}`);
    await expect(page.getByText(saleNumber3)).toBeVisible();

    // Verify 'Void Sale' button is NOT visible for sale with returns
    await expect(page.getByRole("button", { name: /Void Sale/i })).toBeHidden();
  });

  test("2. Authorized Owner: Void Cash Sale with immediate refund and inventory restoration (Req 1, 4, 5, 6, 8)", async ({
    page,
  }) => {
    // Sign in as Owner
    await signIn(page, ownerEmail);

    // Navigate to Sale 1
    await page.goto(`/${orgSlug}/sales/${saleId1}`);
    await expect(page.getByText(saleNumber1)).toBeVisible();

    // Verify Owner sees 'Void Sale' button
    const voidBtn = page.getByRole("button", { name: /Void Sale/i });
    await expect(voidBtn).toBeVisible();

    // Click 'Void Sale' to open dialog
    await voidBtn.click();

    // Verify dialog header, warning notice, and breakdown
    await expect(page.getByRole("heading", { name: new RegExp(`Void Sale ${saleNumber1}`, "i") })).toBeVisible();
    await expect(page.getByText(/Permanent Transaction Reversal/i)).toBeVisible();
    await expect(page.getByText(/Immediate Cash Refund/i)).toBeVisible();

    // Verify validation: Confirm button is disabled when reason is empty or < 3 chars
    const confirmBtn = page.getByRole("button", { name: /Confirm Void/i });
    await expect(confirmBtn).toBeDisabled();

    const reasonInput = page.getByPlaceholder(/Enter the business justification/i);
    await reasonInput.fill("no");
    await expect(confirmBtn).toBeDisabled();

    // Enter valid reason
    await reasonInput.fill("Customer walked away before taking items");
    await expect(confirmBtn).toBeEnabled();

    // Submit void
    await confirmBtn.click();

    // Verify dialog success notification
    await expect(page.getByText(/Sale voided successfully/i)).toBeVisible();

    // Wait for dialog to auto-close and page to refresh
    await expect(page.getByText(/This sale was voided/i)).toBeVisible({ timeout: 10000 });

    // Verify page state updates
    await expect(page.getByText("Voided", { exact: true })).toBeVisible();
    await expect(page.getByText("Refunded", { exact: true })).toBeVisible();

    // Verify 'Void Sale' button is gone (repeated interaction prevented)
    await expect(page.getByRole("button", { name: /Void Sale/i })).toBeHidden();

    // Switch to Returns & Refunds tab
    await page.getByRole("button", { name: /Returns & Refunds/i }).click();

    // Verify void reversal record is displayed
    await expect(page.getByRole("heading", { name: /Void Reversal Reimbursements/i })).toBeVisible();
    await expect(page.getByText("Completed")).toBeVisible();
    await expect(page.locator("span.font-semibold", { hasText: "$44.00" })).toBeVisible();
  });

  test("3. Authorized Owner: Void Split Sale with Reversal Reference (Req 4, 5, 6)", async ({
    page,
  }) => {
    // Sign in as Owner
    await signIn(page, ownerEmail);

    // Navigate to Sale 2 (Split Cash + Card)
    await page.goto(`/${orgSlug}/sales/${saleId2}`);
    await expect(page.getByText(saleNumber2)).toBeVisible();

    // Click 'Void Sale'
    await page.getByRole("button", { name: /Void Sale/i }).click();

    // Verify both tenders are displayed in breakdown
    await expect(page.getByRole("heading", { name: new RegExp(`Void Sale ${saleNumber2}`, "i") })).toBeVisible();
    await expect(page.getByText(/Immediate Cash Refund/i)).toBeVisible();
    await expect(page.getByText(/Pending External Reimbursement/i)).toBeVisible();

    // Fill optional reversal reference for card payment
    const refInput = page.getByPlaceholder(/e\.g\. REV-AUTH-12345/i);
    await expect(refInput).toBeVisible();
    await refInput.fill("REV-E2E-998877");

    // Fill reason
    const reasonInput = page.getByPlaceholder(/Enter the business justification/i);
    await reasonInput.fill("Voiding split tender transaction for customer");

    // Submit void
    await page.getByRole("button", { name: /Confirm Void/i }).click();

    // Wait for void completion
    await expect(page.getByText(/Sale voided successfully/i)).toBeVisible();
    await expect(page.getByText(/This sale was voided/i)).toBeVisible({ timeout: 10000 });

    // Verify status: Voided, Partially Refunded (F005-039 compliant)
    await expect(page.getByText("Voided", { exact: true })).toBeVisible();
    await expect(page.getByText("Partially Refunded", { exact: true })).toBeVisible();

    // Switch to Returns & Refunds tab
    await page.getByRole("button", { name: /Returns & Refunds/i }).click();

    // Verify both reversals appear: Cash completed, Card pending with reference
    await expect(page.getByText(/Void Reversal Reimbursements/i)).toBeVisible();
    await expect(page.getByText(/REV-E2E-998877/i)).toBeVisible();
    await expect(page.getByText("$20.00")).toBeVisible();
    await expect(page.getByText("$24.00")).toBeVisible();
  });

  test("4. Failed Void Request: Meaningful error displayed, no false success, and transaction atomicity", async ({
    page,
  }) => {
    // Sign in as Owner
    await signIn(page, ownerEmail);

    // Navigate to Sale 4
    await page.goto(`/${orgSlug}/sales/${saleId4}`);
    await expect(page.getByText(saleNumber4)).toBeVisible();

    // Click 'Void Sale'
    const voidBtn = page.getByRole("button", { name: /Void Sale/i });
    await expect(voidBtn).toBeVisible();
    await voidBtn.click();

    // Dialog opens
    await expect(
      page.getByRole("heading", { name: new RegExp(`Void Sale ${saleNumber4}`, "i") })
    ).toBeVisible();

    // Fill valid reason
    const reasonInput = page.getByPlaceholder(/Enter the business justification/i);
    await reasonInput.fill("Attempting to void sale with concurrent return");

    // Before clicking confirm, insert a return against Sale 4 directly into database
    await pgClient.query(
      `INSERT INTO public.sale_returns (
         id, organization_id, return_number, sale_id, total_refund_amount, reason, idempotency_key, idempotency_hash, created_by
       ) VALUES (
         gen_random_uuid(), $1, $2, $3, 22.0000, 'Concurrent customer return', gen_random_uuid(), 'dummy_hash', $4
       );`,
      [orgId, `RET-V4-${Date.now()}`, saleId4, ownerId]
    );

    // Click confirm void
    const confirmBtn = page.getByRole("button", { name: /Confirm Void/i });
    await confirmBtn.click();

    // Verify error notification is displayed in dialog
    await expect(page.getByText(/Unable to void sale:/i)).toBeVisible();
    await expect(
      page.getByText(/Sale cannot be voided after returns have been processed/i)
    ).toBeVisible();

    // Verify NO false success
    await expect(page.getByText(/Sale voided successfully/i)).toBeHidden();

    // Close the dialog via Cancel
    await page.getByRole("button", { name: /Cancel/i }).click();

    // Verify database state: 0 void refunds, 0 stock movements, sale status remains 'completed'
    const refundsCount = await pgClient.query(
      `SELECT count(*) FROM public.refunds WHERE sale_id = $1 AND reason LIKE 'Void sale:%';`,
      [saleId4]
    );
    expect(Number(refundsCount.rows[0].count)).toBe(0);

    const mvtCount = await pgClient.query(
      `SELECT count(*) FROM public.stock_movements WHERE reference_id = $1;`,
      [`void:${saleId4}`]
    );
    expect(Number(mvtCount.rows[0].count)).toBe(0);

    const saleCheck = await pgClient.query(
      `SELECT status FROM public.sales WHERE id = $1;`,
      [saleId4]
    );
    expect(saleCheck.rows[0].status).toBe("completed");
  });

  test("5. Repeated Interaction & Double-Void Prevention: UI gating and zero duplicate mutations on replay", async ({
    page,
  }) => {
    // Sign in as Owner
    await signIn(page, ownerEmail);

    // Navigate to Sale 5
    await page.goto(`/${orgSlug}/sales/${saleId5}`);
    await expect(page.getByText(saleNumber5)).toBeVisible();

    // Click 'Void Sale'
    const voidBtn = page.getByRole("button", { name: /Void Sale/i });
    await expect(voidBtn).toBeVisible();
    await voidBtn.click();

    // Enter valid reason
    const reasonInput = page.getByPlaceholder(/Enter the business justification/i);
    await reasonInput.fill("Accidental duplicate checkout at counter");

    const confirmBtn = page.getByRole("button", { name: /Confirm Void/i });
    await confirmBtn.click();

    // Wait for void to complete
    await expect(page.getByText(/Sale voided successfully/i)).toBeVisible();
    await expect(page.getByText(/This sale was voided/i)).toBeVisible({ timeout: 10000 });

    // Verify 'Void Sale' button is permanently hidden (preventing repeated UI interaction)
    await expect(page.getByRole("button", { name: /Void Sale/i })).toBeHidden();

    // Retrieve stored idempotency key and hash from public.sales
    const saleRow = await pgClient.query(
      `SELECT void_idempotency_key, void_idempotency_hash FROM public.sales WHERE id = $1;`,
      [saleId5]
    );
    const storedKey = saleRow.rows[0].void_idempotency_key;
    expect(storedKey).toBeDefined();

    // Execute direct RPC replay call with the same idempotency key as Owner
    const { data: replayData, error: replayErr } = await ownerClient.rpc("void_sale", {
      p_org_id: orgId,
      p_sale_id: saleId5,
      p_void_reason: "Accidental duplicate checkout at counter",
      p_idempotency_key: storedKey,
    });
    expect(replayErr).toBeNull();
    expect(replayData.success).toBe(true);
    expect(replayData.is_replay).toBe(true);

    // Verify exactly 1 refund record and exactly 1 stock movement exist
    const refundsCount = await pgClient.query(
      `SELECT count(*) FROM public.refunds WHERE sale_id = $1;`,
      [saleId5]
    );
    expect(Number(refundsCount.rows[0].count)).toBe(1);

    const mvtCount = await pgClient.query(
      `SELECT count(*) FROM public.stock_movements WHERE reference_id = $1;`,
      [`void:${saleId5}`]
    );
    expect(Number(mvtCount.rows[0].count)).toBe(1);
  });
});
