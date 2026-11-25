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

describeIntegration("T083: execute_sale RPC Integration Tests", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;

  let ownerClient: SupabaseClient;
  let cashierClient: SupabaseClient;
  let orgBClient: SupabaseClient;

  let orgId: string;
  let orgBId: string;
  let ownerUserId: string;
  let cashierUserId: string;
  let orgBUserId: string;

  let customerId: string;
  let productActive1: string;
  let productActive2: string;
  let productInactive: string;
  let productLimitedStock: string;

  const timestamp = Date.now();
  const testPassword = "Password123!SecureTest";

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const ownerEmail = `sale-own-${timestamp}@example.com`;
    const cashEmail = `sale-cash-${timestamp}@example.com`;
    const orgBEmail = `sale-orgb-${timestamp}@example.com`;

    const uOwner = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Sale", last_name: "Owner" },
    });
    ownerUserId = uOwner.data.user!.id;

    const uCash = await adminClient.auth.admin.createUser({
      email: cashEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Sale", last_name: "Cashier" },
    });
    cashierUserId = uCash.data.user!.id;

    const uOrgB = await adminClient.auth.admin.createUser({
      email: orgBEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Sale", last_name: "OrgB" },
    });
    orgBUserId = uOrgB.data.user!.id;

    // Profiles
    await pgClient.query(
      `INSERT INTO public.profiles (id, first_name, last_name)
       VALUES
         ($1, 'Sale', 'Owner'),
         ($2, 'Sale', 'Cashier'),
         ($3, 'Sale', 'OrgB')
       ON CONFLICT (id) DO NOTHING;`,
      [ownerUserId, cashierUserId, orgBUserId]
    );

    // Orgs
    const resOrg = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, business_type, country, currency, timezone, created_by)
       VALUES ('Sale Integration Org', $1, 'retail', 'US', 'USD', 'America/New_York', $2)
       RETURNING id;`,
      [`sale-org-${timestamp}`, ownerUserId]
    );
    orgId = resOrg.rows[0].id;

    const resOrgB = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, business_type, country, currency, timezone, created_by)
       VALUES ('Sale Org B', $1, 'retail', 'US', 'USD', 'America/New_York', $2)
       RETURNING id;`,
      [`sale-orgb-${timestamp}`, orgBUserId]
    );
    orgBId = resOrgB.rows[0].id;

    // Memberships
    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES
         ($1, $2, 'owner', 'active'),
         ($1, $3, 'cashier', 'active'),
         ($4, $5, 'owner', 'active');`,
      [orgId, ownerUserId, cashierUserId, orgBId, orgBUserId]
    );

    // Initial tax settings (10% Tax-Exclusive)
    await pgClient.query(
      `INSERT INTO public.organization_tax_settings (organization_id, tax_name, default_tax_rate, is_tax_inclusive, updated_by)
       VALUES ($1, 'Standard Tax', 10.0000, false, $2)
       ON CONFLICT (organization_id) DO NOTHING;`,
      [orgId, ownerUserId]
    );

    // Customer
    const resCust = await pgClient.query(
      `INSERT INTO public.customers (organization_id, name, phone, email)
       VALUES ($1, 'Registered VIP Customer', $2, $3)
       RETURNING id;`,
      [orgId, `+1415${Math.floor(1000000 + Math.random() * 9000000)}`, `sale-cust-${timestamp}@example.com`]
    );
    customerId = resCust.rows[0].id;

    // Active Product 1: $50
    const resP1 = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
       VALUES ($1, 'Sale Widget A', $2, 50.0000, 'piece', 'active', $3, $3)
       RETURNING id;`,
      [orgId, `SKU-SALE-1-${timestamp}`, ownerUserId]
    );
    productActive1 = resP1.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.product_costs (organization_id, product_id, cost_price)
       VALUES ($1, $2, 20.0000);`,
      [orgId, productActive1]
    );

    // Active Product 2: $20
    const resP2 = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
       VALUES ($1, 'Sale Widget B', $2, 20.0000, 'piece', 'active', $3, $3)
       RETURNING id;`,
      [orgId, `SKU-SALE-2-${timestamp}`, ownerUserId]
    );
    productActive2 = resP2.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.product_costs (organization_id, product_id, cost_price)
       VALUES ($1, $2, 8.0000);`,
      [orgId, productActive2]
    );

    // Inactive Product
    const resPInact = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
       VALUES ($1, 'Inactive Widget', $2, 30.0000, 'piece', 'inactive', $3, $3)
       RETURNING id;`,
      [orgId, `SKU-SALE-INACT-${timestamp}`, ownerUserId]
    );
    productInactive = resPInact.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.product_costs (organization_id, product_id, cost_price)
       VALUES ($1, $2, 10.0000);`,
      [orgId, productInactive]
    );

    // Limited Stock Product: 1 unit available
    const resPLim = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
       VALUES ($1, 'Last Unit Widget', $2, 40.0000, 'piece', 'active', $3, $3)
       RETURNING id;`,
      [orgId, `SKU-SALE-LIM-${timestamp}`, ownerUserId]
    );
    productLimitedStock = resPLim.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.product_costs (organization_id, product_id, cost_price)
       VALUES ($1, $2, 15.0000);`,
      [orgId, productLimitedStock]
    );

    // Inventory
    await pgClient.query("UPDATE public.inventory SET quantity = 100.0000, version = 1 WHERE organization_id = $1 AND product_id = $2;", [orgId, productActive1]);
    await pgClient.query("UPDATE public.inventory SET quantity = 100.0000, version = 1 WHERE organization_id = $1 AND product_id = $2;", [orgId, productActive2]);
    await pgClient.query("UPDATE public.inventory SET quantity = 50.0000, version = 1 WHERE organization_id = $1 AND product_id = $2;", [orgId, productInactive]);
    await pgClient.query("UPDATE public.inventory SET quantity = 1.0000, version = 1 WHERE organization_id = $1 AND product_id = $2;", [orgId, productLimitedStock]);

    // Auth clients
    ownerClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
    await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

    cashierClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
    await cashierClient.auth.signInWithPassword({ email: cashEmail, password: testPassword });

    orgBClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
    await orgBClient.auth.signInWithPassword({ email: orgBEmail, password: testPassword });
  });

  afterAll(async () => {
    try {
      if (pgClient && orgId) {
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
      if (cashierUserId) await adminClient.auth.admin.deleteUser(cashierUserId).catch(() => {});
      if (orgBUserId) await adminClient.auth.admin.deleteUser(orgBUserId).catch(() => {});
    }

    if (pgClient) {
      await pgClient.end().catch(() => {});
    }
  });

  describe("execute_sale Core Scenarios", () => {
    it("walk-in guest (tax-exclusive) checkout with cash change", async () => {
      const key = randomUUID();
      const { data, error } = await cashierClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [{ product_id: productActive1, quantity: "1.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "55.0000", amount_tendered: "60.0000", change_due: "5.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: key,
        p_notes: "Walk-in guest test",
      });

      expect(error).toBeNull();
      expect(data.success).toBe(true);
      expect(Number(data.total_amount)).toBe(55.0);
      expect(data.payment_status).toBe("paid");
      expect(data.is_replay).toBe(false);
    });

    it("registered customer (tax-inclusive) checkout", async () => {
      await pgClient.query(
        "UPDATE public.organization_tax_settings SET is_tax_inclusive = true WHERE organization_id = $1;",
        [orgId]
      );

      const key = randomUUID();
      const { data, error } = await cashierClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: customerId,
        p_items: [{ product_id: productActive1, quantity: "1.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "50.0000", amount_tendered: "50.0000", change_due: "0.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: key,
      });

      expect(error).toBeNull();
      expect(data.success).toBe(true);
      expect(Number(data.total_amount)).toBe(50.0);

      await pgClient.query(
        "UPDATE public.organization_tax_settings SET is_tax_inclusive = false WHERE organization_id = $1;",
        [orgId]
      );
    });

    it("split payment across cash and card", async () => {
      const key = randomUUID();
      const { data, error } = await cashierClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: customerId,
        p_items: [
          { product_id: productActive1, quantity: "1.0000", line_discount_amount: "0.0000" },
          { product_id: productActive2, quantity: "1.0000", line_discount_amount: "0.0000" },
        ],
        p_payments: [
          { payment_method: "cash", amount: "37.0000", amount_tendered: "40.0000", change_due: "3.0000" },
          { payment_method: "card", amount: "40.0000", reference_no: "AUTH-SPLIT-999" },
        ],
        p_order_discount_amount: 0,
        p_idempotency_key: key,
      });

      expect(error).toBeNull();
      expect(data.success).toBe(true);
      expect(Number(data.total_amount)).toBe(77.0);

      const payments = await pgClient.query(
        "SELECT * FROM public.payments WHERE organization_id = $1 AND sale_id = $2 ORDER BY payment_method;",
        [orgId, data.sale_id]
      );
      expect(payments.rows).toHaveLength(2);
      expect(payments.rows[0].payment_method).toBe("card");
      expect(payments.rows[0].reference_no).toBe("AUTH-SPLIT-999");
      expect(payments.rows[1].payment_method).toBe("cash");
    });

    it("zero-value sale (100% discount, zero payable, zero payments array accepted)", async () => {
      const key = randomUUID();
      const { data, error } = await cashierClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [{ product_id: productActive1, quantity: "1.0000", line_discount_amount: "50.0000" }],
        p_payments: [],
        p_order_discount_amount: 0,
        p_idempotency_key: key,
      });

      expect(error).toBeNull();
      expect(data.success).toBe(true);
      expect(Number(data.total_amount)).toBe(0.0);
      expect(data.payment_status).toBe("paid");
    });

    it("idempotency replay returns cached result with is_replay = true", async () => {
      const key = randomUUID();
      const payload = {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [{ product_id: productActive1, quantity: "1.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "55.0000", amount_tendered: "55.0000", change_due: "0.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: key,
      };

      const call1 = await cashierClient.rpc("execute_sale", payload);
      expect(call1.data.is_replay).toBe(false);

      const call2 = await cashierClient.rpc("execute_sale", payload);
      expect(call2.data.is_replay).toBe(true);
      expect(call2.data.sale_id).toBe(call1.data.sale_id);
    });

    it("idempotency conflict with modified payload raises P0024", async () => {
      const key = randomUUID();
      await cashierClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [{ product_id: productActive1, quantity: "1.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "55.0000", amount_tendered: "55.0000", change_due: "0.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: key,
      });

      const conflictRes = await cashierClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [{ product_id: productActive1, quantity: "2.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "110.0000", amount_tendered: "110.0000", change_due: "0.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: key,
      });

      expect(conflictRes.data).toBeNull();
      expect(conflictRes.error?.code).toBe("P0024");
    });
  });

  describe("execute_sale Validations & Error Handling", () => {
    it("insufficient stock rolls back transaction with P0011", async () => {
      const { data, error } = await cashierClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [{ product_id: productActive1, quantity: "99999.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "5499945.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: randomUUID(),
      });

      expect(data).toBeNull();
      expect(error?.code).toBe("P0011");
    });

    it("archived/inactive product rejected with P0012", async () => {
      const { data, error } = await cashierClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [{ product_id: productInactive, quantity: "1.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "33.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: randomUUID(),
      });

      expect(data).toBeNull();
      expect(error?.code).toMatch(/P0012|P0031/);
    });

    it("duplicate product in cart rejected with P0044", async () => {
      const { data, error } = await cashierClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [
          { product_id: productActive1, quantity: "1.0000", line_discount_amount: "0.0000" },
          { product_id: productActive1, quantity: "2.0000", line_discount_amount: "0.0000" },
        ],
        p_payments: [{ payment_method: "cash", amount: "165.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: randomUUID(),
      });

      expect(data).toBeNull();
      expect(error?.code).toBe("P0044");
    });

    it("empty cart rejected with P0043", async () => {
      const { data, error } = await cashierClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [],
        p_payments: [{ payment_method: "cash", amount: "10.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: randomUUID(),
      });

      expect(data).toBeNull();
      expect(error?.code).toBe("P0043");
    });

    it("underpayment rejected with P0045", async () => {
      const { data, error } = await cashierClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [{ product_id: productActive1, quantity: "1.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "20.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: randomUUID(),
      });

      expect(data).toBeNull();
      expect(error?.code).toBe("P0045");
    });

    it("non-cash overpayment rejected with P0046", async () => {
      const { data, error } = await cashierClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [{ product_id: productActive1, quantity: "1.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "card", amount: "60.0000", reference_no: "AUTH-OVERPAY" }],
        p_order_discount_amount: 0,
        p_idempotency_key: randomUUID(),
      });

      expect(data).toBeNull();
      expect(error?.code).toBe("P0046");
    });

    it("missing transaction reference on card tender rejected with P0057", async () => {
      const { data, error } = await cashierClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [{ product_id: productActive1, quantity: "1.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "card", amount: "55.0000", reference_no: null }],
        p_order_discount_amount: 0,
        p_idempotency_key: randomUUID(),
      });

      expect(data).toBeNull();
      expect(error?.code).toBe("P0057");
    });

    it("concurrent last-unit checkout: exactly one succeeds, second rejected with P0011", async () => {
      const [res1, res2] = await Promise.all([
        cashierClient.rpc("execute_sale", {
          p_org_id: orgId,
          p_customer_id: null,
          p_items: [{ product_id: productLimitedStock, quantity: "1.0000", line_discount_amount: "0.0000" }],
          p_payments: [{ payment_method: "cash", amount: "44.0000" }],
          p_order_discount_amount: 0,
          p_idempotency_key: randomUUID(),
        }),
        cashierClient.rpc("execute_sale", {
          p_org_id: orgId,
          p_customer_id: null,
          p_items: [{ product_id: productLimitedStock, quantity: "1.0000", line_discount_amount: "0.0000" }],
          p_payments: [{ payment_method: "cash", amount: "44.0000" }],
          p_order_discount_amount: 0,
          p_idempotency_key: randomUUID(),
        }),
      ]);

      const successCount = (res1.data?.success ? 1 : 0) + (res2.data?.success ? 1 : 0);
      const failError = res1.error || res2.error;

      expect(successCount).toBe(1);
      expect(failError?.code).toBe("P0011");
    });
  });
});
