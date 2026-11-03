import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client as PgClient } from "pg";
import { SYSTEM_PERMISSIONS } from "@/lib/auth/permissions";

const dbUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("T047: Bidirectional Permission Catalog Consistency (FR-032, FR-033)", () => {
  let pgClient: PgClient;

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();
  });

  afterAll(async () => {
    await pgClient.end();
  });

  it("verifies every TypeScript SYSTEM_PERMISSIONS key exists in PostgreSQL public.permissions table", async () => {
    const res = await pgClient.query("SELECT id FROM public.permissions ORDER BY id ASC;");
    const dbPermissionIds = res.rows.map((r: { id: string }) => r.id);

    for (const perm of SYSTEM_PERMISSIONS) {
      expect(dbPermissionIds).toContain(perm);
    }
  });

  it("verifies every public.permissions table row exists in TypeScript SYSTEM_PERMISSIONS", async () => {
    const res = await pgClient.query("SELECT id FROM public.permissions ORDER BY id ASC;");
    const dbPermissionIds = res.rows.map((r: { id: string }) => r.id);

    expect(dbPermissionIds.length).toBe(SYSTEM_PERMISSIONS.length);
    for (const dbId of dbPermissionIds) {
      expect(SYSTEM_PERMISSIONS).toContain(dbId as any);
    }
  });

  it("verifies role_permissions mappings in database match TypeScript definitions", async () => {
    const res = await pgClient.query(`
      SELECT role, array_agg(permission_id ORDER BY permission_id) as permissions
      FROM public.role_permissions
      GROUP BY role;
    `);

    const roleMap = new Map<string, string[]>();
    for (const row of res.rows) {
      roleMap.set(row.role, row.permissions);
    }

    // Admin has all 7 permissions
    const adminPerms = roleMap.get("admin") || [];
    expect(adminPerms.length).toBe(SYSTEM_PERMISSIONS.length);
    for (const perm of SYSTEM_PERMISSIONS) {
      expect(adminPerms).toContain(perm);
    }

    // Manager has only employees:read
    const managerPerms = roleMap.get("manager") || [];
    expect(managerPerms).toEqual(["employees:read"]);

    // Cashier has no permissions in role_permissions
    const cashierPerms = roleMap.get("cashier") || [];
    expect(cashierPerms).toEqual([]);
  });
});

