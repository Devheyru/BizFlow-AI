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

describeIntegration("T092: Financial Precision & Currency Invariants Integration Tests", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;

  let ownerClient: SupabaseClient;
  let cashierClient: SupabaseClient;

  let orgIdUsd: string;
  let orgIdJpy: string;
  let orgIdKwd: string;

  let ownerUserId: string;
  let cashierUserId: string;

  let prodPieceUsd: string;
  let prodKgUsd: string;
  let prodJpy: string;
  let prodKwd: string;

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
        user_metadata: { first_name: "Fin", last_name: prefix },
      });
      const uid = res.data.user!.id;
      await pgClient.query(
        "INSERT INTO public.profiles (id, first_name, last_name) VALUES ($1, 'Fin', $2) ON CONFLICT (id) DO NOTHING;",
        [uid, prefix]
      );
      return { uid, email };
    };

    const uOwner = await createTestUser("owner");
    ownerUserId = uOwner.uid;
    const uCash = await createTestUser("cash");
    cashierUserId = uCash.uid;

    // Create 3 Orgs: USD (2 decimals), JPY (0 decimals), KWD (3 decimals)
    const oUsd = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, created_by)
       VALUES ('Fin USD Org', $1, 'USD', 'retail', 'US', $2) RETURNING id;`,
      [`fin-usd-${timestamp}`, ownerUserId]
    );
    orgIdUsd = oUsd.rows[0].id;

    const oJpy = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, created_by)
       VALUES ('Fin JPY Org', $1, 'JPY', 'retail', 'JP', $2) RETURNING id;`,
      [`fin-jpy-${timestamp}`, ownerUserId]
    );
    orgIdJpy = oJpy.rows[0].id;

    const oKwd = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, created_by)
       VALUES ('Fin KWD Org', $1, 'KWD', 'retail', 'KW', $2) RETURNING id;`,
      [`fin-kwd-${timestamp}`, ownerUserId]
    );
    orgIdKwd = oKwd.rows[0].id;

    // Memberships
    for (const oid of [orgIdUsd, orgIdJpy, orgIdKwd]) {
      await pgClient.query(
        `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active'), ($1, $3, 'cashier', 'active');`,
        [oid, ownerUserId, cashierUserId]
      );
    }

    const getClient = async (email: string) => {
      const c = createClient(supabaseUrl, anonKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await c.auth.signInWithPassword({ email, password: testPassword });
      return c;
    };

    ownerClient = await getClient(uOwner.email);
    cashierClient = await getClient(uCash.email);

    // Products in USD Org: Piece (discrete) and Kg (continuous)
    const pPiece = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
       VALUES ($1, 'Discrete Piece', $2, 10.0000, 'piece', 'active', $3, $3) RETURNING id;`,
      [orgIdUsd, `SKU-PIECE-${timestamp}`, ownerUserId]
    );
    prodPieceUsd = pPiece.rows[0].id;

    const pKg = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
       VALUES ($1, 'Continuous Kg', $2, 15.5000, 'kg', 'active', $3, $3) RETURNING id;`,
      [orgIdUsd, `SKU-KG-${timestamp}`, ownerUserId]
    );
    prodKgUsd = pKg.rows[0].id;

    // Product in JPY Org
    const pJ = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
       VALUES ($1, 'JPY Item', $2, 1500.0000, 'piece', 'active', $3, $3) RETURNING id;`,
      [orgIdJpy, `SKU-JPY-${timestamp}`, ownerUserId]
    );
    prodJpy = pJ.rows[0].id;

    // Product in KWD Org
    const pK = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
       VALUES ($1, 'KWD Item', $2, 2.5000, 'piece', 'active', $3, $3) RETURNING id;`,
      [orgIdKwd, `SKU-KWD-${timestamp}`, ownerUserId]
    );
    prodKwd = pK.rows[0].id;

    // Update inventory
    await pgClient.query("UPDATE public.inventory SET quantity = 10000 WHERE organization_id = $1 AND product_id = $2;", [orgIdUsd, prodPieceUsd]);
    await pgClient.query("UPDATE public.inventory SET quantity = 10000 WHERE organization_id = $1 AND product_id = $2;", [orgIdUsd, prodKgUsd]);
    await pgClient.query("UPDATE public.inventory SET quantity = 10000 WHERE organization_id = $1 AND product_id = $2;", [orgIdJpy, prodJpy]);
    await pgClient.query("UPDATE public.inventory SET quantity = 10000 WHERE organization_id = $1 AND product_id = $2;", [orgIdKwd, prodKwd]);
  });

  afterAll(async () => {
    try {
      for (const oid of [orgIdUsd, orgIdJpy, orgIdKwd]) {
        if (oid) {
          await pgClient.query("DELETE FROM public.refunds WHERE organization_id = $1;", [oid]);
          await pgClient.query("DELETE FROM public.sale_returns WHERE organization_id = $1;", [oid]);
          await pgClient.query("DELETE FROM public.sale_return_items WHERE organization_id = $1;", [oid]);
          await pgClient.query("DELETE FROM public.payments WHERE organization_id = $1;", [oid]);
          await pgClient.query("DELETE FROM public.sale_items WHERE organization_id = $1;", [oid]);
          await pgClient.query("DELETE FROM public.sales WHERE organization_id = $1;", [oid]);
          await pgClient.query("DELETE FROM public.stock_movements WHERE organization_id = $1;", [oid]);
          await pgClient.query("DELETE FROM public.inventory WHERE organization_id = $1;", [oid]);
          await pgClient.query("DELETE FROM public.product_costs WHERE organization_id = $1;", [oid]);
          await pgClient.query("DELETE FROM public.products WHERE organization_id = $1;", [oid]);
          await pgClient.query("DELETE FROM public.organization_tax_settings WHERE organization_id = $1;", [oid]);
        }
      }
    } finally {
      await pgClient.end();
    }
  });

  describe("F01–F03: Tax Calculation Precision & Settings", () => {
    it("F01: Tax-exclusive calculation adds exact rounded tax to total", async () => {
      await ownerClient.rpc("update_tax_settings", {
        p_org_id: orgIdUsd,
        p_tax_name: "VAT 10%",
        p_default_tax_rate: 10.0,
        p_is_tax_inclusive: false,
      });

      const { data, error } = await cashierClient.rpc("execute_sale", {
        p_org_id: orgIdUsd,
        p_customer_id: null,
        p_items: [{ product_id: prodPieceUsd, quantity: "3.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "33.0000", amount_tendered: "33.0000", change_due: "0.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: randomUUID(),
      });

      expect(error).toBeNull();
      expect(Number(data.subtotal)).toBe(30.0);
      expect(Number(data.tax_amount)).toBe(3.0);
      expect(Number(data.total_amount)).toBe(33.0);
    });

    it("F02: Tax-inclusive calculation decomposes line total correctly", async () => {
      await ownerClient.rpc("update_tax_settings", {
        p_org_id: orgIdUsd,
        p_tax_name: "VAT 10% Inc",
        p_default_tax_rate: 10.0,
        p_is_tax_inclusive: true,
      });

      const { data, error } = await cashierClient.rpc("execute_sale", {
        p_org_id: orgIdUsd,
        p_customer_id: null,
        p_items: [{ product_id: prodPieceUsd, quantity: "3.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "30.0000", amount_tendered: "30.0000", change_due: "0.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: randomUUID(),
      });

      expect(error).toBeNull();
      expect(Number(data.total_amount)).toBe(30.0);
      expect(Number(data.tax_amount)).toBeCloseTo(2.73, 2);
    });

    it("F03: Zero-rate tax settings produces 0.0000 tax amount", async () => {
      await ownerClient.rpc("update_tax_settings", {
        p_org_id: orgIdUsd,
        p_tax_name: "Zero Tax",
        p_default_tax_rate: 0.0,
        p_is_tax_inclusive: false,
      });

      const { data, error } = await cashierClient.rpc("execute_sale", {
        p_org_id: orgIdUsd,
        p_customer_id: null,
        p_items: [{ product_id: prodPieceUsd, quantity: "1.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "10.0000", amount_tendered: "10.0000", change_due: "0.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: randomUUID(),
      });

      expect(error).toBeNull();
      expect(Number(data.tax_amount)).toBe(0.0);
      expect(Number(data.total_amount)).toBe(10.0);
    });
  });

  describe("F05: Currency Exponents (JPY=0, KWD=3)", () => {
    it("processes JPY sale with zero decimal places", async () => {
      const { data, error } = await cashierClient.rpc("execute_sale", {
        p_org_id: orgIdJpy,
        p_customer_id: null,
        p_items: [{ product_id: prodJpy, quantity: "2.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "3000.0000", amount_tendered: "3000.0000", change_due: "0.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: randomUUID(),
      });

      expect(error).toBeNull();
      expect(Number(data.total_amount)).toBe(3000.0);
      expect(data.currency).toBe("JPY");
    });

    it("processes KWD sale with 3 decimal places", async () => {
      const { data, error } = await cashierClient.rpc("execute_sale", {
        p_org_id: orgIdKwd,
        p_customer_id: null,
        p_items: [{ product_id: prodKwd, quantity: "1.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "2.5000", amount_tendered: "2.5000", change_due: "0.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: randomUUID(),
      });

      expect(error).toBeNull();
      expect(Number(data.total_amount)).toBe(2.5);
      expect(data.currency).toBe("KWD");
    });
  });

  describe("F06–F08: Quantities & Discrete UOM Invariants", () => {
    it("F08: Discrete UOM ('piece') rejects fractional quantity with P0015", async () => {
      const { data, error } = await cashierClient.rpc("execute_sale", {
        p_org_id: orgIdUsd,
        p_customer_id: null,
        p_items: [{ product_id: prodPieceUsd, quantity: "1.5000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "15.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: randomUUID(),
      });

      expect(data).toBeNull();
      expect(error?.code).toBe("P0015");
    });

    it("accepts fractional quantity on continuous UOM ('kg')", async () => {
      const { data, error } = await cashierClient.rpc("execute_sale", {
        p_org_id: orgIdUsd,
        p_customer_id: null,
        p_items: [{ product_id: prodKgUsd, quantity: "2.5000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "38.7500", amount_tendered: "38.7500", change_due: "0.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: randomUUID(),
      });

      expect(error).toBeNull();
      expect(data.success).toBe(true);
      expect(Number(data.total_amount)).toBe(38.75);
    });

    it("F07: Rejects excess decimal places (>4 decimals) with P0016", async () => {
      const { data, error } = await cashierClient.rpc("execute_sale", {
        p_org_id: orgIdUsd,
        p_customer_id: null,
        p_items: [{ product_id: prodKgUsd, quantity: "1.12345", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "17.4135" }],
        p_order_discount_amount: 0,
        p_idempotency_key: randomUUID(),
      });

      expect(data).toBeNull();
      expect(error?.code).toBe("P0016");
    });
  });

  describe("F09–F11: Return Proportional Calculations & Cumulative Cap", () => {
    it("F09 & F11: Enforces proportional refund calculation and cumulative cap", async () => {
      const saleRes = await cashierClient.rpc("execute_sale", {
        p_org_id: orgIdUsd,
        p_customer_id: null,
        p_items: [{ product_id: prodPieceUsd, quantity: "4.0000", line_discount_amount: "0.0000" }],
        p_payments: [{ payment_method: "cash", amount: "40.0000", amount_tendered: "40.0000", change_due: "0.0000" }],
        p_order_discount_amount: 0,
        p_idempotency_key: randomUUID(),
      });
      const saleId = saleRes.data.sale_id;

      const items = await pgClient.query("SELECT id FROM public.sale_items WHERE sale_id = $1;", [saleId]);
      const saleItemId = items.rows[0].id;

      // Partial return 1: 2 units -> $20 refund
      const ret1 = await ownerClient.rpc("execute_sale_return", {
        p_org_id: orgIdUsd,
        p_sale_id: saleId,
        p_return_items: [{ sale_item_id: saleItemId, quantity: "2.0000", restock_to_inventory: true }],
        p_refund_method: "cash",
        p_reason: "Return half",
        p_idempotency_key: randomUUID(),
      });
      expect(ret1.data.success).toBe(true);
      expect(Number(ret1.data.total_refund_amount)).toBe(20.0);

      // Partial return 2: 2 remaining units -> $20 refund
      const ret2 = await ownerClient.rpc("execute_sale_return", {
        p_org_id: orgIdUsd,
        p_sale_id: saleId,
        p_return_items: [{ sale_item_id: saleItemId, quantity: "2.0000", restock_to_inventory: true }],
        p_refund_method: "cash",
        p_reason: "Return remaining",
        p_idempotency_key: randomUUID(),
      });
      expect(ret2.data.success).toBe(true);
      expect(Number(ret2.data.total_refund_amount)).toBe(20.0);
      expect(ret2.data.payment_status).toBe("refunded");

      // Attempting further return is rejected with P0049 or P0052
      const ret3 = await ownerClient.rpc("execute_sale_return", {
        p_org_id: orgIdUsd,
        p_sale_id: saleId,
        p_return_items: [{ sale_item_id: saleItemId, quantity: "1.0000", restock_to_inventory: true }],
        p_refund_method: "cash",
        p_reason: "Excess return",
        p_idempotency_key: randomUUID(),
      });
      expect(ret3.data).toBeNull();
      expect(ret3.error?.code).toMatch(/P0049|P0052/);
    });
  });
});
