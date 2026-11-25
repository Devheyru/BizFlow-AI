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
  "T087: Refund Lifecycle RPCs (record_refund_failure & issue_replacement_refund)",
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

      const ownerEmail = `lifec-owner-${timestamp}@example.com`;
      const mgrEmail = `lifec-mgr-${timestamp}@example.com`;
      const cashEmail = `lifec-cash-${timestamp}@example.com`;

      const uOwner = await adminClient.auth.admin.createUser({
        email: ownerEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "LifeC", last_name: "Owner" },
      });
      ownerUserId = uOwner.data.user!.id;

      const uMgr = await adminClient.auth.admin.createUser({
        email: mgrEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "LifeC", last_name: "Manager" },
      });
      managerUserId = uMgr.data.user!.id;

      const uCash = await adminClient.auth.admin.createUser({
        email: cashEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "LifeC", last_name: "Cashier" },
      });
      cashierUserId = uCash.data.user!.id;

      // Profiles
      await pgClient.query(
        `INSERT INTO public.profiles (id, first_name, last_name)
         VALUES
           ($1, 'LifeC', 'Owner'),
           ($2, 'LifeC', 'Manager'),
           ($3, 'LifeC', 'Cashier')
         ON CONFLICT (id) DO NOTHING;`,
        [ownerUserId, managerUserId, cashierUserId]
      );

      // Org
      const resOrg = await pgClient.query(
        `INSERT INTO public.organizations (name, slug, business_type, country, currency, timezone, created_by)
         VALUES ('Refund Lifecycle Org', $1, 'retail', 'US', 'USD', 'America/New_York', $2)
         RETURNING id;`,
        [`lifec-org-${timestamp}`, ownerUserId]
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
         VALUES ($1, 'LifeC Cust', $2, $3)
         RETURNING id;`,
        [orgId, `+1917${Math.floor(1000000 + Math.random() * 9000000)}`, `lifec-cust-${timestamp}@example.com`]
      );
      customerId = resCust.rows[0].id;

      // Product
      const resProd = await pgClient.query(
        `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
         VALUES ($1, 'LifeC Product', $2, 80.0000, 'piece', 'active', $3, $3)
         RETURNING id;`,
        [orgId, `SKU-LIFEC-${timestamp}`, ownerUserId]
      );
      productId = resProd.rows[0].id;

      await pgClient.query(
        `INSERT INTO public.product_costs (organization_id, product_id, cost_price)
         VALUES ($1, $2, 30.0000);`,
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
        p_payments: [{ payment_method: "card", amount: "80.0000", reference_no: `AUTH-CARD-${randomUUID().slice(0, 8)}` }],
        p_order_discount_amount: 0,
        p_idempotency_key: saleKey,
      });
      const saleId = saleRes.data.sale_id;

      const voidKey = randomUUID();
      await managerClient.rpc("void_sale", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_void_reason: "Customer void requested",
        p_idempotency_key: voidKey,
        p_reversal_references: null,
      });

      const refRows = await pgClient.query(
        `SELECT * FROM public.refunds WHERE organization_id = $1 AND sale_id = $2 AND status = 'pending';`,
        [orgId, saleId]
      );

      return {
        saleId,
        refundId: refRows.rows[0].id,
        obligationRefundId: refRows.rows[0].obligation_refund_id,
        amount: parseFloat(refRows.rows[0].amount),
      };
    }

    describe("record_refund_failure RPC", () => {
      it("records failure with reason and updates status to failed", async () => {
        const { refundId } = await createVoidedCardSale();

        const { data, error } = await managerClient.rpc("record_refund_failure", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_failure_reason: "Payment gateway card network declined reimbursement",
        });

        expect(error).toBeNull();
        expect(data.success).toBe(true);
        expect(data.status).toBe("failed");
        expect(data.failure_reason).toContain("declined");

        const refRow = await pgClient.query("SELECT * FROM public.refunds WHERE id = $1;", [refundId]);
        expect(refRow.rows[0].status).toBe("failed");
        expect(refRow.rows[0].reason).toContain("Payment gateway card network declined reimbursement");
      });

      it("rejects failure recording on already settled refund with P0062", async () => {
        const { refundId } = await createVoidedCardSale();

        // Settle refund
        await managerClient.rpc("confirm_refund_reimbursement", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_external_reference: "REV-SETTLED",
          p_idempotency_key: randomUUID(),
        });

        // Attempt recording failure
        const { data, error } = await managerClient.rpc("record_refund_failure", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_failure_reason: "Too late to fail",
        });

        expect(data).toBeNull();
        expect(error?.code).toBe("P0062");
      });
    });

    describe("issue_replacement_refund RPC", () => {
      it("rejects replacement when target refund is not in failed status with P0065", async () => {
        const { refundId } = await createVoidedCardSale();

        // Target refund is still pending!
        const { data, error } = await managerClient.rpc("issue_replacement_refund", {
          p_org_id: orgId,
          p_failed_refund_id: refundId,
          p_refund_method: "cash",
          p_idempotency_key: randomUUID(),
          p_reference_no: null,
          p_notes: null,
        });

        expect(data).toBeNull();
        expect(error?.code).toBe("P0065");
      });

      it("issues cash replacement for failed refund, setting status = completed immediately and preserving obligation tracking (F005-044)", async () => {
        const { refundId, obligationRefundId } = await createVoidedCardSale();

        // 1. Record failure
        await managerClient.rpc("record_refund_failure", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_failure_reason: "Customer card account closed",
        });

        // 2. Issue cash replacement
        const replKey = randomUUID();
        const { data, error } = await managerClient.rpc("issue_replacement_refund", {
          p_org_id: orgId,
          p_failed_refund_id: refundId,
          p_refund_method: "cash",
          p_idempotency_key: replKey,
          p_reference_no: null,
          p_notes: null,
        });

        expect(error).toBeNull();
        expect(data.success).toBe(true);
        expect(data.status).toBe("completed");
        expect(data.obligation_refund_id).toBe(obligationRefundId);
        expect(data.payment_status).toBe("refunded");

        // Verify database link
        const replRow = await pgClient.query("SELECT * FROM public.refunds WHERE id = $1;", [data.refund_id]);
        expect(replRow.rows[0].parent_refund_id).toBe(refundId);
        expect(replRow.rows[0].obligation_refund_id).toBe(obligationRefundId);
        expect(replRow.rows[0].status).toBe("completed");
      });

      it("rejects another replacement after obligation reached completed status with P0067", async () => {
        const { refundId } = await createVoidedCardSale();

        await managerClient.rpc("record_refund_failure", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_failure_reason: "Declined",
        });

        // Cash replacement satisfies obligation completely
        await managerClient.rpc("issue_replacement_refund", {
          p_org_id: orgId,
          p_failed_refund_id: refundId,
          p_refund_method: "cash",
          p_reference_no: null,
          p_notes: null,
          p_idempotency_key: randomUUID(),
        });

        // Attempting another replacement against failed refund
        const { data, error } = await managerClient.rpc("issue_replacement_refund", {
          p_org_id: orgId,
          p_failed_refund_id: refundId,
          p_refund_method: "cash",
          p_idempotency_key: randomUUID(),
          p_reference_no: null,
          p_notes: null,
        });

        expect(data).toBeNull();
        expect(error?.code).toBe("P0067");
      });

      it("rejects concurrent / duplicate replacement when active pending attempt exists with P0064", async () => {
        const { refundId } = await createVoidedCardSale();

        await managerClient.rpc("record_refund_failure", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_failure_reason: "First card declined",
        });

        // Replacement to card (pending)
        await managerClient.rpc("issue_replacement_refund", {
          p_org_id: orgId,
          p_failed_refund_id: refundId,
          p_refund_method: "card",
          p_idempotency_key: randomUUID(),
          p_reference_no: null,
          p_notes: null,
        });

        // Attempting second replacement while first is pending
        const { data, error } = await managerClient.rpc("issue_replacement_refund", {
          p_org_id: orgId,
          p_failed_refund_id: refundId,
          p_refund_method: "cash",
          p_idempotency_key: randomUUID(),
          p_reference_no: null,
          p_notes: null,
        });

        expect(data).toBeNull();
        expect(error?.code).toBe("P0064");
      });

      it("supports multi-failure chain R1 -> R2 -> R3", async () => {
        const { refundId: r1Id, obligationRefundId } = await createVoidedCardSale();

        // 1. Fail R1
        await managerClient.rpc("record_refund_failure", {
          p_org_id: orgId,
          p_refund_id: r1Id,
          p_failure_reason: "R1 failed",
        });

        // 2. Replace R1 with R2 (card, pending)
        const r2Res = await managerClient.rpc("issue_replacement_refund", {
          p_org_id: orgId,
          p_failed_refund_id: r1Id,
          p_refund_method: "card",
          p_idempotency_key: randomUUID(),
          p_reference_no: null,
          p_notes: null,
        });
        const r2Id = r2Res.data.refund_id;

        // 3. Fail R2
        await managerClient.rpc("record_refund_failure", {
          p_org_id: orgId,
          p_refund_id: r2Id,
          p_failure_reason: "R2 failed as well",
        });

        // 4. Replace R2 with R3 (cash, completed)
        const r3Res = await managerClient.rpc("issue_replacement_refund", {
          p_org_id: orgId,
          p_failed_refund_id: r2Id,
          p_refund_method: "cash",
          p_idempotency_key: randomUUID(),
          p_reference_no: null,
          p_notes: null,
        });

        expect(r3Res.data.success).toBe(true);
        expect(r3Res.data.status).toBe("completed");
        expect(r3Res.data.obligation_refund_id).toBe(obligationRefundId);

        // Verify chain in database
        const r3Row = await pgClient.query("SELECT * FROM public.refunds WHERE id = $1;", [r3Res.data.refund_id]);
        expect(r3Row.rows[0].parent_refund_id).toBe(r2Id);
        expect(r3Row.rows[0].obligation_refund_id).toBe(obligationRefundId);
      });
    });
  }
);
