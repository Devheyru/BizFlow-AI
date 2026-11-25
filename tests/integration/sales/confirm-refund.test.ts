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

describeIntegration(
  "T086: confirm_refund_reimbursement Integration Tests (F005-046 Cases A-E)",
  () => {
    let pgClient: PgClient;
    let adminClient: SupabaseClient;
    let ownerClient: SupabaseClient;
    let managerClient: SupabaseClient;
    let cashierClient: SupabaseClient;

    let orgId: string;
    let ownerUserId: string;
    let managerUserId: string;
    let cashierUserId: string;

    let productId: string;
    let customerId: string;

    const timestamp = Date.now();
    const testPassword = "Password123!SecureTest";

    beforeAll(async () => {
      pgClient = new PgClient({ connectionString: dbUrl });
      await pgClient.connect();

      adminClient = createClient(supabaseUrl, serviceRoleKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const ownerEmail = `conf-owner-${timestamp}@example.com`;
      const mgrEmail = `conf-mgr-${timestamp}@example.com`;
      const cashEmail = `conf-cash-${timestamp}@example.com`;

      const uOwner = await adminClient.auth.admin.createUser({
        email: ownerEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "Conf", last_name: "Owner" },
      });
      ownerUserId = uOwner.data.user!.id;

      const uMgr = await adminClient.auth.admin.createUser({
        email: mgrEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "Conf", last_name: "Manager" },
      });
      managerUserId = uMgr.data.user!.id;

      const uCash = await adminClient.auth.admin.createUser({
        email: cashEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "Conf", last_name: "Cashier" },
      });
      cashierUserId = uCash.data.user!.id;

      // Profiles
      await pgClient.query(
        `INSERT INTO public.profiles (id, first_name, last_name)
         VALUES
           ($1, 'Conf', 'Owner'),
           ($2, 'Conf', 'Manager'),
           ($3, 'Conf', 'Cashier')
         ON CONFLICT (id) DO NOTHING;`,
        [ownerUserId, managerUserId, cashierUserId]
      );

      // Org
      const resOrg = await pgClient.query(
        `INSERT INTO public.organizations (name, slug, business_type, country, currency, timezone, created_by)
         VALUES ('Confirm Refund Org', $1, 'retail', 'US', 'USD', 'America/New_York', $2)
         RETURNING id;`,
        [`conf-org-${timestamp}`, ownerUserId]
      );
      orgId = resOrg.rows[0].id;

      // Memberships
      await pgClient.query(
        `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
         VALUES
           ($1, $2, 'owner', 'active'),
           ($1, $3, 'manager', 'active'),
           ($1, $4, 'cashier', 'active');`,
        [orgId, ownerUserId, managerUserId, cashierUserId]
      );

      // Tax Settings
      await pgClient.query(
        `INSERT INTO public.organization_tax_settings (organization_id, tax_name, default_tax_rate, is_tax_inclusive, updated_by)
         VALUES ($1, 'Sales Tax', 0.0000, false, $2)
         ON CONFLICT (organization_id) DO NOTHING;`,
        [orgId, ownerUserId]
      );

      // Customer
      const resCust = await pgClient.query(
        `INSERT INTO public.customers (organization_id, name, phone, email)
         VALUES ($1, 'Confirm Cust', $2, $3)
         RETURNING id;`,
        [orgId, `+1917${Math.floor(1000000 + Math.random() * 9000000)}`, `conf-cust-${timestamp}@example.com`]
      );
      customerId = resCust.rows[0].id;

      // Product
      const resProd = await pgClient.query(
        `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
         VALUES ($1, 'Card Sale Product', $2, 100.0000, 'piece', 'active', $3, $3)
         RETURNING id;`,
        [orgId, `SKU-CONF-${timestamp}`, ownerUserId]
      );
      productId = resProd.rows[0].id;

      await pgClient.query(
        `INSERT INTO public.product_costs (organization_id, product_id, cost_price)
         VALUES ($1, $2, 40.0000);`,
        [orgId, productId]
      );

      await pgClient.query(
        `UPDATE public.inventory
         SET quantity = 500.0000, version = 1
         WHERE organization_id = $1 AND product_id = $2;`,
        [orgId, productId]
      );

      // Auth clients
      ownerClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
      await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

      managerClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
      await managerClient.auth.signInWithPassword({ email: mgrEmail, password: testPassword });

      cashierClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
      await cashierClient.auth.signInWithPassword({ email: cashEmail, password: testPassword });
    });

    afterAll(async () => {
      try {
        if (pgClient && orgId) {
          await pgClient.query("DELETE FROM public.refunds WHERE organization_id = $1;", [orgId]);
          await pgClient.query("DELETE FROM public.payments WHERE organization_id = $1;", [orgId]);
          await pgClient.query("DELETE FROM public.sale_items WHERE organization_id = $1;", [orgId]);
          await pgClient.query("DELETE FROM public.sales WHERE organization_id = $1;", [orgId]);
          await pgClient.query("DELETE FROM public.inventory WHERE organization_id = $1;", [orgId]);
          await pgClient.query("DELETE FROM public.product_costs WHERE organization_id = $1;", [orgId]);
          await pgClient.query("DELETE FROM public.products WHERE organization_id = $1;", [orgId]);
          await pgClient.query("DELETE FROM public.customers WHERE organization_id = $1;", [orgId]);
          await pgClient.query("DELETE FROM public.organization_tax_settings WHERE organization_id = $1;", [orgId]);
          try {
            await pgClient.query("ALTER TABLE public.organization_memberships DISABLE TRIGGER USER;");
            await pgClient.query("DELETE FROM public.organizations WHERE id = $1;", [orgId]);
          } finally {
            await pgClient.query("ALTER TABLE public.organization_memberships ENABLE TRIGGER USER;");
          }
        }
      } catch {
        // Ignore cleanup errors
      }

      if (adminClient) {
        if (ownerUserId) await adminClient.auth.admin.deleteUser(ownerUserId).catch(() => {});
        if (managerUserId) await adminClient.auth.admin.deleteUser(managerUserId).catch(() => {});
        if (cashierUserId) await adminClient.auth.admin.deleteUser(cashierUserId).catch(() => {});
      }

      if (pgClient) {
        await pgClient.end().catch(() => {});
      }
    });

    async function createVoidedCardSale() {
      const saleKey = randomUUID();
      const saleRes = await cashierClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: customerId,
        p_items: [{ product_id: productId, quantity: "1.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "card", amount: "100.0000", reference_no: `AUTH-CARD-${randomUUID().slice(0, 8)}` }],
        p_order_discount_amount: 0,
        p_idempotency_key: saleKey,
      });

      expect(saleRes.error).toBeNull();
      const saleId = saleRes.data.sale_id;

      // Void sale to produce pending card refund
      const voidKey = randomUUID();
      const voidRes = await managerClient.rpc("void_sale", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_void_reason: "Customer void requested",
        p_idempotency_key: voidKey,
        p_reversal_references: null,
      });
      expect(voidRes.error).toBeNull();

      const refRows = await pgClient.query(
        `SELECT * FROM public.refunds WHERE organization_id = $1 AND sale_id = $2 AND status = 'pending';`,
        [orgId, saleId]
      );
      expect(refRows.rows.length).toBe(1);

      return {
        saleId,
        refundId: refRows.rows[0].id,
      };
    }

    it("F005-046 Case A: idempotent replay with identical parameters returns is_replay = true", async () => {
      const { refundId } = await createVoidedCardSale();
      const confirmKey = randomUUID();

      // First call
      const firstRes = await managerClient.rpc("confirm_refund_reimbursement", {
        p_org_id: orgId,
        p_refund_id: refundId,
        p_external_reference: "REV-CARD-A",
        p_idempotency_key: confirmKey,
      });

      expect(firstRes.error).toBeNull();
      expect(firstRes.data.success).toBe(true);
      expect(firstRes.data.is_replay).toBe(false);
      expect(firstRes.data.status).toBe("completed");

      // Identical replay
      const replayRes = await managerClient.rpc("confirm_refund_reimbursement", {
        p_org_id: orgId,
        p_refund_id: refundId,
        p_external_reference: "REV-CARD-A",
        p_idempotency_key: confirmKey,
      });

      expect(replayRes.error).toBeNull();
      expect(replayRes.data.success).toBe(true);
      expect(replayRes.data.is_replay).toBe(true);
      expect(replayRes.data.status).toBe("completed");
    });

    it("F005-046 Case B: replay with same idempotency key but altered reference raises P0024", async () => {
      const { refundId } = await createVoidedCardSale();
      const confirmKey = randomUUID();

      await managerClient.rpc("confirm_refund_reimbursement", {
        p_org_id: orgId,
        p_refund_id: refundId,
        p_external_reference: "REV-CARD-B-ORIGINAL",
        p_idempotency_key: confirmKey,
      });

      const conflictRes = await managerClient.rpc("confirm_refund_reimbursement", {
        p_org_id: orgId,
        p_refund_id: refundId,
        p_external_reference: "REV-CARD-B-MODIFIED",
        p_idempotency_key: confirmKey,
      });

      expect(conflictRes.data).toBeNull();
      expect(conflictRes.error?.code).toBe("P0024");
    });

    it("F005-046 Case C: reusing idempotency key across different refunds raises P0024", async () => {
      const sale1 = await createVoidedCardSale();
      const sale2 = await createVoidedCardSale();
      const reusedKey = randomUUID();

      await managerClient.rpc("confirm_refund_reimbursement", {
        p_org_id: orgId,
        p_refund_id: sale1.refundId,
        p_external_reference: "REV-CARD-C",
        p_idempotency_key: reusedKey,
      });

      const collisionRes = await managerClient.rpc("confirm_refund_reimbursement", {
        p_org_id: orgId,
        p_refund_id: sale2.refundId,
        p_external_reference: "REV-CARD-C",
        p_idempotency_key: reusedKey,
      });

      expect(collisionRes.data).toBeNull();
      expect(collisionRes.error?.code).toBe("P0024");
    });

    it("F005-046 Case D: confirming an already completed refund with a new key raises P0062", async () => {
      const { refundId } = await createVoidedCardSale();
      const firstKey = randomUUID();
      const secondKey = randomUUID();

      await managerClient.rpc("confirm_refund_reimbursement", {
        p_org_id: orgId,
        p_refund_id: refundId,
        p_external_reference: "REV-CARD-D1",
        p_idempotency_key: firstKey,
      });

      const settleRes = await managerClient.rpc("confirm_refund_reimbursement", {
        p_org_id: orgId,
        p_refund_id: refundId,
        p_external_reference: "REV-CARD-D2",
        p_idempotency_key: secondKey,
      });

      expect(settleRes.data).toBeNull();
      expect(settleRes.error?.code).toBe("P0062");
    });

    it("F005-046 Case E: concurrent confirmation requests serialize cleanly", async () => {
      const { refundId } = await createVoidedCardSale();
      const sharedKey = randomUUID();

      const [res1, res2] = await Promise.all([
        managerClient.rpc("confirm_refund_reimbursement", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_external_reference: "REV-CARD-CONCURRENT",
          p_idempotency_key: sharedKey,
        }),
        managerClient.rpc("confirm_refund_reimbursement", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_external_reference: "REV-CARD-CONCURRENT",
          p_idempotency_key: sharedKey,
        }),
      ]);

      expect(res1.error).toBeNull();
      expect(res2.error).toBeNull();
      expect(res1.data.success).toBe(true);
      expect(res2.data.success).toBe(true);

      const replayCount = (res1.data.is_replay ? 1 : 0) + (res2.data.is_replay ? 1 : 0);
      expect(replayCount).toBe(1); // Exactly one initial, one replay
    });
  }
);
