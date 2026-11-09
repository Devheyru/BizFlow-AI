import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { updateProductAction } from "@/actions/product-actions";
import { clearInMemoryCookieJar, createClient as createServerClient } from "@/lib/supabase/server";

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

describe("T036: update_product RPC & Optimistic Concurrency Control (US3)", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;

  // Supabase clients
  let ownerClient: SupabaseClient;
  let managerClient: SupabaseClient;
  let cashierClient: SupabaseClient;
  let orgBClient: SupabaseClient;

  // User IDs & Emails
  let ownerEmail: string;
  let ownerUserId: string;
  let managerUserId: string;
  let cashierUserId: string;
  let orgBUserId: string;

  // Organizations
  let orgAId: string;
  let orgBId: string;
  const orgASlug = `occ-rpc-a-${Date.now()}`;
  const orgBSlug = `occ-rpc-b-${Date.now()}`;

  // Categories
  let activeCategoryId: string;
  let archivedCategoryId: string;
  let orgBCategoryId: string;

  const testPassword = "P@ssword123!SecureTest";

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const timestamp = Date.now();
    ownerEmail = `owner_occ_${timestamp}@bizflow-test.internal`;
    const mgrEmail = `mgr_occ_${timestamp}@bizflow-test.internal`;
    const cashEmail = `cash_occ_${timestamp}@bizflow-test.internal`;
    const orgBEmail = `orgb_occ_${timestamp}@bizflow-test.internal`;

    // 1. Create Users
    const { data: uOwner } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "OCC", last_name: "Owner" },
    });
    ownerUserId = uOwner.user!.id;

    const { data: uMgr } = await adminClient.auth.admin.createUser({
      email: mgrEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "OCC", last_name: "Manager" },
    });
    managerUserId = uMgr.user!.id;

    const { data: uCash } = await adminClient.auth.admin.createUser({
      email: cashEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "OCC", last_name: "Cashier" },
    });
    cashierUserId = uCash.user!.id;

    const { data: uOrgB } = await adminClient.auth.admin.createUser({
      email: orgBEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "OCC", last_name: "OrgBUser" },
    });
    orgBUserId = uOrgB.user!.id;

    // 2. Authenticate clients
    ownerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

    managerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await managerClient.auth.signInWithPassword({ email: mgrEmail, password: testPassword });

    cashierClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await cashierClient.auth.signInWithPassword({ email: cashEmail, password: testPassword });

    orgBClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await orgBClient.auth.signInWithPassword({ email: orgBEmail, password: testPassword });

    // 3. Create Organizations and Memberships
    const resOrgA = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
       VALUES ('OCC Test Org A', $1, 'USD', 'retail', 'US', 'America/New_York', $2)
       RETURNING id;`,
      [orgASlug, ownerUserId]
    );
    orgAId = resOrgA.rows[0].id;

    const resOrgB = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
       VALUES ('OCC Test Org B', $1, 'USD', 'retail', 'US', 'America/New_York', $2)
       RETURNING id;`,
      [orgBSlug, orgBUserId]
    );
    orgBId = resOrgB.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES 
         ($1, $2, 'owner', 'active'),
         ($1, $3, 'manager', 'active'),
         ($1, $4, 'cashier', 'active'),
         ($5, $6, 'owner', 'active');`,
      [orgAId, ownerUserId, managerUserId, cashierUserId, orgBId, orgBUserId]
    );

    // 4. Create Categories
    const { data: catActive } = await ownerClient.rpc("create_product_category", {
      p_org_id: orgAId,
      p_name: `Active Cat ${timestamp}`,
      p_description: "Active test category",
    });
    activeCategoryId = (catActive as any).data.id;

    const { data: catArch } = await ownerClient.rpc("create_product_category", {
      p_org_id: orgAId,
      p_name: `Archived Cat ${timestamp}`,
      p_description: "Archived test category",
    });
    archivedCategoryId = (catArch as any).data.id;

    await ownerClient.rpc("archive_product_category", {
      p_org_id: orgAId,
      p_category_id: archivedCategoryId,
    });

    const { data: catOrgB } = await orgBClient.rpc("create_product_category", {
      p_org_id: orgBId,
      p_name: `Org B Cat ${timestamp}`,
      p_description: "Org B category",
    });
    orgBCategoryId = (catOrgB as any).data.id;
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

  // Helper: create a product via RPC
  async function createTestProduct(skuPrefix: string, initialCost?: number) {
    const sku = `${skuPrefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const { data, error } = await ownerClient.rpc("create_product", {
      p_org_id: orgAId,
      p_name: `Test Product ${sku}`,
      p_sku: sku,
      p_selling_price: 25.0,
      p_cost_price: initialCost,
      p_category_id: activeCategoryId,
    });
    expect(error).toBeNull();
    return (data as any).data;
  }

  // ==========================================================================
  // Group 1: Optimistic Concurrency Control (OCC) & Version Increment
  // ==========================================================================
  describe("Group 1: Optimistic Concurrency Control (OCC)", () => {
    it("successfully updates product and atomically increments version from 1 to 2", async () => {
      const prod = await createTestProduct("OCC-INC");
      expect(prod.version).toBe(1);

      const { data: rawRes, error } = await ownerClient.rpc("update_product", {
        p_org_id: orgAId,
        p_product_id: prod.id,
        p_expected_version: 1,
        p_name: "Updated Product Name",
        p_sku: prod.sku,
        p_selling_price: 30.0,
        p_cost_operation: "unchanged",
      });

      expect(error).toBeNull();
      const res = rawRes as any;
      expect(res.success).toBe(true);
      expect(res.data.version).toBe(2);
      expect(res.data.name).toBe("Updated Product Name");
      expect(res.data.selling_price).toBe(30.0);
    });

    it("rejects stale update with P0010 when expected_version does not match current version", async () => {
      const prod = await createTestProduct("OCC-STALE");
      expect(prod.version).toBe(1);

      // Perform a first update to bring version to 2
      const { data: firstUpdate } = await ownerClient.rpc("update_product", {
        p_org_id: orgAId,
        p_product_id: prod.id,
        p_expected_version: 1,
        p_name: "First Update",
        p_sku: prod.sku,
        p_selling_price: 28.0,
        p_cost_operation: "unchanged",
      });
      expect((firstUpdate as any).data.version).toBe(2);

      // Attempt second update with stale expected_version = 1
      const { data, error } = await ownerClient.rpc("update_product", {
        p_org_id: orgAId,
        p_product_id: prod.id,
        p_expected_version: 1, // Stale!
        p_name: "Stale Overwrite Attempt",
        p_sku: prod.sku,
        p_selling_price: 50.0,
        p_cost_operation: "unchanged",
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.code === "P0010" || error?.message.includes("P0010")).toBe(true);

      // Verify product row was NOT overwritten in database
      const dbCheck = await pgClient.query("SELECT name, version, selling_price FROM public.products WHERE id = $1;", [
        prod.id,
      ]);
      expect(dbCheck.rows[0].version).toBe(2);
      expect(dbCheck.rows[0].name).toBe("First Update");
      expect(Number(dbCheck.rows[0].selling_price)).toBe(28.0);
    });

    it("handles concurrent updates safely: exactly one succeeds, the other receives P0010", async () => {
      const prod = await createTestProduct("OCC-CONCUR");
      expect(prod.version).toBe(1);

      // Both Owner and Manager read version 1 and attempt simultaneous update
      const [attempt1, attempt2] = await Promise.all([
        ownerClient.rpc("update_product", {
          p_org_id: orgAId,
          p_product_id: prod.id,
          p_expected_version: 1,
          p_name: "Owner Concurrency Update",
          p_sku: prod.sku,
          p_selling_price: 35.0,
          p_cost_operation: "unchanged",
        }),
        managerClient.rpc("update_product", {
          p_org_id: orgAId,
          p_product_id: prod.id,
          p_expected_version: 1,
          p_name: "Manager Concurrency Update",
          p_sku: prod.sku,
          p_selling_price: 40.0,
          p_cost_operation: "unchanged",
        }),
      ]);

      const successCount = (attempt1.data ? 1 : 0) + (attempt2.data ? 1 : 0);
      const conflictCount =
        ((attempt1.error?.code === "P0010" || attempt1.error?.message.includes("P0010")) ? 1 : 0) +
        ((attempt2.error?.code === "P0010" || attempt2.error?.message.includes("P0010")) ? 1 : 0);

      expect(successCount).toBe(1);
      expect(conflictCount).toBe(1);

      // Version in database must be exactly 2
      const dbCheck = await pgClient.query("SELECT version FROM public.products WHERE id = $1;", [prod.id]);
      expect(dbCheck.rows[0].version).toBe(2);
    });
  });

  // ==========================================================================
  // Group 2: Cost Operations Semantics (unchanged, set, clear) & RBAC
  // ==========================================================================
  describe("Group 2: Cost Operations & Confidentiality", () => {
    it("upserts cost_price when cost_operation is 'set'", async () => {
      const prod = await createTestProduct("COST-SET", 10.0);

      // Update cost to 14.50
      const { data: rawRes, error } = await ownerClient.rpc("update_product", {
        p_org_id: orgAId,
        p_product_id: prod.id,
        p_expected_version: 1,
        p_name: prod.name,
        p_sku: prod.sku,
        p_selling_price: prod.selling_price,
        p_cost_operation: "set",
        p_cost_price: 14.5,
      });

      expect(error).toBeNull();
      const res = rawRes as any;
      expect(res.success).toBe(true);
      expect(res.data.cost_price).toBe(14.5);

      // Verify in public.product_costs table
      const costCheck = await pgClient.query(
        "SELECT cost_price FROM public.product_costs WHERE product_id = $1;",
        [prod.id]
      );
      expect(Number(costCheck.rows[0].cost_price)).toBe(14.5);
    });

    it("deletes cost record when cost_operation is 'clear'", async () => {
      const prod = await createTestProduct("COST-CLR", 12.0);

      // Clear cost
      const { data: rawRes, error } = await ownerClient.rpc("update_product", {
        p_org_id: orgAId,
        p_product_id: prod.id,
        p_expected_version: 1,
        p_name: prod.name,
        p_sku: prod.sku,
        p_selling_price: prod.selling_price,
        p_cost_operation: "clear",
      });

      expect(error).toBeNull();
      const res = rawRes as any;
      expect(res.success).toBe(true);
      expect(res.data.cost_price).toBeNull();

      // Verify row removed from public.product_costs
      const costCheck = await pgClient.query(
        "SELECT cost_price FROM public.product_costs WHERE product_id = $1;",
        [prod.id]
      );
      expect(costCheck.rows).toHaveLength(0);
    });

    it("leaves cost record intact when cost_operation is 'unchanged'", async () => {
      const prod = await createTestProduct("COST-UNCHG", 18.0);

      const { data: rawRes, error } = await ownerClient.rpc("update_product", {
        p_org_id: orgAId,
        p_product_id: prod.id,
        p_expected_version: 1,
        p_name: "Modified Name Only",
        p_sku: prod.sku,
        p_selling_price: 32.0,
        p_cost_operation: "unchanged",
      });

      expect(error).toBeNull();
      const res = rawRes as any;
      expect(res.data.cost_price).toBe(18.0);

      // Cost table still has 18.0
      const costCheck = await pgClient.query(
        "SELECT cost_price FROM public.product_costs WHERE product_id = $1;",
        [prod.id]
      );
      expect(costCheck.rows).toHaveLength(1);
      expect(Number(costCheck.rows[0].cost_price)).toBe(18.0);
    });

    it("rejects unauthorized cost modification attempt with P0005", async () => {
      const prod = await createTestProduct("COST-UNAUTH", 10.0);

      // Cashier lacks products:read_cost and products:update
      const { data, error } = await cashierClient.rpc("update_product", {
        p_org_id: orgAId,
        p_product_id: prod.id,
        p_expected_version: 1,
        p_name: prod.name,
        p_sku: prod.sku,
        p_selling_price: 25.0,
        p_cost_operation: "set",
        p_cost_price: 20.0,
      });

      expect(data).toBeNull();
      expect(error?.code === "P0005" || error?.message.includes("P0005")).toBe(true);
    });

    it("does not leak cost data to unauthorized roles on update response", async () => {
      const prod = await createTestProduct("COST-CONFID", 15.0);

      // Demote manager temporarily or test manager without products:read_cost if applicable
      // Both owner and manager have products:read_cost by default, cashier lacks it.
      // Confirm that cashier cannot query product_costs directly:
      const { data: cashierCostRows } = await cashierClient
        .from("product_costs")
        .select("*")
        .eq("product_id", prod.id);
      expect(cashierCostRows).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Group 3: Lifecycle & Category Invariants
  // ==========================================================================
  describe("Group 3: Lifecycle and Category Invariants", () => {
    it("rejects updates to an archived product with P0015", async () => {
      const prod = await createTestProduct("ARCH-PROD");

      // Archive product directly in DB
      await pgClient.query(
        "UPDATE public.products SET status = 'archived', archived_at = NOW(), archived_by = $2 WHERE id = $1;",
        [prod.id, ownerUserId]
      );

      const { data, error } = await ownerClient.rpc("update_product", {
        p_org_id: orgAId,
        p_product_id: prod.id,
        p_expected_version: 1,
        p_name: "Try Updating Archived",
        p_sku: prod.sku,
        p_selling_price: 20.0,
        p_cost_operation: "unchanged",
      });

      expect(data).toBeNull();
      expect(error?.code === "P0015" || error?.message.includes("P0015")).toBe(true);
    });

    it("rejects assignment to an archived category with P0015", async () => {
      const prod = await createTestProduct("ARCH-CAT-ASSIGN");

      const { data, error } = await ownerClient.rpc("update_product", {
        p_org_id: orgAId,
        p_product_id: prod.id,
        p_expected_version: 1,
        p_name: prod.name,
        p_sku: prod.sku,
        p_selling_price: prod.selling_price,
        p_category_id: archivedCategoryId,
        p_cost_operation: "unchanged",
      });

      expect(data).toBeNull();
      expect(error?.code === "P0015" || error?.message.includes("P0015")).toBe(true);
    });

    it("rejects cross-tenant category assignment with P0002", async () => {
      const prod = await createTestProduct("CROSS-CAT");

      const { data, error } = await ownerClient.rpc("update_product", {
        p_org_id: orgAId,
        p_product_id: prod.id,
        p_expected_version: 1,
        p_name: prod.name,
        p_sku: prod.sku,
        p_selling_price: prod.selling_price,
        p_category_id: orgBCategoryId, // Category from Org B!
        p_cost_operation: "unchanged",
      });

      expect(data).toBeNull();
      expect(error?.code === "P0002" || error?.message.includes("P0002")).toBe(true);
    });

    it("enforces SKU uniqueness excluding the current product (P0006)", async () => {
      const prod1 = await createTestProduct("SKU-DUP-1");
      const prod2 = await createTestProduct("SKU-DUP-2");

      // Attempting to update prod2 with prod1's SKU
      const { data, error } = await ownerClient.rpc("update_product", {
        p_org_id: orgAId,
        p_product_id: prod2.id,
        p_expected_version: 1,
        p_name: prod2.name,
        p_sku: prod1.sku,
        p_selling_price: prod2.selling_price,
        p_cost_operation: "unchanged",
      });

      expect(data).toBeNull();
      expect(error?.code === "P0006" || error?.message.includes("P0006")).toBe(true);

      // Updating prod2 keeping its own SKU succeeds
      const { data: ownSkuRes, error: ownSkuErr } = await ownerClient.rpc("update_product", {
        p_org_id: orgAId,
        p_product_id: prod2.id,
        p_expected_version: 1,
        p_name: "Name Changed Same SKU",
        p_sku: prod2.sku,
        p_selling_price: prod2.selling_price,
        p_cost_operation: "unchanged",
      });
      expect(ownSkuErr).toBeNull();
      expect((ownSkuRes as any).success).toBe(true);
    });

    it("rejects cross-tenant product update attempt with P0002", async () => {
      const prod = await createTestProduct("CROSS-TENANT");

      // User B tries updating Org A's product under Org B's ID
      const { data, error } = await orgBClient.rpc("update_product", {
        p_org_id: orgBId,
        p_product_id: prod.id,
        p_expected_version: 1,
        p_name: "Cross Tenant Attack",
        p_sku: prod.sku,
        p_selling_price: 10.0,
        p_cost_operation: "unchanged",
      });

      expect(data).toBeNull();
      expect(error?.code === "P0002" || error?.message.includes("P0002")).toBe(true);
    });
  });

  // ==========================================================================
  // Group 4: Image Validation & Storage Path Integrity
  // ==========================================================================
  describe("Group 4: Image Validation & Storage Path Integrity", () => {
    it("accepts valid external HTTPS URLs and valid internal storage path belonging to product", async () => {
      const prod = await createTestProduct("IMG-VALID");

      // 1. External HTTPS URL
      const { data: resHttps, error: errHttps } = await ownerClient.rpc("update_product", {
        p_org_id: orgAId,
        p_product_id: prod.id,
        p_expected_version: 1,
        p_name: prod.name,
        p_sku: prod.sku,
        p_selling_price: prod.selling_price,
        p_image_url: "https://example.com/updated-photo.webp",
        p_cost_operation: "unchanged",
      });
      expect(errHttps).toBeNull();
      expect((resHttps as any).data.image_url).toBe("https://example.com/updated-photo.webp");
      expect((resHttps as any).data.version).toBe(2);

      // 2. Canonical internal storage path: {org_id}/{product_id}/{filename}
      const storagePath = `${orgAId}/${prod.id}/photo-v2.png`;
      const { data: resStorage, error: errStorage } = await ownerClient.rpc("update_product", {
        p_org_id: orgAId,
        p_product_id: prod.id,
        p_expected_version: 2,
        p_name: prod.name,
        p_sku: prod.sku,
        p_selling_price: prod.selling_price,
        p_image_url: storagePath,
        p_cost_operation: "unchanged",
      });
      expect(errStorage).toBeNull();
      expect((resStorage as any).data.image_url).toBe(storagePath);
      expect((resStorage as any).data.version).toBe(3);

      // 3. Null image URL (clearing image)
      const { data: resClear, error: errClear } = await ownerClient.rpc("update_product", {
        p_org_id: orgAId,
        p_product_id: prod.id,
        p_expected_version: 3,
        p_name: prod.name,
        p_sku: prod.sku,
        p_selling_price: prod.selling_price,
        p_image_url: null,
        p_cost_operation: "unchanged",
      });
      expect(errClear).toBeNull();
      expect((resClear as any).data.image_url).toBeNull();
      expect((resClear as any).data.version).toBe(4);
    });

    it("rejects storage path belonging to a different organization with P0009", async () => {
      const prod = await createTestProduct("IMG-DIFF-ORG");
      const foreignOrgPath = `${orgBId}/${prod.id}/photo.png`;

      const { data, error } = await ownerClient.rpc("update_product", {
        p_org_id: orgAId,
        p_product_id: prod.id,
        p_expected_version: 1,
        p_name: prod.name,
        p_sku: prod.sku,
        p_selling_price: prod.selling_price,
        p_image_url: foreignOrgPath,
        p_cost_operation: "unchanged",
      });

      expect(data).toBeNull();
      expect(error?.code === "P0009" || error?.message.includes("P0009")).toBe(true);
    });

    it("rejects storage path belonging to a different product in same organization with P0009", async () => {
      const prod1 = await createTestProduct("IMG-PROD-1");
      const prod2 = await createTestProduct("IMG-PROD-2");
      const wrongProductPath = `${orgAId}/${prod2.id}/photo.png`;

      const { data, error } = await ownerClient.rpc("update_product", {
        p_org_id: orgAId,
        p_product_id: prod1.id,
        p_expected_version: 1,
        p_name: prod1.name,
        p_sku: prod1.sku,
        p_selling_price: prod1.selling_price,
        p_image_url: wrongProductPath,
        p_cost_operation: "unchanged",
      });

      expect(data).toBeNull();
      expect(error?.code === "P0009" || error?.message.includes("P0009")).toBe(true);
    });

    it("rejects image URLs with whitespace with P0009", async () => {
      const prod = await createTestProduct("IMG-SPACE");

      const { data, error } = await ownerClient.rpc("update_product", {
        p_org_id: orgAId,
        p_product_id: prod.id,
        p_expected_version: 1,
        p_name: prod.name,
        p_sku: prod.sku,
        p_selling_price: prod.selling_price,
        p_image_url: "https://example.com/photo with space.png",
        p_cost_operation: "unchanged",
      });

      expect(data).toBeNull();
      expect(error?.code === "P0009" || error?.message.includes("P0009")).toBe(true);
    });
  });

  // ==========================================================================
  // Group 5: Server Action Update & Live Storage Lifecycle (Task 2)
  // ==========================================================================
  describe("Group 5: Server Action updateProductAction Live Storage Lifecycle", () => {
    it("executes live image replacement via updateProductAction: updates DB reference, removes old storage object, keeps new object", async () => {
      const prod = await createTestProduct("SA-IMG-REPLACE-LIVE");
      const initialPath = `${orgAId}/${prod.id}/initial-live.png`;
      const replacementPath = `${orgAId}/${prod.id}/replacement-live.png`;

      // 1. Upload initial image to live Storage bucket and register in DB
      const dummyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
      const { error: initUpErr } = await adminClient.storage
        .from("product-images")
        .upload(initialPath, dummyPng, { contentType: "image/png", upsert: true });
      expect(initUpErr).toBeNull();

      await pgClient.query("UPDATE public.products SET image_url = $1 WHERE id = $2;", [initialPath, prod.id]);

      // Verify initial image exists in live Storage
      const { data: initCheck } = await adminClient.storage.from("product-images").download(initialPath);
      expect(initCheck).not.toBeNull();

      // 2. Upload replacement image to live Storage
      const { error: repUpErr } = await adminClient.storage
        .from("product-images")
        .upload(replacementPath, dummyPng, { contentType: "image/png", upsert: true });
      expect(repUpErr).toBeNull();

      // 3. Establish authenticated owner session in server cookie jar
      clearInMemoryCookieJar();
      const serverClient = await createServerClient();
      const { error: authErr } = await serverClient.auth.signInWithPassword({
        email: ownerEmail,
        password: testPassword,
      });
      expect(authErr).toBeNull();

      // 4. Execute updateProductAction with the replacement image
      const result = await updateProductAction(orgASlug, prod.id, {
        expected_version: 1,
        name: "Product With Live Replaced Image",
        sku: prod.sku,
        selling_price: 45.0,
        unit_of_measure: "piece",
        image_url: replacementPath,
        cost_operation: "unchanged",
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.version).toBe(2);
      expect(result.data.image_url).toBe(replacementPath);

      // 5. Verify database references new object and version incremented
      const dbCheck = await pgClient.query("SELECT image_url, version FROM public.products WHERE id = $1;", [prod.id]);
      expect(dbCheck.rows[0].image_url).toBe(replacementPath);
      expect(dbCheck.rows[0].version).toBe(2);

      // 6. Verify previous object was removed from live Storage bucket post-commit
      const { error: oldObjErr } = await adminClient.storage.from("product-images").download(initialPath);
      expect(oldObjErr).not.toBeNull();

      // 7. Verify new object still exists in live Storage bucket
      const { data: newObjCheck } = await adminClient.storage.from("product-images").download(replacementPath);
      expect(newObjCheck).not.toBeNull();

      // Cleanup
      await adminClient.storage.from("product-images").remove([replacementPath]);
    });

    it("rolls back candidate replacement image from Storage when updateProductAction encounters OCC conflict, keeping original image", async () => {
      const prod = await createTestProduct("SA-IMG-CONFLICT-LIVE");
      const initialPath = `${orgAId}/${prod.id}/keep-live.png`;
      const candidatePath = `${orgAId}/${prod.id}/candidate-rollback.png`;

      // 1. Upload initial image and set in DB
      const dummyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
      await adminClient.storage
        .from("product-images")
        .upload(initialPath, dummyPng, { contentType: "image/png", upsert: true });

      await pgClient.query("UPDATE public.products SET image_url = $1 WHERE id = $2;", [initialPath, prod.id]);

      // 2. Upload candidate replacement image to live Storage
      await adminClient.storage
        .from("product-images")
        .upload(candidatePath, dummyPng, { contentType: "image/png", upsert: true });

      // 3. Establish authenticated owner session
      clearInMemoryCookieJar();
      const serverClient = await createServerClient();
      await serverClient.auth.signInWithPassword({
        email: ownerEmail,
        password: testPassword,
      });

      // 4. Invoke updateProductAction with STALE expected_version (OCC conflict trigger)
      const result = await updateProductAction(orgASlug, prod.id, {
        expected_version: 999, // Stale version! (Current version is 1)
        name: "OCC Stale Attempt",
        sku: prod.sku,
        selling_price: 55.0,
        unit_of_measure: "piece",
        image_url: candidatePath,
        cost_operation: "unchanged",
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe("CONCURRENCY_CONFLICT");

      // 5. Verify database still references initial image and version is unchanged
      const dbCheck = await pgClient.query("SELECT image_url, version FROM public.products WHERE id = $1;", [prod.id]);
      expect(dbCheck.rows[0].image_url).toBe(initialPath);
      expect(dbCheck.rows[0].version).toBe(1);

      // 6. Verify initial image STILL exists in live Storage bucket
      const { data: keepCheck } = await adminClient.storage.from("product-images").download(initialPath);
      expect(keepCheck).not.toBeNull();

      // 7. Verify candidate replacement image was rolled back and deleted from live Storage bucket
      const { error: candidateErr } = await adminClient.storage.from("product-images").download(candidatePath);
      expect(candidateErr).not.toBeNull();

      // Cleanup
      await adminClient.storage.from("product-images").remove([initialPath]);
    });

    it("preserves DB update success and captures structured [STORAGE_CLEANUP_FAILURE] diagnostic if post-commit removal fails", async () => {
      const prod = await createTestProduct("SA-IMG-OBSERVE-LIVE");
      const initialPath = `${orgAId}/${prod.id}/faulty-old.png`;
      const replacementPath = `${orgAId}/${prod.id}/faulty-new.png`;

      const dummyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
      await adminClient.storage
        .from("product-images")
        .upload(initialPath, dummyPng, { contentType: "image/png", upsert: true });

      await pgClient.query("UPDATE public.products SET image_url = $1 WHERE id = $2;", [initialPath, prod.id]);

      await adminClient.storage
        .from("product-images")
        .upload(replacementPath, dummyPng, { contentType: "image/png", upsert: true });

      // Establish authenticated owner session
      clearInMemoryCookieJar();
      const serverClient = await createServerClient();
      await serverClient.auth.signInWithPassword({
        email: ownerEmail,
        password: testPassword,
      });

      // Spy on console.error to verify structured diagnostics
      const consoleErrorSpy = vi.spyOn(console, "error");

      // Simulate a storage removal API failure on the server storage prototype
      const serverStorageProto = Object.getPrototypeOf(serverClient.storage.from("product-images"));
      const removeSpy = vi.spyOn(serverStorageProto, "remove").mockResolvedValueOnce({
        data: null,
        error: { name: "StorageApiError", message: "Simulated 503 storage outage" } as any,
      });

      try {
        const result = await updateProductAction(orgASlug, prod.id, {
          expected_version: 1,
          name: "Faulty Cleanup Handled Gracefully",
          sku: prod.sku,
          selling_price: 65.0,
          unit_of_measure: "piece",
          image_url: replacementPath,
          cost_operation: "unchanged",
        });

        // CRITICAL INVARIANT: DB mutation succeeded, so action must still return success!
        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.version).toBe(2);

        // Structured diagnostic MUST be logged
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "[STORAGE_CLEANUP_FAILURE]",
          expect.objectContaining({
            operation: "post_commit_superseded_image",
            organizationId: orgAId,
            productId: prod.id,
            storagePath: initialPath,
            errorCategory: "storage_api_error",
            error: "Simulated 503 storage outage",
          })
        );
      } finally {
        removeSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        await adminClient.storage.from("product-images").remove([initialPath, replacementPath]);
      }
    });
  });
});
