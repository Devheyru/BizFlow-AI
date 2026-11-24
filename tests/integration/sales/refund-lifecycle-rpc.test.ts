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
  "Feature 005 — Phase 8 Refund Reimbursement Lifecycle & RPC Integration Tests (T072–T076, US7)",
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

    let productId1: string;
    let customerId: string;

    const timestamp = Date.now();
    const testPassword = "Password123!SecureTest";

    beforeAll(async () => {
      pgClient = new PgClient({ connectionString: dbUrl });
      await pgClient.connect();

      adminClient = createClient(supabaseUrl, serviceRoleKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      // 1. Create Users
      const ownerEmail = `refund-owner-${timestamp}@example.com`;
      const uOwner = await adminClient.auth.admin.createUser({
        email: ownerEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "Refund", last_name: "Owner" },
      });
      ownerUserId = uOwner.data.user!.id;

      const mgrEmail = `refund-mgr-${timestamp}@example.com`;
      const uMgr = await adminClient.auth.admin.createUser({
        email: mgrEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "Refund", last_name: "Manager" },
      });
      managerUserId = uMgr.data.user!.id;

      const cashEmail = `refund-cash-${timestamp}@example.com`;
      const uCash = await adminClient.auth.admin.createUser({
        email: cashEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "Refund", last_name: "Cashier" },
      });
      cashierUserId = uCash.data.user!.id;

      // 2. Insert Profiles
      await pgClient.query(
        `INSERT INTO public.profiles (id, first_name, last_name)
         VALUES
           ($1, 'Refund', 'Owner'),
           ($2, 'Refund', 'Manager'),
           ($3, 'Refund', 'Cashier')
         ON CONFLICT (id) DO NOTHING;`,
        [ownerUserId, managerUserId, cashierUserId]
      );

      // 3. Create Org
      const orgSlug = `refund-org-${timestamp}`;
      const resOrg = await pgClient.query(
        `INSERT INTO public.organizations (name, slug, business_type, country, currency, timezone, created_by)
         VALUES ('Refund Lifecycle Org', $1, 'retail', 'US', 'USD', 'America/New_York', $2)
         RETURNING id;`,
        [orgSlug, ownerUserId]
      );
      orgId = resOrg.rows[0].id;

      // 4. Memberships
      await pgClient.query(
        `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
         VALUES
           ($1, $2, 'owner', 'active'),
           ($1, $3, 'manager', 'active'),
           ($1, $4, 'cashier', 'active');`,
        [orgId, ownerUserId, managerUserId, cashierUserId]
      );

      // 5. Tax Settings
      await pgClient.query(
        `INSERT INTO public.organization_tax_settings (organization_id, tax_name, default_tax_rate, is_tax_inclusive, updated_by)
         VALUES ($1, 'Sales Tax', 0.0000, false, $2)
         ON CONFLICT (organization_id) DO UPDATE SET default_tax_rate = 0.0000;`,
        [orgId, ownerUserId]
      );

      // 6. Products and Stock
      const p1Res = await pgClient.query(
        `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
         VALUES ($1, 'Refundable Widget', 'REF-SKU-1', 50.0000, 'piece', 'active', $2, $2)
         RETURNING id;`,
        [orgId, ownerUserId]
      );
      productId1 = p1Res.rows[0].id;

      await pgClient.query(
        `INSERT INTO public.inventory (organization_id, product_id, quantity)
         VALUES ($1, $2, 200.0000)
         ON CONFLICT (organization_id, product_id) DO UPDATE SET quantity = 200.0000;`,
        [orgId, productId1]
      );

      // 7. Customer
      const custRes = await pgClient.query(
        `INSERT INTO public.customers (organization_id, name, phone, email, status)
         VALUES ($1, 'Refund Test Customer', '+15555550299', 'refund.cust@example.com', 'active')
         RETURNING id;`,
        [orgId]
      );
      customerId = custRes.rows[0].id;

      // 8. Sign in client sessions
      ownerClient = createClient(supabaseUrl, anonKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

      managerClient = createClient(supabaseUrl, anonKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await managerClient.auth.signInWithPassword({ email: mgrEmail, password: testPassword });

      cashierClient = createClient(supabaseUrl, anonKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await cashierClient.auth.signInWithPassword({ email: cashEmail, password: testPassword });
    });

    afterAll(async () => {
      try {
        if (pgClient) {
          await pgClient.query(`SET session_replication_role = 'replica';`);
          if (orgId) {
            await pgClient.query(`DELETE FROM public.refunds WHERE organization_id = $1;`, [orgId]);
            await pgClient.query(`DELETE FROM public.sale_returns WHERE organization_id = $1;`, [orgId]);
            await pgClient.query(`DELETE FROM public.payments WHERE organization_id = $1;`, [orgId]);
            await pgClient.query(`DELETE FROM public.sale_items WHERE organization_id = $1;`, [orgId]);
            await pgClient.query(`DELETE FROM public.sales WHERE organization_id = $1;`, [orgId]);
            await pgClient.query(`DELETE FROM public.stock_movements WHERE organization_id = $1;`, [orgId]);
            await pgClient.query(`DELETE FROM public.inventory WHERE organization_id = $1;`, [orgId]);
            await pgClient.query(`DELETE FROM public.products WHERE organization_id = $1;`, [orgId]);
            await pgClient.query(`DELETE FROM public.customers WHERE organization_id = $1;`, [orgId]);
            await pgClient.query(`DELETE FROM public.organization_tax_settings WHERE organization_id = $1;`, [orgId]);
            await pgClient.query(`DELETE FROM public.organization_memberships WHERE organization_id = $1;`, [orgId]);
            await pgClient.query(`DELETE FROM public.organizations WHERE id = $1;`, [orgId]);
          }
          await pgClient.query(`SET session_replication_role = 'origin';`);
          await pgClient.end();
        }
      } catch (e) {
        console.error("Cleanup error in afterAll:", e);
      }
    });

    /**
     * Helper to create a completed sale paid via card ($100), then void it,
     * which yields a pending card refund.
     */
    async function createVoidedCardSale(caller: SupabaseClient = managerClient) {
      const saleKey = randomUUID();
      const saleRes = await caller.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: customerId,
        p_items: [{ product_id: productId1, quantity: 2, line_discount_amount: 0 }],
        p_payments: [
          {
            payment_method: "card",
            amount: 100.0,
            amount_tendered: null,
            change_due: null,
            reference_no: `CARD-AUTH-${randomUUID().slice(0, 8)}`,
          },
        ],
        p_order_discount_amount: 0,
        p_idempotency_key: saleKey,
      });

      expect(saleRes.error).toBeNull();
      const saleId = saleRes.data.sale_id;

      // Void the sale to create pending card refund
      const voidKey = randomUUID();
      const voidRes = await caller.rpc("void_sale", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_void_reason: "Customer void requested",
        p_idempotency_key: voidKey,
        p_reversal_references: null,
      });

      expect(voidRes.error).toBeNull();

      // Retrieve the pending refund
      const refRows = await pgClient.query(
        `SELECT * FROM public.refunds WHERE organization_id = $1 AND sale_id = $2 AND status = 'pending';`,
        [orgId, saleId]
      );

      expect(refRows.rows.length).toBe(1);
      const refund = refRows.rows[0];

      return {
        saleId,
        refundId: refund.id,
        obligationRefundId: refund.obligation_refund_id,
        amount: parseFloat(refund.amount),
      };
    }

    // ========================================================================
    // A. confirm_refund_reimbursement RPC Integration Tests
    // ========================================================================
    describe("RPC: public.confirm_refund_reimbursement", () => {
      it("rejects unauthorized cashiers lacking sales:void or returns:create", async () => {
        const { refundId } = await createVoidedCardSale();

        const { data, error } = await cashierClient.rpc("confirm_refund_reimbursement", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_external_reference: "REV-REF-101",
          p_idempotency_key: randomUUID(),
        });

        expect(data).toBeNull();
        expect(error).not.toBeNull();
        expect(error?.code).toBe("42501");
      });

      it("rejects missing or empty external reference with P0059", async () => {
        const { refundId } = await createVoidedCardSale();

        const { data, error } = await managerClient.rpc("confirm_refund_reimbursement", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_external_reference: "   ",
          p_idempotency_key: randomUUID(),
        });

        expect(data).toBeNull();
        expect(error?.code).toBe("P0059");
      });

      it("confirms pending refund and updates sale payment status to refunded (F005-039)", async () => {
        const { saleId, refundId } = await createVoidedCardSale();
        const confirmKey = randomUUID();

        const { data, error } = await managerClient.rpc("confirm_refund_reimbursement", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_external_reference: "REV-GATEWAY-1122",
          p_idempotency_key: confirmKey,
        });

        expect(error).toBeNull();
        expect(data.success).toBe(true);
        expect(data.is_replay).toBe(false);
        expect(data.refund_id).toBe(refundId);
        expect(data.status).toBe("completed");
        expect(data.external_reference).toBe("REV-GATEWAY-1122");
        expect(data.payment_status).toBe("refunded");

        // Verify in database
        const refRes = await pgClient.query(
          `SELECT * FROM public.refunds WHERE id = $1;`,
          [refundId]
        );
        expect(refRes.rows[0].status).toBe("completed");
        expect(refRes.rows[0].reference_no).toBe("REV-GATEWAY-1122");
        expect(refRes.rows[0].confirmation_idempotency_key).toBe(confirmKey);

        const saleRes = await pgClient.query(
          `SELECT * FROM public.sales WHERE id = $1;`,
          [saleId]
        );
        expect(saleRes.rows[0].payment_status).toBe("refunded");
      });

      it("Case A: idempotent replay with identical parameters returns is_replay = true", async () => {
        const { refundId } = await createVoidedCardSale();
        const confirmKey = randomUUID();

        // Call 1
        await managerClient.rpc("confirm_refund_reimbursement", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_external_reference: "REV-FIRST",
          p_idempotency_key: confirmKey,
        });

        // Call 2 (identical replay)
        const replayRes = await managerClient.rpc("confirm_refund_reimbursement", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_external_reference: "REV-FIRST",
          p_idempotency_key: confirmKey,
        });

        expect(replayRes.error).toBeNull();
        expect(replayRes.data.success).toBe(true);
        expect(replayRes.data.is_replay).toBe(true);
        expect(replayRes.data.refund_id).toBe(refundId);
        expect(replayRes.data.status).toBe("completed");
      });

      it("Case B: replay with same idempotency key but altered reference raises P0024", async () => {
        const { refundId } = await createVoidedCardSale();
        const confirmKey = randomUUID();

        // Call 1
        await managerClient.rpc("confirm_refund_reimbursement", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_external_reference: "REV-INITIAL",
          p_idempotency_key: confirmKey,
        });

        // Call 2 with altered reference
        const conflictRes = await managerClient.rpc("confirm_refund_reimbursement", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_external_reference: "REV-ALTERED",
          p_idempotency_key: confirmKey,
        });

        expect(conflictRes.data).toBeNull();
        expect(conflictRes.error?.code).toBe("P0024");
      });

      it("Case C: reusing idempotency key across different refunds raises P0024 under lock", async () => {
        const refund1 = await createVoidedCardSale();
        const refund2 = await createVoidedCardSale();
        const sharedKey = randomUUID();

        // Confirm refund 1 with sharedKey
        await managerClient.rpc("confirm_refund_reimbursement", {
          p_org_id: orgId,
          p_refund_id: refund1.refundId,
          p_external_reference: "REV-REF-1",
          p_idempotency_key: sharedKey,
        });

        // Attempt confirm refund 2 with sharedKey
        const collisionRes = await managerClient.rpc("confirm_refund_reimbursement", {
          p_org_id: orgId,
          p_refund_id: refund2.refundId,
          p_external_reference: "REV-REF-2",
          p_idempotency_key: sharedKey,
        });

        expect(collisionRes.data).toBeNull();
        expect(collisionRes.error?.code).toBe("P0024");
      });

      it("Case D: confirming an already completed refund with a new key raises P0062", async () => {
        const { refundId } = await createVoidedCardSale();

        // Confirm with key 1
        await managerClient.rpc("confirm_refund_reimbursement", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_external_reference: "REV-INITIAL",
          p_idempotency_key: randomUUID(),
        });

        // Attempt confirm again with new key 2
        const settledRes = await managerClient.rpc("confirm_refund_reimbursement", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_external_reference: "REV-SECOND",
          p_idempotency_key: randomUUID(),
        });

        expect(settledRes.data).toBeNull();
        expect(settledRes.error?.code).toBe("P0062");
      });
    });

    // ========================================================================
    // B. record_refund_failure RPC Integration Tests
    // ========================================================================
    describe("RPC: public.record_refund_failure", () => {
      it("rejects unauthorized cashiers lacking permissions", async () => {
        const { refundId } = await createVoidedCardSale();

        const { data, error } = await cashierClient.rpc("record_refund_failure", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_failure_reason: "Card expired on gateway",
        });

        expect(data).toBeNull();
        expect(error?.code).toBe("42501");
      });

      it("rejects failure reason with fewer than 3 characters with P0053", async () => {
        const { refundId } = await createVoidedCardSale();

        const { data, error } = await managerClient.rpc("record_refund_failure", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_failure_reason: "no",
        });

        expect(data).toBeNull();
        expect(error?.code).toBe("P0053");
      });

      it("marks pending refund as failed, appends failure reason, and updates payment status", async () => {
        const { saleId, refundId } = await createVoidedCardSale();

        const { data, error } = await managerClient.rpc("record_refund_failure", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_failure_reason: "Card declined by issuing bank",
        });

        expect(error).toBeNull();
        expect(data.success).toBe(true);
        expect(data.refund_id).toBe(refundId);
        expect(data.status).toBe("failed");
        expect(data.failure_reason).toBe("Card declined by issuing bank");

        // Verify in database
        const refRes = await pgClient.query(`SELECT * FROM public.refunds WHERE id = $1;`, [refundId]);
        expect(refRes.rows[0].status).toBe("failed");
        expect(refRes.rows[0].reason).toContain("FAILURE: Card declined by issuing bank");

        // Payment status remains partially_refunded or paid because 0 completed refunds exist
        const saleRes = await pgClient.query(`SELECT * FROM public.sales WHERE id = $1;`, [saleId]);
        expect(saleRes.rows[0].payment_status).toBe("paid");
      });

      it("rejects recording failure on an already settled refund with P0062", async () => {
        const { refundId } = await createVoidedCardSale();

        // Settle first
        await managerClient.rpc("confirm_refund_reimbursement", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_external_reference: "REV-OK",
          p_idempotency_key: randomUUID(),
        });

        // Try to fail settled refund
        const failRes = await managerClient.rpc("record_refund_failure", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_failure_reason: "Too late to fail",
        });

        expect(failRes.data).toBeNull();
        expect(failRes.error?.code).toBe("P0062");
      });
    });

    // ========================================================================
    // C. issue_replacement_refund RPC Integration Tests
    // ========================================================================
    describe("RPC: public.issue_replacement_refund", () => {
      it("rejects unauthorized cashiers lacking permissions", async () => {
        const { refundId } = await createVoidedCardSale();
        await managerClient.rpc("record_refund_failure", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_failure_reason: "Gateway error",
        });

        const { data, error } = await cashierClient.rpc("issue_replacement_refund", {
          p_org_id: orgId,
          p_failed_refund_id: refundId,
          p_refund_method: "cash",
          p_idempotency_key: randomUUID(),
        });

        expect(data).toBeNull();
        expect(error?.code).toBe("42501");
      });

      it("rejects replacement when target refund is not in failed status with P0065", async () => {
        const { refundId } = await createVoidedCardSale();
        // refundId is still pending, not failed!

        const { data, error } = await managerClient.rpc("issue_replacement_refund", {
          p_org_id: orgId,
          p_failed_refund_id: refundId,
          p_refund_method: "cash",
          p_idempotency_key: randomUUID(),
        });

        expect(data).toBeNull();
        expect(error?.code).toBe("P0065");
      });

      it("issues cash replacement for failed refund, setting status = completed immediately", async () => {
        const { saleId, refundId, obligationRefundId } = await createVoidedCardSale();

        // Fail refund
        await managerClient.rpc("record_refund_failure", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_failure_reason: "Customer card cancelled",
        });

        const repKey = randomUUID();
        const { data, error } = await managerClient.rpc("issue_replacement_refund", {
          p_org_id: orgId,
          p_failed_refund_id: refundId,
          p_refund_method: "cash",
          p_idempotency_key: repKey,
          p_reference_no: null,
          p_notes: "Cash disbursement at customer service desk",
        });

        expect(error).toBeNull();
        expect(data.success).toBe(true);
        expect(data.is_replay).toBe(false);
        expect(data.obligation_refund_id).toBe(obligationRefundId);
        expect(data.failed_refund_id).toBe(refundId);
        expect(data.status).toBe("completed");
        expect(data.refund_method).toBe("cash");
        expect(data.payment_status).toBe("refunded");

        // Verify database records
        const newRefRes = await pgClient.query(`SELECT * FROM public.refunds WHERE id = $1;`, [data.replacement_refund_id]);
        expect(newRefRes.rows[0].parent_refund_id).toBe(refundId);
        expect(newRefRes.rows[0].obligation_refund_id).toBe(obligationRefundId);
        expect(newRefRes.rows[0].status).toBe("completed");

        // Sale payment status is now refunded
        const saleRes = await pgClient.query(`SELECT * FROM public.sales WHERE id = $1;`, [saleId]);
        expect(saleRes.rows[0].payment_status).toBe("refunded");
      });

      it("rejects another replacement after obligation reached completed status with P0067", async () => {
        const { refundId } = await createVoidedCardSale();

        // Fail R1
        await managerClient.rpc("record_refund_failure", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_failure_reason: "Initial failure",
        });

        // Issue cash replacement R2 (settles immediately as completed)
        await managerClient.rpc("issue_replacement_refund", {
          p_org_id: orgId,
          p_failed_refund_id: refundId,
          p_refund_method: "cash",
          p_idempotency_key: randomUUID(),
        });

        // Attempt another replacement on R1
        const dupRes = await managerClient.rpc("issue_replacement_refund", {
          p_org_id: orgId,
          p_failed_refund_id: refundId,
          p_refund_method: "cash",
          p_idempotency_key: randomUUID(),
        });

        expect(dupRes.data).toBeNull();
        expect(dupRes.error?.code).toBe("P0067");
      });

      it("rejects concurrent / duplicate replacement when active pending attempt exists with P0064", async () => {
        const { refundId } = await createVoidedCardSale();

        // Fail R1
        await managerClient.rpc("record_refund_failure", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_failure_reason: "Initial failure",
        });

        // Issue card replacement R2 (status = pending)
        const rep1 = await managerClient.rpc("issue_replacement_refund", {
          p_org_id: orgId,
          p_failed_refund_id: refundId,
          p_refund_method: "card",
          p_idempotency_key: randomUUID(),
          p_reference_no: "CARD-RETRY-1",
        });
        expect(rep1.error).toBeNull();
        expect(rep1.data.status).toBe("pending");

        // While R2 is pending, try issuing another replacement
        const dupRes = await managerClient.rpc("issue_replacement_refund", {
          p_org_id: orgId,
          p_failed_refund_id: refundId,
          p_refund_method: "cash",
          p_idempotency_key: randomUUID(),
        });

        expect(dupRes.data).toBeNull();
        expect(dupRes.error?.code).toBe("P0064");
      });

      it("rejects non-cash method not present in original sale with P0061", async () => {
        const { refundId } = await createVoidedCardSale();
        // Sale was paid purely via Card! Bank transfer was not used.

        await managerClient.rpc("record_refund_failure", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_failure_reason: "Card expired",
        });

        const res = await managerClient.rpc("issue_replacement_refund", {
          p_org_id: orgId,
          p_failed_refund_id: refundId,
          p_refund_method: "bank_transfer",
          p_idempotency_key: randomUUID(),
        });

        expect(res.data).toBeNull();
        expect(res.error?.code).toBe("P0061");
      });

      it("replays replacement refund idempotently with is_replay = true on matching key/hash", async () => {
        const { refundId } = await createVoidedCardSale();
        const repKey = randomUUID();

        await managerClient.rpc("record_refund_failure", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_failure_reason: "Card expired",
        });

        // Call 1
        const call1 = await managerClient.rpc("issue_replacement_refund", {
          p_org_id: orgId,
          p_failed_refund_id: refundId,
          p_refund_method: "cash",
          p_idempotency_key: repKey,
          p_notes: "Identical replacement notes",
        });
        expect(call1.error).toBeNull();
        expect(call1.data.is_replay).toBe(false);

        // Call 2 (identical replay)
        const call2 = await managerClient.rpc("issue_replacement_refund", {
          p_org_id: orgId,
          p_failed_refund_id: refundId,
          p_refund_method: "cash",
          p_idempotency_key: repKey,
          p_notes: "Identical replacement notes",
        });
        expect(call2.error).toBeNull();
        expect(call2.data.is_replay).toBe(true);
        expect(call2.data.replacement_refund_id).toBe(call1.data.replacement_refund_id);
      });

      it("detects altered payload with same idempotency key and raises P0024", async () => {
        const { refundId } = await createVoidedCardSale();
        const repKey = randomUUID();

        await managerClient.rpc("record_refund_failure", {
          p_org_id: orgId,
          p_refund_id: refundId,
          p_failure_reason: "Card expired",
        });

        // Call 1
        await managerClient.rpc("issue_replacement_refund", {
          p_org_id: orgId,
          p_failed_refund_id: refundId,
          p_refund_method: "cash",
          p_idempotency_key: repKey,
          p_notes: "First note",
        });

        // Call 2 with altered notes under same key
        const conflictRes = await managerClient.rpc("issue_replacement_refund", {
          p_org_id: orgId,
          p_failed_refund_id: refundId,
          p_refund_method: "cash",
          p_idempotency_key: repKey,
          p_notes: "Altered note",
        });

        expect(conflictRes.data).toBeNull();
        expect(conflictRes.error?.code).toBe("P0024");
      });
    });
  }
);
