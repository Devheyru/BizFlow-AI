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
  let productContinuousId: string;

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

    const resProdCont = await ownerClient.rpc("create_product", {
      p_org_id: orgIdA,
      p_name: "Audit Continuous Product",
      p_sku: `AUDIT-CONT-${Date.now()}`,
      p_selling_price: 15.0,
      p_unit_of_measure: "kg",
      p_cost_price: 5.0,
    });
    if (resProdCont.error) throw new Error(`Failed to create continuous product: ${resProdCont.error.message}`);
    productContinuousId = (resProdCont.data as any).data.id;
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

  // 10. Database-Level Discrete UOM Fractional Rejection (P0015) — Verification B
  it("rejects fractional quantity on discrete product (piece) at database RPC boundary with P0015", async () => {
    const fracRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgIdA,
      p_product_id: productAId, // unit_of_measure = 'piece' (discrete)
      p_movement_type: "restock",
      p_quantity: 3.5, // Fractional quantity violates P0015
      p_reason: "Direct RPC call attempting fractional restock on discrete product",
      p_idempotency_key: "00000000-0000-4000-8000-000000000010",
      p_quantity_semantics: "quantity_delta",
    });

    expect(fracRes.error).not.toBeNull();
    expect(fracRes.error?.code).toBe("P0015");
    expect(fracRes.error?.message).toMatch(/INTEGER_QUANTITY_REQUIRED/i);
  });

  // 11. Database-Level Discrete UOM Whole Integer Acceptance — Verification B
  it("accepts whole integer quantity on discrete product (piece) at database RPC boundary", async () => {
    const intRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgIdA,
      p_product_id: productAId, // unit_of_measure = 'piece' (discrete)
      p_movement_type: "restock",
      p_quantity: 4, // Whole integer
      p_reason: "Direct RPC call with integer quantity",
      p_idempotency_key: "00000000-0000-4000-8000-000000000011",
      p_quantity_semantics: "quantity_delta",
    });

    expect(intRes.error).toBeNull();
    const data = intRes.data as any;
    expect(data.success).toBe(true);
    expect(parseFloat(data.quantity_delta)).toBe(4);
  });

  // 12. Database-Level Continuous UOM Decimal Precision Acceptance — Verification B
  it("accepts valid decimal quantity (up to 4 decimal places) on continuous product (kg)", async () => {
    const contRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgIdA,
      p_product_id: productContinuousId, // unit_of_measure = 'kg' (continuous)
      p_movement_type: "initial",
      p_quantity: 12.3456, // 4 decimal places
      p_reason: "Initial bulk grain receipt",
      p_idempotency_key: "00000000-0000-4000-8000-000000000012",
      p_quantity_semantics: "quantity_delta",
    });

    expect(contRes.error).toBeNull();
    const data = contRes.data as any;
    expect(data.success).toBe(true);
    expect(parseFloat(data.quantity_delta)).toBe(12.3456);
  });

  // 13. Database-Level Decimal Precision Exceeded Rejection (P0016) — Verification B
  it("rejects quantity with more than 4 decimal places at database RPC boundary with P0016", async () => {
    const precRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgIdA,
      p_product_id: productContinuousId, // unit_of_measure = 'kg'
      p_movement_type: "restock",
      p_quantity: 5.12345, // 5 decimal places violates P0016
      p_reason: "Excessive decimal precision attempt",
      p_idempotency_key: "00000000-0000-4000-8000-000000000013",
      p_quantity_semantics: "quantity_delta",
    });

    expect(precRes.error).not.toBeNull();
    expect(precRes.error?.code).toBe("P0016");
    expect(precRes.error?.message).toMatch(/DECIMAL_PRECISION_EXCEEDED/i);
  });

  // 14. Direct RPC Optimistic Concurrency Control via expectedVersion (P0027) — Verification D
  it("enforces expectedVersion contract on execute_stock_movement: rejects stale version (P0027) and succeeds on match", async () => {
    // 1. Fetch current version for continuous product
    const invRes = await pgClient.query(
      `SELECT version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
      [orgIdA, productContinuousId]
    );
    const currentVersion = invRes.rows[0].version;

    // 2. Attempt mutation with stale expected_version -> P0027
    const staleRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgIdA,
      p_product_id: productContinuousId,
      p_movement_type: "restock",
      p_quantity: 1.0,
      p_reason: "Stale OCC restock attempt",
      p_expected_version: currentVersion - 1, // Stale version!
      p_idempotency_key: "00000000-0000-4000-8000-000000000014",
      p_quantity_semantics: "quantity_delta",
    });

    expect(staleRes.error).not.toBeNull();
    expect(staleRes.error?.code).toBe("P0027");
    expect(staleRes.error?.message).toMatch(/STALE_VERSION_CONFLICT/i);

    // 3. Attempt mutation with matching expected_version -> Success
    const validRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgIdA,
      p_product_id: productContinuousId,
      p_movement_type: "restock",
      p_quantity: 1.0,
      p_reason: "Matching OCC restock",
      p_expected_version: currentVersion, // Exact match
      p_idempotency_key: "00000000-0000-4000-8000-000000000015",
      p_quantity_semantics: "quantity_delta",
    });

    expect(validRes.error).toBeNull();
    const data = validRes.data as any;
    expect(data.success).toBe(true);
    expect(data.version).toBe(currentVersion + 1);
  });

  // 15. Initial Opening Stock Singularity Enforcement (T025, US3, BR-INV-006, P0026 / uq_stock_movements_initial_per_product)
  it("rejects duplicate initial opening stock movement on product with existing history (P0026 / singularity constraint)", async () => {
    // productContinuousId already had an initial stock movement recorded in test 12.
    // Attempting a second 'initial' movement must be rejected at the database RPC boundary.
    const dupInitRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgIdA,
      p_product_id: productContinuousId,
      p_movement_type: "initial",
      p_quantity: 50.0,
      p_reason: "Duplicate initial stock attempt",
      p_idempotency_key: "00000000-0000-4000-8000-000000000016",
      p_quantity_semantics: "quantity_delta",
    });

    expect(dupInitRes.error).not.toBeNull();
    // Database raises P0026 INITIAL_STOCK_NOT_PERMITTED_HISTORY_EXISTS or 23505 unique violation
    expect(["P0026", "23505", "P0025"]).toContain(dupInitRes.error?.code);
    expect(dupInitRes.error?.message).toMatch(/INITIAL_STOCK|history exists/i);
  });

  // ==========================================================================
  // 16. T025 Movement-History RPC Security & Privilege Verification
  // ==========================================================================
  describe("T025 get_products_with_movement_history RPC Live Database Verification", () => {
    it("16a. Function catalog definition in pg_proc matches security requirements", async () => {
      const res = await pgClient.query(`
        SELECT
          p.proname,
          r.rolname as owner,
          p.prosecdef,
          p.proconfig
        FROM pg_proc p
        JOIN pg_roles r ON r.oid = p.proowner
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'get_products_with_movement_history';
      `);

      expect(res.rows.length).toBe(1);
      const row = res.rows[0];
      expect(row.proname).toBe("get_products_with_movement_history");
      expect(row.owner).toBe("postgres");
      expect(row.prosecdef).toBe(true); // SECURITY DEFINER
      expect(row.proconfig).toEqual(["search_path=pg_catalog, public, pg_temp"]);
    });

    it("16b. Function execution privileges: anon is denied, authenticated is granted", async () => {
      const res = await pgClient.query(`
        SELECT
          has_function_privilege('anon', 'public.get_products_with_movement_history(uuid, uuid[])', 'execute') as anon_exec,
          has_function_privilege('authenticated', 'public.get_products_with_movement_history(uuid, uuid[])', 'execute') as auth_exec,
          has_function_privilege('service_role', 'public.get_products_with_movement_history(uuid, uuid[])', 'execute') as service_exec;
      `);

      expect(res.rows[0].anon_exec).toBe(false);
      expect(res.rows[0].auth_exec).toBe(true);
      expect(res.rows[0].service_exec).toBe(true);
    });

    it("16c. Authenticated authorized member retrieves distinct movement product IDs", async () => {
      // productContinuousId and productAId both have movements recorded in previous tests
      const res = await ownerClient.rpc("get_products_with_movement_history", {
        p_org_id: orgIdA,
        p_product_ids: null,
      });

      expect(res.error).toBeNull();
      expect(Array.isArray(res.data)).toBe(true);
      const productIds = (res.data as any[]).map((r) => r.product_id);
      expect(productIds).toContain(productContinuousId);

      // Verify distinctness: no duplicates
      const uniqueIds = new Set(productIds);
      expect(productIds.length).toBe(uniqueIds.size);
    });

    it("16d. Handles explicit candidate IDs array filtering correctly", async () => {
      // Create a brand new product in orgIdA without any movements
      const sku = `SKU-LIVE-CLEAN-${Date.now()}`;
      const newProdRes = await pgClient.query(
        `INSERT INTO public.products (organization_id, name, sku, unit_of_measure, status, created_by, updated_by)
         VALUES ($1, 'Live Clean Product', $2, 'piece', 'active', $3, $3)
         RETURNING id;`,
        [orgIdA, sku, ownerUserId]
      );
      const cleanProdId = newProdRes.rows[0].id;

      // Call RPC passing both a product with history and the clean product
      const res = await ownerClient.rpc("get_products_with_movement_history", {
        p_org_id: orgIdA,
        p_product_ids: [productContinuousId, cleanProdId],
      });

      expect(res.error).toBeNull();
      const productIds = (res.data as any[]).map((r) => r.product_id);
      expect(productIds).toContain(productContinuousId);
      expect(productIds).not.toContain(cleanProdId); // Clean product has no history
    });

    it("16e. Cross-tenant isolation: rejects retrieval for an organization where caller has no membership (P0002)", async () => {
      // managerClient is an active member of orgIdA, but has NO membership in orgIdB
      const res = await managerClient.rpc("get_products_with_movement_history", {
        p_org_id: orgIdB,
        p_product_ids: null,
      });

      expect(res.error).not.toBeNull();
      expect(res.error?.code).toBe("P0002");
      expect(res.error?.message).toMatch(/MEMBERSHIP_INACTIVE/i);
    });

    it("16f. Anon client without session is denied from invoking RPC", async () => {
      const anonClient = createClient(supabaseUrl, anonKey);
      const res = await anonClient.rpc("get_products_with_movement_history", {
        p_org_id: orgIdA,
        p_product_ids: null,
      });

      expect(res.error).not.toBeNull();
      // PostgREST/Postgres denies execution to anon role (42501 or permission denied)
      expect(["42501", "PGRST202", "08001"]).toContain(res.error?.code);
    });

    it("16g. Negative RBAC: active member without inventory:read is rejected with 42501 and receives zero product IDs", async () => {
      // 1. Capture exact initial mapping state before test execution
      const preCheck = await pgClient.query(`
        SELECT 1 FROM public.role_permissions
        WHERE role = 'cashier' AND permission_id = 'inventory:read';
      `);
      const mappingOriginallyExisted = preCheck.rows.length > 0;

      try {
        // 2. Temporarily revoke 'inventory:read' from role 'cashier' if it exists
        if (mappingOriginallyExisted) {
          await pgClient.query(`
            DELETE FROM public.role_permissions
            WHERE role = 'cashier' AND permission_id = 'inventory:read';
          `);
        }

        // 3. cashierClient is an active member in orgIdA, but now lacks 'inventory:read'
        const res = await cashierClient.rpc("get_products_with_movement_history", {
          p_org_id: orgIdA,
          p_product_ids: null,
        });

        // 4. PostgreSQL must reject the call with 42501 (INSUFFICIENT_PERMISSIONS)
        expect(res.error).not.toBeNull();
        expect(res.error?.code).toBe("42501");
        expect(res.error?.message).toMatch(/INSUFFICIENT_PERMISSIONS/i);

        // 5. Must return NO data (null data on error, zero product IDs leaked)
        expect(res.data).toBeNull();
      } finally {
        // 6. Guarantee exact restoration of initial mapping state
        if (mappingOriginallyExisted) {
          await pgClient.query(`
            INSERT INTO public.role_permissions (role, permission_id)
            VALUES ('cashier', 'inventory:read')
            ON CONFLICT (role, permission_id) DO NOTHING;
          `);
        } else {
          await pgClient.query(`
            DELETE FROM public.role_permissions
            WHERE role = 'cashier' AND permission_id = 'inventory:read';
          `);
        }

        // 7. Verify post-cleanup state matches pre-check exactly
        const postCheck = await pgClient.query(`
          SELECT 1 FROM public.role_permissions
          WHERE role = 'cashier' AND permission_id = 'inventory:read';
        `);
        expect(postCheck.rows.length > 0).toBe(mappingOriginallyExisted);
      }
    });
  });
});

