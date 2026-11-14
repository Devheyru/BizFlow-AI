/**
 * Session storage draft persistence helper for inventory adjustment modals.
 * Allows safe state restoration across modal toggles without risking stale data across different products or tenants.
 */

export interface AdjustmentDraft {
  productId: string;
  movementType: "adjustment" | "damage" | "loss" | "internal_use";
  quantity: string;
  adjustmentDirection?: "increase" | "decrease";
  reason: string;
  referenceId?: string;
  timestamp: number;
}

const STORAGE_PREFIX = "bizflow_adjust_draft_";
const MAX_DRAFT_AGE_MS = 30 * 60 * 1000; // 30 minutes

export function saveAdjustmentDraft(slug: string, productId: string, draft: Omit<AdjustmentDraft, "timestamp">): void {
  if (typeof window === "undefined") return;
  try {
    const key = `${STORAGE_PREFIX}${slug}_${productId}`;
    const payload: AdjustmentDraft = {
      ...draft,
      timestamp: Date.now(),
    };
    sessionStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Storage quota or security restriction: ignore gracefully
  }
}

export function loadAdjustmentDraft(slug: string, productId: string): AdjustmentDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const key = `${STORAGE_PREFIX}${slug}_${productId}`;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdjustmentDraft;
    if (parsed.productId !== productId) return null;
    if (Date.now() - parsed.timestamp > MAX_DRAFT_AGE_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearAdjustmentDraft(slug: string, productId: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = `${STORAGE_PREFIX}${slug}_${productId}`;
    sessionStorage.removeItem(key);
  } catch {
    // Ignore gracefully
  }
}
