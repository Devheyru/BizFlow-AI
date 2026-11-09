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

describe("T049: Product Lifecycle Transitions & Archival Integrity (US5)", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;
  let anonClient: SupabaseClient;

  // Supabase authenticated clients
  let ownerClient: SupabaseClient;
  let adminOrgClient: SupabaseClient;
  let managerClient: SupabaseClient;
  let cashierClient: SupabaseClient;
  let orgBClient: SupabaseClient;

  // User IDs & Emails
  let ownerEmail: string;
  let ownerUserId: string;
  let adminUserId: string;
  let managerUserId: string;
  let cashierUserId: string;
  let orgBUserId: string;

  // Organizations
  let orgAId: string;
  let orgBId: string;
  const orgASlug = `lifecycle-org-a-${Date.now()}`;
  const orgBSlug = `lifecycle-org-b-${Date.now()}`;

  // Category
  let categoryId: string;

  const testPassword = "P@ssword123!LifecycleTest";

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    anonClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const timestamp = Date.now();
    ownerEmail = `owner_lc_${timestamp}@bizflow-test.internal`;
    const adminEmail = `admin_lc_${timestamp}@bizflow-test.internal`;
    const mgrEmail = `mgr_lc_${timestamp}@bizflow-test.internal`;
    const cashEmail = `cash_lc_${timestamp}@bizflow-test.internal`;
    const orgBEmail = `orgb_lc_${timestamp}@bizflow-test.internal`;

    // 1. Create Users
    const { data: uOwner } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Lifecycle", last_name: "Owner" },
    });
    ownerUserId = uOwner.user!.id;

    const { data: uAdmin } = await adminClient.auth.admin.createUser({
      email: adminEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Lifecycle", last_name: "Admin" },
    });
    adminUserId = uAdmin.user!.id;

    const { data: uMgr } = await adminClient.auth.admin.createUser({
      email: mgrEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Lifecycle", last_name: "Manager" },
    });
    managerUserId = uMgr.user!.id;

    const { data: uCash } = await adminClient.auth.admin.createUser({
      email: cashEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Lifecycle", last_name: "Cashier" },
    });
    cashierUserId = uCash.user!.id;

    const { data: uOrgB } = await adminClient.auth.admin.createUser({
      email: orgBEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Lifecycle", last_name: "OrgB" },
    });
    orgBUserId = uOrgB.user!.id;

    // 2. Authenticate clients
    ownerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

    adminOrgClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await adminOrgClient.auth.signInWithPassword({ email: adminEmail, password: testPassword });

    managerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await managerClient.auth.signInWithPassword({ email: mgrEmail, password: testPassword });

    cashierClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await cashierClient.auth.signInWithPassword({ email: cashEmail, password: testPassword });

    orgBClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await orgBClient.auth.signInWithPassword({ email: orgBEmail, password: testPassword });

    // 3. Create Organizations and Memberships
    const resOrgA = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
       VALUES ('Lifecycle Org A', $1, 'USD', 'retail', 'US', 'America/New_York', $2)
       RETURNING id;`,
      [orgASlug, ownerUserId]
    );
    orgAId = resOrgA.rows[0].id;

    const resOrgB = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
       VALUES ('Lifecycle Org B', $1, 'USD', 'retail', 'US', 'America/New_York', $2)
       RETURNING id;`,
      [orgBSlug, orgBUserId]
    );
    orgBId = resOrgB.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES 
         ($1, $2, 'owner', 'active'),
         ($1, $3, 'admin', 'active'),
         ($1, $4, 'manager', 'active'),
         ($1, $5, 'cashier', 'active'),
         ($6, $7, 'owner', 'active');`,
      [orgAId, ownerUserId, adminUserId, managerUserId, cashierUserId, orgBId, orgBUserId]
    );

    // 4. Create Category in Org A
    const { data: catData } = await ownerClient.rpc("create_product_category", {
      p_org_id: orgAId,
      p_name: `Lifecycle Cat ${timestamp}`,
      p_description: "Category for lifecycle tests",
    });
    categoryId = (catData as any).data.id;
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
    if (adminUserId) await adminClient.auth.admin.deleteUser(adminUserId);
    if (managerUserId) await adminClient.auth.admin.deleteUser(managerUserId);
    if (cashierUserId) await adminClient.auth.admin.deleteUser(cashierUserId);
    if (orgBUserId) await adminClient.auth.admin.deleteUser(orgBUserId);

    await pgClient.end();
  });

  // Helper to create a product for testing
  async function createTestProduct(opts?: { skuPrefix?: string; barcode?: string; initialCost?: number }) {
    const sku = `${opts?.skuPrefix || "LC"}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const { data, error } = await ownerClient.rpc("create_product", {
      p_org_id: orgAId,
      p_name: `Product ${sku}`,
      p_sku: sku,
      p_barcode: opts?.barcode,
      p_selling_price: 35.0,
      p_cost_price: opts?.initialCost,
      p_category_id: categoryId,
    });
    expect(error).toBeNull();
    return (data as any).data as { id: string; sku: string; barcode?: string; status: string; version: number };
  }

  // ==========================================================================
  // Group 1: toggle_product_status RPC (FR-017, FR-018)
  // ==========================================================================
  describe("Group 1: toggle_product_status RPC", () => {
    it("transitions product from active to inactive and records audit event", async () => {
      const product = await createTestProduct({ skuPrefix: "TOGGLE-ACT-INACT" });
      expect(product.status).toBe("active");
      expect(product.version).toBe(1);

      const { data, error } = await managerClient.rpc("toggle_product_status", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
        p_new_status: "inactive",
      });

      expect(error).toBeNull();
      const payload = data as any;
      expect(payload.success).toBe(true);
      expect(payload.data.status).toBe("inactive");
      expect(payload.data.version).toBe(2);

      // Verify DB record
      const dbRes = await pgClient.query(
        "SELECT status, version FROM public.products WHERE id = $1;",
        [product.id]
      );
      expect(dbRes.rows[0].status).toBe("inactive");
      expect(dbRes.rows[0].version).toBe(2);

      // Verify audit event
      const auditRes = await pgClient.query(
        `SELECT event_type, metadata FROM public.organization_audit_events 
         WHERE organization_id = $1 AND event_type = 'product_status_changed'
         ORDER BY created_at DESC LIMIT 1;`,
        [orgAId]
      );
      expect(auditRes.rows.length).toBe(1);
      expect(auditRes.rows[0].metadata.product_id).toBe(product.id);
      expect(auditRes.rows[0].metadata.old_status).toBe("active");
      expect(auditRes.rows[0].metadata.new_status).toBe("inactive");
      expect(auditRes.rows[0].metadata.version).toBe(2);
    });

    it("transitions product from inactive back to active and increments version", async () => {
      const product = await createTestProduct({ skuPrefix: "TOGGLE-INACT-ACT" });

      // First deactivate
      await managerClient.rpc("toggle_product_status", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
        p_new_status: "inactive",
      });

      // Now reactivate
      const { data, error } = await managerClient.rpc("toggle_product_status", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 2,
        p_new_status: "active",
      });

      expect(error).toBeNull();
      const payload = data as any;
      expect(payload.success).toBe(true);
      expect(payload.data.status).toBe("active");
      expect(payload.data.version).toBe(3);

      const dbRes = await pgClient.query(
        "SELECT status, version FROM public.products WHERE id = $1;",
        [product.id]
      );
      expect(dbRes.rows[0].status).toBe("active");
      expect(dbRes.rows[0].version).toBe(3);
    });

    it("rejects direct transitions to 'archived' in toggle_product_status with P0015", async () => {
      const product = await createTestProduct({ skuPrefix: "TOGGLE-NO-ARCH" });

      const { data, error } = await managerClient.rpc("toggle_product_status", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
        p_new_status: "archived",
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error!.code).toBe("P0015");
      expect(error!.message).toContain("Cannot toggle status to archived");
    });

    it("rejects toggle on an already archived product with P0015", async () => {
      const product = await createTestProduct({ skuPrefix: "TOGGLE-ON-ARCHIVED" });

      // Archive product via admin
      await adminOrgClient.rpc("archive_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
      });

      // Attempt to toggle
      const { data, error } = await managerClient.rpc("toggle_product_status", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 2,
        p_new_status: "active",
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error!.code).toBe("P0015");
      expect(error!.message).toContain("Cannot change status of archived product");
    });

    it("rejects invalid status values with P0009", async () => {
      const product = await createTestProduct({ skuPrefix: "TOGGLE-INVALID-VAL" });

      const { data, error } = await managerClient.rpc("toggle_product_status", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
        p_new_status: "suspended",
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error!.code).toBe("P0009");
      expect(error!.message).toContain("Invalid status for toggle");
    });
  });

  // ==========================================================================
  // Group 2: archive_product RPC & Permanent Identifier Reservations (FR-019, FR-021, SC-007)
  // ==========================================================================
  describe("Group 2: archive_product RPC & Permanent Identifier Reservations", () => {
    it("archives active product, sets archived_at, archived_by, version increment, and audit event", async () => {
      const product = await createTestProduct({ skuPrefix: "ARCH-ACT", initialCost: 15.5 });

      const { data, error } = await adminOrgClient.rpc("archive_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
      });

      expect(error).toBeNull();
      const payload = data as any;
      expect(payload.success).toBe(true);
      expect(payload.data.status).toBe("archived");
      expect(payload.data.version).toBe(2);
      expect(payload.data.archived_at).toBeDefined();

      // Verify DB record
      const dbRes = await pgClient.query(
        "SELECT status, archived_at, archived_by, version FROM public.products WHERE id = $1;",
        [product.id]
      );
      expect(dbRes.rows[0].status).toBe("archived");
      expect(dbRes.rows[0].archived_at).not.toBeNull();
      expect(dbRes.rows[0].archived_by).toBe(adminUserId);
      expect(dbRes.rows[0].version).toBe(2);

      // Verify audit event: event_type = 'product_archived', plaintext cost price EXCLUDED
      const auditRes = await pgClient.query(
        `SELECT event_type, metadata FROM public.organization_audit_events 
         WHERE organization_id = $1 AND event_type = 'product_archived' AND metadata->>'product_id' = $2;`,
        [orgAId, product.id]
      );
      expect(auditRes.rows.length).toBe(1);
      expect(auditRes.rows[0].metadata.sku).toBe(product.sku);
      expect(auditRes.rows[0].metadata.cost_price).toBeUndefined();
      expect(auditRes.rows[0].metadata.selling_price).toBeUndefined();
    });

    it("archives inactive product cleanly", async () => {
      const product = await createTestProduct({ skuPrefix: "ARCH-INACT" });

      // First deactivate
      await managerClient.rpc("toggle_product_status", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
        p_new_status: "inactive",
      });

      // Archive via owner
      const { data, error } = await ownerClient.rpc("archive_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 2,
      });

      expect(error).toBeNull();
      expect((data as any).data.status).toBe("archived");
      expect((data as any).data.version).toBe(3);
    });

    it("rejects archiving an already archived product with P0015", async () => {
      const product = await createTestProduct({ skuPrefix: "ARCH-ALREADY" });

      await adminOrgClient.rpc("archive_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
      });

      const { data, error } = await adminOrgClient.rpc("archive_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 2,
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error!.code).toBe("P0015");
      expect(error!.message).toContain("Product is already archived");
    });

    it("permanently reserves SKU so archived product SKU cannot be reused (FR-021, SC-007)", async () => {
      const product = await createTestProduct({ skuPrefix: "PERM-SKU" });

      // Archive the original product
      await adminOrgClient.rpc("archive_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
      });

      // Attempt to register a NEW product with the same SKU (must fail with P0006)
      const { data: duplicateData, error: duplicateError } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Intruder SKU Product",
        p_sku: product.sku,
        p_selling_price: 29.99,
        p_category_id: categoryId,
      });

      expect(duplicateData).toBeNull();
      expect(duplicateError).not.toBeNull();
      expect(duplicateError!.code).toBe("P0006");
      expect(duplicateError!.message).toContain("already exists");
    });

    it("permanently reserves barcode so archived product barcode cannot be reused (FR-021, SC-007)", async () => {
      const uniqueBarcode = `BC-${Date.now()}`;
      const product = await createTestProduct({
        skuPrefix: "BARCODE-ORIG",
        barcode: uniqueBarcode,
      });

      // Archive the product
      await adminOrgClient.rpc("archive_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
      });

      // Attempt to create a NEW product with the same barcode (must fail with P0006)
      const newSku = `BARCODE-INTRUDER-${Date.now()}`;
      const { data: duplicateData, error: duplicateError } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Intruder Barcode Product",
        p_sku: newSku,
        p_barcode: uniqueBarcode,
        p_selling_price: 49.99,
        p_category_id: categoryId,
      });

      expect(duplicateData).toBeNull();
      expect(duplicateError).not.toBeNull();
      expect(duplicateError!.code).toBe("P0006");
      expect(duplicateError!.message).toContain("already exists");
    });
  });

  // ==========================================================================
  // Group 3: restore_product RPC (FR-020)
  // ==========================================================================
  describe("Group 3: restore_product RPC", () => {
    it("restores archived product back to active, clears archived timestamps, and records audit event", async () => {
      const product = await createTestProduct({ skuPrefix: "RESTORE-SUCCESS" });

      // Archive product
      await adminOrgClient.rpc("archive_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
      });

      // Restore product
      const { data, error } = await adminOrgClient.rpc("restore_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 2,
      });

      expect(error).toBeNull();
      const payload = data as any;
      expect(payload.success).toBe(true);
      expect(payload.data.status).toBe("active");
      expect(payload.data.version).toBe(3);

      // Verify DB record: archived_at and archived_by cleared to null
      const dbRes = await pgClient.query(
        "SELECT status, archived_at, archived_by, version FROM public.products WHERE id = $1;",
        [product.id]
      );
      expect(dbRes.rows[0].status).toBe("active");
      expect(dbRes.rows[0].archived_at).toBeNull();
      expect(dbRes.rows[0].archived_by).toBeNull();
      expect(dbRes.rows[0].version).toBe(3);

      // Verify audit event
      const auditRes = await pgClient.query(
        `SELECT event_type, metadata FROM public.organization_audit_events 
         WHERE organization_id = $1 AND event_type = 'product_restored' AND metadata->>'product_id' = $2;`,
        [orgAId, product.id]
      );
      expect(auditRes.rows.length).toBe(1);
      expect(auditRes.rows[0].metadata.sku).toBe(product.sku);
      expect(auditRes.rows[0].metadata.version).toBe(3);
    });

    it("rejects restoring an already active product with P0015", async () => {
      const product = await createTestProduct({ skuPrefix: "RESTORE-ALREADY-ACT" });
      expect(product.status).toBe("active");

      const { data, error } = await adminOrgClient.rpc("restore_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error!.code).toBe("P0015");
      expect(error!.message).toContain("Product is not archived");
    });

    it("rejects restoring an inactive product with P0015", async () => {
      const product = await createTestProduct({ skuPrefix: "RESTORE-INACT-PROD" });

      await managerClient.rpc("toggle_product_status", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
        p_new_status: "inactive",
      });

      const { data, error } = await adminOrgClient.rpc("restore_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 2,
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error!.code).toBe("P0015");
      expect(error!.message).toContain("Product is not archived");
    });
  });

  // ==========================================================================
  // Group 4: Role-Based Access Control & Tenant Boundaries (FR-018, FR-019, FR-020, FR-040)
  // ==========================================================================
  describe("Group 4: Role-Based Access Control & Tenant Boundaries", () => {
    it("denies Cashier from calling toggle_product_status with P0005", async () => {
      const product = await createTestProduct({ skuPrefix: "RBAC-CASHIER-TOGGLE" });

      const { data, error } = await cashierClient.rpc("toggle_product_status", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
        p_new_status: "inactive",
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error!.code).toBe("P0005");
      expect(error!.message).toContain("products:update");
    });

    it("denies Cashier from calling archive_product and restore_product with P0005", async () => {
      const product = await createTestProduct({ skuPrefix: "RBAC-CASHIER-ARCH" });

      const resArchive = await cashierClient.rpc("archive_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
      });
      expect(resArchive.data).toBeNull();
      expect(resArchive.error!.code).toBe("P0005");
      expect(resArchive.error!.message).toContain("products:archive");

      const resRestore = await cashierClient.rpc("restore_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
      });
      expect(resRestore.data).toBeNull();
      expect(resRestore.error!.code).toBe("P0005");
      expect(resRestore.error!.message).toContain("products:archive");
    });

    it("allows Manager to toggle status but denies Manager from archiving or restoring (P0005)", async () => {
      const product = await createTestProduct({ skuPrefix: "RBAC-MGR-PERMS" });

      // Manager toggling status: SUCCEEDS (Manager has products:update)
      const resToggle = await managerClient.rpc("toggle_product_status", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
        p_new_status: "inactive",
      });
      expect(resToggle.error).toBeNull();
      expect((resToggle.data as any).success).toBe(true);

      // Manager archiving product: FAILS with P0005 (Manager lacks products:archive)
      const resArchive = await managerClient.rpc("archive_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 2,
      });
      expect(resArchive.data).toBeNull();
      expect(resArchive.error!.code).toBe("P0005");
      expect(resArchive.error!.message).toContain("products:archive");

      // Archive via admin so we can test restore
      await adminOrgClient.rpc("archive_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 2,
      });

      // Manager restoring product: FAILS with P0005
      const resRestore = await managerClient.rpc("restore_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 3,
      });
      expect(resRestore.data).toBeNull();
      expect(resRestore.error!.code).toBe("P0005");
      expect(resRestore.error!.message).toContain("products:archive");
    });

    it("allows Admin to perform toggle, archive, and restore operations", async () => {
      const product = await createTestProduct({ skuPrefix: "RBAC-ADMIN-ALL" });

      // Admin toggle
      const resToggle = await adminOrgClient.rpc("toggle_product_status", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
        p_new_status: "inactive",
      });
      expect(resToggle.error).toBeNull();

      // Admin archive
      const resArch = await adminOrgClient.rpc("archive_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 2,
      });
      expect(resArch.error).toBeNull();

      // Admin restore
      const resRest = await adminOrgClient.rpc("restore_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 3,
      });
      expect(resRest.error).toBeNull();
      expect((resRest.data as any).data.status).toBe("active");
    });

    it("blocks cross-tenant product lifecycle operations from Org B caller", async () => {
      const product = await createTestProduct({ skuPrefix: "CROSS-TENANT-LC" });

      // Org B user attempts to toggle Org A product
      const resToggle = await orgBClient.rpc("toggle_product_status", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
        p_new_status: "inactive",
      });
      expect(resToggle.data).toBeNull();
      expect(resToggle.error!.code).toBe("P0004");

      // Org B user attempts to archive Org A product
      const resArchive = await orgBClient.rpc("archive_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
      });
      expect(resArchive.data).toBeNull();
      expect(resArchive.error!.code).toBe("P0004");

      // Org B user attempts to restore Org A product
      const resRestore = await orgBClient.rpc("restore_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
      });
      expect(resRestore.data).toBeNull();
      expect(resRestore.error!.code).toBe("P0004");
    });

    it("blocks unauthenticated callers (42501 or P0003)", async () => {
      const product = await createTestProduct({ skuPrefix: "UNAUTH-LC" });

      const resToggle = await anonClient.rpc("toggle_product_status", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
        p_new_status: "inactive",
      });
      expect(resToggle.data).toBeNull();
      expect(["42501", "P0003"]).toContain(resToggle.error!.code);

      const resArchive = await anonClient.rpc("archive_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
      });
      expect(resArchive.data).toBeNull();
      expect(["42501", "P0003"]).toContain(resArchive.error!.code);

      const resRestore = await anonClient.rpc("restore_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
      });
      expect(resRestore.data).toBeNull();
      expect(["42501", "P0003"]).toContain(resRestore.error!.code);
    });
  });

  // ==========================================================================
  // Group 5: Optimistic Concurrency Control (OCC) (FR-023)
  // ==========================================================================
  describe("Group 5: Optimistic Concurrency Control (OCC)", () => {
    it("rejects toggle_product_status with stale expected_version (P0010)", async () => {
      const product = await createTestProduct({ skuPrefix: "OCC-TOGGLE-STALE" });

      // First manager toggles to inactive (advancing version 1 -> 2)
      await managerClient.rpc("toggle_product_status", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
        p_new_status: "inactive",
      });

      // Second manager attempts to toggle with stale version 1
      const { data, error } = await managerClient.rpc("toggle_product_status", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
        p_new_status: "active",
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error!.code).toBe("P0010");
      expect(error!.message).toContain("Stale update conflict");
    });

    it("rejects archive_product with stale expected_version (P0010)", async () => {
      const product = await createTestProduct({ skuPrefix: "OCC-ARCH-STALE" });

      // First update product to advance version
      await managerClient.rpc("toggle_product_status", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
        p_new_status: "inactive",
      });

      // Attempt to archive with outdated version 1
      const { data, error } = await adminOrgClient.rpc("archive_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error!.code).toBe("P0010");
      expect(error!.message).toContain("Stale update conflict");
    });

    it("rejects restore_product with stale expected_version (P0010)", async () => {
      const product = await createTestProduct({ skuPrefix: "OCC-REST-STALE" });

      // Archive product (advancing version 1 -> 2)
      await adminOrgClient.rpc("archive_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
      });

      // Attempt to restore with outdated expected_version 1 (instead of 2)
      const { data, error } = await adminOrgClient.rpc("restore_product", {
        p_org_id: orgAId,
        p_product_id: product.id,
        p_expected_version: 1,
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error!.code).toBe("P0010");
      expect(error!.message).toContain("Stale update conflict");
    });
  });
});
