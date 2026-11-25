import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { randomUUID } from "crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const isDbAvailable = Boolean(anonKey && serviceRoleKey);
const describeIntegration = isDbAvailable ? describe : describe.skip;

describeIntegration("T091: Concurrency, Advisory Locks & FK Integrity Integration Tests", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;

  let managerClient: SupabaseClient;
  let cashierClient: SupabaseClient;

  let orgId: string;
  let orgBId: string;
  let managerUserId: string;
  let cashierUserId: string;

  let productId1: string;
  let productId2: string;

  const timestamp = Date.now();
  const testPassword = "Password123!SecureTest";

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const createTestUser = async (prefix: string) => {
      const email = `${prefix}-${timestamp}-${randomUUID().slice(0, 6)}@example.com`;
      const res = await adminClient.auth.admin.createUser({
        email,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "Concur", last_name: prefix },
      });
      const uid = res.data.user!.id;
      await pgClient.query(
        "INSERT INTO public.profiles (id, first_name, last_name) VALUES ($1, 'Concur', $2) ON CONFLICT (id) DO NOTHING;",
        [uid, prefix]
      );
      return { uid, email };
    };

    const uMgr = await createTestUser("mgr");
    managerUserId = uMgr.uid;
    const uCash = await createTestUser("cash");
    cashierUserId = uCash.uid;

    const resOrg = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, created_by)
       VALUES ('Concurrency Org A', $1, 'USD', 'retail', 'US', $2) RETURNING id;`,
      [`concur-org-a-${timestamp}`, managerUserId]
    );
    orgId = resOrg.rows[0].id;

    const resOrgB = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, created_by)
       VALUES ('Concurrency Org B', $1, 'USD', 'retail', 'US', $2) RETURNING id;`,
      [`concur-org-b-${timestamp}`, managerUserId]
    );
    orgBId = resOrgB.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES
         ($1, $2, 'owner', 'active'),
         ($1, $3, 'cashier', 'active'),
         ($4, $2, 'owner', 'active');`,
      [orgId, managerUserId, cashierUserId, orgBId]
    );

    const getClient = async (email: string) => {
      const c = createClient(supabaseUrl, anonKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await c.auth.signInWithPassword({ email, password: testPassword });
      return c;
    };

    managerClient = await getClient(uMgr.email);
    cashierClient = await getClient(uCash.email);

    // Products
    const p1 = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
       VALUES ($1, 'Concur Prod 1', $2, 20.0000, 'piece', 'active', $3, $3) RETURNING id;`,
      [orgId, `SKU-C1-${timestamp}`, managerUserId]
    );
    productId1 = p1.rows[0].id;

    const p2 = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
       VALUES ($1, 'Concur Prod 2', $2, 40.0000, 'piece', 'active', $3, $3) RETURNING id;`,
      [orgId, `SKU-C2-${timestamp}`, managerUserId]
    );
    productId2 = p2.rows[0].id;

    await pgClient.query("UPDATE public.inventory SET quantity = 1000 WHERE organization_id = $1 AND product_id = $2;", [orgId, productId1]);
    await pgClient.query("UPDATE public.inventory SET quantity = 1000 WHERE organization_id = $1 AND product_id = $2;", [orgId, productId2]);
  });

  afterAll(async () => {
    try {
      for (const currentOrg of [orgId, orgBId]) {
        if (currentOrg) {
          await pgClient.query("DELETE FROM public.refunds WHERE organization_id = $1;", [currentOrg]);
          await pgClient.query("DELETE FROM public.sale_returns WHERE organization_id = $1;", [currentOrg]);
          await pgClient.query("DELETE FROM public.sale_return_items WHERE organization_id = $1;", [currentOrg]);
          await pgClient.query("DELETE FROM public.payments WHERE organization_id = $1;", [currentOrg]);
          await pgClient.query("DELETE FROM public.sale_items WHERE organization_id = $1;", [currentOrg]);
          await pgClient.query("DELETE FROM public.sales WHERE organization_id = $1;", [currentOrg]);
          await pgClient.query("DELETE FROM public.stock_movements WHERE organization_id = $1;", [currentOrg]);
          await pgClient.query("DELETE FROM public.inventory WHERE organization_id = $1;", [currentOrg]);
          await pgClient.query("DELETE FROM public.product_costs WHERE organization_id = $1;", [currentOrg]);
          await pgClient.query("DELETE FROM public.products WHERE organization_id = $1;", [currentOrg]);
        }
      }
    } finally {
      await pgClient.end();
    }
  });

  const createSaleWithCard = async (total: number = 60.0) => {
    const saleRes = await cashierClient.rpc("execute_sale", {
      p_org_id: orgId,
      p_customer_id: null,
      p_items: [
        { product_id: productId1, quantity: "1.0000", line_discount_amount: "0.0000" },
        { product_id: productId2, quantity: "1.0000", line_discount_amount: "0.0000" },
      ],
      p_payments: [{
        payment_method: "card",
        amount: total.toFixed(4),
        reference_no: `AUTH-${randomUUID().slice(0, 8)}`,
      }],
      p_order_discount_amount: 0,
      p_idempotency_key: randomUUID(),
    });
    return saleRes.data.sale_id as string;
  };

  // ==========================================================================
  // F005-044 / C44: Obligation Advisory Lock & Replacement Serialization
  // ==========================================================================
  describe("C44: Obligation Advisory Lock & Replacement Serialization", () => {
    it("C44-01: Two concurrent issue_replacement_refund for same obligation (one succeeds, other gets P0064/P0067)", async () => {
      const saleId = await createSaleWithCard(60.0);
      await managerClient.rpc("void_sale", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_void_reason: "Mistake",
        p_idempotency_key: randomUUID(),
      });

      const refundQuery = await pgClient.query(
        "SELECT id FROM public.refunds WHERE organization_id = $1 AND sale_id = $2;",
        [orgId, saleId]
      );
      const refundId = refundQuery.rows[0].id;

      // Mark refund failed
      await managerClient.rpc("record_refund_failure", {
        p_org_id: orgId,
        p_refund_id: refundId,
        p_failure_reason: "Gateway offline",
      });

      // Issue 2 concurrent replacement requests with distinct idempotency keys
      const [res1, res2] = await Promise.all([
        managerClient.rpc("issue_replacement_refund", {
          p_org_id: orgId,
          p_failed_refund_id: refundId,
          p_refund_method: "cash",
          p_reference_no: null,
          p_notes: "Concurrent 1",
          p_idempotency_key: randomUUID(),
        }),
        managerClient.rpc("issue_replacement_refund", {
          p_org_id: orgId,
          p_failed_refund_id: refundId,
          p_refund_method: "cash",
          p_reference_no: null,
          p_notes: "Concurrent 2",
          p_idempotency_key: randomUUID(),
        }),
      ]);

      const successes = [res1, res2].filter((r) => r.data?.success === true);
      const failures = [res1, res2].filter((r) => r.error !== null);

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
      expect(failures[0]!.error?.code).toMatch(/P0064|P0067/);
    });

    it("C44-02: Replacement targeting original failed refund acquires lock unconditionally and succeeds", async () => {
      const saleId = await createSaleWithCard(60.0);
      await managerClient.rpc("void_sale", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_void_reason: "Customer request",
        p_idempotency_key: randomUUID(),
      });

      const refundQuery = await pgClient.query(
        "SELECT id, obligation_refund_id FROM public.refunds WHERE organization_id = $1 AND sale_id = $2;",
        [orgId, saleId]
      );
      const r1 = refundQuery.rows[0];
      expect(r1.obligation_refund_id).toBe(r1.id);

      await managerClient.rpc("record_refund_failure", {
        p_org_id: orgId,
        p_refund_id: r1.id,
        p_failure_reason: "Card network unavailable",
      });

      const res = await managerClient.rpc("issue_replacement_refund", {
        p_org_id: orgId,
        p_failed_refund_id: r1.id,
        p_refund_method: "card",
        p_reference_no: `REPL-${randomUUID().slice(0, 6)}`,
        p_idempotency_key: randomUUID(),
      });

      expect(res.data?.success).toBe(true);
      expect(res.data?.obligation_refund_id).toBe(r1.id);
    });

    it("C44-03: Replacement targeting descendant failed refund inherits root obligation_refund_id", async () => {
      const saleId = await createSaleWithCard(60.0);
      await managerClient.rpc("void_sale", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_void_reason: "Mistake",
        p_idempotency_key: randomUUID(),
      });

      const q1 = await pgClient.query("SELECT id FROM public.refunds WHERE sale_id = $1;", [saleId]);
      const r1Id = q1.rows[0].id;

      // Fail R1
      await managerClient.rpc("record_refund_failure", {
        p_org_id: orgId,
        p_refund_id: r1Id,
        p_failure_reason: "Failure 1",
      });

      // Replace R1 -> R2 (pending card)
      const repl1 = await managerClient.rpc("issue_replacement_refund", {
        p_org_id: orgId,
        p_failed_refund_id: r1Id,
        p_refund_method: "card",
        p_reference_no: `REF-R2-${randomUUID().slice(0, 6)}`,
        p_idempotency_key: randomUUID(),
      });
      const r2Id = repl1.data.refund_id;

      // Fail R2 (descendant)
      await managerClient.rpc("record_refund_failure", {
        p_org_id: orgId,
        p_refund_id: r2Id,
        p_failure_reason: "Failure 2",
      });

      // Replace targeting R2 -> R3
      const repl2 = await managerClient.rpc("issue_replacement_refund", {
        p_org_id: orgId,
        p_failed_refund_id: r2Id,
        p_refund_method: "cash",
        p_reference_no: null,
        p_idempotency_key: randomUUID(),
      });

      expect(repl2.data?.success).toBe(true);
      expect(repl2.data?.obligation_refund_id).toBe(r1Id); // Inherits root obligation R1!
    });

    it("C44-04: Replacement when obligation already completed is rejected with P0067", async () => {
      const saleId = await createSaleWithCard(60.0);
      await managerClient.rpc("void_sale", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_void_reason: "Return item",
        p_idempotency_key: randomUUID(),
      });

      const q1 = await pgClient.query("SELECT id FROM public.refunds WHERE sale_id = $1;", [saleId]);
      const r1Id = q1.rows[0].id;

      // Confirm R1 as completed
      await managerClient.rpc("confirm_refund_reimbursement", {
        p_org_id: orgId,
        p_refund_id: r1Id,
        p_external_reference: `SETTLE-${randomUUID().slice(0, 6)}`,
        p_idempotency_key: randomUUID(),
      });

      // Attempt to issue replacement for completed obligation
      const res = await managerClient.rpc("issue_replacement_refund", {
        p_org_id: orgId,
        p_failed_refund_id: r1Id,
        p_refund_method: "cash",
        p_idempotency_key: randomUUID(),
      });

      expect(res.data).toBeNull();
      expect(res.error?.code).toMatch(/P0065|P0067|P0064/);
    });

    it("C44-05: Multi-failure chain: R1 -> R2 -> R3 all share obligation_refund_id = R1.id", async () => {
      const saleId = await createSaleWithCard(60.0);
      await managerClient.rpc("void_sale", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_void_reason: "Multi-failure",
        p_idempotency_key: randomUUID(),
      });

      const q1 = await pgClient.query("SELECT id FROM public.refunds WHERE sale_id = $1;", [saleId]);
      const r1Id = q1.rows[0].id;

      await managerClient.rpc("record_refund_failure", { p_org_id: orgId, p_refund_id: r1Id, p_failure_reason: "Failure 1" });

      const res2 = await managerClient.rpc("issue_replacement_refund", {
        p_org_id: orgId,
        p_failed_refund_id: r1Id,
        p_refund_method: "card",
        p_reference_no: "R2-REF",
        p_idempotency_key: randomUUID(),
      });
      const r2Id = res2.data.refund_id;

      await managerClient.rpc("record_refund_failure", { p_org_id: orgId, p_refund_id: r2Id, p_failure_reason: "Failure 2" });

      const res3 = await managerClient.rpc("issue_replacement_refund", {
        p_org_id: orgId,
        p_failed_refund_id: r2Id,
        p_refund_method: "card",
        p_reference_no: "R3-REF",
        p_idempotency_key: randomUUID(),
      });
      const r3Id = res3.data.refund_id;

      const chainQuery = await pgClient.query(
        "SELECT id, obligation_refund_id, parent_refund_id, status FROM public.refunds WHERE id IN ($1, $2, $3) ORDER BY created_at ASC;",
        [r1Id, r2Id, r3Id]
      );

      expect(chainQuery.rows.length).toBe(3);
      expect(chainQuery.rows[0].obligation_refund_id).toBe(r1Id);
      expect(chainQuery.rows[1].obligation_refund_id).toBe(r1Id);
      expect(chainQuery.rows[2].obligation_refund_id).toBe(r1Id);
      expect(chainQuery.rows[1].parent_refund_id).toBe(r1Id);
      expect(chainQuery.rows[2].parent_refund_id).toBe(r2Id);
    });
  });

  // ==========================================================================
  // F005-045 / C45: Composite Foreign Key Integrity & Deferred Constraints
  // ==========================================================================
  describe("C45: Composite Foreign Key Integrity & Deferred Obligation Constraint", () => {
    it("C45-01: Return item referencing sale item from different sale is rejected (23503 / P0048)", async () => {
      const sale1 = await createSaleWithCard(60.0);
      const sale2 = await createSaleWithCard(60.0);

      const itemsSale1 = await pgClient.query("SELECT id FROM public.sale_items WHERE sale_id = $1;", [sale1]);
      const sale1ItemId = itemsSale1.rows[0].id;

      // 1. Test RPC level rejection
      const { data, error } = await managerClient.rpc("execute_sale_return", {
        p_org_id: orgId,
        p_sale_id: sale2,
        p_return_items: [{
          sale_item_id: sale1ItemId,
          quantity: "1.0000",
          restock_to_inventory: true,
        }],
        p_refund_method: "cash",
        p_reason: "Cross-sale test",
        p_idempotency_key: randomUUID(),
      });

      expect(data).toBeNull();
      expect(error?.code).toMatch(/P0048|P0053/);

      // 2. Test direct database composite FK violation
      const returnRes = await pgClient.query(
        `INSERT INTO public.sale_returns (organization_id, sale_id, return_number, total_refund_amount, reason, idempotency_key, idempotency_hash, created_by)
         VALUES ($1, $2, 'RET-CROSS-01', 20.0000, 'Test', $3, 'cross-hash', $4) RETURNING id;`,
        [orgId, sale2, randomUUID(), managerUserId]
      );
      const returnId = returnRes.rows[0].id;

      await expect(
        pgClient.query(
          `INSERT INTO public.sale_return_items (organization_id, sale_id, return_id, sale_item_id, product_id, quantity, refund_amount, restock_to_inventory)
           VALUES ($1, $2, $3, $4, $5, 1.0000, 20.0000, false);`,
          [orgId, sale2, returnId, sale1ItemId, productId1]
        )
      ).rejects.toThrow();
    });

    it("C45-02: Refund with sale_id = S2 and return_id from S1 violates fk_refunds_org_sale_return (23503)", async () => {
      const sale1 = await createSaleWithCard(60.0);
      const sale2 = await createSaleWithCard(60.0);

      // Create return on sale1
      const ret1 = await pgClient.query(
        `INSERT INTO public.sale_returns (organization_id, sale_id, return_number, total_refund_amount, reason, idempotency_key, idempotency_hash, created_by)
         VALUES ($1, $2, 'RET-S1-01', 20.0000, 'Test', $3, 'ret1-hash', $4) RETURNING id;`,
        [orgId, sale1, randomUUID(), managerUserId]
      );
      const return1Id = ret1.rows[0].id;

      // Attempt to insert refund referencing sale2 with return_id from sale1
      const refundId = randomUUID();
      await expect(
        pgClient.query(
          `INSERT INTO public.refunds (id, organization_id, sale_id, return_id, obligation_refund_id, refund_method, amount, status, reason, processed_by)
           VALUES ($1, $2, $3, $4, $1, 'cash', 20.0000, 'completed', 'Test', $5);`,
          [refundId, orgId, sale2, return1Id, managerUserId]
        )
      ).rejects.toThrow();
    });

    it("C45-03: Replacement refund with cross-sale parent_refund_id violates fk_refunds_org_sale_parent (23503)", async () => {
      const sale1 = await createSaleWithCard(60.0);
      const sale2 = await createSaleWithCard(60.0);

      // Create refund on sale1
      const r1Res = await pgClient.query(
        `INSERT INTO public.refunds (id, organization_id, sale_id, obligation_refund_id, refund_method, amount, status, reason, processed_by)
         VALUES ($1, $2, $3, $1, 'card', 20.0000, 'failed', 'Test', $4) RETURNING id;`,
        [randomUUID(), orgId, sale1, managerUserId]
      );
      const r1Id = r1Res.rows[0].id;

      // Attempt replacement refund on sale2 referencing r1Id from sale1 as parent
      const r2Id = randomUUID();
      await expect(
        pgClient.query(
          `INSERT INTO public.refunds (id, organization_id, sale_id, parent_refund_id, obligation_refund_id, refund_method, amount, status, reason, processed_by)
           VALUES ($1, $2, $3, $4, $4, 'card', 20.0000, 'pending', 'Test', $5);`,
          [r2Id, orgId, sale2, r1Id, managerUserId]
        )
      ).rejects.toThrow();
    });

    it("C45-04: void_sale creates original refund with obligation_refund_id = id (self-referencing deferred FK)", async () => {
      const saleId = await createSaleWithCard(60.0);
      const voidRes = await managerClient.rpc("void_sale", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_void_reason: "Customer canceled",
        p_idempotency_key: randomUUID(),
      });
      expect(voidRes.data?.success).toBe(true);

      const q = await pgClient.query(
        "SELECT id, obligation_refund_id, status FROM public.refunds WHERE organization_id = $1 AND sale_id = $2;",
        [orgId, saleId]
      );
      expect(q.rows.length).toBeGreaterThan(0);
      expect(q.rows[0].obligation_refund_id).toBe(q.rows[0].id);
    });

    it("C45-05: execute_sale_return creates original refund with obligation_refund_id = id (self-referencing deferred FK)", async () => {
      const saleId = await createSaleWithCard(60.0);
      const items = await pgClient.query("SELECT id FROM public.sale_items WHERE sale_id = $1;", [saleId]);

      const retRes = await managerClient.rpc("execute_sale_return", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_return_items: [{
          sale_item_id: items.rows[0].id,
          quantity: "1.0000",
          restock_to_inventory: true,
        }],
        p_refund_method: "card",
        p_reference_no: "RET-CARD-AUTH",
        p_reason: "Defective item",
        p_idempotency_key: randomUUID(),
      });
      expect(retRes.data?.success).toBe(true);

      const q = await pgClient.query(
        "SELECT id, obligation_refund_id, return_id FROM public.refunds WHERE organization_id = $1 AND sale_id = $2;",
        [orgId, saleId]
      );
      expect(q.rows.length).toBeGreaterThan(0);
      expect(q.rows[0].obligation_refund_id).toBe(q.rows[0].id);
      expect(q.rows[0].return_id).not.toBeNull();
    });

    it("C45-06: Replacement refund inherits obligation_refund_id from parent chain with valid immediate FK", async () => {
      const saleId = await createSaleWithCard(60.0);
      await managerClient.rpc("void_sale", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_void_reason: "Lineage check",
        p_idempotency_key: randomUUID(),
      });
      const q = await pgClient.query("SELECT id FROM public.refunds WHERE sale_id = $1;", [saleId]);
      const r1Id = q.rows[0].id;

      await managerClient.rpc("record_refund_failure", { p_org_id: orgId, p_refund_id: r1Id, p_failure_reason: "Failed" });

      const replRes = await managerClient.rpc("issue_replacement_refund", {
        p_org_id: orgId,
        p_failed_refund_id: r1Id,
        p_refund_method: "cash",
        p_idempotency_key: randomUUID(),
      });
      expect(replRes.data?.success).toBe(true);

      const r2Id = replRes.data.refund_id;
      const q2 = await pgClient.query("SELECT obligation_refund_id, parent_refund_id FROM public.refunds WHERE id = $1;", [r2Id]);
      expect(q2.rows[0].obligation_refund_id).toBe(r1Id);
      expect(q2.rows[0].parent_refund_id).toBe(r1Id);
    });

    it("C45-07: Refund with obligation_refund_id referencing different tenant is rejected with 23503 at COMMIT", async () => {
      const saleId = await createSaleWithCard(60.0);

      // Create a refund in Org B
      const orgBRefundId = randomUUID();
      const saleB = await pgClient.query(
        `INSERT INTO public.sales (id, organization_id, sale_number, subtotal, total_amount, currency, status, payment_status, idempotency_key, idempotency_hash, created_by)
         VALUES ($1, $2, 'SAL-ORGB-01', 20.0000, 20.0000, 'USD', 'completed', 'paid', $3, 'orgb-hash', $4) RETURNING id;`,
        [randomUUID(), orgBId, randomUUID(), managerUserId]
      );
      await pgClient.query(
        `INSERT INTO public.refunds (id, organization_id, sale_id, obligation_refund_id, refund_method, amount, status, reason, processed_by)
         VALUES ($1, $2, $3, $1, 'card', 20.0000, 'completed', 'OrgB refund', $4);`,
        [orgBRefundId, orgBId, saleB.rows[0].id, managerUserId]
      );

      // Attempt to insert refund in Org A with obligation_refund_id = orgBRefundId
      // In deferred constraint, the violation triggers when committing
      await expect(
        (async () => {
          await pgClient.query("BEGIN;");
          try {
            await pgClient.query(
              `INSERT INTO public.refunds (id, organization_id, sale_id, obligation_refund_id, refund_method, amount, status, reason, processed_by)
               VALUES ($1, $2, $3, $4, 'card', 20.0000, 'pending', 'Cross-tenant obligation test', $5);`,
              [randomUUID(), orgId, saleId, orgBRefundId, managerUserId]
            );
            await pgClient.query("COMMIT;");
          } catch (err) {
            await pgClient.query("ROLLBACK;");
            throw err;
          }
        })()
      ).rejects.toThrow();
    });
  });

  // ==========================================================================
  // F005-046 / C46: Confirmation Idempotency Key Cases (A through E)
  // ==========================================================================
  describe("C46: Confirmation Idempotency Key Cases (A-E)", () => {
    it("C46-A: Idempotent replay of confirmed refund returns cached result", async () => {
      const saleId = await createSaleWithCard(60.0);
      await managerClient.rpc("void_sale", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_void_reason: "Mistake",
        p_idempotency_key: randomUUID(),
      });

      const refundQuery = await pgClient.query(
        "SELECT id FROM public.refunds WHERE organization_id = $1 AND sale_id = $2;",
        [orgId, saleId]
      );
      const refundId = refundQuery.rows[0].id;
      const key = randomUUID();
      const ref = `CONF-REF-${randomUUID().slice(0, 8)}`;

      const call1 = await managerClient.rpc("confirm_refund_reimbursement", {
        p_org_id: orgId,
        p_refund_id: refundId,
        p_external_reference: ref,
        p_idempotency_key: key,
      });
      expect(call1.data.success).toBe(true);
      expect(call1.data.is_replay).toBe(false);

      const call2 = await managerClient.rpc("confirm_refund_reimbursement", {
        p_org_id: orgId,
        p_refund_id: refundId,
        p_external_reference: ref,
        p_idempotency_key: key,
      });
      expect(call2.data.success).toBe(true);
      expect(call2.data.is_replay).toBe(true);
      expect(call2.data.refund_id).toBe(refundId);
    });

    it("C46-B: Payload conflict with different reference under same key raises P0024", async () => {
      const saleId = await createSaleWithCard(60.0);
      await managerClient.rpc("void_sale", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_void_reason: "Mistake",
        p_idempotency_key: randomUUID(),
      });

      const refundQuery = await pgClient.query(
        "SELECT id FROM public.refunds WHERE organization_id = $1 AND sale_id = $2;",
        [orgId, saleId]
      );
      const refundId = refundQuery.rows[0].id;
      const key = randomUUID();

      await managerClient.rpc("confirm_refund_reimbursement", {
        p_org_id: orgId,
        p_refund_id: refundId,
        p_external_reference: "REF-ORIGINAL",
        p_idempotency_key: key,
      });

      const conflictRes = await managerClient.rpc("confirm_refund_reimbursement", {
        p_org_id: orgId,
        p_refund_id: refundId,
        p_external_reference: "REF-MODIFIED",
        p_idempotency_key: key,
      });

      expect(conflictRes.data).toBeNull();
      expect(conflictRes.error?.code).toBe("P0024");
    });

    it("C46-C: Same key + different refund raises P0024 IDEMPOTENCY_CONFLICT (not raw 23505)", async () => {
      const sale1 = await createSaleWithCard(60.0);
      const sale2 = await createSaleWithCard(60.0);
      await managerClient.rpc("void_sale", { p_org_id: orgId, p_sale_id: sale1, p_void_reason: "Reason 1", p_idempotency_key: randomUUID() });
      await managerClient.rpc("void_sale", { p_org_id: orgId, p_sale_id: sale2, p_void_reason: "Reason 2", p_idempotency_key: randomUUID() });

      const q1 = await pgClient.query("SELECT id FROM public.refunds WHERE sale_id = $1;", [sale1]);
      const q2 = await pgClient.query("SELECT id FROM public.refunds WHERE sale_id = $1;", [sale2]);
      const ref1 = q1.rows[0].id;
      const ref2 = q2.rows[0].id;

      const reusedKey = randomUUID();
      await managerClient.rpc("confirm_refund_reimbursement", {
        p_org_id: orgId,
        p_refund_id: ref1,
        p_external_reference: "REF-1",
        p_idempotency_key: reusedKey,
      });

      // Confirming ref2 with same reusedKey
      const res = await managerClient.rpc("confirm_refund_reimbursement", {
        p_org_id: orgId,
        p_refund_id: ref2,
        p_external_reference: "REF-2",
        p_idempotency_key: reusedKey,
      });

      expect(res.data).toBeNull();
      expect(res.error?.code).toBe("P0024");
    });

    it("C46-D: Different key + already completed refund raises P0062 REFUND_ALREADY_SETTLED", async () => {
      const saleId = await createSaleWithCard(60.0);
      await managerClient.rpc("void_sale", { p_org_id: orgId, p_sale_id: saleId, p_void_reason: "Settle check", p_idempotency_key: randomUUID() });

      const q = await pgClient.query("SELECT id FROM public.refunds WHERE sale_id = $1;", [saleId]);
      const refundId = q.rows[0].id;

      await managerClient.rpc("confirm_refund_reimbursement", {
        p_org_id: orgId,
        p_refund_id: refundId,
        p_external_reference: "REF-FIRST",
        p_idempotency_key: randomUUID(),
      });

      // Different key on already completed refund
      const secondCall = await managerClient.rpc("confirm_refund_reimbursement", {
        p_org_id: orgId,
        p_refund_id: refundId,
        p_external_reference: "REF-SECOND",
        p_idempotency_key: randomUUID(),
      });

      expect(secondCall.data).toBeNull();
      expect(secondCall.error?.code).toBe("P0062");
    });

    it("C46-E: Two concurrent confirmations serialize cleanly under advisory lock", async () => {
      const saleId = await createSaleWithCard(60.0);
      await managerClient.rpc("void_sale", { p_org_id: orgId, p_sale_id: saleId, p_void_reason: "Concurrent test", p_idempotency_key: randomUUID() });

      const q = await pgClient.query("SELECT id FROM public.refunds WHERE sale_id = $1;", [saleId]);
      const refundId = q.rows[0].id;
      const sharedKey = randomUUID();
      const sharedRef = `AUTH-CONC-${randomUUID().slice(0, 6)}`;

      const [res1, res2] = await Promise.all([
        managerClient.rpc("confirm_refund_reimbursement", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_external_reference: sharedRef,
          p_idempotency_key: sharedKey,
        }),
        managerClient.rpc("confirm_refund_reimbursement", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_external_reference: sharedRef,
          p_idempotency_key: sharedKey,
        }),
      ]);

      const replays = [res1, res2].filter((r) => r.data?.is_replay === true);
      const originals = [res1, res2].filter((r) => r.data?.is_replay === false);

      expect(originals.length).toBe(1);
      expect(replays.length).toBe(1);
      expect(res1.data?.success).toBe(true);
      expect(res2.data?.success).toBe(true);
    });
  });

  // ==========================================================================
  // F005-047 / C47: Payment Canonical Normalization & Hash Discrimination
  // ==========================================================================
  describe("C47: Canonical Normalization & Hash Discrimination", () => {
    it("C47-01: Same payment, different amount_tendered produces distinct hash and raises P0024 on key reuse", async () => {
      const key = randomUUID();

      // Isolate amount_tendered: payment_method, amount, change_due, and reference_no are identical; only amount_tendered changes
      const call1 = await cashierClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [{ product_id: productId1, quantity: "1.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "20.0000", amount_tendered: "30.0000", change_due: "10.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: key,
      });
      expect(call1.data?.success).toBe(true);

      const call2 = await cashierClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [{ product_id: productId1, quantity: "1.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "20.0000", amount_tendered: "50.0000", change_due: "10.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: key,
      });
      expect(call2.data).toBeNull();
      expect(call2.error?.code).toBe("P0024");
    });

    it("C47-02: Same payment, different change_due produces distinct hash and raises P0024 on key reuse", async () => {
      const key = randomUUID();

      const call1 = await cashierClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [{ product_id: productId1, quantity: "1.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "20.0000", amount_tendered: "30.0000", change_due: "10.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: key,
      });
      expect(call1.data?.success).toBe(true);

      const call2 = await cashierClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [{ product_id: productId1, quantity: "1.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "20.0000", amount_tendered: "30.0000", change_due: "5.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: key,
      });
      expect(call2.data).toBeNull();
      expect(call2.error?.code).toBe("P0024");
    });

    it("C47-03: reference_no null vs empty vs whitespace normalizes to null and returns is_replay = true", async () => {
      const key = randomUUID();

      // Call 1: Whitespace-only reference ("   ") creates initial sale
      const call1 = await cashierClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [{ product_id: productId1, quantity: "1.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "20.0000", reference_no: "   " }],
        p_order_discount_amount: 0,
        p_idempotency_key: key,
      });
      expect(call1.data?.success).toBe(true);
      expect(call1.data?.is_replay).toBe(false);

      // Call 2: Empty string reference ("") normalizes to null and returns is_replay = true
      const call2 = await cashierClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [{ product_id: productId1, quantity: "1.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "20.0000", reference_no: "" }],
        p_order_discount_amount: 0,
        p_idempotency_key: key,
      });
      expect(call2.data?.is_replay).toBe(true);
      expect(call2.data?.sale_id).toBe(call1.data.sale_id);

      // Call 3: Explicit null reference normalizes to null and returns is_replay = true
      const call3 = await cashierClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [{ product_id: productId1, quantity: "1.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "20.0000", reference_no: null }],
        p_order_discount_amount: 0,
        p_idempotency_key: key,
      });
      expect(call3.data?.is_replay).toBe(true);
      expect(call3.data?.sale_id).toBe(call1.data.sale_id);
    });

    it("C47-04: Payments in different array order sort deterministically and return is_replay = true", async () => {
      const key = randomUUID();
      const pmtA = { payment_method: "cash", amount: "20.0000" };
      const pmtB = { payment_method: "card", amount: "40.0000", reference_no: "AUTH-CARD-1" };

      const call1 = await cashierClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [
          { product_id: productId1, quantity: "1.0000", line_discount_amount: "0.0000" },
          { product_id: productId2, quantity: "1.0000", line_discount_amount: "0.0000" },
        ],
        p_payments: [pmtA, pmtB],
        p_order_discount_amount: 0,
        p_idempotency_key: key,
      });
      expect(call1.data?.success).toBe(true);

      // Replay with reversed payment array order
      const call2 = await cashierClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [
          { product_id: productId1, quantity: "1.0000", line_discount_amount: "0.0000" },
          { product_id: productId2, quantity: "1.0000", line_discount_amount: "0.0000" },
        ],
        p_payments: [pmtB, pmtA],
        p_order_discount_amount: 0,
        p_idempotency_key: key,
      });
      expect(call2.data?.is_replay).toBe(true);
      expect(call2.data?.sale_id).toBe(call1.data.sale_id);
    });

    it("C47-05: Identical replay returns success with is_replay = true and same sale_id", async () => {
      const key = randomUUID();
      const payload = {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [{ product_id: productId1, quantity: "1.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "20.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: key,
      };

      const call1 = await cashierClient.rpc("execute_sale", payload);
      expect(call1.data?.success).toBe(true);
      expect(call1.data?.is_replay).toBe(false);

      const call2 = await cashierClient.rpc("execute_sale", payload);
      expect(call2.data?.success).toBe(true);
      expect(call2.data?.is_replay).toBe(true);
      expect(call2.data?.sale_id).toBe(call1.data.sale_id);
    });
  });
});
