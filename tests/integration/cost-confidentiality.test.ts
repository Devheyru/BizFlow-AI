import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { clearInMemoryCookieJar, createClient as createServerClient } from "@/lib/supabase/server";
import {
  createProductAction,
  updateProductAction,
  getProductStateAction,
} from "@/actions/product-actions";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

if (!anonKey || !serviceRoleKey) {
  throw new Error("Missing required Supabase environment keys");
}

describe("T055: Product Cost Confidentiality Integration Tests (FR-038, FR-039, FR-041, SC-004)", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;

  // Supabase clients
  let ownerClient: SupabaseClient;
  let managerClient: SupabaseClient;
  let cashierClient: SupabaseClient;

  // User IDs & Emails
  let ownerEmail: string;
  let mgrEmail: string;
  let cashEmail: string;

  let ownerUserId: string;
  let managerUserId: string;
  let cashierUserId: string;
  const testPassword = "P@ssword123!CostSecure";

  // Organization
  let orgId: string;
  const orgSlug = `cost-conf-${Date.now()}`;

  // Created Product
  let productId: string;
  const initialCost = 35.5;
  const initialSellingPrice = 100.0;
  const productSku = `COST-CONF-${Date.now()}`;

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const timestamp = Date.now();
    ownerEmail = `owner_cost_${timestamp}@bizflow-test.internal`;
    mgrEmail = `mgr_cost_${timestamp}@bizflow-test.internal`;
    cashEmail = `cash_cost_${timestamp}@bizflow-test.internal`;

    // 1. Create Users
    const { data: uOwner } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Cost", last_name: "Owner" },
    });
    ownerUserId = uOwner.user!.id;

    const { data: uMgr } = await adminClient.auth.admin.createUser({
      email: mgrEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Cost", last_name: "Manager" },
    });
    managerUserId = uMgr.user!.id;

    const { data: uCash } = await adminClient.auth.admin.createUser({
      email: cashEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Cost", last_name: "Cashier" },
    });
    cashierUserId = uCash.user!.id;

    // 2. Authenticate clients
    ownerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

    managerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await managerClient.auth.signInWithPassword({ email: mgrEmail, password: testPassword });

    cashierClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await cashierClient.auth.signInWithPassword({ email: cashEmail, password: testPassword });

    // 3. Create Organization and Memberships
    const resOrg = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
       VALUES ('Cost Confidentiality Org', $1, 'USD', 'retail', 'US', 'America/New_York', $2)
       RETURNING id;`,
      [orgSlug, ownerUserId]
    );
    orgId = resOrg.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES 
         ($1, $2, 'owner', 'active'),
         ($1, $3, 'manager', 'active'),
         ($1, $4, 'cashier', 'active');`,
      [orgId, ownerUserId, managerUserId, cashierUserId]
    );

    // 4. Create authoritative product with cost
    const resProd = await ownerClient.rpc("create_product", {
      p_org_id: orgId,
      p_name: "Confidential Cost Item",
      p_sku: productSku,
      p_selling_price: initialSellingPrice,
      p_unit_of_measure: "unit",
      p_cost_price: initialCost,
    });
    if (resProd.error) {
      throw new Error(`Failed to create test product: ${resProd.error.message}`);
    }
    productId = (resProd.data as any).data.id;
  });

  afterAll(async () => {
    try {
      if (orgId) {
        await pgClient.query(`DELETE FROM public.organization_audit_events WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`DELETE FROM public.product_costs WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`DELETE FROM public.products WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`DELETE FROM public.organization_memberships WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`DELETE FROM public.organizations WHERE id = $1`, [orgId]);
      }
    } catch (_) {}

    try {
      if (ownerUserId) await adminClient.auth.admin.deleteUser(ownerUserId);
      if (managerUserId) await adminClient.auth.admin.deleteUser(managerUserId);
      if (cashierUserId) await adminClient.auth.admin.deleteUser(cashierUserId);
    } catch (_) {}

    await pgClient.end();
  });

  // ===========================================================================
  // 1. Direct Table SELECT Confidentiality (FR-038, SC-004)
  // ===========================================================================
  describe("1. Direct Table SELECT Confidentiality on product_costs", () => {
    it("Cashier direct SELECT on product_costs returns 0 rows", async () => {
      const { data, error } = await cashierClient
        .from("product_costs")
        .select("*")
        .eq("organization_id", orgId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("Cashier direct SELECT by product_id on product_costs returns null / 0 rows", async () => {
      const { data, error } = await cashierClient
        .from("product_costs")
        .select("cost_price")
        .eq("product_id", productId)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).toBeNull();
    });

    it("Owner direct SELECT on product_costs returns the cost row", async () => {
      const { data, error } = await ownerClient
        .from("product_costs")
        .select("cost_price")
        .eq("product_id", productId)
        .single();

      expect(error).toBeNull();
      expect(Number(data?.cost_price)).toBe(initialCost);
    });

    it("Manager direct SELECT on product_costs returns the cost row", async () => {
      const { data, error } = await managerClient
        .from("product_costs")
        .select("cost_price")
        .eq("product_id", productId)
        .single();

      expect(error).toBeNull();
      expect(Number(data?.cost_price)).toBe(initialCost);
    });

    it("Cashier direct JOIN query on products with product_costs yields empty cost relation", async () => {
      const { data, error } = await cashierClient
        .from("products")
        .select("id, name, selling_price, cost:product_costs(cost_price)")
        .eq("id", productId)
        .single();

      expect(error).toBeNull();
      expect(data?.id).toBe(productId);
      // Under RLS, joined relation for which user has no SELECT rows produces empty array [] or null
      const costRel = Array.isArray(data?.cost) ? data?.cost[0] : data?.cost;
      expect(costRel).toBeFalsy();
    });
  });

  // ===========================================================================
  // 2. Server Actions Cost Gating & Field Stripping (FR-038, FR-039)
  // ===========================================================================
  describe("2. Server Actions Cost Gating & Field Stripping", () => {
    it("getProductStateAction returns authoritative status and version for Cashier", async () => {
      clearInMemoryCookieJar();
      const serverClient = await createServerClient();
      await serverClient.auth.signInWithPassword({ email: cashEmail, password: testPassword });

      const stateRes = await getProductStateAction(orgSlug, productId);
      expect(stateRes.success).toBe(true);
      if (!stateRes.success) return;
      expect(stateRes.data.id).toBe(productId);
      expect(stateRes.data.status).toBe("active");
      expect(stateRes.data.version).toBe(1);
    });

    it("createProductAction by Cashier is rejected with FORBIDDEN", async () => {
      clearInMemoryCookieJar();
      const serverClient = await createServerClient();
      await serverClient.auth.signInWithPassword({ email: cashEmail, password: testPassword });

      const createRes = await createProductAction(orgSlug, {
        name: "Unauthorized Product Attempt",
        sku: `UNAUTH-CASH-${Date.now()}`,
        selling_price: 20.0,
        unit_of_measure: "unit",
      });

      expect(createRes.success).toBe(false);
      if (createRes.success) return;
      expect(createRes.error.code).toBe("FORBIDDEN");
    });

    it("createProductAction by Cashier attempting to set cost is rejected with FORBIDDEN", async () => {
      clearInMemoryCookieJar();
      const serverClient = await createServerClient();
      await serverClient.auth.signInWithPassword({ email: cashEmail, password: testPassword });

      const createRes = await createProductAction(orgSlug, {
        name: "Unauthorized Cost Attempt",
        sku: `UNAUTH-COST-${Date.now()}`,
        selling_price: 20.0,
        unit_of_measure: "unit",
        cost_price: 10.0,
      });

      expect(createRes.success).toBe(false);
      if (createRes.success) return;
      expect(createRes.error.code).toBe("FORBIDDEN");
    });

    it("updateProductAction by Cashier attempting to modify cost is rejected with FORBIDDEN", async () => {
      clearInMemoryCookieJar();
      const serverClient = await createServerClient();
      await serverClient.auth.signInWithPassword({ email: cashEmail, password: testPassword });

      const updateRes = await updateProductAction(orgSlug, productId, {
        expected_version: 1,
        name: "Confidential Cost Item",
        sku: productSku,
        selling_price: initialSellingPrice,
        unit_of_measure: "unit",
        cost_price: 15.0,
        cost_operation: "set",
      });

      expect(updateRes.success).toBe(false);
      if (updateRes.success) return;
      expect(updateRes.error.code).toBe("FORBIDDEN");
    });

    it("updateProductAction by Owner returns projected cost_price and calculated gross_margin", async () => {
      clearInMemoryCookieJar();
      const serverClient = await createServerClient();
      await serverClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

      const updateRes = await updateProductAction(orgSlug, productId, {
        expected_version: 1,
        name: "Confidential Cost Item Updated",
        sku: productSku,
        selling_price: 100.0,
        unit_of_measure: "unit",
        cost_price: 40.0,
        cost_operation: "set",
      });

      expect(updateRes.success).toBe(true);
      if (!updateRes.success) return;
      expect(updateRes.data.cost_price).toBe(40.0);
      expect(updateRes.data.gross_margin).toBe(60.0); // (100 - 40) / 100 * 100% = 60%
      expect(updateRes.data.version).toBe(2);
    });
  });

  // ===========================================================================
  // 3. Audit Event Plaintext Cost Absence (FR-041, SC-004)
  // ===========================================================================
  describe("3. Audit Event Plaintext Cost Absence", () => {
    it("product_created audit event metadata omits plaintext numeric cost and records boolean cost_set", async () => {
      const resAudit = await pgClient.query(
        `SELECT event_type, metadata
         FROM public.organization_audit_events
         WHERE organization_id = $1 AND event_type = 'product_created'
         ORDER BY created_at DESC
         LIMIT 1;`,
        [orgId]
      );

      expect(resAudit.rows).toHaveLength(1);
      const metadata = resAudit.rows[0].metadata;

      // Assert cost_set is boolean true
      expect(metadata.cost_set).toBe(true);
      // Assert plaintext cost_price is NOT present in metadata
      expect(metadata.cost_price).toBeUndefined();
      expect(metadata.cost).toBeUndefined();

      // Ensure no key or value in the metadata contains the initialCost numeric string "35.5"
      const metaString = JSON.stringify(metadata);
      expect(metaString).not.toContain("35.5");
      expect(metaString).not.toContain(String(initialCost));
    });

    it("product_updated audit event metadata records cost_operation without plaintext cost", async () => {
      const resAudit = await pgClient.query(
        `SELECT event_type, metadata
         FROM public.organization_audit_events
         WHERE organization_id = $1 AND event_type = 'product_updated'
         ORDER BY created_at DESC
         LIMIT 1;`,
        [orgId]
      );

      expect(resAudit.rows).toHaveLength(1);
      const metadata = resAudit.rows[0].metadata;

      // Assert cost_operation is 'set'
      expect(metadata.cost_operation).toBe("set");
      // Assert plaintext cost_price is NOT present in metadata
      expect(metadata.cost_price).toBeUndefined();
      expect(metadata.cost).toBeUndefined();

      // Ensure no key or value in the metadata contains the updated cost "40"
      const metaString = JSON.stringify(metadata);
      expect(metaString).not.toContain('"cost_price"');
      expect(metaString).not.toContain('"cost"');
    });

    it("zero plaintext cost numbers exist across all audit events in organization", async () => {
      const resAllAudits = await pgClient.query(
        `SELECT event_type, metadata
         FROM public.organization_audit_events
         WHERE organization_id = $1;`,
        [orgId]
      );

      expect(resAllAudits.rows.length).toBeGreaterThan(0);
      for (const row of resAllAudits.rows) {
        const meta = row.metadata;
        expect(meta).not.toHaveProperty("cost_price");
        expect(meta).not.toHaveProperty("cost");
        expect(meta).not.toHaveProperty("supplier_cost");
      }
    });
  });
});

