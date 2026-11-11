import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";

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

describe("Audit D: Real Database Integration Verification (127.0.0.1:54322)", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;

  let ownerClient: SupabaseClient;
  let managerClient: SupabaseClient;
  let cashierClient: SupabaseClient;

  let ownerUserId: string;
  let managerUserId: string;
  let cashierUserId: string;
  const testPassword = "P@ssword123!AuditLive";

  let orgIdA: string;
  let orgIdB: string;
  const orgSlugA = `audit-inv-a-${Date.now()}`;
  const orgSlugB = `audit-inv-b-${Date.now()}`;

  let productAId: string;
  let productBId: string;

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const timestamp = Date.now();
    const ownerEmail = `audit_owner_${timestamp}@bizflow-test.internal`;
    const mgrEmail = `audit_mgr_${timestamp}@bizflow-test.internal`;
    const cashEmail = `audit_cash_${timestamp}@bizflow-test.internal`;

    // 1. Create test users
    const { data: uOwner } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Audit", last_name: "Owner" },
    });
    ownerUserId = uOwner.user!.id;

    const { data: uMgr } = await adminClient.auth.admin.createUser({
      email: mgrEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Audit", last_name: "Manager" },
    });
    managerUserId = uMgr.user!.id;

    const { data: uCash } = await adminClient.auth.admin.createUser({
      email: cashEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Audit", last_name: "Cashier" },
    });
    cashierUserId = uCash.user!.id;

    // 2. Authenticate clients
    ownerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

    managerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await managerClient.auth.signInWithPassword({ email: mgrEmail, password: testPassword });

    cashierClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await cashierClient.auth.signInWithPassword({ email: cashEmail, password: testPassword });

    // 3. Create Organizations
    const resOrgA = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
       VALUES ('Audit Org A', $1, 'USD', 'retail', 'US', 'America/New_York', $2)
       RETURNING id;`,
      [orgSlugA, ownerUserId]
    );
    orgIdA = resOrgA.rows[0].id;

    const resOrgB = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
       VALUES ('Audit Org B', $1, 'USD', 'retail', 'US', 'America/New_York', $2)
       RETURNING id;`,
      [orgSlugB, ownerUserId]
    );
    orgIdB = resOrgB.rows[0].id;

    // 4. Create Memberships
    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES 
         ($1, $2, 'owner', 'active'),
         ($1, $3, 'manager', 'active'),
         ($1, $4, 'cashier', 'active'),
         ($5, $2, 'owner', 'active');`,
      [orgIdA, ownerUserId, managerUserId, cashierUserId, orgIdB]
    );

    // 5. Create authoritative products
    const resProdA = await ownerClient.rpc("create_product", {
      p_org_id: orgIdA,
      p_name: "Audit Product A",
      p_sku: `AUDIT-A-${Date.now()}`,
      p_selling_price: 25.0,
      p_unit_of_measure: "piece",
      p_cost_price: 10.0,
    });
    if (resProdA.error) throw new Error(`Failed to create product A: ${resProdA.error.message}`);
    productAId = (resProdA.data as any).data.id;

    const resProdB = await ownerClient.rpc("create_product", {
      p_org_id: orgIdB,
      p_name: "Audit Product B",
      p_sku: `AUDIT-B-${Date.now()}`,
      p_selling_price: 50.0,
      p_unit_of_measure: "piece",
      p_cost_price: 20.0,
    });
    if (resProdB.error) throw new Error(`Failed to create product B: ${resProdB.error.message}`);
    productBId = (resProdB.data as any).data.id;
  });

  afterAll(async () => {
    try {
      if (orgIdA || orgIdB) {
        await pgClient.query(
          `DELETE FROM public.zero_delta_stocktakes WHERE organization_id IN ($1, $2)`,
          [orgIdA, orgIdB]
        );
        await pgClient.query(
          `DELETE FROM public.stock_movement_costs WHERE organization_id IN ($1, $2)`,
          [orgIdA, orgIdB]
        );
        await pgClient.query(
          `DELETE FROM public.stock_movements WHERE organization_id IN ($1, $2)`,
          [orgIdA, orgIdB]
        );
        await pgClient.query(
          `DELETE FROM public.inventory WHERE organization_id IN ($1, $2)`,
          [orgIdA, orgIdB]
        );
        await pgClient.query(
          `DELETE FROM public.product_costs WHERE organization_id IN ($1, $2)`,
          [orgIdA, orgIdB]
        );
        await pgClient.query(
          `DELETE FROM public.products WHERE organization_id IN ($1, $2)`,
          [orgIdA, orgIdB]
        );
        await pgClient.query(
          `DELETE FROM public.organization_memberships WHERE organization_id IN ($1, $2)`,
          [orgIdA, orgIdB]
        );
        await pgClient.query(
          `DELETE FROM public.organizations WHERE id IN ($1, $2)`,
          [orgIdA, orgIdB]
        );
      }
    } catch (_) {}

    try {
      if (ownerUserId) await adminClient.auth.admin.deleteUser(ownerUserId);
      if (managerUserId) await adminClient.auth.admin.deleteUser(managerUserId);
      if (cashierUserId) await adminClient.auth.admin.deleteUser(cashierUserId);
    } catch (_) {}

    await pgClient.end();
  });

  // 1. Initial Opening Stock & Restock
  it("executes initial opening stock and subsequent restock via execute_stock_movement", async () => {
    // Initial opening stock: 100 units
    const initRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgIdA,
      p_product_id: productAId,
      p_movement_type: "initial",
      p_quantity: 100,
      p_reason: "Initial inventory setup",
      p_reference_id: "INIT-001",
      p_idempotency_key: "00000000-0000-4000-8000-000000000001",
      p_quantity_semantics: "quantity_delta",
    });

    expect(initRes.error).toBeNull();
    const initData = initRes.data as any;
    expect(initData.success).toBe(true);
    expect(initData.is_replay).toBe(false);
    expect(initData.status).toBe("committed");
    expect(parseFloat(initData.quantity_before)).toBe(0);
    expect(parseFloat(initData.quantity_delta)).toBe(100);
    expect(parseFloat(initData.quantity_after)).toBe(100);

    // Restock: +50 units
    const restockRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgIdA,
      p_product_id: productAId,
      p_movement_type: "restock",
      p_quantity: 50,
      p_reason: "Supplier shipment received",
      p_reference_id: "PO-999",
      p_idempotency_key: "00000000-0000-4000-8000-000000000002",
      p_quantity_semantics: "quantity_delta",
    });

    expect(restockRes.error).toBeNull();
    const restockData = restockRes.data as any;
    expect(restockData.success).toBe(true);
    expect(parseFloat(restockData.quantity_before)).toBe(100);
    expect(parseFloat(restockData.quantity_delta)).toBe(50);
    expect(parseFloat(restockData.quantity_after)).toBe(150);
  });

  // 2. Idempotent Replay
  it("replays previous successful mutation when same idempotency key is submitted", async () => {
    const replayRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgIdA,
      p_product_id: productAId,
      p_movement_type: "restock",
      p_quantity: 50,
      p_reason: "Supplier shipment received",
      p_reference_id: "PO-999",
      p_idempotency_key: "00000000-0000-4000-8000-000000000002",
      p_quantity_semantics: "quantity_delta",
    });

    expect(replayRes.error).toBeNull();
    const replayData = replayRes.data as any;
    expect(replayData.success).toBe(true);
    expect(replayData.is_replay).toBe(true);
    expect(parseFloat(replayData.quantity_after)).toBe(150);
  });

  // 3. Idempotency Conflict (P0024)
  it("rejects duplicate idempotency key with different payload with P0024", async () => {
    const conflictRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgIdA,
      p_product_id: productAId,
      p_movement_type: "restock",
      p_quantity: 75, // Different quantity!
      p_reason: "Different supplier shipment",
      p_reference_id: "PO-999",
      p_idempotency_key: "00000000-0000-4000-8000-000000000002",
      p_quantity_semantics: "quantity_delta",
    });

    expect(conflictRes.error).not.toBeNull();
    expect(conflictRes.error?.code).toBe("P0024");
    expect(conflictRes.error?.message).toMatch(/IDEMPOTENCY_CONFLICT/i);
  });

  // 4. Insufficient Stock Invariant (P0011)
  it("rejects stock deduction exceeding live balance with P0011", async () => {
    // Current stock is 150. Attempting to write off 200 units (negative delta).
    const deductRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgIdA,
      p_product_id: productAId,
      p_movement_type: "damage",
      p_quantity: -200,
      p_reason: "Massive warehouse flood damage",
      p_idempotency_key: "00000000-0000-4000-8000-000000000003",
      p_quantity_semantics: "quantity_delta",
    });

    expect(deductRes.error).not.toBeNull();
    expect(deductRes.error?.code).toBe("P0011");
    expect(deductRes.error?.message).toMatch(/INSUFFICIENT_STOCK/i);
  });

  // 5. Zero-Delta Stocktake Replay
  it("records zero-delta stocktake and returns original matched quantity on replay", async () => {
    // Live stock is 150. Target physical count = 150 (delta = 0).
    const zdRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgIdA,
      p_product_id: productAId,
      p_movement_type: "adjustment",
      p_quantity: 150,
      p_reason: "Monthly cycle count confirms exact balance",
      p_idempotency_key: "00000000-0000-4000-8000-000000000004",
      p_quantity_semantics: "target_physical_count",
    });

    expect(zdRes.error).toBeNull();
    const zdData = zdRes.data as any;
    expect(zdData.success).toBe(true);
    expect(zdData.status).toBe("matched");
    expect(parseFloat(zdData.quantity_delta)).toBe(0);
    expect(parseFloat(zdData.current_stock)).toBe(150);

    // Replay zero-delta stocktake
    const zdReplay = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgIdA,
      p_product_id: productAId,
      p_movement_type: "adjustment",
      p_quantity: 150,
      p_reason: "Monthly cycle count confirms exact balance",
      p_idempotency_key: "00000000-0000-4000-8000-000000000004",
      p_quantity_semantics: "target_physical_count",
    });

    expect(zdReplay.error).toBeNull();
    const zdReplayData = zdReplay.data as any;
    expect(zdReplayData.is_replay).toBe(true);
    expect(zdReplayData.status).toBe("matched");
    expect(parseFloat(zdReplayData.matched_quantity)).toBe(150);
  });

  // 6. Optimistic Concurrency Control on Thresholds
  it("updates inventory thresholds and enforces OCC version checking (P0027)", async () => {
    // Read current version
    const resInv = await pgClient.query(
      `SELECT version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
      [orgIdA, productAId]
    );
    const currentVersion = resInv.rows[0].version;

    // Successful update with matching expected version
    const updateRes = await ownerClient.rpc("update_inventory_thresholds", {
      p_org_id: orgIdA,
      p_product_id: productAId,
      p_reorder_point: 20,
      p_reorder_quantity: 50,
      p_expected_version: currentVersion,
    });

    expect(updateRes.error).toBeNull();
    const updateData = updateRes.data as any;
    expect(updateData.success).toBe(true);
    expect(updateData.reorder_point).toBe(20);
    expect(updateData.reorder_quantity).toBe(50);
    expect(updateData.version).toBe(currentVersion + 1);

    // Stale version update attempt fails with P0027
    const staleRes = await ownerClient.rpc("update_inventory_thresholds", {
      p_org_id: orgIdA,
      p_product_id: productAId,
      p_reorder_point: 25,
      p_reorder_quantity: 60,
      p_expected_version: currentVersion, // Stale!
    });

    expect(staleRes.error).not.toBeNull();
    expect(staleRes.error?.code).toBe("P0027");
    expect(staleRes.error?.message).toMatch(/STALE_VERSION_CONFLICT/i);
  });

  // 7. Multi-Tenant Cross-Organization Isolation
  it("rejects attempt to modify another tenant's product with P0003", async () => {
    // Owner of Org A attempts to mutate Org B product while authenticated in Org A
    const crossRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgIdA,
      p_product_id: productBId, // Belongs to Org B!
      p_movement_type: "restock",
      p_quantity: 10,
      p_reason: "Cross-tenant intrusion attempt",
      p_idempotency_key: "00000000-0000-4000-8000-000000000005",
      p_quantity_semantics: "quantity_delta",
    });

    expect(crossRes.error).not.toBeNull();
    expect(crossRes.error?.code).toBe("P0003");
    expect(crossRes.error?.message).toMatch(/PRODUCT_NOT_FOUND/i);
  });

  // 8. RLS and Permission Security for Cashier Role
  it("denies Cashier role from executing stock mutations (42501)", async () => {
    const cashRes = await cashierClient.rpc("execute_stock_movement", {
      p_org_id: orgIdA,
      p_product_id: productAId,
      p_movement_type: "restock",
      p_quantity: 10,
      p_reason: "Cashier unauthorized restock",
      p_idempotency_key: "00000000-0000-4000-8000-000000000006",
      p_quantity_semantics: "quantity_delta",
    });

    expect(cashRes.error).not.toBeNull();
    expect(cashRes.error?.code).toBe("42501");
  });

  // 9. Valuation RLS Protection on stock_movement_costs
  it("enforces dual-permission RLS on stock_movement_costs: visible to Owner, hidden from Cashier", async () => {
    // Check Owner view: holds inventory:read_valuation AND products:read_cost
    const { data: ownerCosts, error: ownerError } = await ownerClient
      .from("stock_movement_costs")
      .select("unit_cost, currency")
      .eq("organization_id", orgIdA);

    expect(ownerError).toBeNull();
    expect(ownerCosts).not.toBeNull();
    expect(ownerCosts!.length).toBeGreaterThan(0);
    expect(ownerCosts?.[0]?.unit_cost).toBe(10.0);

    // Check Cashier view: lacks inventory:read_valuation AND products:read_cost
    const { data: cashCosts, error: cashError } = await cashierClient
      .from("stock_movement_costs")
      .select("unit_cost, currency")
      .eq("organization_id", orgIdA);

    expect(cashError).toBeNull();
    // Supabase RLS silently filters out unauthorized rows
    expect(cashCosts).toEqual([]);
  });
});

