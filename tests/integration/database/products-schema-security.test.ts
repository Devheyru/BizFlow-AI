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

describe("Feature 003 — Database Schema & Security Foundation (T004–T020)", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;
  let ownerClient: SupabaseClient;
  let managerClient: SupabaseClient;
  let cashierClient: SupabaseClient;

  let ownerUserId: string;
  let managerUserId: string;
  let cashierUserId: string;
  let testOrgId: string;
  let secondOrgId: string;

  const testPassword = "Password123!@#Secure";

  const feature003Functions = [
    "get_currency_exponent",
    "create_product_category",
    "update_product_category",
    "archive_product_category",
    "restore_product_category",
    "create_product",
    "update_product",
    "toggle_product_status",
    "archive_product",
    "restore_product",
  ];

  const feature003MutationFunctions = [
    "create_product_category",
    "update_product_category",
    "archive_product_category",
    "restore_product_category",
    "create_product",
    "update_product",
    "toggle_product_status",
    "archive_product",
    "restore_product",
  ];

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const timestamp = Date.now();
    const ownerEmail = `prod_owner_${timestamp}@example.com`;
    const managerEmail = `prod_mgr_${timestamp}@example.com`;
    const cashierEmail = `prod_cashier_${timestamp}@example.com`;

    // Create Owner user
    const { data: ownerUser, error: ownerErr } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Product", last_name: "Owner" },
    });
    if (ownerErr || !ownerUser.user) throw new Error(`Owner create failed: ${ownerErr?.message}`);
    ownerUserId = ownerUser.user.id;

    // Create Manager user
    const { data: mgrUser, error: mgrErr } = await adminClient.auth.admin.createUser({
      email: managerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Product", last_name: "Manager" },
    });
    if (mgrErr || !mgrUser.user) throw new Error(`Manager create failed: ${mgrErr?.message}`);
    managerUserId = mgrUser.user.id;

    // Create Cashier user
    const { data: cashUser, error: cashErr } = await adminClient.auth.admin.createUser({
      email: cashierEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Product", last_name: "Cashier" },
    });
    if (cashErr || !cashUser.user) throw new Error(`Cashier create failed: ${cashErr?.message}`);
    cashierUserId = cashUser.user.id;

    // Authenticate clients
    ownerClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

    managerClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await managerClient.auth.signInWithPassword({ email: managerEmail, password: testPassword });

    cashierClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await cashierClient.auth.signInWithPassword({ email: cashierEmail, password: testPassword });

    // Create primary test organization
    const orgRes = await pgClient.query(`
      INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
      VALUES ('Products Test Org', 'products-test-org-${timestamp}', 'USD', 'retail', 'US', 'UTC', $1)
      RETURNING id;
    `, [ownerUserId]);
    testOrgId = orgRes.rows[0].id;

    // Add memberships
    await pgClient.query(`
      INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
      VALUES
        ($1, $2, 'owner', 'active'),
        ($1, $3, 'manager', 'active'),
        ($1, $4, 'cashier', 'active');
    `, [testOrgId, ownerUserId, managerUserId, cashierUserId]);

    // Create secondary organization for cross-tenant isolation testing
    const secondOrgRes = await pgClient.query(`
      INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
      VALUES ('Second Test Org', 'second-test-org-${timestamp}', 'USD', 'retail', 'US', 'UTC', $1)
      RETURNING id;
    `, [ownerUserId]);
    secondOrgId = secondOrgRes.rows[0].id;

    await pgClient.query(`
      INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
      VALUES ($1, $2, 'owner', 'active');
    `, [secondOrgId, ownerUserId]);
  });

  afterAll(async () => {
    try {
      const orgIds = [testOrgId, secondOrgId].filter(Boolean);
      if (orgIds.length > 0) {
        await pgClient.query("DELETE FROM public.products WHERE organization_id = ANY($1::uuid[]);", [orgIds]);
        await pgClient.query("DELETE FROM public.product_categories WHERE organization_id = ANY($1::uuid[]);", [orgIds]);
        await pgClient.query("DELETE FROM public.organization_audit_events WHERE organization_id = ANY($1::uuid[]);", [orgIds]);
        await pgClient.query("ALTER TABLE public.organization_memberships DISABLE TRIGGER USER;");
        await pgClient.query("DELETE FROM public.organizations WHERE id = ANY($1::uuid[]);", [orgIds]);
      }
    } finally {
      await pgClient.query("ALTER TABLE public.organization_memberships ENABLE TRIGGER USER;");
    }
    if (ownerUserId) await adminClient.auth.admin.deleteUser(ownerUserId);
    if (managerUserId) await adminClient.auth.admin.deleteUser(managerUserId);
    if (cashierUserId) await adminClient.auth.admin.deleteUser(cashierUserId);
    await pgClient.end();
  });

  describe("T004: Extension pg_trgm", () => {
    it("verifies pg_trgm extension is active and installed", async () => {
      const res = await pgClient.query(
        "SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';"
      );
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].extname).toBe("pg_trgm");
    });
  });

  describe("T005: Table public.product_categories Schema & Constraints", () => {
    it("verifies product_categories columns, constraints, and indexes", async () => {
      const colRes = await pgClient.query(`
        SELECT column_name, is_nullable, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'product_categories';
      `);
      const cols = colRes.rows.map((c: { column_name: string }) => c.column_name);
      expect(cols).toContain("id");
      expect(cols).toContain("organization_id");
      expect(cols).toContain("name");
      expect(cols).toContain("description");
      expect(cols).toContain("status");
      expect(cols).toContain("created_by");
      expect(cols).toContain("updated_by");
      expect(cols).toContain("archived_at");
      expect(cols).toContain("archived_by");
      expect(cols).toContain("created_at");
      expect(cols).toContain("updated_at");

      // Verify composite unique key uq_categories_org_id
      const uqRes = await pgClient.query(`
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.product_categories'::regclass
          AND conname = 'uq_categories_org_id';
      `);
      expect(uqRes.rows.length).toBe(1);

      // Verify case-insensitive unique index uq_categories_org_name
      const idxRes = await pgClient.query(`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'product_categories'
          AND indexname = 'uq_categories_org_name';
      `);
      expect(idxRes.rows.length).toBe(1);
    });
  });

  describe("T006: Table public.products Schema & Constraints", () => {
    it("verifies products columns, check constraints, composite unique key, and indexes", async () => {
      const colRes = await pgClient.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'products';
      `);
      const cols = colRes.rows.map((c: { column_name: string }) => c.column_name);
      expect(cols).toContain("id");
      expect(cols).toContain("organization_id");
      expect(cols).toContain("name");
      expect(cols).toContain("sku");
      expect(cols).toContain("barcode");
      expect(cols).toContain("selling_price");
      expect(cols).toContain("unit_of_measure");
      expect(cols).toContain("image_url");
      expect(cols).toContain("status");
      expect(cols).toContain("version");
      expect(cols).toContain("category_id");

      // Verify composite unique key uq_products_org_id
      const uqRes = await pgClient.query(`
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.products'::regclass
          AND conname = 'uq_products_org_id';
      `);
      expect(uqRes.rows.length).toBe(1);

      // Verify permanent SKU unique constraint
      const skuUqRes = await pgClient.query(`
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.products'::regclass
          AND conname = 'uq_products_org_sku';
      `);
      expect(skuUqRes.rows.length).toBe(1);

      // Verify composite FK with ON DELETE SET NULL (category_id)
      const fkRes = await pgClient.query(`
        SELECT conname, confdeltype FROM pg_constraint
        WHERE conrelid = 'public.products'::regclass
          AND conname = 'fk_products_org_category';
      `);
      expect(fkRes.rows.length).toBe(1);
      // 'n' stands for SET NULL in pg_constraint confdeltype
      expect(fkRes.rows[0].confdeltype).toBe("n");

      // Verify trigram index on products(name)
      const trgmRes = await pgClient.query(`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'products'
          AND indexname = 'idx_products_name_trgm';
      `);
      expect(trgmRes.rows.length).toBe(1);
    });
  });

  describe("T007: Table public.product_costs Schema & Isolation", () => {
    it("verifies product_costs isolated table, primary key, and composite cascade FK", async () => {
      const colRes = await pgClient.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'product_costs';
      `);
      const cols = colRes.rows.map((c: { column_name: string }) => c.column_name);
      expect(cols).toEqual(expect.arrayContaining(["product_id", "organization_id", "cost_price", "created_at", "updated_at"]));

      // Verify composite FK with ON DELETE CASCADE
      const fkRes = await pgClient.query(`
        SELECT conname, confdeltype FROM pg_constraint
        WHERE conrelid = 'public.product_costs'::regclass
          AND conname = 'fk_product_costs_org_product';
      `);
      expect(fkRes.rows.length).toBe(1);
      // 'c' stands for CASCADE in pg_constraint confdeltype
      expect(fkRes.rows[0].confdeltype).toBe("c");
    });
  });

  describe("T008: Currency Exponent Function", () => {
    it("returns correct minor-unit exponent for ISO 4217 whitelist currencies", async () => {
      const jpyRes = await pgClient.query("SELECT public.get_currency_exponent('JPY') as exp;");
      expect(jpyRes.rows[0].exp).toBe(0);

      const usdRes = await pgClient.query("SELECT public.get_currency_exponent('USD') as exp;");
      expect(usdRes.rows[0].exp).toBe(2);

      const bhdRes = await pgClient.query("SELECT public.get_currency_exponent('BHD') as exp;");
      expect(bhdRes.rows[0].exp).toBe(3);

      const clfRes = await pgClient.query("SELECT public.get_currency_exponent('CLF') as exp;");
      expect(clfRes.rows[0].exp).toBe(4);
    });

    it("strictly raises P0009 on invalid or unsupported currency code", async () => {
      let errCode = "";
      try {
        await pgClient.query("SELECT public.get_currency_exponent('XYZ');");
      } catch (err: any) {
        errCode = err.code;
      }
      expect(errCode).toBe("P0009");
    });
  });

  describe("T009: Currency Invariance Trigger", () => {
    it("blocks currency update on organizations when products exist (P0015)", async () => {
      // Create a test product directly with SQL
      const prodRes = await pgClient.query(`
        INSERT INTO public.products (
          organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by
        ) VALUES (
          $1, 'Currency Lock Test Item', 'SKU-CURR-LOCK-1', 10.0000, 'piece', 'active', $2, $2
        ) RETURNING id;
      `, [testOrgId, ownerUserId]);
      const prodId = prodRes.rows[0].id;

      // Attempt to change currency
      let errCode = "";
      try {
        await pgClient.query(
          "UPDATE public.organizations SET currency = 'EUR' WHERE id = $1;",
          [testOrgId]
        );
      } catch (err: any) {
        errCode = err.code;
      }
      expect(errCode).toBe("P0015");

      // Clean up test product
      await pgClient.query("DELETE FROM public.products WHERE id = $1;", [prodId]);

      // Now currency change should succeed
      await pgClient.query(
        "UPDATE public.organizations SET currency = 'USD' WHERE id = $1;",
        [testOrgId]
      );
    });
  });

  describe("T010: Automatic Updated At Timestamp Trigger", () => {
    it("updates updated_at timestamp on row update", async () => {
      const catRes = await pgClient.query(`
        INSERT INTO public.product_categories (organization_id, name, status, created_by, updated_by)
        VALUES ($1, 'Timestamp Test Category', 'active', $2, $2)
        RETURNING id, updated_at;
      `, [testOrgId, ownerUserId]);
      const catId = catRes.rows[0].id;
      const initialUpdatedAt = catRes.rows[0].updated_at;

      // Small delay
      await new Promise((r) => setTimeout(r, 50));

      await pgClient.query(`
        UPDATE public.product_categories
        SET description = 'Updated Description'
        WHERE id = $1;
      `, [catId]);

      const updatedRes = await pgClient.query(
        "SELECT updated_at FROM public.product_categories WHERE id = $1;",
        [catId]
      );
      expect(new Date(updatedRes.rows[0].updated_at).getTime()).toBeGreaterThan(
        new Date(initialUpdatedAt).getTime()
      );

      await pgClient.query("DELETE FROM public.product_categories WHERE id = $1;", [catId]);
    });
  });

  describe("T011: Permission Catalog Seeds & Deterministic Role Mappings", () => {
    it("verifies all 9 catalog permissions are seeded in public.permissions", async () => {
      const res = await pgClient.query(`
        SELECT id FROM public.permissions
        WHERE id IN (
          'products:read', 'products:read_cost', 'products:create', 'products:update', 'products:archive',
          'categories:read', 'categories:create', 'categories:update', 'categories:archive'
        );
      `);
      expect(res.rows.length).toBe(9);
    });

    it("verifies deterministic role_permissions mappings for Admin, Manager, and Cashier", async () => {
      const res = await pgClient.query(`
        SELECT role, permission_id FROM public.role_permissions
        WHERE permission_id LIKE 'products:%' OR permission_id LIKE 'categories:%';
      `);

      const rolePerms = new Map<string, Set<string>>();
      for (const row of res.rows) {
        if (!rolePerms.has(row.role)) rolePerms.set(row.role, new Set());
        rolePerms.get(row.role)!.add(row.permission_id);
      }

      // Admin has all 9
      expect(rolePerms.get("admin")?.size).toBe(9);

      // Manager has operational (7 permissions, no archive)
      expect(rolePerms.get("manager")?.has("products:read")).toBe(true);
      expect(rolePerms.get("manager")?.has("products:read_cost")).toBe(true);
      expect(rolePerms.get("manager")?.has("products:create")).toBe(true);
      expect(rolePerms.get("manager")?.has("products:update")).toBe(true);
      expect(rolePerms.get("manager")?.has("products:archive")).toBe(false);
      expect(rolePerms.get("manager")?.has("categories:read")).toBe(true);
      expect(rolePerms.get("manager")?.has("categories:create")).toBe(true);
      expect(rolePerms.get("manager")?.has("categories:update")).toBe(true);
      expect(rolePerms.get("manager")?.has("categories:archive")).toBe(false);

      // Cashier has read-only (2 permissions)
      expect(rolePerms.get("cashier")?.has("products:read")).toBe(true);
      expect(rolePerms.get("cashier")?.has("categories:read")).toBe(true);
      expect(rolePerms.get("cashier")?.has("products:read_cost")).toBe(false);
      expect(rolePerms.get("cashier")?.has("products:create")).toBe(false);
    });
  });

  describe("T012: Row-Level Security (RLS) & Direct DML Denial", () => {
    it("verifies FORCE ROW LEVEL SECURITY is enabled on product_categories, products, product_costs", async () => {
      const res = await pgClient.query(`
        SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_class
        WHERE relname IN ('product_categories', 'products', 'product_costs')
          AND relnamespace = 'public'::regnamespace;
      `);
      expect(res.rows.length).toBe(3);
      for (const row of res.rows) {
        expect(row.relrowsecurity).toBe(true);
        expect(row.relforcerowsecurity).toBe(true);
      }
    });

    it("verifies authenticated client direct INSERT on products fails with PostgreSQL error 42501", async () => {
      const { error } = await ownerClient.from("products").insert({
        organization_id: testOrgId,
        name: "Direct Insert Test",
        sku: "DIRECT-INSERT-1",
        selling_price: 10,
        unit_of_measure: "piece",
        created_by: ownerUserId,
        updated_by: ownerUserId,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
    });

    it("verifies authenticated client direct UPDATE on products is denied by RLS (0 rows modified)", async () => {
      const { data } = await ownerClient
        .from("products")
        .update({ name: "Tampered" })
        .eq("organization_id", testOrgId)
        .select();
      expect(data).toHaveLength(0);
    });

    it("verifies authenticated client direct DELETE on products is denied by RLS (0 rows deleted)", async () => {
      const { data } = await ownerClient
        .from("products")
        .delete()
        .eq("organization_id", testOrgId)
        .select();
      expect(data).toHaveLength(0);
    });

    it("verifies Cashier direct SELECT on product_costs returns 0 rows", async () => {
      const { data, error } = await cashierClient.from("product_costs").select("*");
      expect(error).toBeNull();
      expect(data?.length).toBe(0);
    });
  });

  describe("T013: Supabase Storage Configuration & RLS Policies", () => {
    let storageProdId: string;
    let secondOrgProdId: string;
    const testImageName = "test-image.png";
    const dummyPng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic header
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, // IDAT
      0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, // IEND
      0x42, 0x60, 0x82,
    ]);

    beforeAll(async () => {
      const p1 = await pgClient.query(`
        INSERT INTO public.products (
          organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by
        ) VALUES (
          $1, 'Storage Test Product', 'STORAGE-TEST-001', 19.9900, 'piece', 'active', $2, $2
        ) RETURNING id;
      `, [testOrgId, ownerUserId]);
      storageProdId = p1.rows[0].id;

      const p2 = await pgClient.query(`
        INSERT INTO public.products (
          organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by
        ) VALUES (
          $1, 'Second Org Storage Product', 'STORAGE-TEST-002', 29.9900, 'piece', 'active', $2, $2
        ) RETURNING id;
      `, [secondOrgId, ownerUserId]);
      secondOrgProdId = p2.rows[0].id;
    });

    afterAll(async () => {
      try {
        await adminClient.storage
          .from("product-images")
          .remove([
            `${testOrgId}/${storageProdId}/${testImageName}`,
            `${testOrgId}/${storageProdId}/updated.png`,
            `${secondOrgId}/${secondOrgProdId}/${testImageName}`,
          ]);
      } catch {
        // ignore cleanup errors
      }
      if (storageProdId) {
        await pgClient.query("DELETE FROM public.products WHERE id = $1;", [storageProdId]);
      }
      if (secondOrgProdId) {
        await pgClient.query("DELETE FROM public.products WHERE id = $1;", [secondOrgProdId]);
      }
    });

    it("verifies private product-images bucket configuration in storage.buckets", async () => {
      const res = await pgClient.query(`
        SELECT id, name, public, file_size_limit, allowed_mime_types
        FROM storage.buckets
        WHERE id = 'product-images';
      `);
      expect(res.rows.length).toBe(1);
      const b = res.rows[0];
      expect(b.public).toBe(false);
      expect(b.file_size_limit).toBe("5242880");
      expect(b.allowed_mime_types).toEqual(
        expect.arrayContaining(["image/jpeg", "image/png", "image/webp", "image/gif"])
      );
    });

    it("verifies 4 explicit storage RLS policies on storage.objects", async () => {
      const res = await pgClient.query(`
        SELECT policyname, cmd
        FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname LIKE 'product_images_%';
      `);
      const names = res.rows.map((r: { policyname: string }) => r.policyname);
      expect(names).toContain("product_images_select");
      expect(names).toContain("product_images_insert");
      expect(names).toContain("product_images_update");
      expect(names).toContain("product_images_delete");
    });

    it("allows authorized Owner to upload an image for an existing product in their organization", async () => {
      const uploadPath = `${testOrgId}/${storageProdId}/${testImageName}`;
      const { data, error } = await ownerClient.storage
        .from("product-images")
        .upload(uploadPath, dummyPng, { contentType: "image/png", upsert: true });

      expect(error).toBeNull();
      expect(data?.path).toBe(uploadPath);
    });

    it("denies Cashier from uploading an image because they lack products:create and products:update", async () => {
      const uploadPath = `${testOrgId}/${storageProdId}/cashier-blocked.png`;
      const { data, error } = await cashierClient.storage
        .from("product-images")
        .upload(uploadPath, dummyPng, { contentType: "image/png" });

      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("denies user from uploading an image under another tenant's organization path", async () => {
      // Owner of testOrg attempts to upload to secondOrgId path for a product not in secondOrgId
      const uploadPath = `${secondOrgId}/${storageProdId}/cross-tenant.png`;
      const { data, error } = await ownerClient.storage
        .from("product-images")
        .upload(uploadPath, dummyPng, { contentType: "image/png" });

      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("denies uploading an image for a nonexistent product", async () => {
      const nonExistentProdId = "00000000-0000-0000-0000-000000000099";
      const uploadPath = `${testOrgId}/${nonExistentProdId}/nonexistent.png`;
      const { data, error } = await ownerClient.storage
        .from("product-images")
        .upload(uploadPath, dummyPng, { contentType: "image/png" });

      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("allows authorized users (Owner and Cashier) to download an existing product image via products:read", async () => {
      const uploadPath = `${testOrgId}/${storageProdId}/${testImageName}`;
      
      // Owner download
      const { data: ownerData, error: ownerErr } = await ownerClient.storage
        .from("product-images")
        .download(uploadPath);
      expect(ownerErr).toBeNull();
      expect(ownerData).not.toBeNull();

      // Cashier download (Cashier has products:read and is active member of testOrg)
      const { data: cashierData, error: cashierErr } = await cashierClient.storage
        .from("product-images")
        .download(uploadPath);
      expect(cashierErr).toBeNull();
      expect(cashierData).not.toBeNull();
    });

    it("denies cross-tenant retrieval of product images", async () => {
      // Upload an image for secondOrgProdId in secondOrgId
      const secondOrgPath = `${secondOrgId}/${secondOrgProdId}/${testImageName}`;
      const { error: prepErr } = await ownerClient.storage
        .from("product-images")
        .upload(secondOrgPath, dummyPng, { contentType: "image/png", upsert: true });
      expect(prepErr).toBeNull();

      // Cashier is ONLY a member of testOrgId, NOT secondOrgId
      const { data, error } = await cashierClient.storage
        .from("product-images")
        .download(secondOrgPath);

      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("validates UPDATE on storage objects allows owner update but prevents cashier mutation", async () => {
      const uploadPath = `${testOrgId}/${storageProdId}/${testImageName}`;

      // Cashier update attempt is rejected
      const { data: cashUpdateData, error: cashUpdateErr } = await cashierClient.storage
        .from("product-images")
        .update(uploadPath, dummyPng, { contentType: "image/png" });
      expect(cashUpdateErr).not.toBeNull();
      expect(cashUpdateData).toBeNull();

      // Owner update succeeds
      const { data: ownerUpdateData, error: ownerUpdateErr } = await ownerClient.storage
        .from("product-images")
        .update(uploadPath, dummyPng, { contentType: "image/png" });
      expect(ownerUpdateErr).toBeNull();
      expect(ownerUpdateData?.path).toBe(uploadPath);
    });

    it("enforces DELETE authorization allowing Owner to delete but denying Cashier", async () => {
      const uploadPath = `${testOrgId}/${storageProdId}/${testImageName}`;

      // Cashier delete attempt fails to remove
      await cashierClient.storage
        .from("product-images")
        .remove([uploadPath]);
      // Verify object still exists by downloading with owner
      const { data: stillThere } = await ownerClient.storage
        .from("product-images")
        .download(uploadPath);
      expect(stillThere).not.toBeNull();

      // Owner delete succeeds
      const { data: ownerDelData, error: ownerDelErr } = await ownerClient.storage
        .from("product-images")
        .remove([uploadPath]);
      expect(ownerDelErr).toBeNull();
      expect(ownerDelData).toEqual(expect.arrayContaining([expect.objectContaining({ name: uploadPath })]));
    });
  });

  describe("T014: Category Mutation Stored Procedures", () => {
    let createdCatId: string;

    it("creates a product category via create_product_category RPC", async () => {
      const { data, error } = await ownerClient.rpc("create_product_category", {
        p_org_id: testOrgId,
        p_name: "Electronics",
        p_description: "Electronic gadgets and accessories",
      });

      expect(error).toBeNull();
      expect(data).toMatchObject({
        success: true,
        data: {
          name: "Electronics",
          description: "Electronic gadgets and accessories",
          status: "active",
        },
      });
      createdCatId = (data as any).data.id;

      // Verify audit log
      const auditRes = await pgClient.query(`
        SELECT event_type, metadata FROM public.organization_audit_events
        WHERE organization_id = $1 AND event_type = 'category_created'
        ORDER BY created_at DESC LIMIT 1;
      `, [testOrgId]);
      expect(auditRes.rows.length).toBe(1);
      expect(auditRes.rows[0].metadata.name).toBe("Electronics");
    });

    it("rejects duplicate category name with P0006", async () => {
      const { error } = await ownerClient.rpc("create_product_category", {
        p_org_id: testOrgId,
        p_name: "  electronics  ", // case-insensitive trimmed duplicate
      });
      expect(error).not.toBeNull();
      expect(error?.message).toContain("already exists");
    });

    it("updates product category via update_product_category RPC", async () => {
      const { data, error } = await ownerClient.rpc("update_product_category", {
        p_org_id: testOrgId,
        p_category_id: createdCatId,
        p_name: "Consumer Electronics",
        p_description: "Updated description",
      });
      expect(error).toBeNull();
      expect((data as any).data.name).toBe("Consumer Electronics");
    });

    it("archives category via archive_product_category RPC", async () => {
      const { data, error } = await ownerClient.rpc("archive_product_category", {
        p_org_id: testOrgId,
        p_category_id: createdCatId,
      });
      expect(error).toBeNull();
      expect((data as any).data.status).toBe("archived");

      // Attempting to update archived category fails with P0015
      const { error: updErr } = await ownerClient.rpc("update_product_category", {
        p_org_id: testOrgId,
        p_category_id: createdCatId,
        p_name: "Cannot Update Archived",
      });
      expect(updErr).not.toBeNull();
    });

    it("restores archived category via restore_product_category RPC", async () => {
      const { data, error } = await ownerClient.rpc("restore_product_category", {
        p_org_id: testOrgId,
        p_category_id: createdCatId,
      });
      expect(error).toBeNull();
      expect((data as any).data.status).toBe("active");
    });
  });

  describe("T015 & T016: Product CRUD RPCs & Cost Confidentiality", () => {
    let testCategoryId: string;
    let createdProdId: string;

    beforeAll(async () => {
      const catRes = await pgClient.query(`
        INSERT INTO public.product_categories (organization_id, name, created_by, updated_by)
        VALUES ($1, 'Catalog Products Cat', $2, $2)
        RETURNING id;
      `, [testOrgId, ownerUserId]);
      testCategoryId = catRes.rows[0].id;
    });

    it("creates a product with atomic cost persistence and masked return", async () => {
      const { data, error } = await ownerClient.rpc("create_product", {
        p_org_id: testOrgId,
        p_name: "Wireless Mouse",
        p_sku: "MOUSE-WL-001",
        p_selling_price: 29.99,
        p_cost_price: 15.50,
        p_unit_of_measure: "piece",
        p_barcode: "123456789012",
        p_category_id: testCategoryId,
      });

      expect(error).toBeNull();
      const payload = (data as any).data;
      expect(payload.name).toBe("Wireless Mouse");
      expect(payload.sku).toBe("MOUSE-WL-001");
      expect(payload.selling_price).toBe(29.99);
      expect(payload.cost_price).toBe(15.5);
      expect(payload.version).toBe(1);
      createdProdId = payload.id;

      // Verify physical table separation in product_costs
      const costRes = await pgClient.query(
        "SELECT cost_price FROM public.product_costs WHERE product_id = $1;",
        [createdProdId]
      );
      expect(costRes.rows.length).toBe(1);
      expect(Number(costRes.rows[0].cost_price)).toBe(15.5);

      // Verify audit event does NOT expose numeric cost
      const auditRes = await pgClient.query(`
        SELECT metadata FROM public.organization_audit_events
        WHERE organization_id = $1 AND event_type = 'product_created'
        ORDER BY created_at DESC LIMIT 1;
      `, [testOrgId]);
      expect(auditRes.rows.length).toBe(1);
      const meta = auditRes.rows[0].metadata;
      expect(meta.cost_set).toBe(true);
      expect(meta.cost_price).toBeUndefined();
    });

    it("rejects duplicate SKU (P0006)", async () => {
      const { error } = await ownerClient.rpc("create_product", {
        p_org_id: testOrgId,
        p_name: "Duplicate Mouse",
        p_sku: "MOUSE-WL-001", // duplicate SKU
        p_selling_price: 19.99,
      });
      expect(error).not.toBeNull();
      expect(error?.message).toContain("already exists");
    });

    it("rejects invalid UOM (P0009)", async () => {
      const { error } = await ownerClient.rpc("create_product", {
        p_org_id: testOrgId,
        p_name: "Invalid UOM Product",
        p_sku: "SKU-INVALID-UOM",
        p_selling_price: 10,
        p_unit_of_measure: "invalid_uom",
      });
      expect(error).not.toBeNull();
    });

    it("rejects cross-tenant category assignment (P0002)", async () => {
      // Create category in second org
      const secCatRes = await pgClient.query(`
        INSERT INTO public.product_categories (organization_id, name, created_by, updated_by)
        VALUES ($1, 'Second Org Cat', $2, $2)
        RETURNING id;
      `, [secondOrgId, ownerUserId]);
      const secCatId = secCatRes.rows[0].id;

      const { error } = await ownerClient.rpc("create_product", {
        p_org_id: testOrgId,
        p_name: "Cross Tenant Product",
        p_sku: "SKU-CROSS-TENANT",
        p_selling_price: 10,
        p_category_id: secCatId, // from second org!
      });
      expect(error).not.toBeNull();
    });

    it("updates product with OCC version matching and cost_operation", async () => {
      // 1. Update with version match
      const { data, error } = await ownerClient.rpc("update_product", {
        p_org_id: testOrgId,
        p_product_id: createdProdId,
        p_expected_version: 1,
        p_name: "Wireless Mouse Pro",
        p_sku: "MOUSE-WL-001",
        p_selling_price: 34.99,
        p_cost_price: 18.00,
        p_cost_operation: "set",
      });
      expect(error).toBeNull();
      const updated = (data as any).data;
      expect(updated.name).toBe("Wireless Mouse Pro");
      expect(updated.version).toBe(2);

      // Verify cost was updated in product_costs
      const costRes = await pgClient.query(
        "SELECT cost_price FROM public.product_costs WHERE product_id = $1;",
        [createdProdId]
      );
      expect(Number(costRes.rows[0].cost_price)).toBe(18.0);

      // 2. Concurrency Conflict: stale expected_version raises P0010
      const { error: staleErr } = await ownerClient.rpc("update_product", {
        p_org_id: testOrgId,
        p_product_id: createdProdId,
        p_expected_version: 1, // Stale! Current version is 2
        p_name: "Stale Edit",
        p_sku: "MOUSE-WL-001",
        p_selling_price: 39.99,
      });
      expect(staleErr).not.toBeNull();
      expect(staleErr?.message).toContain("Stale update conflict");
      expect((staleErr as any)?.code).toBe("P0010");

      // Missing required price when cost_operation is 'set' raises P0008
      const { error: missingPriceErr } = await ownerClient.rpc("update_product", {
        p_org_id: testOrgId,
        p_product_id: createdProdId,
        p_expected_version: 2,
        p_name: "Wireless Mouse Pro",
        p_sku: "MOUSE-WL-001",
        p_selling_price: 34.99,
        p_cost_operation: "set",
        // p_cost_price omitted / null
      });
      expect(missingPriceErr).not.toBeNull();
      expect(missingPriceErr?.message).toContain("Cost price required when cost_operation is set");
      expect((missingPriceErr as any)?.code).toBe("P0008");

      // 3. Clear cost operation
      const { error: clearErr } = await ownerClient.rpc("update_product", {
        p_org_id: testOrgId,
        p_product_id: createdProdId,
        p_expected_version: 2,
        p_name: "Wireless Mouse Pro",
        p_sku: "MOUSE-WL-001",
        p_selling_price: 34.99,
        p_cost_operation: "clear",
      });
      expect(clearErr).toBeNull();

      // Verify cost row was deleted
      const deletedCostRes = await pgClient.query(
        "SELECT cost_price FROM public.product_costs WHERE product_id = $1;",
        [createdProdId]
      );
      expect(deletedCostRes.rows.length).toBe(0);
    });
  });

  describe("T017: Product Lifecycle Transitions", () => {
    let lifecycleProdId: string;

    beforeAll(async () => {
      const prodRes = await pgClient.query(`
        INSERT INTO public.products (
          organization_id, name, sku, selling_price, unit_of_measure, status, version, created_by, updated_by
        ) VALUES (
          $1, 'Lifecycle Test Item', 'LIFECYCLE-1', 12.0000, 'piece', 'active', 1, $2, $2
        ) RETURNING id;
      `, [testOrgId, ownerUserId]);
      lifecycleProdId = prodRes.rows[0].id;
    });

    it("toggles product status between active and inactive", async () => {
      const { data, error } = await ownerClient.rpc("toggle_product_status", {
        p_org_id: testOrgId,
        p_product_id: lifecycleProdId,
        p_expected_version: 1,
        p_new_status: "inactive",
      });
      expect(error).toBeNull();
      expect((data as any).data.status).toBe("inactive");
      expect((data as any).data.version).toBe(2);

      // Direct toggle to 'archived' is rejected with P0015
      const { error: invalidErr } = await ownerClient.rpc("toggle_product_status", {
        p_org_id: testOrgId,
        p_product_id: lifecycleProdId,
        p_expected_version: 2,
        p_new_status: "archived",
      });
      expect(invalidErr).not.toBeNull();

      // Stale OCC version raises P0010
      const { error: staleToggleErr } = await ownerClient.rpc("toggle_product_status", {
        p_org_id: testOrgId,
        p_product_id: lifecycleProdId,
        p_expected_version: 999, // Stale!
        p_new_status: "active",
      });
      expect(staleToggleErr).not.toBeNull();
      expect((staleToggleErr as any)?.code).toBe("P0010");
    });

    it("archives product and retains permanent SKU reservation", async () => {
      // Stale OCC version on archive raises P0010
      const { error: staleArchiveErr } = await ownerClient.rpc("archive_product", {
        p_org_id: testOrgId,
        p_product_id: lifecycleProdId,
        p_expected_version: 999, // Stale!
      });
      expect(staleArchiveErr).not.toBeNull();
      expect((staleArchiveErr as any)?.code).toBe("P0010");

      const { data, error } = await ownerClient.rpc("archive_product", {
        p_org_id: testOrgId,
        p_product_id: lifecycleProdId,
        p_expected_version: 2,
      });
      expect(error).toBeNull();
      expect((data as any).data.status).toBe("archived");
      expect((data as any).data.version).toBe(3);

      // Attempting to register another product with the same SKU fails even though original is archived
      const { error: skuErr } = await ownerClient.rpc("create_product", {
        p_org_id: testOrgId,
        p_name: "Colliding SKU Item",
        p_sku: "LIFECYCLE-1", // permanent reservation!
        p_selling_price: 15.00,
      });
      expect(skuErr).not.toBeNull();
      expect(skuErr?.message).toContain("already exists");
    });

    it("restores archived product to active status", async () => {
      // Stale OCC version on restore raises P0010
      const { error: staleRestoreErr } = await ownerClient.rpc("restore_product", {
        p_org_id: testOrgId,
        p_product_id: lifecycleProdId,
        p_expected_version: 999, // Stale!
      });
      expect(staleRestoreErr).not.toBeNull();
      expect((staleRestoreErr as any)?.code).toBe("P0010");

      const { data, error } = await ownerClient.rpc("restore_product", {
        p_org_id: testOrgId,
        p_product_id: lifecycleProdId,
        p_expected_version: 3,
      });
      expect(error).toBeNull();
      expect((data as any).data.status).toBe("active");
      expect((data as any).data.version).toBe(4);
    });
  });

  describe("T018: Security Hardening & Privilege Revocation", () => {
    it("verifies all 10 functions are owned by postgres with locked search_path", async () => {
      const res = await pgClient.query(`
        SELECT p.proname, pg_get_userbyid(p.proowner) as owner, p.proconfig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = ANY($1::text[]);
      `, [feature003Functions]);

      expect(res.rows.length).toBe(10);
      for (const row of res.rows) {
        expect(row.owner).toBe("postgres");
        expect(row.proconfig).toEqual(expect.arrayContaining(["search_path=pg_catalog, public, pg_temp"]));
      }
    });

    it("verifies PUBLIC and anon have 0 privileges on all Feature 003 routines", async () => {
      const res = await pgClient.query(`
        SELECT count(*) as count
        FROM information_schema.routine_privileges
        WHERE grantee IN ('PUBLIC', 'anon')
          AND specific_schema = 'public'
          AND routine_name = ANY($1::text[]);
      `, [feature003Functions]);

      expect(Number(res.rows[0].count)).toBe(0);
    });

    it("verifies service_role has 0 EXECUTE privileges on the 9 Feature 003 mutation routines", async () => {
      // 1. Check routine_privileges table for direct grants to service_role
      const privRes = await pgClient.query(`
        SELECT count(*) as count
        FROM information_schema.routine_privileges
        WHERE grantee = 'service_role'
          AND specific_schema = 'public'
          AND routine_name = ANY($1::text[]);
      `, [feature003MutationFunctions]);
      expect(Number(privRes.rows[0].count)).toBe(0);

      // 2. Check effective function privilege via has_function_privilege()
      const effRes = await pgClient.query(`
        SELECT p.proname,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
               has_function_privilege('service_role', p.oid, 'EXECUTE') AS serv_exec,
               has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
               has_function_privilege('public', p.oid, 'EXECUTE') AS pub_exec
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = ANY($1::text[]);
      `, [feature003MutationFunctions]);

      expect(effRes.rows.length).toBe(9);
      for (const row of effRes.rows) {
        expect(row.auth_exec).toBe(true);
        expect(row.serv_exec).toBe(false);
        expect(row.anon_exec).toBe(false);
        expect(row.pub_exec).toBe(false);
      }

      // 3. Direct PostgreSQL ACL inspection via aclexplode for PUBLIC (grantee 0)
      const aclRes = await pgClient.query(`
        SELECT p.proname,
               EXISTS (
                 SELECT 1
                 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                 WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
               ) AS has_public_execute
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = ANY($1::text[])
        ORDER BY p.proname;
      `, [feature003MutationFunctions]);

      expect(aclRes.rows.length).toBe(9);
      for (const row of aclRes.rows) {
        expect(row.has_public_execute).toBe(false);
      }

      // Explicitly verify zero ACL entries exist with grantee = 0 and privilege_type = 'EXECUTE'
      const explodedEntries = await pgClient.query(`
        SELECT p.proname, (a).grantee, (a).privilege_type
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace,
        LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
        WHERE n.nspname = 'public'
          AND p.proname = ANY($1::text[])
          AND (a).grantee = 0
          AND (a).privilege_type = 'EXECUTE';
      `, [feature003MutationFunctions]);

      expect(explodedEntries.rows.length).toBe(0);
    });
  });
});

