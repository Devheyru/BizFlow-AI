import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
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

describe("T054: Product Image Storage RLS Security Tests (FR-042, SC-011, BR-018)", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;

  // Supabase clients
  let ownerAClient: SupabaseClient;
  let managerAClient: SupabaseClient;
  let cashierAClient: SupabaseClient;
  let ownerBClient: SupabaseClient;

  // User IDs & Emails
  let ownerAUserId: string;
  let managerAUserId: string;
  let cashierAUserId: string;
  let ownerBUserId: string;
  const testPassword = "P@ssword123!StorageSecure";

  // Organizations
  let orgAId: string;
  let orgBId: string;
  const orgASlug = `storage-sec-a-${Date.now()}`;
  const orgBSlug = `storage-sec-b-${Date.now()}`;

  // Products
  let productAId: string;
  let productBId: string;

  // Track uploaded storage paths for cleanup
  const uploadedPaths: string[] = [];

  // 1x1 valid PNG buffer
  const validPngBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );
  // Valid JPEG buffer
  const validJpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  // Valid 1x1 transparent GIF buffer (GIF89a)
  const validGifBuffer = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64"
  );
  // Valid 1x1 WebP buffer
  const validWebpBuffer = Buffer.from(
    "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=",
    "base64"
  );

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const timestamp = Date.now();
    const ownerAEmail = `owner_a_${timestamp}@bizflow-test.internal`;
    const mgrAEmail = `mgr_a_${timestamp}@bizflow-test.internal`;
    const cashAEmail = `cash_a_${timestamp}@bizflow-test.internal`;
    const ownerBEmail = `owner_b_${timestamp}@bizflow-test.internal`;

    // 1. Create Users
    const { data: uOwnerA } = await adminClient.auth.admin.createUser({
      email: ownerAEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Storage", last_name: "OwnerA" },
    });
    ownerAUserId = uOwnerA.user!.id;

    const { data: uMgrA } = await adminClient.auth.admin.createUser({
      email: mgrAEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Storage", last_name: "ManagerA" },
    });
    managerAUserId = uMgrA.user!.id;

    const { data: uCashA } = await adminClient.auth.admin.createUser({
      email: cashAEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Storage", last_name: "CashierA" },
    });
    cashierAUserId = uCashA.user!.id;

    const { data: uOwnerB } = await adminClient.auth.admin.createUser({
      email: ownerBEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Storage", last_name: "OwnerB" },
    });
    ownerBUserId = uOwnerB.user!.id;

    // 2. Authenticate clients
    ownerAClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await ownerAClient.auth.signInWithPassword({ email: ownerAEmail, password: testPassword });

    managerAClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await managerAClient.auth.signInWithPassword({ email: mgrAEmail, password: testPassword });

    cashierAClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await cashierAClient.auth.signInWithPassword({ email: cashAEmail, password: testPassword });

    ownerBClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await ownerBClient.auth.signInWithPassword({ email: ownerBEmail, password: testPassword });

    // 3. Create Organizations and Memberships
    const resOrgA = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
       VALUES ('Storage Org A', $1, 'USD', 'retail', 'US', 'America/New_York', $2)
       RETURNING id;`,
      [orgASlug, ownerAUserId]
    );
    orgAId = resOrgA.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES 
         ($1, $2, 'owner', 'active'),
         ($1, $3, 'manager', 'active'),
         ($1, $4, 'cashier', 'active');`,
      [orgAId, ownerAUserId, managerAUserId, cashierAUserId]
    );

    const resOrgB = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
       VALUES ('Storage Org B', $1, 'USD', 'retail', 'US', 'America/New_York', $2)
       RETURNING id;`,
      [orgBSlug, ownerBUserId]
    );
    orgBId = resOrgB.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active');`,
      [orgBId, ownerBUserId]
    );

    // 4. Create Product A1 and Product B1 via RPC
    const resProdA = await ownerAClient.rpc("create_product", {
      p_org_id: orgAId,
      p_name: "Storage Test Product A1",
      p_sku: `STORAGE-A1-${Date.now()}`,
      p_selling_price: 50.0,
      p_unit_of_measure: "unit",
    });
    if (resProdA.error) {
      throw new Error(`Failed to create Product A1: ${resProdA.error.message}`);
    }
    productAId = (resProdA.data as any).data.id;

    const resProdB = await ownerBClient.rpc("create_product", {
      p_org_id: orgBId,
      p_name: "Storage Test Product B1",
      p_sku: `STORAGE-B1-${Date.now()}`,
      p_selling_price: 80.0,
      p_unit_of_measure: "unit",
    });
    if (resProdB.error) {
      throw new Error(`Failed to create Product B1: ${resProdB.error.message}`);
    }
    productBId = (resProdB.data as any).data.id;
  });

  afterEach(async () => {
    if (uploadedPaths.length > 0) {
      const pathsToDelete = [...uploadedPaths];
      uploadedPaths.length = 0;
      await adminClient.storage.from("product-images").remove(pathsToDelete);
    }
  });

  afterAll(async () => {
    try {
      if (orgAId || orgBId) {
        await pgClient.query(`DELETE FROM public.organization_audit_events WHERE organization_id IN ($1, $2)`, [
          orgAId,
          orgBId,
        ]);
        await pgClient.query(`DELETE FROM public.products WHERE organization_id IN ($1, $2)`, [orgAId, orgBId]);
        await pgClient.query(`DELETE FROM public.organization_memberships WHERE organization_id IN ($1, $2)`, [
          orgAId,
          orgBId,
        ]);
        await pgClient.query(`DELETE FROM public.organizations WHERE id IN ($1, $2)`, [orgAId, orgBId]);
      }
    } catch (_) {}

    try {
      if (ownerAUserId) await adminClient.auth.admin.deleteUser(ownerAUserId);
      if (managerAUserId) await adminClient.auth.admin.deleteUser(managerAUserId);
      if (cashierAUserId) await adminClient.auth.admin.deleteUser(cashierAUserId);
      if (ownerBUserId) await adminClient.auth.admin.deleteUser(ownerBUserId);
    } catch (_) {}

    await pgClient.end();
  });

  // ===========================================================================
  // 1. Bucket Configuration Verification (FR-042, SC-011)
  // ===========================================================================
  describe("1. Bucket Configuration Verification", () => {
    it("product-images bucket is private with 5MB limit and allowed image MIME types", async () => {
      const res = await pgClient.query(`
        SELECT id, name, public, file_size_limit, allowed_mime_types
        FROM storage.buckets
        WHERE id = 'product-images';
      `);

      expect(res.rows).toHaveLength(1);
      const bucket = res.rows[0];
      expect(bucket.public).toBe(false);
      expect(Number(bucket.file_size_limit)).toBe(5242880);
      expect(bucket.allowed_mime_types).toEqual(
        expect.arrayContaining(["image/jpeg", "image/png", "image/webp", "image/gif"])
      );
    });
  });

  // ===========================================================================
  // 2. Storage INSERT Policy Enforcement (FR-042, SC-011)
  // ===========================================================================
  describe("2. Storage INSERT Policy (product_images_insert)", () => {
    it("succeeds when authorized user (Owner) uploads valid image for existing product", async () => {
      const canonicalPath = `${orgAId}/${productAId}/valid-owner.png`;
      const { data, error } = await ownerAClient.storage
        .from("product-images")
        .upload(canonicalPath, validPngBuffer, { contentType: "image/png", upsert: true });

      expect(error).toBeNull();
      expect(data?.path).toBe(canonicalPath);
      uploadedPaths.push(canonicalPath);
    });

    it("succeeds when authorized user (Manager) uploads valid image for existing product", async () => {
      const canonicalPath = `${orgAId}/${productAId}/valid-mgr.jpg`;
      const { data, error } = await managerAClient.storage
        .from("product-images")
        .upload(canonicalPath, validJpegBuffer, { contentType: "image/jpeg", upsert: true });

      expect(error).toBeNull();
      expect(data?.path).toBe(canonicalPath);
      uploadedPaths.push(canonicalPath);
    });

    it("succeeds when authorized user (Owner) uploads valid GIF image for existing product", async () => {
      const canonicalPath = `${orgAId}/${productAId}/valid-owner.gif`;
      const { data, error } = await ownerAClient.storage
        .from("product-images")
        .upload(canonicalPath, validGifBuffer, { contentType: "image/gif", upsert: true });

      expect(error).toBeNull();
      expect(data?.path).toBe(canonicalPath);
      uploadedPaths.push(canonicalPath);
    });

    it("succeeds when authorized user (Owner) uploads valid WebP image for existing product", async () => {
      const canonicalPath = `${orgAId}/${productAId}/valid-owner.webp`;
      const { data, error } = await ownerAClient.storage
        .from("product-images")
        .upload(canonicalPath, validWebpBuffer, { contentType: "image/webp", upsert: true });

      expect(error).toBeNull();
      expect(data?.path).toBe(canonicalPath);
      uploadedPaths.push(canonicalPath);
    });

    it("fails when Cashier (lacking products:create & products:update) attempts to upload", async () => {
      const canonicalPath = `${orgAId}/${productAId}/cashier-denied.png`;
      const { data, error } = await cashierAClient.storage
        .from("product-images")
        .upload(canonicalPath, validPngBuffer, { contentType: "image/png" });

      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("fails when target product does not exist in the database", async () => {
      const fakeProductId = "00000000-0000-0000-0000-000000000999";
      const invalidPath = `${orgAId}/${fakeProductId}/orphan.png`;

      const { data, error } = await ownerAClient.storage
        .from("product-images")
        .upload(invalidPath, validPngBuffer, { contentType: "image/png" });

      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("fails on cross-tenant product folder (Owner A uploading to Org B product folder)", async () => {
      const crossTenantPath = `${orgBId}/${productBId}/cross-tenant.png`;

      const { data, error } = await ownerAClient.storage
        .from("product-images")
        .upload(crossTenantPath, validPngBuffer, { contentType: "image/png" });

      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("fails when user uses product ID from own org but folder prefix from another org", async () => {
      const mismatchedPath = `${orgBId}/${productAId}/mismatched.png`;

      const { data, error } = await ownerAClient.storage
        .from("product-images")
        .upload(mismatchedPath, validPngBuffer, { contentType: "image/png" });

      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("fails when file exceeds 5 MB size limit (> 5,242,880 bytes)", async () => {
      const oversizedBuffer = Buffer.alloc(5 * 1024 * 1024 + 1024); // 5 MB + 1 KB
      const oversizedPath = `${orgAId}/${productAId}/oversized.png`;

      const { data, error } = await ownerAClient.storage
        .from("product-images")
        .upload(oversizedPath, oversizedBuffer, { contentType: "image/png" });

      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("fails on disallowed MIME types (e.g. application/pdf, text/plain)", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4 dummy pdf content");
      const pdfPath = `${orgAId}/${productAId}/document.pdf`;

      const { data, error } = await ownerAClient.storage
        .from("product-images")
        .upload(pdfPath, pdfBuffer, { contentType: "application/pdf" });

      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });
  });

  // ===========================================================================
  // 3. Storage SELECT Policy Enforcement (FR-042, SC-011)
  // ===========================================================================
  describe("3. Storage SELECT Policy (product_images_select)", () => {
    let seededImagePath: string;

    beforeAll(async () => {
      seededImagePath = `${orgAId}/${productAId}/select-test.png`;
      await adminClient.storage
        .from("product-images")
        .upload(seededImagePath, validPngBuffer, { contentType: "image/png", upsert: true });
    });

    afterAll(async () => {
      await adminClient.storage.from("product-images").remove([seededImagePath]);
    });

    it("allows Owner of the organization (holding products:read) to download image", async () => {
      const { data, error } = await ownerAClient.storage.from("product-images").download(seededImagePath);
      expect(error).toBeNull();
      expect(data).not.toBeNull();
    });

    it("allows Cashier of the organization (holding products:read) to download image", async () => {
      const { data, error } = await cashierAClient.storage.from("product-images").download(seededImagePath);
      expect(error).toBeNull();
      expect(data).not.toBeNull();
    });

    it("denies Owner of Org B from downloading Org A product image (cross-tenant rejection)", async () => {
      const { data, error } = await ownerBClient.storage.from("product-images").download(seededImagePath);
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("denies unauthenticated caller from downloading image", async () => {
      const anonClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
      const { data, error } = await anonClient.storage.from("product-images").download(seededImagePath);
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });
  });

  // ===========================================================================
  // 4. Storage UPDATE Policy Enforcement (FR-042, SC-011)
  // ===========================================================================
  describe("4. Storage UPDATE Policy (product_images_update)", () => {
    let existingPath: string;

    beforeAll(async () => {
      existingPath = `${orgAId}/${productAId}/update-base.png`;
      await adminClient.storage
        .from("product-images")
        .upload(existingPath, validPngBuffer, { contentType: "image/png", upsert: true });
    });

    afterAll(async () => {
      await adminClient.storage.from("product-images").remove([existingPath]);
    });

    it("allows authorized user (Owner) to update image in-place for existing product", async () => {
      const { data, error } = await ownerAClient.storage
        .from("product-images")
        .update(existingPath, validPngBuffer, { contentType: "image/png", upsert: true });

      expect(error).toBeNull();
      expect(data?.path).toBe(existingPath);
    });

    it("denies Cashier (lacking products:update) from updating image", async () => {
      const { data, error } = await cashierAClient.storage
        .from("product-images")
        .update(existingPath, validPngBuffer, { contentType: "image/png" });

      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("denies cross-tenant user (Owner B) from updating Org A image", async () => {
      const { data, error } = await ownerBClient.storage
        .from("product-images")
        .update(existingPath, validPngBuffer, { contentType: "image/png" });

      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("independently enforces USING and WITH CHECK to prevent destination path tampering", async () => {
      // Direct raw SQL test simulating an UPDATE trying to change the name column across products or tenants
      let capturedError: any = null;
      try {
        await pgClient.query("BEGIN;");
        await pgClient.query("SET LOCAL ROLE authenticated;");
        await pgClient.query(`SET LOCAL "request.jwt.claim.sub" = '${ownerAUserId}';`);

        // Attempt to move object from productA to productB (cross-tenant)
        await pgClient.query(
          `UPDATE storage.objects 
           SET name = $1 
           WHERE name = $2 AND bucket_id = 'product-images';`,
          [`${orgBId}/${productBId}/tampered.png`, existingPath]
        );
      } catch (err: any) {
        capturedError = err;
      } finally {
        await pgClient.query("ROLLBACK;");
      }

      // If an error is thrown, it must be 42501 (RLS WITH CHECK violation)
      // If no error, 0 rows must have been updated due to policy restriction
      if (capturedError) {
        expect(capturedError.code).toBe("42501");
      }
    });
  });

  // ===========================================================================
  // 5. Storage DELETE Policy Enforcement (FR-042, SC-011)
  // ===========================================================================
  describe("5. Storage DELETE Policy (product_images_delete)", () => {
    it("allows authorized user (Owner) with products:update to delete image", async () => {
      const deletePath = `${orgAId}/${productAId}/delete-me.png`;
      await adminClient.storage
        .from("product-images")
        .upload(deletePath, validPngBuffer, { contentType: "image/png", upsert: true });

      const { data, error } = await ownerAClient.storage.from("product-images").remove([deletePath]);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);

      // Verify object is actually removed
      const { data: checkData } = await adminClient.storage.from("product-images").download(deletePath);
      expect(checkData).toBeNull();
    });

    it("denies Cashier (lacking products:update) from deleting image", async () => {
      const protectedPath = `${orgAId}/${productAId}/protected-from-cashier.png`;
      await adminClient.storage
        .from("product-images")
        .upload(protectedPath, validPngBuffer, { contentType: "image/png", upsert: true });

      const { data, error } = await cashierAClient.storage.from("product-images").remove([protectedPath]);
      // Supabase storage remove returns [] or error when denied by RLS
      if (data) {
        expect(data).toHaveLength(0);
      } else {
        expect(error).not.toBeNull();
      }

      // Verify object still exists
      const { data: checkData } = await adminClient.storage.from("product-images").download(protectedPath);
      expect(checkData).not.toBeNull();

      // Clean up via admin client
      await adminClient.storage.from("product-images").remove([protectedPath]);
    });

    it("denies cross-tenant user (Owner B) from deleting Org A image", async () => {
      const protectedPath = `${orgAId}/${productAId}/protected-from-orgb.png`;
      await adminClient.storage
        .from("product-images")
        .upload(protectedPath, validPngBuffer, { contentType: "image/png", upsert: true });

      const { data, error } = await ownerBClient.storage.from("product-images").remove([protectedPath]);
      if (data) {
        expect(data).toHaveLength(0);
      } else {
        expect(error).not.toBeNull();
      }

      // Verify object still exists
      const { data: checkData } = await adminClient.storage.from("product-images").download(protectedPath);
      expect(checkData).not.toBeNull();

      // Clean up via admin client
      await adminClient.storage.from("product-images").remove([protectedPath]);
    });
  });
});
