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

describe("Integration: Invitations & RLS (T050–T056)", () => {
  let adminClient: SupabaseClient;
  let anonClient: SupabaseClient;
  let pgClient: PgClient;

  // Users
  let ownerUser: { id: string; email: string; client: SupabaseClient };
  let adminUser: { id: string; email: string; client: SupabaseClient };
  let inviteeUser: { id: string; email: string; client: SupabaseClient };
  let mismatchUser: { id: string; email: string; client: SupabaseClient };

  let testOrgId: string;
  let testOrgSlug: string;

  const testPassword = "Password123!@#Test";

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

    // 1. Create Owner User
    const ownerEmail = `inv_owner_${timestamp}@example.com`;
    const { data: oData } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Invite", last_name: "Owner" },
    });
    const oClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await oClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });
    ownerUser = { id: oData.user!.id, email: ownerEmail, client: oClient };

    // 2. Create Admin User
    const adminEmail = `inv_admin_${timestamp}@example.com`;
    const { data: aData } = await adminClient.auth.admin.createUser({
      email: adminEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Invite", last_name: "Admin" },
    });
    const aClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await aClient.auth.signInWithPassword({ email: adminEmail, password: testPassword });
    adminUser = { id: aData.user!.id, email: adminEmail, client: aClient };

    // 3. Create Invitee User
    const inviteeEmail = `inv_recipient_${timestamp}@example.com`;
    const { data: iData } = await adminClient.auth.admin.createUser({
      email: inviteeEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Invite", last_name: "Recipient" },
    });
    const iClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await iClient.auth.signInWithPassword({ email: inviteeEmail, password: testPassword });
    inviteeUser = { id: iData.user!.id, email: inviteeEmail, client: iClient };

    // 4. Create Mismatch User
    const mismatchEmail = `inv_mismatch_${timestamp}@example.com`;
    const { data: mData } = await adminClient.auth.admin.createUser({
      email: mismatchEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "Invite", last_name: "Mismatch" },
    });
    const mClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await mClient.auth.signInWithPassword({ email: mismatchEmail, password: testPassword });
    mismatchUser = { id: mData.user!.id, email: mismatchEmail, client: mClient };

    // 5. Create Organization with Owner
    testOrgSlug = `inv-org-${timestamp}`;
    const { data: orgData, error: orgErr } = await ownerUser.client.rpc("create_organization_with_owner", {
      p_name: "Invitation Test Store",
      p_slug: testOrgSlug,
      p_business_type: "Retail",
      p_country: "US",
      p_currency: "USD",
      p_timezone: "UTC",
      p_client_mutation_id: crypto.randomUUID(),
    });

    if (orgErr || !orgData) {
      throw new Error(`Failed to create test organization: ${orgErr?.message}`);
    }
    testOrgId = (orgData as any).organization_id;

    // Add Admin user to org memberships
    await pgClient.query(`
      INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
      VALUES ($1, $2, 'admin', 'active');
    `, [testOrgId, adminUser.id]);
  });

  afterAll(async () => {
    if (ownerUser?.id) await adminClient.auth.admin.deleteUser(ownerUser.id);
    if (adminUser?.id) await adminClient.auth.admin.deleteUser(adminUser.id);
    if (inviteeUser?.id) await adminClient.auth.admin.deleteUser(inviteeUser.id);
    if (mismatchUser?.id) await adminClient.auth.admin.deleteUser(mismatchUser.id);
    await pgClient.end();
  });

  describe("T050: Invitation Lifecycle & Direct Client Mutation Denial (FR-007, FR-008, FR-009, FR-013, FR-014, FR-022)", () => {
    it("denies direct client INSERT on organization_invitations", async () => {
      const { data, error } = await ownerUser.client
        .from("organization_invitations")
        .insert({
          organization_id: testOrgId,
          email: "hacker@example.com",
          role: "manager",
          token_hash: "c".repeat(64),
          invited_by: ownerUser.id,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        })
        .select();

      expect(error).toBeDefined();
      expect(data).toBeNull();
    });

    it("creates invitation via RPC with SHA-256 token hash and 7-day bounds", async () => {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const testEmail = `first_invite_${Date.now()}@example.com`;

      const { data, error } = await ownerUser.client.rpc("create_organization_invitation", {
        p_org_id: testOrgId,
        p_email: testEmail,
        p_role: "manager",
        p_token_hash: tokenHash,
        p_expires_at: expiresAt,
      });

      expect(error).toBeNull();
      const res = data as any;
      expect(res.invitation_id).toBeDefined();
      expect(res.email).toBe(testEmail);
      expect(res.role).toBe("manager");
      expect(res.status).toBe("pending");
    });
  });

  describe("T051: Direct RPC Input-Validation Bypass Rejections (FR-006, FR-007, FR-009, FR-034)", () => {
    it("rejects malformed email format with P0009", async () => {
      const tokenHash = "d".repeat(64);
      const expiresAt = new Date(Date.now() + 86400000).toISOString();

      const { error } = await ownerUser.client.rpc("create_organization_invitation", {
        p_org_id: testOrgId,
        p_email: "not-an-email",
        p_role: "cashier",
        p_token_hash: tokenHash,
        p_expires_at: expiresAt,
      });

      expect(error).toBeDefined();
      expect(error?.code).toBe("P0009");
    });

    it("rejects non-hex or invalid length token hashes with P0009", async () => {
      const expiresAt = new Date(Date.now() + 86400000).toISOString();

      const { error } = await ownerUser.client.rpc("create_organization_invitation", {
        p_org_id: testOrgId,
        p_email: "valid@example.com",
        p_role: "cashier",
        p_token_hash: "too-short",
        p_expires_at: expiresAt,
      });

      expect(error).toBeDefined();
      expect(error?.code).toBe("P0009");
    });

    it("rejects invitation lifetime exceeding 7 days with P0009", async () => {
      const tokenHash = "e".repeat(64);
      // 8 days in future
      const invalidExpiry = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString();

      const { error } = await ownerUser.client.rpc("create_organization_invitation", {
        p_org_id: testOrgId,
        p_email: "valid2@example.com",
        p_role: "cashier",
        p_token_hash: tokenHash,
        p_expires_at: invalidExpiry,
      });

      expect(error).toBeDefined();
      expect(error?.code).toBe("P0009");
    });
  });

  describe("T052: Zero-Disclosure Pre-Flight Token Validation (FR-016)", () => {
    it("validate_invitation_token discloses zero tenant or role metadata to anon callers", async () => {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + 86400000).toISOString();

      // Create invite via owner
      await ownerUser.client.rpc("create_organization_invitation", {
        p_org_id: testOrgId,
        p_email: `anon_check_${Date.now()}@example.com`,
        p_role: "manager",
        p_token_hash: tokenHash,
        p_expires_at: expiresAt,
      });

      // Query validate_invitation_token as anon
      const { data, error } = await anonClient.rpc("validate_invitation_token", {
        p_token_hash: tokenHash,
      });

      expect(error).toBeNull();
      const val = data as any;
      expect(val.is_valid).toBe(true);
      expect(val.is_expired).toBe(false);
      expect(val.status).toBe("pending");

      // Verify zero-disclosure of sensitive fields
      expect(val.organization_id).toBeUndefined();
      expect(val.organization_name).toBeUndefined();
      expect(val.email).toBeUndefined();
      expect(val.role).toBeUndefined();
    });
  });

  describe("T053: Concurrent Duplicate Handling & Expired Invitation Reinvitation (FR-010, FR-011, FR-035)", () => {
    it("rejects active duplicate invitation creation with P0022", async () => {
      const dupEmail = `dup_test_${Date.now()}@example.com`;
      const hash1 = crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex");
      const hash2 = crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex");
      const expiresAt = new Date(Date.now() + 86400000).toISOString();

      // First invite succeeds
      const { error: err1 } = await ownerUser.client.rpc("create_organization_invitation", {
        p_org_id: testOrgId,
        p_email: dupEmail,
        p_role: "cashier",
        p_token_hash: hash1,
        p_expires_at: expiresAt,
      });
      expect(err1).toBeNull();

      // Second duplicate invite is rejected with P0022
      const { error: err2 } = await ownerUser.client.rpc("create_organization_invitation", {
        p_org_id: testOrgId,
        p_email: dupEmail,
        p_role: "cashier",
        p_token_hash: hash2,
        p_expires_at: expiresAt,
      });
      expect(err2).toBeDefined();
      expect(err2?.code).toBe("P0022");
    });

    it("transitions expired pending invite to 'expired' and records employee.invitation_expired before inserting new invite", async () => {
      const reinviteEmail = `reinvite_${Date.now()}@example.com`;
      const hash1 = crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex");
      const hash2 = crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex");
      const futureExpiry = new Date(Date.now() + 86400000).toISOString();

      // Insert an expired invitation directly into database
      const expiredAt = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
      await pgClient.query(`
        INSERT INTO public.organization_invitations (organization_id, email, role, token_hash, invited_by, status, expires_at)
        VALUES ($1, $2, 'cashier', $3, $4, 'pending', $5);
      `, [testOrgId, reinviteEmail, hash1, ownerUser.id, expiredAt]);

      // Reinviting the same email should succeed and transition old invite to 'expired'
      const { data, error } = await ownerUser.client.rpc("create_organization_invitation", {
        p_org_id: testOrgId,
        p_email: reinviteEmail,
        p_role: "manager",
        p_token_hash: hash2,
        p_expires_at: futureExpiry,
      });

      expect(error).toBeNull();
      expect((data as any).status).toBe("pending");

      // Verify old invitation status transitioned to 'expired'
      const oldCheck = await pgClient.query(
        "SELECT status FROM public.organization_invitations WHERE token_hash = $1;",
        [hash1]
      );
      expect(oldCheck.rows[0].status).toBe("expired");

      // Verify employee.invitation_expired audit event was logged
      const auditCheck = await pgClient.query(
        "SELECT event_type FROM public.organization_audit_events WHERE organization_id = $1 AND event_type = 'employee.invitation_expired';",
        [testOrgId]
      );
      expect(auditCheck.rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("T054 & T055: Replay Prevention & Email Mismatch Privacy (FR-020, FR-021, FR-023)", () => {
    it("returns generic EMAIL_MISMATCH when caller email does not match invitation recipient", async () => {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + 86400000).toISOString();
      const targetEmail = `target_mismatch_${Date.now()}@example.com`;

      // Create invitation for targetEmail
      const { error: createErr } = await ownerUser.client.rpc("create_organization_invitation", {
        p_org_id: testOrgId,
        p_email: targetEmail,
        p_role: "cashier",
        p_token_hash: tokenHash,
        p_expires_at: expiresAt,
      });
      expect(createErr).toBeNull();

      // MismatchUser attempts to accept
      const { data, error } = await mismatchUser.client.rpc("accept_organization_invitation", {
        p_token_hash: tokenHash,
      });

      expect(error).toBeNull();
      const res = data as any;
      expect(res.success).toBe(false);
      expect(res.code).toBe("EMAIL_MISMATCH");
      // Assert no expected or actual email addresses leaked
      expect(res.message).not.toContain(targetEmail);
      expect(res.message).not.toContain(mismatchUser.email);
    });

    it("successfully accepts invitation and prevents replay", async () => {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + 86400000).toISOString();

      const { error: createErr } = await ownerUser.client.rpc("create_organization_invitation", {
        p_org_id: testOrgId,
        p_email: inviteeUser.email,
        p_role: "manager",
        p_token_hash: tokenHash,
        p_expires_at: expiresAt,
      });
      expect(createErr).toBeNull();

      // Invitee accepts
      const { data: acceptData, error: acceptErr } = await inviteeUser.client.rpc("accept_organization_invitation", {
        p_token_hash: tokenHash,
      });

      expect(acceptErr).toBeNull();
      const acceptRes = acceptData as any;
      expect(acceptRes.success).toBe(true);
      expect(acceptRes.role).toBe("manager");

      // Verify membership created
      const memCheck = await pgClient.query(
        "SELECT role, status FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2;",
        [testOrgId, inviteeUser.id]
      );
      expect(memCheck.rows[0].status).toBe("active");
      expect(memCheck.rows[0].role).toBe("manager");

      // Replay attempt fails: INVITATION_NOT_PENDING
      const { data: replayData } = await inviteeUser.client.rpc("accept_organization_invitation", {
        p_token_hash: tokenHash,
      });
      expect((replayData as any).success).toBe(false);
      expect((replayData as any).code).toBe("INVITATION_NOT_PENDING");
    });
  });

  describe("T056: Resend Behavior & Token Invalidation (FR-014, FR-015)", () => {
    it("resend generates new token hash and invalidates old token", async () => {
      const email = `resend_test_${Date.now()}@example.com`;
      const oldRaw = crypto.randomBytes(32).toString("hex");
      const oldHash = crypto.createHash("sha256").update(oldRaw).digest("hex");
      const newRaw = crypto.randomBytes(32).toString("hex");
      const newHash = crypto.createHash("sha256").update(newRaw).digest("hex");

      const { data: createData } = await ownerUser.client.rpc("create_organization_invitation", {
        p_org_id: testOrgId,
        p_email: email,
        p_role: "cashier",
        p_token_hash: oldHash,
        p_expires_at: new Date(Date.now() + 86400000).toISOString(),
      });
      const invId = (createData as any).invitation_id;

      // Resend with new hash
      const { data: resendData, error: resendErr } = await ownerUser.client.rpc("resend_organization_invitation", {
        p_invitation_id: invId,
        p_new_token_hash: newHash,
        p_new_expires_at: new Date(Date.now() + 3 * 86400000).toISOString(),
      });
      expect(resendErr).toBeNull();
      expect((resendData as any).status).toBe("pending");

      // Old token validation returns invalid
      const { data: oldVal } = await anonClient.rpc("validate_invitation_token", {
        p_token_hash: oldHash,
      });
      expect((oldVal as any).is_valid).toBe(false);

      // New token validation returns valid
      const { data: newVal } = await anonClient.rpc("validate_invitation_token", {
        p_token_hash: newHash,
      });
      expect((newVal as any).is_valid).toBe(true);
    });
  });
});
