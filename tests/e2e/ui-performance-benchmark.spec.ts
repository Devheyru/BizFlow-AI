import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import * as fs from "fs";
import * as path from "path";

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

function calculatePercentile(latencies: number[], percentile: number): number {
  const sorted = [...latencies].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
}

interface ProductFixture {
  id: string;
  name: string;
  sku: string;
}

test.describe("T046: Empirical UI Confirmation Performance Benchmark (N = 100)", () => {
  test.setTimeout(240000); // 4 minutes timeout

  let pgClient: PgClient;
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  const testPassword = "P@ssword123!UIBenchmark";
  const timestamp = Date.now();

  const ownerEmail = `ui_perf_owner_${timestamp}@bizflow-test.internal`;
  let ownerId: string;

  const orgName = `UI Benchmark Store ${timestamp}`;
  const orgSlug = `ui-bench-${timestamp}`;
  let orgId: string;

  const products: ProductFixture[] = [];
  const PRODUCT_COUNT = 25;

  test.beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    // 1. Create Owner User
    const { data: oData, error: oErr } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Perf", last_name: "Owner" },
    });
    if (oErr || !oData.user) throw new Error("Failed to create owner user: " + oErr?.message);
    ownerId = oData.user.id;
    createdUserIds.push(ownerId);

    // 2. Create Organization
    const resOrg = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, business_type, country, currency, timezone, is_active, created_by)
       VALUES ($1, $2, 'Retail Store', 'US', 'USD', 'America/New_York', true, $3)
       RETURNING id;`,
      [orgName, orgSlug, ownerId]
    );
    orgId = resOrg.rows[0].id;
    createdOrgIds.push(orgId);

    // 3. Assign Owner Membership
    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active');`,
      [orgId, ownerId]
    );

    // 4. Batch Seed 25 Products with Inventory Anchors (all displayed simultaneously on Page 1)
    const valuesSql: string[] = [];
    const params: any[] = [orgId, ownerId];

    for (let i = 1; i <= PRODUCT_COUNT; i++) {
      const pName = `Bench Item ${String(i).padStart(2, "0")} ${timestamp}`;
      const pSku = `SKU-BENCH-${String(i).padStart(2, "0")}-${timestamp}`;

      params.push(pName, pSku);
      const nameParamIdx = params.length - 1;
      const skuParamIdx = params.length;

      valuesSql.push(
        `($1, $${nameParamIdx}, $${skuParamIdx}, 29.99, 'unit', 'active', 1, $2, $2)`
      );
    }

    const insertProductsSql = `
      INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, version, created_by, updated_by)
      VALUES ${valuesSql.join(", ")}
      RETURNING id, name, sku;
    `;
    const resProducts = await pgClient.query(insertProductsSql, params);

    // Seed Cost Prices for all 25 products
    const costValuesSql: string[] = [];
    const costParams: any[] = [orgId];
    resProducts.rows.forEach((row) => {
      costParams.push(row.id);
      costValuesSql.push(`($1, $${costParams.length}, 15.00)`);
      products.push({ id: row.id, name: row.name, sku: row.sku });
    });

    await pgClient.query(
      `INSERT INTO public.product_costs (organization_id, product_id, cost_price)
       VALUES ${costValuesSql.join(", ")};`,
      costParams
    );
  });

  test.afterAll(async () => {
    try {
      if (orgId) {
        await pgClient.query(`DELETE FROM public.zero_delta_stocktakes WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`DELETE FROM public.stock_movement_costs WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`DELETE FROM public.stock_movements WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`DELETE FROM public.inventory WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`DELETE FROM public.product_costs WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`DELETE FROM public.products WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`DELETE FROM public.organization_memberships WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`DELETE FROM public.organizations WHERE id = $1`, [orgId]);
      }
    } catch (_) {}

    try {
      if (ownerId) await adminClient.auth.admin.deleteUser(ownerId);
    } catch (_) {}

    await pgClient.end();
  });

  test("Measures N=100 UI restock confirmation latencies after 5 warm-up iterations", async ({ browser }) => {
    // Create completely isolated browser context
    const context = await browser.newContext();
    const page = await context.newPage();

    // Sign in as owner
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', ownerEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(new RegExp(`/${orgSlug}/dashboard`), { timeout: 20000 });

    // Navigate to Inventory page with pageSize=25 to display all 25 products on Page 1
    await page.goto(`/${orgSlug}/inventory?pageSize=25`);
    await expect(page.getByTestId("inventory-table")).toBeVisible({ timeout: 15000 });

    const restockModal = page.getByTestId("restock-modal");
    const quantityInput = page.getByTestId("restock-quantity-input");
    const reasonInput = page.getByTestId("restock-reason-input");
    const submitBtn = page.getByTestId("restock-submit-btn");
    const successBanner = page.getByTestId("restock-success-banner");
    const closeBtn = page.getByTestId("restock-close-btn");

    // -------------------------------------------------------------------------
    // Phase A: 25 Warm-up Iterations across all catalog products (unrecorded)
    // -------------------------------------------------------------------------
    const WARMUP_COUNT = 25;
    for (let w = 0; w < WARMUP_COUNT; w++) {
      const prod = products[w % products.length];
      if (!prod) continue;
      const restockBtn = page.getByTestId(`restock-btn-${prod.id}`);

      await restockBtn.click();
      await expect(restockModal).toBeVisible({ timeout: 10000 });
      await quantityInput.fill("1");
      await reasonInput.fill(`Warm-up delivery ${w + 1}`);
      await submitBtn.click();
      await expect(successBanner).toBeVisible({ timeout: 10000 });
      await closeBtn.click();
      await expect(restockModal).not.toBeVisible({ timeout: 10000 });
    }

    // -------------------------------------------------------------------------
    // Phase B: 100 Recorded Benchmark Observations (T046 UI Confirmation SLA)
    // -------------------------------------------------------------------------
    const observations: number[] = [];
    const N_TARGET = 100;

    for (let i = 0; i < N_TARGET; i++) {
      const prod = products[i % products.length];
      if (!prod) continue;
      const restockBtn = page.getByTestId(`restock-btn-${prod.id}`);

      // Open restock modal
      await restockBtn.click();
      await expect(restockModal).toBeVisible({ timeout: 10000 });
      await quantityInput.fill("1");
      await reasonInput.fill(`Benchmark restock observation ${i + 1}`);

      // Start timing boundary exactly when user clicks submit
      const startTime = performance.now();
      await submitBtn.click();

      // Stop timing boundary exactly when server-confirmed success banner is rendered in DOM
      await expect(successBanner).toBeVisible({ timeout: 10000 });
      const endTime = performance.now();

      const duration = endTime - startTime;
      observations.push(duration);

      // Close modal for next iteration
      await closeBtn.click();
      await expect(restockModal).not.toBeVisible({ timeout: 10000 });
    }

    // Compute empirical statistics
    const sorted = [...observations].sort((a, b) => a - b);
    const min = sorted[0] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;
    const sum = observations.reduce((a, b) => a + b, 0);
    const avg = sum / observations.length;
    const p50 = calculatePercentile(observations, 50);
    const p90 = calculatePercentile(observations, 90);
    const p95 = calculatePercentile(observations, 95);
    const p99 = calculatePercentile(observations, 99);

    const results = {
      benchmark: "UI Confirmation Latency (Restock Mutation Submit -> Server-Confirmed Success Banner)",
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        browser: "chromium",
        appUrl: "http://localhost:3000",
      },
      sampleCount: observations.length,
      warmupCount: WARMUP_COUNT,
      percentileMethod: "nearest-rank (sorted ceiling)",
      metrics: {
        min: parseFloat(min.toFixed(2)),
        max: parseFloat(max.toFixed(2)),
        average: parseFloat(avg.toFixed(2)),
        p50: parseFloat(p50.toFixed(2)),
        p90: parseFloat(p90.toFixed(2)),
        p95: parseFloat(p95.toFixed(2)),
        p99: parseFloat(p99.toFixed(2)),
      },
      targetP95Ms: 500.0,
      passed: p95 < 500.0,
      rawObservationsMs: observations.map((v) => parseFloat(v.toFixed(2))),
    };

    console.log("\n" + "=".repeat(80));
    console.log("UI CONFIRMATION PERFORMANCE BENCHMARK RESULTS (N = 100)");
    console.log("=".repeat(80));
    console.log(`Sample Count: ${results.sampleCount}`);
    console.log(`Min:          ${results.metrics.min} ms`);
    console.log(`Average:      ${results.metrics.average} ms`);
    console.log(`p50:          ${results.metrics.p50} ms`);
    console.log(`p90:          ${results.metrics.p90} ms`);
    console.log(`p95:          ${results.metrics.p95} ms (Target: < 500 ms) -> ${results.passed ? "PASS" : "FAIL"}`);
    console.log(`p99:          ${results.metrics.p99} ms`);
    console.log(`Max:          ${results.metrics.max} ms`);
    console.log("=".repeat(80) + "\n");

    // Save raw observations to artifact scratch directory
    const scratchDir = "C:\\Users\\Heyru\\.gemini\\antigravity\\brain\\b46c0824-35e3-415c-a08a-37a797b2abea\\scratch";
    if (!fs.existsSync(scratchDir)) {
      fs.mkdirSync(scratchDir, { recursive: true });
    }
    const outputPath = path.join(scratchDir, "ui_benchmark_production.json");
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), "utf-8");
    fs.writeFileSync(path.join(scratchDir, "ui_benchmark_raw.json"), JSON.stringify(results, null, 2), "utf-8");
    console.log(`Raw observations and summary written to: ${outputPath}`);

    await context.close();

    // Assert SLA requirement: UI confirmation p95 < 500 ms
    expect(p95).toBeLessThan(500.0);
  });
});
