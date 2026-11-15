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

describe("T040: Integration Tests — stock_movement_costs RLS & Cost Isolation", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;

  let ownerAClient: SupabaseClient;
  let managerAClient: SupabaseClient;
  let cashierAClient: SupabaseClient;
  let ownerBClient: SupabaseClient;

  let ownerAUserId: string;
  let managerAUserId: string;
  let cashierAUserId: string;
  let ownerBUserId: string;

  const testPassword = "P@ssword123!T040Cost";
  const timestamp = Date.now();

  let orgAId: string;
  let orgBId: string;
  const orgASlug = `t040-orga-${timestamp}`;
  const orgBSlug = `t040-orgb-${timestamp}`;

  let productAId: string;
  let movementId: string;
  const confidentialCost = 42.5;

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Create Users
    const emailOwnerA = `t040_ownera_${timestamp}@bizflow-test.internal`;
    const emailMgrA = `t040_mgra_${timestamp}@bizflow-test.internal`;
    const emailCashA = `t040_casha_${timestamp}@bizflow-test.internal`;
    const emailOwnerB = `t040_ownerb_${timestamp}@bizflow-test.internal`;

    const { data: uOwnerA } = await adminClient.auth.admin.createUser({
      email: emailOwnerA,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Owner", last_name: "A" },
    });
    ownerAUserId = uOwnerA.user!.id;

    const { data: uMgrA } = await adminClient.auth.admin.createUser({
      email: emailMgrA,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Manager", last_name: "A" },
    });
    managerAUserId = uMgrA.user!.id;

    const { data: uCashA } = await adminClient.auth.admin.createUser({
      email: emailCashA,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Cashier", last_name: "A" },
    });
    cashierAUserId = uCashA.user!.id;

    const { data: uOwnerB } = await adminClient.auth.admin.createUser({
      email: emailOwnerB,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Owner", last_name: "B" },
    });
    ownerBUserId = uOwnerB.user!.id;

    // 2. Authenticate Clients
    ownerAClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await ownerAClient.auth.signInWithPassword({ email: emailOwnerA, password: testPassword });

    managerAClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await managerAClient.auth.signInWithPassword({ email: emailMgrA, password: testPassword });

    cashierAClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await cashierAClient.auth.signInWithPassword({ email: emailCashA, password: testPassword });

    ownerBClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await ownerBClient.auth.signInWithPassword({ email: emailOwnerB, password: testPassword });

    // 3. Create Organizations
    const resOrgA = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
       VALUES ('T040 Org A', $1, 'USD', 'retail', 'US', 'America/New_York', $2)
       RETURNING id;`,
      [orgASlug, ownerAUserId]
    );
    orgAId = resOrgA.rows[0].id;

    const resOrgB = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
       VALUES ('T040 Org B', $1, 'USD', 'retail', 'US', 'America/New_York', $2)
       RETURNING id;`,
      [orgBSlug, ownerBUserId]
    );
    orgBId = resOrgB.rows[0].id;

    // 4. Create Memberships
    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES 
         ($1, $2, 'owner', 'active'),
         ($1, $3, 'manager', 'active'),
         ($1, $4, 'cashier', 'active'),
         ($5, $6, 'owner', 'active');`,
      [orgAId, ownerAUserId, managerAUserId, cashierAUserId, orgBId, ownerBUserId]
    );

    // 5. Seed Product in Org A with Confidential Cost
    const resProd = await ownerAClient.rpc("create_product", {
      p_org_id: orgAId,
      p_name: "Confidential Widget",
      p_sku: `T040-CONF-${timestamp}`,
      p_selling_price: 99.0,
      p_unit_of_measure: "piece",
      p_cost_price: confidentialCost,
    });
    if (resProd.error) throw new Error(`Failed to create product: ${resProd.error.message}`);
    productAId = (resProd.data as any).data.id;

    // 6. Record Stock Movement to create stock_movements and stock_movement_costs row
    const resMove = await ownerAClient.rpc("execute_stock_movement", {
      p_org_id: orgAId,
      p_product_id: productAId,
      p_movement_type: "restock",
      p_quantity: 100,
      p_reason: "Primary acquisition shipment",
    });
    if (resMove.error) throw new Error(`Failed to execute restock: ${resMove.error.message}`);
    movementId = (resMove.data as any).movement_id;

    // Verify row exists via superuser
    const checkCost = await pgClient.query(
      `SELECT * FROM public.stock_movement_costs WHERE movement_id = $1;`,
      [movementId]
    );
    if (checkCost.rows.length === 0) {
      throw new Error("stock_movement_costs row was not generated!");
    }
  });

  afterAll(async () => {
    // Ensure role_permissions are restored to standard baseline
    try {
      await pgClient.query(
        `INSERT INTO public.role_permissions (role, permission_id)
         VALUES 
           ('manager', 'products:read_cost'),
           ('manager', 'inventory:read_valuation')
         ON CONFLICT (role, permission_id) DO NOTHING;`
      );
    } catch (_) {}

    try {
      if (orgAId || orgBId) {
        await pgClient.query(`DELETE FROM public.zero_delta_stocktakes WHERE organization_id IN ($1, $2)`, [orgAId, orgBId]);
        await pgClient.query(`DELETE FROM public.stock_movement_costs WHERE organization_id IN ($1, $2)`, [orgAId, orgBId]);
        await pgClient.query(`DELETE FROM public.stock_movements WHERE organization_id IN ($1, $2)`, [orgAId, orgBId]);
        await pgClient.query(`DELETE FROM public.inventory WHERE organization_id IN ($1, $2)`, [orgAId, orgBId]);
        await pgClient.query(`DELETE FROM public.product_costs WHERE organization_id IN ($1, $2)`, [orgAId, orgBId]);
        await pgClient.query(`DELETE FROM public.products WHERE organization_id IN ($1, $2)`, [orgAId, orgBId]);
        await pgClient.query(`DELETE FROM public.organization_memberships WHERE organization_id IN ($1, $2)`, [orgAId, orgBId]);
        await pgClient.query(`DELETE FROM public.organizations WHERE id IN ($1, $2)`, [orgAId, orgBId]);
      }
    } catch (_) {}

    try {
      if (ownerAUserId) await adminClient.auth.admin.deleteUser(ownerAUserId);
      if (managerAUserId) await adminClient.auth.admin.deleteUser(managerAUserId);
      if (cashierAUserId) await adminClient.auth.admin.deleteUser(cashierAUserId);
      if (ownerBUserId) await adminClient.auth.admin.deleteUser(ownerBUserId);
    } catch (_) {}

    await pgClient.end();
  });

  // 1. Cashier session returns 0 rows
  it("Scenario 1: Cashier session queries stock_movement_costs via RLS and receives 0 rows", async () => {
    const { data, error } = await cashierAClient
      .from("stock_movement_costs")
      .select("*")
      .eq("organization_id", orgAId);

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data!.length).toBe(0);
  });

  // 2. Manager with BOTH permissions returns full snapshot row
  it("Scenario 2: Manager holding BOTH inventory:read_valuation AND products:read_cost receives full cost snapshot", async () => {
    const { data, error } = await managerAClient
      .from("stock_movement_costs")
      .select("*")
      .eq("organization_id", orgAId);

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data!.length).toBe(1);
    expect(data![0].movement_id).toBe(movementId);
    expect(Number(data![0].unit_cost)).toBe(confidentialCost);
    expect(data![0].currency).toBe("USD");
  });

  // 3. Manager missing either permission returns 0 rows
  it("Scenario 3: Manager missing either permission (inventory:read_valuation OR products:read_cost) receives 0 rows", async () => {
    // 3a. Revoke products:read_cost from manager
    await pgClient.query(
      `DELETE FROM public.role_permissions WHERE role = 'manager' AND permission_id = 'products:read_cost';`
    );

    const { data: dataNoCostPerm, error: errNoCostPerm } = await managerAClient
      .from("stock_movement_costs")
      .select("*")
      .eq("organization_id", orgAId);

    expect(errNoCostPerm).toBeNull();
    expect(dataNoCostPerm).toBeDefined();
    expect(dataNoCostPerm!.length).toBe(0);

    // Restore products:read_cost and revoke inventory:read_valuation
    await pgClient.query(
      `INSERT INTO public.role_permissions (role, permission_id) VALUES ('manager', 'products:read_cost');`
    );
    await pgClient.query(
      `DELETE FROM public.role_permissions WHERE role = 'manager' AND permission_id = 'inventory:read_valuation';`
    );

    // 3b. Query with products:read_cost ONLY
    const { data: dataNoValPerm, error: errNoValPerm } = await managerAClient
      .from("stock_movement_costs")
      .select("*")
      .eq("organization_id", orgAId);

    expect(errNoValPerm).toBeNull();
    expect(dataNoValPerm).toBeDefined();
    expect(dataNoValPerm!.length).toBe(0);

    // Restore inventory:read_valuation
    await pgClient.query(
      `INSERT INTO public.role_permissions (role, permission_id) VALUES ('manager', 'inventory:read_valuation');`
    );

    // Verify access restored
    const { data: dataRestored } = await managerAClient
      .from("stock_movement_costs")
      .select("*")
      .eq("organization_id", orgAId);
    expect(dataRestored!.length).toBe(1);
  });

  // 4. Cross-tenant access denial
  it("Scenario 4: User from Org B cannot read Org A stock_movement_costs via RLS (cross-tenant denial)", async () => {
    const { data, error } = await ownerBClient
      .from("stock_movement_costs")
      .select("*")
      .eq("organization_id", orgAId);

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data!.length).toBe(0);
  });

  // 5. Direct client mutation denial
  it("Scenario 5: Direct client mutations (INSERT, UPDATE, DELETE) on stock_movement_costs are rejected by RLS", async () => {
    // 5a. Direct INSERT attempt
    const { error: insertErr } = await managerAClient
      .from("stock_movement_costs")
      .insert({
        movement_id: movementId,
        organization_id: orgAId,
        unit_cost: 99.99,
        currency: "USD",
      });

    expect(insertErr).toBeDefined();
    expect(insertErr?.message).toMatch(/violates row-level security|denied|permission/i);

    // 5b. Direct UPDATE attempt
    const { data: updateData, error: updateErr } = await managerAClient
      .from("stock_movement_costs")
      .update({ unit_cost: 1.0 })
      .eq("movement_id", movementId)
      .select();

    // With USING (false) WITH CHECK (false), either updateErr is thrown or 0 rows are returned
    if (!updateErr) {
      expect(updateData?.length).toBe(0);
    } else {
      expect(updateErr.message).toMatch(/violates row-level security|denied|permission/i);
    }

    // 5c. Direct DELETE attempt
    const { data: deleteData, error: deleteErr } = await managerAClient
      .from("stock_movement_costs")
      .delete()
      .eq("movement_id", movementId)
      .select();

    if (!deleteErr) {
      expect(deleteData?.length).toBe(0);
    } else {
      expect(deleteErr.message).toMatch(/violates row-level security|denied|permission/i);
    }

    // Verify row still exists untouched in DB with original cost
    const checkPost = await pgClient.query(
      `SELECT unit_cost FROM public.stock_movement_costs WHERE movement_id = $1;`,
      [movementId]
    );
    expect(Number(checkPost.rows[0].unit_cost)).toBe(confidentialCost);
  });
});
