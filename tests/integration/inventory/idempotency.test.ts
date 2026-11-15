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

describe("T039: Integration Tests — Inventory Idempotency Engine & Concurrency", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;

  let ownerClient: SupabaseClient;
  let ownerUserId: string;

  const testPassword = "P@ssword123!T039Idempotency";
  const timestamp = Date.now();

  let orgId: string;
  const orgSlug = `t039-idem-${timestamp}`;

  let standardProductId: string;
  let cycleCountProductId: string;
  let archivalProductId: string;

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Create Test Owner
    const ownerEmail = `t039_owner_${timestamp}@bizflow-test.internal`;
    const { data: uOwner } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "T039", last_name: "Owner" },
    });
    ownerUserId = uOwner.user!.id;

    // 2. Authenticate Owner
    ownerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

    // 3. Create Organization
    const resOrg = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
       VALUES ('T039 Idempotency Org', $1, 'USD', 'retail', 'US', 'America/New_York', $2)
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

    // 5. Seed Test Products
    const resProd1 = await ownerClient.rpc("create_product", {
      p_org_id: orgId,
      p_name: "Standard Stock Item",
      p_sku: `T039-STD-${timestamp}`,
      p_selling_price: 25.0,
      p_unit_of_measure: "piece",
      p_cost_price: 10.0,
    });
    standardProductId = (resProd1.data as any).data.id;

    const resProd2 = await ownerClient.rpc("create_product", {
      p_org_id: orgId,
      p_name: "Cycle Count Item",
      p_sku: `T039-CYCLE-${timestamp}`,
      p_selling_price: 40.0,
      p_unit_of_measure: "piece",
      p_cost_price: 18.0,
    });
    cycleCountProductId = (resProd2.data as any).data.id;

    const resProd3 = await ownerClient.rpc("create_product", {
      p_org_id: orgId,
      p_name: "Archival Test Item",
      p_sku: `T039-ARCH-${timestamp}`,
      p_selling_price: 60.0,
      p_unit_of_measure: "piece",
      p_cost_price: 30.0,
    });
    archivalProductId = (resProd3.data as any).data.id;
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

  // 1. Normal movement replay
  it("Scenario 1: Normal movement replay returns original result with is_replay: true without duplicate ledger row", async () => {
    const key = randomUUID();
    const payload = {
      p_org_id: orgId,
      p_product_id: standardProductId,
      p_movement_type: "restock",
      p_quantity: 25,
      p_reason: "Initial supplier batch delivery",
      p_reference_id: "PO-7701",
      p_idempotency_key: key,
    };

    // First execution
    const firstRes = await ownerClient.rpc("execute_stock_movement", payload);
    expect(firstRes.error).toBeNull();
    const firstData = firstRes.data as any;
    expect(firstData.success).toBe(true);
    expect(firstData.current_stock).toBe("25.0000");
    expect(firstData.is_replay).toBeFalsy();
    const movementId = firstData.movement_id;

    // Second execution (replay with identical key and payload)
    const replayRes = await ownerClient.rpc("execute_stock_movement", payload);
    expect(replayRes.error).toBeNull();
    const replayData = replayRes.data as any;
    expect(replayData.success).toBe(true);
    expect(replayData.is_replay).toBe(true);
    expect(replayData.status).toBe("replayed");
    expect(replayData.movement_id).toBe(movementId);
    expect(replayData.quantity_before).toBe("0.0000");
    expect(replayData.quantity_delta).toBe("25.0000");
    expect(replayData.quantity_after).toBe("25.0000");
    expect(replayData.current_stock).toBe("25.0000");

    // Assert database invariants: exactly 1 row in stock_movements and balance is 25
    const movRes = await pgClient.query(
      `SELECT * FROM public.stock_movements WHERE organization_id = $1 AND idempotency_key = $2;`,
      [orgId, key]
    );
    expect(movRes.rows.length).toBe(1);

    const invRes = await pgClient.query(
      `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, standardProductId]
    );
    expect(Number(invRes.rows[0].quantity)).toBe(25);
  });

  // 2. Zero-delta stocktake replay
  it("Scenario 2: Zero-delta stocktake records zero_delta_stocktakes row (0 in stock_movements) and replaying returns matched_quantity + live current_stock", async () => {
    // Current stock on standardProductId is 25.0000
    const key = randomUUID();
    const zeroDeltaPayload = {
      p_org_id: orgId,
      p_product_id: standardProductId,
      p_movement_type: "adjustment",
      p_quantity: 25, // Target count matches live stock
      p_reason: "Cycle count confirms exact inventory match",
      p_idempotency_key: key,
      p_quantity_semantics: "target_physical_count",
    };

    // First call
    const firstRes = await ownerClient.rpc("execute_stock_movement", zeroDeltaPayload);
    expect(firstRes.error).toBeNull();
    const firstData = firstRes.data as any;
    expect(firstData.success).toBe(true);
    expect(firstData.status).toBe("matched");
    expect(firstData.is_replay).toBe(false);
    expect(firstData.matched_quantity).toBe("25.0000");
    expect(firstData.current_stock).toBe("25.0000");

    // Verify 0 rows inserted into stock_movements for this key
    const movCheck = await pgClient.query(
      `SELECT * FROM public.stock_movements WHERE organization_id = $1 AND idempotency_key = $2;`,
      [orgId, key]
    );
    expect(movCheck.rows.length).toBe(0);

    // Verify 1 row inserted into zero_delta_stocktakes
    const zdCheck = await pgClient.query(
      `SELECT * FROM public.zero_delta_stocktakes WHERE organization_id = $1 AND idempotency_key = $2;`,
      [orgId, key]
    );
    expect(zdCheck.rows.length).toBe(1);
    expect(Number(zdCheck.rows[0].target_physical_count)).toBe(25);

    // Mutate stock through another movement to verify live stock reflection on replay
    await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: standardProductId,
      p_movement_type: "restock",
      p_quantity: 10,
      p_reason: "Additional restock to shift live balance",
    });

    // Replay the zero-delta stocktake call
    const replayRes = await ownerClient.rpc("execute_stock_movement", zeroDeltaPayload);
    expect(replayRes.error).toBeNull();
    const replayData = replayRes.data as any;
    expect(replayData.success).toBe(true);
    expect(replayData.status).toBe("matched");
    expect(replayData.is_replay).toBe(true);
    expect(replayData.matched_quantity).toBe("25.0000");
    // Reflects live updated current_stock (35.0000)
    expect(replayData.current_stock).toBe("35.0000");

    // Still 0 rows in stock_movements for zero-delta key
    const movCheck2 = await pgClient.query(
      `SELECT * FROM public.stock_movements WHERE organization_id = $1 AND idempotency_key = $2;`,
      [orgId, key]
    );
    expect(movCheck2.rows.length).toBe(0);
  });

  // 3. Idempotency conflict (P0024)
  it("Scenario 3: Reusing an idempotency key with differing payload raises P0024 IDEMPOTENCY_CONFLICT", async () => {
    const key = randomUUID();
    // 1. Initial movement
    const initRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: cycleCountProductId,
      p_movement_type: "restock",
      p_quantity: 50,
      p_reason: "Primary shipment",
      p_idempotency_key: key,
    });
    expect(initRes.error).toBeNull();

    // 2. Conflict attempt with different quantity
    const conflictQtyRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: cycleCountProductId,
      p_movement_type: "restock",
      p_quantity: 75, // Different!
      p_reason: "Primary shipment",
      p_idempotency_key: key,
    });
    expect(conflictQtyRes.error).toBeDefined();
    expect(conflictQtyRes.error?.code).toBe("P0024");
    expect(conflictQtyRes.error?.message).toContain("IDEMPOTENCY_CONFLICT");

    // 3. Conflict attempt with different reason
    const conflictReasonRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: cycleCountProductId,
      p_movement_type: "restock",
      p_quantity: 50,
      p_reason: "Tampered reason string",
      p_idempotency_key: key,
    });
    expect(conflictReasonRes.error).toBeDefined();
    expect(conflictReasonRes.error?.code).toBe("P0024");
    expect(conflictReasonRes.error?.message).toContain("IDEMPOTENCY_CONFLICT");

    // Balance remains 50
    const invRes = await pgClient.query(
      `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, cycleCountProductId]
    );
    expect(Number(invRes.rows[0].quantity)).toBe(50);
  });

  // 4. Concurrency & Advisory Lock Serialization
  it("Scenario 4: Concurrent identical requests serialize cleanly via pg_advisory_xact_lock without duplicate rows or race conditions", async () => {
    const concurrentKey = randomUUID();
    const payload = {
      p_org_id: orgId,
      p_product_id: cycleCountProductId,
      p_movement_type: "restock",
      p_quantity: 15,
      p_reason: "Concurrent batch submission test",
      p_idempotency_key: concurrentKey,
    };

    // Fire 5 identical requests simultaneously
    const results = await Promise.all([
      ownerClient.rpc("execute_stock_movement", payload),
      ownerClient.rpc("execute_stock_movement", payload),
      ownerClient.rpc("execute_stock_movement", payload),
      ownerClient.rpc("execute_stock_movement", payload),
      ownerClient.rpc("execute_stock_movement", payload),
    ]);

    // All must succeed
    for (const res of results) {
      expect(res.error).toBeNull();
      expect((res.data as any).success).toBe(true);
    }

    // Exactly 1 must be the original execution and 4 must be replays
    const replayCount = results.filter((r) => (r.data as any).is_replay === true).length;
    const initialCount = results.filter((r) => !(r.data as any).is_replay).length;
    expect(initialCount).toBe(1);
    expect(replayCount).toBe(4);

    // Exactly 1 row in stock_movements for this key
    const movRes = await pgClient.query(
      `SELECT * FROM public.stock_movements WHERE organization_id = $1 AND idempotency_key = $2;`,
      [orgId, concurrentKey]
    );
    expect(movRes.rows.length).toBe(1);

    // Balance was 50, +15 = 65. Never double-counted!
    const invRes = await pgClient.query(
      `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, cycleCountProductId]
    );
    expect(Number(invRes.rows[0].quantity)).toBe(65);
  });

  // 5. Replay after product archival
  it("Scenario 5: Replaying an idempotency key after product archival succeeds and returns cached result", async () => {
    const archivalKey = randomUUID();
    // 1. Record stock movement while product is active
    const initRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: archivalProductId,
      p_movement_type: "restock",
      p_quantity: 40,
      p_reason: "Pre-archival restock",
      p_idempotency_key: archivalKey,
    });
    expect(initRes.error).toBeNull();
    const originalMovementId = (initRes.data as any).movement_id;

    // 2. Archive product
    const archRes = await ownerClient.rpc("archive_product", {
      p_org_id: orgId,
      p_product_id: archivalProductId,
      p_expected_version: 1,
    });
    if (archRes.error) {
      await pgClient.query(
        `UPDATE public.products SET status = 'archived', archived_at = clock_timestamp(), archived_by = $2 WHERE id = $1;`,
        [archivalProductId, ownerUserId]
      );
    }

    // Verify product is now archived
    const prodCheck = await pgClient.query(
      `SELECT status FROM public.products WHERE id = $1;`,
      [archivalProductId]
    );
    expect(prodCheck.rows[0].status).toBe("archived");

    // 3. Attempting a NEW restock on archived product fails with P0021
    const newRestock = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: archivalProductId,
      p_movement_type: "restock",
      p_quantity: 10,
      p_reason: "New restock attempt on archived item",
    });
    expect(newRestock.error?.code).toBe("P0021");

    // 4. Replaying the PREVIOUS idempotency key succeeds because idempotency checks precede lifecycle guards
    const replayRes = await ownerClient.rpc("execute_stock_movement", {
      p_org_id: orgId,
      p_product_id: archivalProductId,
      p_movement_type: "restock",
      p_quantity: 40,
      p_reason: "Pre-archival restock",
      p_idempotency_key: archivalKey,
    });

    expect(replayRes.error).toBeNull();
    const replayData = replayRes.data as any;
    expect(replayData.success).toBe(true);
    expect(replayData.is_replay).toBe(true);
    expect(replayData.status).toBe("replayed");
    expect(replayData.movement_id).toBe(originalMovementId);
    expect(replayData.current_stock).toBe("40.0000");
  });
});
