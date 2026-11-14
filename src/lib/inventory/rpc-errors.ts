/**
 * Pure utility functions for detecting and classifying PostgREST/PostgreSQL RPC errors.
 * Kept separate from Server Action modules to comply with Next.js 15 "use server" restrictions.
 */

/**
 * Detects whether an RPC failure is genuinely due to the function not being deployed
 * or missing from PostgREST schema cache (as opposed to permission/auth/timeout/db errors).
 */
export function isRpcUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: string; message?: string };
  // PGRST202: PostgREST schema cache function not found
  if (err.code === "PGRST202") return true;
  // 42883: PostgreSQL undefined_function
  if (err.code === "42883") return true;
  const msg = typeof err.message === "string" ? err.message.toLowerCase() : "";
  if (
    msg.includes("could not find the function") ||
    msg.includes("schema cache") ||
    (msg.includes("function") && msg.includes("does not exist"))
  ) {
    return true;
  }
  return false;
}
