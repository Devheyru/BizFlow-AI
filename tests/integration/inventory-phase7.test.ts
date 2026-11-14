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

describe("Feature 004 Phase 7 Database Integration: Adjustments, Stocktake & Thresholds (T026–T030)", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;
  let ownerClient: SupabaseClient;

  let ownerUserId: string;
  const testPassword = "P@ssword123!Phase7Live";

  let orgId: string;
  const orgSlug = `phase7-inv-${Date.now()}`;

  let productPieceId: string;
  let productKgId: string;
  let productInactiveId: string;
  let productArchivedId: string;

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const timestamp = Date.now();
    const ownerEmail = `phase7_owner_${timestamp}@bizflow-test.internal`;

    // 1. Create test user
    const { data: uOwner } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Phase7", last_name: "Lead" },
    });
    ownerUserId = uOwner.user!.id;

    // 2. Authenticate client
    ownerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

    // 3. Create Organization
    const resOrg = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
       VALUES ('Phase 7 Org', $1, 'USD', 'retail', 'US', 'America/New_York', $2)
       RETURNING id;`,
      [orgSlug, ownerUserId]
    );
    orgId = resOrg.rows[0].id;

    // 4. Create Owner Membership
    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active');`,
      [orgId, ownerUserId]
    );

    // 5. Create Test Products
    // A. Discrete Product (piece)
    const resPiece = await ownerClient.rpc("create_product", {
      p_org_id: orgId,
      p_name: "Phase 7 Discrete Widget",
      p_sku: `P7-PIECE-${Date.now()}`,
      p_selling_price: 20.0,
      p_unit_of_measure: "piece",
      p_cost_price: 8.0,
    });
    if (resPiece.error) throw new Error(`Failed to create discrete product: ${resPiece.error.message}`);
    productPieceId = (resPiece.data as any).data.id;

    // B. Continuous Product (kg)
    const resKg = await ownerClient.rpc("create_product", {
      p_org_id: orgId,
      p_name: "Phase 7 Bulk Grain",
      p_sku: `P7-KG-${Date.now()}`,
      p_selling_price: 10.0,
      p_unit_of_measure: "kg",
      p_cost_price: 4.0,
    });
    if (resKg.error) throw new Error(`Failed to create continuous product: ${resKg.error.message}`);
    productKgId = (resKg.data as any).data.id;

    // C. Inactive Product
    const resInactive = await ownerClient.rpc("create_product", {
      p_org_id: orgId,
      p_name: "Phase 7 Inactive Item",
      p_sku: `P7-INACT-${Date.now()}`,
      p_selling_price: 15.0,
      p_unit_of_measure: "piece",
      p_cost_price: 6.0,
    });
    if (resInactive.error) throw new Error(`Failed to create inactive product: ${resInactive.error.message}`);
    productInactiveId = (resInactive.data as any).data.id;
    await pgClient.query(
      `UPDATE public.products SET status = 'inactive' WHERE id = $1;`,
      [productInactiveId]
    );

    // D. Archived Product (created active, given initial stock, then archived)
    const resArchived = await ownerClient.rpc("create_product", {
      p_org_id: orgId,
      p_name: "Phase 7 Archived Item",
      p_sku: `P7-ARCH-${Date.now()}`,
      p_selling_price: 12.0,
      p_unit_of_measure: "piece",
      p_cost_price: 5.0,
    });
    if (resArchived.error) throw new Error(`Failed to create archived product: ${resArchived.error.message}`);
    productArchivedId = (resArchived.data as any).data.id;

    // Establish initial stock of 100 for piece product, 50 for kg product, 20 for inactive, 10 for archived
    await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: productPieceId,
      p_movement_type: "initial",
      p_quantity: 100,
      p_reason: "Initial baseline stock",
      p_idempotency_key: "00000000-0000-4000-8000-000000000101",
      p_quantity_semantics: "quantity_delta",
    });

    await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: productKgId,
      p_movement_type: "initial",
      p_quantity: 50.0,
      p_reason: "Initial baseline stock kg",
      p_idempotency_key: "00000000-0000-4000-8000-000000000102",
      p_quantity_semantics: "quantity_delta",
    });

    await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: productInactiveId,
      p_movement_type: "initial",
      p_quantity: 20,
      p_reason: "Initial stock inactive item",
      p_idempotency_key: "00000000-0000-4000-8000-000000000103",
      p_quantity_semantics: "quantity_delta",
    });

    await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: productArchivedId,
      p_movement_type: "initial",
      p_quantity: 10,
      p_reason: "Initial stock archived item",
      p_idempotency_key: "00000000-0000-4000-8000-000000000104",
      p_quantity_semantics: "quantity_delta",
    });

    // Now transition to archived status
    await pgClient.query(
      `UPDATE public.products SET status = 'archived', archived_at = now(), archived_by = $2 WHERE id = $1;`,
      [productArchivedId, ownerUserId]
    );
  });

  afterAll(async () => {
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
    } catch (_) {}

    await pgClient.end();
  });

  // ==========================================================================
  // 1. Controlled Adjustments (T026)
  // ==========================================================================
  describe("T026: Controlled Stock Adjustments & Write-Offs", () => {
    it("1.1 Positive manual adjustment increases stock and creates audit record", async () => {
      const res = await ownerClient.rpc("execute_stock_movement", {
        p_org_id: orgId,
        p_product_id: productPieceId,
        p_movement_type: "adjustment",
        p_quantity: 15,
        p_reason: "Found extra box in storage rack B",
        p_reference_id: "ADJ-FIND-01",
        p_idempotency_key: "00000000-0000-4000-8000-000000000201",
        p_quantity_semantics: "quantity_delta",
      });

      expect(res.error).toBeNull();
      const data = res.data as any;
      expect(data.success).toBe(true);
      expect(parseFloat(data.quantity_before)).toBe(100);
      expect(parseFloat(data.quantity_delta)).toBe(15);
      expect(parseFloat(data.quantity_after)).toBe(115);

      // Verify DB inventory table
      const inv = await pgClient.query(
        `SELECT quantity, version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
        [orgId, productPieceId]
      );
      expect(parseFloat(inv.rows[0].quantity)).toBe(115);
    });

    it("1.2 Write-off operations (damage, loss, internal_use) deduct stock with negative deltas", async () => {
      // Damage: -5
      const damageRes = await ownerClient.rpc("execute_stock_movement", {
        p_org_id: orgId,
        p_product_id: productPieceId,
        p_movement_type: "damage",
        p_quantity: -5,
        p_reason: "Water damage from leaky pipe",
        p_idempotency_key: "00000000-0000-4000-8000-000000000202",
        p_quantity_semantics: "quantity_delta",
      });
      expect(damageRes.error).toBeNull();
      expect(parseFloat((damageRes.data as any).quantity_after)).toBe(110);

      // Loss: -3
      const lossRes = await ownerClient.rpc("execute_stock_movement", {
        p_org_id: orgId,
        p_product_id: productPieceId,
        p_movement_type: "loss",
        p_quantity: -3,
        p_reason: "Inventory shrinkage during audit",
        p_idempotency_key: "00000000-0000-4000-8000-000000000203",
        p_quantity_semantics: "quantity_delta",
      });
      expect(lossRes.error).toBeNull();
      expect(parseFloat((lossRes.data as any).quantity_after)).toBe(107);

      // Internal Use: -2
      const internalRes = await ownerClient.rpc("execute_stock_movement", {
        p_org_id: orgId,
        p_product_id: productPieceId,
        p_movement_type: "internal_use",
        p_quantity: -2,
        p_reason: "Store display floor demo",
        p_idempotency_key: "00000000-0000-4000-8000-000000000204",
        p_quantity_semantics: "quantity_delta",
      });
      expect(internalRes.error).toBeNull();
      expect(parseFloat((internalRes.data as any).quantity_after)).toBe(105);
    });

    it("1.3 Overdraft guard: rejects deduction exceeding current stock with INSUFFICIENT_STOCK", async () => {
      const overdraftRes = await ownerClient.rpc("execute_stock_movement", {
        p_org_id: orgId,
        p_product_id: productPieceId,
        p_movement_type: "damage",
        p_quantity: -200, // Stock is 105, deduction 200 would result in -95
        p_reason: "Catastrophic write-off attempt exceeding stock",
        p_idempotency_key: "00000000-0000-4000-8000-000000000205",
        p_quantity_semantics: "quantity_delta",
      });

      expect(overdraftRes.error).not.toBeNull();
      expect(overdraftRes.error?.code).toBe("P0011");
      expect(overdraftRes.error?.message).toMatch(/INSUFFICIENT_STOCK/i);
    });

    it("1.4 Rejects fractional quantity for discrete product (piece) with INTEGER_QUANTITY_REQUIRED (P0015)", async () => {
      const fracRes = await ownerClient.rpc("execute_stock_movement", {
        p_org_id: orgId,
        p_product_id: productPieceId,
        p_movement_type: "adjustment",
        p_quantity: 2.5,
        p_reason: "Fractional adjustment attempt on piece item",
        p_idempotency_key: "00000000-0000-4000-8000-000000000206",
        p_quantity_semantics: "quantity_delta",
      });

      expect(fracRes.error).not.toBeNull();
      expect(fracRes.error?.code).toBe("P0015");
      expect(fracRes.error?.message).toMatch(/INTEGER_QUANTITY_REQUIRED/i);
    });

    it("1.5 Blocks internal_use on inactive product with PRODUCT_INACTIVE_INTERNAL_USE_BLOCKED (P0023)", async () => {
      const inactRes = await ownerClient.rpc("execute_stock_movement", {
        p_org_id: orgId,
        p_product_id: productInactiveId,
        p_movement_type: "internal_use",
        p_quantity: -1,
        p_reason: "Internal use on inactive item",
        p_idempotency_key: "00000000-0000-4000-8000-000000000207",
        p_quantity_semantics: "quantity_delta",
      });

      expect(inactRes.error).not.toBeNull();
      expect(inactRes.error?.code).toBe("P0023");
      expect(inactRes.error?.message).toMatch(/PRODUCT_INACTIVE_INTERNAL_USE_BLOCKED/i);
    });

    it("1.6 Blocks positive adjustment on archived product with PRODUCT_ARCHIVED_STOCK_FORBIDDEN (P0021)", async () => {
      const archRes = await ownerClient.rpc("execute_stock_movement", {
        p_org_id: orgId,
        p_product_id: productArchivedId,
        p_movement_type: "adjustment",
        p_quantity: 5,
        p_reason: "Restock attempt on archived item",
        p_idempotency_key: "00000000-0000-4000-8000-000000000208",
        p_quantity_semantics: "quantity_delta",
      });

      expect(archRes.error).not.toBeNull();
      expect(archRes.error?.code).toBe("P0021");
      expect(archRes.error?.message).toMatch(/PRODUCT_ARCHIVED_STOCK_FORBIDDEN/i);
    });

    it("1.7 Permits write-off (damage) on archived product", async () => {
      const archWriteOff = await ownerClient.rpc("execute_stock_movement", {
        p_org_id: orgId,
        p_product_id: productArchivedId,
        p_movement_type: "damage",
        p_quantity: -2,
        p_reason: "Writing off damaged archived goods",
        p_idempotency_key: "00000000-0000-4000-8000-000000000209",
        p_quantity_semantics: "quantity_delta",
      });

      expect(archWriteOff.error).toBeNull();
      expect(parseFloat((archWriteOff.data as any).quantity_after)).toBe(8);
    });
  });

  // ==========================================================================
  // 2. Stocktake Physical Count Reconciliation (T027, T028)
  // ==========================================================================
  describe("T027 & T028: Stocktake Workflow & Physical Count Semantics", () => {
    it("2.1 Non-zero variance: commits movement with calculated delta and updates stock", async () => {
      // Current stock of productPieceId is 105. Physical count finds 112 (+7 surplus).
      const stocktakeRes = await ownerClient.rpc("execute_stock_movement", {
        p_org_id: orgId,
        p_product_id: productPieceId,
        p_movement_type: "adjustment",
        p_quantity: 112, // target physical count
        p_reason: "Q4 Physical Inventory Count: Bin 4A recount",
        p_reference_id: "STOCKTAKE-2026-Q4",
        p_idempotency_key: "00000000-0000-4000-8000-000000000301",
        p_quantity_semantics: "target_physical_count",
      });

      expect(stocktakeRes.error).toBeNull();
      const data = stocktakeRes.data as any;
      expect(data.success).toBe(true);
      expect(data.status).toBe("committed");
      expect(parseFloat(data.quantity_before)).toBe(105);
      expect(parseFloat(data.quantity_delta)).toBe(7);
      expect(parseFloat(data.quantity_after)).toBe(112);

      // Verify inventory table state
      const inv = await pgClient.query(
        `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
        [orgId, productPieceId]
      );
      expect(parseFloat(inv.rows[0].quantity)).toBe(112);
    });

    it("2.2 Zero-delta match: returns matched status, records zero_delta_stocktakes, and skips stock_movements ledger", async () => {
      // Current stock is 112. Physical count is exactly 112.
      const matchRes = await ownerClient.rpc("execute_stock_movement", {
        p_org_id: orgId,
        p_product_id: productPieceId,
        p_movement_type: "adjustment",
        p_quantity: 112, // exactly matches current stock
        p_reason: "Daily cycle count: verified exact match",
        p_reference_id: "CYCLE-COUNT-MATCH",
        p_idempotency_key: "00000000-0000-4000-8000-000000000302",
        p_quantity_semantics: "target_physical_count",
      });

      expect(matchRes.error).toBeNull();
      const data = matchRes.data as any;
      expect(data.success).toBe(true);
      expect(data.status).toBe("matched");
      expect(parseFloat(data.current_stock)).toBe(112);
      expect(parseFloat(data.matched_quantity)).toBe(112);
      expect(parseFloat(data.quantity_delta)).toBe(0);

      // Verify zero_delta_stocktakes has an entry
      const zeroDelta = await pgClient.query(
        `SELECT * FROM public.zero_delta_stocktakes WHERE organization_id = $1 AND product_id = $2 AND idempotency_key = $3;`,
        [orgId, productPieceId, "00000000-0000-4000-8000-000000000302"]
      );
      expect(zeroDelta.rows.length).toBe(1);
      expect(parseFloat(zeroDelta.rows[0].target_physical_count)).toBe(112);

      // Verify stock_movements does NOT have a movement for this idempotency key
      const movement = await pgClient.query(
        `SELECT * FROM public.stock_movements WHERE idempotency_key = $1;`,
        ["00000000-0000-4000-8000-000000000302"]
      );
      expect(movement.rows.length).toBe(0);
    });

    it("2.3 Duplicate zero-delta stocktake replays correctly without creating duplicate audit record", async () => {
      const replayRes = await ownerClient.rpc("execute_stock_movement", {
        p_org_id: orgId,
        p_product_id: productPieceId,
        p_movement_type: "adjustment",
        p_quantity: 112,
        p_reason: "Daily cycle count: verified exact match",
        p_reference_id: "CYCLE-COUNT-MATCH",
        p_idempotency_key: "00000000-0000-4000-8000-000000000302",
        p_quantity_semantics: "target_physical_count",
      });

      expect(replayRes.error).toBeNull();
      const data = replayRes.data as any;
      expect(data.success).toBe(true);
      expect(data.status).toBe("matched");
      expect(data.is_replay).toBe(true);

      // Verify count in zero_delta_stocktakes remains exactly 1
      const countRes = await pgClient.query(
        `SELECT count(*) FROM public.zero_delta_stocktakes WHERE organization_id = $1 AND idempotency_key = $2;`,
        [orgId, "00000000-0000-4000-8000-000000000302"]
      );
      expect(parseInt(countRes.rows[0].count, 10)).toBe(1);
    });

    it("2.4 Direct client INSERT on zero_delta_stocktakes is denied by RLS (42501)", async () => {
      const { data, error } = await ownerClient.from("zero_delta_stocktakes").insert({
        organization_id: orgId,
        product_id: productPieceId,
        idempotency_key: "00000000-0000-4000-8000-000000000991",
        idempotency_payload_hash: "tampered_hash_direct_client",
        target_physical_count: 100,
        created_by: ownerUserId,
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
    });

    it("2.5 Direct client UPDATE on zero_delta_stocktakes is denied by RLS (0 rows updated)", async () => {
      const { data } = await ownerClient
        .from("zero_delta_stocktakes")
        .update({ target_physical_count: 999 })
        .eq("organization_id", orgId)
        .select();

      // Zero rows affected due to RLS USING (false)
      expect(data).toEqual([]);

      // Verify row in database is unchanged
      const zd = await pgClient.query(
        `SELECT target_physical_count FROM public.zero_delta_stocktakes WHERE organization_id = $1 AND idempotency_key = $2;`,
        [orgId, "00000000-0000-4000-8000-000000000302"]
      );
      expect(parseFloat(zd.rows[0].target_physical_count)).toBe(112);
    });

    it("2.6 Direct client DELETE on zero_delta_stocktakes is denied by RLS (0 rows deleted)", async () => {
      const { data } = await ownerClient
        .from("zero_delta_stocktakes")
        .delete()
        .eq("organization_id", orgId)
        .select();

      // Zero rows affected due to RLS USING (false)
      expect(data).toEqual([]);

      // Verify row still exists in database
      const zd = await pgClient.query(
        `SELECT count(*) FROM public.zero_delta_stocktakes WHERE organization_id = $1 AND idempotency_key = $2;`,
        [orgId, "00000000-0000-4000-8000-000000000302"]
      );
      expect(parseInt(zd.rows[0].count, 10)).toBe(1);
    });
  });

  // ==========================================================================
  // 3. Optimistic Concurrency Control (OCC)
  // ==========================================================================
  describe("Optimistic Concurrency Control (OCC) across Movements & Thresholds", () => {
    it("3.1 Rejects movement with stale expected_version with STALE_VERSION_CONFLICT (P0027)", async () => {
      // Get current version
      const inv = await pgClient.query(
        `SELECT version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
        [orgId, productPieceId]
      );
      const currentVersion = inv.rows[0].version;

      const staleRes = await ownerClient.rpc("execute_stock_movement", {
        p_org_id: orgId,
        p_product_id: productPieceId,
        p_movement_type: "adjustment",
        p_quantity: 1,
        p_reason: "Concurrent modification conflict test",
        p_expected_version: currentVersion - 1, // Stale!
        p_idempotency_key: "00000000-0000-4000-8000-000000000401",
        p_quantity_semantics: "quantity_delta",
      });

      expect(staleRes.error).not.toBeNull();
      expect(staleRes.error?.code).toBe("P0027");
      expect(staleRes.error?.message).toMatch(/STALE_VERSION_CONFLICT/i);
    });

    it("3.2 Rejects update_inventory_thresholds with stale expected_version with STALE_VERSION_CONFLICT (P0027)", async () => {
      const inv = await pgClient.query(
        `SELECT version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
        [orgId, productPieceId]
      );
      const currentVersion = inv.rows[0].version;

      const staleThresh = await ownerClient.rpc("update_inventory_thresholds", {
        p_org_id: orgId,
        p_product_id: productPieceId,
        p_reorder_point: 10,
        p_reorder_quantity: 50,
        p_expected_version: currentVersion - 1, // Stale!
      });

      expect(staleThresh.error).not.toBeNull();
      expect(staleThresh.error?.code).toBe("P0027");
      expect(staleThresh.error?.message).toMatch(/STALE_VERSION_CONFLICT/i);
    });
  });

  // ==========================================================================
  // 4. Reorder Threshold Configuration (T029)
  // ==========================================================================
  describe("T029: Reorder Threshold Configuration", () => {
    it("4.1 Successfully updates reorder point and quantity when expectedVersion matches", async () => {
      const inv = await pgClient.query(
        `SELECT version, quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
        [orgId, productPieceId]
      );
      const currentVersion = inv.rows[0].version;
      const initialQty = parseFloat(inv.rows[0].quantity);

      const updateRes = await ownerClient.rpc("update_inventory_thresholds", {
        p_org_id: orgId,
        p_product_id: productPieceId,
        p_reorder_point: 25,
        p_reorder_quantity: 100,
        p_expected_version: currentVersion,
      });

      expect(updateRes.error).toBeNull();
      const data = updateRes.data as any;
      expect(data.success).toBe(true);
      expect(parseFloat(data.reorder_point)).toBe(25);
      expect(parseFloat(data.reorder_quantity)).toBe(100);
      expect(data.version).toBe(currentVersion + 1);

      // Verify inventory table state: thresholds updated, stock quantity unchanged!
      const verifyInv = await pgClient.query(
        `SELECT quantity, reorder_point, reorder_quantity, version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
        [orgId, productPieceId]
      );
      expect(parseFloat(verifyInv.rows[0].quantity)).toBe(initialQty);
      expect(parseFloat(verifyInv.rows[0].reorder_point)).toBe(25);
      expect(parseFloat(verifyInv.rows[0].reorder_quantity)).toBe(100);
      expect(verifyInv.rows[0].version).toBe(currentVersion + 1);
    });

    it("4.2 Rejects negative reorder point at database boundary", async () => {
      const inv = await pgClient.query(
        `SELECT version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
        [orgId, productPieceId]
      );
      const currentVersion = inv.rows[0].version;

      const negRes = await ownerClient.rpc("update_inventory_thresholds", {
        p_org_id: orgId,
        p_product_id: productPieceId,
        p_reorder_point: -5,
        p_reorder_quantity: 50,
        p_expected_version: currentVersion,
      });

      expect(negRes.error).not.toBeNull();
    });

    it("4.3 Allows clearing thresholds by setting them to NULL", async () => {
      const inv = await pgClient.query(
        `SELECT version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
        [orgId, productPieceId]
      );
      const currentVersion = inv.rows[0].version;

      const clearRes = await ownerClient.rpc("update_inventory_thresholds", {
        p_org_id: orgId,
        p_product_id: productPieceId,
        p_reorder_point: null,
        p_reorder_quantity: null,
        p_expected_version: currentVersion,
      });

      expect(clearRes.error).toBeNull();
      const verifyInv = await pgClient.query(
        `SELECT reorder_point, reorder_quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
        [orgId, productPieceId]
      );
      expect(verifyInv.rows[0].reorder_point).toBeNull();
      expect(verifyInv.rows[0].reorder_quantity).toBeNull();
    });
  });
});
