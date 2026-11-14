import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import {
  clearInMemoryCookieJar,
  createClient as createServerClient,
} from "@/lib/supabase/server";
import {
  getInventoryValuationSummaryAction,
  updateInventoryThresholdsAction,
} from "@/actions/inventory-actions";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

if (!anonKey || !serviceRoleKey) {
  throw new Error("Missing required Supabase environment keys for integration testing");
}

describe("Feature 004 Phase 9 Integration: Inventory Valuation Summary & Thresholds (T033–T034)", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;

  let ownerClient: SupabaseClient;
  let managerClient: SupabaseClient;
  let cashierClient: SupabaseClient;

  let ownerUserId: string;
  let managerUserId: string;
  let cashierUserId: string;

  let ownerEmail: string;
  let managerEmail: string;
  let cashierEmail: string;

  const testPassword = "P@ssword123!Valuation9";

  let orgId: string;
  const orgSlug = `val9-org-${Date.now()}`;

  let otherOrgId: string;
  const otherOrgSlug = `val9-other-${Date.now()}`;

  let productAId: string;
  let productBId: string;
  let productCUnvaluedId: string;

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const timestamp = Date.now();
    ownerEmail = `val9_owner_${timestamp}@bizflow-test.internal`;
    managerEmail = `val9_mgr_${timestamp}@bizflow-test.internal`;
    cashierEmail = `val9_cash_${timestamp}@bizflow-test.internal`;

    // 1. Create Users
    const { data: uOwner } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Val", last_name: "Owner" },
    });
    ownerUserId = uOwner.user!.id;

    const { data: uMgr } = await adminClient.auth.admin.createUser({
      email: managerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Val", last_name: "Manager" },
    });
    managerUserId = uMgr.user!.id;

    const { data: uCash } = await adminClient.auth.admin.createUser({
      email: cashierEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Val", last_name: "Cashier" },
    });
    cashierUserId = uCash.user!.id;

    // 2. Authenticate clients
    ownerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

    managerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await managerClient.auth.signInWithPassword({ email: managerEmail, password: testPassword });

    cashierClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await cashierClient.auth.signInWithPassword({ email: cashierEmail, password: testPassword });

    // 3. Create Organizations
    const resOrg = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
       VALUES ('Valuation Test Store', $1, 'USD', 'retail', 'US', 'America/New_York', $2)
       RETURNING id;`,
      [orgSlug, ownerUserId]
    );
    orgId = resOrg.rows[0].id;

    const resOtherOrg = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
       VALUES ('Other Valuation Store', $1, 'EUR', 'retail', 'FR', 'Europe/Paris', $2)
       RETURNING id;`,
      [otherOrgSlug, ownerUserId]
    );
    otherOrgId = resOtherOrg.rows[0].id;

    // 4. Create Memberships
    // Owner in orgId
    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active');`,
      [orgId, ownerUserId]
    );

    // Manager in orgId (holds both inventory:read_valuation and products:read_cost)
    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES ($1, $2, 'manager', 'active');`,
      [orgId, managerUserId]
    );

    // Cashier in orgId (holds neither valuation permission)
    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES ($1, $2, 'cashier', 'active');`,
      [orgId, cashierUserId]
    );

    // 5. Seed Products
    // Product A: 10 units at $25.00
    const resProdA = await pgClient.query(
      `INSERT INTO public.products (
        organization_id, name, sku, barcode, selling_price, unit_of_measure, status, created_by, updated_by
       ) VALUES ($1, 'Valuation Coffee Beans 1kg', 'VAL-COF-001', '111111111111', 45.00, 'kg', 'active', $2, $2)
       RETURNING id;`,
      [orgId, ownerUserId]
    );
    productAId = resProdA.rows[0].id;

    // Product B: 5 units at $40.00
    const resProdB = await pgClient.query(
      `INSERT INTO public.products (
        organization_id, name, sku, barcode, selling_price, unit_of_measure, status, created_by, updated_by
       ) VALUES ($1, 'Valuation Ceramic Grinder', 'VAL-GRN-002', '222222222222', 75.00, 'unit', 'active', $2, $2)
       RETURNING id;`,
      [orgId, ownerUserId]
    );
    productBId = resProdB.rows[0].id;

    // Product C: 15 units with NO COST RECORD in product_costs (Unvalued product)
    const resProdC = await pgClient.query(
      `INSERT INTO public.products (
        organization_id, name, sku, barcode, selling_price, unit_of_measure, status, created_by, updated_by
       ) VALUES ($1, 'Valuation Paper Filters', 'VAL-FLT-003', '333333333333', 8.00, 'unit', 'active', $2, $2)
       RETURNING id;`,
      [orgId, ownerUserId]
    );
    productCUnvaluedId = resProdC.rows[0].id;

    // 6. Seed Costs
    // Product A cost: $25.00
    await pgClient.query(
      `INSERT INTO public.product_costs (organization_id, product_id, cost_price)
       VALUES ($1, $2, 25.00);`,
      [orgId, productAId]
    );

    // Product B cost: $40.00
    await pgClient.query(
      `INSERT INTO public.product_costs (organization_id, product_id, cost_price)
       VALUES ($1, $2, 40.00);`,
      [orgId, productBId]
    );

    // 7. Seed Stock via Initial Movements
    // Product A: 10 units
    const resMvtA = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: productAId,
      p_movement_type: "initial",
      p_quantity: 10,
      p_reason: "Opening valuation stock A",
      p_idempotency_key: "00000000-0000-4000-8000-000000000901",
      p_quantity_semantics: "quantity_delta",
    });
    if (resMvtA.error) throw new Error(`Initial A failed: ${resMvtA.error.message}`);

    // Product B: 5 units
    const resMvtB = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: productBId,
      p_movement_type: "initial",
      p_quantity: 5,
      p_reason: "Opening valuation stock B",
      p_idempotency_key: "00000000-0000-4000-8000-000000000902",
      p_quantity_semantics: "quantity_delta",
    });
    if (resMvtB.error) throw new Error(`Initial B failed: ${resMvtB.error.message}`);

    // Product C: 15 units
    const resMvtC = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: productCUnvaluedId,
      p_movement_type: "initial",
      p_quantity: 15,
      p_reason: "Opening valuation stock C",
      p_idempotency_key: "00000000-0000-4000-8000-000000000903",
      p_quantity_semantics: "quantity_delta",
    });
    if (resMvtC.error) throw new Error(`Initial C failed: ${resMvtC.error.message}`);
  }, 60000);

  afterAll(async () => {
    try {
      if (orgId) {
        await pgClient.query(`DELETE FROM public.organizations WHERE id = $1;`, [orgId]);
      }
      if (otherOrgId) {
        await pgClient.query(`DELETE FROM public.organizations WHERE id = $1;`, [otherOrgId]);
      }
      if (ownerUserId) await adminClient.auth.admin.deleteUser(ownerUserId);
      if (managerUserId) await adminClient.auth.admin.deleteUser(managerUserId);
      if (cashierUserId) await adminClient.auth.admin.deleteUser(cashierUserId);
    } catch {
      // Best-effort cleanup
    } finally {
      await pgClient.end();
    }
  });

  it("1. Authorized Manager with dual permissions receives exact valuation calculations", async () => {
    clearInMemoryCookieJar();
    const serverClient = await createServerClient();
    await serverClient.auth.signInWithPassword({ email: managerEmail, password: testPassword });

    const result = await getInventoryValuationSummaryAction(orgSlug);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success");

    // Expected valuation:
    // Product A: 10 * 25.00 = 250.00
    // Product B: 5 * 40.00 = 200.00
    // Product C: unvalued, omitted from monetary sum
    // Total: 450.00
    const data = result.data;
    expect(data.totalValuation.amount).toBe(450.0);
    expect(data.totalValuation.currency).toBe("USD");
    expect(data.totalTrackedProducts).toBe(3);
    expect(data.valuedProductsCount).toBe(2);
    expect(data.unvaluedProductsCount).toBe(1);

    // Verify unvalued item
    const unvaluedItem = data.items.find((i: { productId: string }) => i.productId === productCUnvaluedId);
    expect(unvaluedItem).toBeDefined();
    expect(unvaluedItem?.costPrice).toBeNull();
    expect(unvaluedItem?.lineValuation).toBeNull();
    expect(unvaluedItem?.quantity).toBe(15);

    // Verify valued items
    const itemA = data.items.find((i: { productId: string }) => i.productId === productAId);
    expect(itemA).toBeDefined();
    expect(itemA?.costPrice).toBe(25.0);
    expect(itemA?.lineValuation).toBe(250.0);
  });

  it("2. User with only inventory:read_valuation (without products:read_cost) is rejected with FORBIDDEN", async () => {
    // Create a temporary user with a custom role lacking products:read_cost
    clearInMemoryCookieJar();
    const serverClient = await createServerClient();
    await serverClient.auth.signInWithPassword({ email: cashierEmail, password: testPassword });

    // Cashier lacks both permissions
    const result = await getInventoryValuationSummaryAction(orgSlug);

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected failure");
    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("3. Cashier lacking valuation permissions receives FORBIDDEN error and zero cost data", async () => {
    clearInMemoryCookieJar();
    const serverClient = await createServerClient();
    await serverClient.auth.signInWithPassword({ email: cashierEmail, password: testPassword });

    const result = await getInventoryValuationSummaryAction(orgSlug);

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected failure");
    expect(result.error?.code).toBe("FORBIDDEN");
    expect((result as any).data).toBeUndefined();
  });

  it("4. Cross-tenant isolation rejects querying another organization valuation", async () => {
    clearInMemoryCookieJar();
    const serverClient = await createServerClient();
    // Cashier/Manager from orgId tries to access otherOrgSlug where they are NOT a member
    await serverClient.auth.signInWithPassword({ email: managerEmail, password: testPassword });

    const result = await getInventoryValuationSummaryAction(otherOrgSlug);

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected failure");
    // Manager is not a member of otherOrgSlug -> fails with NOT_FOUND to prevent directory enumeration
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("5. Reorder threshold OCC update via updateInventoryThresholdsAction updates version and thresholds", async () => {
    clearInMemoryCookieJar();
    const serverClient = await createServerClient();
    await serverClient.auth.signInWithPassword({ email: managerEmail, password: testPassword });

    // Fetch current inventory row version for product A
    const { rows: invRows } = await pgClient.query(
      `SELECT version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, productAId]
    );
    const currentVersion = invRows[0].version;

    const result = await updateInventoryThresholdsAction(orgSlug, {
      productId: productAId,
      reorderPoint: 8,
      reorderQuantity: 25,
      expectedVersion: currentVersion,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success");
    expect(result.data.reorderPoint).toBe(8);
    expect(result.data.reorderQuantity).toBe(25);
    expect(result.data.version).toBe(currentVersion + 1);

    // Stale version update conflict (P0027)
    const staleResult = await updateInventoryThresholdsAction(orgSlug, {
      productId: productAId,
      reorderPoint: 12,
      reorderQuantity: 30,
      expectedVersion: currentVersion, // passing old version
    });

    expect(staleResult.success).toBe(false);
    if (staleResult.success) throw new Error("Expected failure");
    expect(staleResult.error?.code).toBe("STALE_VERSION_CONFLICT");
  });
});
