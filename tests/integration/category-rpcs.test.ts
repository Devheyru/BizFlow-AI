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

describe("T044: Category RPCs & Composite Referential Integrity (US4)", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;

  // Authenticated Clients
  let ownerClient: SupabaseClient;
  let managerClient: SupabaseClient;
  let cashierClient: SupabaseClient;
  let unverifiedClient: SupabaseClient;
  let orgBClient: SupabaseClient;

  // Test Entities
  let orgAId: string;
  let orgBId: string;
  let ownerUserId: string;
  let managerUserId: string;
  let cashierUserId: string;
  let unverifiedUserId: string;
  let orgBUserId: string;

  const timestamp = Date.now();
  const testPassword = "Password123!";

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const ownerEmail = `cat-owner-${timestamp}@example.com`;
    const mgrEmail = `cat-mgr-${timestamp}@example.com`;
    const cashEmail = `cat-cash-${timestamp}@example.com`;
    const unverifiedEmail = `cat-unverified-${timestamp}@example.com`;
    const orgBEmail = `cat-orgb-${timestamp}@example.com`;

    const uOwner = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Cat", last_name: "Owner" },
    });
    ownerUserId = uOwner.data.user!.id;

    const uMgr = await adminClient.auth.admin.createUser({
      email: mgrEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Cat", last_name: "Manager" },
    });
    managerUserId = uMgr.data.user!.id;

    const uCash = await adminClient.auth.admin.createUser({
      email: cashEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Cat", last_name: "Cashier" },
    });
    cashierUserId = uCash.data.user!.id;

    const uUnverified = await adminClient.auth.admin.createUser({
      email: unverifiedEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Cat", last_name: "Unverified" },
    });
    unverifiedUserId = uUnverified.data.user!.id;

    const uOrgB = await adminClient.auth.admin.createUser({
      email: orgBEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "OrgB", last_name: "Owner" },
    });
    orgBUserId = uOrgB.data.user!.id;

    // Direct profile insertion
    await pgClient.query(
      `INSERT INTO public.profiles (id, first_name, last_name)
       VALUES 
         ($1, 'Cat', 'Owner'),
         ($2, 'Cat', 'Manager'),
         ($3, 'Cat', 'Cashier'),
         ($4, 'Cat', 'Unverified'),
         ($5, 'OrgB', 'Owner')
       ON CONFLICT (id) DO NOTHING;`,
      [ownerUserId, managerUserId, cashierUserId, unverifiedUserId, orgBUserId]
    );

    // Sign in clients
    ownerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

    managerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await managerClient.auth.signInWithPassword({ email: mgrEmail, password: testPassword });

    cashierClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await cashierClient.auth.signInWithPassword({ email: cashEmail, password: testPassword });

    unverifiedClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await unverifiedClient.auth.signInWithPassword({ email: unverifiedEmail, password: testPassword });
    // Revoke email confirmation
    await pgClient.query("UPDATE auth.users SET email_confirmed_at = NULL WHERE id = $1;", [unverifiedUserId]);

    orgBClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await orgBClient.auth.signInWithPassword({ email: orgBEmail, password: testPassword });

    // Seed organizations
    const orgARes = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, created_by)
       VALUES ('Category Org Alpha', $1, 'USD', 'retail', 'US', $2) RETURNING id;`,
      [`cat-alpha-${timestamp}`, ownerUserId]
    );
    orgAId = orgARes.rows[0].id;

    const orgBRes = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, created_by)
       VALUES ('Category Org Beta', $1, 'USD', 'retail', 'US', $2) RETURNING id;`,
      [`cat-beta-${timestamp}`, orgBUserId]
    );
    orgBId = orgBRes.rows[0].id;

    // Seed memberships
    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES 
         ($1, $2, 'owner', 'active'),
         ($1, $3, 'manager', 'active'),
         ($1, $4, 'cashier', 'active'),
         ($1, $5, 'cashier', 'active'),
         ($6, $7, 'owner', 'active');`,
      [orgAId, ownerUserId, managerUserId, cashierUserId, unverifiedUserId, orgBId, orgBUserId]
    );
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
    if (unverifiedUserId) await adminClient.auth.admin.deleteUser(unverifiedUserId);
    if (orgBUserId) await adminClient.auth.admin.deleteUser(orgBUserId);

    await pgClient.end();
  });

  describe("Scenario A: Category Creation", () => {
    it("successfully creates a category with trimmed name and atomic audit event", async () => {
      const categoryName = `Beverages ${timestamp}`;
      const description = "Soft drinks, juices, and mineral waters";

      const { data, error } = await ownerClient.rpc("create_product_category", {
        p_org_id: orgAId,
        p_name: `  ${categoryName}  `,
        p_description: `  ${description}  `,
      });

      expect(error).toBeNull();
      const payload = data as { success: boolean; data: any };
      expect(payload.success).toBe(true);
      expect(payload.data.id).toBeDefined();
      expect(payload.data.organization_id).toBe(orgAId);
      expect(payload.data.name).toBe(categoryName);
      expect(payload.data.description).toBe(description);
      expect(payload.data.status).toBe("active");

      // Verify in DB
      const dbRow = await pgClient.query(
        "SELECT * FROM public.product_categories WHERE id = $1 AND organization_id = $2;",
        [payload.data.id, orgAId]
      );
      expect(dbRow.rows.length).toBe(1);
      expect(dbRow.rows[0].name).toBe(categoryName);
      expect(dbRow.rows[0].description).toBe(description);
      expect(dbRow.rows[0].status).toBe("active");

      // Verify atomic audit event
      const auditRow = await pgClient.query(
        `SELECT * FROM public.organization_audit_events 
         WHERE organization_id = $1 AND event_type = 'category_created' AND metadata->>'category_id' = $2;`,
        [orgAId, payload.data.id]
      );
      expect(auditRow.rows.length).toBe(1);
      expect(auditRow.rows[0].actor_id).toBe(ownerUserId);
      expect(auditRow.rows[0].metadata.name).toBe(categoryName);
    });
  });

  describe("Scenario B: Case-Insensitive Duplicate Names", () => {
    it("rejects duplicate category name in same org with P0006 (case-insensitive)", async () => {
      const uniqueName = `Snacks ${timestamp}`;

      const { error: err1 } = await ownerClient.rpc("create_product_category", {
        p_org_id: orgAId,
        p_name: uniqueName,
        p_description: "Initial category",
      });
      expect(err1).toBeNull();

      // Attempt duplicate with different casing and whitespace
      const { data: d2, error: err2 } = await ownerClient.rpc("create_product_category", {
        p_org_id: orgAId,
        p_name: `   ${uniqueName.toLowerCase()}   `,
        p_description: "Duplicate attempt",
      });

      expect(d2).toBeNull();
      expect(err2).not.toBeNull();
      expect(err2?.code).toBe("P0006");

      // Verify another organization CAN create the exact same name
      const { data: dOrgB, error: errOrgB } = await orgBClient.rpc("create_product_category", {
        p_org_id: orgBId,
        p_name: uniqueName,
        p_description: "Belongs to Org B",
      });
      expect(errOrgB).toBeNull();
      expect((dOrgB as any).success).toBe(true);
      expect((dOrgB as any).data.organization_id).toBe(orgBId);
    });
  });

  describe("Scenario C: Category Update", () => {
    it("updates category name and description, logging category_updated audit event", async () => {
      const { data: initial } = await ownerClient.rpc("create_product_category", {
        p_org_id: orgAId,
        p_name: `Bakery ${timestamp}`,
        p_description: "Old description",
      });
      const catId = (initial as any).data.id;

      const updatedName = `Artisan Bakery ${timestamp}`;
      const updatedDesc = "Freshly baked bread and pastries";

      const { data: updated, error } = await ownerClient.rpc("update_product_category", {
        p_org_id: orgAId,
        p_category_id: catId,
        p_name: `   ${updatedName}   `,
        p_description: `   ${updatedDesc}   `,
      });

      expect(error).toBeNull();
      expect((updated as any).success).toBe(true);
      expect((updated as any).data.name).toBe(updatedName);
      expect((updated as any).data.description).toBe(updatedDesc);

      // Verify audit event
      const auditRow = await pgClient.query(
        `SELECT * FROM public.organization_audit_events 
         WHERE organization_id = $1 AND event_type = 'category_updated' AND metadata->>'category_id' = $2;`,
        [orgAId, catId]
      );
      expect(auditRow.rows.length).toBe(1);
      expect(auditRow.rows[0].metadata.old_name).toBe(`Bakery ${timestamp}`);
      expect(auditRow.rows[0].metadata.new_name).toBe(updatedName);
    });

    it("rejects updating category to a name that conflicts with another category in same org (P0006)", async () => {
      await ownerClient.rpc("create_product_category", {
        p_org_id: orgAId,
        p_name: `Meat ${timestamp}`,
      });
      const { data: cat2 } = await ownerClient.rpc("create_product_category", {
        p_org_id: orgAId,
        p_name: `Seafood ${timestamp}`,
      });

      // Try updating Seafood to Meat
      const { error } = await ownerClient.rpc("update_product_category", {
        p_org_id: orgAId,
        p_category_id: (cat2 as any).data.id,
        p_name: `meat ${timestamp}`,
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("P0006");
    });

    it("rejects updating an archived category with P0015", async () => {
      const { data: cat } = await ownerClient.rpc("create_product_category", {
        p_org_id: orgAId,
        p_name: `Seasonal ${timestamp}`,
      });
      const catId = (cat as any).data.id;

      await ownerClient.rpc("archive_product_category", {
        p_org_id: orgAId,
        p_category_id: catId,
      });

      const { error } = await ownerClient.rpc("update_product_category", {
        p_org_id: orgAId,
        p_category_id: catId,
        p_name: `Updated Seasonal ${timestamp}`,
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("P0015");
    });
  });

  describe("Scenario D & E: Category Archival and Restoration", () => {
    it("archives category, sets status and timestamp, emits audit event, and rejects double-archival with P0015", async () => {
      const { data: cat } = await ownerClient.rpc("create_product_category", {
        p_org_id: orgAId,
        p_name: `To Archive ${timestamp}`,
      });
      const catId = (cat as any).data.id;

      // Seed a product assigned to this category
      const { data: prod } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: `Associated Product ${timestamp}`,
        p_sku: `ASSOC-${timestamp}`,
        p_selling_price: 15.0,
        p_category_id: catId,
      });
      const prodId = (prod as any).data.id;

      // Archive category
      const { data: archData, error: archErr } = await ownerClient.rpc("archive_product_category", {
        p_org_id: orgAId,
        p_category_id: catId,
      });

      expect(archErr).toBeNull();
      expect((archData as any).success).toBe(true);
      expect((archData as any).data.status).toBe("archived");
      expect((archData as any).data.archived_at).toBeDefined();

      // Critical Invariant: Associated product retains its exact category_id reference
      const prodDb = await pgClient.query("SELECT * FROM public.products WHERE id = $1;", [prodId]);
      expect(prodDb.rows[0].category_id).toBe(catId);

      // Verify audit event
      const auditRow = await pgClient.query(
        `SELECT * FROM public.organization_audit_events 
         WHERE organization_id = $1 AND event_type = 'category_archived' AND metadata->>'category_id' = $2;`,
        [orgAId, catId]
      );
      expect(auditRow.rows.length).toBe(1);

      // Attempt double archival -> P0015
      const { error: doubleErr } = await ownerClient.rpc("archive_product_category", {
        p_org_id: orgAId,
        p_category_id: catId,
      });
      expect(doubleErr?.code).toBe("P0015");

      // Restore category
      const { data: restoreData, error: restoreErr } = await ownerClient.rpc("restore_product_category", {
        p_org_id: orgAId,
        p_category_id: catId,
      });

      expect(restoreErr).toBeNull();
      expect((restoreData as any).success).toBe(true);
      expect((restoreData as any).data.status).toBe("active");

      // Verify DB status
      const catDb = await pgClient.query("SELECT status, archived_at, archived_by FROM public.product_categories WHERE id = $1;", [catId]);
      expect(catDb.rows[0].status).toBe("active");
      expect(catDb.rows[0].archived_at).toBeNull();
      expect(catDb.rows[0].archived_by).toBeNull();

      // Verify audit event
      const restoreAudit = await pgClient.query(
        `SELECT * FROM public.organization_audit_events 
         WHERE organization_id = $1 AND event_type = 'category_restored' AND metadata->>'category_id' = $2;`,
        [orgAId, catId]
      );
      expect(restoreAudit.rows.length).toBe(1);

      // Attempt restoring an already active category -> P0015
      const { error: activeErr } = await ownerClient.rpc("restore_product_category", {
        p_org_id: orgAId,
        p_category_id: catId,
      });
      expect(activeErr?.code).toBe("P0015");
    });
  });

  describe("Scenario F: Archived Category Assignment Rejection", () => {
    it("rejects assigning an archived category to a new product with P0015", async () => {
      const { data: cat } = await ownerClient.rpc("create_product_category", {
        p_org_id: orgAId,
        p_name: `Discontinued Cat ${timestamp}`,
      });
      const catId = (cat as any).data.id;

      await ownerClient.rpc("archive_product_category", {
        p_org_id: orgAId,
        p_category_id: catId,
      });

      // Attempt creating a product assigned to archived category
      const { data, error } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Blocked Product",
        p_sku: `BLOCKED-CAT-${timestamp}`,
        p_selling_price: 10.0,
        p_category_id: catId,
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.code).toBe("P0015");
    });
  });

  describe("Scenario G: Cross-Tenant Referential Integrity & Composite FK", () => {
    it("rejects cross-tenant category assignment via RPC with P0002", async () => {
      // Category in Org B
      const { data: catB } = await orgBClient.rpc("create_product_category", {
        p_org_id: orgBId,
        p_name: `Org B Exclusive ${timestamp}`,
      });
      const catBId = (catB as any).data.id;

      // Attempt assigning Org B category to product in Org A
      const { error } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Illegal Cross-Tenant Product",
        p_sku: `ILLEGAL-CROSS-${timestamp}`,
        p_selling_price: 25.0,
        p_category_id: catBId,
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("P0002");
    });

    it("enforces database composite foreign key fk_products_org_category on direct insert", async () => {
      // Category in Org B
      const { data: catB } = await orgBClient.rpc("create_product_category", {
        p_org_id: orgBId,
        p_name: `Org B Composite Test ${timestamp}`,
      });
      const catBId = (catB as any).data.id;

      // Direct SQL insertion attempting to bypass RPC logic:
      // product with organization_id = Org A, but category_id = Org B
      let fkError: any = null;
      try {
        await pgClient.query(
          `INSERT INTO public.products (organization_id, name, sku, selling_price, category_id, status, created_by, updated_by)
           VALUES ($1, 'Direct FK Attack', $2, 30.0, $3, 'active', $4, $4);`,
          [orgAId, `DIRECT-FK-${timestamp}`, catBId, ownerUserId]
        );
      } catch (err: any) {
        fkError = err;
      }

      expect(fkError).not.toBeNull();
      // PostgreSQL foreign key violation code is 23503
      expect(fkError?.code).toBe("23503");
      expect(fkError?.constraint).toBe("fk_products_org_category");
    });
  });

  describe("Scenario H: Tenant Isolation", () => {
    it("prevents Org A member from reading or updating Org B category (P0002)", async () => {
      const { data: catB } = await orgBClient.rpc("create_product_category", {
        p_org_id: orgBId,
        p_name: `Tenant Isolation Cat ${timestamp}`,
      });
      const catBId = (catB as any).data.id;

      // Org A owner tries to update Org B category
      const { error: updateErr } = await ownerClient.rpc("update_product_category", {
        p_org_id: orgAId,
        p_category_id: catBId,
        p_name: "Attacking Org B",
      });
      expect(updateErr?.code).toBe("P0002");

      // Org A owner tries to archive Org B category
      const { error: archErr } = await ownerClient.rpc("archive_product_category", {
        p_org_id: orgAId,
        p_category_id: catBId,
      });
      expect(archErr?.code).toBe("P0002");

      // Direct select under RLS using ownerClient
      const { data: rlsSelect } = await ownerClient
        .from("product_categories")
        .select("*")
        .eq("id", catBId);

      expect(rlsSelect).toEqual([]);
    });
  });

  describe("Scenario I: Authorization Invariants", () => {
    it("rejects unauthenticated caller with P0003 or 42501", async () => {
      const anonClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
      const { data, error } = await anonClient.rpc("create_product_category", {
        p_org_id: orgAId,
        p_name: "Unauthenticated Cat",
      });
      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(
        error?.code === "P0003" ||
        error?.code === "42501" ||
        error?.message?.includes("P0003") ||
        error?.message?.includes("permission denied")
      ).toBe(true);
    });

    it("rejects unverified caller with P0001", async () => {
      const { error } = await unverifiedClient.rpc("create_product_category", {
        p_org_id: orgAId,
        p_name: "Unverified Cat",
      });
      expect(error?.code).toBe("P0001");
    });

    it("rejects caller without categories:create permission (Cashier) with P0005", async () => {
      const { error } = await cashierClient.rpc("create_product_category", {
        p_org_id: orgAId,
        p_name: "Cashier Cat",
      });
      expect(error?.code).toBe("P0005");
    });

    it("rejects caller without categories:archive permission (Manager) with P0005", async () => {
      const { data: cat } = await ownerClient.rpc("create_product_category", {
        p_org_id: orgAId,
        p_name: `Manager Cant Archive ${timestamp}`,
      });
      const catId = (cat as any).data.id;

      // Manager has categories:create and categories:update, but NOT categories:archive
      const { error: archErr } = await managerClient.rpc("archive_product_category", {
        p_org_id: orgAId,
        p_category_id: catId,
      });
      expect(archErr?.code).toBe("P0005");

      const { error: resErr } = await managerClient.rpc("restore_product_category", {
        p_org_id: orgAId,
        p_category_id: catId,
      });
      expect(resErr?.code).toBe("P0005");
    });
  });

  describe("Scenario J: Atomic Audit Behavior & Rollback", () => {
    it("rolls back category creation atomically if audit logging fails", async () => {
      const failCatName = `Audit Rollback Cat ${timestamp}`;

      // Temporarily create a trigger to abort audit insertion for this test
      await pgClient.query(`
        CREATE OR REPLACE FUNCTION public.test_abort_audit_trigger()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.event_type = 'category_created' AND NEW.metadata->>'name' = '${failCatName}' THEN
            RAISE EXCEPTION 'Simulated audit insertion failure' USING ERRCODE = 'P9999';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_test_abort_audit ON public.organization_audit_events;
        CREATE TRIGGER trg_test_abort_audit
        BEFORE INSERT ON public.organization_audit_events
        FOR EACH ROW EXECUTE FUNCTION public.test_abort_audit_trigger();
      `);

      try {
        const { error } = await ownerClient.rpc("create_product_category", {
          p_org_id: orgAId,
          p_name: failCatName,
        });

        expect(error).not.toBeNull();
        expect(error?.message).toContain("Simulated audit insertion failure");

        // Verify category was rolled back and does not exist in DB
        const catCheck = await pgClient.query(
          "SELECT 1 FROM public.product_categories WHERE organization_id = $1 AND name = $2;",
          [orgAId, failCatName]
        );
        expect(catCheck.rows.length).toBe(0);
      } finally {
        // Clean up test trigger & function
        await pgClient.query("DROP TRIGGER IF EXISTS trg_test_abort_audit ON public.organization_audit_events;");
        await pgClient.query("DROP FUNCTION IF EXISTS public.test_abort_audit_trigger();");
      }
    });
  });
});
