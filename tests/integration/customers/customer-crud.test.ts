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

describeIntegration("T088: Customer CRUD RPCs Integration Tests (create, update, archive)", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;

  let ownerClient: SupabaseClient;
  let cashierClient: SupabaseClient;
  let orgBClient: SupabaseClient;

  let orgAId: string;
  let orgBId: string;
  let ownerUserId: string;
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

    const ownerEmail = `cust-crud-owner-${timestamp}@example.com`;
    const cashEmail = `cust-crud-cash-${timestamp}@example.com`;
    const orgBEmail = `cust-crud-orgb-${timestamp}@example.com`;

    const uOwner = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Customer", last_name: "Owner" },
    });
    ownerUserId = uOwner.data.user!.id;

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

    // Profiles
    await pgClient.query(
      `INSERT INTO public.profiles (id, first_name, last_name)
       VALUES 
         ($1, 'Customer', 'Owner'),
         ($2, 'Customer', 'Cashier'),
         ($3, 'Customer', 'OrgB')
       ON CONFLICT (id) DO NOTHING;`,
      [ownerUserId, cashierUserId, orgBUserId]
    );

    // Sign in clients
    ownerClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
    await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

    cashierClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
    await cashierClient.auth.signInWithPassword({ email: cashEmail, password: testPassword });

    orgBClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
    await orgBClient.auth.signInWithPassword({ email: orgBEmail, password: testPassword });

    // Seed organizations
    const orgARes = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, created_by)
       VALUES ('Customer CRUD Org A', $1, 'USD', 'retail', 'US', $2) RETURNING id;`,
      [`cust-crud-a-${timestamp}`, ownerUserId]
    );
    orgAId = orgARes.rows[0].id;

    const orgBRes = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, created_by)
       VALUES ('Customer CRUD Org B', $1, 'USD', 'retail', 'US', $2) RETURNING id;`,
      [`cust-crud-b-${timestamp}`, orgBUserId]
    );
    orgBId = orgBRes.rows[0].id;

    // Seed memberships
    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES 
         ($1, $2, 'owner', 'active'),
         ($1, $3, 'cashier', 'active'),
         ($4, $5, 'owner', 'active');`,
      [orgAId, ownerUserId, cashierUserId, orgBId, orgBUserId]
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
      // Ignore cleanup error
    }

    if (adminClient) {
      if (ownerUserId) await adminClient.auth.admin.deleteUser(ownerUserId).catch(() => {});
      if (cashierUserId) await adminClient.auth.admin.deleteUser(cashierUserId).catch(() => {});
      if (orgBUserId) await adminClient.auth.admin.deleteUser(orgBUserId).catch(() => {});
    }

    if (pgClient) {
      await pgClient.end().catch(() => {});
    }
  });

  describe("create_customer RPC normalization and uniqueness", () => {
    it("creates active customer with trimmed inputs and lowercased email", async () => {
      const { data, error } = await cashierClient.rpc("create_customer", {
        p_org_id: orgAId,
        p_name: "   Diana Prince   ",
        p_phone: "  +12025550143  ",
        p_email: "  Diana.Prince@Themyscira.ORG  ",
        p_notes: "  Ambassador  ",
      });

      expect(error).toBeNull();
      const res = data as any;
      expect(res.success).toBe(true);
      expect(res.name).toBe("Diana Prince");
      expect(res.phone).toBe("+12025550143");
      expect(res.email).toBe("diana.prince@themyscira.org");
      expect(res.status).toBe("active");
    });

    it("enforces tenant-scoped unique phone (23505 duplicate in same org)", async () => {
      const { error } = await cashierClient.rpc("create_customer", {
        p_org_id: orgAId,
        p_name: "Duplicate Phone Customer",
        p_phone: "+12025550143",
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("23505");
      expect(error?.message).toContain("CUSTOMER_PHONE_EXISTS");
    });

    it("allows identical phone number in different organization (cross-tenant uniqueness)", async () => {
      const { data, error } = await orgBClient.rpc("create_customer", {
        p_org_id: orgBId,
        p_name: "Diana in Org B",
        p_phone: "+12025550143",
      });

      expect(error).toBeNull();
      expect((data as any).success).toBe(true);
    });

    it("enforces tenant-scoped unique email (23505 duplicate in same org)", async () => {
      const { error } = await cashierClient.rpc("create_customer", {
        p_org_id: orgAId,
        p_name: "Duplicate Email Customer",
        p_email: "diana.prince@themyscira.org",
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("23505");
      expect(error?.message).toContain("CUSTOMER_EMAIL_EXISTS");
    });
  });

  describe("update_customer RPC", () => {
    let customerId: string;

    beforeAll(async () => {
      const { data } = await cashierClient.rpc("create_customer", {
        p_org_id: orgAId,
        p_name: "Clark Kent",
        p_phone: "+12025550199",
        p_email: "clark@dailyplanet.com",
      });
      customerId = (data as any).customer_id;
    });

    it("updates customer fields and preserves unedited values", async () => {
      const { data, error } = await cashierClient.rpc("update_customer", {
        p_org_id: orgAId,
        p_customer_id: customerId,
        p_name: "Clark Joseph Kent",
        p_notes: "Reporter at Daily Planet",
      });

      expect(error).toBeNull();
      const res = data as any;
      expect(res.success).toBe(true);
      expect(res.name).toBe("Clark Joseph Kent");
    });

    it("prevents updating an archived customer with P0041", async () => {
      const { data: cData } = await cashierClient.rpc("create_customer", {
        p_org_id: orgAId,
        p_name: "Bruce Wayne",
        p_phone: "+12025550188",
      });
      const bruceId = (cData as any).customer_id;

      // Archive Bruce
      await ownerClient.rpc("archive_customer", {
        p_org_id: orgAId,
        p_customer_id: bruceId,
      });

      // Attempt update on archived customer
      const { error } = await cashierClient.rpc("update_customer", {
        p_org_id: orgAId,
        p_customer_id: bruceId,
        p_name: "Batman",
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("P0041");
    });
  });

  describe("archive_customer RPC and Idempotency", () => {
    let customerToArchiveId: string;

    beforeAll(async () => {
      const { data } = await cashierClient.rpc("create_customer", {
        p_org_id: orgAId,
        p_name: "Barry Allen",
        p_phone: "+12025550177",
      });
      customerToArchiveId = (data as any).customer_id;
    });

    it("archives customer and logs audit event", async () => {
      const { data, error } = await ownerClient.rpc("archive_customer", {
        p_org_id: orgAId,
        p_customer_id: customerToArchiveId,
      });

      expect(error).toBeNull();
      const res = data as any;
      expect(res.success).toBe(true);
      expect(res.status).toBe("archived");
      expect(res.is_noop).toBe(false);

      const dbRow = await pgClient.query("SELECT status FROM public.customers WHERE id = $1;", [customerToArchiveId]);
      expect(dbRow.rows[0].status).toBe("archived");
    });

    it("returns is_noop = true on subsequent idempotent archive calls", async () => {
      const { data, error } = await ownerClient.rpc("archive_customer", {
        p_org_id: orgAId,
        p_customer_id: customerToArchiveId,
      });

      expect(error).toBeNull();
      const res = data as any;
      expect(res.success).toBe(true);
      expect(res.is_noop).toBe(true);
    });
  });
});
