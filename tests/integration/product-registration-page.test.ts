import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { ROLE_PERMISSIONS, hasPermission } from "@/lib/auth/permissions";
import type { TenantContext } from "@/types/auth";
import { buildProductStoragePath, PRODUCT_IMAGES_BUCKET } from "@/lib/products/image-storage";
import { STORAGE_OBJECT_PATH_REGEX } from "@/lib/validations/product";

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

describe("T034: Product Registration Page & Staged Image Lifecycle Integration (FR-001 - FR-016, FR-040)", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;

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
  const orgASlug = `prod-reg-a-${Date.now()}`;
  const orgBSlug = `prod-reg-b-${Date.now()}`;

  let activeCatId: string;
  let archivedCatId: string;
  let orgBCatId: string;

  const testPassword = "P@ssword123!SecureTest";
  const createdProductIds: string[] = [];
  const createdStoragePaths: string[] = [];

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const timestamp = Date.now();
    const ownerEmail = `owner_reg_${timestamp}@bizflow-test.internal`;
    const mgrEmail = `mgr_reg_${timestamp}@bizflow-test.internal`;
    const cashEmail = `cash_reg_${timestamp}@bizflow-test.internal`;
    const orgBEmail = `orgb_reg_${timestamp}@bizflow-test.internal`;

    // 1. Create Users
    const { data: uOwner } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Reg", last_name: "Owner" },
    });
    ownerUserId = uOwner.user!.id;

    const { data: uMgr } = await adminClient.auth.admin.createUser({
      email: mgrEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Reg", last_name: "Manager" },
    });
    managerUserId = uMgr.user!.id;

    const { data: uCash } = await adminClient.auth.admin.createUser({
      email: cashEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Reg", last_name: "Cashier" },
    });
    cashierUserId = uCash.user!.id;

    const { data: uOrgB } = await adminClient.auth.admin.createUser({
      email: orgBEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Reg", last_name: "OrgB" },
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

    // 3. Create Organizations
    const orgARes = await pgClient.query(`
      INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
      VALUES ('Registration Org Alpha', $1, 'USD', 'retail', 'US', 'UTC', $2)
      RETURNING id;
    `, [orgASlug, ownerUserId]);
    orgAId = orgARes.rows[0].id;

    const orgBRes = await pgClient.query(`
      INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
      VALUES ('Registration Org Beta', $1, 'USD', 'retail', 'US', 'UTC', $2)
      RETURNING id;
    `, [orgBSlug, orgBUserId]);
    orgBId = orgBRes.rows[0].id;

    // 4. Create Memberships
    await pgClient.query(`
      INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
      VALUES
        ($1, $2, 'owner', 'active'),
        ($1, $3, 'manager', 'active'),
        ($1, $4, 'cashier', 'active'),
        ($5, $6, 'owner', 'active');
    `, [orgAId, ownerUserId, managerUserId, cashierUserId, orgBId, orgBUserId]);

    // 5. Create Categories
    const { data: catActive } = await ownerClient.rpc("create_product_category", {
      p_org_id: orgAId,
      p_name: "Organic Produce",
      p_description: "Active organic category",
    });
    activeCatId = (catActive as any).data.id;

    const { data: catArch } = await ownerClient.rpc("create_product_category", {
      p_org_id: orgAId,
      p_name: "Discontinued Produce",
      p_description: "Archived produce category",
    });
    archivedCatId = (catArch as any).data.id;
    await ownerClient.rpc("archive_product_category", {
      p_org_id: orgAId,
      p_category_id: archivedCatId,
    });

    const { data: catB } = await orgBClient.rpc("create_product_category", {
      p_org_id: orgBId,
      p_name: "Org B Category",
      p_description: "Category belonging to tenant B",
    });
    orgBCatId = (catB as any).data.id;
  });

  afterAll(async () => {
    // Clean up uploaded storage objects
    if (createdStoragePaths.length > 0) {
      await adminClient.storage.from(PRODUCT_IMAGES_BUCKET).remove(createdStoragePaths);
    }

    // Clean up database entities
    if (createdProductIds.length > 0) {
      await pgClient.query("DELETE FROM public.products WHERE id = ANY($1::uuid[]);", [
        createdProductIds,
      ]);
    }

    try {
      if (orgAId && orgBId) {
        await pgClient.query("DELETE FROM public.products WHERE organization_id IN ($1, $2);", [orgAId, orgBId]);
        await pgClient.query("DELETE FROM public.product_categories WHERE organization_id IN ($1, $2);", [orgAId, orgBId]);
        await pgClient.query("DELETE FROM public.organization_audit_events WHERE organization_id IN ($1, $2);", [orgAId, orgBId]);
        await pgClient.query("ALTER TABLE public.organization_memberships DISABLE TRIGGER USER;");
        await pgClient.query("DELETE FROM public.organizations WHERE id IN ($1, $2);", [orgAId, orgBId]);
      }
    } finally {
      await pgClient.query("ALTER TABLE public.organization_memberships ENABLE TRIGGER USER;").catch(() => {});
    }

    for (const uid of [ownerUserId, managerUserId, cashierUserId, orgBUserId]) {
      try {
        await adminClient.auth.admin.deleteUser(uid);
      } catch {
        // Ignore deletion errors in teardown
      }
    }

    await pgClient.end();
  });

  describe("Scenario I: Server Authorization Guard (T034, FR-001, FR-040)", () => {
    it("allows Owner and Manager access with products:create permission in database and application", async () => {
      // 1. Database check_user_permission verification
      const dbOwnerCheck = await pgClient.query(
        "SELECT public.check_user_permission($1, $2, 'products:create') AS allowed;",
        [orgAId, ownerUserId]
      );
      expect(dbOwnerCheck.rows[0].allowed).toBe(true);

      const dbMgrCheck = await pgClient.query(
        "SELECT public.check_user_permission($1, $2, 'products:create') AS allowed;",
        [orgAId, managerUserId]
      );
      expect(dbMgrCheck.rows[0].allowed).toBe(true);

      // 2. Application permission engine verification
      const ownerContext: TenantContext = {
        role: "owner",
        organization: { id: orgAId, is_active: true } as any,
        membership: { status: "active", role: "owner" } as any,
        permissions: ROLE_PERMISSIONS.owner as any,
        user: { id: ownerUserId, email: "owner@test.internal" } as any,
        activeOrganizations: [],
      };
      expect(hasPermission(ownerContext, "products:create")).toBe(true);

      const mgrContext: TenantContext = {
        role: "manager",
        organization: { id: orgAId, is_active: true } as any,
        membership: { status: "active", role: "manager" } as any,
        permissions: ROLE_PERMISSIONS.manager as any,
        user: { id: managerUserId, email: "manager@test.internal" } as any,
        activeOrganizations: [],
      };
      expect(hasPermission(mgrContext, "products:create")).toBe(true);
    });

    it("denies Cashier role access to product creation (products:create is false)", async () => {
      // 1. Database check_user_permission verification
      const dbCashCheck = await pgClient.query(
        "SELECT public.check_user_permission($1, $2, 'products:create') AS allowed;",
        [orgAId, cashierUserId]
      );
      expect(dbCashCheck.rows[0].allowed).toBe(false);

      // 2. Application permission engine verification
      const cashContext: TenantContext = {
        role: "cashier",
        organization: { id: orgAId, is_active: true } as any,
        membership: { status: "active", role: "cashier" } as any,
        permissions: ROLE_PERMISSIONS.cashier as any,
        user: { id: cashierUserId, email: "cashier@test.internal" } as any,
        activeOrganizations: [],
      };
      expect(hasPermission(cashContext, "products:create")).toBe(false);

      // 3. RPC execution rejection
      const { data, error } = await cashierClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Cashier Unauthorized Product",
        p_sku: `CASHIER-DENIED-${Date.now()}`,
        p_selling_price: 10.0,
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.code === "P0005" || error?.message.includes("P0005")).toBe(true);
    });
  });

  describe("Scenario II: Cost Confidentiality Gating (FR-039)", () => {
    it("permits Owner and Manager to view and record product costs", async () => {
      const dbOwnerCost = await pgClient.query(
        "SELECT public.check_user_permission($1, $2, 'products:read_cost') AS allowed;",
        [orgAId, ownerUserId]
      );
      expect(dbOwnerCost.rows[0].allowed).toBe(true);

      const dbMgrCost = await pgClient.query(
        "SELECT public.check_user_permission($1, $2, 'products:read_cost') AS allowed;",
        [orgAId, managerUserId]
      );
      expect(dbMgrCost.rows[0].allowed).toBe(true);
    });

    it("strictly hides cost data from Cashier role", async () => {
      const dbCashCost = await pgClient.query(
        "SELECT public.check_user_permission($1, $2, 'products:read_cost') AS allowed;",
        [orgAId, cashierUserId]
      );
      expect(dbCashCost.rows[0].allowed).toBe(false);

      const cashContext: TenantContext = {
        role: "cashier",
        organization: { id: orgAId, is_active: true } as any,
        membership: { status: "active", role: "cashier" } as any,
        permissions: ROLE_PERMISSIONS.cashier as any,
        user: { id: cashierUserId, email: "cashier@test.internal" } as any,
        activeOrganizations: [],
      };
      expect(hasPermission(cashContext, "products:read_cost")).toBe(false);
    });
  });

  describe("Scenario III: Tenant-Scoped Active Category Isolation (FR-002, FR-037)", () => {
    it("queries only active categories for the active tenant, excluding archived and cross-tenant categories", async () => {
      // Direct query mirroring Server Component in page.tsx
      const { data: categories, error } = await managerClient
        .from("product_categories")
        .select("id, name")
        .eq("organization_id", orgAId)
        .eq("status", "active")
        .order("name", { ascending: true });

      expect(error).toBeNull();
      expect(categories).toBeDefined();

      const returnedIds = (categories || []).map((c) => c.id);

      // Active category in Org A is included
      expect(returnedIds).toContain(activeCatId);

      // Archived category in Org A is excluded
      expect(returnedIds).not.toContain(archivedCatId);

      // Org B category is excluded
      expect(returnedIds).not.toContain(orgBCatId);
    });
  });

  describe("Scenario IV: End-to-End Staged Image Lifecycle in Real Supabase Storage & DB (T031, T033)", () => {
    it("creates product with null image, uploads staged file, associates via update RPC, and verifies OCC", async () => {
      // 1. Step 1: Create product with null image
      const sku = `STAGED-IMG-${Date.now()}`;
      const { data: createData, error: createError } = await managerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Staged Image Item",
        p_sku: sku,
        p_selling_price: 15.99,
        p_unit_of_measure: "piece",
        p_status: "active",
        p_category_id: activeCatId,
        p_image_url: null,
      });

      expect(createError).toBeNull();
      const product = (createData as any).data;
      expect(product.id).toBeDefined();
      expect(product.version).toBe(1);
      expect(product.image_url).toBeNull();
      createdProductIds.push(product.id);

      // 2. Step 2: Upload staged file to product-images bucket
      // Storage RLS requires product to exist in DB before upload!
      const fileName = "test-item.png";
      const storagePath = buildProductStoragePath(orgAId, product.id, fileName);
      expect(storagePath).toMatch(STORAGE_OBJECT_PATH_REGEX);

      const fakeImageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

      const { data: uploadData, error: uploadError } = await managerClient.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .upload(storagePath, fakeImageBytes, {
          contentType: "image/png",
          upsert: false,
        });

      expect(uploadError).toBeNull();
      expect(uploadData?.path).toBe(storagePath);
      createdStoragePaths.push(storagePath);

      // 3. Step 3: Associate uploaded image via update_product RPC with OCC version 1
      const { data: updateData, error: updateError } = await managerClient.rpc("update_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
        p_name: product.name,
        p_sku: product.sku,
        p_selling_price: product.selling_price,
        p_unit_of_measure: product.unit_of_measure,
        p_category_id: activeCatId,
        p_cost_operation: "unchanged",
        p_image_url: storagePath,
      });

      expect(updateError).toBeNull();
      const updatedProduct = (updateData as any).data;
      expect(updatedProduct.version).toBe(2);
      expect(updatedProduct.image_url).toBe(storagePath);

      // 4. Verify in DB
      const dbCheck = await pgClient.query("SELECT image_url, version FROM public.products WHERE id = $1;", [
        product.id,
      ]);
      expect(dbCheck.rows[0].image_url).toBe(storagePath);
      expect(dbCheck.rows[0].version).toBe(2);
    });

    it("verifies Storage RLS blocks upload if product does not exist in DB", async () => {
      const nonExistentProductId = "99999999-9999-4999-a999-999999999999";
      const orphanPath = buildProductStoragePath(orgAId, nonExistentProductId, "orphan.png");

      const fakeBytes = Buffer.from("fake-bytes");
      const { error } = await managerClient.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .upload(orphanPath, fakeBytes, {
          contentType: "image/png",
          upsert: false,
        });

      // Must be rejected by product_images_insert RLS policy
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/violates row-level security policy|row-level security/i);
    });
  });
});