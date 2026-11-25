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

describeIntegration("T085: execute_sale_return RPC Integration Tests", () => {
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

  let productIdActive: string;
  let productIdInactive: string;
  let customerId: string;

  const timestamp = Date.now();
  const testPassword = "Password123!SecureTest";

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const ownerEmail = `ret-own-${timestamp}@example.com`;
    const mgrEmail = `ret-mgr-${timestamp}@example.com`;
    const cashEmail = `ret-cash-${timestamp}@example.com`;
    const orgBEmail = `ret-orgb-${timestamp}@example.com`;

    const uOwner = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Return", last_name: "Owner" },
    });
    ownerUserId = uOwner.data.user!.id;

    const uMgr = await adminClient.auth.admin.createUser({
      email: mgrEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Return", last_name: "Manager" },
    });
    managerUserId = uMgr.data.user!.id;

    const uCash = await adminClient.auth.admin.createUser({
      email: cashEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Return", last_name: "Cashier" },
    });
    cashierUserId = uCash.data.user!.id;

    const uOrgB = await adminClient.auth.admin.createUser({
      email: orgBEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Return", last_name: "OrgB" },
    });
    orgBUserId = uOrgB.data.user!.id;

    // Profiles
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

    // Orgs
    const resOrg = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, business_type, country, currency, timezone, created_by)
       VALUES ('Return Test Org', $1, 'retail', 'US', 'USD', 'America/New_York', $2)
       RETURNING id;`,
      [`ret-org-${timestamp}`, ownerUserId]
    );
    orgId = resOrg.rows[0].id;

    const resOrgB = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, business_type, country, currency, timezone, created_by)
       VALUES ('Return Org B', $1, 'retail', 'US', 'USD', 'America/New_York', $2)
       RETURNING id;`,
      [`ret-orgb-${timestamp}`, orgBUserId]
    );
    orgBId = resOrgB.rows[0].id;

    // Memberships
    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES
         ($1, $2, 'owner', 'active'),
         ($1, $3, 'manager', 'active'),
         ($1, $4, 'cashier', 'active'),
         ($5, $6, 'owner', 'active');`,
      [orgId, ownerUserId, managerUserId, cashierUserId, orgBId, orgBUserId]
    );

    // Initial tax settings
    await pgClient.query(
      `INSERT INTO public.organization_tax_settings (organization_id, tax_name, default_tax_rate, is_tax_inclusive, updated_by)
       VALUES ($1, 'Standard Tax', 0.0000, false, $2)
       ON CONFLICT (organization_id) DO NOTHING;`,
      [orgId, ownerUserId]
    );

    // Customer
    const resCust = await pgClient.query(
      `INSERT INTO public.customers (organization_id, name, phone, email)
       VALUES ($1, 'Return Customer', $2, $3)
       RETURNING id;`,
      [orgId, `+1312${Math.floor(1000000 + Math.random() * 9000000)}`, `ret-cust-${timestamp}@example.com`]
    );
    customerId = resCust.rows[0].id;

    // Active Product
    const resProdA = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
       VALUES ($1, 'Active Return Item', $2, 20.0000, 'piece', 'active', $3, $3)
       RETURNING id;`,
      [orgId, `SKU-RET-A-${timestamp}`, ownerUserId]
    );
    productIdActive = resProdA.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.product_costs (organization_id, product_id, cost_price)
       VALUES ($1, $2, 10.0000);`,
      [orgId, productIdActive]
    );

    // Inactive Product
    const resProdI = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
       VALUES ($1, 'Inactive Return Item', $2, 15.0000, 'piece', 'inactive', $3, $3)
       RETURNING id;`,
      [orgId, `SKU-RET-I-${timestamp}`, ownerUserId]
    );
    productIdInactive = resProdI.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.product_costs (organization_id, product_id, cost_price)
       VALUES ($1, $2, 5.0000);`,
      [orgId, productIdInactive]
    );

    await pgClient.query(
      `UPDATE public.inventory
       SET quantity = 200.0000, version = 1
       WHERE organization_id = $1 AND product_id IN ($2, $3);`,
      [orgId, productIdActive, productIdInactive]
    );

    // Auth clients
    ownerClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
    await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

    managerClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
    await managerClient.auth.signInWithPassword({ email: mgrEmail, password: testPassword });

    cashierClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
    await cashierClient.auth.signInWithPassword({ email: cashEmail, password: testPassword });

    orgBClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
    await orgBClient.auth.signInWithPassword({ email: orgBEmail, password: testPassword });
  });

  afterAll(async () => {
    try {
      if (pgClient && orgId) {
        await pgClient.query("DELETE FROM public.sale_return_items WHERE organization_id IN ($1, $2);", [orgId, orgBId]);
        await pgClient.query("DELETE FROM public.sale_returns WHERE organization_id IN ($1, $2);", [orgId, orgBId]);
        await pgClient.query("DELETE FROM public.refunds WHERE organization_id IN ($1, $2);", [orgId, orgBId]);
        await pgClient.query("DELETE FROM public.payments WHERE organization_id IN ($1, $2);", [orgId, orgBId]);
        await pgClient.query("DELETE FROM public.sale_items WHERE organization_id IN ($1, $2);", [orgId, orgBId]);
        await pgClient.query("DELETE FROM public.sales WHERE organization_id IN ($1, $2);", [orgId, orgBId]);
        await pgClient.query("DELETE FROM public.stock_movements WHERE organization_id IN ($1, $2);", [orgId, orgBId]);
        await pgClient.query("DELETE FROM public.inventory WHERE organization_id IN ($1, $2);", [orgId, orgBId]);
        await pgClient.query("DELETE FROM public.product_costs WHERE organization_id IN ($1, $2);", [orgId, orgBId]);
        await pgClient.query("DELETE FROM public.products WHERE organization_id IN ($1, $2);", [orgId, orgBId]);
        await pgClient.query("DELETE FROM public.customers WHERE organization_id IN ($1, $2);", [orgId, orgBId]);
        await pgClient.query("DELETE FROM public.organization_tax_settings WHERE organization_id IN ($1, $2);", [orgId, orgBId]);
        try {
          await pgClient.query("ALTER TABLE public.organization_memberships DISABLE TRIGGER USER;");
          await pgClient.query("DELETE FROM public.organizations WHERE id IN ($1, $2);", [orgId, orgBId]);
        } finally {
          await pgClient.query("ALTER TABLE public.organization_memberships ENABLE TRIGGER USER;");
        }
      }
    } catch {
      // Ignore cleanup error
    }

    if (adminClient) {
      if (ownerUserId) await adminClient.auth.admin.deleteUser(ownerUserId).catch(() => {});
      if (managerUserId) await adminClient.auth.admin.deleteUser(managerUserId).catch(() => {});
      if (cashierUserId) await adminClient.auth.admin.deleteUser(cashierUserId).catch(() => {});
      if (orgBUserId) await adminClient.auth.admin.deleteUser(orgBUserId).catch(() => {});
    }

    if (pgClient) {
      await pgClient.end().catch(() => {});
    }
  });

  async function createSale(splitCardCash = false) {
    const saleKey = randomUUID();
    const payments = splitCardCash
      ? [
          { payment_method: "cash", amount: "40.0000", amount_tendered: "40.0000", change_due: "0.0000" },
          { payment_method: "card", amount: "20.0000", reference_no: "AUTH-CARD-SPLIT" },
        ]
      : [{ payment_method: "cash", amount: "60.0000", amount_tendered: "60.0000", change_due: "0.0000" }];

    const res = await cashierClient.rpc("execute_sale", {
      p_org_id: orgId,
      p_customer_id: customerId,
      p_items: [
        { product_id: productIdActive, quantity: "3.0000", line_discount_amount: "0.0000" }, // $20 * 3 = $60
      ],
      p_payments: payments,
      p_order_discount_amount: 0,
      p_idempotency_key: saleKey,
    });

    expect(res.error).toBeNull();
    const itemRow = await pgClient.query("SELECT id FROM public.sale_items WHERE sale_id = $1 LIMIT 1;", [res.data.sale_id]);

    return {
      saleId: res.data.sale_id,
      saleItemId: itemRow.rows[0].id,
    };
  }

  describe("execute_sale_return core scenarios", () => {
    it("processes partial return with restock, restores inventory, and creates stock movement", async () => {
      const { saleId, saleItemId } = await createSale();
      const stockBefore = await pgClient.query(
        "SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;",
        [orgId, productIdActive]
      );
      const initialQty = parseFloat(stockBefore.rows[0].quantity);

      const returnKey = randomUUID();
      const { data, error } = await managerClient.rpc("execute_sale_return", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_return_items: [{ sale_item_id: saleItemId, quantity: "1.0000", restock_to_inventory: true }],
        p_refund_method: "cash",
        p_reason: "Partial return 1 of 3",
        p_idempotency_key: returnKey,
      });

      expect(error).toBeNull();
      expect(data.success).toBe(true);
      expect(Number(data.total_refund_amount)).toBe(20.0);
      expect(data.payment_status).toBe("partially_refunded");

      const stockAfter = await pgClient.query(
        "SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;",
        [orgId, productIdActive]
      );
      expect(parseFloat(stockAfter.rows[0].quantity)).toBe(initialQty + 1);

      const mov = await pgClient.query(
        "SELECT * FROM public.stock_movements WHERE organization_id = $1 AND product_id = $2 AND movement_type = 'return';",
        [orgId, productIdActive]
      );
      expect(mov.rows.length).toBeGreaterThan(0);
    });

    it("processes partial return without restock, leaves inventory untouched", async () => {
      const { saleId, saleItemId } = await createSale();
      const stockBefore = await pgClient.query(
        "SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;",
        [orgId, productIdActive]
      );
      const initialQty = parseFloat(stockBefore.rows[0].quantity);

      const returnKey = randomUUID();
      const { data, error } = await managerClient.rpc("execute_sale_return", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_return_items: [{ sale_item_id: saleItemId, quantity: "1.0000", restock_to_inventory: false }],
        p_refund_method: "cash",
        p_reason: "Damaged item not restocked",
        p_idempotency_key: returnKey,
      });

      expect(error).toBeNull();
      expect(data.success).toBe(true);

      const stockAfter = await pgClient.query(
        "SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;",
        [orgId, productIdActive]
      );
      expect(parseFloat(stockAfter.rows[0].quantity)).toBe(initialQty);
    });

    it("rejects return quantity exceeding sold quantity with P0052", async () => {
      const { saleId, saleItemId } = await createSale();
      const { data, error } = await managerClient.rpc("execute_sale_return", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_return_items: [{ sale_item_id: saleItemId, quantity: "5.0000", restock_to_inventory: true }],
        p_refund_method: "cash",
        p_reason: "Excess return attempt",
        p_idempotency_key: randomUUID(),
      });

      expect(data).toBeNull();
      expect(error?.code).toBe("P0052");
    });

    it("rejects duplicate sale items in return payload with P0060", async () => {
      const { saleId, saleItemId } = await createSale();
      const { data, error } = await managerClient.rpc("execute_sale_return", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_return_items: [
          { sale_item_id: saleItemId, quantity: "1.0000", restock_to_inventory: true },
          { sale_item_id: saleItemId, quantity: "1.0000", restock_to_inventory: true },
        ],
        p_refund_method: "cash",
        p_reason: "Duplicate items payload",
        p_idempotency_key: randomUUID(),
      });

      expect(data).toBeNull();
      expect(error?.code).toBe("P0060");
    });

    it("blocks restock of inactive product with P0056", async () => {
      const { saleId, saleItemId } = await createSale();

      // Deactivate product after sale
      await pgClient.query("UPDATE public.products SET status = 'inactive' WHERE id = $1;", [productIdActive]);

      try {
        const { data, error } = await managerClient.rpc("execute_sale_return", {
          p_org_id: orgId,
          p_sale_id: saleId,
          p_return_items: [{ sale_item_id: saleItemId, quantity: "1.0000", restock_to_inventory: true }],
          p_refund_method: "cash",
          p_reason: "Restock inactive product",
          p_idempotency_key: randomUUID(),
        });

        expect(data).toBeNull();
        expect(error?.code).toBe("P0056"); // Restock blocked!

        // Return without restock succeeds!
        const okRes = await managerClient.rpc("execute_sale_return", {
          p_org_id: orgId,
          p_sale_id: saleId,
          p_return_items: [{ sale_item_id: saleItemId, quantity: "1.0000", restock_to_inventory: false }],
          p_refund_method: "cash",
          p_reason: "Return inactive product without restock",
          p_idempotency_key: randomUUID(),
        });
        expect(okRes.data.success).toBe(true);
      } finally {
        await pgClient.query("UPDATE public.products SET status = 'active' WHERE id = $1;", [productIdActive]);
      }
    });

    it("rejects non-cash refund exceeding original tender for that method with P0061", async () => {
      const { saleId, saleItemId } = await createSale(true);

      const { data, error } = await managerClient.rpc("execute_sale_return", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_return_items: [{ sale_item_id: saleItemId, quantity: "2.0000", restock_to_inventory: true }],
        p_refund_method: "card",
        p_reason: "Exceeds card tender ceiling",
        p_idempotency_key: randomUUID(),
      });

      expect(data).toBeNull();
      expect(error?.code).toBe("P0061");
    });

    it("enforces cumulative refund cap check against database ceiling", async () => {
      const { saleId, saleItemId } = await createSale();

      await managerClient.rpc("execute_sale_return", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_return_items: [{ sale_item_id: saleItemId, quantity: "3.0000", restock_to_inventory: true }],
        p_refund_method: "cash",
        p_reason: "Full return",
        p_idempotency_key: randomUUID(),
      });

      const { data, error } = await managerClient.rpc("execute_sale_return", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_return_items: [{ sale_item_id: saleItemId, quantity: "1.0000", restock_to_inventory: true }],
        p_refund_method: "cash",
        p_reason: "Over return",
        p_idempotency_key: randomUUID(),
      });

      expect(data).toBeNull();
      expect(error?.code).toMatch(/P0049|P0052|P0054/);
    });
  });
});
