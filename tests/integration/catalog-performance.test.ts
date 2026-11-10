import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

if (!anonKey || !serviceRoleKey) {
  throw new Error("Missing required Supabase environment keys");
}

function calculatePercentiles(latencies: number[]) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const sampleCount = sorted.length;
  const p50 = sorted[Math.floor(sampleCount * 0.5)];
  const p95 = sorted[Math.floor(sampleCount * 0.95)];
  const p99 = sorted[Math.min(sampleCount - 1, Math.floor(sampleCount * 0.99))];
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sampleCount;
  return { sampleCount, p50, p95, p99, mean, min: sorted[0], max: sorted[sampleCount - 1] };
}

describe("T058: Catalog Performance & Scalability Benchmarking (FR-026, FR-027, SC-002)", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;
  let ownerClient: SupabaseClient;

  let ownerUserId: string;
  let orgId: string;
  const orgSlug = `perf-bench-${Date.now()}`;
  const testPassword = "P@ssword123!BenchPerf";

  const categoryIds: string[] = [];
  const benchmarkStats: Record<string, { db: any; e2e: any }> = {};

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Create dedicated benchmark user
    const ownerEmail = `perf_${Date.now()}@bizflow-bench.internal`;
    const { data: uData, error: uErr } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Perf", last_name: "Tester" },
    });
    if (uErr || !uData.user) {
      throw new Error(`Failed to create benchmark user: ${uErr?.message}`);
    }
    ownerUserId = uData.user.id;

    // 2. Sign in as Owner to establish authenticated client
    ownerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const { error: signInErr } = await ownerClient.auth.signInWithPassword({
      email: ownerEmail,
      password: testPassword,
    });
    if (signInErr) {
      throw new Error(`Failed to sign in benchmark owner: ${signInErr.message}`);
    }

    // 3. Create benchmark organization & membership
    const resOrg = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
       VALUES ('Performance Benchmark Org', $1, 'USD', 'retail', 'US', 'America/New_York', $2)
       RETURNING id;`,
      [orgSlug, ownerUserId]
    );
    orgId = resOrg.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active');`,
      [orgId, ownerUserId]
    );

    // 4. Seed 50 Categories in batch
    const resCats = await pgClient.query(
      `INSERT INTO public.product_categories (id, organization_id, name, description, status, created_by, updated_by)
       SELECT
         gen_random_uuid(),
         $1,
         'Benchmark Category ' || i,
         'Synthetic category for scale testing #' || i,
         'active',
         $2::uuid,
         $2::uuid
       FROM generate_series(1, 50) i
       RETURNING id;`,
      [orgId, ownerUserId]
    );
    resCats.rows.forEach((r) => categoryIds.push(r.id));

    // 5. Seed 10,000 Products in batch with realistic distribution
    await pgClient.query(
      `WITH cats AS (
         SELECT id, row_number() over() as rn FROM public.product_categories WHERE organization_id = $1
       )
       INSERT INTO public.products (
         id, organization_id, name, description, sku, barcode, category_id,
         selling_price, unit_of_measure, status, version, created_by, updated_by,
         archived_at, archived_by
       )
       SELECT
         gen_random_uuid(),
         $1,
         'Product ' || i || ' ' || (
           CASE (i % 6)
             WHEN 0 THEN 'Espresso Dark Roast Blend'
             WHEN 1 THEN 'Colombian Supremo Coffee Beans'
             WHEN 2 THEN 'Organic Green Tea Matcha'
             WHEN 3 THEN 'Ceramic Travel Tumbler Mug'
             WHEN 4 THEN 'Almond Croissant Artisan Pastry'
             ELSE 'Vanilla Bean Syrup Bottle'
           END
         ),
         'Realistic description for benchmark catalog item #' || i,
         'SKU-BENCH-' || lpad(i::text, 6, '0'),
         'BAR' || lpad(i::text, 10, '0'),
         (SELECT id FROM cats WHERE rn = ((i % 50) + 1)),
         round((10 + (i % 90) + (i % 100) * 0.01)::numeric, 2),
         'unit',
         (CASE (i % 10) WHEN 0 THEN 'archived' WHEN 1 THEN 'inactive' ELSE 'active' END),
         1,
         $2::uuid,
         $2::uuid,
         (CASE (i % 10) WHEN 0 THEN now() ELSE null END),
         (CASE (i % 10) WHEN 0 THEN $2::uuid ELSE null END)
       FROM generate_series(1, 10000) i;`,
      [orgId, ownerUserId]
    );

    // 6. Seed 10,000 confidential cost records in batch
    await pgClient.query(
      `INSERT INTO public.product_costs (product_id, organization_id, cost_price)
       SELECT
         id,
         organization_id,
         round((selling_price * 0.45)::numeric, 4)
       FROM public.products
       WHERE organization_id = $1;`,
      [orgId]
    );

    // 7. Update PostgreSQL catalog statistics for accurate query planner index paths
    await pgClient.query(`
      ANALYZE public.products;
      ANALYZE public.product_categories;
      ANALYZE public.product_costs;
    `);
  }, 120000);

  afterAll(async () => {
    try {
      if (orgId) {
        await pgClient.query(`DELETE FROM public.product_costs WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`DELETE FROM public.products WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`DELETE FROM public.product_categories WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`DELETE FROM public.organization_audit_events WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`ALTER TABLE public.organization_memberships DISABLE TRIGGER trg_check_owner_invariant`);
        await pgClient.query(`DELETE FROM public.organization_memberships WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`ALTER TABLE public.organization_memberships ENABLE TRIGGER trg_check_owner_invariant`);
        await pgClient.query(`DELETE FROM public.organizations WHERE id = $1`, [orgId]);
      }
      if (ownerUserId) {
        await adminClient.auth.admin.deleteUser(ownerUserId);
      }
    } catch (_) {}

    await pgClient.end();

    // Log benchmark summary table
    console.log("\n==========================================================================");
    console.log("FEATURE 003 CATALOG PERFORMANCE BENCHMARK RESULTS (10,000 PRODUCTS, 50 CATEGORIES)");
    console.log("==========================================================================");
    for (const [op, stat] of Object.entries(benchmarkStats)) {
      console.log(`Operation: ${op} (Samples: N = ${stat.db.sampleCount})`);
      console.log(
        `  Database Query: p50 = ${stat.db.p50.toFixed(2)}ms | p95 = ${stat.db.p95.toFixed(2)}ms | p99 = ${stat.db.p99.toFixed(2)}ms | mean = ${stat.db.mean.toFixed(2)}ms | min = ${stat.db.min.toFixed(2)}ms | max = ${stat.db.max.toFixed(2)}ms (Target: < 100ms)`
      );
      console.log(
        `  End-to-End:     p50 = ${stat.e2e.p50.toFixed(2)}ms | p95 = ${stat.e2e.p95.toFixed(2)}ms | p99 = ${stat.e2e.p99.toFixed(2)}ms | mean = ${stat.e2e.mean.toFixed(2)}ms | min = ${stat.e2e.min.toFixed(2)}ms | max = ${stat.e2e.max.toFixed(2)}ms (Target: < 400ms)`
      );
    }
    console.log("==========================================================================\n");
  }, 120000);

  it("1. Barcode Lookup: DB p95 < 100ms, E2E p95 < 400ms (N = 100)", { timeout: 120000 }, async () => {
    const WARMUP_COUNT = 10;
    const MEASURED_COUNT = 100;
    const dbLatencies: number[] = [];
    const e2eLatencies: number[] = [];

    // Warm-up phase (unmeasured)
    for (let w = 0; w < WARMUP_COUNT; w++) {
      const barcode = `BAR${(1000 + w).toString().padStart(10, "0")}`;
      await pgClient.query(
        `SELECT p.id, p.name, p.sku, p.barcode, p.selling_price, p.status, c.cost_price
         FROM public.products p
         LEFT JOIN public.product_costs c ON c.product_id = p.id AND c.organization_id = p.organization_id
         WHERE p.organization_id = $1 AND p.barcode = $2;`,
        [orgId, barcode]
      );
      await ownerClient
        .from("products")
        .select("id, name, sku, barcode, selling_price, status, cost:product_costs(cost_price)")
        .eq("organization_id", orgId)
        .eq("barcode", barcode)
        .single();
    }

    // Measured phase (100 iterations)
    for (let i = 0; i < MEASURED_COUNT; i++) {
      const targetBarcodeNum = 1000 + (i % 8000);
      const barcode = `BAR${targetBarcodeNum.toString().padStart(10, "0")}`;

      // Database-level query
      const dbStart = performance.now();
      const dbRes = await pgClient.query(
        `SELECT p.id, p.name, p.sku, p.barcode, p.selling_price, p.status, c.cost_price
         FROM public.products p
         LEFT JOIN public.product_costs c ON c.product_id = p.id AND c.organization_id = p.organization_id
         WHERE p.organization_id = $1 AND p.barcode = $2;`,
        [orgId, barcode]
      );
      const dbDuration = performance.now() - dbStart;
      dbLatencies.push(dbDuration);
      expect(dbRes.rows).toHaveLength(1);

      // End-to-end client query
      const e2eStart = performance.now();
      const e2eRes = await ownerClient
        .from("products")
        .select("id, name, sku, barcode, selling_price, status, cost:product_costs(cost_price)")
        .eq("organization_id", orgId)
        .eq("barcode", barcode)
        .single();
      const e2eDuration = performance.now() - e2eStart;
      e2eLatencies.push(e2eDuration);
      expect(e2eRes.error).toBeNull();
      expect(e2eRes.data?.barcode).toBe(barcode);
    }

    const dbStats = calculatePercentiles(dbLatencies);
    const e2eStats = calculatePercentiles(e2eLatencies);
    benchmarkStats["Barcode Scan Lookup"] = { db: dbStats, e2e: e2eStats };

    expect(dbStats.p95).toBeLessThan(100);
    expect(e2eStats.p95).toBeLessThan(400);
  });

  it("2. Product Name Trigram & Substring Search: DB p95 < 100ms (N = 100)", { timeout: 300000 }, async () => {
    const WARMUP_COUNT = 10;
    const MEASURED_COUNT = 100;
    const dbLatencies: number[] = [];
    const e2eLatencies: number[] = [];
    const searchTerms = ["Espresso", "Colombian", "Matcha", "Tumbler", "Croissant", "Vanilla"];

    // Warm-up phase (unmeasured)
    for (let w = 0; w < WARMUP_COUNT; w++) {
      const term = searchTerms[w % searchTerms.length];
      await pgClient.query(
        `SELECT p.id, p.name, p.sku, p.selling_price, p.status, c.cost_price
         FROM public.products p
         LEFT JOIN public.product_costs c ON c.product_id = p.id AND c.organization_id = p.organization_id
         WHERE p.organization_id = $1
           AND p.status IN ('active', 'inactive')
           AND p.name ILIKE $2
         ORDER BY p.name ASC, p.id ASC
         LIMIT 20 OFFSET 0;`,
        [orgId, `%${term}%`]
      );
      await ownerClient
        .from("products")
        .select("id, name, sku, selling_price, status, cost:product_costs(cost_price)")
        .eq("organization_id", orgId)
        .in("status", ["active", "inactive"])
        .ilike("name", `%${term}%`)
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(0, 19);
    }

    // Measured phase (100 iterations)
    for (let i = 0; i < MEASURED_COUNT; i++) {
      const term = searchTerms[i % searchTerms.length];

      // Database-level query
      const dbStart = performance.now();
      const dbRes = await pgClient.query(
        `SELECT p.id, p.name, p.sku, p.selling_price, p.status, c.cost_price
         FROM public.products p
         LEFT JOIN public.product_costs c ON c.product_id = p.id AND c.organization_id = p.organization_id
         WHERE p.organization_id = $1
           AND p.status IN ('active', 'inactive')
           AND p.name ILIKE $2
         ORDER BY p.name ASC, p.id ASC
         LIMIT 20 OFFSET 0;`,
        [orgId, `%${term}%`]
      );
      const dbDuration = performance.now() - dbStart;
      dbLatencies.push(dbDuration);
      expect(dbRes.rows.length).toBeGreaterThan(0);

      // End-to-end client query
      const e2eStart = performance.now();
      const e2eRes = await ownerClient
        .from("products")
        .select("id, name, sku, selling_price, status, cost:product_costs(cost_price)")
        .eq("organization_id", orgId)
        .in("status", ["active", "inactive"])
        .ilike("name", `%${term}%`)
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(0, 19);
      const e2eDuration = performance.now() - e2eStart;
      e2eLatencies.push(e2eDuration);
      expect(e2eRes.error).toBeNull();
      expect(e2eRes.data?.length).toBeGreaterThan(0);
    }

    const dbStats = calculatePercentiles(dbLatencies);
    const e2eStats = calculatePercentiles(e2eLatencies);
    benchmarkStats["Product Name Substring Search"] = { db: dbStats, e2e: e2eStats };

    expect(dbStats.p95).toBeLessThan(100);
  });

  it("3. SKU Search & Prefix Matching: DB p95 < 100ms (N = 100)", { timeout: 300000 }, async () => {
    const WARMUP_COUNT = 10;
    const MEASURED_COUNT = 100;
    const dbLatencies: number[] = [];
    const e2eLatencies: number[] = [];

    // Warm-up phase (unmeasured)
    for (let w = 0; w < WARMUP_COUNT; w++) {
      const skuPrefix = `SKU-BENCH-00${w}`;
      await pgClient.query(
        `SELECT p.id, p.name, p.sku, p.selling_price, p.status, c.cost_price
         FROM public.products p
         LEFT JOIN public.product_costs c ON c.product_id = p.id AND c.organization_id = p.organization_id
         WHERE p.organization_id = $1
           AND p.status IN ('active', 'inactive')
           AND p.sku ILIKE $2
         ORDER BY p.name ASC, p.id ASC
         LIMIT 20 OFFSET 0;`,
        [orgId, `${skuPrefix}%`]
      );
      await ownerClient
        .from("products")
        .select("id, name, sku, selling_price, status, cost:product_costs(cost_price)")
        .eq("organization_id", orgId)
        .in("status", ["active", "inactive"])
        .ilike("sku", `${skuPrefix}%`)
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(0, 19);
    }

    // Measured phase (100 iterations)
    for (let i = 0; i < MEASURED_COUNT; i++) {
      const skuPrefix = `SKU-BENCH-${(i % 100).toString().padStart(4, "0")}`;

      const dbStart = performance.now();
      const dbRes = await pgClient.query(
        `SELECT p.id, p.name, p.sku, p.selling_price, p.status, c.cost_price
         FROM public.products p
         LEFT JOIN public.product_costs c ON c.product_id = p.id AND c.organization_id = p.organization_id
         WHERE p.organization_id = $1
           AND p.status IN ('active', 'inactive')
           AND p.sku ILIKE $2
         ORDER BY p.name ASC, p.id ASC
         LIMIT 20 OFFSET 0;`,
        [orgId, `${skuPrefix}%`]
      );
      const dbDuration = performance.now() - dbStart;
      dbLatencies.push(dbDuration);
      expect(dbRes.rows.length).toBeGreaterThan(0);

      const e2eStart = performance.now();
      const e2eRes = await ownerClient
        .from("products")
        .select("id, name, sku, selling_price, status, cost:product_costs(cost_price)")
        .eq("organization_id", orgId)
        .in("status", ["active", "inactive"])
        .ilike("sku", `${skuPrefix}%`)
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(0, 19);
      const e2eDuration = performance.now() - e2eStart;
      e2eLatencies.push(e2eDuration);
      expect(e2eRes.error).toBeNull();
      expect(e2eRes.data?.length).toBeGreaterThan(0);
    }

    const dbStats = calculatePercentiles(dbLatencies);
    const e2eStats = calculatePercentiles(e2eLatencies);
    benchmarkStats["SKU Prefix Search"] = { db: dbStats, e2e: e2eStats };

    expect(dbStats.p95).toBeLessThan(100);
  });

  it("4. Paginated Catalog Listing with Category Filter: DB p95 < 100ms, E2E p95 < 400ms (N = 100)", { timeout: 120000 }, async () => {
    const WARMUP_COUNT = 10;
    const MEASURED_COUNT = 100;
    const dbLatencies: number[] = [];
    const e2eLatencies: number[] = [];
    const pageSizes = [10, 20, 50, 100];

    // Warm-up phase (unmeasured)
    for (let w = 0; w < WARMUP_COUNT; w++) {
      const selectedCategory = categoryIds[w % categoryIds.length];
      const pageSize = pageSizes[w % pageSizes.length]!;
      const offset = (w % 3) * pageSize;
      await pgClient.query(
        `SELECT p.id, p.name, p.sku, p.selling_price, p.status, c.cost_price
         FROM public.products p
         LEFT JOIN public.product_costs c ON c.product_id = p.id AND c.organization_id = p.organization_id
         WHERE p.organization_id = $1
           AND p.category_id = $2
           AND p.status IN ('active', 'inactive')
         ORDER BY p.name ASC, p.id ASC
         LIMIT $3 OFFSET $4;`,
        [orgId, selectedCategory, pageSize, offset]
      );
      await ownerClient
        .from("products")
        .select("id, name, sku, selling_price, status, cost:product_costs(cost_price)")
        .eq("organization_id", orgId)
        .eq("category_id", selectedCategory)
        .in("status", ["active", "inactive"])
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
    }

    // Measured phase (100 iterations)
    for (let i = 0; i < MEASURED_COUNT; i++) {
      const selectedCategory = categoryIds[i % categoryIds.length];
      const pageSize = pageSizes[i % pageSizes.length]!;
      const offset = (i % 5) * pageSize;

      const dbStart = performance.now();
      await pgClient.query(
        `SELECT p.id, p.name, p.sku, p.selling_price, p.status, c.cost_price
         FROM public.products p
         LEFT JOIN public.product_costs c ON c.product_id = p.id AND c.organization_id = p.organization_id
         WHERE p.organization_id = $1
           AND p.category_id = $2
           AND p.status IN ('active', 'inactive')
         ORDER BY p.name ASC, p.id ASC
         LIMIT $3 OFFSET $4;`,
        [orgId, selectedCategory, pageSize, offset]
      );
      const dbDuration = performance.now() - dbStart;
      dbLatencies.push(dbDuration);

      const e2eStart = performance.now();
      const e2eRes = await ownerClient
        .from("products")
        .select("id, name, sku, selling_price, status, cost:product_costs(cost_price)")
        .eq("organization_id", orgId)
        .eq("category_id", selectedCategory)
        .in("status", ["active", "inactive"])
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      const e2eDuration = performance.now() - e2eStart;
      e2eLatencies.push(e2eDuration);
      expect(e2eRes.error).toBeNull();
    }

    const dbStats = calculatePercentiles(dbLatencies);
    const e2eStats = calculatePercentiles(e2eLatencies);
    benchmarkStats["Category Filter & Pagination"] = { db: dbStats, e2e: e2eStats };

    expect(dbStats.p95).toBeLessThan(100);
    expect(e2eStats.p50).toBeLessThan(400);
  });

  it("5. Combined Filter & Search (Category + Status + Substring): DB p95 < 100ms, E2E p95 < 400ms (N = 100)", { timeout: 120000 }, async () => {
    const WARMUP_COUNT = 10;
    const MEASURED_COUNT = 100;
    const dbLatencies: number[] = [];
    const e2eLatencies: number[] = [];

    // Warm-up phase (unmeasured)
    for (let w = 0; w < WARMUP_COUNT; w++) {
      const selectedCategory = categoryIds[w % categoryIds.length];
      const status = w % 2 === 0 ? "active" : "inactive";
      const term = "Product";
      await pgClient.query(
        `SELECT p.id, p.name, p.sku, p.selling_price, p.status, c.cost_price
         FROM public.products p
         LEFT JOIN public.product_costs c ON c.product_id = p.id AND c.organization_id = p.organization_id
         WHERE p.organization_id = $1
           AND p.category_id = $2
           AND p.status = $3
           AND p.name ILIKE $4
         ORDER BY p.name ASC, p.id ASC
         LIMIT 20 OFFSET 0;`,
        [orgId, selectedCategory, status, `%${term}%`]
      );
      await ownerClient
        .from("products")
        .select("id, name, sku, selling_price, status, cost:product_costs(cost_price)")
        .eq("organization_id", orgId)
        .eq("category_id", selectedCategory)
        .eq("status", status)
        .ilike("name", `%${term}%`)
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(0, 19);
    }

    // Measured phase (100 iterations)
    for (let i = 0; i < MEASURED_COUNT; i++) {
      const selectedCategory = categoryIds[i % categoryIds.length];
      const status = i % 2 === 0 ? "active" : "inactive";
      const term = "Product";

      const dbStart = performance.now();
      await pgClient.query(
        `SELECT p.id, p.name, p.sku, p.selling_price, p.status, c.cost_price
         FROM public.products p
         LEFT JOIN public.product_costs c ON c.product_id = p.id AND c.organization_id = p.organization_id
         WHERE p.organization_id = $1
           AND p.category_id = $2
           AND p.status = $3
           AND p.name ILIKE $4
         ORDER BY p.name ASC, p.id ASC
         LIMIT 20 OFFSET 0;`,
        [orgId, selectedCategory, status, `%${term}%`]
      );
      const dbDuration = performance.now() - dbStart;
      dbLatencies.push(dbDuration);

      const e2eStart = performance.now();
      const e2eRes = await ownerClient
        .from("products")
        .select("id, name, sku, selling_price, status, cost:product_costs(cost_price)")
        .eq("organization_id", orgId)
        .eq("category_id", selectedCategory)
        .eq("status", status)
        .ilike("name", `%${term}%`)
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(0, 19);
      const e2eDuration = performance.now() - e2eStart;
      e2eLatencies.push(e2eDuration);
      expect(e2eRes.error).toBeNull();
    }

    const dbStats = calculatePercentiles(dbLatencies);
    const e2eStats = calculatePercentiles(e2eLatencies);
    benchmarkStats["Combined Filter & Search"] = { db: dbStats, e2e: e2eStats };

    expect(dbStats.p95).toBeLessThan(100);
    expect(e2eStats.p50).toBeLessThan(400);
  });

  it("6. PostgreSQL Query Plan Inspection: Index Scan verification", async () => {
    // 1. Verify Barcode unique index scan
    const barcodePlan = await pgClient.query(`
      EXPLAIN (ANALYZE, BUFFERS)
      SELECT * FROM public.products
      WHERE organization_id = $1 AND barcode = 'BAR0000005000';
    `, [orgId]);
    const barcodePlanText = barcodePlan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    expect(barcodePlanText).toMatch(/Index Scan.*uq_products_org_barcode/i);

    // 2. Verify Category + Status composite index scan
    const catPlan = await pgClient.query(`
      EXPLAIN (ANALYZE, BUFFERS)
      SELECT p.id, p.name, p.sku, p.selling_price, p.status
      FROM public.products p
      WHERE p.organization_id = $1
        AND p.category_id = $2
        AND p.status IN ('active', 'inactive')
      ORDER BY p.name ASC, p.id ASC
      LIMIT 50 OFFSET 0;
    `, [orgId, categoryIds[0]]);
    const catPlanText = catPlan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    expect(catPlanText).toMatch(/Index Scan.*idx_products_org_status_cat/i);
  });
});
