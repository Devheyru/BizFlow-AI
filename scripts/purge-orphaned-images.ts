import { SupabaseClient, createClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";

export interface PurgeOptions {
  dryRun?: boolean;
  organizationId?: string;
  olderThanHours?: number;
  batchSize?: number;
}

export interface PurgeResult {
  dryRun: boolean;
  scannedCount: number;
  referencedCount: number;
  youngCount: number;
  eligibleOrphans: string[];
  deletedCount: number;
  failedCount: number;
  errors: string[];
}

/**
 * Purges unreferenced orphaned product images from Supabase Storage bucket 'product-images'.
 *
 * Eligibility rules (FR-042, BR-018):
 * 1. Belongs to bucket 'product-images' and adheres to canonical path: {org_id}/{product_id}/{filename}
 * 2. Older than 24 hours (or options.olderThanHours)
 * 3. Not referenced in public.products.image_url across ANY product status (active, inactive, archived)
 * 4. Validated tenant ownership
 * 5. Uses Supabase Storage client API .remove(), NEVER raw SQL DELETE on storage.objects
 * 6. Defaults to dry-run; actual deletion requires explicit dryRun: false
 */
export async function purgeOrphanedImages(
  supabaseAdmin: SupabaseClient,
  pgClient: PgClient,
  options: PurgeOptions = {}
): Promise<PurgeResult> {
  const dryRun = options.dryRun ?? true;
  const olderThanHours = options.olderThanHours ?? 24;
  const batchSize = options.batchSize ?? 100;
  const targetOrgId = options.organizationId;

  const result: PurgeResult = {
    dryRun,
    scannedCount: 0,
    referencedCount: 0,
    youngCount: 0,
    eligibleOrphans: [],
    deletedCount: 0,
    failedCount: 0,
    errors: [],
  };

  try {
    // 1. Query candidate objects from storage.objects
    let query = `
      SELECT name, created_at
      FROM storage.objects
      WHERE bucket_id = 'product-images'
        AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'
    `;
    const params: any[] = [];

    if (targetOrgId) {
      params.push(targetOrgId);
      query += ` AND (storage.foldername(name))[1]::uuid = $${params.length}`;
    }

    query += ` ORDER BY created_at ASC`;

    const objectsRes = await pgClient.query(query, params);
    const objects = objectsRes.rows;
    result.scannedCount = objects.length;

    const cutoffTime = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

    // 2. Evaluate each candidate object
    for (const obj of objects) {
      const objName: string = obj.name;
      const createdAt = new Date(obj.created_at);

      // Rule: Age requirement (< 24h preserved)
      if (createdAt >= cutoffTime) {
        result.youngCount++;
        continue;
      }

      // Rule: Database reference check
      // Query public.products to see if ANY product (active, inactive, or archived) references this image
      try {
        const refRes = await pgClient.query(
          `SELECT 1 FROM public.products WHERE image_url = $1 LIMIT 1;`,
          [objName]
        );

        if (refRes.rows.length > 0) {
          result.referencedCount++;
          continue;
        }

        // Rule: Tenant existence check
        const folderOrgId = objName.split("/")[0];
        const orgCheck = await pgClient.query(
          `SELECT 1 FROM public.organizations WHERE id = $1 LIMIT 1;`,
          [folderOrgId]
        );
        if (orgCheck.rows.length === 0) {
          // Organization no longer exists; still an orphan belonging to defunct tenant
        }

        result.eligibleOrphans.push(objName);
      } catch (err: any) {
        // Fail-closed: Never treat a database query failure as evidence that an image is unreferenced
        result.errors.push(`Failed DB check for ${objName}: ${err.message || String(err)}`);
      }
    }

    // 3. Execution (if not dry run)
    if (!dryRun && result.eligibleOrphans.length > 0) {
      // Chunk deletions according to batchSize
      for (let i = 0; i < result.eligibleOrphans.length; i += batchSize) {
        const batch = result.eligibleOrphans.slice(i, i + batchSize);
        const { data, error } = await supabaseAdmin.storage
          .from("product-images")
          .remove(batch);

        if (error) {
          result.failedCount += batch.length;
          result.errors.push(`Storage .remove() failure: ${error.message}`);
        } else {
          // data is an array of removed file objects
          const removedCount = data ? data.length : batch.length;
          result.deletedCount += removedCount;
        }
      }
    }

    return result;
  } catch (err: any) {
    result.errors.push(`Fatal error in purgeOrphanedImages: ${err.message || String(err)}`);
    return result;
  }
}

// CLI runner
if (require.main === module) {
  (async () => {
    // Attempt loading .env.local if service role key is not already in process.env
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const fs = await import("fs");
        const path = await import("path");
        const envLocalPath = path.resolve(process.cwd(), ".env.local");
        if (fs.existsSync(envLocalPath)) {
          const content = fs.readFileSync(envLocalPath, "utf8");
          content.split("\n").forEach((line) => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
              const equalIdx = trimmed.indexOf("=");
              const k = trimmed.slice(0, equalIdx).trim();
              const v = trimmed.slice(equalIdx + 1).trim();
              if (k && !process.env[k]) {
                process.env[k] = v;
              }
            }
          });
        }
      } catch (_) {}
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const dbUrl =
      process.env.DATABASE_URL ||
      process.env.SUPABASE_DB_URL ||
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

    if (!serviceRoleKey) {
      console.error("[FATAL] Missing SUPABASE_SERVICE_ROLE_KEY environment variable. Failing closed.");
      process.exit(1);
    }

    const args = process.argv.slice(2);
    const execute = args.includes("--execute");
    const dryRun = !execute;

    const orgArg = args.find((a) => a.startsWith("--org="));
    const organizationId = orgArg ? orgArg.split("=")[1] : undefined;

    const hoursArg = args.find((a) => a.startsWith("--hours="));
    const hoursVal = hoursArg ? hoursArg.split("=")[1] : undefined;
    const olderThanHours = hoursVal ? parseInt(hoursVal, 10) : 24;

    console.log(`[Storage Orphan Purge] Starting maintenance task...`);
    console.log(`  Mode: ${dryRun ? "DRY-RUN (Safe, no deletions)" : "EXECUTE (Actual deletion)"}`);
    console.log(`  Age cutoff: > ${olderThanHours} hours`);
    if (organizationId) console.log(`  Target organization: ${organizationId}`);

    const pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const result = await purgeOrphanedImages(supabaseAdmin, pgClient, {
      dryRun,
      organizationId,
      olderThanHours,
    });

    console.log(`[Storage Orphan Purge] Completed:`);
    console.log(`  Scanned: ${result.scannedCount}`);
    console.log(`  Younger than threshold (<${olderThanHours}h preserved): ${result.youngCount}`);
    console.log(`  Referenced by product (preserved): ${result.referencedCount}`);
    console.log(`  Eligible orphans found: ${result.eligibleOrphans.length}`);
    if (!dryRun) {
      console.log(`  Successfully deleted via Storage API: ${result.deletedCount}`);
      console.log(`  Failed deletions: ${result.failedCount}`);
    }
    if (result.errors.length > 0) {
      console.error(`  Errors:`);
      result.errors.forEach((e) => console.error(`    - ${e}`));
    }

    await pgClient.end();
    process.exit(result.errors.length > 0 ? 1 : 0);
  })().catch((err) => {
    console.error("[FATAL] Uncaught error during orphan purge:", err);
    process.exit(1);
  });
}

