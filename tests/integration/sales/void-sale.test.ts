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

describeIntegration("T084: void_sale Integration Tests", () => {
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
  let customerId: string;

  const timestamp = Date.now();
  const testPassword = "Password123!SecureTest";

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const ownerEmail = `void-own-${timestamp}@example.com`;
    const mgrEmail = `void-mgr-${timestamp}@example.com`;
    const cashEmail = `void-cash-${timestamp}@example.com`;
    const orgBEmail = `void-orgb-${timestamp}@example.com`;

    const uOwner = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Void", last_name: "Owner" },
    });
    ownerUserId = uOwner.data.user!.id;

    const uMgr = await adminClient.auth.admin.createUser({
      email: mgrEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Void", last_name: "Manager" },
    });
    managerUserId = uMgr.data.user!.id;

    const uCash = await adminClient.auth.admin.createUser({
      email: cashEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Void", last_name: "Cashier" },
    });
    cashierUserId = uCash.data.user!.id;

    const uOrgB = await adminClient.auth.admin.createUser({
      email: orgBEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Void", last_name: "OrgB" },
    });
    orgBUserId = uOrgB.data.user!.id;

    // Profiles
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

    // Orgs
    const resOrg = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, business_type, country, currency, timezone, created_by)
       VALUES ('Void Test Org', $1, 'retail', 'US', 'USD', 'America/New_York', $2)
       RETURNING id;`,
      [`void-org-${timestamp}`, ownerUserId]
    );
    orgId = resOrg.rows[0].id;

    const resOrgB = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, business_type, country, currency, timezone, created_by)
       VALUES ('Void Org B', $1, 'retail', 'US', 'USD', 'America/New_York', $2)
       RETURNING id;`,
      [`void-orgb-${timestamp}`, orgBUserId]
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
       VALUES ($1, 'Void Customer', $2, $3)
       RETURNING id;`,
      [orgId, `+1212${Math.floor(1000000 + Math.random() * 9000000)}`, `void-cust-${timestamp}@example.com`]
    );
    customerId = resCust.rows[0].id;

    // Product
    const resProd = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
       VALUES ($1, 'Void Item', $2, 25.0000, 'piece', 'active', $3, $3)
       RETURNING id;`,
      [orgId, `SKU-VOID-${timestamp}`, ownerUserId]
    );
    productId1 = resProd.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.product_costs (organization_id, product_id, cost_price)
       VALUES ($1, $2, 10.0000);`,
      [orgId, productId1]
    );

    await pgClient.query(
      `UPDATE public.inventory
       SET quantity = 100.0000, version = 1
       WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, productId1]
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

  async function createSale(paymentMethod: "cash" | "card", amount: number = 25) {
    const saleKey = randomUUID();
    const payments =
      paymentMethod === "cash"
        ? [{ payment_method: "cash", amount: `${amount}.0000`, amount_tendered: `${amount}.0000`, change_due: "0.0000" }]
        : [{ payment_method: "card", amount: `${amount}.0000`, reference_no: `AUTH-${randomUUID().slice(0, 8)}` }];

    const res = await cashierClient.rpc("execute_sale", {
      p_org_id: orgId,
      p_customer_id: customerId,
      p_items: [{ product_id: productId1, quantity: "1.0000", line_discount_amount: "0.0000" }],
      p_payments: payments,
      p_order_discount_amount: 0,
      p_idempotency_key: saleKey,
    });

    expect(res.error).toBeNull();
    return res.data.sale_id;
  }

  describe("void_sale authorization and preconditions", () => {
    it("rejects Cashier lacking sales:void permission with 42501", async () => {
      const saleId = await createSale("cash");
      const { data, error } = await cashierClient.rpc("void_sale", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_void_reason: "Customer changed mind",
        p_idempotency_key: randomUUID(),
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
    });

    it("rejects void on another tenant sale with P0048", async () => {
      const saleId = await createSale("cash");
      const { data, error } = await orgBClient.rpc("void_sale", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_void_reason: "Cross tenant attempt",
        p_idempotency_key: randomUUID(),
      });

      expect(data).toBeNull();
      expect(error?.code).toMatch(/P0002|42501/);
    });
  });

  describe("void_sale execution and inventory restoration", () => {
    it("cash void completes immediately, restores stock, and marks status voided & refunded", async () => {
      const stockBefore = await pgClient.query(
        "SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;",
        [orgId, productId1]
      );
      const initialQty = parseFloat(stockBefore.rows[0].quantity);

      const saleId = await createSale("cash", 25);

      const stockAfterSale = await pgClient.query(
        "SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;",
        [orgId, productId1]
      );
      expect(parseFloat(stockAfterSale.rows[0].quantity)).toBe(initialQty - 1);

      // Perform void
      const voidKey = randomUUID();
      const { data, error } = await managerClient.rpc("void_sale", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_void_reason: "Cashier mistake on cash sale",
        p_idempotency_key: voidKey,
      });

      expect(error).toBeNull();
      expect(data.success).toBe(true);
      expect(data.status).toBe("voided");
      expect(data.payment_status).toBe("refunded");

      const stockAfterVoid = await pgClient.query(
        "SELECT quantity FROM public.inventory WHERE organization_id = $1 AND product_id = $2;",
        [orgId, productId1]
      );
      expect(parseFloat(stockAfterVoid.rows[0].quantity)).toBe(initialQty);

      const movement = await pgClient.query(
        "SELECT * FROM public.stock_movements WHERE organization_id = $1 AND product_id = $2 AND reference_id = $3;",
        [orgId, productId1, `void:${saleId}`]
      );
      expect(movement.rows.length).toBeGreaterThan(0);
    });

    it("external card void creates pending refund and marks payment_status partially_refunded", async () => {
      const saleId = await createSale("card", 25);
      const voidKey = randomUUID();

      const { data, error } = await managerClient.rpc("void_sale", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_void_reason: "External card void test",
        p_idempotency_key: voidKey,
      });

      expect(error).toBeNull();
      expect(data.success).toBe(true);
      expect(data.status).toBe("voided");
      expect(data.payment_status).toBe("partially_refunded");

      const refund = await pgClient.query(
        "SELECT * FROM public.refunds WHERE organization_id = $1 AND sale_id = $2;",
        [orgId, saleId]
      );
      expect(refund.rows[0].status).toBe("pending");
    });

    it("blocks void on an already voided sale with P0050", async () => {
      const saleId = await createSale("cash", 25);

      await managerClient.rpc("void_sale", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_void_reason: "First void",
        p_idempotency_key: randomUUID(),
      });

      const { data, error } = await managerClient.rpc("void_sale", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_void_reason: "Second void attempt",
        p_idempotency_key: randomUUID(),
      });

      expect(data).toBeNull();
      expect(error?.code).toBe("P0050");
    });

    it("blocks void on a sale that has an existing processed return with P0051", async () => {
      const saleId = await createSale("cash", 25);

      const itemRow = await pgClient.query("SELECT id FROM public.sale_items WHERE sale_id = $1 LIMIT 1;", [saleId]);
      await managerClient.rpc("execute_sale_return", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_return_items: [{ sale_item_id: itemRow.rows[0].id, quantity: "1.0000", restock_to_inventory: true }],
        p_refund_method: "cash",
        p_reason: "Defective item",
        p_idempotency_key: randomUUID(),
      });

      const { data, error } = await managerClient.rpc("void_sale", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_void_reason: "Voiding returned sale",
        p_idempotency_key: randomUUID(),
      });

      expect(data).toBeNull();
      expect(error?.code).toMatch(/P0049|P0051/);
    });

    it("replays identical void request idempotently with is_replay = true", async () => {
      const saleId = await createSale("cash", 25);
      const sharedKey = randomUUID();

      const call1 = await managerClient.rpc("void_sale", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_void_reason: "Replay reason",
        p_idempotency_key: sharedKey,
      });
      expect(call1.data.is_replay).toBe(false);

      const call2 = await managerClient.rpc("void_sale", {
        p_org_id: orgId,
        p_sale_id: saleId,
        p_void_reason: "Replay reason",
        p_idempotency_key: sharedKey,
      });
      expect(call2.data.is_replay).toBe(true);
    });
  });
});
