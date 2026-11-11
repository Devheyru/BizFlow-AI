/**
 * Restock Modal Idempotency Session Storage Utility (T023, US2, FINDING-P5-002, Verification C).
 *
 * Provides safe client-side recovery of in-flight stock mutations across modal close/reopen,
 * component unmount/remount, or page refresh when network responses are lost after PostgreSQL commits.
 */

export interface PendingRestockSession {
  idempotencyKey: string;
  slug: string;
  productId: string;
  quantity: number;
  reason: string;
  referenceId: string | null;
  expectedVersion: number;
  createdAt: number;
}

const STORAGE_PREFIX = "bizflow_restock_pending_";
const MAX_PENDING_AGE_MS = 30 * 60 * 1000; // 30 minutes validity window

export function getPendingRestockKey(slug: string, productId: string): string {
  return `${STORAGE_PREFIX}${slug}_${productId}`;
}

/**
 * Persists the in-flight restock payload and its stable idempotency key to sessionStorage.
 */
export function savePendingRestock(session: PendingRestockSession): void {
  if (typeof window === "undefined") return;
  try {
    const key = getPendingRestockKey(session.slug, session.productId);
    window.sessionStorage.setItem(key, JSON.stringify(session));
  } catch {
    // Graceful fallback if storage quota exceeded or disabled in private browsing
  }
}

/**
 * Loads any unconfirmed restock session for the given organization and product.
 * Automatically cleans up expired sessions (> 30 minutes).
 */
export function loadPendingRestock(slug: string, productId: string): PendingRestockSession | null {
  if (typeof window === "undefined") return null;
  try {
    const key = getPendingRestockKey(slug, productId);
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingRestockSession;
    if (!parsed || typeof parsed !== "object" || !parsed.idempotencyKey) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    // Discard expired sessions
    if (Date.now() - parsed.createdAt > MAX_PENDING_AGE_MS) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Clears the pending restock session upon confirmed transaction completion.
 */
export function clearPendingRestock(slug: string, productId: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = getPendingRestockKey(slug, productId);
    window.sessionStorage.removeItem(key);
  } catch {
    // Ignore storage deletion errors
  }
}

