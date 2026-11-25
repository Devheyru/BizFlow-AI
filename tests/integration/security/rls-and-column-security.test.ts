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

describeIntegration("T090: Security, RLS & Column Privileges Integration Tests", () => {
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

  let productId: string;
  let saleId: string;
  const unitCostVal = 25.0;

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
        user_metadata: { first_name: "Sec", last_name: prefix },
      });
      const uid = res.data.user!.id;
      await pgClient.query(
        "INSERT INTO public.profiles (id, first_name, last_name) VALUES ($1, 'Sec', $2) ON CONFLICT (id) DO NOTHING;",
        [uid, prefix]
      );
      return { uid, email };
    };

    const uOwner = await createTestUser("owner");
    ownerUserId = uOwner.uid;
    const uCashier = await createTestUser("cashier");
    cashierUserId = uCashier.uid;
    const uOrgB = await createTestUser("orgb");
    orgBUserId = uOrgB.uid;

    // Create organizations
    const resOrgA = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, created_by)
       VALUES ('Security Org A', $1, 'USD', 'retail', 'US', $2) RETURNING id;`,
      [`sec-org-a-${timestamp}`, ownerUserId]
    );
    orgId = resOrgA.rows[0].id;

    const resOrgB = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, created_by)
       VALUES ('Security Org B', $1, 'USD', 'retail', 'US', $2) RETURNING id;`,
      [`sec-org-b-${timestamp}`, orgBUserId]
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

    // Login clients
    const getClient = async (email: string) => {
      const c = createClient(supabaseUrl, anonKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await c.auth.signInWithPassword({ email, password: testPassword });
      return c;
    };

    ownerClient = await getClient(uOwner.email);
    cashierClient = await getClient(uCashier.email);
    orgBClient = await getClient(uOrgB.email);

    // Insert active product with cost
    const prodRes = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
       VALUES ($1, 'Sec Widget', $2, 50.0000, 'piece', 'active', $3, $3) RETURNING id;`,
      [orgId, `SKU-SEC-${timestamp}`, ownerUserId]
    );
    productId = prodRes.rows[0].id;

    // Insert product cost
    await pgClient.query(
      `INSERT INTO public.product_costs (organization_id, product_id, cost_price)
       VALUES ($1, $2, $3);`,
      [orgId, productId, unitCostVal]
    );

    // Initialize inventory
    await pgClient.query(
      "UPDATE public.inventory SET quantity = 100 WHERE organization_id = $1 AND product_id = $2;",
      [orgId, productId]
    );

    // Create a completed sale via execute_sale RPC
    const saleRes = await ownerClient.rpc("execute_sale", {
      p_org_id: orgId,
      p_customer_id: null,
      p_items: [{ product_id: productId, quantity: "2.0000", line_discount_amount: "0.0000" }],
      p_payments: [{ payment_method: "cash", amount: "100.0000", amount_tendered: "100.0000", change_due: "0.0000" }],
      p_order_discount_amount: 0,
      p_idempotency_key: randomUUID(),
    });
    saleId = saleRes.data.sale_id;
  });

  afterAll(async () => {
    try {
      if (orgId) {
        await pgClient.query("DELETE FROM public.refunds WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.sale_returns WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.sale_return_items WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.payments WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.sale_items WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.sales WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.stock_movements WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.inventory WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.product_costs WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.products WHERE organization_id = $1;", [orgId]);
      }
    } finally {
      await pgClient.end();
    }
  });

  describe("S08: Column Security & Cost Protection Invariants", () => {
    it("S08a: Cashier direct PostgREST SELECT on unit_cost is rejected with 42501", async () => {
      const { data, error } = await cashierClient
        .from("sale_items")
        .select("id, unit_cost")
        .eq("sale_id", saleId);

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
    });

    it("S08b: Cashier get_sale_detail RPC returns unit_cost as NULL", async () => {
      const { data, error } = await cashierClient.rpc("get_sale_detail", {
        p_org_id: orgId,
        p_sale_id: saleId,
      });

      expect(error).toBeNull();
      expect(data.sale.id).toBe(saleId);
      expect(data.items.length).toBeGreaterThan(0);
      expect(data.items[0].unit_cost).toBeNull();
    });

    it("S08c: User with only inventory:read_valuation receives unit_cost as NULL", async () => {
      await pgClient.query(
        `INSERT INTO public.role_permissions (role, permission_id)
         VALUES ('cashier', 'inventory:read_valuation')
         ON CONFLICT (role, permission_id) DO NOTHING;`
      );

      try {
        const { data, error } = await cashierClient.rpc("get_sale_detail", {
          p_org_id: orgId,
          p_sale_id: saleId,
        });

        expect(error).toBeNull();
        expect(data.sale.id).toBe(saleId);
        expect(data.items[0].unit_cost).toBeNull();
      } finally {
        await pgClient.query(
          `DELETE FROM public.role_permissions
           WHERE role = 'cashier' AND permission_id = 'inventory:read_valuation';`
        );
      }
    });

    it("S08d: User with only products:read_cost receives unit_cost as NULL", async () => {
      await pgClient.query(
        `INSERT INTO public.role_permissions (role, permission_id)
         VALUES ('cashier', 'products:read_cost')
         ON CONFLICT (role, permission_id) DO NOTHING;`
      );

      try {
        const { data, error } = await cashierClient.rpc("get_sale_detail", {
          p_org_id: orgId,
          p_sale_id: saleId,
        });

        expect(error).toBeNull();
        expect(data.sale.id).toBe(saleId);
        expect(data.items[0].unit_cost).toBeNull();
      } finally {
        await pgClient.query(
          `DELETE FROM public.role_permissions
           WHERE role = 'cashier' AND permission_id = 'products:read_cost';`
        );
      }
    });

    it("S08e: User with BOTH valuation and cost permissions receives actual numeric unit_cost", async () => {
      const { data, error } = await ownerClient.rpc("get_sale_detail", {
        p_org_id: orgId,
        p_sale_id: saleId,
      });

      expect(error).toBeNull();
      expect(data.sale.id).toBe(saleId);
      expect(data.items.length).toBeGreaterThan(0);
      expect(Number(data.items[0].unit_cost)).toBe(unitCostVal);
    });

    it("S08f: Cross-tenant query to get_sale_detail is rejected with P0048 or P0002", async () => {
      const { data, error } = await orgBClient.rpc("get_sale_detail", {
        p_org_id: orgId,
        p_sale_id: saleId,
      });

      expect(data).toBeNull();
      expect(error?.code).toMatch(/P0002|P0048/);
    });

    it("S08g: Safe columns via PostgREST SELECT succeed for cashier", async () => {
      const { data, error } = await cashierClient
        .from("sale_items")
        .select("id, sale_id, product_id, quantity, unit_price, total_price")
        .eq("sale_id", saleId);

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.length).toBeGreaterThan(0);
      expect(Number(data![0]!.unit_price)).toBe(50.0);
    });
  });

  describe("S01–S07: Deny-All Direct DML & Cross-Tenant Isolation", () => {
    it("denies direct INSERT on sales table to authenticated user", async () => {
      const { error } = await cashierClient.from("sales").insert({
        organization_id: orgId,
        sale_number: `SAL-FORBID-${randomUUID().slice(0, 6)}`,
        subtotal: 100,
        total_amount: 100,
        currency: "USD",
        status: "completed",
        payment_status: "paid",
        idempotency_key: randomUUID(),
      });

      expect(error).not.toBeNull();
      expect(error?.code).toMatch(/42501|PGRST/);
    });

    it("denies direct UPDATE on sales table to authenticated user", async () => {
      const { data, error } = await cashierClient
        .from("sales")
        .update({ status: "voided" })
        .eq("id", saleId)
        .select();

      if (!error) {
        expect(data?.length ?? 0).toBe(0);
      } else {
        expect(error.code).toMatch(/42501|PGRST/);
      }
    });

    it("denies direct DELETE on sales table to authenticated user", async () => {
      const { data, error } = await cashierClient
        .from("sales")
        .delete()
        .eq("id", saleId)
        .select();

      if (!error) {
        expect(data?.length ?? 0).toBe(0);
      } else {
        expect(error.code).toMatch(/42501|PGRST/);
      }
    });

    it("denies direct INSERT on sale_items table", async () => {
      const { error } = await cashierClient.from("sale_items").insert({
        organization_id: orgId,
        sale_id: saleId,
        product_id: productId,
        quantity: 1,
        unit_price: 50,
        total_price: 50,
      });

      expect(error).not.toBeNull();
    });

    it("denies direct INSERT on payments table", async () => {
      const { error } = await cashierClient.from("payments").insert({
        organization_id: orgId,
        sale_id: saleId,
        payment_method: "cash",
        amount: 50,
      });

      expect(error).not.toBeNull();
    });

    it("denies direct INSERT on returns and return_items tables", async () => {
      const retId = randomUUID();
      const { error: retErr } = await cashierClient.from("sale_returns").insert({
        id: retId,
        organization_id: orgId,
        sale_id: saleId,
        return_number: "RET-DENY-1",
        reason: "Test Deny",
        total_refund_amount: 50,
        idempotency_key: randomUUID(),
      });
      expect(retErr).not.toBeNull();

      const { error: itemErr } = await cashierClient.from("sale_return_items").insert({
        organization_id: orgId,
        return_id: retId,
        product_id: productId,
        quantity: 1,
        refund_amount: 50,
      });
      expect(itemErr).not.toBeNull();
    });

    it("enforces cross-tenant read isolation: Org B sees zero rows of Org A sales", async () => {
      const { data, error } = await orgBClient
        .from("sales")
        .select("id, sale_number")
        .eq("organization_id", orgId);

      expect(error).toBeNull();
      expect(data?.length ?? 0).toBe(0);
    });
  });

  describe("S09: Service-Role Restriction Verification", () => {
    it("verifies direct public execute grant is revoked for unauthenticated roles", async () => {
      const anonClient = createClient(supabaseUrl, anonKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data, error } = await anonClient.rpc("execute_sale", {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [{ product_id: productId, quantity: "1.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "50.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: randomUUID(),
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.code).toMatch(/42501|08001|PGRST/);
    });
  });
});
