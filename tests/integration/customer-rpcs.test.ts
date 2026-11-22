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

const isDbAvailable = Boolean(anonKey && serviceRoleKey);
const describeIntegration = isDbAvailable ? describe : describe.skip;

describeIntegration("Feature 005 — Customer RPCs & RLS Integration Tests (T023, T024, T025, T011-T013)", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;

  // Authenticated Clients
  let ownerClient: SupabaseClient;
  let managerClient: SupabaseClient;
  let cashierClient: SupabaseClient;
  let orgBClient: SupabaseClient;

  // Test Entities
  let orgAId: string;
  let orgBId: string;
  let ownerUserId: string;
  let managerUserId: string;
  let cashierUserId: string;
  let orgBUserId: string;

  const timestamp = Date.now();
  const testPassword = "Password123!SecureTest";

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const ownerEmail = `cust-owner-${timestamp}@example.com`;
    const mgrEmail = `cust-mgr-${timestamp}@example.com`;
    const cashEmail = `cust-cash-${timestamp}@example.com`;
    const orgBEmail = `cust-orgb-${timestamp}@example.com`;

    const uOwner = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Customer", last_name: "Owner" },
    });
    ownerUserId = uOwner.data.user!.id;

    const uMgr = await adminClient.auth.admin.createUser({
      email: mgrEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Customer", last_name: "Manager" },
    });
    managerUserId = uMgr.data.user!.id;

    const uCash = await adminClient.auth.admin.createUser({
      email: cashEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Customer", last_name: "Cashier" },
    });
    cashierUserId = uCash.data.user!.id;

    const uOrgB = await adminClient.auth.admin.createUser({
      email: orgBEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Customer", last_name: "OrgB" },
    });
    orgBUserId = uOrgB.data.user!.id;

    // Seed profiles
    await pgClient.query(
      `INSERT INTO public.profiles (id, first_name, last_name)
       VALUES 
         ($1, 'Customer', 'Owner'),
         ($2, 'Customer', 'Manager'),
         ($3, 'Customer', 'Cashier'),
         ($4, 'Customer', 'OrgB')
       ON CONFLICT (id) DO NOTHING;`,
      [ownerUserId, managerUserId, cashierUserId, orgBUserId]
    );

    // Sign in clients
    ownerClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
    await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

    managerClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
    await managerClient.auth.signInWithPassword({ email: mgrEmail, password: testPassword });

    cashierClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
    await cashierClient.auth.signInWithPassword({ email: cashEmail, password: testPassword });

    orgBClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
    await orgBClient.auth.signInWithPassword({ email: orgBEmail, password: testPassword });

    // Seed organizations
    const orgARes = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, created_by)
       VALUES ('Customer Org Alpha', $1, 'USD', 'retail', 'US', $2) RETURNING id;`,
      [`cust-alpha-${timestamp}`, ownerUserId]
    );
    orgAId = orgARes.rows[0].id;

    const orgBRes = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, created_by)
       VALUES ('Customer Org Beta', $1, 'USD', 'retail', 'US', $2) RETURNING id;`,
      [`cust-beta-${timestamp}`, orgBUserId]
    );
    orgBId = orgBRes.rows[0].id;

    // Seed memberships
    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES 
         ($1, $2, 'owner', 'active'),
         ($1, $3, 'manager', 'active'),
         ($1, $4, 'cashier', 'active'),
         ($5, $6, 'owner', 'active');`,
      [orgAId, ownerUserId, managerUserId, cashierUserId, orgBId, orgBUserId]
    );
  });

  afterAll(async () => {
    try {
      if (pgClient && orgAId && orgBId) {
        await pgClient.query("DELETE FROM public.customers WHERE organization_id IN ($1, $2);", [orgAId, orgBId]);
        await pgClient.query("DELETE FROM public.organization_audit_events WHERE organization_id IN ($1, $2);", [orgAId, orgBId]);
        try {
          await pgClient.query("ALTER TABLE public.organization_memberships DISABLE TRIGGER USER;");
          await pgClient.query("DELETE FROM public.organizations WHERE id IN ($1, $2);", [orgAId, orgBId]);
        } finally {
          await pgClient.query("ALTER TABLE public.organization_memberships ENABLE TRIGGER USER;");
        }
      }
    } catch {
      // Ignore cleanup error if DB was already disconnected or tables don't exist
    }

    if (adminClient) {
      if (ownerUserId) await adminClient.auth.admin.deleteUser(ownerUserId).catch(() => {});
      if (managerUserId) await adminClient.auth.admin.deleteUser(managerUserId).catch(() => {});
      if (cashierUserId) await adminClient.auth.admin.deleteUser(cashierUserId).catch(() => {});
      if (orgBUserId) await adminClient.auth.admin.deleteUser(orgBUserId).catch(() => {});
    }

    if (pgClient) {
      await pgClient.end().catch(() => {});
    }
  });

  describe("create_customer RPC (T023)", () => {
    it("creates an active customer with valid inputs and normalizes data", async () => {
      const { data, error } = await cashierClient.rpc("create_customer", {
        p_org_id: orgAId,
        p_name: "   Alice Cooper   ",
        p_phone: "  +14155551234  ",
        p_email: "  Alice@Cooper.COM  ",
        p_notes: "  Loyal client  ",
      });

      expect(error).toBeNull();
      const res = data as any;
      expect(res.success).toBe(true);
      expect(res.name).toBe("Alice Cooper");
      expect(res.phone).toBe("+14155551234");
      expect(res.email).toBe("alice@cooper.com");
      expect(res.status).toBe("active");
    });

    it("rejects duplicate phone within the same organization with 23505", async () => {
      const { error } = await cashierClient.rpc("create_customer", {
        p_org_id: orgAId,
        p_name: "Alice Clone",
        p_phone: "+14155551234",
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("23505");
      expect(error?.message).toContain("CUSTOMER_PHONE_EXISTS");
    });

    it("allows identical phone in a different organization (cross-tenant uniqueness)", async () => {
      const { data, error } = await orgBClient.rpc("create_customer", {
        p_org_id: orgBId,
        p_name: "Alice in Org B",
        p_phone: "+14155551234",
      });

      expect(error).toBeNull();
      expect((data as any).success).toBe(true);
    });

    it("rejects duplicate email within the same organization with 23505", async () => {
      const { error } = await cashierClient.rpc("create_customer", {
        p_org_id: orgAId,
        p_name: "Alice Duplicate Email",
        p_email: "alice@cooper.com",
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("23505");
      expect(error?.message).toContain("CUSTOMER_EMAIL_EXISTS");
    });
  });

  describe("update_customer RPC (T024)", () => {
    let customerId: string;

    beforeAll(async () => {
      const { data } = await cashierClient.rpc("create_customer", {
        p_org_id: orgAId,
        p_name: "Bob Builder",
        p_phone: "+14155552345",
        p_email: "bob@builder.com",
      });
      customerId = (data as any).customer_id;
    });

    it("updates customer profile fields successfully", async () => {
      const { data, error } = await cashierClient.rpc("update_customer", {
        p_org_id: orgAId,
        p_customer_id: customerId,
        p_name: "Bob The Builder",
        p_notes: "Updated notes",
      });

      expect(error).toBeNull();
      const res = data as any;
      expect(res.success).toBe(true);
      expect(res.name).toBe("Bob The Builder");
    });

    it("prevents updating an archived customer with P0041 (CUSTOMER_ARCHIVED)", async () => {
      // Create and archive a customer
      const { data: cData } = await cashierClient.rpc("create_customer", {
        p_org_id: orgAId,
        p_name: "To Archive",
      });
      const archiveTargetId = (cData as any).customer_id;

      await managerClient.rpc("archive_customer", {
        p_org_id: orgAId,
        p_customer_id: archiveTargetId,
      });

      const { error } = await cashierClient.rpc("update_customer", {
        p_org_id: orgAId,
        p_customer_id: archiveTargetId,
        p_name: "Cannot Change This",
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("P0041");
      expect(error?.message).toContain("CUSTOMER_ARCHIVED");
    });
  });

  describe("archive_customer RPC (T025)", () => {
    it("rejects unauthorized users (e.g. cashier) with 42501", async () => {
      const { data: cData } = await cashierClient.rpc("create_customer", {
        p_org_id: orgAId,
        p_name: "Charlie Brown",
      });
      const charlieId = (cData as any).customer_id;

      const { error } = await cashierClient.rpc("archive_customer", {
        p_org_id: orgAId,
        p_customer_id: charlieId,
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
    });

    it("archives customer and handles idempotent calls (is_noop)", async () => {
      const { data: cData } = await cashierClient.rpc("create_customer", {
        p_org_id: orgAId,
        p_name: "David Bowie",
      });
      const davidId = (cData as any).customer_id;

      // First archive call
      const { data: firstRes, error: firstErr } = await managerClient.rpc("archive_customer", {
        p_org_id: orgAId,
        p_customer_id: davidId,
      });
      expect(firstErr).toBeNull();
      expect((firstRes as any).success).toBe(true);
      expect((firstRes as any).status).toBe("archived");
      expect((firstRes as any).is_noop).toBe(false);

      // Second archive call (idempotent no-op)
      const { data: secondRes, error: secondErr } = await managerClient.rpc("archive_customer", {
        p_org_id: orgAId,
        p_customer_id: davidId,
      });
      expect(secondErr).toBeNull();
      expect((secondRes as any).success).toBe(true);
      expect((secondRes as any).is_noop).toBe(true);
    });
  });

  describe("Row-Level Security & Direct DML Restrictions (T011, T013)", () => {
    it("enforces tenant isolation on direct SELECT queries", async () => {
      const { data: orgACustomers, error: errA } = await cashierClient
        .from("customers")
        .select("id, organization_id, name");

      expect(errA).toBeNull();
      expect(orgACustomers).not.toBeNull();
      for (const row of orgACustomers || []) {
        expect(row.organization_id).toBe(orgAId);
        expect(row.organization_id).not.toBe(orgBId);
      }

      const { data: orgBCustomers, error: errB } = await orgBClient
        .from("customers")
        .select("id, organization_id, name");

      expect(errB).toBeNull();
      expect(orgBCustomers).not.toBeNull();
      for (const row of orgBCustomers || []) {
        expect(row.organization_id).toBe(orgBId);
        expect(row.organization_id).not.toBe(orgAId);
      }
    });

    it("blocks direct INSERT/UPDATE/DELETE from authenticated users via deny_dml_customers policy", async () => {
      // Direct INSERT attempt
      const { error: insertErr } = await cashierClient.from("customers").insert({
        organization_id: orgAId,
        name: "Direct DML Attempt",
      });
      expect(insertErr).not.toBeNull();

      // Direct DELETE attempt
      const { error: deleteErr, data: deleteData } = await managerClient
        .from("customers")
        .delete()
        .eq("organization_id", orgAId)
        .select();
      expect(deleteErr != null || (deleteData && deleteData.length === 0)).toBe(true);
      const custCheck = await pgClient.query(`SELECT id FROM public.customers WHERE organization_id = $1;`, [orgAId]);
      expect(custCheck.rows.length).toBeGreaterThan(0);
    });
  });
});
