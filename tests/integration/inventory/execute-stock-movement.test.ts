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

describe("T038: Integration Tests — execute_stock_movement Stored Procedure", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;

  let ownerClient: SupabaseClient;
  let ownerUserId: string;

  const testPassword = "P@ssword123!T038Execution";
  const timestamp = Date.now();

  let orgId: string;
  const orgSlug = `t038-inv-${timestamp}`;

  let activeDiscreteProductId: string;
  let activeContinuousProductId: string;
  let archivedProductId: string;
  let inactiveProductId: string;

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Create Test Owner User
    const ownerEmail = `t038_owner_${timestamp}@bizflow-test.internal`;
    const { data: uOwner } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "T038", last_name: "Owner" },
    });
    ownerUserId = uOwner.user!.id;

    // 2. Authenticate Owner
    ownerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

    // 3. Create Organization
    const resOrg = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
       VALUES ('T038 Test Org', $1, 'USD', 'retail', 'US', 'America/New_York', $2)
       RETURNING id;`,
      [orgSlug, ownerUserId]
    );
    orgId = resOrg.rows[0].id;

    // 4. Create Membership
    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active');`,
      [orgId, ownerUserId]
    );

    // 5. Seed Products
    // Product 1: Active Discrete (piece)
    const resProd1 = await ownerClient.rpc("create_product", {
      p_org_id: orgId,
      p_name: "Discrete Widget",
      p_sku: `T038-DISC-${timestamp}`,
      p_selling_price: 30.0,
      p_unit_of_measure: "piece",
      p_cost_price: 15.0,
    });
    if (resProd1.error) throw new Error(`Failed to create discrete product: ${resProd1.error.message}`);
    activeDiscreteProductId = (resProd1.data as any).data.id;

    // Product 2: Active Continuous (kg)
    const resProd2 = await ownerClient.rpc("create_product", {
      p_org_id: orgId,
      p_name: "Bulk Grain",
      p_sku: `T038-CONT-${timestamp}`,
      p_selling_price: 12.0,
      p_unit_of_measure: "kg",
      p_cost_price: 6.0,
    });
    if (resProd2.error) throw new Error(`Failed to create continuous product: ${resProd2.error.message}`);
    activeContinuousProductId = (resProd2.data as any).data.id;

    // Product 3: Archived Product (piece)
    const resProd3 = await ownerClient.rpc("create_product", {
      p_org_id: orgId,
      p_name: "Archived Hardware",
      p_sku: `T038-ARCH-${timestamp}`,
      p_selling_price: 45.0,
      p_unit_of_measure: "piece",
      p_cost_price: 20.0,
    });
    if (resProd3.error) throw new Error(`Failed to create archived product: ${resProd3.error.message}`);
    archivedProductId = (resProd3.data as any).data.id;

    // Pre-seed some stock on archived product before archiving
    await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: archivedProductId,
      p_movement_type: "initial",
      p_quantity: 20,
      p_reason: "Pre-archival opening balance",
    });

    // Archive product via canonical RPC
    const archRes = await ownerClient.rpc("archive_product", {
      p_org_id: orgId,
      p_product_id: archivedProductId,
      p_expected_version: 1,
    });
    if (archRes.error) {
      throw new Error(`Failed to archive product canonically: ${archRes.error.message}`);
    }

    // Product 4: Inactive Product (piece)
    const resProd4 = await ownerClient.rpc("create_product", {
      p_org_id: orgId,
      p_name: "Seasonal Toy",
      p_sku: `T038-INACT-${timestamp}`,
      p_selling_price: 20.0,
      p_unit_of_measure: "piece",
      p_cost_price: 8.0,
    });
    if (resProd4.error) throw new Error(`Failed to create inactive product: ${resProd4.error.message}`);
    inactiveProductId = (resProd4.data as any).data.id;

    // Mark product as inactive
    await pgClient.query(
      `UPDATE public.products SET status = 'inactive' WHERE id = $1;`,
      [inactiveProductId]
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

  // Scenario 1: Restock on active product
  it("Scenario 1: Restock increases balance, increments OCC version, and creates movement ledger record", async () => {
    const res = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: activeDiscreteProductId,
      p_movement_type: "restock",
      p_quantity: 50,
      p_reason: "Vendor shipment received via PO-1001",
      p_reference_id: "PO-1001",
    });

    expect(res.error).toBeNull();
    const data = res.data as any;
    expect(data.success).toBe(true);
    expect(data.quantity_before).toBe("0.0000");
    expect(data.quantity_delta).toBe("50.0000");
    expect(data.quantity_after).toBe("50.0000");
    expect(data.current_stock).toBe("50.0000");
    expect(data.version).toBe(2);

    // Verify DB inventory table
    const invRes = await pgClient.query(
      `SELECT quantity, version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, activeDiscreteProductId]
    );
    expect(Number(invRes.rows[0].quantity)).toBe(50);
    expect(invRes.rows[0].version).toBe(2);

    // Verify DB stock_movements table
    const movRes = await pgClient.query(
      `SELECT * FROM public.stock_movements WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, activeDiscreteProductId]
    );
    expect(movRes.rows.length).toBe(1);
    expect(movRes.rows[0].movement_type).toBe("restock");
    expect(Number(movRes.rows[0].quantity_delta)).toBe(50);
    expect(movRes.rows[0].reference_id).toBe("PO-1001");

    // Verify DB stock_movement_costs table snapshot
    const costRes = await pgClient.query(
      `SELECT * FROM public.stock_movement_costs WHERE movement_id = $1;`,
      [movRes.rows[0].id]
    );
    expect(costRes.rows.length).toBe(1);
    expect(Number(costRes.rows[0].unit_cost)).toBe(15.0);
    expect(costRes.rows[0].currency).toBe("USD");
  });

  // Scenario 2: Initial stock singularity violation (P0026)
  it("Scenario 2: Rejects initial stock movement if opening stock has already been recorded (P0026)", async () => {
    // 1. Initial stock on continuous product
    const firstInit = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: activeContinuousProductId,
      p_movement_type: "initial",
      p_quantity: 100,
      p_reason: "Initial warehouse inventory load",
    });
    expect(firstInit.error).toBeNull();
    expect((firstInit.data as any).success).toBe(true);

    // 2. Second initial stock on same product MUST fail with P0026
    const secondInit = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: activeContinuousProductId,
      p_movement_type: "initial",
      p_quantity: 50,
      p_reason: "Attempting second opening balance",
    });

    expect(secondInit.error).toBeDefined();
    expect(secondInit.error?.code).toBe("P0026");
    expect(secondInit.error?.message).toContain("INITIAL_STOCK_NOT_PERMITTED");

    // Verify DB inventory balance and stock_movements ledger remain unchanged
    const invRes = await pgClient.query(
      `SELECT quantity, version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, activeContinuousProductId]
    );
    expect(Number(invRes.rows[0].quantity)).toBe(100);
    expect(invRes.rows[0].version).toBe(2);

    const movRes = await pgClient.query(
      `SELECT count(*)::int AS count FROM public.stock_movements WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, activeContinuousProductId]
    );
    expect(movRes.rows[0].count).toBe(1);
  });

  // Scenario 3: Damage write-off (negative delta)
  it("Scenario 3: Damage write-off decrements balance, increments version, and creates movement record", async () => {
    const res = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: activeDiscreteProductId,
      p_movement_type: "damage",
      p_quantity: -10,
      p_reason: "Water damage in aisle 4",
    });

    expect(res.error).toBeNull();
    const data = res.data as any;
    expect(data.success).toBe(true);
    expect(data.quantity_before).toBe("50.0000");
    expect(data.quantity_delta).toBe("-10.0000");
    expect(data.quantity_after).toBe("40.0000");
    expect(data.current_stock).toBe("40.0000");
    expect(data.version).toBe(3);

    // Verify DB inventory table
    const invRes = await pgClient.query(
      `SELECT quantity, version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, activeDiscreteProductId]
    );
    expect(Number(invRes.rows[0].quantity)).toBe(40);
    expect(invRes.rows[0].version).toBe(3);
  });

  // Scenario 4: Insufficient stock (P0011)
  it("Scenario 4: Rejects negative movement exceeding available stock with P0011 INSUFFICIENT_STOCK", async () => {
    // Current stock is 40. Deducting 45 exceeds stock.
    const res = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: activeDiscreteProductId,
      p_movement_type: "damage",
      p_quantity: -45,
      p_reason: "Excessive damage exceeding on hand",
    });

    expect(res.error).toBeDefined();
    expect(res.error?.code).toBe("P0011");
    expect(res.error?.message).toContain("INSUFFICIENT_STOCK");

    // Verify DB inventory balance and stock_movements ledger are unchanged
    const invRes = await pgClient.query(
      `SELECT quantity, version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, activeDiscreteProductId]
    );
    expect(Number(invRes.rows[0].quantity)).toBe(40);
    expect(invRes.rows[0].version).toBe(3);

    const movRes = await pgClient.query(
      `SELECT count(*)::int AS count FROM public.stock_movements WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, activeDiscreteProductId]
    );
    expect(movRes.rows[0].count).toBe(2); // 1 restock + 1 damage from Scenario 1 & 3
  });

  // Scenario 5: Product archived stock forbidden for positive delta (P0021)
  it("Scenario 5: Rejects positive stock delta on archived product with P0021 PRODUCT_ARCHIVED_STOCK_FORBIDDEN", async () => {
    // Attempt restock on archived product
    const restockRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: archivedProductId,
      p_movement_type: "restock",
      p_quantity: 10,
      p_reason: "Attempted restock of archived item",
    });

    expect(restockRes.error).toBeDefined();
    expect(restockRes.error?.code).toBe("P0021");
    expect(restockRes.error?.message).toContain("PRODUCT_ARCHIVED_STOCK_FORBIDDEN");

    // Attempt positive adjustment on archived product
    const adjustPosRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: archivedProductId,
      p_movement_type: "adjustment",
      p_quantity: 5,
      p_reason: "Positive delta adjustment on archived item",
      p_quantity_semantics: "quantity_delta",
    });

    expect(adjustPosRes.error).toBeDefined();
    expect(adjustPosRes.error?.code).toBe("P0021");
    expect(adjustPosRes.error?.message).toContain("PRODUCT_ARCHIVED_STOCK_FORBIDDEN");

    // Verify DB inventory balance and movements are unchanged on archived product (20 quantity, 1 movement)
    const invRes = await pgClient.query(
      `SELECT quantity, version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, archivedProductId]
    );
    expect(Number(invRes.rows[0].quantity)).toBe(20);

    const movRes = await pgClient.query(
      `SELECT count(*)::int AS count FROM public.stock_movements WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, archivedProductId]
    );
    expect(movRes.rows[0].count).toBe(1);
  });

  // Scenario 6: Negative-delta write-off on archived product permitted
  it("Scenario 6: Permits negative-delta write-off (damage/loss) on archived product to clear balance", async () => {
    // Current stock on archived product is 20
    const res = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: archivedProductId,
      p_movement_type: "damage",
      p_quantity: -5,
      p_reason: "Disposing scrap from archived product",
    });

    expect(res.error).toBeNull();
    const data = res.data as any;
    expect(data.success).toBe(true);
    expect(data.quantity_before).toBe("20.0000");
    expect(data.quantity_delta).toBe("-5.0000");
    expect(data.quantity_after).toBe("15.0000");
    expect(data.current_stock).toBe("15.0000");
  });

  // Scenario 7: Inactive product restock blocked (P0022)
  it("Scenario 7: Rejects restock on inactive product with P0022 PRODUCT_INACTIVE_RESTOCK_BLOCKED", async () => {
    const res = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: inactiveProductId,
      p_movement_type: "restock",
      p_quantity: 10,
      p_reason: "Restocking inactive seasonal product",
    });

    expect(res.error).toBeDefined();
    expect(res.error?.code).toBe("P0022");
    expect(res.error?.message).toContain("PRODUCT_INACTIVE_RESTOCK_BLOCKED");

    // Verify DB inventory balance and stock_movements ledger are unchanged
    const invRes = await pgClient.query(
      `SELECT quantity, version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, inactiveProductId]
    );
    expect(Number(invRes.rows[0].quantity)).toBe(0);

    const movRes = await pgClient.query(
      `SELECT count(*)::int AS count FROM public.stock_movements WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, inactiveProductId]
    );
    expect(movRes.rows[0].count).toBe(0);
  });

  // Scenario 8: Inactive product internal use blocked (P0023)
  it("Scenario 8: Rejects internal use on inactive product with P0023 PRODUCT_INACTIVE_INTERNAL_USE_BLOCKED", async () => {
    const res = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: inactiveProductId,
      p_movement_type: "internal_use",
      p_quantity: -2,
      p_reason: "Staff sampling inactive product",
    });

    expect(res.error).toBeDefined();
    expect(res.error?.code).toBe("P0023");
    expect(res.error?.message).toContain("PRODUCT_INACTIVE_INTERNAL_USE_BLOCKED");

    // Verify DB inventory balance and stock_movements ledger are unchanged
    const invRes = await pgClient.query(
      `SELECT quantity, version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, inactiveProductId]
    );
    expect(Number(invRes.rows[0].quantity)).toBe(0);

    const movRes = await pgClient.query(
      `SELECT count(*)::int AS count FROM public.stock_movements WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, inactiveProductId]
    );
    expect(movRes.rows[0].count).toBe(0);
  });

  // Scenario 9: Invalid quantity semantics (P0033)
  it("Scenario 9: Rejects target_physical_count when movement_type is not adjustment with P0033", async () => {
    const res = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: activeDiscreteProductId,
      p_movement_type: "restock",
      p_quantity: 60,
      p_reason: "Invalid restock semantics",
      p_quantity_semantics: "target_physical_count",
    });

    expect(res.error).toBeDefined();
    expect(res.error?.code).toBe("P0033");
    expect(res.error?.message).toContain("INVALID_QUANTITY_SEMANTICS");

    // Verify DB inventory balance and stock_movements ledger are unchanged
    const invRes = await pgClient.query(
      `SELECT quantity, version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, activeDiscreteProductId]
    );
    expect(Number(invRes.rows[0].quantity)).toBe(40);

    const movRes = await pgClient.query(
      `SELECT count(*)::int AS count FROM public.stock_movements WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, activeDiscreteProductId]
    );
    expect(movRes.rows[0].count).toBe(2);
  });

  // Scenario 10: Sale rejection (P0020)
  it("Scenario 10: Rejects sale movement type reserved for Feature 005 with P0020 INVALID_MOVEMENT_TYPE", async () => {
    const saleRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: activeDiscreteProductId,
      p_movement_type: "sale",
      p_quantity: -1,
      p_reason: "Direct sale",
    });
    expect(saleRes.error).toBeDefined();
    expect(saleRes.error?.code).toBe("P0020");
    expect(saleRes.error?.message).toContain("INVALID_MOVEMENT_TYPE");

    // Verify DB inventory balance and stock_movements ledger are unchanged
    const invRes = await pgClient.query(
      `SELECT quantity, version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, activeDiscreteProductId]
    );
    expect(Number(invRes.rows[0].quantity)).toBe(40);

    const movRes = await pgClient.query(
      `SELECT count(*)::int AS count FROM public.stock_movements WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, activeDiscreteProductId]
    );
    expect(movRes.rows[0].count).toBe(2);
  });

  // Scenario 11: Return rejection (P0020)
  it("Scenario 11: Rejects return movement type reserved for Feature 005 with P0020 INVALID_MOVEMENT_TYPE", async () => {
    const returnRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: activeDiscreteProductId,
      p_movement_type: "return",
      p_quantity: 1,
      p_reason: "Customer return",
    });
    expect(returnRes.error).toBeDefined();
    expect(returnRes.error?.code).toBe("P0020");
    expect(returnRes.error?.message).toContain("INVALID_MOVEMENT_TYPE");

    // Verify DB inventory balance and stock_movements ledger are unchanged
    const invRes = await pgClient.query(
      `SELECT quantity, version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, activeDiscreteProductId]
    );
    expect(Number(invRes.rows[0].quantity)).toBe(40);

    const movRes = await pgClient.query(
      `SELECT count(*)::int AS count FROM public.stock_movements WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, activeDiscreteProductId]
    );
    expect(movRes.rows[0].count).toBe(2);
  });

  // Scenario 12: Stale version conflict (P0027)
  it("Scenario 12: Rejects stale version with P0027 STALE_VERSION_CONFLICT and succeeds on match", async () => {
    // Current version of activeDiscreteProductId is 3
    const staleRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: activeDiscreteProductId,
      p_movement_type: "restock",
      p_quantity: 5,
      p_reason: "OCC Stale check",
      p_expected_version: 2, // Stale! Current is 3
    });

    expect(staleRes.error).toBeDefined();
    expect(staleRes.error?.code).toBe("P0027");
    expect(staleRes.error?.message).toContain("STALE_VERSION_CONFLICT");

    // Verify DB inventory balance and stock_movements ledger are unchanged after stale rejection
    const invBefore = await pgClient.query(
      `SELECT quantity, version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, activeDiscreteProductId]
    );
    expect(Number(invBefore.rows[0].quantity)).toBe(40);
    expect(invBefore.rows[0].version).toBe(3);

    const movBefore = await pgClient.query(
      `SELECT count(*)::int AS count FROM public.stock_movements WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, activeDiscreteProductId]
    );
    expect(movBefore.rows[0].count).toBe(2);

    // Passing expected_version = 3 succeeds
    const matchRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: activeDiscreteProductId,
      p_movement_type: "restock",
      p_quantity: 5,
      p_reason: "OCC Match check",
      p_expected_version: 3,
    });

    expect(matchRes.error).toBeNull();
    const data = matchRes.data as any;
    expect(data.success).toBe(true);
    expect(data.version).toBe(4);
    expect(data.current_stock).toBe("45.0000");
  });

  // Scenario 13: Discrete UOM fractional rejection (P0015)
  it("Scenario 13: Rejects fractional quantity for discrete UOM with P0015 INTEGER_QUANTITY_REQUIRED", async () => {
    // Fractional quantity on discrete product ('piece') fails with P0015
    const fracRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: activeDiscreteProductId,
      p_movement_type: "restock",
      p_quantity: 3.5,
      p_reason: "Fractional pieces not allowed",
    });

    expect(fracRes.error).toBeDefined();
    expect(fracRes.error?.code).toBe("P0015");
    expect(fracRes.error?.message).toContain("INTEGER_QUANTITY_REQUIRED");

    // Verify DB inventory balance and stock_movements ledger are unchanged
    const invRes = await pgClient.query(
      `SELECT quantity, version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, activeDiscreteProductId]
    );
    expect(Number(invRes.rows[0].quantity)).toBe(45); // Balance remains at 45 from Scenario 12

    const movRes = await pgClient.query(
      `SELECT count(*)::int AS count FROM public.stock_movements WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, activeDiscreteProductId]
    );
    expect(movRes.rows[0].count).toBe(3); // 1 restock + 1 damage + 1 restock (matching OCC)
  });

  // Scenario 14: Decimal precision rejection (P0016)
  it("Scenario 14: Rejects precision exceeding 4 decimal places with P0016 DECIMAL_PRECISION_EXCEEDED", async () => {
    // > 4 decimals on continuous product ('kg') fails with P0016
    const precRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: activeContinuousProductId,
      p_movement_type: "restock",
      p_quantity: 2.12345,
      p_reason: "5 decimal places exceeds limit",
    });

    expect(precRes.error).toBeDefined();
    expect(precRes.error?.code).toBe("P0016");
    expect(precRes.error?.message).toContain("DECIMAL_PRECISION_EXCEEDED");

    // Verify continuous product balance is unchanged at 100
    const invBefore = await pgClient.query(
      `SELECT quantity, version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, activeContinuousProductId]
    );
    expect(Number(invBefore.rows[0].quantity)).toBe(100);

    const movBefore = await pgClient.query(
      `SELECT count(*)::int AS count FROM public.stock_movements WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, activeContinuousProductId]
    );
    expect(movBefore.rows[0].count).toBe(1);

    // 4 decimals on continuous product succeeds
    const validPrecRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: activeContinuousProductId,
      p_movement_type: "restock",
      p_quantity: 2.1234,
      p_reason: "4 decimal places is allowed",
    });

    expect(validPrecRes.error).toBeNull();
    expect((validPrecRes.data as any).success).toBe(true);
    expect((validPrecRes.data as any).quantity_after).toBe("102.1234");
  });
});
