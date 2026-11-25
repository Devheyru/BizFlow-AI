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

describeIntegration("T089: Tax Settings & Sale Detail Cost Masking RPC Tests", () => {
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

  const timestamp = Date.now();
  const testPassword = "Password123!SecureTest";

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const ownerEmail = `tax-detail-owner-${timestamp}@example.com`;
    const cashEmail = `tax-detail-cash-${timestamp}@example.com`;
    const orgBEmail = `tax-detail-orgb-${timestamp}@example.com`;

    const uOwner = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Tax", last_name: "Owner" },
    });
    ownerUserId = uOwner.data.user!.id;

    const uCash = await adminClient.auth.admin.createUser({
      email: cashEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Tax", last_name: "Cashier" },
    });
    cashierUserId = uCash.data.user!.id;

    const uOrgB = await adminClient.auth.admin.createUser({
      email: orgBEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Tax", last_name: "OrgB" },
    });
    orgBUserId = uOrgB.data.user!.id;

    // Insert profiles
    await pgClient.query(
      `INSERT INTO public.profiles (id, first_name, last_name)
       VALUES
         ($1, 'Tax', 'Owner'),
         ($2, 'Tax', 'Cashier'),
         ($3, 'Tax', 'OrgB')
       ON CONFLICT (id) DO NOTHING;`,
      [ownerUserId, cashierUserId, orgBUserId]
    );

    // Create organizations
    const resOrgA = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, created_by)
       VALUES ('Tax Detail Org A', $1, 'USD', 'retail', 'US', $2) RETURNING id;`,
      [`tax-detail-a-${timestamp}`, ownerUserId]
    );
    orgId = resOrgA.rows[0].id;

    const resOrgB = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, created_by)
       VALUES ('Tax Detail Org B', $1, 'USD', 'retail', 'US', $2) RETURNING id;`,
      [`tax-detail-b-${timestamp}`, orgBUserId]
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

    // Initial tax settings
    await pgClient.query(
      `INSERT INTO public.organization_tax_settings (organization_id, tax_name, default_tax_rate, is_tax_inclusive, updated_by)
       VALUES ($1, 'Sales Tax', 8.5000, false, $2)
       ON CONFLICT (organization_id) DO NOTHING;`,
      [orgId, ownerUserId]
    );

    // Product with unit_cost $30.00, selling_price $50.00
    const prodRes = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
       VALUES ($1, 'Tax Detail Widget', $2, 50.0000, 'piece', 'active', $3, $3)
       RETURNING id;`,
      [orgId, `SKU-TAX-${timestamp}`, ownerUserId]
    );
    productId = prodRes.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.product_costs (organization_id, product_id, cost_price)
       VALUES ($1, $2, 30.0000);`,
      [orgId, productId]
    );

    await pgClient.query(
      `UPDATE public.inventory
       SET quantity = 100.0000, version = 1
       WHERE organization_id = $1 AND product_id = $2;`,
      [orgId, productId]
    );

    // Auth clients
    ownerClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
    await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

    cashierClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
    await cashierClient.auth.signInWithPassword({ email: cashEmail, password: testPassword });

    orgBClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
    await orgBClient.auth.signInWithPassword({ email: orgBEmail, password: testPassword });

    // Execute a test sale to populate sale_items with unit_cost
    const saleKey = randomUUID();
    const { data: saleData } = await cashierClient.rpc("execute_sale", {
      p_org_id: orgId,
      p_customer_id: null,
      p_items: [{ product_id: productId, quantity: "1.0000", line_discount_amount: "0.0000" }],
      p_payments: [{ payment_method: "cash", amount: "54.2500", amount_tendered: "60.0000", change_due: "5.7500" }],
      p_order_discount_amount: 0,
      p_idempotency_key: saleKey,
    });
    saleId = saleData.sale_id;
  });

  afterAll(async () => {
    try {
      if (pgClient && orgId) {
        await pgClient.query("DELETE FROM public.payments WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.sale_items WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.sales WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.inventory WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.product_costs WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.products WHERE organization_id = $1;", [orgId]);
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

  describe("update_tax_settings RPC", () => {
    it("updates tax settings when called by Owner and persists changes", async () => {
      const { data, error } = await ownerClient.rpc("update_tax_settings", {
        p_org_id: orgId,
        p_tax_name: "Updated VAT",
        p_default_tax_rate: 12.5,
        p_is_tax_inclusive: true,
      });

      expect(error).toBeNull();
      const res = data as any;
      expect(res.success).toBe(true);
      expect(res.tax_name).toBe("Updated VAT");
      expect(Number(res.default_tax_rate)).toBe(12.5);
      expect(res.is_tax_inclusive).toBe(true);
    });

    it("rejects unauthorized Cashier with 42501 INSUFFICIENT_PERMISSIONS", async () => {
      const { error } = await cashierClient.rpc("update_tax_settings", {
        p_org_id: orgId,
        p_tax_name: "Illegal VAT",
        p_default_tax_rate: 15.0,
        p_is_tax_inclusive: false,
      });

      expect(error).not.toBeNull();
      expect(error?.code).toMatch(/P0002|42501/);
    });

    it("validates constraints and rejects invalid negative tax rate (23514)", async () => {
      const { error } = await ownerClient.rpc("update_tax_settings", {
        p_org_id: orgId,
        p_tax_name: "Negative Tax",
        p_default_tax_rate: -5.0,
        p_is_tax_inclusive: false,
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("23514");
    });

    it("enforces tenant isolation against cross-tenant callers", async () => {
      const { error } = await orgBClient.rpc("update_tax_settings", {
        p_org_id: orgId,
        p_tax_name: "Cross Tenant Attack",
        p_default_tax_rate: 10.0,
        p_is_tax_inclusive: false,
      });

      expect(error).not.toBeNull();
      expect(error?.code).toMatch(/P0002|42501/);
    });
  });

  describe("get_sale_detail Cost Masking (Dual-Permission Check)", () => {
    it("MASKS unit_cost (returns null) for Cashier lacking valuation/cost permissions", async () => {
      const { data, error } = await cashierClient.rpc("get_sale_detail", {
        p_org_id: orgId,
        p_sale_id: saleId,
      });

      expect(error).toBeNull();
      const res = data as any;
      expect(res.sale.id).toBe(saleId);
      expect(res.items).toHaveLength(1);
      expect(res.items[0].unit_cost).toBeNull(); // Strictly masked!
      expect(res.items[0].unit_price).toBe("50.0000");
    });

    it("MASKS unit_cost when user has inventory:read_valuation ONLY (Quadrant 2)", async () => {
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
        expect(data.items[0].unit_cost).toBeNull(); // Still masked!
      } finally {
        await pgClient.query(
          `DELETE FROM public.role_permissions
           WHERE role = 'cashier' AND permission_id = 'inventory:read_valuation';`
        );
      }
    });

    it("MASKS unit_cost when user has products:read_cost ONLY (Quadrant 3)", async () => {
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
        expect(data.items[0].unit_cost).toBeNull(); // Still masked!
      } finally {
        await pgClient.query(
          `DELETE FROM public.role_permissions
           WHERE role = 'cashier' AND permission_id = 'products:read_cost';`
        );
      }
    });

    it("REVEALS actual unit_cost for Owner holding dual valuation & cost permissions", async () => {
      const { data, error } = await ownerClient.rpc("get_sale_detail", {
        p_org_id: orgId,
        p_sale_id: saleId,
      });

      expect(error).toBeNull();
      const res = data as any;
      expect(res.sale.id).toBe(saleId);
      expect(Number(res.items[0].unit_cost)).toBe(30.0); // Exact unit_cost revealed!
    });

    it("enforces tenant isolation against cross-tenant callers (P0002 or P0048)", async () => {
      const { data, error } = await orgBClient.rpc("get_sale_detail", {
        p_org_id: orgId,
        p_sale_id: saleId,
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.code).toMatch(/P0002|P0048/);
    });
  });
});
