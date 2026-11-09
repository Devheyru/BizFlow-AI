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

describe("T053: Direct Authenticated Database Mutation Security Integration Tests (FR-040, FR-043, SC-003)", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;

  // Supabase clients
  let ownerClient: SupabaseClient;
  let managerClient: SupabaseClient;
  let cashierClient: SupabaseClient;

  // User IDs & Emails
  let ownerUserId: string;
  let managerUserId: string;
  let cashierUserId: string;
  const testPassword = "P@ssword123!SecureTest";

  // Organization
  let orgId: string;
  const orgSlug = `sec-dml-${Date.now()}`;

  // Existing Seed Records for UPDATE/DELETE tests
  let existingCategoryId: string;
  let existingProductId: string;
  const initialProductName = "Protected Seed Product";
  const initialCategoryName = "Protected Seed Category";
  const initialCostPrice = "45.00";

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const timestamp = Date.now();
    const ownerEmail = `owner_dml_${timestamp}@bizflow-test.internal`;
    const mgrEmail = `mgr_dml_${timestamp}@bizflow-test.internal`;
    const cashEmail = `cash_dml_${timestamp}@bizflow-test.internal`;

    // 1. Create Users
    const { data: uOwner } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "DML", last_name: "Owner" },
    });
    ownerUserId = uOwner.user!.id;

    const { data: uMgr } = await adminClient.auth.admin.createUser({
      email: mgrEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "DML", last_name: "Manager" },
    });
    managerUserId = uMgr.user!.id;

    const { data: uCash } = await adminClient.auth.admin.createUser({
      email: cashEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "DML", last_name: "Cashier" },
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
       VALUES ('DML Security Org', $1, 'USD', 'retail', 'US', 'America/New_York', $2)
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

    // 4. Create authoritative initial records via privileged RPCs / admin context
    const resCat = await ownerClient.rpc("create_product_category", {
      p_org_id: orgId,
      p_name: initialCategoryName,
      p_description: "Seed category for direct DML denial testing",
    });
    if (resCat.error) {
      throw new Error(`Failed to create seed category: ${resCat.error.message}`);
    }
    existingCategoryId = (resCat.data as any).data.id;

    const resProd = await ownerClient.rpc("create_product", {
      p_org_id: orgId,
      p_name: initialProductName,
      p_sku: `SKU-DML-INIT-${Date.now()}`,
      p_selling_price: 99.99,
      p_unit_of_measure: "unit",
      p_category_id: existingCategoryId,
      p_cost_price: Number(initialCostPrice),
    });
    if (resProd.error) {
      throw new Error(`Failed to create seed product: ${resProd.error.message}`);
    }
    existingProductId = (resProd.data as any).data.id;
  });

  afterAll(async () => {
    try {
      if (orgId) {
        await pgClient.query(`DELETE FROM public.organization_audit_events WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`DELETE FROM public.product_costs WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`DELETE FROM public.products WHERE organization_id = $1`, [orgId]);
        await pgClient.query(`DELETE FROM public.product_categories WHERE organization_id = $1`, [orgId]);
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
  // 1. Direct DML Denial on public.products (FR-040, FR-043)
  // ===========================================================================
  describe("1. Direct DML Denial on public.products", () => {
    it("Owner direct INSERT is rejected with PostgreSQL error 42501", async () => {
      const { data, error } = await ownerClient.from("products").insert({
        organization_id: orgId,
        name: "Direct Insert Product by Owner",
        sku: `DIRECT-OWNER-${Date.now()}`,
        selling_price: 19.99,
        unit_of_measure: "unit",
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
    });

    it("Manager direct INSERT is rejected with PostgreSQL error 42501", async () => {
      const { data, error } = await managerClient.from("products").insert({
        organization_id: orgId,
        name: "Direct Insert Product by Manager",
        sku: `DIRECT-MGR-${Date.now()}`,
        selling_price: 29.99,
        unit_of_measure: "unit",
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
    });

    it("Cashier direct INSERT is rejected with PostgreSQL error 42501", async () => {
      const { data, error } = await cashierClient.from("products").insert({
        organization_id: orgId,
        name: "Direct Insert Product by Cashier",
        sku: `DIRECT-CASH-${Date.now()}`,
        selling_price: 39.99,
        unit_of_measure: "unit",
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
    });

    it("Owner direct UPDATE is denied (modifies 0 rows / 42501) and DB record is preserved", async () => {
      const { data, error } = await ownerClient
        .from("products")
        .update({ name: "Hacked Product Name by Owner", selling_price: 1.0 })
        .eq("id", existingProductId)
        .select();

      if (error) {
        expect(error.code).toBe("42501");
      } else {
        expect(data).toHaveLength(0);
      }

      // Verify product in database was unmodified
      const resCheck = await pgClient.query(`SELECT name, selling_price FROM public.products WHERE id = $1`, [
        existingProductId,
      ]);
      expect(resCheck.rows[0].name).toBe(initialProductName);
      expect(Number(resCheck.rows[0].selling_price)).toBe(99.99);
    });

    it("Cashier direct UPDATE is denied (modifies 0 rows / 42501) and DB record is preserved", async () => {
      const { data, error } = await cashierClient
        .from("products")
        .update({ name: "Hacked Product Name by Cashier", selling_price: 0.01 })
        .eq("id", existingProductId)
        .select();

      if (error) {
        expect(error.code).toBe("42501");
      } else {
        expect(data).toHaveLength(0);
      }

      const resCheck = await pgClient.query(`SELECT name FROM public.products WHERE id = $1`, [existingProductId]);
      expect(resCheck.rows[0].name).toBe(initialProductName);
    });

    it("Owner direct DELETE is denied (deletes 0 rows / 42501) and DB record is preserved", async () => {
      const { data, error } = await ownerClient
        .from("products")
        .delete()
        .eq("id", existingProductId)
        .select();

      if (error) {
        expect(error.code).toBe("42501");
      } else {
        expect(data).toHaveLength(0);
      }

      const resCheck = await pgClient.query(`SELECT id FROM public.products WHERE id = $1`, [existingProductId]);
      expect(resCheck.rows).toHaveLength(1);
    });

    it("Cashier direct DELETE is denied (deletes 0 rows / 42501) and DB record is preserved", async () => {
      const { data, error } = await cashierClient
        .from("products")
        .delete()
        .eq("id", existingProductId)
        .select();

      if (error) {
        expect(error.code).toBe("42501");
      } else {
        expect(data).toHaveLength(0);
      }

      const resCheck = await pgClient.query(`SELECT id FROM public.products WHERE id = $1`, [existingProductId]);
      expect(resCheck.rows).toHaveLength(1);
    });
  });

  // ===========================================================================
  // 2. Direct DML Denial on public.product_categories (FR-040, FR-043)
  // ===========================================================================
  describe("2. Direct DML Denial on public.product_categories", () => {
    it("Owner direct INSERT is rejected with PostgreSQL error 42501", async () => {
      const { data, error } = await ownerClient.from("product_categories").insert({
        organization_id: orgId,
        name: `Direct Category Owner ${Date.now()}`,
        description: "Direct insert attempt",
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
    });

    it("Manager direct INSERT is rejected with PostgreSQL error 42501", async () => {
      const { data, error } = await managerClient.from("product_categories").insert({
        organization_id: orgId,
        name: `Direct Category Manager ${Date.now()}`,
        description: "Direct insert attempt",
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
    });

    it("Cashier direct INSERT is rejected with PostgreSQL error 42501", async () => {
      const { data, error } = await cashierClient.from("product_categories").insert({
        organization_id: orgId,
        name: `Direct Category Cashier ${Date.now()}`,
        description: "Direct insert attempt",
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
    });

    it("Owner direct UPDATE is denied (modifies 0 rows / 42501) and DB category is preserved", async () => {
      const { data, error } = await ownerClient
        .from("product_categories")
        .update({ name: "Hacked Category Name" })
        .eq("id", existingCategoryId)
        .select();

      if (error) {
        expect(error.code).toBe("42501");
      } else {
        expect(data).toHaveLength(0);
      }

      const resCheck = await pgClient.query(`SELECT name FROM public.product_categories WHERE id = $1`, [
        existingCategoryId,
      ]);
      expect(resCheck.rows[0].name).toBe(initialCategoryName);
    });

    it("Cashier direct UPDATE is denied (modifies 0 rows / 42501) and DB category is preserved", async () => {
      const { data, error } = await cashierClient
        .from("product_categories")
        .update({ name: "Hacked Category Name by Cashier" })
        .eq("id", existingCategoryId)
        .select();

      if (error) {
        expect(error.code).toBe("42501");
      } else {
        expect(data).toHaveLength(0);
      }

      const resCheck = await pgClient.query(`SELECT name FROM public.product_categories WHERE id = $1`, [
        existingCategoryId,
      ]);
      expect(resCheck.rows[0].name).toBe(initialCategoryName);
    });

    it("Owner direct DELETE is denied (deletes 0 rows / 42501) and DB category is preserved", async () => {
      const { data, error } = await ownerClient
        .from("product_categories")
        .delete()
        .eq("id", existingCategoryId)
        .select();

      if (error) {
        expect(error.code).toBe("42501");
      } else {
        expect(data).toHaveLength(0);
      }

      const resCheck = await pgClient.query(`SELECT id FROM public.product_categories WHERE id = $1`, [
        existingCategoryId,
      ]);
      expect(resCheck.rows).toHaveLength(1);
    });

    it("Cashier direct DELETE is denied (deletes 0 rows / 42501) and DB category is preserved", async () => {
      const { data, error } = await cashierClient
        .from("product_categories")
        .delete()
        .eq("id", existingCategoryId)
        .select();

      if (error) {
        expect(error.code).toBe("42501");
      } else {
        expect(data).toHaveLength(0);
      }

      const resCheck = await pgClient.query(`SELECT id FROM public.product_categories WHERE id = $1`, [
        existingCategoryId,
      ]);
      expect(resCheck.rows).toHaveLength(1);
    });
  });

  // ===========================================================================
  // 3. Direct DML Denial on public.product_costs (FR-038, FR-040, FR-043)
  // ===========================================================================
  describe("3. Direct DML Denial on public.product_costs", () => {
    it("Owner direct INSERT is rejected with PostgreSQL error 42501", async () => {
      const { data, error } = await ownerClient.from("product_costs").insert({
        organization_id: orgId,
        product_id: existingProductId,
        cost_price: 15.0,
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
    });

    it("Manager direct INSERT is rejected with PostgreSQL error 42501", async () => {
      const { data, error } = await managerClient.from("product_costs").insert({
        organization_id: orgId,
        product_id: existingProductId,
        cost_price: 25.0,
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
    });

    it("Cashier direct INSERT is rejected with PostgreSQL error 42501", async () => {
      const { data, error } = await cashierClient.from("product_costs").insert({
        organization_id: orgId,
        product_id: existingProductId,
        cost_price: 35.0,
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
    });

    it("Owner direct UPDATE is denied (modifies 0 rows / 42501) and DB cost is preserved", async () => {
      const { data, error } = await ownerClient
        .from("product_costs")
        .update({ cost_price: 1.0 })
        .eq("product_id", existingProductId)
        .select();

      if (error) {
        expect(error.code).toBe("42501");
      } else {
        expect(data).toHaveLength(0);
      }

      const resCheck = await pgClient.query(`SELECT cost_price FROM public.product_costs WHERE product_id = $1`, [
        existingProductId,
      ]);
      expect(Number(resCheck.rows[0].cost_price)).toBe(45.0);
    });

    it("Cashier direct UPDATE is denied (modifies 0 rows / 42501) and DB cost is preserved", async () => {
      const { data, error } = await cashierClient
        .from("product_costs")
        .update({ cost_price: 0.5 })
        .eq("product_id", existingProductId)
        .select();

      if (error) {
        expect(error.code).toBe("42501");
      } else {
        expect(data).toHaveLength(0);
      }

      const resCheck = await pgClient.query(`SELECT cost_price FROM public.product_costs WHERE product_id = $1`, [
        existingProductId,
      ]);
      expect(Number(resCheck.rows[0].cost_price)).toBe(45.0);
    });

    it("Owner direct DELETE is denied (deletes 0 rows / 42501) and DB cost is preserved", async () => {
      const { data, error } = await ownerClient
        .from("product_costs")
        .delete()
        .eq("product_id", existingProductId)
        .select();

      if (error) {
        expect(error.code).toBe("42501");
      } else {
        expect(data).toHaveLength(0);
      }

      const resCheck = await pgClient.query(`SELECT product_id FROM public.product_costs WHERE product_id = $1`, [
        existingProductId,
      ]);
      expect(resCheck.rows).toHaveLength(1);
    });

    it("Cashier direct DELETE is denied (deletes 0 rows / 42501) and DB cost is preserved", async () => {
      const { data, error } = await cashierClient
        .from("product_costs")
        .delete()
        .eq("product_id", existingProductId)
        .select();

      if (error) {
        expect(error.code).toBe("42501");
      } else {
        expect(data).toHaveLength(0);
      }

      const resCheck = await pgClient.query(`SELECT product_id FROM public.product_costs WHERE product_id = $1`, [
        existingProductId,
      ]);
      expect(resCheck.rows).toHaveLength(1);
    });
  });

  // ===========================================================================
  // 4. PostgreSQL Raw SQL & Catalog RLS Hardening Invariants
  // ===========================================================================
  describe("4. PostgreSQL Raw SQL & Catalog RLS Hardening Invariants", () => {
    it("FORCE ROW LEVEL SECURITY is enabled on products, product_categories, and product_costs", async () => {
      const res = await pgClient.query(`
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN ('products', 'product_categories', 'product_costs');
      `);

      expect(res.rows).toHaveLength(3);
      for (const row of res.rows) {
        expect(row.relrowsecurity).toBe(true);
        expect(row.relforcerowsecurity).toBe(true);
      }
    });

    it("Denial policies are properly defined on all three tables", async () => {
      const res = await pgClient.query(`
        SELECT tablename, policyname, cmd, qual, with_check
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('products', 'product_categories', 'product_costs')
          AND policyname LIKE 'Deny direct client%';
      `);

      // 3 tables * 3 commands (INSERT, UPDATE, DELETE) = 9 denial policies
      expect(res.rows).toHaveLength(9);

      const inserts = res.rows.filter((r) => r.cmd === "INSERT");
      const updates = res.rows.filter((r) => r.cmd === "UPDATE");
      const deletes = res.rows.filter((r) => r.cmd === "DELETE");

      expect(inserts).toHaveLength(3);
      expect(updates).toHaveLength(3);
      expect(deletes).toHaveLength(3);

      for (const r of inserts) {
        expect(r.with_check).toBe("false");
      }
      for (const r of updates) {
        expect(r.qual).toBe("false");
      }
      for (const r of deletes) {
        expect(r.qual).toBe("false");
      }
    });

    it("Direct raw SQL INSERT by authenticated role in transaction fails with 42501", async () => {
      const testSku = `RAW-SQL-${Date.now()}`;
      let capturedCode: string | null = null;

      try {
        await pgClient.query("BEGIN;");
        await pgClient.query("SET LOCAL ROLE authenticated;");
        await pgClient.query(`SET LOCAL "request.jwt.claim.sub" = '${ownerUserId}';`);

        await pgClient.query(
          `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure)
           VALUES ($1, 'Raw SQL Test', $2, 10.0, 'unit');`,
          [orgId, testSku]
        );
      } catch (err: any) {
        capturedCode = err.code;
      } finally {
        await pgClient.query("ROLLBACK;");
      }

      expect(capturedCode).toBe("42501");
    });
  });
});
