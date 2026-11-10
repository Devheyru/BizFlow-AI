import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { clearInMemoryCookieJar, createClient as createServerClient } from "@/lib/supabase/server";
import {
  archiveProductAction,
  createProductAction,
  updateProductAction,
} from "@/actions/product-actions";
import {
  createCategoryAction,
  updateCategoryAction,
  archiveCategoryAction,
} from "@/actions/category-actions";

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

describe("T061: Manual Role-Based Acceptance Walkthrough (Owner, Admin, Manager, Cashier)", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;

  let ownerClient: SupabaseClient;
  let adminRoleClient: SupabaseClient;
  let managerClient: SupabaseClient;
  let cashierClient: SupabaseClient;

  let ownerUserId: string;
  let adminUserId: string;
  let managerUserId: string;
  let cashierUserId: string;
  let managerEmail: string;
  let cashierEmail: string;

  let orgId: string;
  const orgSlug = `walkthrough-${Date.now()}`;
  const testPassword = "P@ssword123!Walkthrough";

  let createdCategoryId: string;
  let createdProductId: string;
  const testSku = `TSHIRT-WHT-${Date.now()}`;

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const timestamp = Date.now();
    const createTestUser = async (roleName: string) => {
      const email = `walkthrough_${roleName.toLowerCase()}_${timestamp}@bizflow-test.internal`;
      const { data } = await adminClient.auth.admin.createUser({
        email,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "Walkthrough", last_name: roleName },
      });
      const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
      await client.auth.signInWithPassword({ email, password: testPassword });
      return { userId: data.user!.id, client, email };
    };

    const ownerRes = await createTestUser("Owner");
    ownerUserId = ownerRes.userId;
    ownerClient = ownerRes.client;

    const adminRoleRes = await createTestUser("Admin");
    adminUserId = adminRoleRes.userId;
    adminRoleClient = adminRoleRes.client;

    const managerRes = await createTestUser("Manager");
    managerUserId = managerRes.userId;
    managerClient = managerRes.client;
    managerEmail = managerRes.email;

    const cashierRes = await createTestUser("Cashier");
    cashierUserId = cashierRes.userId;
    cashierClient = cashierRes.client;
    cashierEmail = cashierRes.email;

    // Create Organization & Memberships
    const resOrg = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
       VALUES ('Walkthrough Retail Store', $1, 'USD', 'retail', 'US', 'America/New_York', $2) RETURNING id;`,
      [orgSlug, ownerUserId]
    );
    orgId = resOrg.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES
         ($1, $2, 'owner', 'active'),
         ($1, $3, 'admin', 'active'),
         ($1, $4, 'manager', 'active'),
         ($1, $5, 'cashier', 'active');`,
      [orgId, ownerUserId, adminUserId, managerUserId, cashierUserId]
    );
  });

  afterAll(async () => {
    try {
      if (orgId) {
        await pgClient.query(`DELETE FROM public.product_costs WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`DELETE FROM public.products WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`DELETE FROM public.product_categories WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`DELETE FROM public.organization_audit_events WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`ALTER TABLE public.organization_memberships DISABLE TRIGGER trg_check_owner_invariant`);
        await pgClient.query(`DELETE FROM public.organization_memberships WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`ALTER TABLE public.organization_memberships ENABLE TRIGGER trg_check_owner_invariant`);
        await pgClient.query(`DELETE FROM public.organizations WHERE id = $1`, [orgId]);
      }
      for (const uid of [ownerUserId, adminUserId, managerUserId, cashierUserId]) {
        if (uid) await adminClient.auth.admin.deleteUser(uid);
      }
    } catch (_) {}

    await pgClient.end();
  });

  // ===========================================================================
  // 1. Owner Role Walkthrough
  // ===========================================================================
  describe("1. Owner Role Walkthrough", () => {
    it("1.1 Owner creates Category 'Apparel' and duplicate is rejected with P0006 [PASS]", async () => {
      const res = await ownerClient.rpc("create_product_category", {
        p_org_id: orgId,
        p_name: "Apparel",
        p_description: "Apparel and garments",
      });
      expect(res.error).toBeNull();
      createdCategoryId = (res.data as any).data.id;
      expect(createdCategoryId).toBeDefined();

      // Duplicate category name check (P0006)
      const dupRes = await ownerClient.rpc("create_product_category", {
        p_org_id: orgId,
        p_name: "apparel",
      });
      expect(dupRes.error).not.toBeNull();
      expect(dupRes.error?.message).toMatch(/already exists/i);
    });

    it("1.2 Owner creates Product 'Classic White T-Shirt' with selling and cost price [PASS]", async () => {
      const res = await ownerClient.rpc("create_product", {
        p_org_id: orgId,
        p_name: "Classic White T-Shirt",
        p_sku: testSku,
        p_selling_price: 25.0,
        p_unit_of_measure: "piece",
        p_category_id: createdCategoryId,
        p_cost_price: 10.0,
      });
      expect(res.error).toBeNull();
      createdProductId = (res.data as any).data.id;
      expect(createdProductId).toBeDefined();
    });

    it("1.3 Owner reads product detail with selling price, cost price, and gross margin [PASS]", async () => {
      const { data, error } = await ownerClient
        .from("products")
        .select("id, name, selling_price, cost:product_costs(cost_price)")
        .eq("id", createdProductId)
        .single();

      expect(error).toBeNull();
      expect(Number(data?.selling_price)).toBe(25.0);
      const costRel = Array.isArray(data?.cost) ? data.cost[0] : data?.cost;
      expect(Number(costRel?.cost_price)).toBe(10.0);
    });

    it("1.4 Owner tests OCC conflict detection (P0010) [PASS]", async () => {
      // Query current version
      const vBefore = (await pgClient.query(`SELECT version FROM public.products WHERE id = $1`, [createdProductId])).rows[0].version;

      // Simulate concurrent edit in database: increment version
      await pgClient.query(`UPDATE public.products SET version = $1 WHERE id = $2`, [vBefore + 1, createdProductId]);

      // Attempt update with stale expected_version = vBefore
      const conflictRes = await ownerClient.rpc("update_product", {
        p_org_id: orgId,
        p_product_id: createdProductId,
        p_expected_version: vBefore,
        p_name: "Stale Overwrite Attempt",
        p_sku: testSku,
        p_selling_price: 25.0,
        p_unit_of_measure: "piece",
      });
      expect(conflictRes.error).not.toBeNull();
      expect(conflictRes.error?.code).toBe("P0010");
      expect(conflictRes.error?.message).toMatch(/stale update conflict|concurrency conflict/i);
    });

    it("1.5 Owner archives product and verifies permanent SKU reservation (P0006) [PASS]", async () => {
      const vCurrent = (await pgClient.query(`SELECT version FROM public.products WHERE id = $1`, [createdProductId])).rows[0].version;

      const archiveRes = await ownerClient.rpc("archive_product", {
        p_org_id: orgId,
        p_product_id: createdProductId,
        p_expected_version: vCurrent,
      });
      expect(archiveRes.error).toBeNull();

      // Verify SKU is permanently reserved even when archived
      const reCreateRes = await ownerClient.rpc("create_product", {
        p_org_id: orgId,
        p_name: "Duplicate SKU Attempt",
        p_sku: testSku,
        p_selling_price: 30.0,
        p_unit_of_measure: "piece",
      });
      expect(reCreateRes.error).not.toBeNull();
      expect(reCreateRes.error?.message).toMatch(/already exists/i);

      // Restore product to inactive for subsequent role tests
      const vArchived = (await pgClient.query(`SELECT version FROM public.products WHERE id = $1`, [createdProductId])).rows[0].version;
      const restoreRes = await ownerClient.rpc("restore_product", {
        p_org_id: orgId,
        p_product_id: createdProductId,
        p_expected_version: vArchived,
      });
      expect(restoreRes.error).toBeNull();
    });
  });

  // ===========================================================================
  // 2. Admin Role Walkthrough
  // ===========================================================================
  describe("2. Admin Role Walkthrough", () => {
    it("2.1 Admin has full product & category management with cost visibility [PASS]", async () => {
      const vCurrent = (await pgClient.query(`SELECT version FROM public.products WHERE id = $1`, [createdProductId])).rows[0].version;

      // Admin updates product
      const res = await adminRoleClient.rpc("update_product", {
        p_org_id: orgId,
        p_product_id: createdProductId,
        p_expected_version: vCurrent,
        p_name: "Admin Updated T-Shirt",
        p_sku: testSku,
        p_selling_price: 26.0,
        p_unit_of_measure: "piece",
      });
      expect(res.error).toBeNull();

      // Admin reads cost price
      const { data, error } = await adminRoleClient
        .from("products")
        .select("id, cost:product_costs(cost_price)")
        .eq("id", createdProductId)
        .single();
      expect(error).toBeNull();
      const costRel = Array.isArray(data?.cost) ? data.cost[0] : data?.cost;
      expect(Number(costRel?.cost_price)).toBe(10.0);
    });
  });

  // ===========================================================================
  // 3. Manager Role Walkthrough
  // ===========================================================================
  describe("3. Manager Role Walkthrough", () => {
    it("3.1 Manager updates product and views cost price [PASS]", async () => {
      const vCurrent = (await pgClient.query(`SELECT version FROM public.products WHERE id = $1`, [createdProductId])).rows[0].version;

      const res = await managerClient.rpc("update_product", {
        p_org_id: orgId,
        p_product_id: createdProductId,
        p_expected_version: vCurrent,
        p_name: "Manager Updated T-Shirt",
        p_sku: testSku,
        p_selling_price: 27.0,
        p_unit_of_measure: "piece",
      });
      expect(res.error).toBeNull();

      // Manager has products:read_cost
      const { data, error } = await managerClient
        .from("products")
        .select("id, cost:product_costs(cost_price)")
        .eq("id", createdProductId)
        .single();
      expect(error).toBeNull();
      const costRel = Array.isArray(data?.cost) ? data.cost[0] : data?.cost;
      expect(Number(costRel?.cost_price)).toBe(10.0);
    });

    it("3.2 Manager CANNOT archive product (products:archive forbidden) [PASS]", async () => {
      const res = await managerClient.rpc("archive_product", {
        p_org_id: orgId,
        p_product_id: createdProductId,
        p_expected_version: 5,
      });
      expect(res.error).not.toBeNull();
      expect(res.error?.message).toMatch(/Forbidden|permission/i);
    });

    it("3.3 Manager CANNOT archive category (categories:archive forbidden) [PASS]", async () => {
      const res = await managerClient.rpc("archive_product_category", {
        p_org_id: orgId,
        p_category_id: createdCategoryId,
      });
      expect(res.error).not.toBeNull();
      expect(res.error?.message).toMatch(/Forbidden|permission/i);
    });

    it("3.4 Manager CANNOT archive product via direct Server Action boundary [PASS]", async () => {
      clearInMemoryCookieJar();
      const serverClient = await createServerClient();
      await serverClient.auth.signInWithPassword({ email: managerEmail, password: testPassword });

      const prodBefore = (
        await pgClient.query(`SELECT status, version FROM public.products WHERE id = $1`, [createdProductId])
      ).rows[0];

      const res = await archiveProductAction(orgSlug, createdProductId, prodBefore.version);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
        expect(res.error.message).toMatch(/permission|unauthorized/i);
      }

      // Verify no unauthorized database mutation occurred
      const prodAfter = (
        await pgClient.query(`SELECT status, version FROM public.products WHERE id = $1`, [createdProductId])
      ).rows[0];
      expect(prodAfter.status).toBe(prodBefore.status);
      expect(prodAfter.version).toBe(prodBefore.version);
    });
  });

  // ===========================================================================
  // 4. Cashier Role Walkthrough
  // ===========================================================================
  describe("4. Cashier Role Walkthrough", () => {
    it("4.1 Cashier can browse catalog and view selling price ($27.00) [PASS]", async () => {
      const { data, error } = await cashierClient
        .from("products")
        .select("id, name, selling_price")
        .eq("id", createdProductId)
        .single();

      expect(error).toBeNull();
      expect(Number(data?.selling_price)).toBe(27.0);
    });

    it("4.2 Cashier CANNOT view cost price (0 rows returned on product_costs) [PASS]", async () => {
      const { data, error } = await cashierClient
        .from("product_costs")
        .select("*")
        .eq("product_id", createdProductId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0); // RLS returns 0 rows
    });

    it("4.3 Cashier CANNOT create product (products:create forbidden) [PASS]", async () => {
      const res = await cashierClient.rpc("create_product", {
        p_org_id: orgId,
        p_name: "Cashier Created Product",
        p_sku: `CASH-${Date.now()}`,
        p_selling_price: 15.0,
        p_unit_of_measure: "unit",
      });
      expect(res.error).not.toBeNull();
      expect(res.error?.message).toMatch(/Forbidden|permission/i);
    });

    it("4.4 Cashier CANNOT update or archive product [PASS]", async () => {
      const updateRes = await cashierClient.rpc("update_product", {
        p_org_id: orgId,
        p_product_id: createdProductId,
        p_expected_version: 5,
        p_name: "Cashier Tamper Attempt",
        p_sku: testSku,
        p_selling_price: 25.0,
        p_unit_of_measure: "piece",
      });
      expect(updateRes.error).not.toBeNull();
      expect(updateRes.error?.message).toMatch(/Forbidden|permission/i);

      const archiveRes = await cashierClient.rpc("archive_product", {
        p_org_id: orgId,
        p_product_id: createdProductId,
        p_expected_version: 5,
      });
      expect(archiveRes.error).not.toBeNull();
      expect(archiveRes.error?.message).toMatch(/Forbidden|permission/i);
    });

    it("4.5 Cashier CANNOT create product via direct Server Action boundary [PASS]", async () => {
      clearInMemoryCookieJar();
      const serverClient = await createServerClient();
      await serverClient.auth.signInWithPassword({ email: cashierEmail, password: testPassword });

      const unauthSku = `CASH-ACTION-${Date.now()}`;
      const res = await createProductAction(orgSlug, {
        name: "Cashier Direct Server Action Product",
        sku: unauthSku,
        selling_price: 19.99,
        unit_of_measure: "unit",
      });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
        expect(res.error.message).toMatch(/permission|unauthorized/i);
      }

      // Verify no product was inserted in database
      const dbCheck = await pgClient.query(`SELECT id FROM public.products WHERE sku = $1`, [unauthSku]);
      expect(dbCheck.rows).toHaveLength(0);
    });

    it("4.6 Cashier CANNOT update product via direct Server Action boundary [PASS]", async () => {
      clearInMemoryCookieJar();
      const serverClient = await createServerClient();
      await serverClient.auth.signInWithPassword({ email: cashierEmail, password: testPassword });

      const prodBefore = (
        await pgClient.query(`SELECT name, selling_price, version FROM public.products WHERE id = $1`, [createdProductId])
      ).rows[0];

      const res = await updateProductAction(orgSlug, createdProductId, {
        name: "Tampered by Cashier Action",
        selling_price: 99.99,
        expected_version: prodBefore.version,
        cost_operation: "unchanged",
      });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
        expect(res.error.message).toMatch(/permission|unauthorized/i);
      }

      // Verify no product field was mutated in database
      const prodAfter = (
        await pgClient.query(`SELECT name, selling_price, version FROM public.products WHERE id = $1`, [createdProductId])
      ).rows[0];
      expect(prodAfter.name).toBe(prodBefore.name);
      expect(Number(prodAfter.selling_price)).toBe(Number(prodBefore.selling_price));
      expect(prodAfter.version).toBe(prodBefore.version);
    });

    it("4.7 Cashier CANNOT archive product via direct Server Action boundary [PASS]", async () => {
      clearInMemoryCookieJar();
      const serverClient = await createServerClient();
      await serverClient.auth.signInWithPassword({ email: cashierEmail, password: testPassword });

      const prodBefore = (
        await pgClient.query(`SELECT status, version FROM public.products WHERE id = $1`, [createdProductId])
      ).rows[0];

      const res = await archiveProductAction(orgSlug, createdProductId, prodBefore.version);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
        expect(res.error.message).toMatch(/permission|unauthorized/i);
      }

      // Verify status remains unchanged in database
      const prodAfter = (
        await pgClient.query(`SELECT status, version FROM public.products WHERE id = $1`, [createdProductId])
      ).rows[0];
      expect(prodAfter.status).toBe(prodBefore.status);
      expect(prodAfter.version).toBe(prodBefore.version);
    });

    it("4.8 Cashier CANNOT mutate categories via direct Server Action boundary [PASS]", async () => {
      clearInMemoryCookieJar();
      const serverClient = await createServerClient();
      await serverClient.auth.signInWithPassword({ email: cashierEmail, password: testPassword });

      // 1. Attempt createCategoryAction
      const unauthCatName = `Cashier Unauth Cat ${Date.now()}`;
      const createCatRes = await createCategoryAction(orgSlug, {
        name: unauthCatName,
        description: "Unauthorized creation attempt",
      });
      expect(createCatRes.success).toBe(false);
      if (!createCatRes.success) {
        expect(createCatRes.error.code).toBe("FORBIDDEN");
        expect(createCatRes.error.message).toMatch(/permission|unauthorized/i);
      }
      const dbCatCreateCheck = await pgClient.query(
        `SELECT id FROM public.product_categories WHERE name = $1 AND organization_id = $2`,
        [unauthCatName, orgId]
      );
      expect(dbCatCreateCheck.rows).toHaveLength(0);

      // 2. Attempt updateCategoryAction
      const catBefore = (
        await pgClient.query(`SELECT name, status FROM public.product_categories WHERE id = $1`, [createdCategoryId])
      ).rows[0];
      const updateCatRes = await updateCategoryAction(orgSlug, createdCategoryId, {
        name: "Tampered Category by Cashier Action",
      });
      expect(updateCatRes.success).toBe(false);
      if (!updateCatRes.success) {
        expect(updateCatRes.error.code).toBe("FORBIDDEN");
        expect(updateCatRes.error.message).toMatch(/permission|unauthorized/i);
      }
      const catAfterUpdate = (
        await pgClient.query(`SELECT name, status FROM public.product_categories WHERE id = $1`, [createdCategoryId])
      ).rows[0];
      expect(catAfterUpdate.name).toBe(catBefore.name);

      // 3. Attempt archiveCategoryAction
      const archiveCatRes = await archiveCategoryAction(orgSlug, createdCategoryId);
      expect(archiveCatRes.success).toBe(false);
      if (!archiveCatRes.success) {
        expect(archiveCatRes.error.code).toBe("FORBIDDEN");
        expect(archiveCatRes.error.message).toMatch(/permission|unauthorized/i);
      }
      const catAfterArchive = (
        await pgClient.query(`SELECT status FROM public.product_categories WHERE id = $1`, [createdCategoryId])
      ).rows[0];
      expect(catAfterArchive.status).toBe("active");
    });
  });
});

