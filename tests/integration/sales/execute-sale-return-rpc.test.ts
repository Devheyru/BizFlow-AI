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
  "Feature 005 — Phase 7 execute_sale_return Database RPC & F005-039 Integration Tests (T069-T071, US4)",
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
    let productIdKg: string;
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
      const ownerEmail = `ret-owner-${timestamp}@example.com`;
      const uOwner = await adminClient.auth.admin.createUser({
        email: ownerEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "Return", last_name: "Owner" },
      });
      ownerUserId = uOwner.data.user!.id;

      const mgrEmail = `ret-mgr-${timestamp}@example.com`;
      const uMgr = await adminClient.auth.admin.createUser({
        email: mgrEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "Return", last_name: "Manager" },
      });
      managerUserId = uMgr.data.user!.id;

      const cashEmail = `ret-cash-${timestamp}@example.com`;
      const uCash = await adminClient.auth.admin.createUser({
        email: cashEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "Return", last_name: "Cashier" },
      });
      cashierUserId = uCash.data.user!.id;

      const orgBEmail = `ret-orgb-${timestamp}@example.com`;
      const uOrgB = await adminClient.auth.admin.createUser({
        email: orgBEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "Return", last_name: "OrgB" },
      });
      orgBUserId = uOrgB.data.user!.id;

      // 2. Insert Profiles
      await pgClient.query(
        `INSERT INTO public.profiles (id, first_name, last_name)
         VALUES 
           ($1, 'Return', 'Owner'),
           ($2, 'Return', 'Manager'),
           ($3, 'Return', 'Cashier'),
           ($4, 'Return', 'OrgB')
         ON CONFLICT (id) DO NOTHING;`,
        [ownerUserId, managerUserId, cashierUserId, orgBUserId]
      );

      // 3. Create Org A
      const orgSlug = `ret-org-a-${timestamp}`;
      const resOrgA = await pgClient.query(
        `INSERT INTO public.organizations (name, slug, business_type, country, currency, timezone, created_by)
         VALUES ('Return Org A', $1, 'retail', 'US', 'USD', 'America/New_York', $2)
         RETURNING id;`,
        [orgSlug, ownerUserId]
      );
      orgId = resOrgA.rows[0].id;

      // 4. Create Org B
      const orgBSlug = `ret-org-b-${timestamp}`;
      const resOrgB = await pgClient.query(
        `INSERT INTO public.organizations (name, slug, business_type, country, currency, timezone, created_by)
         VALUES ('Return Org B', $1, 'retail', 'US', 'USD', 'America/New_York', $2)
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
         VALUES ($1, 'Return Item 1', 'RET-SKU-1', 20.0000, 'piece', 'active', $2, $2)
         RETURNING id;`,
        [orgId, ownerUserId]
      );
      productId1 = p1Res.rows[0].id;

      const p2Res = await pgClient.query(
        `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
         VALUES ($1, 'Return Item 2', 'RET-SKU-2', 50.0000, 'piece', 'active', $2, $2)
         RETURNING id;`,
        [orgId, ownerUserId]
      );
      productId2 = p2Res.rows[0].id;

      const pKgRes = await pgClient.query(
        `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
         VALUES ($1, 'Return Bulk Item', 'RET-SKU-KG', 10.0000, 'kg', 'active', $2, $2)
         RETURNING id;`,
        [orgId, ownerUserId]
      );
      productIdKg = pKgRes.rows[0].id;

      // Add Stock in Org A (100 each)
      await pgClient.query(
        `INSERT INTO public.inventory (organization_id, product_id, quantity)
         VALUES 
           ($1, $2, 100.0000),
           ($1, $3, 100.0000),
           ($1, $4, 100.0000)
         ON CONFLICT (organization_id, product_id) DO UPDATE SET quantity = 100.0000;`,
        [orgId, productId1, productId2, productIdKg]
      );

      // Tax & Product in Org B
      await pgClient.query(
        `INSERT INTO public.organization_tax_settings (organization_id, tax_name, default_tax_rate, is_tax_inclusive, updated_by)
         VALUES ($1, 'Sales Tax', 10.0000, false, $2)
         ON CONFLICT (organization_id) DO NOTHING;`,
        [orgBId, orgBUserId]
      );

      const pbRes = await pgClient.query(
        `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
         VALUES ($1, 'Org B Product', 'ORGB-RET-1', 20.0000, 'piece', 'active', $2, $2)
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
         VALUES ($1, 'Return Test Customer', '+15555550299', 'ret.cust@example.com', 'active')
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
            await pgClient.query(`DELETE FROM public.sale_return_items WHERE return_id IN (SELECT id FROM public.sale_returns WHERE organization_id = $1);`, [orgId]);
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

    // Helper to create a completed sale
    async function createTestSale(options?: {
      item1Qty?: number;
      item2Qty?: number;
      paymentMethod?: string;
      splitPayments?: Array<{
        payment_method: string;
        amount: number;
        amount_tendered?: number | null;
        change_due?: number | null;
        reference_no?: string | null;
      }>;
      includeContinuousItem?: boolean;
      continuousQty?: number;
    }) {
      const q1 = options?.item1Qty ?? 2; // 2 * $20 = $40
      const q2 = options?.item2Qty ?? 1; // 1 * $50 = $50
      const qKg = options?.includeContinuousItem ? (options?.continuousQty ?? 2.5) : 0; // 2.5 * $10 = $25
      const subtotal = q1 * 20.0 + q2 * 50.0 + qKg * 10.0;
      const total = Number((subtotal * 1.1).toFixed(4));
      const method = options?.paymentMethod || "cash";

      const payments = options?.splitPayments || [
        {
          payment_method: method,
          amount: total,
          amount_tendered: method === "cash" ? Number((total + 1.0).toFixed(4)) : null,
          change_due: method === "cash" ? 1.0 : null,
          reference_no: method !== "cash" ? "REF-" + randomUUID().slice(0, 8) : null,
        },
      ];

      const saleItems: any[] = [
        { product_id: productId1, quantity: q1, unit_price: 20.0, line_discount_amount: 0 },
        { product_id: productId2, quantity: q2, unit_price: 50.0, line_discount_amount: 0 },
      ];
      if (options?.includeContinuousItem) {
        saleItems.push({
          product_id: productIdKg,
          quantity: qKg,
          unit_price: 10.0,
          line_discount_amount: 0,
        });
      }

      const res = await managerClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: customerId,
        p_items: saleItems,
        p_payments: payments,
        p_order_discount_amount: 0,
        p_idempotency_key: randomUUID(),
        p_notes: "Test sale for returns",
      });

      expect(res.error).toBeNull();
      expect(res.data.success).toBe(true);

      // Fetch sale items to have sale_item_ids
      const itemsRes = await pgClient.query(
        `SELECT id, product_id, quantity, unit_price, total_price 
         FROM public.sale_items 
         WHERE sale_id = $1 
         ORDER BY unit_price ASC;`,
        [res.data.sale_id]
      );

      const itemKg = itemsRes.rows.find((r: any) => r.product_id === productIdKg);
      const item1 = itemsRes.rows.find((r: any) => r.product_id === productId1);
      const item2 = itemsRes.rows.find((r: any) => r.product_id === productId2);

      return {
        saleId: res.data.sale_id,
        saleNumber: res.data.sale_number,
        totalAmount: total,
        item1: item1 || itemsRes.rows[0],
        item2: item2 || itemsRes.rows[1],
        itemKg,
      };
    }

    // ------------------------------------------------------------------------
    // A. Function Metadata & Privilege Verification
    // ------------------------------------------------------------------------
    describe("Function Metadata & Security", () => {
      it("verifies execute_sale_return has correct owner, security definer, and search path", async () => {
        const query = await pgClient.query(`
          SELECT 
            p.proname,
            r.rolname as owner,
            p.prosecdef as is_security_definer,
            p.proconfig as search_path
          FROM pg_proc p
          JOIN pg_roles r ON p.proowner = r.oid
          WHERE p.proname = 'execute_sale_return' AND p.pronamespace = 'public'::regnamespace;
        `);

        expect(query.rows.length).toBe(1);
        const row = query.rows[0];
        expect(row.owner).toBe("postgres");
        expect(row.is_security_definer).toBe(true);
        expect(row.search_path).toContain("search_path=pg_catalog, public, pg_temp");
      });

      it("verifies execute_sale_return privileges (authenticated only)", async () => {
        const grantQuery = await pgClient.query(`
          SELECT grantee, privilege_type
          FROM information_schema.routine_privileges
          WHERE routine_schema = 'public' AND routine_name = 'execute_sale_return';
        `);

        const grantees = grantQuery.rows.map((r) => r.grantee);
        expect(grantees).toContain("authenticated");
        expect(grantees).not.toContain("anon");
        expect(grantees).not.toContain("PUBLIC");
      });
    });

    // ------------------------------------------------------------------------
    // B. Partial Return with Restock & Inventory Restoration
    // ------------------------------------------------------------------------
    describe("Partial Return with Inventory Restock", () => {
      it("processes partial return with restock, creates return stock movement, and increases inventory", async () => {
        const sale = await createTestSale();

        // Get initial inventory for Product 1
        const invBefore = await pgClient.query(
          `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
          [orgId, productId1]
        );
        const qtyBefore = Number(invBefore.rows[0].quantity);

        const returnRes = await managerClient.rpc("execute_sale_return", {
          p_org_id: orgId,
          p_sale_id: sale.saleId,
          p_return_items: [
            {
              sale_item_id: sale.item1.id,
              quantity: 1, // Return 1 out of 2
              restock_to_inventory: true,
            },
          ],
          p_refund_method: "cash",
          p_reason: "Customer returned 1 defective headset",
          p_idempotency_key: randomUUID(),
          p_reference_no: null,
        });

        expect(returnRes.error).toBeNull();
        expect(returnRes.data.success).toBe(true);
        expect(returnRes.data.is_replay).toBe(false);
        expect(returnRes.data.return_number).toMatch(/^RET-\d{8}-\d{4}$/);
        expect(returnRes.data.sale_status).toBe("partially_returned");
        expect(returnRes.data.payment_status).toBe("partially_refunded");
        expect(returnRes.data.refund_status).toBe("completed");

        const returnId = returnRes.data.return_id;

        // Verify stock movement created with movement_type = 'return' and positive delta
        const movQuery = await pgClient.query(
          `SELECT movement_type, quantity_delta, reference_id 
           FROM public.stock_movements 
           WHERE organization_id = $1 AND product_id = $2 AND reference_id = $3;`,
          [orgId, productId1, `return:${returnId}`]
        );
        expect(movQuery.rows.length).toBe(1);
        expect(movQuery.rows[0].movement_type).toBe("return");
        expect(Number(movQuery.rows[0].quantity_delta)).toBe(1.0);

        // Verify inventory increased by 1
        const invAfter = await pgClient.query(
          `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
          [orgId, productId1]
        );
        expect(Number(invAfter.rows[0].quantity)).toBe(qtyBefore + 1.0);

        // Verify sale_return_items has movement_id set
        const sriQuery = await pgClient.query(
          `SELECT movement_id, restock_to_inventory, quantity, refund_amount 
           FROM public.sale_return_items 
           WHERE return_id = $1;`,
          [returnId]
        );
        expect(sriQuery.rows[0].movement_id).not.toBeNull();
        expect(sriQuery.rows[0].restock_to_inventory).toBe(true);
      });
    });

    // ------------------------------------------------------------------------
    // C. Partial Return without Restock
    // ------------------------------------------------------------------------
    describe("Partial Return without Restock", () => {
      it("processes return without restock, records 0 stock movements, and leaves inventory untouched", async () => {
        const sale = await createTestSale();

        const invBefore = await pgClient.query(
          `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
          [orgId, productId1]
        );
        const qtyBefore = Number(invBefore.rows[0].quantity);

        const returnRes = await managerClient.rpc("execute_sale_return", {
          p_org_id: orgId,
          p_sale_id: sale.saleId,
          p_return_items: [
            {
              sale_item_id: sale.item1.id,
              quantity: 1,
              restock_to_inventory: false,
            },
          ],
          p_refund_method: "cash",
          p_reason: "Damaged packaging, discard item",
          p_idempotency_key: randomUUID(),
        });

        expect(returnRes.error).toBeNull();
        expect(returnRes.data.success).toBe(true);
        const returnId = returnRes.data.return_id;

        // Verify NO stock movement created for this return
        const movQuery = await pgClient.query(
          `SELECT id FROM public.stock_movements WHERE reference_id = $1;`,
          [`return:${returnId}`]
        );
        expect(movQuery.rows.length).toBe(0);

        // Verify inventory quantity is unchanged
        const invAfter = await pgClient.query(
          `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
          [orgId, productId1]
        );
        expect(Number(invAfter.rows[0].quantity)).toBe(qtyBefore);

        // Verify sale_return_items has NULL movement_id
        const sriQuery = await pgClient.query(
          `SELECT movement_id, restock_to_inventory FROM public.sale_return_items WHERE return_id = $1;`,
          [returnId]
        );
        expect(sriQuery.rows[0].movement_id).toBeNull();
        expect(sriQuery.rows[0].restock_to_inventory).toBe(false);
      });
    });

    // ------------------------------------------------------------------------
    // D. Multi-Line Return & Proportional Residual Absorption
    // ------------------------------------------------------------------------
    describe("Multi-Line Return & Full Return Completion", () => {
      it("fully returns all remaining items, absorbs residual rounding, and sets status to 'returned' & 'refunded'", async () => {
        const sale = await createTestSale();

        // Return all items in full
        const returnRes = await managerClient.rpc("execute_sale_return", {
          p_org_id: orgId,
          p_sale_id: sale.saleId,
          p_return_items: [
            { sale_item_id: sale.item1.id, quantity: 2, restock_to_inventory: true },
            { sale_item_id: sale.item2.id, quantity: 1, restock_to_inventory: true },
          ],
          p_refund_method: "cash",
          p_reason: "Customer returned entire cart",
          p_idempotency_key: randomUUID(),
        });

        expect(returnRes.error).toBeNull();
        expect(returnRes.data.success).toBe(true);
        expect(returnRes.data.sale_status).toBe("returned");
        expect(returnRes.data.payment_status).toBe("refunded");
        expect(Number(returnRes.data.total_refund_amount)).toBeCloseTo(sale.totalAmount, 2);

        // Verify sale record in DB
        const saleCheck = await pgClient.query(
          `SELECT status, payment_status FROM public.sales WHERE id = $1;`,
          [sale.saleId]
        );
        expect(saleCheck.rows[0].status).toBe("returned");
        expect(saleCheck.rows[0].payment_status).toBe("refunded");
      });
    });

    // ------------------------------------------------------------------------
    // E. F005-039 Non-Cash Tender & Pending Refund Payment Status
    // ------------------------------------------------------------------------
    describe("F005-039 Non-Cash Tender Lifecycle", () => {
      it("processes return with card refund, creates pending refund, and sets payment_status to 'partially_refunded'", async () => {
        const sale = await createTestSale({ paymentMethod: "card" });

        const returnRes = await managerClient.rpc("execute_sale_return", {
          p_org_id: orgId,
          p_sale_id: sale.saleId,
          p_return_items: [
            { sale_item_id: sale.item1.id, quantity: 2, restock_to_inventory: true },
            { sale_item_id: sale.item2.id, quantity: 1, restock_to_inventory: true },
          ],
          p_refund_method: "card",
          p_reason: "Return paid via card",
          p_idempotency_key: randomUUID(),
          p_reference_no: "ARN-CARD-12345",
        });

        expect(returnRes.error).toBeNull();
        expect(returnRes.data.success).toBe(true);
        // All items returned -> sale status is returned
        expect(returnRes.data.sale_status).toBe("returned");
        // Non-cash refund is pending confirmation -> payment status MUST be partially_refunded (F005-039)
        expect(returnRes.data.payment_status).toBe("partially_refunded");
        expect(returnRes.data.refund_status).toBe("pending");

        // Verify refund record in DB
        const refQuery = await pgClient.query(
          `SELECT status, refund_method, reference_no FROM public.refunds WHERE id = $1;`,
          [returnRes.data.refund_id]
        );
        expect(refQuery.rows[0].status).toBe("pending");
        expect(refQuery.rows[0].refund_method).toBe("card");
        expect(refQuery.rows[0].reference_no).toBe("ARN-CARD-12345");
      });
    });

    // ------------------------------------------------------------------------
    // F. Inactive Product Restock Invariant (P0056, Gap A)
    // ------------------------------------------------------------------------
    describe("Product Inactive Restock Invariant (P0056, Gap A)", () => {
      it("Case 3: rejects return with restock enabled for inactive product with P0056", async () => {
        const sale = await createTestSale();

        try {
          // Deactivate Product 1
          await pgClient.query(
            `UPDATE public.products SET status = 'inactive' WHERE id = $1;`,
            [productId1]
          );

          // Attempt return with restock = true -> FAILS with P0056
          const failRes = await managerClient.rpc("execute_sale_return", {
            p_org_id: orgId,
            p_sale_id: sale.saleId,
            p_return_items: [
              { sale_item_id: sale.item1.id, quantity: 1, restock_to_inventory: true },
            ],
            p_refund_method: "cash",
            p_reason: "Attempting restock of inactive product",
            p_idempotency_key: randomUUID(),
          });

          expect(failRes.error).not.toBeNull();
          expect(failRes.error!.code).toBe("P0056");
          expect(failRes.error!.message).toContain("PRODUCT_INACTIVE_RETURN_BLOCKED");
        } finally {
          // Reactivate product for subsequent tests
          await pgClient.query(
            `UPDATE public.products SET status = 'active' WHERE id = $1;`,
            [productId1]
          );
        }
      });

      it("Case 4: allows return with restock disabled for inactive product without creating inventory movement", async () => {
        const sale = await createTestSale();

        const invBefore = await pgClient.query(
          `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
          [orgId, productId1]
        );
        const qtyBefore = Number(invBefore.rows[0].quantity);

        try {
          // Deactivate Product 1
          await pgClient.query(
            `UPDATE public.products SET status = 'inactive' WHERE id = $1;`,
            [productId1]
          );

          // Attempt return with restock = false -> SUCCEEDS
          const succRes = await managerClient.rpc("execute_sale_return", {
            p_org_id: orgId,
            p_sale_id: sale.saleId,
            p_return_items: [
              { sale_item_id: sale.item1.id, quantity: 1, restock_to_inventory: false },
            ],
            p_refund_method: "cash",
            p_reason: "Return inactive product without restocking",
            p_idempotency_key: randomUUID(),
          });

          expect(succRes.error).toBeNull();
          expect(succRes.data.success).toBe(true);

          const returnId = succRes.data.return_id;

          // Verify 0 stock movements created
          const movQuery = await pgClient.query(
            `SELECT count(*) FROM public.stock_movements WHERE organization_id = $1 AND reference_id = $2;`,
            [orgId, `return:${returnId}`]
          );
          expect(Number(movQuery.rows[0].count)).toBe(0);

          // Verify inventory quantity is untouched
          const invAfter = await pgClient.query(
            `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
            [orgId, productId1]
          );
          expect(Number(invAfter.rows[0].quantity)).toBe(qtyBefore);
        } finally {
          // Reactivate product for subsequent tests
          await pgClient.query(
            `UPDATE public.products SET status = 'active' WHERE id = $1;`,
            [productId1]
          );
        }
      });
    });

    // ------------------------------------------------------------------------
    // G. Excess Quantity & Duplicate Item Invariants (P0052, P0060)
    // ------------------------------------------------------------------------
    describe("Excess Quantity and Duplicate Item Invariants", () => {
      it("rejects return quantity exceeding sold quantity with P0052", async () => {
        const sale = await createTestSale();

        // Item 1 sold quantity is 2. Attempt to return 5.
        const res = await managerClient.rpc("execute_sale_return", {
          p_org_id: orgId,
          p_sale_id: sale.saleId,
          p_return_items: [
            { sale_item_id: sale.item1.id, quantity: 5, restock_to_inventory: true },
          ],
          p_refund_method: "cash",
          p_reason: "Excess return test",
          p_idempotency_key: randomUUID(),
        });

        expect(res.error).not.toBeNull();
        expect(res.error!.code).toBe("P0052");
        expect(res.error!.message).toContain("RETURN_QUANTITY_EXCEEDS_SOLD");
      });

      it("rejects duplicate sale items in return payload with P0060", async () => {
        const sale = await createTestSale();

        const res = await managerClient.rpc("execute_sale_return", {
          p_org_id: orgId,
          p_sale_id: sale.saleId,
          p_return_items: [
            { sale_item_id: sale.item1.id, quantity: 1, restock_to_inventory: true },
            { sale_item_id: sale.item1.id, quantity: 1, restock_to_inventory: true },
          ],
          p_refund_method: "cash",
          p_reason: "Duplicate item test",
          p_idempotency_key: randomUUID(),
        });

        expect(res.error).not.toBeNull();
        expect(res.error!.code).toBe("P0060");
        expect(res.error!.message).toContain("DUPLICATE_RETURN_ITEM");
      });
    });

    // ------------------------------------------------------------------------
    // H. Voided Sale Return Blocked (P0050)
    // ------------------------------------------------------------------------
    describe("Voided Sale Return Guard", () => {
      it("blocks returns against a sale that has been voided with P0050", async () => {
        const sale = await createTestSale();

        // Void the sale first
        const voidRes = await managerClient.rpc("void_sale", {
          p_org_id: orgId,
          p_sale_id: sale.saleId,
          p_void_reason: "Voiding sale before return test",
          p_idempotency_key: randomUUID(),
        });
        expect(voidRes.error).toBeNull();

        // Attempt return on voided sale -> P0050
        const retRes = await managerClient.rpc("execute_sale_return", {
          p_org_id: orgId,
          p_sale_id: sale.saleId,
          p_return_items: [
            { sale_item_id: sale.item1.id, quantity: 1, restock_to_inventory: true },
          ],
          p_refund_method: "cash",
          p_reason: "Attempted return on voided sale",
          p_idempotency_key: randomUUID(),
        });

        expect(retRes.error).not.toBeNull();
        expect(retRes.error!.code).toBe("P0050");
        expect(retRes.error!.message).toContain("SALE_ALREADY_VOIDED");
      });
    });

    // ------------------------------------------------------------------------
    // I. Idempotency Replay and Conflict (P0055, P0024)
    // ------------------------------------------------------------------------
    describe("Idempotency Replay & Conflict", () => {
      it("replays identical return request returning cached result with is_replay = true", async () => {
        const sale = await createTestSale();
        const idemKey = randomUUID();

        const returnItems = [
          { sale_item_id: sale.item1.id, quantity: 1, restock_to_inventory: true },
        ];

        // Call 1
        const res1 = await managerClient.rpc("execute_sale_return", {
          p_org_id: orgId,
          p_sale_id: sale.saleId,
          p_return_items: returnItems,
          p_refund_method: "cash",
          p_reason: "Idempotency test return",
          p_idempotency_key: idemKey,
        });

        expect(res1.error).toBeNull();
        expect(res1.data.success).toBe(true);
        expect(res1.data.is_replay).toBe(false);

        // Call 2 with identical key and payload
        const res2 = await managerClient.rpc("execute_sale_return", {
          p_org_id: orgId,
          p_sale_id: sale.saleId,
          p_return_items: returnItems,
          p_refund_method: "cash",
          p_reason: "Idempotency test return",
          p_idempotency_key: idemKey,
        });

        expect(res2.error).toBeNull();
        expect(res2.data.success).toBe(true);
        expect(res2.data.is_replay).toBe(true);
        expect(res2.data.return_id).toBe(res1.data.return_id);
        expect(res2.data.refund_id).toBe(res1.data.refund_id);
        expect(res2.data.total_refund_amount).toBe(res1.data.total_refund_amount);

        // Verify only 1 sale_returns record exists
        const countQuery = await pgClient.query(
          `SELECT count(*) FROM public.sale_returns WHERE idempotency_key = $1;`,
          [idemKey]
        );
        expect(Number(countQuery.rows[0].count)).toBe(1);
      });

      it("rejects different payload with same idempotency key with P0024", async () => {
        const sale = await createTestSale();
        const idemKey = randomUUID();

        // Call 1: return item 1
        const res1 = await managerClient.rpc("execute_sale_return", {
          p_org_id: orgId,
          p_sale_id: sale.saleId,
          p_return_items: [
            { sale_item_id: sale.item1.id, quantity: 1, restock_to_inventory: true },
          ],
          p_refund_method: "cash",
          p_reason: "First payload",
          p_idempotency_key: idemKey,
        });
        expect(res1.error).toBeNull();

        // Call 2: same key, different payload (item 2)
        const res2 = await managerClient.rpc("execute_sale_return", {
          p_org_id: orgId,
          p_sale_id: sale.saleId,
          p_return_items: [
            { sale_item_id: sale.item2.id, quantity: 1, restock_to_inventory: true },
          ],
          p_refund_method: "cash",
          p_reason: "Second conflicting payload",
          p_idempotency_key: idemKey,
        });

        expect(res2.error).not.toBeNull();
        expect(res2.error!.code).toBe("P0024");
        expect(res2.error!.message).toContain("IDEMPOTENCY_CONFLICT");
      });
    });

    // ------------------------------------------------------------------------
    // J. Cross-Tenant Isolation
    // ------------------------------------------------------------------------
    describe("Tenant Isolation", () => {
      it("blocks tenant from returning sale belonging to another organization with P0048", async () => {
        const sale = await createTestSale();

        // Org B client attempts to return Org A sale
        const crossRes = await orgBClient.rpc("execute_sale_return", {
          p_org_id: orgBId,
          p_sale_id: sale.saleId,
          p_return_items: [
            { sale_item_id: sale.item1.id, quantity: 1, restock_to_inventory: true },
          ],
          p_refund_method: "cash",
          p_reason: "Cross tenant attempt",
          p_idempotency_key: randomUUID(),
        });

        expect(crossRes.error).not.toBeNull();
        expect(crossRes.error!.code).toBe("P0048");
        expect(crossRes.error!.message).toContain("SALE_NOT_FOUND");
      });
    });

    // ------------------------------------------------------------------------
    // K. UOM Quantity Precision Invariants (P0015, P0016, Gap C)
    // ------------------------------------------------------------------------
    describe("UOM Quantity Precision Invariants (P0015, P0016, Gap C)", () => {
      it("rejects fractional return quantity for discrete product (piece) with P0015", async () => {
        const sale = await createTestSale();

        const res = await managerClient.rpc("execute_sale_return", {
          p_org_id: orgId,
          p_sale_id: sale.saleId,
          p_return_items: [
            { sale_item_id: sale.item1.id, quantity: 1.5, restock_to_inventory: true },
          ],
          p_refund_method: "cash",
          p_reason: "Fractional piece return attempt",
          p_idempotency_key: randomUUID(),
        });

        expect(res.error).not.toBeNull();
        expect(res.error!.code).toBe("P0015");
        expect(res.error!.message).toContain("INTEGER_QUANTITY_REQUIRED");
      });

      it("rejects return quantity exceeding 4 decimal places with P0016", async () => {
        const sale = await createTestSale();

        const res = await managerClient.rpc("execute_sale_return", {
          p_org_id: orgId,
          p_sale_id: sale.saleId,
          p_return_items: [
            { sale_item_id: sale.item1.id, quantity: 1.12345, restock_to_inventory: true },
          ],
          p_refund_method: "cash",
          p_reason: "Excess decimal precision return attempt",
          p_idempotency_key: randomUUID(),
        });

        expect(res.error).not.toBeNull();
        expect(res.error!.code).toBe("P0016");
        expect(res.error!.message).toContain("DECIMAL_PRECISION_EXCEEDED");
      });

      it("allows fractional return quantity for continuous product (kg) and restores inventory", async () => {
        const sale = await createTestSale({
          includeContinuousItem: true,
          continuousQty: 4.0,
        });

        expect(sale.itemKg).toBeDefined();

        const invBefore = await pgClient.query(
          `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
          [orgId, productIdKg]
        );
        const qtyBefore = Number(invBefore.rows[0].quantity);

        const res = await managerClient.rpc("execute_sale_return", {
          p_org_id: orgId,
          p_sale_id: sale.saleId,
          p_return_items: [
            { sale_item_id: sale.itemKg.id, quantity: 1.75, restock_to_inventory: true },
          ],
          p_refund_method: "cash",
          p_reason: "Return 1.75 kg of bulk item",
          p_idempotency_key: randomUUID(),
        });

        expect(res.error).toBeNull();
        expect(res.data.success).toBe(true);

        const returnId = res.data.return_id;

        // Check stock movement has 1.7500 delta
        const movQuery = await pgClient.query(
          `SELECT movement_type, quantity_delta FROM public.stock_movements 
           WHERE organization_id = $1 AND product_id = $2 AND reference_id = $3;`,
          [orgId, productIdKg, `return:${returnId}`]
        );
        expect(movQuery.rows.length).toBe(1);
        expect(Number(movQuery.rows[0].quantity_delta)).toBe(1.75);

        // Check inventory restored by 1.7500
        const invAfter = await pgClient.query(
          `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
          [orgId, productIdKg]
        );
        expect(Number(invAfter.rows[0].quantity)).toBe(qtyBefore + 1.75);
      });
    });

    // ------------------------------------------------------------------------
    // L. Split-Tender and Cumulative Refund Ceilings (P0061, P0054, Gap D)
    // ------------------------------------------------------------------------
    describe("Split-Tender and Cumulative Refund Ceilings (P0061, P0054, Gap D)", () => {
      it("rejects non-cash refund exceeding original tender for that method with P0061", async () => {
        // Sale: Item 1 ($44 tax incl), Item 2 ($55 tax incl), Total = $99.00
        // Split payment: Cash $69.00, Card $30.00
        const sale = await createTestSale({
          splitPayments: [
            {
              payment_method: "cash",
              amount: 69.0,
              amount_tendered: 70.0,
              change_due: 1.0,
            },
            {
              payment_method: "card",
              amount: 30.0,
              reference_no: "CARD-SPLIT-1",
            },
          ],
        });

        // Item 2 refund alone is $55.00. Attempt to refund via Card ($30 ceiling).
        const res = await managerClient.rpc("execute_sale_return", {
          p_org_id: orgId,
          p_sale_id: sale.saleId,
          p_return_items: [
            { sale_item_id: sale.item2.id, quantity: 1, restock_to_inventory: true },
          ],
          p_refund_method: "card",
          p_reason: "Attempting excess card refund",
          p_idempotency_key: randomUUID(),
          p_reference_no: "ARN-SPLIT-EXCEED",
        });

        expect(res.error).not.toBeNull();
        expect(res.error!.code).toBe("P0061");
        expect(res.error!.message).toContain("REFUND_METHOD_EXCEEDS_ORIGINAL_TENDER");
      });

      it("enforces cumulative refund cap check (P0054) against database ceiling", async () => {
        // Sale: Total = $99.00
        const sale = await createTestSale();

        // 1. Insert an existing completed refund of $80.00 directly for this sale
        const refId = randomUUID();
        await pgClient.query(
          `INSERT INTO public.refunds (
             id, organization_id, sale_id, return_id, parent_refund_id, obligation_refund_id,
             refund_method, amount, reference_no, status, reason, processed_by
           ) VALUES (
             $1, $2, $3, NULL, NULL, $1,
             'cash', 80.0000, NULL, 'completed', 'Prior direct refund test', $4
           );`,
          [refId, orgId, sale.saleId, ownerUserId]
        );

        // 2. Item 1 refund alone is $44.00.
        // 80.00 + 44.00 = 124.00 > total_amount 99.00 -> MUST fail with P0054
        const res = await managerClient.rpc("execute_sale_return", {
          p_org_id: orgId,
          p_sale_id: sale.saleId,
          p_return_items: [
            { sale_item_id: sale.item1.id, quantity: 2, restock_to_inventory: false },
          ],
          p_refund_method: "cash",
          p_reason: "Attempting refund exceeding sale total amount",
          p_idempotency_key: randomUUID(),
        });

        expect(res.error).not.toBeNull();
        expect(res.error!.code).toBe("P0054");
        expect(res.error!.message).toContain("REFUND_EXCEEDS_PAYABLE");
      });
    });

    // ------------------------------------------------------------------------
    // M. Concurrency and Race Condition Safeguards (Gap D)
    // ------------------------------------------------------------------------
    describe("Concurrency and Race Condition Safeguards (Gap D)", () => {
      it("concurrent identical idempotency requests resolve safely without duplicate records", async () => {
        const sale = await createTestSale();
        const idemKey = randomUUID();

        const payload = {
          p_org_id: orgId,
          p_sale_id: sale.saleId,
          p_return_items: [
            { sale_item_id: sale.item1.id, quantity: 1, restock_to_inventory: true },
          ],
          p_refund_method: "cash",
          p_reason: "Concurrent idempotency test",
          p_idempotency_key: idemKey,
        };

        // Fire both requests concurrently
        const [res1, res2] = await Promise.all([
          managerClient.rpc("execute_sale_return", payload),
          managerClient.rpc("execute_sale_return", payload),
        ]);

        expect(res1.error).toBeNull();
        expect(res2.error).toBeNull();
        expect(res1.data.success).toBe(true);
        expect(res2.data.success).toBe(true);

        // One must be fresh, one must be replay (or both succeed returning identical return_id)
        expect(res1.data.return_id).toBe(res2.data.return_id);
        const replays = [res1.data.is_replay, res2.data.is_replay];
        expect(replays).toContain(true);
        expect(replays).toContain(false);

        // Verify exactly 1 return header exists in database
        const returnsCount = await pgClient.query(
          `SELECT count(*) FROM public.sale_returns WHERE organization_id = $1 AND idempotency_key = $2;`,
          [orgId, idemKey]
        );
        expect(Number(returnsCount.rows[0].count)).toBe(1);

        // Verify exactly 1 refund record exists
        const refundsCount = await pgClient.query(
          `SELECT count(*) FROM public.refunds WHERE organization_id = $1 AND return_id = $2;`,
          [orgId, res1.data.return_id]
        );
        expect(Number(refundsCount.rows[0].count)).toBe(1);

        // Verify exactly 1 stock movement exists
        const movCount = await pgClient.query(
          `SELECT count(*) FROM public.stock_movements WHERE organization_id = $1 AND reference_id = $2;`,
          [orgId, `return:${res1.data.return_id}`]
        );
        expect(Number(movCount.rows[0].count)).toBe(1);
      });

      it("concurrent return requests competing for remaining quantity: one succeeds, one rejected with P0052", async () => {
        // Sale with exactly 1 unit of Item 2
        const sale = await createTestSale({ item1Qty: 1, item2Qty: 1 });

        const req1 = managerClient.rpc("execute_sale_return", {
          p_org_id: orgId,
          p_sale_id: sale.saleId,
          p_return_items: [
            { sale_item_id: sale.item2.id, quantity: 1, restock_to_inventory: true },
          ],
          p_refund_method: "cash",
          p_reason: "Competing return thread 1",
          p_idempotency_key: randomUUID(),
        });

        const req2 = managerClient.rpc("execute_sale_return", {
          p_org_id: orgId,
          p_sale_id: sale.saleId,
          p_return_items: [
            { sale_item_id: sale.item2.id, quantity: 1, restock_to_inventory: true },
          ],
          p_refund_method: "cash",
          p_reason: "Competing return thread 2",
          p_idempotency_key: randomUUID(),
        });

        const [r1, r2] = await Promise.all([req1, req2]);

        const successes = [r1, r2].filter((r) => r.error === null && r.data?.success === true);
        const failures = [r1, r2].filter((r) => r.error !== null);

        // Exactly one should succeed, exactly one should fail with P0052
        expect(successes.length).toBe(1);
        expect(failures.length).toBe(1);
        expect(failures[0]?.error?.code).toBe("P0052");
        expect(failures[0]?.error?.message).toContain("RETURN_QUANTITY_EXCEEDS_SOLD");

        // Verify return items table has only 1 returned quantity for item 2
        const sriQuery = await pgClient.query(
          `SELECT sum(quantity) as total_returned FROM public.sale_return_items 
           WHERE organization_id = $1 AND sale_item_id = $2;`,
          [orgId, sale.item2.id]
        );
        expect(Number(sriQuery.rows[0].total_returned)).toBe(1.0);
      });
    });

    // ------------------------------------------------------------------------
    // N. Atomic Transaction Rollback on Mid-Flight Failure (Gap D)
    // ------------------------------------------------------------------------
    describe("Atomic Transaction Rollback (Gap D)", () => {
      it("rolls back all changes when second return item causes a validation failure", async () => {
        const sale = await createTestSale();

        const inv1Before = await pgClient.query(
          `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
          [orgId, productId1]
        );
        const qty1Before = Number(inv1Before.rows[0].quantity);

        const idemKey = randomUUID();

        // Item 1 has quantity 1 (valid), but Item 2 has quantity 99 (invalid -> exceeds sold)
        const res = await managerClient.rpc("execute_sale_return", {
          p_org_id: orgId,
          p_sale_id: sale.saleId,
          p_return_items: [
            { sale_item_id: sale.item1.id, quantity: 1, restock_to_inventory: true },
            { sale_item_id: sale.item2.id, quantity: 99, restock_to_inventory: true },
          ],
          p_refund_method: "cash",
          p_reason: "Atomic rollback test",
          p_idempotency_key: idemKey,
        });

        expect(res.error).not.toBeNull();
        expect(res.error!.code).toBe("P0052");

        // 1. Verify 0 sale_returns created
        const retQuery = await pgClient.query(
          `SELECT count(*) FROM public.sale_returns WHERE idempotency_key = $1;`,
          [idemKey]
        );
        expect(Number(retQuery.rows[0].count)).toBe(0);

        // 2. Verify 0 refunds created
        const refQuery = await pgClient.query(
          `SELECT count(*) FROM public.refunds WHERE organization_id = $1 AND reason LIKE '%Atomic rollback test%';`,
          [orgId]
        );
        expect(Number(refQuery.rows[0].count)).toBe(0);

        // 3. Verify 0 stock movements created
        const movQuery = await pgClient.query(
          `SELECT count(*) FROM public.stock_movements WHERE organization_id = $1 AND reason LIKE '%Atomic rollback test%';`,
          [orgId]
        );
        expect(Number(movQuery.rows[0].count)).toBe(0);

        // 4. Verify inventory for item 1 is completely untouched
        const inv1After = await pgClient.query(
          `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
          [orgId, productId1]
        );
        expect(Number(inv1After.rows[0].quantity)).toBe(qty1Before);
      });
    });
  }
);
