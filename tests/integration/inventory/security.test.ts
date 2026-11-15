import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { randomUUID } from "node:crypto";

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

describe("T047: Integration Tests — Inventory Security, RLS & Database Privilege Hardening", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;
  let anonClient: SupabaseClient;

  let ownerAClient: SupabaseClient;
  let ownerBClient: SupabaseClient;
  let inactiveUserClient: SupabaseClient;
  let cashierAClient: SupabaseClient;

  let ownerAUserId: string;
  let ownerBUserId: string;
  let inactiveUserId: string;
  let cashierAUserId: string;

  const testPassword = "P@ssword123!T047Security";
  const timestamp = Date.now();

  let orgAId: string;
  let orgBId: string;
  const orgASlug = `t047-orga-${timestamp}`;
  const orgBSlug = `t047-orgb-${timestamp}`;

  let productAId: string;
  let productBId: string;

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    anonClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
    });

    // 1. Create Test Users
    const emailOwnerA = `t047_ownera_${timestamp}@bizflow-test.internal`;
    const emailOwnerB = `t047_ownerb_${timestamp}@bizflow-test.internal`;
    const emailInactive = `t047_inactive_${timestamp}@bizflow-test.internal`;
    const emailCashierA = `t047_cashiera_${timestamp}@bizflow-test.internal`;

    const { data: uOwnerA } = await adminClient.auth.admin.createUser({
      email: emailOwnerA,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Owner", last_name: "A" },
    });
    ownerAUserId = uOwnerA.user!.id;

    const { data: uOwnerB } = await adminClient.auth.admin.createUser({
      email: emailOwnerB,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Owner", last_name: "B" },
    });
    ownerBUserId = uOwnerB.user!.id;

    const { data: uInactive } = await adminClient.auth.admin.createUser({
      email: emailInactive,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Inactive", last_name: "Member" },
    });
    inactiveUserId = uInactive.user!.id;

    const { data: uCashierA } = await adminClient.auth.admin.createUser({
      email: emailCashierA,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Cashier", last_name: "A" },
    });
    cashierAUserId = uCashierA.user!.id;

    // 2. Authenticate User Clients
    ownerAClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await ownerAClient.auth.signInWithPassword({ email: emailOwnerA, password: testPassword });

    ownerBClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await ownerBClient.auth.signInWithPassword({ email: emailOwnerB, password: testPassword });

    inactiveUserClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await inactiveUserClient.auth.signInWithPassword({ email: emailInactive, password: testPassword });

    cashierAClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await cashierAClient.auth.signInWithPassword({ email: emailCashierA, password: testPassword });

    // 3. Create Organizations
    const resOrgA = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
       VALUES ('T047 Org A', $1, 'USD', 'retail', 'US', 'America/New_York', $2)
       RETURNING id;`,
      [orgASlug, ownerAUserId]
    );
    orgAId = resOrgA.rows[0].id;

    const resOrgB = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
       VALUES ('T047 Org B', $1, 'USD', 'retail', 'US', 'America/New_York', $2)
       RETURNING id;`,
      [orgBSlug, ownerBUserId]
    );
    orgBId = resOrgB.rows[0].id;

    // 4. Create Memberships
    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES 
         ($1, $2, 'owner', 'active'),
         ($1, $3, 'manager', 'suspended'),
         ($1, $4, 'cashier', 'active'),
         ($5, $6, 'owner', 'active');`,
      [orgAId, ownerAUserId, inactiveUserId, cashierAUserId, orgBId, ownerBUserId]
    );

    // 5. Seed Product A in Org A
    const resProdA = await ownerAClient.rpc("create_product", {
      p_org_id: orgAId,
      p_name: "Security Product A",
      p_sku: `T047-PROD-A-${timestamp}`,
      p_selling_price: 50.0,
      p_unit_of_measure: "piece",
      p_cost_price: 25.0,
    });
    if (resProdA.error) throw new Error(`Failed to create product A: ${resProdA.error.message}`);
    productAId = (resProdA.data as any).data.id;

    // Initial stock for Product A: 50 units (version becomes 2)
    const resStockA = await ownerAClient.rpc("execute_stock_movement", {
      p_org_id: orgAId,
      p_product_id: productAId,
      p_movement_type: "initial",
      p_quantity: 50,
      p_reason: "Initial warehouse stock load Org A",
    });
    if (resStockA.error) throw new Error(`Failed initial stock Product A: ${resStockA.error.message}`);

    // 6. Seed Product B in Org B
    const resProdB = await ownerBClient.rpc("create_product", {
      p_org_id: orgBId,
      p_name: "Security Product B",
      p_sku: `T047-PROD-B-${timestamp}`,
      p_selling_price: 80.0,
      p_unit_of_measure: "piece",
      p_cost_price: 40.0,
    });
    if (resProdB.error) throw new Error(`Failed to create product B: ${resProdB.error.message}`);
    productBId = (resProdB.data as any).data.id;

    // Initial stock for Product B: 100 units (version becomes 2)
    const resStockB = await ownerBClient.rpc("execute_stock_movement", {
      p_org_id: orgBId,
      p_product_id: productBId,
      p_movement_type: "initial",
      p_quantity: 100,
      p_reason: "Initial warehouse stock load Org B",
    });
    if (resStockB.error) throw new Error(`Failed initial stock Product B: ${resStockB.error.message}`);
  });

  afterAll(async () => {
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
      if (ownerBUserId) await adminClient.auth.admin.deleteUser(ownerBUserId);
      if (inactiveUserId) await adminClient.auth.admin.deleteUser(inactiveUserId);
      if (cashierAUserId) await adminClient.auth.admin.deleteUser(cashierAUserId);
    } catch (_) {}

    await pgClient.end();
  });

  // ==========================================================================
  // SCENARIO 1: Cross-Organization Isolation
  // ==========================================================================
  describe("Scenario 1 — Cross-organization isolation", () => {
    it("1.1 Org A cannot read Org B inventory records through RLS", async () => {
      // User A queries inventory specifically for Org B -> returns 0 rows via RLS
      const { data: dataBQuery, error: errBQuery } = await ownerAClient
        .from("inventory")
        .select("*")
        .eq("organization_id", orgBId);

      expect(errBQuery).toBeNull();
      expect(dataBQuery).toBeDefined();
      expect(dataBQuery!.length).toBe(0);

      // User A queries all visible inventory -> returns only Org A rows, 0 rows from Org B
      const { data: dataAllQuery, error: errAllQuery } = await ownerAClient
        .from("inventory")
        .select("*");

      expect(errAllQuery).toBeNull();
      expect(dataAllQuery).toBeDefined();
      expect(dataAllQuery!.length).toBeGreaterThan(0);
      expect(dataAllQuery!.every((row) => row.organization_id === orgAId)).toBe(true);
      expect(dataAllQuery!.some((row) => row.organization_id === orgBId)).toBe(false);

      // User B queries inventory for Org A -> returns 0 rows via RLS
      const { data: dataAQueryByB, error: errAQueryByB } = await ownerBClient
        .from("inventory")
        .select("*")
        .eq("organization_id", orgAId);

      expect(errAQueryByB).toBeNull();
      expect(dataAQueryByB).toBeDefined();
      expect(dataAQueryByB!.length).toBe(0);

      // Legitimate access: User A reads Org A inventory (quantity = 50)
      const { data: legA } = await ownerAClient
        .from("inventory")
        .select("*")
        .eq("organization_id", orgAId)
        .eq("product_id", productAId);
      expect(legA!.length).toBe(1);
      expect(Number(legA![0].quantity)).toBe(50);

      // Legitimate access: User B reads Org B inventory (quantity = 100)
      const { data: legB } = await ownerBClient
        .from("inventory")
        .select("*")
        .eq("organization_id", orgBId)
        .eq("product_id", productBId);
      expect(legB!.length).toBe(1);
      expect(Number(legB![0].quantity)).toBe(100);
    });

    it("1.2 Org A cannot mutate Org B inventory records directly or via RPC", async () => {
      // Direct UPDATE attempt on Org B inventory by User A is blocked by RLS
      const { data: updateData, error: updateErr } = await ownerAClient
        .from("inventory")
        .update({ quantity: 999 })
        .eq("organization_id", orgBId)
        .eq("product_id", productBId)
        .select();

      if (!updateErr) {
        expect(updateData?.length).toBe(0);
      } else {
        expect(updateErr.message).toMatch(/violates row-level security|denied|permission/i);
      }

      // RPC mutation attempt: User A calls execute_stock_movement on Org B product
      const resRpc = await ownerAClient.rpc("execute_stock_movement", {
        p_org_id: orgBId,
        p_product_id: productBId,
        p_movement_type: "restock",
        p_quantity: 25,
        p_reason: "Cross-tenant unauthorized restock attack",
      });

      expect(resRpc.error).toBeDefined();
      expect(resRpc.error?.code).toBe("P0002"); // MEMBERSHIP_INACTIVE (not a member of Org B)
      expect(resRpc.error?.message).toContain("MEMBERSHIP_INACTIVE");

      // RPC threshold update attempt: User A calls update_inventory_thresholds on Org B
      const resThreshold = await ownerAClient.rpc("update_inventory_thresholds", {
        p_org_id: orgBId,
        p_product_id: productBId,
        p_reorder_point: 20,
        p_reorder_quantity: 40,
      });

      expect(resThreshold.error).toBeDefined();
      expect(resThreshold.error?.code).toBe("P0002");

      // Verify Org B inventory database state remains completely unchanged
      const checkB = await pgClient.query(
        `SELECT quantity, version, reorder_point, reorder_quantity 
         FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
        [orgBId, productBId]
      );
      expect(Number(checkB.rows[0].quantity)).toBe(100);
      expect(checkB.rows[0].version).toBe(2);
      expect(checkB.rows[0].reorder_point).toBeNull();

      const moveCountB = await pgClient.query(
        `SELECT count(*)::int AS count FROM public.stock_movements WHERE organization_id = $1 AND product_id = $2;`,
        [orgBId, productBId]
      );
      expect(moveCountB.rows[0].count).toBe(1); // Only the initial opening balance
    });
  });

  // ==========================================================================
  // SCENARIO 2: Inactive/Revoked Membership
  // ==========================================================================
  describe("Scenario 2 — Inactive/revoked membership", () => {
    it("rejects execute_stock_movement and update_inventory_thresholds for non-active membership with P0002", async () => {
      // User with 'suspended' status attempts restock in Org A
      const resRestock = await inactiveUserClient.rpc("execute_stock_movement", {
        p_org_id: orgAId,
        p_product_id: productAId,
        p_movement_type: "restock",
        p_quantity: 20,
        p_reason: "Restock attempt by suspended employee",
      });

      expect(resRestock.error).toBeDefined();
      expect(resRestock.error?.code).toBe("P0002");
      expect(resRestock.error?.message).toContain("MEMBERSHIP_INACTIVE");

      // Suspended user attempts threshold update in Org A
      const resThreshold = await inactiveUserClient.rpc("update_inventory_thresholds", {
        p_org_id: orgAId,
        p_product_id: productAId,
        p_reorder_point: 10,
        p_reorder_quantity: 20,
      });

      expect(resThreshold.error).toBeDefined();
      expect(resThreshold.error?.code).toBe("P0002");
      expect(resThreshold.error?.message).toContain("MEMBERSHIP_INACTIVE");

      // Verify Org A inventory quantity, version, thresholds, and movement history remain untouched
      const invCheck = await pgClient.query(
        `SELECT quantity, version, reorder_point FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
        [orgAId, productAId]
      );
      expect(Number(invCheck.rows[0].quantity)).toBe(50);
      expect(invCheck.rows[0].version).toBe(2);
      expect(invCheck.rows[0].reorder_point).toBeNull();

      const movCheck = await pgClient.query(
        `SELECT count(*)::int AS count FROM public.stock_movements WHERE organization_id = $1 AND product_id = $2;`,
        [orgAId, productAId]
      );
      expect(movCheck.rows[0].count).toBe(1);
    });
  });

  // ==========================================================================
  // SCENARIO 3: Missing inventory:receive
  // ==========================================================================
  describe("Scenario 3 — Missing inventory:receive", () => {
    it("rejects restock and initial movement types for role lacking inventory:receive (Cashier) with 42501", async () => {
      // Cashier role in Org A lacks inventory:receive
      const resRestock = await cashierAClient.rpc("execute_stock_movement", {
        p_org_id: orgAId,
        p_product_id: productAId,
        p_movement_type: "restock",
        p_quantity: 15,
        p_reason: "Unauthorized restock attempt by cashier",
      });

      expect(resRestock.error).toBeDefined();
      expect(resRestock.error?.code).toBe("42501");
      expect(resRestock.error?.message).toContain("INSUFFICIENT_PERMISSIONS");

      // Cashier attempts initial opening stock (also requires inventory:receive)
      const resInitial = await cashierAClient.rpc("execute_stock_movement", {
        p_org_id: orgAId,
        p_product_id: productAId,
        p_movement_type: "initial",
        p_quantity: 10,
        p_reason: "Unauthorized initial stock attempt by cashier",
      });

      expect(resInitial.error).toBeDefined();
      expect(resInitial.error?.code).toBe("42501");
      expect(resInitial.error?.message).toContain("INSUFFICIENT_PERMISSIONS");

      // Verify Org A inventory balance and movement history remain unchanged
      const invCheck = await pgClient.query(
        `SELECT quantity, version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
        [orgAId, productAId]
      );
      expect(Number(invCheck.rows[0].quantity)).toBe(50);
      expect(invCheck.rows[0].version).toBe(2);

      const movCheck = await pgClient.query(
        `SELECT count(*)::int AS count FROM public.stock_movements WHERE organization_id = $1 AND product_id = $2;`,
        [orgAId, productAId]
      );
      expect(movCheck.rows[0].count).toBe(1);
    });
  });

  // ==========================================================================
  // SCENARIO 4: Missing inventory:adjust
  // ==========================================================================
  describe("Scenario 4 — Missing inventory:adjust", () => {
    it("rejects adjustment, damage, loss, internal_use, and threshold updates for role lacking inventory:adjust with 42501", async () => {
      // 4a. Adjustment
      const resAdjust = await cashierAClient.rpc("execute_stock_movement", {
        p_org_id: orgAId,
        p_product_id: productAId,
        p_movement_type: "adjustment",
        p_quantity: -5,
        p_quantity_semantics: "quantity_delta",
        p_reason: "Unauthorized adjustment by cashier",
      });
      expect(resAdjust.error).toBeDefined();
      expect(resAdjust.error?.code).toBe("42501");
      expect(resAdjust.error?.message).toContain("INSUFFICIENT_PERMISSIONS");

      // 4b. Damage write-off
      const resDamage = await cashierAClient.rpc("execute_stock_movement", {
        p_org_id: orgAId,
        p_product_id: productAId,
        p_movement_type: "damage",
        p_quantity: -5,
        p_reason: "Unauthorized damage write-off by cashier",
      });
      expect(resDamage.error).toBeDefined();
      expect(resDamage.error?.code).toBe("42501");
      expect(resDamage.error?.message).toContain("INSUFFICIENT_PERMISSIONS");

      // 4c. Loss write-off
      const resLoss = await cashierAClient.rpc("execute_stock_movement", {
        p_org_id: orgAId,
        p_product_id: productAId,
        p_movement_type: "loss",
        p_quantity: -2,
        p_reason: "Unauthorized loss write-off by cashier",
      });
      expect(resLoss.error).toBeDefined();
      expect(resLoss.error?.code).toBe("42501");
      expect(resLoss.error?.message).toContain("INSUFFICIENT_PERMISSIONS");

      // 4d. Internal use write-off
      const resInternal = await cashierAClient.rpc("execute_stock_movement", {
        p_org_id: orgAId,
        p_product_id: productAId,
        p_movement_type: "internal_use",
        p_quantity: -1,
        p_reason: "Unauthorized internal use by cashier",
      });
      expect(resInternal.error).toBeDefined();
      expect(resInternal.error?.code).toBe("42501");
      expect(resInternal.error?.message).toContain("INSUFFICIENT_PERMISSIONS");

      // 4e. Reorder Threshold update (requires inventory:adjust)
      const resThreshold = await cashierAClient.rpc("update_inventory_thresholds", {
        p_org_id: orgAId,
        p_product_id: productAId,
        p_reorder_point: 10,
        p_reorder_quantity: 20,
      });
      expect(resThreshold.error).toBeDefined();
      expect(resThreshold.error?.code).toBe("42501");
      expect(resThreshold.error?.message).toContain("INSUFFICIENT_PERMISSIONS");

      // Verify Org A inventory balance, version, and movement history remain completely unchanged
      const invCheck = await pgClient.query(
        `SELECT quantity, version, reorder_point FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
        [orgAId, productAId]
      );
      expect(Number(invCheck.rows[0].quantity)).toBe(50);
      expect(invCheck.rows[0].version).toBe(2);
      expect(invCheck.rows[0].reorder_point).toBeNull();

      const movCheck = await pgClient.query(
        `SELECT count(*)::int AS count FROM public.stock_movements WHERE organization_id = $1 AND product_id = $2;`,
        [orgAId, productAId]
      );
      expect(movCheck.rows[0].count).toBe(1);
    });
  });

  // ==========================================================================
  // SCENARIO 5: Direct Layer 1 Execution Denial
  // ==========================================================================
  describe("Scenario 5 — Direct Layer 1 execution denial for _execute_inventory_mutation_core", () => {
    const layer1Signature =
      "p_org_id uuid, p_product_id uuid, p_movement_type text, p_quantity_delta numeric, p_reason text, p_reference_id text, p_idempotency_key uuid, p_idempotency_payload_hash text, p_created_by uuid, p_expected_version integer";

    it("verifies pg_proc ACL: PUBLIC (OID 0), anon, and authenticated have NO EXECUTE; owner retains EXECUTE", async () => {
      const res = await pgClient.query(`
        SELECT 
          p.proname,
          pg_get_function_identity_arguments(p.oid) AS identity_arguments,
          p.proowner::regrole::text AS owner,
          COALESCE(r.rolname, 'PUBLIC') AS grantee_name,
          a.grantee,
          a.privilege_type
        FROM pg_proc p
        CROSS JOIN LATERAL aclexplode(p.proacl) a
        LEFT JOIN pg_roles r ON r.oid = a.grantee
        WHERE p.proname = '_execute_inventory_mutation_core';
      `);

      expect(res.rows.length).toBeGreaterThan(0);

      // Verify exact signature match
      expect(res.rows[0].identity_arguments).toBe(layer1Signature);
      expect(res.rows[0].owner).toBe("postgres");

      // 1. PUBLIC pseudo-role (grantee OID 0) holds NO EXECUTE privilege
      const hasPublicExecute = res.rows.some((r) => r.grantee === 0);
      expect(hasPublicExecute).toBe(false);

      // 2. Role 'anon' holds NO EXECUTE privilege
      const hasAnonExecute = res.rows.some((r) => r.grantee_name === "anon");
      expect(hasAnonExecute).toBe(false);

      // 3. Role 'authenticated' holds NO EXECUTE privilege
      const hasAuthExecute = res.rows.some((r) => r.grantee_name === "authenticated");
      expect(hasAuthExecute).toBe(false);

      // 4. Role 'service_role' holds NO EXECUTE privilege
      const hasServiceRoleExecute = res.rows.some((r) => r.grantee_name === "service_role");
      expect(hasServiceRoleExecute).toBe(false);

      // 5. Function owner ('postgres') retains EXECUTE privilege
      const hasOwnerExecute = res.rows.some(
        (r) => r.grantee_name === "postgres" && r.privilege_type === "EXECUTE"
      );
      expect(hasOwnerExecute).toBe(true);
    });

    it("verifies direct execution denial at SQL runtime for anon, authenticated, and service_role roles", async () => {
      // 5a. Direct execution attempt as role 'anon' throws 42501 permission denied
      let anonSqlError: any = null;
      try {
        await pgClient.query(`
          SET ROLE anon;
          SELECT public._execute_inventory_mutation_core(
            '${orgAId}'::uuid,
            '${productAId}'::uuid,
            'restock',
            10.0000,
            'Direct bypass attempt anon',
            NULL,
            '${randomUUID()}'::uuid,
            'testhash',
            '${ownerAUserId}'::uuid,
            2
          );
        `);
      } catch (err) {
        anonSqlError = err;
      } finally {
        await pgClient.query("RESET ROLE;");
      }

      expect(anonSqlError).toBeDefined();
      expect(anonSqlError.code).toBe("42501");
      expect(anonSqlError.message).toMatch(/permission denied for function _execute_inventory_mutation_core/i);

      // 5b. Direct execution attempt as role 'authenticated' throws 42501 permission denied
      let authSqlError: any = null;
      try {
        await pgClient.query(`
          SET ROLE authenticated;
          SELECT public._execute_inventory_mutation_core(
            '${orgAId}'::uuid,
            '${productAId}'::uuid,
            'restock',
            10.0000,
            'Direct bypass attempt authenticated',
            NULL,
            '${randomUUID()}'::uuid,
            'testhash',
            '${ownerAUserId}'::uuid,
            2
          );
        `);
      } catch (err) {
        authSqlError = err;
      } finally {
        await pgClient.query("RESET ROLE;");
      }

      expect(authSqlError).toBeDefined();
      expect(authSqlError.code).toBe("42501");
      expect(authSqlError.message).toMatch(/permission denied for function _execute_inventory_mutation_core/i);

      // 5c. Direct execution attempt as role 'service_role' throws 42501 permission denied
      let serviceRoleSqlError: any = null;
      try {
        await pgClient.query(`
          SET ROLE service_role;
          SELECT public._execute_inventory_mutation_core(
            '${orgAId}'::uuid,
            '${productAId}'::uuid,
            'restock',
            10.0000,
            'Direct bypass attempt service_role',
            NULL,
            '${randomUUID()}'::uuid,
            'testhash',
            '${ownerAUserId}'::uuid,
            2
          );
        `);
      } catch (err) {
        serviceRoleSqlError = err;
      } finally {
        await pgClient.query("RESET ROLE;");
      }

      expect(serviceRoleSqlError).toBeDefined();
      expect(serviceRoleSqlError.code).toBe("42501");
      expect(serviceRoleSqlError.message).toMatch(/permission denied for function _execute_inventory_mutation_core/i);

      // 5d. Direct invocation via Supabase clients (anon, authenticated, service_role) fails
      const anonRpcRes = await anonClient.rpc("_execute_inventory_mutation_core", {
        p_org_id: orgAId,
        p_product_id: productAId,
        p_movement_type: "restock",
        p_quantity_delta: 10,
        p_reason: "Direct bypass attempt",
        p_idempotency_key: randomUUID(),
        p_idempotency_payload_hash: "dummy",
        p_created_by: ownerAUserId,
        p_expected_version: 2,
      });
      expect(anonRpcRes.error).toBeDefined();

      const authRpcRes = await ownerAClient.rpc("_execute_inventory_mutation_core", {
        p_org_id: orgAId,
        p_product_id: productAId,
        p_movement_type: "restock",
        p_quantity_delta: 10,
        p_reason: "Direct bypass attempt",
        p_idempotency_key: randomUUID(),
        p_idempotency_payload_hash: "dummy",
        p_created_by: ownerAUserId,
        p_expected_version: 2,
      });
      expect(authRpcRes.error).toBeDefined();

      const adminRpcRes = await adminClient.rpc("_execute_inventory_mutation_core", {
        p_org_id: orgAId,
        p_product_id: productAId,
        p_movement_type: "restock",
        p_quantity_delta: 10,
        p_reason: "Direct bypass attempt",
        p_idempotency_key: randomUUID(),
        p_idempotency_payload_hash: "dummy",
        p_created_by: ownerAUserId,
        p_expected_version: 2,
      });
      expect(adminRpcRes.error).toBeDefined();

      // Verify database inventory and movement history remain untouched
      const invCheck = await pgClient.query(
        `SELECT quantity, version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
        [orgAId, productAId]
      );
      expect(Number(invCheck.rows[0].quantity)).toBe(50);
      expect(invCheck.rows[0].version).toBe(2);
    });
  });

  // ==========================================================================
  // SCENARIO 6: Exact-Signature GRANT/REVOKE Verification
  // ==========================================================================
  describe("Scenario 6 — Exact-signature GRANT/REVOKE verification", () => {
    it("6.1 verifies execute_stock_movement GRANT/REVOKE: authenticated=EXECUTE, anon=denied, service_role=denied, PUBLIC=denied", async () => {
      const res = await pgClient.query(`
        SELECT 
          p.proname,
          pg_get_function_identity_arguments(p.oid) AS identity_arguments,
          COALESCE(r.rolname, 'PUBLIC') AS grantee_name,
          a.grantee,
          a.privilege_type
        FROM pg_proc p
        CROSS JOIN LATERAL aclexplode(p.proacl) a
        LEFT JOIN pg_roles r ON r.oid = a.grantee
        WHERE p.proname = 'execute_stock_movement';
      `);

      expect(res.rows.length).toBeGreaterThan(0);

      // authenticated has EXECUTE
      const hasAuth = res.rows.some(
        (r) => r.grantee_name === "authenticated" && r.privilege_type === "EXECUTE"
      );
      expect(hasAuth).toBe(true);

      // anon is denied (not present in ACL)
      const hasAnon = res.rows.some((r) => r.grantee_name === "anon");
      expect(hasAnon).toBe(false);

      // service_role is denied (not present in ACL)
      const hasServiceRole = res.rows.some((r) => r.grantee_name === "service_role");
      expect(hasServiceRole).toBe(false);

      // PUBLIC (grantee 0) is denied
      const hasPublic = res.rows.some((r) => r.grantee === 0);
      expect(hasPublic).toBe(false);

      // Runtime test: anon execution attempt in PostgreSQL throws 42501
      let anonErr: any = null;
      try {
        await pgClient.query(`
          SET ROLE anon;
          SELECT public.execute_stock_movement(
            '${orgAId}'::uuid,
            '${productAId}'::uuid,
            'restock',
            10.0000,
            'Anon execution test',
            NULL,
            '${randomUUID()}'::uuid,
            2,
            'quantity_delta'
          );
        `);
      } catch (err) {
        anonErr = err;
      } finally {
        await pgClient.query("RESET ROLE;");
      }

      expect(anonErr).toBeDefined();
      expect(anonErr.code).toBe("42501");
      expect(anonErr.message).toMatch(/permission denied for function execute_stock_movement/i);

      // Runtime test: service_role execution attempt in PostgreSQL throws 42501
      let serviceRoleErr: any = null;
      try {
        await pgClient.query(`
          SET ROLE service_role;
          SELECT public.execute_stock_movement(
            '${orgAId}'::uuid,
            '${productAId}'::uuid,
            'restock',
            10.0000,
            'Service role execution test',
            NULL,
            '${randomUUID()}'::uuid,
            2,
            'quantity_delta'
          );
        `);
      } catch (err) {
        serviceRoleErr = err;
      } finally {
        await pgClient.query("RESET ROLE;");
      }

      expect(serviceRoleErr).toBeDefined();
      expect(serviceRoleErr.code).toBe("42501");
      expect(serviceRoleErr.message).toMatch(/permission denied for function execute_stock_movement/i);

      // Runtime test: anonClient.rpc fails
      const rpcRes = await anonClient.rpc("execute_stock_movement", {
        p_org_id: orgAId,
        p_product_id: productAId,
        p_movement_type: "restock",
        p_quantity: 10,
        p_reason: "Anon RPC test",
      });
      expect(rpcRes.error).toBeDefined();

      // Runtime test: adminClient.rpc fails
      const adminRpcRes = await adminClient.rpc("execute_stock_movement", {
        p_org_id: orgAId,
        p_product_id: productAId,
        p_movement_type: "restock",
        p_quantity: 10,
        p_reason: "Admin RPC test",
      });
      expect(adminRpcRes.error).toBeDefined();
    });

    it("6.2 verifies update_inventory_thresholds GRANT/REVOKE: authenticated=EXECUTE, anon=denied, service_role=denied, PUBLIC=denied", async () => {
      const res = await pgClient.query(`
        SELECT 
          p.proname,
          pg_get_function_identity_arguments(p.oid) AS identity_arguments,
          COALESCE(r.rolname, 'PUBLIC') AS grantee_name,
          a.grantee,
          a.privilege_type
        FROM pg_proc p
        CROSS JOIN LATERAL aclexplode(p.proacl) a
        LEFT JOIN pg_roles r ON r.oid = a.grantee
        WHERE p.proname = 'update_inventory_thresholds';
      `);

      expect(res.rows.length).toBeGreaterThan(0);

      // authenticated has EXECUTE
      const hasAuth = res.rows.some(
        (r) => r.grantee_name === "authenticated" && r.privilege_type === "EXECUTE"
      );
      expect(hasAuth).toBe(true);

      // anon is denied (not present in ACL)
      const hasAnon = res.rows.some((r) => r.grantee_name === "anon");
      expect(hasAnon).toBe(false);

      // service_role is denied (not present in ACL)
      const hasServiceRole = res.rows.some((r) => r.grantee_name === "service_role");
      expect(hasServiceRole).toBe(false);

      // PUBLIC (grantee 0) is denied
      const hasPublic = res.rows.some((r) => r.grantee === 0);
      expect(hasPublic).toBe(false);

      // Runtime test: anon execution attempt in PostgreSQL throws 42501
      let anonErr: any = null;
      try {
        await pgClient.query(`
          SET ROLE anon;
          SELECT public.update_inventory_thresholds(
            '${orgAId}'::uuid,
            '${productAId}'::uuid,
            10.0000,
            20.0000,
            2
          );
        `);
      } catch (err) {
        anonErr = err;
      } finally {
        await pgClient.query("RESET ROLE;");
      }

      expect(anonErr).toBeDefined();
      expect(anonErr.code).toBe("42501");
      expect(anonErr.message).toMatch(/permission denied for function update_inventory_thresholds/i);

      // Runtime test: service_role execution attempt in PostgreSQL throws 42501
      let serviceRoleErr: any = null;
      try {
        await pgClient.query(`
          SET ROLE service_role;
          SELECT public.update_inventory_thresholds(
            '${orgAId}'::uuid,
            '${productAId}'::uuid,
            10.0000,
            20.0000,
            2
          );
        `);
      } catch (err) {
        serviceRoleErr = err;
      } finally {
        await pgClient.query("RESET ROLE;");
      }

      expect(serviceRoleErr).toBeDefined();
      expect(serviceRoleErr.code).toBe("42501");
      expect(serviceRoleErr.message).toMatch(/permission denied for function update_inventory_thresholds/i);

      // Runtime test: anonClient.rpc fails
      const rpcRes = await anonClient.rpc("update_inventory_thresholds", {
        p_org_id: orgAId,
        p_product_id: productAId,
        p_reorder_point: 10,
        p_reorder_quantity: 20,
      });
      expect(rpcRes.error).toBeDefined();

      // Runtime test: adminClient.rpc fails
      const adminRpcRes = await adminClient.rpc("update_inventory_thresholds", {
        p_org_id: orgAId,
        p_product_id: productAId,
        p_reorder_point: 10,
        p_reorder_quantity: 20,
      });
      expect(adminRpcRes.error).toBeDefined();
    });
  });
});
