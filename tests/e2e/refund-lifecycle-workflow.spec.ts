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

test.describe("Feature 005 — Phase 8 E2E: Refund Lifecycle & Replacement Workflow (T075, T076, US7)", () => {
  let pgClient: PgClient;
  const createdUserIds: string[] = [];

  const testPassword = "P@ssword123!RefundE2E";
  const timestamp = Date.now();

  const ownerEmail = `owner_refund_e2e_${timestamp}@bizflow-test.internal`;
  const cashierEmail = `cashier_refund_e2e_${timestamp}@bizflow-test.internal`;

  let ownerId: string;
  let cashierId: string;

  const orgName = `Refund E2E Store ${timestamp}`;
  const orgSlug = `refund-e2e-${timestamp}`;
  let orgId: string;

  let customerId: string;
  let productId: string;
  const testSku = `SKU-REFUND-${timestamp}`;

  let saleId1: string; // Sale for Confirm Workflow
  let saleId2: string; // Sale for Failure & Replacement Workflow

  test.beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    // 1. Create Owner User
    const { data: oData, error: oErr } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Robin", last_name: "Refund" },
    });
    if (oErr || !oData.user) throw new Error(`Failed to create owner: ${oErr?.message}`);
    ownerId = oData.user.id;
    createdUserIds.push(ownerId);

    // 2. Create Cashier User
    const { data: cData, error: cErr } = await adminClient.auth.admin.createUser({
      email: cashierEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Casey", last_name: "Cashier" },
    });
    if (cErr || !cData.user) throw new Error(`Failed to create cashier: ${cErr?.message}`);
    cashierId = cData.user.id;
    createdUserIds.push(cashierId);

    // 3. User Profiles
    await pgClient.query(
      `INSERT INTO public.profiles (id, first_name, last_name)
       VALUES ($1, 'Robin', 'Refund'), ($2, 'Casey', 'Cashier')
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
      })
      .select("id")
      .single();
    if (orgErr || !org) throw new Error(`Failed to create organization: ${orgErr?.message}`);
    orgId = org.id;

    // 5. Memberships
    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active'), ($1, $3, 'cashier', 'active')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active';`,
      [orgId, ownerId, cashierId]
    );

    // 6. Tax Settings (0% for simple numbers)
    await pgClient.query(
      `INSERT INTO public.organization_tax_settings (organization_id, tax_name, default_tax_rate, is_tax_inclusive, updated_by)
       VALUES ($1, 'Standard Tax', 0.0000, false, $2)
       ON CONFLICT (organization_id) DO UPDATE SET default_tax_rate = 0.0000, is_tax_inclusive = false;`,
      [orgId, ownerId]
    );

    // 7. Product & Inventory
    const { data: prod, error: prodErr } = await adminClient
      .from("products")
      .insert({
        organization_id: orgId,
        name: `E2E Refund Product ${timestamp}`,
        sku: testSku,
        selling_price: 50.0,
        unit_of_measure: "piece",
        status: "active",
        created_by: ownerId,
        updated_by: ownerId,
      })
      .select("id")
      .single();
    if (prodErr || !prod) throw new Error(`Failed to create product: ${prodErr?.message}`);
    productId = prod.id;

    await pgClient.query(
      `INSERT INTO public.inventory (organization_id, product_id, quantity)
       VALUES ($1, $2, 100.0000)
       ON CONFLICT (organization_id, product_id) DO UPDATE SET quantity = 100.0000;`,
      [orgId, productId]
    );

    // 8. Customer
    const { data: cust, error: custErr } = await adminClient
      .from("customers")
      .insert({
        organization_id: orgId,
        name: "E2E Refund Customer",
        phone: "+15555550399",
        email: "e2e.refund@bizflow-test.internal",
        status: "active",
      })
      .select("id")
      .single();
    if (custErr || !cust) throw new Error(`Failed to create customer: ${custErr?.message}`);
    customerId = cust.id;

    // 8b. Authenticate ownerClient for calling RPCs with auth.uid() context
    const anonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE2OTE2NjgxODEsImV4cCI6MjAwNzI0NDE4MX0.X_hT2p4qZ6W_Z87C9o6j66zZzM833p67U5gN6Fh_mFs";
    const ownerClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: oSignErr } = await ownerClient.auth.signInWithPassword({
      email: ownerEmail,
      password: testPassword,
    });
    if (oSignErr) throw oSignErr;

    // 9. Create Sale 1 (Card tender $50) and void it to create Pending Card Refund
    const { data: s1Data, error: s1Err } = await ownerClient.rpc("execute_sale", {
      p_org_id: orgId,
      p_customer_id: customerId,
      p_items: [{ product_id: productId, quantity: 1, unit_price: 50.0, line_discount_amount: 0 }],
      p_payments: [{ payment_method: "card", amount: 50.0, reference_no: `AUTH-CARD-1-${timestamp}` }],
      p_order_discount_amount: 0,
      p_idempotency_key: randomUUID(),
    });
    if (s1Err || !s1Data) throw new Error(`Failed to execute sale 1: ${s1Err?.message}`);
    saleId1 = s1Data.sale_id;

    const { error: v1Err } = await ownerClient.rpc("void_sale", {
      p_org_id: orgId,
      p_sale_id: saleId1,
      p_void_reason: "Customer voided sale",
      p_idempotency_key: randomUUID(),
      p_reversal_references: null,
    });
    if (v1Err) throw new Error(`Failed to void sale 1: ${v1Err?.message}`);

    // 10. Create Sale 2 (Card tender $50) and void it to create Pending Card Refund
    const { data: s2Data, error: s2Err } = await ownerClient.rpc("execute_sale", {
      p_org_id: orgId,
      p_customer_id: customerId,
      p_items: [{ product_id: productId, quantity: 1, unit_price: 50.0, line_discount_amount: 0 }],
      p_payments: [{ payment_method: "card", amount: 50.0, reference_no: `AUTH-CARD-2-${timestamp}` }],
      p_order_discount_amount: 0,
      p_idempotency_key: randomUUID(),
    });
    if (s2Err || !s2Data) throw new Error(`Failed to execute sale 2: ${s2Err?.message}`);
    saleId2 = s2Data.sale_id;

    const { error: v2Err } = await ownerClient.rpc("void_sale", {
      p_org_id: orgId,
      p_sale_id: saleId2,
      p_void_reason: "Customer voided sale 2",
      p_idempotency_key: randomUUID(),
      p_reversal_references: null,
    });
    if (v2Err) throw new Error(`Failed to void sale 2: ${v2Err?.message}`);
  });

  test.afterAll(async () => {
    try {
      if (pgClient) {
        await pgClient.query(`SET session_replication_role = 'replica';`);
        if (orgId) {
          await pgClient.query(`DELETE FROM public.refunds WHERE organization_id = $1;`, [orgId]);
          await pgClient.query(`DELETE FROM public.sale_returns WHERE organization_id = $1;`, [orgId]);
          await pgClient.query(`DELETE FROM public.payments WHERE organization_id = $1;`, [orgId]);
          await pgClient.query(`DELETE FROM public.sale_items WHERE organization_id = $1;`, [orgId]);
          await pgClient.query(`DELETE FROM public.sales WHERE organization_id = $1;`, [orgId]);
          await pgClient.query(`DELETE FROM public.stock_movements WHERE organization_id = $1;`, [orgId]);
          await pgClient.query(`DELETE FROM public.inventory WHERE organization_id = $1;`, [orgId]);
          await pgClient.query(`DELETE FROM public.products WHERE organization_id = $1;`, [orgId]);
          await pgClient.query(`DELETE FROM public.customers WHERE organization_id = $1;`, [orgId]);
          await pgClient.query(`DELETE FROM public.organization_tax_settings WHERE organization_id = $1;`, [orgId]);
          await pgClient.query(`DELETE FROM public.organization_memberships WHERE organization_id = $1;`, [orgId]);
          await pgClient.query(`DELETE FROM public.organizations WHERE id = $1;`, [orgId]);
        }
        for (const uid of createdUserIds) {
          await pgClient.query(`DELETE FROM public.profiles WHERE id = $1;`, [uid]);
          await adminClient.auth.admin.deleteUser(uid);
        }
        await pgClient.query(`SET session_replication_role = 'origin';`);
        await pgClient.end();
      }
    } catch (e) {
      console.error("Cleanup error in afterAll:", e);
    }
  });

  async function signIn(page: any, email: string) {
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(new RegExp(`/${orgSlug}/dashboard`));
  }

  test("Manager can confirm a pending card refund with external provider reference", async ({ page }) => {
    // 1. Log in as Store Owner
    await signIn(page, ownerEmail);

    // 2. Navigate to Sale 1 Detail Page
    await page.goto(`/${orgSlug}/sales/${saleId1}`);
    await expect(page.locator("h1")).toBeVisible();

    // 3. Switch to Returns & Refunds Tab
    const tabBtn = page.getByRole("button", { name: /Returns & Refunds/i });
    await tabBtn.click();

    // 4. Verify Reimbursement Lifecycle card is visible
    await expect(page.getByText(/Reimbursement Lifecycle Management/i)).toBeVisible();
    await expect(page.getByText(/Pending Confirmation/i).first()).toBeVisible();

    // 5. Click Confirm button
    const confirmBtn = page.getByRole("button", { name: /^Confirm$/i });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // 6. Modal appears: enter external reference and submit
    await expect(page.getByRole("heading", { name: /Confirm Refund Reimbursement/i })).toBeVisible();
    const refInput = page.getByPlaceholder(/REV-CARD/i);
    await refInput.fill("REV-E2E-GATEWAY-1122");

    const submitBtn = page.getByRole("button", { name: /Confirm Reimbursement/i });
    await submitBtn.click();

    // 7. Verify modal closes and status updates to Completed
    await expect(page.getByRole("heading", { name: /Confirm Refund Reimbursement/i })).not.toBeVisible();
    await expect(page.getByText(/Completed/i).first()).toBeVisible();
    await expect(page.getByText(/REV-E2E-GATEWAY-1122/i).first()).toBeVisible();
  });

  test("Manager can record failure on pending refund and issue replacement reimbursement", async ({ page }) => {
    // 1. Log in as Store Owner
    await signIn(page, ownerEmail);

    // 2. Navigate to Sale 2 Detail Page
    await page.goto(`/${orgSlug}/sales/${saleId2}`);
    await expect(page.locator("h1")).toBeVisible();

    // 3. Switch to Returns & Refunds Tab
    const tabBtn = page.getByRole("button", { name: /Returns & Refunds/i });
    await tabBtn.click();

    // 4. Click Fail button
    const failBtn = page.getByRole("button", { name: /^Fail$/i });
    await expect(failBtn).toBeVisible();
    await failBtn.click();

    // 5. Fill failure reason modal
    await expect(page.getByRole("heading", { name: /Record Reimbursement Failure/i })).toBeVisible();
    const reasonTextarea = page.getByPlaceholder(/e\.g\. Card expired/i);
    await reasonTextarea.fill("Card declined by gateway timeout");

    const submitFailBtn = page.getByRole("button", { name: /Record Failure/i });
    await submitFailBtn.click();

    // 6. Verify modal closes, refund marked Failed
    await expect(page.getByRole("heading", { name: /Record Reimbursement Failure/i })).not.toBeVisible();
    await expect(page.getByText(/Card declined by gateway timeout/i)).toBeVisible();

    // 7. Click Replace button on failed refund
    const replaceBtn = page.getByRole("button", { name: /^Replace$/i });
    await expect(replaceBtn).toBeVisible();
    await replaceBtn.click();

    // 8. Replacement modal: choose Cash, add notes, submit
    await expect(page.getByRole("heading", { name: /Issue Replacement Reimbursement/i })).toBeVisible();
    const methodSelect = page.getByLabel(/Replacement Refund Method/i);
    await methodSelect.selectOption("cash");

    const notesInput = page.getByPlaceholder(/Auditable reason/i);
    await notesInput.fill("Cash payout at customer service desk");

    const submitReplaceBtn = page.getByRole("button", { name: /Issue Replacement/i });
    await submitReplaceBtn.click();

    // 9. Verify modal closes and Cash replacement is listed as Completed
    await expect(page.getByRole("heading", { name: /Issue Replacement Reimbursement/i })).not.toBeVisible();
    await expect(page.getByText(/Completed/i).first()).toBeVisible();
  });

  test("Cashier without void/returns permissions sees no action buttons", async ({ page }) => {
    // 1. Log in as Cashier
    await signIn(page, cashierEmail);

    // 2. Navigate to Sale 1 Detail Page
    await page.goto(`/${orgSlug}/sales/${saleId1}`);
    await expect(page.locator("h1")).toBeVisible();

    // 3. Switch to Returns & Refunds Tab
    const tabBtn = page.getByRole("button", { name: /Returns & Refunds/i });
    await tabBtn.click();

    // 4. Verify no action buttons are present for cashier
    await expect(page.getByRole("button", { name: /^Confirm$/i })).not.toBeVisible();
    await expect(page.getByRole("button", { name: /^Fail$/i })).not.toBeVisible();
    await expect(page.getByRole("button", { name: /^Replace$/i })).not.toBeVisible();
  });
});
