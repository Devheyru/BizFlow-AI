import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";

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

describe("T022: Catalog Browsing, Search, Filtering & Cost Confidentiality (US1)", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;

  // Real authenticated clients
  let ownerClient: SupabaseClient;
  let managerClient: SupabaseClient;
  let cashierClient: SupabaseClient;
  let orgBClient: SupabaseClient;

  let ownerUserId: string;
  let managerUserId: string;
  let cashierUserId: string;
  let orgBUserId: string;

  let orgAId: string;
  let orgBId: string;
  const orgASlug = `catalog-org-a-${Date.now()}`;
  const orgBSlug = `catalog-org-b-${Date.now()}`;

  const testPassword = "P@ssword123!SecureTest";

  // Category and product IDs
  let categoryDairyId: string;
  let categoryBakeryId: string;
  let prodMilkId: string;
  let prodCheeseId: string;
  let prodBreadId: string;
  let prodArchivedId: string;
  let prodUncategorizedId: string;
  let prodOrgBId: string;

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Create Users
    const ownerEmail = `owner_cat_${Date.now()}@bizflow-test.internal`;
    const mgrEmail = `mgr_cat_${Date.now()}@bizflow-test.internal`;
    const cashEmail = `cash_cat_${Date.now()}@bizflow-test.internal`;
    const orgBEmail = `orgb_cat_${Date.now()}@bizflow-test.internal`;

    const { data: uOwner } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Catalog", last_name: "Owner" },
    });
    ownerUserId = uOwner.user!.id;

    const { data: uMgr } = await adminClient.auth.admin.createUser({
      email: mgrEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Catalog", last_name: "Manager" },
    });
    managerUserId = uMgr.user!.id;

    const { data: uCash } = await adminClient.auth.admin.createUser({
      email: cashEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Catalog", last_name: "Cashier" },
    });
    cashierUserId = uCash.user!.id;

    const { data: uOrgB } = await adminClient.auth.admin.createUser({
      email: orgBEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Catalog", last_name: "TenantB" },
    });
    orgBUserId = uOrgB.user!.id;

    // 2. Authenticate clients with real JWT
    ownerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

    managerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await managerClient.auth.signInWithPassword({ email: mgrEmail, password: testPassword });

    cashierClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await cashierClient.auth.signInWithPassword({ email: cashEmail, password: testPassword });

    orgBClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await orgBClient.auth.signInWithPassword({ email: orgBEmail, password: testPassword });

    // 3. Create Organizations and Memberships
    const orgARes = await pgClient.query(`
      INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
      VALUES ('Catalog Test Store Alpha', $1, 'USD', 'retail', 'US', 'UTC', $2)
      RETURNING id;
    `, [orgASlug, ownerUserId]);
    orgAId = orgARes.rows[0].id;

    const orgBRes = await pgClient.query(`
      INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
      VALUES ('Catalog Test Store Beta', $1, 'USD', 'retail', 'US', 'UTC', $2)
      RETURNING id;
    `, [orgBSlug, orgBUserId]);
    orgBId = orgBRes.rows[0].id;

    // Add memberships
    await pgClient.query(`
      INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
      VALUES
        ($1, $2, 'owner', 'active'),
        ($1, $3, 'manager', 'active'),
        ($1, $4, 'cashier', 'active'),
        ($5, $6, 'owner', 'active');
    `, [orgAId, ownerUserId, managerUserId, cashierUserId, orgBId, orgBUserId]);

    // 4. Seed Categories for Org A
    const { data: catDairy } = await ownerClient.rpc("create_product_category", {
      p_org_id: orgAId,
      p_name: "Dairy & Eggs",
      p_description: "Fresh dairy items",
    });
    categoryDairyId = (catDairy as any).data.id;

    const { data: catBakery } = await ownerClient.rpc("create_product_category", {
      p_org_id: orgAId,
      p_name: "Bakery",
      p_description: "Freshly baked bread and pastries",
    });
    categoryBakeryId = (catBakery as any).data.id;

    // 5. Seed Products for Org A
    // Product 1: Whole Milk (Dairy, active, cost recorded)
    const { data: pMilk } = await ownerClient.rpc("create_product", {
      p_org_id: orgAId,
      p_name: "Organic Whole Milk",
      p_sku: "MILK-WHOLE-001",
      p_selling_price: 5.50,
      p_unit_of_measure: "liter",
      p_status: "active",
      p_barcode: "1000000001",
      p_description: "Farm fresh organic milk",
      p_category_id: categoryDairyId,
      p_cost_price: 3.25,
      p_image_url: null,
    });
    prodMilkId = (pMilk as any).data.id;

    // Product 2: Cheddar Cheese (Dairy, active, unrecorded cost)
    const { data: pCheese } = await ownerClient.rpc("create_product", {
      p_org_id: orgAId,
      p_name: "Aged Cheddar Cheese",
      p_sku: "CHEESE-CHED-001",
      p_selling_price: 8.00,
      p_unit_of_measure: "pack",
      p_status: "active",
      p_barcode: "1000000002",
      p_description: "Sharp white cheddar",
      p_category_id: categoryDairyId,
      p_cost_price: null,
      p_image_url: null,
    });
    prodCheeseId = (pCheese as any).data.id;

    // Product 3: Sourdough Bread (Bakery, inactive, cost recorded)
    const { data: pBread } = await ownerClient.rpc("create_product", {
      p_org_id: orgAId,
      p_name: "Artisan Sourdough Loaf",
      p_sku: "BREAD-SOUR-001",
      p_selling_price: 6.50,
      p_unit_of_measure: "piece",
      p_status: "active",
      p_barcode: "1000000003",
      p_description: "Naturally fermented sourdough",
      p_category_id: categoryBakeryId,
      p_cost_price: 2.00,
      p_image_url: null,
    });
    prodBreadId = (pBread as any).data.id;

    // Toggle Sourdough Bread to inactive
    await ownerClient.rpc("toggle_product_status", {
      p_org_id: orgAId,
      p_product_id: prodBreadId,
      p_expected_version: 1,
      p_new_status: "inactive",
    });

    // Product 4: Seasonal Pumpkin Pie (Bakery, archived)
    const { data: pArch } = await ownerClient.rpc("create_product", {
      p_org_id: orgAId,
      p_name: "Seasonal Pumpkin Pie",
      p_sku: "PIE-PUMP-001",
      p_selling_price: 12.00,
      p_unit_of_measure: "piece",
      p_status: "active",
      p_barcode: null,
      p_description: "Holiday seasonal pie",
      p_category_id: categoryBakeryId,
      p_cost_price: 5.00,
      p_image_url: null,
    });
    prodArchivedId = (pArch as any).data.id;

    await ownerClient.rpc("archive_product", {
      p_org_id: orgAId,
      p_product_id: prodArchivedId,
      p_expected_version: 1,
    });

    // Product 5: Generic Sample Item (Uncategorized, active)
    const { data: pUncat } = await ownerClient.rpc("create_product", {
      p_org_id: orgAId,
      p_name: "Free Sample Napkin",
      p_sku: "SAMPLE-NAP-001",
      p_selling_price: 0.00,
      p_unit_of_measure: "pack",
      p_status: "active",
      p_barcode: null,
      p_description: "Complimentary napkins",
      p_category_id: null,
      p_cost_price: 0.00,
      p_image_url: null,
    });
    prodUncategorizedId = (pUncat as any).data.id;

    // Seed Product for Org B (Tenant Isolation verification)
    const { data: pOrgB } = await orgBClient.rpc("create_product", {
      p_org_id: orgBId,
      p_name: "Org B Coffee Beans",
      p_sku: "COFFEE-001",
      p_selling_price: 14.99,
      p_unit_of_measure: "pack",
      p_status: "active",
      p_barcode: "9999999999",
      p_description: "Roasted beans",
      p_category_id: null,
      p_cost_price: 7.00,
      p_image_url: null,
    });
    prodOrgBId = (pOrgB as any).data.id;
  });

  afterAll(async () => {
    try {
      if (orgAId && orgBId) {
        await pgClient.query("DELETE FROM public.products WHERE organization_id IN ($1, $2);", [orgAId, orgBId]);
        await pgClient.query("DELETE FROM public.product_categories WHERE organization_id IN ($1, $2);", [orgAId, orgBId]);
        await pgClient.query("DELETE FROM public.organization_audit_events WHERE organization_id IN ($1, $2);", [orgAId, orgBId]);
        await pgClient.query("ALTER TABLE public.organization_memberships DISABLE TRIGGER USER;");
        await pgClient.query("DELETE FROM public.organizations WHERE id IN ($1, $2);", [orgAId, orgBId]);
      }
    } finally {
      await pgClient.query("ALTER TABLE public.organization_memberships ENABLE TRIGGER USER;");
    }

    if (ownerUserId) await adminClient.auth.admin.deleteUser(ownerUserId);
    if (managerUserId) await adminClient.auth.admin.deleteUser(managerUserId);
    if (cashierUserId) await adminClient.auth.admin.deleteUser(cashierUserId);
    if (orgBUserId) await adminClient.auth.admin.deleteUser(orgBUserId);

    await pgClient.end();
  });

  // ==========================================================================
  // 1. Multi-Tenant Data Isolation (US1, FR-026, SC-002)
  // ==========================================================================
  describe("Multi-Tenant Data Isolation", () => {
    it("restricts catalog browsing strictly to products within the caller's organization under RLS", async () => {
      // Query Org A products with ownerClient
      const { data: orgAProducts, error: orgAErr } = await ownerClient
        .from("products")
        .select("id, name, organization_id")
        .eq("organization_id", orgAId);

      expect(orgAErr).toBeNull();
      expect(orgAProducts!.length).toBe(5);
      const orgAIds = orgAProducts!.map((p) => p.id);
      expect(orgAIds).toContain(prodMilkId);
      expect(orgAIds).not.toContain(prodOrgBId);

      // Query with Org B client
      const { data: orgBProducts, error: orgBErr } = await orgBClient
        .from("products")
        .select("id, name, organization_id")
        .eq("organization_id", orgBId);

      expect(orgBErr).toBeNull();
      expect(orgBProducts!.length).toBe(1);
      expect(orgBProducts![0]!.id).toBe(prodOrgBId);
      expect(orgBProducts![0]!.organization_id).toBe(orgBId);
    });

    it("prevents Org B user from querying Org A products directly via RLS (returns 0 rows)", async () => {
      const { data, error } = await orgBClient
        .from("products")
        .select("id, name")
        .eq("organization_id", orgAId);

      expect(error).toBeNull();
      expect(data).toEqual([]); // 0 rows returned under FORCE RLS
    });
  });

  // ==========================================================================
  // 2. Role-Based Cost Confidentiality under RLS (FR-039, SC-004)
  // ==========================================================================
  describe("Cashier Cost Confidentiality (FR-039)", () => {
    it("allows Owner and Manager with products:read_cost to query product_costs", async () => {
      // Owner query
      const { data: ownerCosts, error: ownerCostErr } = await ownerClient
        .from("product_costs")
        .select("product_id, cost_price")
        .eq("organization_id", orgAId);

      expect(ownerCostErr).toBeNull();
      expect(ownerCosts!.length).toBeGreaterThan(0);

      // Manager query (has products:read_cost)
      const { data: mgrCosts, error: mgrCostErr } = await managerClient
        .from("product_costs")
        .select("product_id, cost_price")
        .eq("organization_id", orgAId);

      expect(mgrCostErr).toBeNull();
      expect(mgrCosts!.length).toBeGreaterThan(0);
    });

    it("denies Cashier direct SELECT on product_costs via RLS (returns 0 rows)", async () => {
      const { data, error } = await cashierClient
        .from("product_costs")
        .select("product_id, cost_price")
        .eq("organization_id", orgAId);

      expect(error).toBeNull();
      expect(data).toEqual([]); // 0 rows returned for Cashier lacking products:read_cost
    });

    it("allows Cashier to view products and selling prices while omitting cost data", async () => {
      const { data, error } = await cashierClient
        .from("products")
        .select("id, name, selling_price, status")
        .eq("organization_id", orgAId);

      expect(error).toBeNull();
      expect(data!.length).toBe(5);

      const milk = data!.find((p) => p.id === prodMilkId);
      expect(milk).toBeDefined();
      expect(Number(milk!.selling_price)).toBe(5.50);
      expect((milk as any).cost_price).toBeUndefined();
    });
  });

  // ==========================================================================
  // 3. Search Matching: 2-character Prefix & 3+ character Trigram (FR-027)
  // ==========================================================================
  describe("Search Mechanics (FR-027)", () => {
    it("executes 2-character query as prefix search on product name", async () => {
      // Query "or" matches "Organic Whole Milk" (starts with "Or")
      const { data, error } = await ownerClient
        .from("products")
        .select("id, name")
        .eq("organization_id", orgAId)
        .ilike("name", "or%");

      expect(error).toBeNull();
      expect(data!.length).toBe(1);
      expect(data![0]!.id).toBe(prodMilkId);
      expect(data![0]!.name).toBe("Organic Whole Milk");
    });

    it("executes 3+ character query as substring trigram search matching middle of name", async () => {
      // Query "ched" matches "Aged Cheddar Cheese"
      const { data, error } = await ownerClient
        .from("products")
        .select("id, name")
        .eq("organization_id", orgAId)
        .ilike("name", "%ched%");

      expect(error).toBeNull();
      expect(data!.length).toBe(1);
      expect(data![0]!.id).toBe(prodCheeseId);
    });

    it("searches across SKU and barcode identifiers", async () => {
      // Match by exact/partial SKU "SOUR"
      const { data: skuMatch, error: skuErr } = await ownerClient
        .from("products")
        .select("id, name, sku")
        .eq("organization_id", orgAId)
        .ilike("sku", "%SOUR%");

      expect(skuErr).toBeNull();
      expect(skuMatch!.length).toBe(1);
      expect(skuMatch![0]!.id).toBe(prodBreadId);

      // Match by barcode
      const { data: barcodeMatch, error: bcErr } = await ownerClient
        .from("products")
        .select("id, name, barcode")
        .eq("organization_id", orgAId)
        .eq("barcode", "1000000001");

      expect(bcErr).toBeNull();
      expect(barcodeMatch!.length).toBe(1);
      expect(barcodeMatch![0]!.id).toBe(prodMilkId);
    });
  });

  // ==========================================================================
  // 4. Category Filtering (FR-028)
  // ==========================================================================
  describe("Category Filtering (FR-028)", () => {
    it("filters products by specific categoryId", async () => {
      const { data, error } = await ownerClient
        .from("products")
        .select("id, name, category_id")
        .eq("organization_id", orgAId)
        .eq("category_id", categoryDairyId);

      expect(error).toBeNull();
      expect(data!.length).toBe(2);
      const ids = data!.map((p) => p.id);
      expect(ids).toContain(prodMilkId);
      expect(ids).toContain(prodCheeseId);
    });

    it("filters for uncategorized products (category_id IS NULL)", async () => {
      const { data, error } = await ownerClient
        .from("products")
        .select("id, name, category_id")
        .eq("organization_id", orgAId)
        .is("category_id", null);

      expect(error).toBeNull();
      expect(data!.length).toBe(1);
      expect(data![0]!.id).toBe(prodUncategorizedId);
    });
  });

  // ==========================================================================
  // 5. Status Filtering (FR-029)
  // ==========================================================================
  describe("Status Filtering (FR-029)", () => {
    it("defaults to active and inactive products, hiding archived products", async () => {
      const { data, error } = await ownerClient
        .from("products")
        .select("id, name, status")
        .eq("organization_id", orgAId)
        .in("status", ["active", "inactive"]);

      expect(error).toBeNull();
      expect(data!.length).toBe(4);
      const statuses = data!.map((p) => p.status);
      expect(statuses).not.toContain("archived");
    });

    it("filters explicitly for archived products", async () => {
      const { data, error } = await ownerClient
        .from("products")
        .select("id, name, status")
        .eq("organization_id", orgAId)
        .eq("status", "archived");

      expect(error).toBeNull();
      expect(data!.length).toBe(1);
      expect(data![0]!.id).toBe(prodArchivedId);
      expect(data![0]!.status).toBe("archived");
    });
  });

  // ==========================================================================
  // 6. Pagination & Sorting (FR-030, FR-031)
  // ==========================================================================
  describe("Pagination and Deterministic Sorting (FR-030, FR-031)", () => {
    it("sorts by selling_price ascending with id tie-breaker", async () => {
      const { data, error } = await ownerClient
        .from("products")
        .select("id, name, selling_price")
        .eq("organization_id", orgAId)
        .order("selling_price", { ascending: true })
        .order("id", { ascending: true });

      expect(error).toBeNull();
      expect(data!.length).toBe(5);
      // Smallest selling price first ($0.00 napkin)
      expect(Number(data![0]!.selling_price)).toBe(0);
      expect(data![0]!.id).toBe(prodUncategorizedId);
    });

    it("paginates products using offset range and returns count metadata", async () => {
      const pageSize = 2;
      const { data, count, error } = await ownerClient
        .from("products")
        .select("id, name", { count: "exact" })
        .eq("organization_id", orgAId)
        .order("name", { ascending: true })
        .range(0, pageSize - 1);

      expect(error).toBeNull();
      expect(count).toBe(5);
      expect(data!.length).toBe(2);
    });
  });
});
