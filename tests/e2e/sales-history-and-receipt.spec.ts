import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { randomUUID } from "node:crypto";
import * as zlib from "node:zlib";
import * as fs from "node:fs";
import * as path from "node:path";

export interface ParsedPdf {
  pageCount: number;
  pages: { widthPt: number; heightPt: number; widthMm: number; heightMm: number }[];
  extractedText: string;
  normalizedText: string;
  normalizedUpperText: string;
}

/**
 * Robust pure-Node.js PDF parser for Chromium-generated PDFs.
 * Decompresses FlateDecode content streams and decodes ToUnicode CMaps for accurate text extraction.
 */
export function parseChromiumPdf(buffer: Buffer): ParsedPdf {
  const binary = buffer.toString("binary");

  // 1. Page dimensions and count from MediaBox
  const mediaBoxMatches = [...binary.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([0-9.]+)\s+([0-9.]+)\s*\]/g)];
  const pages: { widthPt: number; heightPt: number; widthMm: number; heightMm: number }[] = [];
  for (const m of mediaBoxMatches) {
    if (!m[1] || !m[2]) continue;
    const widthPt = parseFloat(m[1]);
    const heightPt = parseFloat(m[2]);
    pages.push({
      widthPt: Math.round(widthPt * 100) / 100,
      heightPt: Math.round(heightPt * 100) / 100,
      widthMm: Math.round(((widthPt * 25.4) / 72) * 100) / 100,
      heightMm: Math.round(((heightPt * 25.4) / 72) * 100) / 100,
    });
  }

  // 2. Collect CMaps for glyph decoding
  const glyphMap = new Map<string, string>();
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let match: RegExpExecArray | null;

  const contentStreams: string[] = [];

  while ((match = streamRegex.exec(binary)) !== null) {
    const streamContent = match[1];
    if (!streamContent) continue;
    const rawStream = Buffer.from(streamContent, "binary");
    try {
      const decompressed = zlib.inflateSync(rawStream).toString("latin1");
      if (decompressed.includes("begincmap")) {
        const bfcharBlocks = decompressed.matchAll(/beginbfchar([\s\S]*?)endbfchar/g);
        for (const block of bfcharBlocks) {
          if (!block[1]) continue;
          const lines = block[1].matchAll(/<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/g);
          for (const line of lines) {
            if (!line[1] || !line[2]) continue;
            const glyphHex = line[1].toUpperCase().padStart(4, "0");
            const charCode = parseInt(line[2], 16);
            glyphMap.set(glyphHex, String.fromCharCode(charCode));
          }
        }

        const bfrangeBlocks = decompressed.matchAll(/beginbfrange([\s\S]*?)endbfrange/g);
        for (const block of bfrangeBlocks) {
          if (!block[1]) continue;
          const lines = block[1].matchAll(/<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/g);
          for (const line of lines) {
            if (!line[1] || !line[2] || !line[3]) continue;
            const start = parseInt(line[1], 16);
            const end = parseInt(line[2], 16);
            const targetStart = parseInt(line[3], 16);
            for (let i = 0; i <= end - start; i++) {
              const glyphHex = (start + i).toString(16).toUpperCase().padStart(4, "0");
              glyphMap.set(glyphHex, String.fromCharCode(targetStart + i));
            }
          }
        }
      } else if (decompressed.includes("BT") && decompressed.includes("ET")) {
        contentStreams.push(decompressed);
      }
    } catch {}
  }

  // 3. Decode all text in content streams per BT...ET block using glyphMap
  let allText = "";
  for (const stream of contentStreams) {
    for (const bt of stream.matchAll(/BT([\s\S]*?)ET/g)) {
      if (!bt[1]) continue;
      let blockText = "";
      for (const h of bt[1].matchAll(/<([0-9a-fA-F]+)>/g)) {
        const hex = h[1];
        if (!hex) continue;
        for (let i = 0; i < hex.length; i += 4) {
          blockText += glyphMap.get(hex.substring(i, i + 4).toUpperCase()) || "";
        }
      }
      for (const lit of bt[1].matchAll(/\(([^)]*)\)/g)) {
        if (lit[1]) blockText += lit[1];
      }
      if (blockText.trim()) {
        allText += blockText.trim() + "\n";
      }
    }
  }

  const normalizedText = allText.replace(/\s+/g, " ");

  return {
    pageCount: pages.length,
    pages,
    extractedText: allText,
    normalizedText,
    normalizedUpperText: normalizedText.toUpperCase(),
  };
}

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

