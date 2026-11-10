import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { purgeOrphanedImages } from "../../scripts/purge-orphaned-images";

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

describe("T059: Orphaned Product Image Cleanup (FR-042, BR-018)", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;

  let ownerAUserId: string;
  let orgAId: string;
  let orgBId: string;

  let activeProductId: string;
  let inactiveProductId: string;
  let archivedProductId: string;

  // Track created image paths
  let oldOrphanPath: string;
  let youngOrphanPath: string;
  let activeProductImagePath: string;
  let inactiveProductImagePath: string;
  let archivedProductImagePath: string;
  let orgBImagePath: string;

  const validPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const timestamp = Date.now();
    const ownerEmail = `purge_${timestamp}@bizflow-test.internal`;
    const { data: uData } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: "P@ssword123!PurgeTest",
      email_confirm: true,
    });
    ownerAUserId = uData.user!.id;

    // Create Org A
    const resOrgA = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
       VALUES ('Purge Org A', $1, 'USD', 'retail', 'US', 'UTC', $2) RETURNING id;`,
      [`purge-org-a-${timestamp}`, ownerAUserId]
    );
    orgAId = resOrgA.rows[0].id;
    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active');`,
      [orgAId, ownerAUserId]
    );

    // Create Org B
    const resOrgB = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
       VALUES ('Purge Org B', $1, 'USD', 'retail', 'US', 'UTC', $2) RETURNING id;`,
      [`purge-org-b-${timestamp}`, ownerAUserId]
    );
    orgBId = resOrgB.rows[0].id;

    // Create Active Product in Org A
    const resProdActive = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, version, created_by, updated_by)
       VALUES ($1, 'Active Purge Product', $2, 10, 'unit', 'active', 1, $3, $3) RETURNING id;`,
      [orgAId, `SKU-PURGE-ACT-${timestamp}`, ownerAUserId]
    );
    activeProductId = resProdActive.rows[0].id;

    // Create Inactive Product in Org A
    const resProdInactive = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, version, created_by, updated_by)
       VALUES ($1, 'Inactive Purge Product', $2, 10, 'unit', 'inactive', 1, $3, $3) RETURNING id;`,
      [orgAId, `SKU-PURGE-INACT-${timestamp}`, ownerAUserId]
    );
    inactiveProductId = resProdInactive.rows[0].id;

    // Create Archived Product in Org A
    const resProdArchived = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, version, created_by, updated_by, archived_at, archived_by)
       VALUES ($1, 'Archived Purge Product', $2, 10, 'unit', 'archived', 1, $3, $3, now(), $3) RETURNING id;`,
      [orgAId, `SKU-PURGE-ARCH-${timestamp}`, ownerAUserId]
    );
    archivedProductId = resProdArchived.rows[0].id;

    // Upload Storage Images
    activeProductImagePath = `${orgAId}/${activeProductId}/active.png`;
    inactiveProductImagePath = `${orgAId}/${inactiveProductId}/inactive.png`;
    archivedProductImagePath = `${orgAId}/${archivedProductId}/archived.png`;
    oldOrphanPath = `${orgAId}/${activeProductId}/old-orphan.png`;
    youngOrphanPath = `${orgAId}/${activeProductId}/young-orphan.png`;
    orgBImagePath = `${orgBId}/${activeProductId}/org-b.png`;

    await adminClient.storage.from("product-images").upload(activeProductImagePath, validPng, { contentType: "image/png" });
    await adminClient.storage.from("product-images").upload(inactiveProductImagePath, validPng, { contentType: "image/png" });
    await adminClient.storage.from("product-images").upload(archivedProductImagePath, validPng, { contentType: "image/png" });
    await adminClient.storage.from("product-images").upload(oldOrphanPath, validPng, { contentType: "image/png" });
    await adminClient.storage.from("product-images").upload(youngOrphanPath, validPng, { contentType: "image/png" });
    await adminClient.storage.from("product-images").upload(orgBImagePath, validPng, { contentType: "image/png" });

    // Associate referenced images in products
    await pgClient.query(`UPDATE public.products SET image_url = $1 WHERE id = $2;`, [activeProductImagePath, activeProductId]);
    await pgClient.query(`UPDATE public.products SET image_url = $1 WHERE id = $2;`, [inactiveProductImagePath, inactiveProductId]);
    await pgClient.query(`UPDATE public.products SET image_url = $1 WHERE id = $2;`, [archivedProductImagePath, archivedProductId]);

    // Backdate oldOrphanPath in storage.objects to simulate > 24 hours old (48 hours ago)
    await pgClient.query(
      `UPDATE storage.objects SET created_at = NOW() - INTERVAL '48 hours' WHERE name = $1;`,
      [oldOrphanPath]
    );
    // Backdate referenced images as well to prove age alone does not cause deletion
    await pgClient.query(
      `UPDATE storage.objects SET created_at = NOW() - INTERVAL '72 hours' WHERE name IN ($1, $2, $3);`,
      [activeProductImagePath, inactiveProductImagePath, archivedProductImagePath]
    );
    // youngOrphanPath remains created_at = NOW() (younger than 24h)
  });

  afterAll(async () => {
    try {
      const allPaths = [
        activeProductImagePath,
        inactiveProductImagePath,
        archivedProductImagePath,
        oldOrphanPath,
        youngOrphanPath,
        orgBImagePath,
      ];
      await adminClient.storage.from("product-images").remove(allPaths);

      if (orgAId || orgBId) {
        await pgClient.query(`DELETE FROM public.products WHERE organization_id IN ($1, $2);`, [orgAId, orgBId]);
        await pgClient.query(`ALTER TABLE public.organization_memberships DISABLE TRIGGER trg_check_owner_invariant;`);
        await pgClient.query(`DELETE FROM public.organization_memberships WHERE organization_id IN ($1, $2);`, [orgAId, orgBId]);
        await pgClient.query(`ALTER TABLE public.organization_memberships ENABLE TRIGGER trg_check_owner_invariant;`);
        await pgClient.query(`DELETE FROM public.organizations WHERE id IN ($1, $2);`, [orgAId, orgBId]);
      }
      if (ownerAUserId) {
        await adminClient.auth.admin.deleteUser(ownerAUserId);
      }
    } catch (_) {}

    await pgClient.end();
  });

  it("1. Dry-Run identifies eligible old orphans without deleting them", async () => {
    const result = await purgeOrphanedImages(adminClient, pgClient, {
      dryRun: true,
      organizationId: orgAId,
      olderThanHours: 24,
    });

    expect(result.dryRun).toBe(true);
    expect(result.eligibleOrphans).toContain(oldOrphanPath);
    expect(result.deletedCount).toBe(0);

    // Verify object still exists in Storage
    const check = await pgClient.query(`SELECT 1 FROM storage.objects WHERE name = $1;`, [oldOrphanPath]);
    expect(check.rows.length).toBe(1);
  });

  it("2. Image younger than 24 hours is preserved even if unreferenced", async () => {
    const result = await purgeOrphanedImages(adminClient, pgClient, {
      dryRun: true,
      organizationId: orgAId,
      olderThanHours: 24,
    });

    expect(result.eligibleOrphans).not.toContain(youngOrphanPath);
    expect(result.youngCount).toBeGreaterThanOrEqual(1);

    const check = await pgClient.query(`SELECT 1 FROM storage.objects WHERE name = $1;`, [youngOrphanPath]);
    expect(check.rows.length).toBe(1);
  });

  it("3. Images referenced by Active, Inactive, and Archived products are preserved", async () => {
    const result = await purgeOrphanedImages(adminClient, pgClient, {
      dryRun: true,
      organizationId: orgAId,
      olderThanHours: 24,
    });

    // None of the referenced images may appear in eligible orphans
    expect(result.eligibleOrphans).not.toContain(activeProductImagePath);
    expect(result.eligibleOrphans).not.toContain(inactiveProductImagePath);
    expect(result.eligibleOrphans).not.toContain(archivedProductImagePath);
    expect(result.referencedCount).toBeGreaterThanOrEqual(3);
  });

  it("4. Cross-tenant isolation: Org B images are not touched when running for Org A", async () => {
    const result = await purgeOrphanedImages(adminClient, pgClient, {
      dryRun: true,
      organizationId: orgAId,
      olderThanHours: 24,
    });

    // Org B image must not be deleted or touched
    expect(result.eligibleOrphans).not.toContain(orgBImagePath);
    const check = await pgClient.query(`SELECT 1 FROM storage.objects WHERE name = $1;`, [orgBImagePath]);
    expect(check.rows.length).toBe(1);
  });

  it("5. Actual deletion (--execute) removes eligible orphans via Storage client API", async () => {
    // Run with dryRun: false
    const result = await purgeOrphanedImages(adminClient, pgClient, {
      dryRun: false,
      organizationId: orgAId,
      olderThanHours: 24,
    });

    expect(result.dryRun).toBe(false);
    expect(result.eligibleOrphans).toContain(oldOrphanPath);
    expect(result.deletedCount).toBeGreaterThanOrEqual(1);

    // Verify object was removed from storage.objects via Storage API
    const check = await pgClient.query(`SELECT 1 FROM storage.objects WHERE name = $1;`, [oldOrphanPath]);
    expect(check.rows.length).toBe(0);

    // Referenced images remain untouched
    const checkRef = await pgClient.query(
      `SELECT count(*) FROM storage.objects WHERE name IN ($1, $2, $3);`,
      [activeProductImagePath, inactiveProductImagePath, archivedProductImagePath]
    );
    expect(parseInt(checkRef.rows[0].count, 10)).toBe(3);
  });

  it("6. Repeated execution is idempotent (no failures on re-run)", async () => {
    const secondRun = await purgeOrphanedImages(adminClient, pgClient, {
      dryRun: false,
      organizationId: orgAId,
      olderThanHours: 24,
    });

    expect(secondRun.errors).toHaveLength(0);
    expect(secondRun.eligibleOrphans).not.toContain(oldOrphanPath);
    expect(secondRun.deletedCount).toBe(0);
  });
});
