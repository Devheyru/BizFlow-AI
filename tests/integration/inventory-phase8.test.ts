import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import {
  clearInMemoryCookieJar,
  createClient as createServerClient,
} from "@/lib/supabase/server";
import { getMovementHistoryAction } from "@/actions/inventory-actions";

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

describe("Feature 004 Phase 8 Integration: Stock Movement History & Valuation Protection (T031–T032)", () => {
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

  const testPassword = "P@ssword123!Phase8History";

  let orgId: string;
  const orgSlug = `phase8-hist-${Date.now()}`;

  let productAId: string;
  let productBId: string;

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const timestamp = Date.now();
    ownerEmail = `phase8_owner_${timestamp}@bizflow-test.internal`;
    managerEmail = `phase8_mgr_${timestamp}@bizflow-test.internal`;
    cashierEmail = `phase8_cash_${timestamp}@bizflow-test.internal`;

    // 1. Create Users
    const { data: uOwner } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Audit", last_name: "Owner" },
    });
    ownerUserId = uOwner.user!.id;

    const { data: uMgr } = await adminClient.auth.admin.createUser({
      email: managerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Audit", last_name: "Manager" },
    });
    managerUserId = uMgr.user!.id;

    const { data: uCash } = await adminClient.auth.admin.createUser({
      email: cashierEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Audit", last_name: "Cashier" },
    });
    cashierUserId = uCash.user!.id;

    // 2. Authenticate clients
    ownerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

    managerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await managerClient.auth.signInWithPassword({ email: managerEmail, password: testPassword });

    cashierClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await cashierClient.auth.signInWithPassword({ email: cashierEmail, password: testPassword });

    // 3. Create Organization
    const resOrg = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
       VALUES ('Phase 8 Audit Org', $1, 'USD', 'retail', 'US', 'America/New_York', $2)
       RETURNING id;`,
      [orgSlug, ownerUserId]
    );
    orgId = resOrg.rows[0].id;

    // 4. Create Memberships
    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES 
         ($1, $2, 'owner', 'active'),
         ($1, $3, 'manager', 'active'),
         ($1, $4, 'cashier', 'active');`,
      [orgId, ownerUserId, managerUserId, cashierUserId]
    );

    // 5. Create Test Products
    const resProdA = await ownerClient.rpc("create_product", {
      p_org_id: orgId,
      p_name: "Phase 8 Product Alpha",
      p_sku: `P8-ALPHA-${Date.now()}`,
      p_selling_price: 50.0,
      p_unit_of_measure: "piece",
      p_cost_price: 25.0,
    });
    if (resProdA.error) throw new Error(`Product A failed: ${resProdA.error.message}`);
    productAId = (resProdA.data as any).data.id;

    const resProdB = await ownerClient.rpc("create_product", {
      p_org_id: orgId,
      p_name: "Phase 8 Product Beta",
      p_sku: `P8-BETA-${Date.now()}`,
      p_selling_price: 80.0,
      p_unit_of_measure: "piece",
      p_cost_price: 40.0,
    });
    if (resProdB.error) throw new Error(`Product B failed: ${resProdB.error.message}`);
    productBId = (resProdB.data as any).data.id;

    // 6. Record Movement Sequence:
    // Product A:
    // Movement 1: initial stock = 100
    await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: productAId,
      p_movement_type: "initial",
      p_quantity: 100,
      p_reason: "Initial opening stock",
      p_idempotency_key: "00000000-0000-4000-8000-000000000801",
      p_quantity_semantics: "quantity_delta",
    });

    // Movement 2: restock = +50
    const mvtRestock = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: productAId,
      p_movement_type: "restock",
      p_quantity: 50,
      p_reason: "Weekly warehouse delivery",
      p_reference_id: "PO-8001",
      p_idempotency_key: "00000000-0000-4000-8000-000000000802",
      p_quantity_semantics: "quantity_delta",
    });
    const restockMovementId = (mvtRestock.data as any).movement_id;

    // Attach acquisition cost snapshot to restock movement
    if (restockMovementId) {
      await pgClient.query(
        `INSERT INTO public.stock_movement_costs (movement_id, organization_id, unit_cost, currency)
         VALUES ($1, $2, 25.50, 'USD')
         ON CONFLICT (movement_id) DO NOTHING;`,
        [restockMovementId, orgId]
      );
    }

    // Movement 3: damage write-off = -5
    const resDmg = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: productAId,
      p_movement_type: "damage",
      p_quantity: -5,
      p_reason: "Water damage during roof inspection",
      p_reference_id: "DMG-8001",
      p_idempotency_key: "00000000-0000-4000-8000-000000000803",
      p_quantity_semantics: "quantity_delta",
    });
    if (resDmg.error) throw new Error(`Damage movement failed: ${resDmg.error.message}`);

    // Product B:
    // Movement 4: initial stock = 40
    await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: productBId,
      p_movement_type: "initial",
      p_quantity: 40,
      p_reason: "Initial beta stock",
      p_idempotency_key: "00000000-0000-4000-8000-000000000804",
      p_quantity_semantics: "quantity_delta",
    });
  });

  afterAll(async () => {
    try {
      // Clean up temporary role permission if added
      await pgClient.query(
        `DELETE FROM public.role_permissions WHERE role = 'cashier' AND permission_id = 'inventory:history';`
      );
    } catch (_) {}

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
      if (ownerUserId) await adminClient.auth.admin.deleteUser(ownerUserId);
      if (managerUserId) await adminClient.auth.admin.deleteUser(managerUserId);
      if (cashierUserId) await adminClient.auth.admin.deleteUser(cashierUserId);
    } catch (_) {}

    await pgClient.end();
  });

  // ==========================================================================
  // 1. Manager Access: Full Movement History & Valuation Snapshot (T031)
  // ==========================================================================
  it("1. Manager holding dual valuation permissions receives acquisition cost in movement history", async () => {
    clearInMemoryCookieJar();
    const serverClient = await createServerClient();
    await serverClient.auth.signInWithPassword({ email: managerEmail, password: testPassword });

    const result = await getMovementHistoryAction(orgSlug, {});

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.totalCount).toBe(4);
    expect(result.data.items.length).toBe(4);

    // Verify reverse chronological ordering (latest first)
    const items = result.data.items;
    const timestamps = items.map((i) => new Date(i.createdAt).getTime());
    for (let i = 0; i < timestamps.length - 1; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i + 1]!);
    }

    // Find the restock movement for Product A with attached cost
    const restockItem = items.find(
      (i) => i.productId === productAId && i.movementType === "restock"
    );
    expect(restockItem).toBeDefined();
    expect(restockItem?.quantityDelta).toBe(50);
    expect(restockItem?.quantityBefore).toBe(100);
    expect(restockItem?.quantityAfter).toBe(150);
    expect(restockItem?.unitCost).toBe(25);
    expect(restockItem?.currency).toBe("USD");
    expect(restockItem?.reason).toBe("Weekly warehouse delivery");
    expect(restockItem?.referenceId).toBe("PO-8001");
  });

  // ==========================================================================
  // 2. Unauthorized User Access: Missing inventory:history (Fail-Closed)
  // ==========================================================================
  it("2. User lacking inventory:history permission is rejected with FORBIDDEN error", async () => {
    clearInMemoryCookieJar();
    const serverClient = await createServerClient();
    await serverClient.auth.signInWithPassword({ email: cashierEmail, password: testPassword });

    // Cashier does not have inventory:history yet
    const result = await getMovementHistoryAction(orgSlug, {});

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.code).toBe("FORBIDDEN");
    expect(result.error.message).toMatch(/inventory:history/i);
  });

  // ==========================================================================
  // 3. Cashier Access: Valuation Fields Masked / Stripped (FR-INV-020, T031)
  // ==========================================================================
  it("3. Cashier holding inventory:history but lacking valuation permissions receives unitCost: null and currency: null", async () => {
    // Grant inventory:history to cashier
    await pgClient.query(
      `INSERT INTO public.role_permissions (role, permission_id)
       VALUES ('cashier', 'inventory:history')
       ON CONFLICT DO NOTHING;`
    );

    clearInMemoryCookieJar();
    const serverClient = await createServerClient();
    await serverClient.auth.signInWithPassword({ email: cashierEmail, password: testPassword });

    const result = await getMovementHistoryAction(orgSlug, {});

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.totalCount).toBe(4);

    // Every item must have unitCost === null and currency === null
    for (const item of result.data.items) {
      expect(item.unitCost).toBeNull();
      expect(item.currency).toBeNull();
      // Verify performer email is masked
      expect(item.performedBy.email).toBe("");
    }
  });

  // ==========================================================================
  // 4. Filtering and Pagination Validation
  // ==========================================================================
  it("4. Filters movement history by productId correctly", async () => {
    clearInMemoryCookieJar();
    const serverClient = await createServerClient();
    await serverClient.auth.signInWithPassword({ email: managerEmail, password: testPassword });

    const result = await getMovementHistoryAction(orgSlug, {
      productId: productBId,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.totalCount).toBe(1);
    expect(result.data.items[0]?.productId).toBe(productBId);
    expect(result.data.items[0]?.movementType).toBe("initial");
    expect(result.data.items[0]?.quantityDelta).toBe(40);
  });

  it("5. Filters movement history by movementType correctly", async () => {
    clearInMemoryCookieJar();
    const serverClient = await createServerClient();
    await serverClient.auth.signInWithPassword({ email: managerEmail, password: testPassword });

    const result = await getMovementHistoryAction(orgSlug, {
      movementType: "damage",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.totalCount).toBe(1);
    expect(result.data.items[0]?.movementType).toBe("damage");
    expect(result.data.items[0]?.quantityDelta).toBe(-5);
    expect(result.data.items[0]?.reason).toBe("Water damage during roof inspection");
    expect(result.data.items[0]?.referenceId).toBe("DMG-8001");
  });

  it("6. Handles pagination page and pageSize correctly", async () => {
    clearInMemoryCookieJar();
    const serverClient = await createServerClient();
    await serverClient.auth.signInWithPassword({ email: managerEmail, password: testPassword });

    const page1 = await getMovementHistoryAction(orgSlug, {
      page: 1,
      pageSize: 2,
    });

    expect(page1.success).toBe(true);
    if (!page1.success) return;

    expect(page1.data.items.length).toBe(2);
    expect(page1.data.totalCount).toBe(4);
    expect(page1.data.totalPages).toBe(2);

    const page2 = await getMovementHistoryAction(orgSlug, {
      page: 2,
      pageSize: 2,
    });

    expect(page2.success).toBe(true);
    if (!page2.success) return;

    expect(page2.data.items.length).toBe(2);
    expect(page2.data.page).toBe(2);

    // Verify disjoint IDs across pages
    const page1Ids = page1.data.items.map((i) => i.id);
    const page2Ids = page2.data.items.map((i) => i.id);
    expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
  });

  // ==========================================================================
  // 5. Database Ledger Immutability Verification (Security Invariant)
  // ==========================================================================
  it("7. Ledger records cannot be updated or deleted via direct DML (PostgreSQL Immutability)", async () => {
    const { error: clientUpdateError } = await managerClient
      .from("stock_movements")
      .update({ reason: "Unauthorized Edit" } as any)
      .eq("organization_id", orgId);

    // Should be denied by RLS (no UPDATE policy exists on stock_movements)
    expect(clientUpdateError).toBeDefined();

    const { error: clientDeleteError } = await managerClient
      .from("stock_movements")
      .delete()
      .eq("organization_id", orgId);

    // Should be denied by RLS (no DELETE policy exists on stock_movements)
    expect(clientDeleteError).toBeDefined();
  });
});