test.describe("Feature 005 — Phase 5 E2E: Sales History, Detail & Thermal Receipt (T063–T065, US5)", () => {
  let pgClient: PgClient;
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  const testPassword = "P@ssword123!SalesE2E";
  const timestamp = Date.now();

  const ownerEmail = `owner_hist_e2e_${timestamp}@bizflow-test.internal`;
  const cashierEmail = `cashier_hist_e2e_${timestamp}@bizflow-test.internal`;

  let ownerId: string;
  let cashierId: string;

  const orgName = `Sales E2E Store ${timestamp}`;
  const orgSlug = `sales-e2e-${timestamp}`;
  let orgId: string;

  let customerId: string;
  const customerName = `John Customer ${timestamp}`;
  const customerPhone = `+1415555${Math.floor(1000 + Math.random() * 9000)}`;

  let categoryId: string;
  let productId: string;
  const testSku = `SKU-SAL-${timestamp}`;
  const testProductName = `Receipt Test Widget ${timestamp}`;
  const testSellingPrice = 50.0;
  const testCostPrice = 30.0; // Strictly confidential unit cost

  let saleId1: string;
  let saleNumber1: string;
  let saleId2: string;
  let saleNumber2: string;

  let returnId: string;
  let returnNumber: string;

  // Long sale variables for multi-page receipt & text wrapping tests
  let saleIdLong: string;
  let saleNumberLong: string;
  let customerLongName: string;
  let customerLongPhone: string;
  const longProductNames: string[] = [];
  const longProductCosts: number[] = [];

  test.beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    // Ensure artifact output directory exists
    const artifactDir = path.join(process.cwd(), "test-results");
    if (!fs.existsSync(artifactDir)) {
      fs.mkdirSync(artifactDir, { recursive: true });
    }

    // 1. Create Owner User
    const { data: oData, error: oErr } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Owen", last_name: "Owner" },
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
       VALUES ($1, 'Owen', 'Owner'), ($2, 'Casey', 'Cashier')
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

    // 5. Assign Memberships
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

    // 6. Tax Settings: 10% exclusive
    await pgClient.query(
      `INSERT INTO public.organization_tax_settings (organization_id, tax_name, default_tax_rate, is_tax_inclusive, updated_by)
       VALUES ($1, 'State Tax', 10.0000, false, $2)
       ON CONFLICT (organization_id) DO UPDATE
       SET tax_name = 'State Tax', default_tax_rate = 10.0000, is_tax_inclusive = false;`,
      [orgId, ownerId]
    );

    // 7. Seed Customer 1
    const custRes = await pgClient.query(
      `INSERT INTO public.customers (organization_id, name, phone, email, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING id;`,
      [orgId, customerName, customerPhone, `john_${timestamp}@bizflow-test.internal`]
    );
    customerId = custRes.rows[0].id;

    // 8. Seed Category & Product with Inventory and Cost
    const catRes = await pgClient.query(
      `INSERT INTO public.product_categories (organization_id, name, status, created_by, updated_by)
       VALUES ($1, 'General Goods', 'active', $2, $2)
       RETURNING id;`,
      [orgId, ownerId]
    );
    categoryId = catRes.rows[0].id;

    const prodRes = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, category_id, unit_of_measure, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, 'unit', 'active', $6, $6)
       RETURNING id;`,
      [orgId, testProductName, testSku, testSellingPrice, categoryId, ownerId]
    );
    productId = prodRes.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.product_costs (organization_id, product_id, cost_price)
       VALUES ($1, $2, $3);`,
      [orgId, productId, testCostPrice]
    );

    await pgClient.query(
      `INSERT INTO public.inventory (organization_id, product_id, quantity)
       VALUES ($1, $2, 50.0000)
       ON CONFLICT (organization_id, product_id)
       DO UPDATE SET quantity = 50.0000;`,
      [orgId, productId]
    );

    // 9. Execute Sale 1 via RPC (Customer attached, 1 item, $50 + $5 tax = $55)
    const cashierClient = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || serviceRoleKey, {
      auth: { persistSession: false },
    });
    const { error: signInErr } = await cashierClient.auth.signInWithPassword({
      email: cashierEmail,
      password: testPassword,
    });
    if (signInErr) throw signInErr;

    const idempotencyKey1 = randomUUID();
    const { data: sData1, error: sErr1 } = await cashierClient.rpc("execute_sale", {
      p_org_id: orgId,
      p_customer_id: customerId,
      p_items: [
        {
          product_id: productId,
          quantity: "1.0000",
          line_discount_amount: "0.0000",
        },
      ],
      p_payments: [
        {
          payment_method: "cash",
          amount: "55.0000",
          amount_tendered: "60.0000",
          change_due: "5.0000",
          reference_no: null,
        },
      ],
      p_order_discount_amount: 0.0,
      p_idempotency_key: idempotencyKey1,
      p_notes: "Phase 5 E2E Sale 1 (Customer attached)",
    });
    if (sErr1) throw sErr1;
    saleId1 = sData1.sale_id;
    saleNumber1 = sData1.sale_number;

    // 10. Execute Sale 2 via RPC (Walk-in, 2 items, $100 + $10 tax = $110)
    const idempotencyKey2 = randomUUID();
    const { data: sData2, error: sErr2 } = await cashierClient.rpc("execute_sale", {
      p_org_id: orgId,
      p_customer_id: null,
      p_items: [
        {
          product_id: productId,
          quantity: "2.0000",
          line_discount_amount: "0.0000",
        },
      ],
      p_payments: [
        {
          payment_method: "cash",
          amount: "110.0000",
          amount_tendered: "110.0000",
          change_due: "0.0000",
          reference_no: null,
        },
      ],
      p_order_discount_amount: 0.0,
      p_idempotency_key: idempotencyKey2,
      p_notes: "Phase 5 E2E Sale 2 (Walk-in)",
    });
    if (sErr2) throw sErr2;
    saleId2 = sData2.sale_id;
    saleNumber2 = sData2.sale_number;

    // 11. Seed Partial Return & Refund on Sale 1 (0.5 qty, $25 refund)
    returnNumber = `RET-${timestamp}-001`;
    const retRes = await pgClient.query(
      `INSERT INTO public.sale_returns (
         organization_id, return_number, sale_id, reason, total_refund_amount, idempotency_key, idempotency_hash, created_by
       ) VALUES (
         $1, $2, $3, 'Defective packaging', 25.0000, $4, 'e2e-return-hash', $5
       ) RETURNING id;`,
      [orgId, returnNumber, saleId1, randomUUID(), cashierId]
    );
    returnId = retRes.rows[0].id;

    const itemRes = await pgClient.query(
      `SELECT id, product_id FROM public.sale_items WHERE organization_id = $1 AND sale_id = $2 LIMIT 1;`,
      [orgId, saleId1]
    );
    const saleItemId = itemRes.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.sale_return_items (
         organization_id, return_id, sale_id, sale_item_id, product_id, quantity, refund_amount, restock_to_inventory
       ) VALUES (
         $1, $2, $3, $4, $5, 0.5000, 25.0000, true
       );`,
      [orgId, returnId, saleId1, saleItemId, productId]
    );

    const refId = randomUUID();
    await pgClient.query(
      `INSERT INTO public.refunds (
         id, organization_id, sale_id, return_id, obligation_refund_id, refund_method, amount, status, reason, processed_by
       ) VALUES (
         $1, $2, $3, $4, $1, 'cash', 25.0000, 'completed', 'Customer returned half item', $5
       );`,
      [refId, orgId, saleId1, returnId, cashierId]
    );

    // 12. Seed Long Sale (15 items, long product names, long customer name/phone, split tender, order discount)
    customerLongName = `Dr. Montgomery Bartholomew Featherstonehaugh-Smythe III ${timestamp}`;
    customerLongPhone = `+1415555${Math.floor(1000 + Math.random() * 9000)}`;
    const custLongRes = await pgClient.query(
      `INSERT INTO public.customers (organization_id, name, phone, email, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING id;`,
      [orgId, customerLongName, customerLongPhone, `montgomery_${timestamp}@bizflow-test.internal`]
    );
    const customerLongId = custLongRes.rows[0].id;

    const longSaleItems = [];
    let expectedSubtotal = 0;

    for (let i = 1; i <= 15; i++) {
      const pName = `Component ${i.toString().padStart(2, "0")} Industrial Heavy Duty Alloy Precision Modular Structure ${timestamp}`;
      const sku = `SKU-LNG-${timestamp}-${i.toString().padStart(2, "0")}`;
      const sellingPrice = 20.0 + i * 2; // $22.00 to $50.00
      const costPrice = 11.37 + i; // $12.37 to $26.37 (CONFIDENTIAL - distinct from discount amounts)
      longProductCosts.push(costPrice);
      longProductNames.push(pName);

      const pRes = await pgClient.query(
        `INSERT INTO public.products (organization_id, name, sku, selling_price, category_id, unit_of_measure, status, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, 'unit', 'active', $6, $6)
         RETURNING id;`,
        [orgId, pName, sku, sellingPrice, categoryId, ownerId]
      );
      const pid = pRes.rows[0].id;

      await pgClient.query(
        `INSERT INTO public.product_costs (organization_id, product_id, cost_price)
         VALUES ($1, $2, $3);`,
        [orgId, pid, costPrice]
      );

      await pgClient.query(
        `INSERT INTO public.inventory (organization_id, product_id, quantity)
         VALUES ($1, $2, 100.0000)
         ON CONFLICT (organization_id, product_id)
         DO UPDATE SET quantity = 100.0000;`,
        [orgId, pid]
      );

      const lineDiscount = i % 3 === 0 ? 2.0 : 0.0;
      longSaleItems.push({
        product_id: pid,
        quantity: "1.0000",
        line_discount_amount: lineDiscount.toFixed(4),
      });
      expectedSubtotal += (sellingPrice - lineDiscount);
    }

    // Tax rate is 10% exclusive, order discount: $15.00
    const orderDiscount = 15.0;
    const discountedTaxable = expectedSubtotal - orderDiscount;
    const taxAmount = Math.round(discountedTaxable * 0.10 * 100) / 100;
    const totalPayable = Math.round((discountedTaxable + taxAmount) * 100) / 100;

    // Split tender: Card $200.00 + Cash remainder (with $20 change)
    const cardAmount = 200.0;
    const cashAmount = Math.round((totalPayable - cardAmount) * 100) / 100;
    const cashTendered = Math.round((cashAmount + 20.0) * 100) / 100;
    const changeDue = 20.0;

    const idempotencyKeyLong = randomUUID();
    const { data: sDataLong, error: sErrLong } = await cashierClient.rpc("execute_sale", {
      p_org_id: orgId,
      p_customer_id: customerLongId,
      p_items: longSaleItems,
      p_payments: [
        {
          payment_method: "card",
          amount: cardAmount.toFixed(4),
          amount_tendered: cardAmount.toFixed(4),
          change_due: "0.0000",
          reference_no: "AUTH-CARD-9912",
        },
        {
          payment_method: "cash",
          amount: cashAmount.toFixed(4),
          amount_tendered: cashTendered.toFixed(4),
          change_due: changeDue.toFixed(4),
          reference_no: null,
        },
      ],
      p_order_discount_amount: orderDiscount,
      p_idempotency_key: idempotencyKeyLong,
      p_notes: "Phase 5 E2E Sale Long (15 items, split tender)",
    });
    if (sErrLong) throw sErrLong;
    saleIdLong = sDataLong.sale_id;
    saleNumberLong = sDataLong.sale_number;
  });

  test.afterAll(async () => {
    if (createdOrgIds.length > 0) {
      try {
        await pgClient.query(`DELETE FROM public.refunds WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(
          `DELETE FROM public.sale_return_items WHERE return_id IN (
             SELECT id FROM public.sale_returns WHERE organization_id = ANY($1::uuid[])
           );`,
          [createdOrgIds]
        );
        await pgClient.query(`DELETE FROM public.sale_returns WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.payments WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.sale_items WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.sales WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.stock_movements WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.inventory WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.product_costs WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.products WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.product_categories WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.customers WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.organization_tax_settings WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
        await pgClient.query(`DELETE FROM public.organization_memberships WHERE organization_id = ANY($1::uuid[]);`, [createdOrgIds]);
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

  test("1. Sales History Page (T063, US5): Search, filter, status, pagination, and empty state", async ({
    page,
  }) => {
    // Sign in as Cashier
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', cashierEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');

    await page.waitForURL(new RegExp(`/${orgSlug}/dashboard`));

    // Navigate to Sales History
    await page.goto(`/${orgSlug}/sales`);
    await expect(page.getByRole("heading", { name: "Sales History" })).toBeVisible();

    // Verify both seeded sales appear in the table
    expect(saleId2).toBeDefined();
    await expect(page.getByText(saleNumber1)).toBeVisible();
    await expect(page.getByText(saleNumber2)).toBeVisible();
    await expect(page.getByText("$55.00")).toBeVisible();
    await expect(page.getByText("$110.00")).toBeVisible();
    await expect(page.getByText(customerName)).toBeVisible();
    await expect(page.getByText("Walk-in", { exact: true })).toBeVisible();

    // Search by Sale Number 1
    const searchInput = page.getByPlaceholder("Search by sale number (e.g. SAL-20261121)...");
    await searchInput.fill(saleNumber1);
    await page.getByRole("button", { name: "Filter" }).click();

    // Wait for filtered list
    await expect(page.getByText(saleNumber1)).toBeVisible();
    await expect(page.getByText(saleNumber2)).toHaveCount(0);

    // Reset filters
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByText(saleNumber1)).toBeVisible();
    await expect(page.getByText(saleNumber2)).toBeVisible();

    // Test non-matching search -> Empty state display
    await searchInput.fill("SAL-NONEXISTENT-99999");
    await page.getByRole("button", { name: "Filter" }).click();

    await expect(page.getByText("No sales found")).toBeVisible();
    await expect(page.getByText("Try adjusting your filters, date range, or search criteria.")).toBeVisible();

    // Reset back
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByText(saleNumber1)).toBeVisible();
  });

  test("2. Sale Detail Breakdown & Cost Confidentiality (T064, US5): Cashier masks cost, Owner reveals cost", async ({
    browser,
  }) => {
    // -------------------------------------------------------------------------
    // A. Cashier Experience: Cost is masked and zero cost disclosures in DOM
    // -------------------------------------------------------------------------
    const cashierContext = await browser.newContext();
    const cashierPage = await cashierContext.newPage();

    await cashierPage.goto("/sign-in");
    await cashierPage.fill('input[type="email"]', cashierEmail);
    await cashierPage.fill('input[type="password"]', testPassword);
    await cashierPage.click('button[type="submit"]');
    await cashierPage.waitForURL(new RegExp(`/${orgSlug}/dashboard`));

    // Navigate to Sale Detail
    await cashierPage.goto(`/${orgSlug}/sales/${saleId1}`);
    await expect(cashierPage.getByText(saleNumber1)).toBeVisible();
    await expect(cashierPage.getByText("Completed")).toBeVisible();

    // Verify Customer card
    await expect(cashierPage.getByText(customerName)).toBeVisible();
    await expect(cashierPage.getByText(customerPhone)).toBeVisible();

    // Verify Line Items
    await expect(cashierPage.getByText(testProductName)).toBeVisible();
    await expect(cashierPage.getByText(testSku)).toBeVisible();

    // CRITICAL COST CONFIDENTIALITY: Unit Cost column header must NOT exist for cashier
    await expect(cashierPage.getByRole("columnheader", { name: /unit cost/i })).toHaveCount(0);
    // The confidential cost "$30.00" must NOT be rendered anywhere on the page
    await expect(cashierPage.getByText("$30.00")).toHaveCount(0);

    // Verify Payments tab
    await cashierPage.getByRole("button", { name: /payments & tenders/i }).click();
    await expect(cashierPage.getByRole("cell", { name: "cash" })).toBeVisible();
    await expect(cashierPage.getByRole("cell", { name: "$60.00" })).toBeVisible(); // Tendered
    await expect(cashierPage.getByRole("cell", { name: "$5.00" })).toBeVisible(); // Change due

    // Verify Returns tab
    await cashierPage.getByRole("button", { name: /returns & refunds/i }).click();
    await expect(cashierPage.getByText("Defective packaging")).toBeVisible();
    await expect(cashierPage.getByText("Restocked")).toBeVisible();

    await cashierContext.close();

    // -------------------------------------------------------------------------
    // B. Owner Experience: Dual-permission reveals Unit Cost
    // -------------------------------------------------------------------------
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();

    await ownerPage.goto("/sign-in");
    await ownerPage.fill('input[type="email"]', ownerEmail);
    await ownerPage.fill('input[type="password"]', testPassword);
    await ownerPage.click('button[type="submit"]');
    await ownerPage.waitForURL(new RegExp(`/${orgSlug}/dashboard`));

    await ownerPage.goto(`/${orgSlug}/sales/${saleId1}`);
    await expect(ownerPage.getByText(saleNumber1)).toBeVisible();

    // Owner has products:read_cost AND inventory:read_valuation -> Unit Cost column is rendered
    await expect(ownerPage.getByRole("columnheader", { name: /unit cost/i })).toBeVisible();
    await expect(ownerPage.getByText("$30.00")).toBeVisible();

    await ownerContext.close();
  });

  test("3. Thermal Receipt Print Component (T065, US5): 80mm & 58mm layouts, actual PDF generation, MediaBox inspection & zero cost leakage", async ({
    page,
  }) => {
    // Sign in as Cashier
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', cashierEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(new RegExp(`/${orgSlug}/dashboard`));

    // Navigate to Sale Detail
    await page.goto(`/${orgSlug}/sales/${saleId1}`);

    // Click "Print Receipt" button to open modal
    const printBtn = page.getByRole("button", { name: /print receipt/i });
    await expect(printBtn).toBeVisible();
    await printBtn.click();

    // Verify Modal opens with initial 80mm layout
    await expect(page.getByText("Receipt Preview (80mm)")).toBeVisible();
    const receiptArea = page.locator("#thermal-receipt-print-area");
    await expect(receiptArea.getByText(orgName)).toBeVisible();
    await expect(receiptArea.getByText(saleNumber1)).toBeVisible();
    await expect(receiptArea.getByText(customerName)).toBeVisible();
    await expect(receiptArea.getByText(testProductName)).toBeVisible();
    await expect(receiptArea.getByText("$55.00").first()).toBeVisible();

    // Check that confidential cost ($30.00) is NEVER disclosed in the thermal receipt DOM
    await expect(page.getByText("$30.00")).toHaveCount(0);

    // -------------------------------------------------------------------------
    // 3A. Generate and Inspect 80mm PDF output via Playwright Chromium
    // -------------------------------------------------------------------------
    const pdfPath80 = path.join(process.cwd(), "test-results", "receipt-80mm.pdf");
    const pdfBuffer80 = await page.pdf({
      width: "80mm",
      height: "200mm",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
    fs.writeFileSync(pdfPath80, pdfBuffer80);

    const parsed80 = parseChromiumPdf(pdfBuffer80);
    expect(parsed80.pageCount).toBeGreaterThanOrEqual(1);

    // Verify MediaBox page dimensions (80mm ≈ 227.04 pt, 200mm ≈ 567.12 pt)
    const page1_80 = parsed80.pages[0];
    expect(page1_80).toBeDefined();
    expect(page1_80!.widthMm).toBeGreaterThanOrEqual(79.5);
    expect(page1_80!.widthMm).toBeLessThanOrEqual(80.5);
    expect(page1_80!.heightMm).toBeGreaterThanOrEqual(199.5);
    expect(page1_80!.heightMm).toBeLessThanOrEqual(200.5);

    // Verify rendered content in 80mm PDF
    expect(parsed80.normalizedUpperText).toContain(orgName.toUpperCase());
    expect(parsed80.normalizedText).toContain(saleNumber1);
    expect(parsed80.normalizedText).toContain(customerName);
    expect(parsed80.normalizedText).toContain(testProductName);
    expect(parsed80.normalizedText).toContain("$50.00");
    expect(parsed80.normalizedText).toContain("$5.00");
    expect(parsed80.normalizedText).toContain("$55.00");
    expect(parsed80.normalizedText).toContain("Cash");
    expect(parsed80.normalizedText).toContain("$60.00"); // Tendered
    expect(parsed80.normalizedText).toContain("$5.00"); // Change
    expect(parsed80.normalizedText).toContain("Thank you for your business!");

    // CRITICAL: Verify absence of confidential cost data in 80mm PDF stream
    expect(parsed80.normalizedText).not.toContain("$30.00");
    expect(parsed80.normalizedText).not.toContain("30.0000");
    expect(parsed80.normalizedText).not.toContain("cost_price");
    expect(parsed80.normalizedText).not.toContain("unit_cost");
    expect(parsed80.normalizedText).not.toContain("margin");

    // -------------------------------------------------------------------------
    // 3B. Switch to 58mm compact layout, generate and inspect 58mm PDF output
    // -------------------------------------------------------------------------
    const btn58 = page.getByRole("button", { name: "58mm" });
    await expect(btn58).toBeVisible();
    await btn58.click();

    await expect(page.getByText("Receipt Preview (58mm)")).toBeVisible();

    const pdfPath58 = path.join(process.cwd(), "test-results", "receipt-58mm.pdf");
    const pdfBuffer58 = await page.pdf({
      width: "58mm",
      height: "200mm",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
    fs.writeFileSync(pdfPath58, pdfBuffer58);

    const parsed58 = parseChromiumPdf(pdfBuffer58);
    expect(parsed58.pageCount).toBeGreaterThanOrEqual(1);

    // Verify MediaBox page dimensions (58mm ≈ 164.41 pt, 200mm ≈ 567.12 pt)
    const page1_58 = parsed58.pages[0];
    expect(page1_58).toBeDefined();
    expect(page1_58!.widthMm).toBeGreaterThanOrEqual(57.5);
    expect(page1_58!.widthMm).toBeLessThanOrEqual(58.5);
    expect(page1_58!.heightMm).toBeGreaterThanOrEqual(199.5);
    expect(page1_58!.heightMm).toBeLessThanOrEqual(200.5);

    // Verify rendered content in 58mm PDF
    expect(parsed58.normalizedUpperText).toContain(orgName.toUpperCase());
    expect(parsed58.normalizedText).toContain(saleNumber1);
    expect(parsed58.normalizedText).toContain(testProductName);
    expect(parsed58.normalizedText).toContain("$55.00");
    expect(parsed58.normalizedText).toContain("Cash");

    // CRITICAL: Verify absence of confidential cost data in 58mm PDF stream
    expect(parsed58.normalizedText).not.toContain("$30.00");
    expect(parsed58.normalizedText).not.toContain("30.0000");
    expect(parsed58.normalizedText).not.toContain("cost_price");
    expect(parsed58.normalizedText).not.toContain("unit_cost");
    expect(parsed58.normalizedText).not.toContain("margin");

    // Close Modal
    const closeBtn = page.getByRole("button", { name: "Close receipt" });
    await closeBtn.click();
    await expect(page.getByText("Receipt Preview (58mm)")).toHaveCount(0);
  });

  test("4. Thermal Receipt Multi-Page Print & Content Wrapping (T065, US5): Long receipt with 15 items, split payments, text wrapping, pagination, and zero cost disclosure", async ({
    page,
  }) => {
    // Sign in as Cashier
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', cashierEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(new RegExp(`/${orgSlug}/dashboard`));

    // Navigate to Long Sale Detail
    await page.goto(`/${orgSlug}/sales/${saleIdLong}`);
    await expect(page.getByText(saleNumberLong)).toBeVisible();

    // Click "Print Receipt" button to open modal
    const printBtn = page.getByRole("button", { name: /print receipt/i });
    await expect(printBtn).toBeVisible();
    await printBtn.click();

    // Verify Modal opens
    await expect(page.getByText("Receipt Preview (80mm)")).toBeVisible();

    // -------------------------------------------------------------------------
    // 4A. Generate and Inspect Multi-Page 80mm PDF Output
    // -------------------------------------------------------------------------
    const pdfLongPath80 = path.join(process.cwd(), "test-results", "receipt-long-80mm.pdf");
    const pdfLongBuffer80 = await page.pdf({
      width: "80mm",
      height: "200mm",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
    fs.writeFileSync(pdfLongPath80, pdfLongBuffer80);

    const parsedLong80 = parseChromiumPdf(pdfLongBuffer80);

    // CRITICAL VERIFICATION: 15-item receipt must paginate across multiple pages without clipping!
    expect(parsedLong80.pageCount).toBeGreaterThanOrEqual(2);

    // Verify MediaBox page dimensions on all pages
    for (const p of parsedLong80.pages) {
      expect(p.widthMm).toBeGreaterThanOrEqual(79.5);
      expect(p.widthMm).toBeLessThanOrEqual(80.5);
      expect(p.heightMm).toBeGreaterThanOrEqual(199.5);
      expect(p.heightMm).toBeLessThanOrEqual(200.5);
    }

    // Verify text wrapping and complete customer details
    expect(parsedLong80.normalizedText).toContain(customerLongName);
    expect(parsedLong80.normalizedText).toContain(customerLongPhone);

    // Verify all 15 long product items are present in the PDF across page breaks
    for (const pName of longProductNames) {
      expect(parsedLong80.normalizedText).toContain(pName);
    }

    // Verify Order Discount, Tax, and Split Payments
    expect(parsedLong80.normalizedText).toContain("Order Discount:");
    expect(parsedLong80.normalizedText).toContain("$15.00");
    expect(parsedLong80.normalizedText).toContain("State Tax");
    expect(parsedLong80.normalizedText).toContain("Card");
    expect(parsedLong80.normalizedText).toContain("$200.00");
    expect(parsedLong80.normalizedText).toContain("AUTH-CARD-9912");
    expect(parsedLong80.normalizedText).toContain("Cash");
    expect(parsedLong80.normalizedText).toContain("Change");
    expect(parsedLong80.normalizedText).toContain("$20.00");

    // CRITICAL: Strictly verify that none of the 15 confidential costs appear in the PDF
    for (const cost of longProductCosts) {
      expect(parsedLong80.normalizedText).not.toContain(`$${cost.toFixed(2)}`);
      expect(parsedLong80.normalizedText).not.toContain(cost.toFixed(4));
    }
    expect(parsedLong80.normalizedText).not.toContain("cost_price");
    expect(parsedLong80.normalizedText).not.toContain("unit_cost");
    expect(parsedLong80.normalizedText).not.toContain("margin");

    // -------------------------------------------------------------------------
    // 4B. Switch to 58mm compact layout, generate and inspect 58mm PDF output
    // -------------------------------------------------------------------------
    const btn58 = page.getByRole("button", { name: "58mm" });
    await expect(btn58).toBeVisible();
    await btn58.click();

    await expect(page.getByText("Receipt Preview (58mm)")).toBeVisible();

    const pdfLongPath58 = path.join(process.cwd(), "test-results", "receipt-long-58mm.pdf");
    const pdfLongBuffer58 = await page.pdf({
      width: "58mm",
      height: "200mm",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
    fs.writeFileSync(pdfLongPath58, pdfLongBuffer58);

    const parsedLong58 = parseChromiumPdf(pdfLongBuffer58);
    expect(parsedLong58.pageCount).toBeGreaterThanOrEqual(2);

    // Verify MediaBox page dimensions on all 58mm pages
    for (const p of parsedLong58.pages) {
      expect(p.widthMm).toBeGreaterThanOrEqual(57.5);
      expect(p.widthMm).toBeLessThanOrEqual(58.5);
      expect(p.heightMm).toBeGreaterThanOrEqual(199.5);
      expect(p.heightMm).toBeLessThanOrEqual(200.5);
    }

    // Verify long items and split payments in 58mm
    for (const pName of longProductNames) {
      expect(parsedLong58.normalizedText).toContain(pName);
    }
    expect(parsedLong58.normalizedText).toContain("Card");
    expect(parsedLong58.normalizedText).toContain("$200.00");
    expect(parsedLong58.normalizedText).toContain("Cash");
    expect(parsedLong58.normalizedText).toContain("$20.00");

    // CRITICAL: Strictly verify that none of the 15 confidential costs appear in the 58mm PDF
    for (const cost of longProductCosts) {
      expect(parsedLong58.normalizedText).not.toContain(`$${cost.toFixed(2)}`);
      expect(parsedLong58.normalizedText).not.toContain(cost.toFixed(4));
    }

    // Close Modal
    const closeBtn = page.getByRole("button", { name: "Close receipt" });
    await closeBtn.click();
    await expect(page.getByText("Receipt Preview (58mm)")).toHaveCount(0);
  });
});
