import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { calculatePosTotals } from "@/lib/sales/financial-calc";

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
  "Feature 005 — Database-Backed Atomic execute_sale Verification (T048–T057, US1, US3)",
  () => {
    let pgClient: PgClient;
    let adminClient: SupabaseClient;
    let cashierClient: SupabaseClient;
    let orgBClient: SupabaseClient;
    let suspendedClient: SupabaseClient;

    let orgId: string;
    let orgBId: string;
    let cashierUserId: string;
    let orgBUserId: string;
    let suspendedUserId: string;
    let customerId: string;
    let product1Id: string;
    let product2Id: string;

    // Entity IDs captured from completed sales for DML and Isolation checks
    let completedSale1Id: string;
    let completedSale1ItemId: string;
    let completedSale1PaymentId: string;
    let completedSplitSaleId: string;

    const timestamp = Date.now();
    const testPassword = "Password123!SecureTest";

    beforeAll(async () => {
      pgClient = new PgClient({ connectionString: dbUrl });
      await pgClient.connect();

      adminClient = createClient(supabaseUrl, serviceRoleKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      // 1. Create cashier user in auth.users
      const cashEmail = `pos-cashier-${timestamp}@example.com`;
      const uCash = await adminClient.auth.admin.createUser({
        email: cashEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "POS", last_name: "Cashier" },
      });
      cashierUserId = uCash.data.user!.id;

      // 2. Create Org B cashier
      const orgBEmail = `pos-orgb-${timestamp}@example.com`;
      const uOrgB = await adminClient.auth.admin.createUser({
        email: orgBEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "OrgB", last_name: "Cashier" },
      });
      orgBUserId = uOrgB.data.user!.id;

      // 3. Create Suspended cashier in Org A
      const suspEmail = `pos-susp-${timestamp}@example.com`;
      const uSusp = await adminClient.auth.admin.createUser({
        email: suspEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "Suspended", last_name: "Cashier" },
      });
      suspendedUserId = uSusp.data.user!.id;

      // 4. Insert profiles
      await pgClient.query(
        `INSERT INTO public.profiles (id, first_name, last_name)
         VALUES 
           ($1, 'POS', 'Cashier'),
           ($2, 'OrgB', 'Cashier'),
           ($3, 'Suspended', 'Cashier')
         ON CONFLICT (id) DO NOTHING;`,
        [cashierUserId, orgBUserId, suspendedUserId]
      );

      // 5. Insert organizations (Org A and Org B)
      const orgRes = await pgClient.query(
        `INSERT INTO public.organizations (name, slug, currency, business_type, country, created_by)
         VALUES ('POS Test Org', $1, 'USD', 'retail', 'US', $2)
         RETURNING id;`,
        [`pos-org-${timestamp}`, cashierUserId]
      );
      orgId = orgRes.rows[0].id;

      const orgBRes = await pgClient.query(
        `INSERT INTO public.organizations (name, slug, currency, business_type, country, created_by)
         VALUES ('POS Org B', $1, 'USD', 'retail', 'US', $2)
         RETURNING id;`,
        [`pos-orgb-${timestamp}`, orgBUserId]
      );
      orgBId = orgBRes.rows[0].id;

      // 6. Insert memberships
      await pgClient.query(
        `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
         VALUES 
           ($1, $2, 'cashier', 'active'),
           ($3, $4, 'cashier', 'active'),
           ($1, $5, 'cashier', 'suspended');`,
        [orgId, cashierUserId, orgBId, orgBUserId, suspendedUserId]
      );

      // 7. Insert tax settings (10% exclusive tax)
      await pgClient.query(
        `INSERT INTO public.organization_tax_settings (organization_id, tax_name, default_tax_rate, is_tax_inclusive, updated_by)
         VALUES ($1, 'Standard VAT', 10.0000, false, $2)
         ON CONFLICT (organization_id) DO UPDATE
         SET tax_name = 'Standard VAT', default_tax_rate = 10.0000, is_tax_inclusive = false;`,
        [orgId, cashierUserId]
      );

      // 8. Insert an active customer
      const custRes = await pgClient.query(
        `INSERT INTO public.customers (organization_id, name, phone, email)
         VALUES ($1, 'Test VIP Customer', $2, $3)
         RETURNING id;`,
        [orgId, `+1555${Math.floor(1000000 + Math.random() * 9000000)}`, `vip-${timestamp}@example.com`]
      );
      customerId = custRes.rows[0].id;

      // 9. Insert Product 1: Selling Price $15.00, Cost $10.00, Stock 10
      const p1Res = await pgClient.query(
        `INSERT INTO public.products (
           organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by
         ) VALUES (
           $1, 'Wireless Keyboard', $2, 15.0000, 'piece', 'active', $3, $3
         ) RETURNING id;`,
        [orgId, `SKU-KB-${timestamp}`, cashierUserId]
      );
      product1Id = p1Res.rows[0].id;

      await pgClient.query(
        `INSERT INTO public.product_costs (organization_id, product_id, cost_price)
         VALUES ($1, $2, 10.0000);`,
        [orgId, product1Id]
      );

      // Set initial stock = 10 for Product 1
      await pgClient.query(
        `UPDATE public.inventory
         SET quantity = 10.0000, version = 1
         WHERE organization_id = $1 AND product_id = $2;`,
        [orgId, product1Id]
      );

      // 10. Insert Product 2: Selling Price $25.00, Cost $18.00, Stock 5
      const p2Res = await pgClient.query(
        `INSERT INTO public.products (
           organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by
         ) VALUES (
           $1, 'Optical Mouse', $2, 25.0000, 'piece', 'active', $3, $3
         ) RETURNING id;`,
        [orgId, `SKU-MS-${timestamp}`, cashierUserId]
      );
      product2Id = p2Res.rows[0].id;

      await pgClient.query(
        `INSERT INTO public.product_costs (organization_id, product_id, cost_price)
         VALUES ($1, $2, 18.0000);`,
        [orgId, product2Id]
      );

      // Set initial stock = 5 for Product 2
      await pgClient.query(
        `UPDATE public.inventory
         SET quantity = 5.0000, version = 1
         WHERE organization_id = $1 AND product_id = $2;`,
        [orgId, product2Id]
      );

      // Authenticate clients
      cashierClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
      const { error: e1 } = await cashierClient.auth.signInWithPassword({ email: cashEmail, password: testPassword });
      if (e1) throw e1;

      orgBClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
      const { error: e2 } = await orgBClient.auth.signInWithPassword({ email: orgBEmail, password: testPassword });
      if (e2) throw e2;

      suspendedClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
      const { error: e3 } = await suspendedClient.auth.signInWithPassword({ email: suspEmail, password: testPassword });
      if (e3) throw e3;
    });

    afterAll(async () => {
      if (orgId && pgClient) {
        await pgClient.query(`DELETE FROM public.payments WHERE organization_id = $1;`, [orgId]);
        await pgClient.query(`DELETE FROM public.sale_items WHERE organization_id = $1;`, [orgId]);
        await pgClient.query(`DELETE FROM public.sales WHERE organization_id = $1;`, [orgId]);
        await pgClient.query(`DELETE FROM public.stock_movements WHERE organization_id = $1;`, [orgId]);
        await pgClient.query(`DELETE FROM public.inventory WHERE organization_id = $1;`, [orgId]);
        await pgClient.query(`DELETE FROM public.product_costs WHERE organization_id = $1;`, [orgId]);
        await pgClient.query(`DELETE FROM public.products WHERE organization_id = $1;`, [orgId]);
        await pgClient.query(`DELETE FROM public.customers WHERE organization_id = $1;`, [orgId]);
        await pgClient.query(`DELETE FROM public.organization_tax_settings WHERE organization_id = $1;`, [orgId]);
        await pgClient.query(`DELETE FROM public.organization_memberships WHERE organization_id = $1;`, [orgId]);
        await pgClient.query(`DELETE FROM public.organizations WHERE id = $1;`, [orgId]);
      }
      if (orgBId && pgClient) {
        await pgClient.query(`DELETE FROM public.organization_memberships WHERE organization_id = $1;`, [orgBId]);
        await pgClient.query(`DELETE FROM public.organizations WHERE id = $1;`, [orgBId]);
      }
      if (cashierUserId && adminClient) {
        await adminClient.auth.admin.deleteUser(cashierUserId);
      }
      if (orgBUserId && adminClient) {
        await adminClient.auth.admin.deleteUser(orgBUserId);
      }
      if (suspendedUserId && adminClient) {
        await adminClient.auth.admin.deleteUser(suspendedUserId);
      }
      if (pgClient) {
        await pgClient.end();
      }
    });

    // 1. Successful Multi-Item Checkout
    it("1. executes successful multi-item atomic checkout with tax, discounts, and cash change", async () => {
      const idempotencyKey = "11111111-1111-4000-a000-000000000001";
      const totals = calculatePosTotals({
        items: [
          { productId: product1Id, unitPrice: 15.0, quantity: 2, lineDiscountAmount: 1.0 },
          { productId: product2Id, unitPrice: 25.0, quantity: 1, lineDiscountAmount: 0.0 },
        ],
        orderDiscountAmount: 4.0,
        taxRate: 10.0,
        isTaxInclusive: false,
        currency: "USD",
      });

      expect(totals.totalPayable).toBe(55.01);

      const payload = {
        p_org_id: orgId,
        p_customer_id: customerId,
        p_items: [
          {
            product_id: product1Id,
            quantity: "2.0000",
            line_discount_amount: "1.0000",
          },
          {
            product_id: product2Id,
            quantity: "1.0000",
            line_discount_amount: "0.0000",
          },
        ],
        p_payments: [
          {
            payment_method: "cash",
            amount: "55.0100",
            amount_tendered: "60.0000",
            change_due: "4.9900",
            reference_no: null,
          },
        ],
        p_order_discount_amount: 4.0,
        p_idempotency_key: idempotencyKey,
        p_notes: "First live checkout",
      };

      const { data, error } = await cashierClient.rpc("execute_sale", payload);

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.success).toBe(true);
      expect(data.is_replay).toBe(false);
      expect(data.sale_number).toMatch(/^SAL-\d{8}-\d{4}$/);
      expect(Number(data.total_amount)).toBe(55.01);
      expect(data.items_count).toBe(2);

      completedSale1Id = data.sale_id;

      // Verify stock was deducted via public._execute_inventory_mutation_core
      const invP1 = await pgClient.query(
        `SELECT quantity, version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
        [orgId, product1Id]
      );
      expect(Number(invP1.rows[0].quantity)).toBe(8.0); // 10 - 2 = 8

      const invP2 = await pgClient.query(
        `SELECT quantity, version FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
        [orgId, product2Id]
      );
      expect(Number(invP2.rows[0].quantity)).toBe(4.0); // 5 - 1 = 4

      // Verify sale items and snapshotted costs
      const saleItemsRes = await pgClient.query(
        `SELECT id, product_id, quantity, unit_price, unit_cost, total_price, movement_id
         FROM public.sale_items
         WHERE sale_id = $1
         ORDER BY product_id ASC;`,
        [data.sale_id]
      );
      expect(saleItemsRes.rows).toHaveLength(2);
      const p1Item = saleItemsRes.rows.find((r) => r.product_id === product1Id);
      const p2Item = saleItemsRes.rows.find((r) => r.product_id === product2Id);
      completedSale1ItemId = p1Item.id;
      expect(Number(p1Item.unit_cost)).toBe(10.0);
      expect(Number(p2Item.unit_cost)).toBe(18.0);
      expect(p1Item.movement_id).toBeDefined();
      expect(p2Item.movement_id).toBeDefined();

      // Capture payment id
      const payRes = await pgClient.query(
        `SELECT id FROM public.payments WHERE sale_id = $1 LIMIT 1;`,
        [data.sale_id]
      );
      completedSale1PaymentId = payRes.rows[0].id;

      // Verify immutable stock_movements ledger records
      const movementsRes = await pgClient.query(
        `SELECT id, product_id, movement_type, quantity_before, quantity_delta, quantity_after, reference_id
         FROM public.stock_movements
         WHERE organization_id = $1 AND reference_id = $2
         ORDER BY created_at ASC;`,
        [orgId, `sale:${data.sale_id}`]
      );
      expect(movementsRes.rows).toHaveLength(2);
      const m1 = movementsRes.rows.find((m) => m.product_id === product1Id);
      const m2 = movementsRes.rows.find((m) => m.product_id === product2Id);
      expect(m1).toBeDefined();
      expect(m2).toBeDefined();
      expect(m1.movement_type).toBe("sale");
      expect(m2.movement_type).toBe("sale");
      expect(Number(m1.quantity_delta)).toBe(-2.0);
      expect(Number(m2.quantity_delta)).toBe(-1.0);
    });

    // 2. Insufficient Stock Transaction Rollback
    it("2. rolls back complete transaction when any single item has insufficient stock (P0011)", async () => {
      const idempotencyKey = "22222222-2222-4000-a000-000000000002";
      const payload = {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [
          {
            product_id: product1Id,
            quantity: "2.0000",
            line_discount_amount: "0.0000",
          },
          {
            product_id: product2Id,
            quantity: "10.0000", // Insufficient stock!
            line_discount_amount: "0.0000",
          },
        ],
        p_payments: [
          {
            payment_method: "cash",
            amount: "308.0000",
            amount_tendered: "310.0000",
            change_due: "2.0000",
            reference_no: null,
          },
        ],
        p_order_discount_amount: 0,
        p_idempotency_key: idempotencyKey,
      };

      const { data, error } = await cashierClient.rpc("execute_sale", payload);

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.code).toBe("P0011");
      expect(error?.message).toContain("INSUFFICIENT_STOCK");

      // Verify that Product 1 stock was NOT decremented (rollback guaranteed)
      const invP1 = await pgClient.query(
        `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
        [orgId, product1Id]
      );
      expect(Number(invP1.rows[0].quantity)).toBe(8.0);

      const invP2 = await pgClient.query(
        `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
        [orgId, product2Id]
      );
      expect(Number(invP2.rows[0].quantity)).toBe(4.0);

      // Verify no sale record was created
      const saleCheck = await pgClient.query(
        `SELECT id FROM public.sales WHERE idempotency_key = $1;`,
        [idempotencyKey]
      );
      expect(saleCheck.rows).toHaveLength(0);
    });

    // 3. Idempotent Replay (Same Key, Same Payload)
    it("3. returns original sale record with is_replay: true for identical idempotency replay", async () => {
      const idempotencyKey = "11111111-1111-4000-a000-000000000001";
      const payload = {
        p_org_id: orgId,
        p_customer_id: customerId,
        p_items: [
          {
            product_id: product1Id,
            quantity: "2.0000",
            line_discount_amount: "1.0000",
          },
          {
            product_id: product2Id,
            quantity: "1.0000",
            line_discount_amount: "0.0000",
          },
        ],
        p_payments: [
          {
            payment_method: "cash",
            amount: "55.0100",
            amount_tendered: "60.0000",
            change_due: "4.9900",
            reference_no: null,
          },
        ],
        p_order_discount_amount: 4.0,
        p_idempotency_key: idempotencyKey,
      };

      const { data, error } = await cashierClient.rpc("execute_sale", payload);

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.success).toBe(true);
      expect(data.is_replay).toBe(true);
      expect(Number(data.total_amount)).toBe(55.01);

      // Verify stock was not deducted again
      const invP1 = await pgClient.query(
        `SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;`,
        [orgId, product1Id]
      );
      expect(Number(invP1.rows[0].quantity)).toBe(8.0);
    });

    // 4. Idempotency Conflict (Same Key, Differing Payload -> P0024)
    it("4. rejects modified payload using existing idempotency key with P0024 (IDEMPOTENCY_CONFLICT)", async () => {
      const idempotencyKey = "11111111-1111-4000-a000-000000000001";
      const conflictingPayload = {
        p_org_id: orgId,
        p_customer_id: customerId,
        p_items: [
          {
            product_id: product1Id,
            quantity: "1.0000", // Modified quantity
            line_discount_amount: "0.0000",
          },
        ],
        p_payments: [
          {
            payment_method: "cash",
            amount: "16.5000",
            amount_tendered: "20.0000",
            change_due: "3.5000",
            reference_no: null,
          },
        ],
        p_order_discount_amount: 0,
        p_idempotency_key: idempotencyKey,
      };

      const { data, error } = await cashierClient.rpc("execute_sale", conflictingPayload);

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.code).toBe("P0024");
      expect(error?.message).toContain("IDEMPOTENCY_CONFLICT");
    });

    // 5. Exact Tender Validation
    it("5. validates exact payment tenders (P0045 on underpayment, P0046 on non-cash overpayment)", async () => {
      const underpaidPayload = {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [
          {
            product_id: product1Id,
            quantity: "1.0000",
            line_discount_amount: "0.0000",
          },
        ],
        p_payments: [
          {
            payment_method: "cash",
            amount: "15.0000",
            amount_tendered: "15.0000",
            change_due: "0.0000",
            reference_no: null,
          },
        ],
        p_order_discount_amount: 0,
        p_idempotency_key: "55555555-5555-4000-a000-000000000005",
      };

      const { data: d1, error: e1 } = await cashierClient.rpc("execute_sale", underpaidPayload);
      expect(d1).toBeNull();
      expect(e1?.code).toBe("P0045");
      expect(e1?.message).toContain("PAYMENT_INCOMPLETE");

      const overpaidCardPayload = {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [
          {
            product_id: product1Id,
            quantity: "1.0000",
            line_discount_amount: "0.0000",
          },
        ],
        p_payments: [
          {
            payment_method: "card",
            amount: "16.5000",
            amount_tendered: "20.0000",
            change_due: "3.5000",
            reference_no: "AUTH-CARD-99",
          },
        ],
        p_order_discount_amount: 0,
        p_idempotency_key: "66666666-6666-4000-a000-000000000006",
      };

      const { data: d2, error: e2 } = await cashierClient.rpc("execute_sale", overpaidCardPayload);
      expect(d2).toBeNull();
      expect(e2?.code).toBe("P0046");
      expect(e2?.message).toContain("PAYMENT_EXCEEDS_PAYABLE_AMOUNT");
    });

    // 6. Missing Non-Cash Reference Rejection
    it("6. rejects non-cash payment missing transaction reference with P0057", async () => {
      const missingRefPayload = {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [
          {
            product_id: product1Id,
            quantity: "1.0000",
            line_discount_amount: "0.0000",
          },
        ],
        p_payments: [
          {
            payment_method: "card",
            amount: "16.5000",
            amount_tendered: null,
            change_due: null,
            reference_no: "   ",
          },
        ],
        p_order_discount_amount: 0,
        p_idempotency_key: "77777777-7777-4000-a000-000000000007",
      };

      const { data, error } = await cashierClient.rpc("execute_sale", missingRefPayload);
      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.code).toBe("P0057");
      expect(error?.message).toContain("PAYMENT_REFERENCE_REQUIRED");
    });

    // 7. Split Payment across Cash & Card with Real Inventory Updates
    it("7. processes split payment across cash and card, verifying ledger entries and balance", async () => {
      const idempotencyKey = "88888888-8888-4000-a000-000000000008";
      const payload = {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [
          {
            product_id: product1Id,
            quantity: "1.0000",
            line_discount_amount: "0.0000",
          },
          {
            product_id: product2Id,
            quantity: "1.0000",
            line_discount_amount: "0.0000",
          },
        ],
        p_payments: [
          {
            payment_method: "cash",
            amount: "20.0000",
            amount_tendered: "20.0000",
            change_due: "0.0000",
            reference_no: null,
          },
          {
            payment_method: "card",
            amount: "24.0000",
            amount_tendered: null,
            change_due: null,
            reference_no: "POS-SPLIT-CARD-1",
          },
        ],
        p_order_discount_amount: 0,
        p_idempotency_key: idempotencyKey,
      };

      const { data, error } = await cashierClient.rpc("execute_sale", payload);

      expect(error).toBeNull();
      expect(data.success).toBe(true);
      expect(Number(data.total_amount)).toBe(44.0);
      completedSplitSaleId = data.sale_id;

      const paymentsRes = await pgClient.query(
        `SELECT payment_method, amount, amount_tendered, change_due, reference_no
         FROM public.payments
         WHERE sale_id = $1
         ORDER BY payment_method ASC;`,
        [data.sale_id]
      );
      expect(paymentsRes.rows).toHaveLength(2);
      expect(paymentsRes.rows[0].payment_method).toBe("card");
      expect(Number(paymentsRes.rows[0].amount)).toBe(24.0);
      expect(paymentsRes.rows[0].reference_no).toBe("POS-SPLIT-CARD-1");

      expect(paymentsRes.rows[1].payment_method).toBe("cash");
      expect(Number(paymentsRes.rows[1].amount)).toBe(20.0);
      expect(Number(paymentsRes.rows[1].amount_tendered)).toBe(20.0);
    });

    // 8. Cross-Tenant Rejection
    it("8. rejects checkout attempt by user from another organization with P0002 (MEMBERSHIP_INACTIVE)", async () => {
      const payload = {
        p_org_id: orgId, // Calling on Org A
        p_customer_id: null,
        p_items: [
          {
            product_id: product1Id,
            quantity: "1.0000",
            line_discount_amount: "0.0000",
          },
        ],
        p_payments: [
          {
            payment_method: "cash",
            amount: "16.5000",
            amount_tendered: "16.5000",
            change_due: "0.0000",
            reference_no: null,
          },
        ],
        p_order_discount_amount: 0,
        p_idempotency_key: "99999999-9999-4000-a000-000000000009",
      };

      const { data, error } = await orgBClient.rpc("execute_sale", payload);
      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.code).toBe("P0002");
      expect(error?.message).toContain("MEMBERSHIP_INACTIVE");
    });

    // 9. Inactive/Suspended Membership Rejection
    it("9. rejects checkout attempt when caller membership status is suspended with P0002", async () => {
      const payload = {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [
          {
            product_id: product1Id,
            quantity: "1.0000",
            line_discount_amount: "0.0000",
          },
        ],
        p_payments: [
          {
            payment_method: "cash",
            amount: "16.5000",
            amount_tendered: "16.5000",
            change_due: "0.0000",
            reference_no: null,
          },
        ],
        p_order_discount_amount: 0,
        p_idempotency_key: "aaaaaaaa-aaaa-4000-a000-00000000000a",
      };

      const { data, error } = await suspendedClient.rpc("execute_sale", payload);
      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.code).toBe("P0002");
      expect(error?.message).toContain("MEMBERSHIP_INACTIVE");
    });

    // 10. Gap 1 — Direct DML Protection (3x3 Matrix: sales, sale_items, payments x INSERT, UPDATE, DELETE)
    it("10. [Gap 1] strictly blocks direct INSERT, UPDATE, and DELETE on sales, sale_items, and payments tables", async () => {
      // --- Table 1: sales ---
      // 1.1 INSERT on sales
      const { error: sInsErr } = await cashierClient.from("sales").insert({
        organization_id: orgId,
        sale_number: "DIRECT-HACK-001",
        total_amount: 100,
        currency: "USD",
        subtotal: 100,
        idempotency_key: "bbbbbbbb-bbbb-4000-a000-00000000000b",
        idempotency_hash: "hash",
      });
      expect(sInsErr).not.toBeNull();

      // 1.2 UPDATE on sales
      const { error: sUpdErr, data: sUpdData } = await cashierClient
        .from("sales")
        .update({ notes: "TAMPERED_NOTE" })
        .eq("id", completedSale1Id)
        .select();
      expect(sUpdErr != null || (sUpdData && sUpdData.length === 0)).toBe(true);
      const sVer = await pgClient.query(`SELECT notes FROM public.sales WHERE id = $1;`, [completedSale1Id]);
      expect(sVer.rows[0].notes).toBe("First live checkout"); // Untouched!

      // 1.3 DELETE on sales
      const { error: sDelErr, data: sDelData } = await cashierClient
        .from("sales")
        .delete()
        .eq("id", completedSale1Id)
        .select();
      expect(sDelErr != null || (sDelData && sDelData.length === 0)).toBe(true);
      const sDelVer = await pgClient.query(`SELECT id FROM public.sales WHERE id = $1;`, [completedSale1Id]);
      expect(sDelVer.rows).toHaveLength(1); // Still exists!

      // --- Table 2: sale_items ---
      // 2.1 INSERT on sale_items
      const { error: siInsErr } = await cashierClient.from("sale_items").insert({
        organization_id: orgId,
        sale_id: completedSale1Id,
        product_id: product1Id,
        quantity: 1,
        unit_price: 15,
        total_price: 15,
      });
      expect(siInsErr).not.toBeNull();

      // 2.2 UPDATE on sale_items
      const { error: siUpdErr, data: siUpdData } = await cashierClient
        .from("sale_items")
        .update({ unit_price: 0.01 })
        .eq("id", completedSale1ItemId)
        .select();
      expect(siUpdErr != null || (siUpdData && siUpdData.length === 0)).toBe(true);
      const siVer = await pgClient.query(`SELECT unit_price FROM public.sale_items WHERE id = $1;`, [completedSale1ItemId]);
      expect(Number(siVer.rows[0].unit_price)).toBe(15.0); // Untouched (original price of Product 1 is 15.0, not tampered 0.01)!

      // 2.3 DELETE on sale_items
      const { error: siDelErr, data: siDelData } = await cashierClient
        .from("sale_items")
        .delete()
        .eq("id", completedSale1ItemId)
        .select();
      expect(siDelErr != null || (siDelData && siDelData.length === 0)).toBe(true);
      const siDelVer = await pgClient.query(`SELECT id FROM public.sale_items WHERE id = $1;`, [completedSale1ItemId]);
      expect(siDelVer.rows).toHaveLength(1); // Still exists!

      // --- Table 3: payments ---
      // 3.1 INSERT on payments
      const { error: pInsErr } = await cashierClient.from("payments").insert({
        organization_id: orgId,
        sale_id: completedSale1Id,
        payment_method: "cash",
        amount: 50,
      });
      expect(pInsErr).not.toBeNull();

      // 3.2 UPDATE on payments
      const { error: pUpdErr, data: pUpdData } = await cashierClient
        .from("payments")
        .update({ amount: 0.01 })
        .eq("id", completedSale1PaymentId)
        .select();
      expect(pUpdErr != null || (pUpdData && pUpdData.length === 0)).toBe(true);
      const pVer = await pgClient.query(`SELECT amount FROM public.payments WHERE id = $1;`, [completedSale1PaymentId]);
      expect(Number(pVer.rows[0].amount)).toBe(55.01); // Untouched!

      // 3.3 DELETE on payments
      const { error: pDelErr, data: pDelData } = await cashierClient
        .from("payments")
        .delete()
        .eq("id", completedSale1PaymentId)
        .select();
      expect(pDelErr != null || (pDelData && pDelData.length === 0)).toBe(true);
      const pDelVer = await pgClient.query(`SELECT id FROM public.payments WHERE id = $1;`, [completedSale1PaymentId]);
      expect(pDelVer.rows).toHaveLength(1); // Still exists!
    });

    // 11. Gap 2 — Cross-Tenant Payment, Sale, Sale-Item, and Receipt Isolation
    it("11. [Gap 2] strictly enforces cross-tenant payment, sale, sale-item, and receipt isolation across organizations", async () => {
      // Organization A has a completed split-tender sale: completedSplitSaleId (contains cash + card payments)

      // 1. Direct Payment Read by Org B User without organization filter
      const { data: pUnfiltered, error: pUnfilteredErr } = await orgBClient
        .from("payments")
        .select("*");
      expect(pUnfilteredErr).toBeNull();
      // All returned rows must NOT belong to Org A
      const orgAPayments = (pUnfiltered || []).filter((r: any) => r.organization_id === orgId);
      expect(orgAPayments).toHaveLength(0);

      // 2. Direct Payment Read by Org B User targeted on Org A's payment ID
      const { data: pTargeted, error: pTargetedErr } = await orgBClient
        .from("payments")
        .select("*")
        .eq("id", completedSale1PaymentId);
      expect(pTargetedErr).toBeNull();
      expect(pTargeted).toHaveLength(0); // RLS blocks row visibility!

      // 3. Direct Sales Read by Org B User without organization filter
      const { data: sUnfiltered, error: sUnfilteredErr } = await orgBClient
        .from("sales")
        .select("*");
      expect(sUnfilteredErr).toBeNull();
      const orgASales = (sUnfiltered || []).filter((r: any) => r.organization_id === orgId);
      expect(orgASales).toHaveLength(0);

      // 4. Direct Sales Read by Org B User targeted on Org A's split sale ID
      const { data: sTargeted, error: sTargetedErr } = await orgBClient
        .from("sales")
        .select("*")
        .eq("id", completedSplitSaleId);
      expect(sTargetedErr).toBeNull();
      expect(sTargeted).toHaveLength(0);

      // 5. Direct Sale Items Read by Org B User without organization filter
      // Safe columns are granted to authenticated (excluding unit_cost due to CLS)
      const { data: siUnfiltered, error: siUnfilteredErr } = await orgBClient
        .from("sale_items")
        .select("id, organization_id, sale_id, product_id, quantity, unit_price, total_price");
      expect(siUnfilteredErr).toBeNull();
      const orgASaleItems = (siUnfiltered || []).filter((r: any) => r.organization_id === orgId);
      expect(orgASaleItems).toHaveLength(0);

      // Also verify that attempting to select all columns (including unit_cost) is blocked by CLS
      const { error: siClsErr } = await orgBClient
        .from("sale_items")
        .select("*");
      expect(siClsErr).not.toBeNull();
      expect(siClsErr?.code).toBe("42501");

      // 6. Indirect Receipt / Sale Detail via get_sale_detail RPC
      // Case 6a: Org B user supplies Org B ID + Org A sale ID -> P0048 (SALE_NOT_FOUND)
      const { data: rpcBWithB, error: rpcBErr1 } = await orgBClient.rpc("get_sale_detail", {
        p_org_id: orgBId,
        p_sale_id: completedSplitSaleId,
      });
      expect(rpcBWithB).toBeNull();
      expect(rpcBErr1?.code).toBe("P0048");
      expect(rpcBErr1?.message).toContain("SALE_NOT_FOUND");

      // Case 6b: Org B user supplies Org A ID + Org A sale ID -> P0002 (MEMBERSHIP_INACTIVE)
      const { data: rpcBWithA, error: rpcBErr2 } = await orgBClient.rpc("get_sale_detail", {
        p_org_id: orgId,
        p_sale_id: completedSplitSaleId,
      });
      expect(rpcBWithA).toBeNull();
      expect(rpcBErr2?.code).toBe("P0002");
      expect(rpcBErr2?.message).toContain("MEMBERSHIP_INACTIVE");

      // 7. Legitimate Org A Cashier access verification
      // Cashier A can read split payments directly
      const { data: authPayments, error: authPayErr } = await cashierClient
        .from("payments")
        .select("id, payment_method, amount, reference_no")
        .eq("sale_id", completedSplitSaleId);
      expect(authPayErr).toBeNull();
      expect(authPayments).toHaveLength(2); // Card ($24) and Cash ($20)

      // Cashier A retrieves complete sale detail and receipt via RPC
      const { data: receiptData, error: receiptErr } = await cashierClient.rpc("get_sale_detail", {
        p_org_id: orgId,
        p_sale_id: completedSplitSaleId,
      });
      expect(receiptErr).toBeNull();
      expect(receiptData).toBeDefined();
      expect(receiptData.sale.id).toBe(completedSplitSaleId);
      expect(receiptData.payments).toHaveLength(2);
      expect(receiptData.items).toHaveLength(2);
    });
  }
);
