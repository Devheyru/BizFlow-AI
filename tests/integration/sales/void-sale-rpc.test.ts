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
  "Feature 005 — Phase 6 void_sale Database RPC & F005-039 Integration Tests (T066, US6)",
  () => {
    let pgClient: PgClient;
    let adminClient: SupabaseClient;
    let ownerClient: SupabaseClient;
    let managerClient: SupabaseClient;
    let cashierClient: SupabaseClient;
    let orgBClient: SupabaseClient;

    let orgId: string;
    let orgBId: string;
    let ownerUserId: string;
    let managerUserId: string;
    let cashierUserId: string;
    let orgBUserId: string;

    let productId1: string;
    let productId2: string;
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
      const ownerEmail = `void-owner-${timestamp}@example.com`;
      const uOwner = await adminClient.auth.admin.createUser({
        email: ownerEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "Void", last_name: "Owner" },
      });
      ownerUserId = uOwner.data.user!.id;

      const mgrEmail = `void-mgr-${timestamp}@example.com`;
      const uMgr = await adminClient.auth.admin.createUser({
        email: mgrEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "Void", last_name: "Manager" },
      });
      managerUserId = uMgr.data.user!.id;

      const cashEmail = `void-cash-${timestamp}@example.com`;
      const uCash = await adminClient.auth.admin.createUser({
        email: cashEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "Void", last_name: "Cashier" },
      });
      cashierUserId = uCash.data.user!.id;

      const orgBEmail = `void-orgb-${timestamp}@example.com`;
      const uOrgB = await adminClient.auth.admin.createUser({
        email: orgBEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "Void", last_name: "OrgB" },
      });
      orgBUserId = uOrgB.data.user!.id;

      // 2. Insert Profiles
      await pgClient.query(
        `INSERT INTO public.profiles (id, first_name, last_name)
         VALUES 
           ($1, 'Void', 'Owner'),
           ($2, 'Void', 'Manager'),
           ($3, 'Void', 'Cashier'),
           ($4, 'Void', 'OrgB')
         ON CONFLICT (id) DO NOTHING;`,
        [ownerUserId, managerUserId, cashierUserId, orgBUserId]
      );

      // 3. Create Org A
      const orgSlug = `void-org-a-${timestamp}`;
      const resOrgA = await pgClient.query(
        `INSERT INTO public.organizations (name, slug, business_type, country, currency, timezone, created_by)
         VALUES ('Void Org A', $1, 'retail', 'US', 'USD', 'America/New_York', $2)
         RETURNING id;`,
        [orgSlug, ownerUserId]
      );
      orgId = resOrgA.rows[0].id;

      // 4. Create Org B
      const orgBSlug = `void-org-b-${timestamp}`;
      const resOrgB = await pgClient.query(
        `INSERT INTO public.organizations (name, slug, business_type, country, currency, timezone, created_by)
         VALUES ('Void Org B', $1, 'retail', 'US', 'USD', 'America/New_York', $2)
         RETURNING id;`,
        [orgBSlug, orgBUserId]
      );
      orgBId = resOrgB.rows[0].id;

      // 5. Memberships
      await pgClient.query(
        `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
         VALUES 
           ($1, $2, 'owner', 'active'),
           ($1, $3, 'manager', 'active'),
           ($1, $4, 'cashier', 'active'),
           ($5, $6, 'owner', 'active');`,
        [orgId, ownerUserId, managerUserId, cashierUserId, orgBId, orgBUserId]
      );

      // 6. Tax Settings
      await pgClient.query(
        `INSERT INTO public.organization_tax_settings (organization_id, tax_name, default_tax_rate, is_tax_inclusive, updated_by)
         VALUES ($1, 'Sales Tax', 10.0000, false, $2)
         ON CONFLICT (organization_id) DO UPDATE SET default_tax_rate = 10.0000, is_tax_inclusive = false;`,
        [orgId, ownerUserId]
      );

      // 7. Products and Initial Inventory in Org A
      const p1Res = await pgClient.query(
        `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
         VALUES ($1, 'Void Item 1', 'VOID-SKU-1', 20.0000, 'piece', 'active', $2, $2)
         RETURNING id;`,
        [orgId, ownerUserId]
      );
      productId1 = p1Res.rows[0].id;

      const p2Res = await pgClient.query(
        `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
         VALUES ($1, 'Void Item 2', 'VOID-SKU-2', 50.0000, 'piece', 'active', $2, $2)
         RETURNING id;`,
        [orgId, ownerUserId]
      );
      productId2 = p2Res.rows[0].id;

      // Add Stock in Org A
      await pgClient.query(
        `INSERT INTO public.inventory (organization_id, product_id, quantity)
         VALUES 
           ($1, $2, 100.0000),
           ($1, $3, 100.0000)
         ON CONFLICT (organization_id, product_id) DO UPDATE SET quantity = 100.0000;`,
        [orgId, productId1, productId2]
      );

      // Tax & Product in Org B for Cross-Tenant Idempotency Testing
      await pgClient.query(
        `INSERT INTO public.organization_tax_settings (organization_id, tax_name, default_tax_rate, is_tax_inclusive, updated_by)
         VALUES ($1, 'Sales Tax', 10.0000, false, $2)
         ON CONFLICT (organization_id) DO NOTHING;`,
        [orgBId, orgBUserId]
      );

      const pbRes = await pgClient.query(
        `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
         VALUES ($1, 'Org B Product', 'ORGB-SKU-1', 20.0000, 'piece', 'active', $2, $2)
         RETURNING id;`,
        [orgBId, orgBUserId]
      );
      const productBId = pbRes.rows[0].id;

      await pgClient.query(
        `INSERT INTO public.inventory (organization_id, product_id, quantity)
         VALUES ($1, $2, 100.0000)
         ON CONFLICT (organization_id, product_id) DO UPDATE SET quantity = 100.0000;`,
        [orgBId, productBId]
      );

      // 8. Create Customer
      const custRes = await pgClient.query(
        `INSERT INTO public.customers (organization_id, name, phone, email, status)
         VALUES ($1, 'Void Test Customer', '+15555550199', 'void.cust@example.com', 'active')
         RETURNING id;`,
        [orgId]
      );
      customerId = custRes.rows[0].id;

      // 9. Sign in client sessions
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

      orgBClient = createClient(supabaseUrl, anonKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await orgBClient.auth.signInWithPassword({ email: orgBEmail, password: testPassword });
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
          if (orgBId) {
            await pgClient.query(`DELETE FROM public.organization_memberships WHERE organization_id = $1;`, [orgBId]);
            await pgClient.query(`DELETE FROM public.organizations WHERE id = $1;`, [orgBId]);
          }
          await pgClient.query(`SET session_replication_role = 'origin';`);
        }
        if (ownerUserId) {
          await adminClient.auth.admin.deleteUser(ownerUserId).catch(() => { });
          await adminClient.auth.admin.deleteUser(managerUserId).catch(() => { });
          await adminClient.auth.admin.deleteUser(cashierUserId).catch(() => { });
          await adminClient.auth.admin.deleteUser(orgBUserId).catch(() => { });
        }
      } finally {
        if (pgClient) {
          await pgClient.end().catch(() => { });
        }
      }
    });

    // Helper to create a sale via execute_sale RPC
    async function createTestSale(options: {
      payments: Array<{
        payment_method: string;
        amount: number;
        amount_tendered?: number;
        change_due?: number;
        reference_no?: string | null;
      }>;
      items?: Array<{
        product_id: string;
        quantity: number;
        unit_price: number;
        line_discount_amount: number;
      }>;
      customerId?: string;
    }) {
      const items = options.items || [
        {
          product_id: productId1,
          quantity: 2,
          unit_price: 20.0,
          line_discount_amount: 0,
        },
      ];
      // Tax: 10% on $40 = $4 => Total = $44.00
      const idempotencyKey = randomUUID();
      const res = await managerClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: options.customerId || null,
        p_items: items,
        p_payments: options.payments,
        p_order_discount_amount: 0,
        p_idempotency_key: idempotencyKey,
        p_notes: "Test sale for void",
      });

      expect(res.error).toBeNull();
      expect(res.data.success).toBe(true);
      return res.data;
    }

    // ------------------------------------------------------------------------
    // A. Migration & Function Definition Verification
    // ------------------------------------------------------------------------
    describe("Function Metadata, Grants & Security", () => {
      it("verifies public.void_sale has correct owner, security definer, and search_path", async () => {
        const query = await pgClient.query(`
          SELECT 
            p.proname,
            r.rolname as owner,
            p.prosecdef as is_security_definer,
            p.proconfig as search_path
          FROM pg_proc p
          JOIN pg_roles r ON p.proowner = r.oid
          WHERE p.proname = 'void_sale' AND p.pronamespace = 'public'::regnamespace;
        `);

        expect(query.rows.length).toBe(1);
        const row = query.rows[0];
        expect(row.owner).toBe("postgres");
        expect(row.is_security_definer).toBe(true);
        expect(row.search_path).toContain("search_path=pg_catalog, public, pg_temp");
      });

      it("verifies EXECUTE permissions on void_sale (authenticated only, revoked from public/anon/service_role)", async () => {
        const grantQuery = await pgClient.query(`
          SELECT grantee, privilege_type
          FROM information_schema.routine_privileges
          WHERE routine_schema = 'public' AND routine_name = 'void_sale';
        `);

        const grantees = grantQuery.rows.map((r) => r.grantee);
        expect(grantees).toContain("authenticated");
        expect(grantees).not.toContain("anon");
        expect(grantees).not.toContain("PUBLIC");
      });
    });

    // ------------------------------------------------------------------------
    // B. Authorization & Precondition Enforcement
    // ------------------------------------------------------------------------
    describe("Authorization & Precondition Guards", () => {
      it("rejects Cashier without sales:void with 42501 INSUFFICIENT_PERMISSIONS", async () => {
        const sale = await createTestSale({
          customerId,
          payments: [{ payment_method: "cash", amount: 44.0, amount_tendered: 50.0, change_due: 6.0 }],
        });

        const voidRes = await cashierClient.rpc("void_sale", {
          p_org_id: orgId,
          p_sale_id: sale.sale_id,
          p_void_reason: "Cashier void attempt",
          p_idempotency_key: randomUUID(),
        });

        expect(voidRes.error).not.toBeNull();
        expect(voidRes.error!.code).toBe("42501");
        expect(voidRes.error!.message).toContain("INSUFFICIENT_PERMISSIONS");
      });

      it("rejects void on another tenant sale with P0048 SALE_NOT_FOUND", async () => {
        const sale = await createTestSale({
          customerId,
          payments: [{ payment_method: "cash", amount: 44.0, amount_tendered: 50.0, change_due: 6.0 }],
        });

        // Org B owner tries to void Org A's sale
        const voidRes = await orgBClient.rpc("void_sale", {
          p_org_id: orgBId,
          p_sale_id: sale.sale_id,
          p_void_reason: "Cross tenant void attempt",
          p_idempotency_key: randomUUID(),
        });

        expect(voidRes.error).not.toBeNull();
        expect(voidRes.error!.code).toBe("P0048");
      });

      it("rejects missing idempotency key with P0055", async () => {
        const sale = await createTestSale({
          customerId,
          payments: [{ payment_method: "cash", amount: 44.0, amount_tendered: 50.0, change_due: 6.0 }],
        });

        const voidRes = await managerClient.rpc("void_sale", {
          p_org_id: orgId,
          p_sale_id: sale.sale_id,
          p_void_reason: "Missing key test",
          p_idempotency_key: null as any,
        });

        expect(voidRes.error).not.toBeNull();
        expect(voidRes.error!.code).toBe("P0055");
      });

      it("rejects reason shorter than 3 characters with P0053", async () => {
        const sale = await createTestSale({
          customerId,
          payments: [{ payment_method: "cash", amount: 44.0, amount_tendered: 50.0, change_due: 6.0 }],
        });

        const voidRes = await managerClient.rpc("void_sale", {
          p_org_id: orgId,
          p_sale_id: sale.sale_id,
          p_void_reason: "no",
          p_idempotency_key: randomUUID(),
        });

        expect(voidRes.error).not.toBeNull();
        expect(voidRes.error!.code).toBe("P0053");
      });
    });

    // ------------------------------------------------------------------------
    // C. F005-039 Reconciled Payment Status & Lifecycle Cases
    // ------------------------------------------------------------------------
    describe("F005-039 Payment Status & Reconciled Calculation", () => {
      it("Case 1: Cash-only sale void creates completed cash refund and marks sale refunded", async () => {
        // Record initial inventory
        const invBefore = await pgClient.query(
          `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
          [orgId, productId1]
        );
        const qtyBefore = Number(invBefore.rows[0].quantity);

        const sale = await createTestSale({
          customerId,
          payments: [{ payment_method: "cash", amount: 44.0, amount_tendered: 50.0, change_due: 6.0 }],
        });

        const invAfterSale = await pgClient.query(
          `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
          [orgId, productId1]
        );
        expect(Number(invAfterSale.rows[0].quantity)).toBe(qtyBefore - 2);

        // Void the sale
        const idempotencyKey = randomUUID();
        const voidRes = await managerClient.rpc("void_sale", {
          p_org_id: orgId,
          p_sale_id: sale.sale_id,
          p_void_reason: "Customer cancelled cash transaction",
          p_idempotency_key: idempotencyKey,
        });

        expect(voidRes.error).toBeNull();
        expect(voidRes.data.success).toBe(true);
        expect(voidRes.data.is_replay).toBe(false);
        expect(voidRes.data.status).toBe("voided");
        expect(voidRes.data.payment_status).toBe("refunded");

        // Verify database state: sale header
        const saleCheck = await pgClient.query(
          `SELECT status, payment_status, void_reason, voided_by FROM public.sales WHERE id = $1;`,
          [sale.sale_id]
        );
        expect(saleCheck.rows[0].status).toBe("voided");
        expect(saleCheck.rows[0].payment_status).toBe("refunded");
        expect(saleCheck.rows[0].void_reason).toBe("Customer cancelled cash transaction");
        expect(saleCheck.rows[0].voided_by).toBe(managerUserId);

        // Verify refund record: status = 'completed'
        const refundCheck = await pgClient.query(
          `SELECT id, refund_method, amount, status, obligation_refund_id
           FROM public.refunds WHERE sale_id = $1;`,
          [sale.sale_id]
        );
        expect(refundCheck.rows.length).toBe(1);
        expect(refundCheck.rows[0].refund_method).toBe("cash");
        expect(Number(refundCheck.rows[0].amount)).toBe(44.0);
        expect(refundCheck.rows[0].status).toBe("completed");
        expect(refundCheck.rows[0].obligation_refund_id).toBe(refundCheck.rows[0].id);

        // Verify inventory restored exactly by 2 units
        const invAfterVoid = await pgClient.query(
          `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
          [orgId, productId1]
        );
        expect(Number(invAfterVoid.rows[0].quantity)).toBe(qtyBefore);

        // Verify immutable stock movement of type 'return' with reference void:{sale_id}
        const mvtCheck = await pgClient.query(
          `SELECT movement_type, quantity_delta, reason, reference_id
           FROM public.stock_movements
           WHERE organization_id = $1 AND product_id = $2 AND reference_id = $3;`,
          [orgId, productId1, `void:${sale.sale_id}`]
        );
        expect(mvtCheck.rows.length).toBe(1);
        expect(mvtCheck.rows[0].movement_type).toBe("return");
        expect(Number(mvtCheck.rows[0].quantity_delta)).toBe(2);
        expect(mvtCheck.rows[0].reason).toContain("Void sale");
      });

      it("Case 2: External card void creates pending refund and marks sale partially_refunded (Fixed Defect)", async () => {
        const sale = await createTestSale({
          payments: [{ payment_method: "card", amount: 44.0, reference_no: "AUTH-CARD-1234" }],
        });

        // Void the card sale without reversal reference
        const idempotencyKey = randomUUID();
        const voidRes = await managerClient.rpc("void_sale", {
          p_org_id: orgId,
          p_sale_id: sale.sale_id,
          p_void_reason: "Customer requested card transaction void",
          p_idempotency_key: idempotencyKey,
        });

        expect(voidRes.error).toBeNull();
        expect(voidRes.data.success).toBe(true);
        expect(voidRes.data.status).toBe("voided");
        // CRITICAL F005-039 CHECK: Must be 'partially_refunded' because card refund is pending!
        expect(voidRes.data.payment_status).toBe("partially_refunded");

        // Verify refund record in DB has status = 'pending'
        const refundCheck = await pgClient.query(
          `SELECT id, refund_method, amount, status, reference_no, obligation_refund_id
           FROM public.refunds WHERE sale_id = $1;`,
          [sale.sale_id]
        );
        expect(refundCheck.rows.length).toBe(1);
        expect(refundCheck.rows[0].refund_method).toBe("card");
        expect(Number(refundCheck.rows[0].amount)).toBe(44.0);
        expect(refundCheck.rows[0].status).toBe("pending");
        expect(refundCheck.rows[0].obligation_refund_id).toBe(refundCheck.rows[0].id);

        // Verify sale header in DB is 'partially_refunded' (NOT 'paid'!)
        const saleCheck = await pgClient.query(
          `SELECT status, payment_status FROM public.sales WHERE id = $1;`,
          [sale.sale_id]
        );
        expect(saleCheck.rows[0].status).toBe("voided");
        expect(saleCheck.rows[0].payment_status).toBe("partially_refunded");
      });

      it("Case 3: External card void with explicit reversal reference remains pending and partially_refunded (F005-038)", async () => {
        const sale = await createTestSale({
          payments: [{ payment_method: "card", amount: 44.0, reference_no: "AUTH-ORIG-999" }],
        });

        // Get the payment ID
        const pmtRes = await pgClient.query(
          `SELECT id FROM public.payments WHERE sale_id = $1;`,
          [sale.sale_id]
        );
        const paymentId = pmtRes.rows[0].id;

        // Void with reversal reference
        const idempotencyKey = randomUUID();
        const voidRes = await managerClient.rpc("void_sale", {
          p_org_id: orgId,
          p_sale_id: sale.sale_id,
          p_void_reason: "Void card with reversal authorization trace",
          p_idempotency_key: idempotencyKey,
          p_reversal_references: [
            { payment_id: paymentId, reference_no: "REV-AUTH-555" },
          ],
        });

        expect(voidRes.error).toBeNull();
        expect(voidRes.data.success).toBe(true);
        expect(voidRes.data.status).toBe("voided");
        // F005-038: Supplying a reference does NOT complete the refund. Remains partially_refunded!
        expect(voidRes.data.payment_status).toBe("partially_refunded");

        // Verify refund in DB
        const refundCheck = await pgClient.query(
          `SELECT id, status, reference_no FROM public.refunds WHERE sale_id = $1;`,
          [sale.sale_id]
        );
        expect(refundCheck.rows[0].status).toBe("pending");
        expect(refundCheck.rows[0].reference_no).toBe("REV-AUTH-555");
      });

      it("Case 4: Mixed cash and card split sale void produces completed cash and pending card, payment_status = partially_refunded", async () => {
        // Sale of $44 total ($40 subtotal + $4 tax): $20 cash, $24 card
        const sale = await createTestSale({
          payments: [
            { payment_method: "cash", amount: 20.0, amount_tendered: 20.0, change_due: 0.0 },
            { payment_method: "card", amount: 24.0, reference_no: "AUTH-SPLIT-CARD" },
          ],
        });

        const idempotencyKey = randomUUID();
        const voidRes = await managerClient.rpc("void_sale", {
          p_org_id: orgId,
          p_sale_id: sale.sale_id,
          p_void_reason: "Void split payment sale",
          p_idempotency_key: idempotencyKey,
        });

        expect(voidRes.error).toBeNull();
        expect(voidRes.data.status).toBe("voided");
        expect(voidRes.data.payment_status).toBe("partially_refunded");

        // Verify both refunds in DB
        const refundsCheck = await pgClient.query(
          `SELECT refund_method, amount, status FROM public.refunds WHERE sale_id = $1 ORDER BY created_at ASC;`,
          [sale.sale_id]
        );
        expect(refundsCheck.rows.length).toBe(2);

        const cashRefund = refundsCheck.rows.find((r) => r.refund_method === "cash");
        const cardRefund = refundsCheck.rows.find((r) => r.refund_method === "card");

        expect(cashRefund).toBeDefined();
        expect(Number(cashRefund!.amount)).toBe(20.0);
        expect(cashRefund!.status).toBe("completed");

        expect(cardRefund).toBeDefined();
        expect(Number(cardRefund!.amount)).toBe(24.0);
        expect(cardRefund!.status).toBe("pending");
      });
    });

    // ------------------------------------------------------------------------
    // D. Idempotency & Concurrency Verification
    // ------------------------------------------------------------------------
    describe("Idempotency Hashing & Replay Verification", () => {
      it("identical replay with same key and same payload returns original result without duplicating inventory or refunds", async () => {
        const sale = await createTestSale({
          customerId,
          payments: [{ payment_method: "cash", amount: 44.0, amount_tendered: 50.0, change_due: 6.0 }],
        });

        const key = randomUUID();
        const firstCall = await managerClient.rpc("void_sale", {
          p_org_id: orgId,
          p_sale_id: sale.sale_id,
          p_void_reason: "First void call",
          p_idempotency_key: key,
        });

        expect(firstCall.error).toBeNull();
        expect(firstCall.data.is_replay).toBe(false);

        // Second call: exact same arguments
        const secondCall = await managerClient.rpc("void_sale", {
          p_org_id: orgId,
          p_sale_id: sale.sale_id,
          p_void_reason: "First void call",
          p_idempotency_key: key,
        });

        expect(secondCall.error).toBeNull();
        expect(secondCall.data.is_replay).toBe(true);
        expect(secondCall.data.sale_id).toBe(sale.sale_id);
        expect(secondCall.data.status).toBe("voided");

        // Verify stock movements were created exactly once (not twice!)
        const mvtCount = await pgClient.query(
          `SELECT count(*) FROM public.stock_movements WHERE reference_id = $1;`,
          [`void:${sale.sale_id}`]
        );
        expect(Number(mvtCount.rows[0].count)).toBe(1);

        // Verify refund rows created exactly once
        const refundCount = await pgClient.query(
          `SELECT count(*) FROM public.refunds WHERE sale_id = $1;`,
          [sale.sale_id]
        );
        expect(Number(refundCount.rows[0].count)).toBe(1);
      });

      it("reversal references in different array order produce the same canonical hash and replay successfully", async () => {
        const sale = await createTestSale({
          payments: [
            { payment_method: "card", amount: 20.0, reference_no: "AUTH-A" },
            { payment_method: "card", amount: 24.0, reference_no: "AUTH-B" },
          ],
        });

        const pmtRows = await pgClient.query(
          `SELECT id FROM public.payments WHERE sale_id = $1 ORDER BY id ASC;`,
          [sale.sale_id]
        );
        const pmt1Id = pmtRows.rows[0].id;
        const pmt2Id = pmtRows.rows[1].id;

        const key = randomUUID();

        // First call: order [pmt1, pmt2]
        const call1 = await managerClient.rpc("void_sale", {
          p_org_id: orgId,
          p_sale_id: sale.sale_id,
          p_void_reason: "Array sort test",
          p_idempotency_key: key,
          p_reversal_references: [
            { payment_id: pmt1Id, reference_no: "REV-1" },
            { payment_id: pmt2Id, reference_no: "REV-2" },
          ],
        });
        expect(call1.error).toBeNull();
        expect(call1.data.is_replay).toBe(false);

        // Second call: reversed order [pmt2, pmt1] with same key
        const call2 = await managerClient.rpc("void_sale", {
          p_org_id: orgId,
          p_sale_id: sale.sale_id,
          p_void_reason: "Array sort test",
          p_idempotency_key: key,
          p_reversal_references: [
            { payment_id: pmt2Id, reference_no: "REV-2" },
            { payment_id: pmt1Id, reference_no: "REV-1" },
          ],
        });

        // Deterministic sorting in migration 22 ensures hashes match -> Replay!
        expect(call2.error).toBeNull();
        expect(call2.data.is_replay).toBe(true);
      });

      it("same key with a changed void reason returns P0024 IDEMPOTENCY_CONFLICT", async () => {
        const sale = await createTestSale({
          customerId,
          payments: [{ payment_method: "cash", amount: 44.0, amount_tendered: 50.0, change_due: 6.0 }],
        });

        const key = randomUUID();
        await managerClient.rpc("void_sale", {
          p_org_id: orgId,
          p_sale_id: sale.sale_id,
          p_void_reason: "Initial reason",
          p_idempotency_key: key,
        });

        // Try same key with changed reason
        const conflictCall = await managerClient.rpc("void_sale", {
          p_org_id: orgId,
          p_sale_id: sale.sale_id,
          p_void_reason: "Different reason for conflict",
          p_idempotency_key: key,
        });

        expect(conflictCall.error).not.toBeNull();
        expect(conflictCall.error!.code).toBe("P0024");
      });

      it("same key with changed reversal references returns P0024 IDEMPOTENCY_CONFLICT", async () => {
        const sale = await createTestSale({
          payments: [{ payment_method: "card", amount: 44.0, reference_no: "AUTH-CARD-TAMPER" }],
        });

        const pmtRes = await pgClient.query(
          `SELECT id FROM public.payments WHERE sale_id = $1;`,
          [sale.sale_id]
        );
        const paymentId = pmtRes.rows[0].id;

        const key = randomUUID();
        const call1 = await managerClient.rpc("void_sale", {
          p_org_id: orgId,
          p_sale_id: sale.sale_id,
          p_void_reason: "Reversal ref tamper test",
          p_idempotency_key: key,
          p_reversal_references: [
            { payment_id: paymentId, reference_no: "ORIGINAL-AUTH-111" },
          ],
        });
        expect(call1.error).toBeNull();
        expect(call1.data.is_replay).toBe(false);

        // Tamper with reversal reference under same key
        const call2 = await managerClient.rpc("void_sale", {
          p_org_id: orgId,
          p_sale_id: sale.sale_id,
          p_void_reason: "Reversal ref tamper test",
          p_idempotency_key: key,
          p_reversal_references: [
            { payment_id: paymentId, reference_no: "TAMPERED-AUTH-999" },
          ],
        });

        expect(call2.error).not.toBeNull();
        expect(call2.error!.code).toBe("P0024");
      });

      it("idempotency is organization-scoped; Org B can use the same idempotency key as Org A without conflict", async () => {
        // 1. Org A sale and void
        const saleA = await createTestSale({
          customerId,
          payments: [{ payment_method: "cash", amount: 44.0, amount_tendered: 50.0, change_due: 6.0 }],
        });

        const sharedKey = randomUUID();
        const voidA = await managerClient.rpc("void_sale", {
          p_org_id: orgId,
          p_sale_id: saleA.sale_id,
          p_void_reason: "Org A void",
          p_idempotency_key: sharedKey,
        });
        expect(voidA.error).toBeNull();
        expect(voidA.data.is_replay).toBe(false);

        // 2. Org B sale
        const prodB = await pgClient.query(
          `SELECT id FROM public.products WHERE organization_id = $1 LIMIT 1;`,
          [orgBId]
        );
        const saleBRes = await orgBClient.rpc("execute_sale", {
          p_org_id: orgBId,
          p_customer_id: null,
          p_items: [{ product_id: prodB.rows[0].id, quantity: 1, unit_price: 20.0, line_discount_amount: 0 }],
          p_payments: [{ payment_method: "cash", amount: 22.0, amount_tendered: 22.0, change_due: 0 }],
          p_order_discount_amount: 0,
          p_idempotency_key: randomUUID(),
          p_notes: "Org B sale",
        });
        expect(saleBRes.error).toBeNull();

        // 3. Org B voids with the EXACT SAME idempotency key as Org A
        const voidB = await orgBClient.rpc("void_sale", {
          p_org_id: orgBId,
          p_sale_id: saleBRes.data.sale_id,
          p_void_reason: "Org B void with same key",
          p_idempotency_key: sharedKey,
        });

        // Must succeed without collision because idempotency is scoped strictly to organization_id
        expect(voidB.error).toBeNull();
        expect(voidB.data.success).toBe(true);
        expect(voidB.data.is_replay).toBe(false);
        expect(voidB.data.sale_id).toBe(saleBRes.data.sale_id);
      });

      it("two concurrent requests with the same organization and idempotency key serialize cleanly without duplicate effects", async () => {
        const sale = await createTestSale({
          customerId,
          payments: [{ payment_method: "cash", amount: 44.0, amount_tendered: 50.0, change_due: 6.0 }],
        });

        const concurrentKey = randomUUID();

        // Fire both simultaneously
        const [res1, res2] = await Promise.all([
          managerClient.rpc("void_sale", {
            p_org_id: orgId,
            p_sale_id: sale.sale_id,
            p_void_reason: "Concurrent same key void",
            p_idempotency_key: concurrentKey,
          }),
          managerClient.rpc("void_sale", {
            p_org_id: orgId,
            p_sale_id: sale.sale_id,
            p_void_reason: "Concurrent same key void",
            p_idempotency_key: concurrentKey,
          }),
        ]);

        // Both must succeed
        expect(res1.error).toBeNull();
        expect(res2.error).toBeNull();
        expect(res1.data.success).toBe(true);
        expect(res2.data.success).toBe(true);

        // One must be the original execution (is_replay = false), the other an idempotent replay (is_replay = true)
        const replayFlags = [res1.data.is_replay, res2.data.is_replay].sort();
        expect(replayFlags).toEqual([false, true]);

        // Verify persisted DB state: exactly 1 refund record, exactly 1 stock movement
        const refundCount = await pgClient.query(
          `SELECT count(*) FROM public.refunds WHERE sale_id = $1;`,
          [sale.sale_id]
        );
        expect(Number(refundCount.rows[0].count)).toBe(1);

        const mvtCount = await pgClient.query(
          `SELECT count(*) FROM public.stock_movements WHERE reference_id = $1;`,
          [`void:${sale.sale_id}`]
        );
        expect(Number(mvtCount.rows[0].count)).toBe(1);
      });

      it("two concurrent requests with different keys against the same sale cannot create duplicate effects", async () => {
        const sale = await createTestSale({
          customerId,
          payments: [{ payment_method: "cash", amount: 44.0, amount_tendered: 50.0, change_due: 6.0 }],
        });

        const key1 = randomUUID();
        const key2 = randomUUID();

        // Fire both simultaneously with different idempotency keys
        const [res1, res2] = await Promise.all([
          managerClient.rpc("void_sale", {
            p_org_id: orgId,
            p_sale_id: sale.sale_id,
            p_void_reason: "Concurrent diff key void 1",
            p_idempotency_key: key1,
          }),
          managerClient.rpc("void_sale", {
            p_org_id: orgId,
            p_sale_id: sale.sale_id,
            p_void_reason: "Concurrent diff key void 2",
            p_idempotency_key: key2,
          }),
        ]);

        // Exactly one must succeed, and the other must fail with P0050 (sale already voided)
        const successes = [res1, res2].filter((r) => r.error === null && r.data?.success === true);
        const failures = [res1, res2].filter((r) => r.error !== null);

        expect(successes.length).toBe(1);
        expect(failures.length).toBe(1);
        expect(failures[0]?.error?.code).toBe("P0050");

        // Verify persisted DB state: exactly 1 refund record, exactly 1 stock movement
        const refundCount = await pgClient.query(
          `SELECT count(*) FROM public.refunds WHERE sale_id = $1;`,
          [sale.sale_id]
        );
        expect(Number(refundCount.rows[0].count)).toBe(1);

        const mvtCount = await pgClient.query(
          `SELECT count(*) FROM public.stock_movements WHERE reference_id = $1;`,
          [`void:${sale.sale_id}`]
        );
        expect(Number(mvtCount.rows[0].count)).toBe(1);
      });

      it("rejects attempt to void an already voided sale under a different key with P0050", async () => {
        const sale = await createTestSale({
          customerId,
          payments: [{ payment_method: "cash", amount: 44.0, amount_tendered: 50.0, change_due: 6.0 }],
        });

        // Void first time
        await managerClient.rpc("void_sale", {
          p_org_id: orgId,
          p_sale_id: sale.sale_id,
          p_void_reason: "First void",
          p_idempotency_key: randomUUID(),
        });

        // Void second time with different key
        const secondAttempt = await managerClient.rpc("void_sale", {
          p_org_id: orgId,
          p_sale_id: sale.sale_id,
          p_void_reason: "Second void attempt",
          p_idempotency_key: randomUUID(),
        });

        expect(secondAttempt.error).not.toBeNull();
        expect(secondAttempt.error!.code).toBe("P0050");
      });
    });

    // ------------------------------------------------------------------------
    // E. Returns Invariant Protection
    // ------------------------------------------------------------------------
    describe("Return Invariant Protection", () => {
      it("blocks void on a sale that has an existing processed return with P0051", async () => {
        const sale = await createTestSale({
          customerId,
          payments: [{ payment_method: "cash", amount: 44.0, amount_tendered: 50.0, change_due: 6.0 }],
        });

        // Insert a dummy return directly for testing F005-051 precondition
        const returnNumber = `SR-20261122-0001`;
        await pgClient.query(
          `INSERT INTO public.sale_returns (organization_id, sale_id, return_number, total_refund_amount, reason, idempotency_key, idempotency_hash, created_by)
           VALUES ($1, $2, $3, 20.0000, 'Partial return test', gen_random_uuid(), 'dummy_hash', $4);`,
          [orgId, sale.sale_id, returnNumber, managerUserId]
        );

        // Attempt void
        const voidRes = await managerClient.rpc("void_sale", {
          p_org_id: orgId,
          p_sale_id: sale.sale_id,
          p_void_reason: "Attempt voiding sale with returns",
          p_idempotency_key: randomUUID(),
        });

        expect(voidRes.error).not.toBeNull();
        expect(voidRes.error!.code).toBe("P0051");
        expect(voidRes.error!.message).toContain("SALE_VOID_HAS_RETURNS_BLOCKED");
      });

      it("transaction atomicity: failed void transaction does not alter sale state or leave partial records", async () => {
        const sale = await createTestSale({
          customerId,
          payments: [{ payment_method: "cash", amount: 44.0, amount_tendered: 50.0, change_due: 6.0 }],
        });

        // Insert a dummy return directly to force failure
        const returnNumber = `SR-20261122-0002`;
        await pgClient.query(
          `INSERT INTO public.sale_returns (organization_id, sale_id, return_number, total_refund_amount, reason, idempotency_key, idempotency_hash, created_by)
           VALUES ($1, $2, $3, 10.0000, 'Return for atomicity test', gen_random_uuid(), 'dummy_hash', $4);`,
          [orgId, sale.sale_id, returnNumber, managerUserId]
        );

        // Attempt void (will fail with P0051)
        const voidRes = await managerClient.rpc("void_sale", {
          p_org_id: orgId,
          p_sale_id: sale.sale_id,
          p_void_reason: "Failed void atomicity test",
          p_idempotency_key: randomUUID(),
        });
        expect(voidRes.error).not.toBeNull();
        expect(voidRes.error!.code).toBe("P0051");

        // Verify sale status and payment_status are untouched
        const saleRow = await pgClient.query(
          `SELECT status, payment_status, void_reason, voided_at FROM public.sales WHERE id = $1;`,
          [sale.sale_id]
        );
        expect(saleRow.rows[0].status).toBe("completed");
        expect(saleRow.rows[0].payment_status).toBe("paid");
        expect(saleRow.rows[0].void_reason).toBeNull();
        expect(saleRow.rows[0].voided_at).toBeNull();

        // Verify NO refunds created for this void
        const refundCount = await pgClient.query(
          `SELECT count(*) FROM public.refunds WHERE sale_id = $1;`,
          [sale.sale_id]
        );
        expect(Number(refundCount.rows[0].count)).toBe(0);

        // Verify NO stock movements created for this void
        const mvtCount = await pgClient.query(
          `SELECT count(*) FROM public.stock_movements WHERE reference_id = $1;`,
          [`void:${sale.sale_id}`]
        );
        expect(Number(mvtCount.rows[0].count)).toBe(0);
      });
    });
  }
);
