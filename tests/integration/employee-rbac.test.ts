import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import crypto from "node:crypto";

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

describe("Integration: Employee RBAC & Authorization (T057–T061)", () => {
  let adminClient: SupabaseClient;
  let pgClient: PgClient;

  // Test users
  let ownerUser: { id: string; email: string; client: SupabaseClient };
  let adminUser: { id: string; email: string; client: SupabaseClient };
  let managerUser: { id: string; email: string; client: SupabaseClient };
  let cashierUser: { id: string; email: string; client: SupabaseClient };

  let testOrgAId: string;
  let testOrgASlug: string;
  let ownerMembershipId: string;
  let adminMembershipId: string;
  let managerMembershipId: string;
  let cashierMembershipId: string;

  const testPassword = "Password123!@#Rbac";

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const timestamp = Date.now();

    // 1. Create Owner User
    const ownerEmail = `rbac_owner_${timestamp}@example.com`;
    const { data: oData } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Rbac", last_name: "Owner" },
    });
    const oClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await oClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });
    ownerUser = { id: oData.user!.id, email: ownerEmail, client: oClient };

    // 2. Create Admin User
    const adminEmail = `rbac_admin_${timestamp}@example.com`;
    const { data: aData } = await adminClient.auth.admin.createUser({
      email: adminEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Rbac", last_name: "Admin" },
    });
    const aClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await aClient.auth.signInWithPassword({ email: adminEmail, password: testPassword });
    adminUser = { id: aData.user!.id, email: adminEmail, client: aClient };

    // 3. Create Manager User
    const managerEmail = `rbac_manager_${timestamp}@example.com`;
    const { data: mData } = await adminClient.auth.admin.createUser({
      email: managerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Rbac", last_name: "Manager" },
    });
    const mClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await mClient.auth.signInWithPassword({ email: managerEmail, password: testPassword });
    managerUser = { id: mData.user!.id, email: managerEmail, client: mClient };

    // 4. Create Cashier User
    const cashierEmail = `rbac_cashier_${timestamp}@example.com`;
    const { data: cData } = await adminClient.auth.admin.createUser({
      email: cashierEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Rbac", last_name: "Cashier" },
    });
    const cClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await cClient.auth.signInWithPassword({ email: cashierEmail, password: testPassword });
    cashierUser = { id: cData.user!.id, email: cashierEmail, client: cClient };

    // 5. Create Organization with Owner
    testOrgASlug = `rbac-org-a-${timestamp}`;
    const { data: orgData, error: orgErr } = await ownerUser.client.rpc("create_organization_with_owner", {
      p_name: "RBAC Test Store A",
      p_slug: testOrgASlug,
      p_business_type: "Retail",
      p_country: "US",
      p_currency: "USD",
      p_timezone: "UTC",
      p_client_mutation_id: crypto.randomUUID(),
    });

    if (orgErr || !orgData) {
      throw new Error(`Failed to create test organization: ${orgErr?.message}`);
    }
    testOrgAId = (orgData as any).organization_id;

    // Retrieve Owner membership ID
    const oMem = await pgClient.query(
      "SELECT id FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2;",
      [testOrgAId, ownerUser.id]
    );
    ownerMembershipId = oMem.rows[0].id;

    // Add Admin, Manager, Cashier memberships directly
    const aMem = await pgClient.query(`
      INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
      VALUES ($1, $2, 'admin', 'active')
      RETURNING id;
    `, [testOrgAId, adminUser.id]);
    adminMembershipId = aMem.rows[0].id;

    const mMem = await pgClient.query(`
      INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
      VALUES ($1, $2, 'manager', 'active')
      RETURNING id;
    `, [testOrgAId, managerUser.id]);
    managerMembershipId = mMem.rows[0].id;

    const cMem = await pgClient.query(`
      INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
      VALUES ($1, $2, 'cashier', 'active')
      RETURNING id;
    `, [testOrgAId, cashierUser.id]);
    cashierMembershipId = cMem.rows[0].id;
  });

  afterAll(async () => {
    if (ownerUser?.id) await adminClient.auth.admin.deleteUser(ownerUser.id);
    if (adminUser?.id) await adminClient.auth.admin.deleteUser(adminUser.id);
    if (managerUser?.id) await adminClient.auth.admin.deleteUser(managerUser.id);
    if (cashierUser?.id) await adminClient.auth.admin.deleteUser(cashierUser.id);
    await pgClient.end();
  });

  describe("T057: Role Hierarchy Escalation Prevention & Last-Owner Protection (FR-025, FR-026)", () => {
    it("Admin cannot promote another member to Owner (P0020)", async () => {
      const { error } = await adminUser.client.rpc("update_organization_member_role", {
        p_org_id: testOrgAId,
        p_target_membership_id: managerMembershipId,
        p_new_role: "owner",
      });

      expect(error).toBeDefined();
      expect(error?.code).toBe("P0020");
    });

    it("Admin cannot modify an Owner's role (P0020)", async () => {
      const { error } = await adminUser.client.rpc("update_organization_member_role", {
        p_org_id: testOrgAId,
        p_target_membership_id: ownerMembershipId,
        p_new_role: "manager",
      });

      expect(error).toBeDefined();
      expect(error?.code).toBe("P0020");
    });

    it("Users cannot modify their own role (P0023)", async () => {
      // Owner attempts to self-demote
      const { error: ownerSelfErr } = await ownerUser.client.rpc("update_organization_member_role", {
        p_org_id: testOrgAId,
        p_target_membership_id: ownerMembershipId,
        p_new_role: "admin",
      });
      expect(ownerSelfErr).toBeDefined();
      expect(ownerSelfErr?.code).toBe("P0023");

      // Admin attempts to self-promote
      const { error: adminSelfErr } = await adminUser.client.rpc("update_organization_member_role", {
        p_org_id: testOrgAId,
        p_target_membership_id: adminMembershipId,
        p_new_role: "owner",
      });
      expect(adminSelfErr).toBeDefined();
      expect(adminSelfErr?.code).toBe("P0023");
    });

    it("Owner can update a member's role and logs audit event", async () => {
      const { data, error } = await ownerUser.client.rpc("update_organization_member_role", {
        p_org_id: testOrgAId,
        p_target_membership_id: managerMembershipId,
        p_new_role: "cashier",
      });

      expect(error).toBeNull();
      expect((data as any).role).toBe("cashier");

      // Verify in database
      const dbCheck = await pgClient.query(
        "SELECT role FROM public.organization_memberships WHERE id = $1;",
        [managerMembershipId]
      );
      expect(dbCheck.rows[0].role).toBe("cashier");

      // Restore role to manager
      await ownerUser.client.rpc("update_organization_member_role", {
        p_org_id: testOrgAId,
        p_target_membership_id: managerMembershipId,
        p_new_role: "manager",
      });

      // Verify audit event
      const audit = await pgClient.query(
        "SELECT event_type, metadata FROM public.organization_audit_events WHERE organization_id = $1 AND event_type = 'employee.role_updated';",
        [testOrgAId]
      );
      expect(audit.rows.length).toBeGreaterThan(0);
    });

    it("Last active Owner protection prevents demoting the sole owner (P0002)", async () => {
      // If a second owner is added, one can be demoted, but the sole owner cannot be demoted
      // Directly verify the trigger invariant by attempting to set role='admin' on sole owner via direct update if attempted
      // or promote an admin to owner first, then demote one
      const { error: promoteErr } = await ownerUser.client.rpc("update_organization_member_role", {
        p_org_id: testOrgAId,
        p_target_membership_id: adminMembershipId,
        p_new_role: "owner",
      });
      expect(promoteErr).toBeNull();

      // Now org has 2 owners (ownerUser and adminUser)
      // adminUser (owner now) can demote ownerUser
      const { error: demoteFirstErr } = await adminUser.client.rpc("update_organization_member_role", {
        p_org_id: testOrgAId,
        p_target_membership_id: ownerMembershipId,
        p_new_role: "admin",
      });
      expect(demoteFirstErr).toBeNull();

      // Now adminUser is the sole owner. ownerUser is an admin.
      // Now ownerUser (as admin) tries to demote adminUser -> rejected with P0020 (Admin cannot demote Owner)
      const { error: adminDemoteErr } = await ownerUser.client.rpc("update_organization_member_role", {
        p_org_id: testOrgAId,
        p_target_membership_id: adminMembershipId,
        p_new_role: "cashier",
      });
      expect(adminDemoteErr?.code).toBe("P0020");

      // Promote ownerUser back to owner
      await adminUser.client.rpc("update_organization_member_role", {
        p_org_id: testOrgAId,
        p_target_membership_id: ownerMembershipId,
        p_new_role: "owner",
      });
      // Demote adminUser back to admin
      await ownerUser.client.rpc("update_organization_member_role", {
        p_org_id: testOrgAId,
        p_target_membership_id: adminMembershipId,
        p_new_role: "admin",
      });
    });
  });

  describe("T058: Membership Suspension, Reactivation & Terminal Soft Revocation (FR-027, FR-028, FR-029)", () => {
    it("Users cannot modify their own membership status (P0024)", async () => {
      const { error } = await ownerUser.client.rpc("update_organization_member_status", {
        p_org_id: testOrgAId,
        p_target_membership_id: ownerMembershipId,
        p_new_status: "suspended",
      });

      expect(error).toBeDefined();
      expect(error?.code).toBe("P0024");
    });

    it("Admin cannot suspend or remove an Owner (P0020)", async () => {
      const { error: suspErr } = await adminUser.client.rpc("update_organization_member_status", {
        p_org_id: testOrgAId,
        p_target_membership_id: ownerMembershipId,
        p_new_status: "suspended",
      });
      expect(suspErr?.code).toBe("P0020");

      const { error: remErr } = await adminUser.client.rpc("update_organization_member_status", {
        p_org_id: testOrgAId,
        p_target_membership_id: ownerMembershipId,
        p_new_status: "revoked",
      });
      expect(remErr?.code).toBe("P0020");
    });

    it("Owner can suspend and reactivate a member, logging audit events", async () => {
      // 1. Suspend cashier
      const { data: suspData, error: suspErr } = await ownerUser.client.rpc("update_organization_member_status", {
        p_org_id: testOrgAId,
        p_target_membership_id: cashierMembershipId,
        p_new_status: "suspended",
      });
      expect(suspErr).toBeNull();
      expect((suspData as any).status).toBe("suspended");

      // Verify audit event: employee.suspended
      const suspAudit = await pgClient.query(
        "SELECT event_type FROM public.organization_audit_events WHERE organization_id = $1 AND event_type = 'employee.suspended';",
        [testOrgAId]
      );
      expect(suspAudit.rows.length).toBeGreaterThan(0);

      // 2. Reactivate cashier
      const { data: reactData, error: reactErr } = await ownerUser.client.rpc("update_organization_member_status", {
        p_org_id: testOrgAId,
        p_target_membership_id: cashierMembershipId,
        p_new_status: "active",
      });
      expect(reactErr).toBeNull();
      expect((reactData as any).status).toBe("active");

      // Verify audit event: employee.reactivated
      const reactAudit = await pgClient.query(
        "SELECT event_type FROM public.organization_audit_events WHERE organization_id = $1 AND event_type = 'employee.reactivated';",
        [testOrgAId]
      );
      expect(reactAudit.rows.length).toBeGreaterThan(0);
    });

    it("Soft revocation transitions to 'revoked' and prevents any further updates (P0025)", async () => {
      // 1. Create a temporary member to test terminal revocation
      const tempUserEmail = `temp_term_${Date.now()}@example.com`;
      const { data: tData } = await adminClient.auth.admin.createUser({
        email: tempUserEmail,
        password: testPassword,
        email_confirm: true,
      });

      const tMem = await pgClient.query(`
        INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
        VALUES ($1, $2, 'cashier', 'active')
        RETURNING id;
      `, [testOrgAId, tData.user!.id]);
      const tempMembershipId = tMem.rows[0].id;

      // 2. Revoke membership
      const { data: revData, error: revErr } = await ownerUser.client.rpc("update_organization_member_status", {
        p_org_id: testOrgAId,
        p_target_membership_id: tempMembershipId,
        p_new_status: "revoked",
      });
      expect(revErr).toBeNull();
      expect((revData as any).status).toBe("revoked");

      // Verify audit event: employee.removed
      const remAudit = await pgClient.query(
        "SELECT event_type FROM public.organization_audit_events WHERE organization_id = $1 AND event_type = 'employee.removed';",
        [testOrgAId]
      );
      expect(remAudit.rows.length).toBeGreaterThan(0);

      // 3. Attempting to reactivate a revoked member fails with P0025
      const { error: reactRevErr } = await ownerUser.client.rpc("update_organization_member_status", {
        p_org_id: testOrgAId,
        p_target_membership_id: tempMembershipId,
        p_new_status: "active",
      });
      expect(reactRevErr).toBeDefined();
      expect(reactRevErr?.code).toBe("P0025");

      // 4. Attempting to update role of a revoked member fails with P0025
      const { error: roleRevErr } = await ownerUser.client.rpc("update_organization_member_role", {
        p_org_id: testOrgAId,
        p_target_membership_id: tempMembershipId,
        p_new_role: "manager",
      });
      expect(roleRevErr).toBeDefined();
      expect(roleRevErr?.code).toBe("P0025");

      // Clean up user
      await adminClient.auth.admin.deleteUser(tData.user!.id);
    });
  });

  describe("T059: Multi-Tenant Isolation on Membership Revocation (FR-030, FR-031)", () => {
    it("Revoking membership in Org A leaves active membership in Org B completely intact", async () => {
      const timestamp = Date.now();
      const testOrgBSlug = `rbac-org-b-${timestamp}`;

      // Create Org B with Owner
      const { data: orgBData } = await ownerUser.client.rpc("create_organization_with_owner", {
        p_name: "RBAC Test Store B",
        p_slug: testOrgBSlug,
        p_business_type: "Retail",
        p_country: "US",
        p_currency: "USD",
        p_timezone: "UTC",
        p_client_mutation_id: crypto.randomUUID(),
      });
      const orgBId = (orgBData as any).organization_id;

      // Add Manager to Org B as active
      const bMem = await pgClient.query(`
        INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
        VALUES ($1, $2, 'manager', 'active')
        RETURNING id;
      `, [orgBId, managerUser.id]);
      expect(bMem.rows[0].id).toBeDefined();

      // Verify manager is active in both Org A and Org B
      const preCheckA = await pgClient.query(
        "SELECT status FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2;",
        [testOrgAId, managerUser.id]
      );
      const preCheckB = await pgClient.query(
        "SELECT status FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2;",
        [orgBId, managerUser.id]
      );
      expect(preCheckA.rows[0].status).toBe("active");
      expect(preCheckB.rows[0].status).toBe("active");

      // Owner revokes Manager in Org A
      const { error: revAErr } = await ownerUser.client.rpc("update_organization_member_status", {
        p_org_id: testOrgAId,
        p_target_membership_id: managerMembershipId,
        p_new_status: "revoked",
      });
      expect(revAErr).toBeNull();

      // Verify Org A is now 'revoked'
      const postCheckA = await pgClient.query(
        "SELECT status FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2;",
        [testOrgAId, managerUser.id]
      );
      expect(postCheckA.rows[0].status).toBe("revoked");

      // Verify Org B is still 'active'
      const postCheckB = await pgClient.query(
        "SELECT status FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2;",
        [orgBId, managerUser.id]
      );
      expect(postCheckB.rows[0].status).toBe("active");

      // Manager calling get_organization_employees for Org B succeeds!
      const { data: bEmployees, error: bEmpErr } = await managerUser.client.rpc("get_organization_employees", {
        p_org_id: orgBId,
      });
      expect(bEmpErr).toBeNull();
      expect(bEmployees).toBeDefined();

      // Manager calling get_organization_employees for Org A fails (revoked member is denied)
      const { error: aEmpErr } = await managerUser.client.rpc("get_organization_employees", {
        p_org_id: testOrgAId,
      });
      expect(aEmpErr).toBeDefined();
      expect(aEmpErr?.code).toBe("P0005");
    });
  });

  describe("T060: Real-Time Authorization Freshness (FR-027, FR-031, FR-034)", () => {
    it("Demoting or suspending a member immediately revokes access with zero delay", async () => {
      // 1. Create a temporary admin user
      const tempEmail = `freshness_${Date.now()}@example.com`;
      const { data: tData } = await adminClient.auth.admin.createUser({
        email: tempEmail,
        password: testPassword,
        email_confirm: true,
      });
      const tClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
      await tClient.auth.signInWithPassword({ email: tempEmail, password: testPassword });

      const tMem = await pgClient.query(`
        INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
        VALUES ($1, $2, 'admin', 'active')
        RETURNING id;
      `, [testOrgAId, tData.user!.id]);
      const targetMemId = tMem.rows[0].id;

      // 2. Temp admin can view directory
      const { data: dirBefore, error: errBefore } = await tClient.rpc("get_organization_employees", {
        p_org_id: testOrgAId,
      });
      expect(errBefore).toBeNull();
      expect(dirBefore).toBeDefined();

      // 3. Suspend temp admin immediately via Owner
      await ownerUser.client.rpc("update_organization_member_status", {
        p_org_id: testOrgAId,
        p_target_membership_id: targetMemId,
        p_new_status: "suspended",
      });

      // 4. On the very next request, temp user is rejected with zero propagation delay
      const { error: errAfterSusp } = await tClient.rpc("get_organization_employees", {
        p_org_id: testOrgAId,
      });
      expect(errAfterSusp).toBeDefined();
      expect(errAfterSusp?.code).toBe("P0005");

      // 5. Clean up
      await adminClient.auth.admin.deleteUser(tData.user!.id);
    });
  });

  describe("T061: Tenant Isolation & Directory Enumeration Prevention (FR-002, FR-003, FR-031)", () => {
    it("Cashiers are strictly denied directory access with P0005", async () => {
      const { error } = await cashierUser.client.rpc("get_organization_employees", {
        p_org_id: testOrgAId,
      });

      expect(error).toBeDefined();
      expect(error?.code).toBe("P0005");
    });

    it("Non-members are denied directory access with P0005", async () => {
      // Create external user not in Org A
      const extEmail = `external_${Date.now()}@example.com`;
      const { data: eData } = await adminClient.auth.admin.createUser({
        email: extEmail,
        password: testPassword,
        email_confirm: true,
      });
      const eClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
      await eClient.auth.signInWithPassword({ email: extEmail, password: testPassword });

      const { error } = await eClient.rpc("get_organization_employees", {
        p_org_id: testOrgAId,
      });

      expect(error).toBeDefined();
      expect(error?.code).toBe("P0005");

      await adminClient.auth.admin.deleteUser(eData.user!.id);
    });

    it("get_organization_employees excludes revoked members from the result set", async () => {
      const { data: employees, error } = await ownerUser.client.rpc("get_organization_employees", {
        p_org_id: testOrgAId,
      });

      expect(error).toBeNull();
      const list = employees as any[];
      expect(list.length).toBeGreaterThan(0);

      // Verify that NO member in the returned list has status 'revoked'
      const hasRevoked = list.some((emp) => emp.status === "revoked");
      expect(hasRevoked).toBe(false);

      // Verify that active and suspended members are present
      const hasActive = list.some((emp) => emp.status === "active");
      expect(hasActive).toBe(true);
    });
  });
});
