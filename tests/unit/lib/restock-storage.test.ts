import { describe, it, expect, beforeEach } from "vitest";
import {
  savePendingRestock,
  loadPendingRestock,
  clearPendingRestock,
  getPendingRestockKey,
  type PendingRestockSession,
} from "@/lib/inventory/restock-storage";

describe("Restock Storage Utility (Verification C, FINDING-P5-002)", () => {
  const slug = "test-store";
  const productId = "00000000-0000-0000-0000-000000000001";

  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("generates predictable storage key", () => {
    expect(getPendingRestockKey(slug, productId)).toBe(`bizflow_restock_pending_${slug}_${productId}`);
    expect(getPendingRestockKey(slug, productId, "restock")).toBe(`bizflow_restock_pending_${slug}_${productId}`);
    expect(getPendingRestockKey(slug, productId, "initial")).toBe(`bizflow_restock_pending_${slug}_${productId}_initial`);
  });

  it("partitions pending sessions between restock and initial modes", () => {
    const restockSession: PendingRestockSession = {
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      slug,
      productId,
      quantity: 50,
      reason: "Supplier delivery",
      referenceId: "PO-100",
      expectedVersion: 1,
      createdAt: Date.now(),
      mode: "restock",
    };

    const initialSession: PendingRestockSession = {
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      slug,
      productId,
      quantity: 100,
      reason: "Opening inventory baseline",
      referenceId: "AUDIT-001",
      expectedVersion: 1,
      createdAt: Date.now(),
      mode: "initial",
    };

    savePendingRestock(restockSession);
    savePendingRestock(initialSession);

    expect(loadPendingRestock(slug, productId, "restock")).toEqual(restockSession);
    expect(loadPendingRestock(slug, productId, "initial")).toEqual(initialSession);

    clearPendingRestock(slug, productId, "initial");
    expect(loadPendingRestock(slug, productId, "initial")).toBeNull();
    expect(loadPendingRestock(slug, productId, "restock")).toEqual(restockSession);
  });

  it("saves and loads pending restock session", () => {
    const session: PendingRestockSession = {
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      slug,
      productId,
      quantity: 50,
      reason: "Supplier delivery",
      referenceId: "PO-100",
      expectedVersion: 1,
      createdAt: Date.now(),
    };

    savePendingRestock(session);
    const loaded = loadPendingRestock(slug, productId);

    expect(loaded).toEqual(session);
  });

  it("clears pending restock session", () => {
    const session: PendingRestockSession = {
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      slug,
      productId,
      quantity: 10,
      reason: "Initial batch",
      referenceId: null,
      expectedVersion: 2,
      createdAt: Date.now(),
    };

    savePendingRestock(session);
    expect(loadPendingRestock(slug, productId)).not.toBeNull();

    clearPendingRestock(slug, productId);
    expect(loadPendingRestock(slug, productId)).toBeNull();
  });

  it("discards expired pending sessions older than 30 minutes", () => {
    const expiredTimestamp = Date.now() - 31 * 60 * 1000;
    const session: PendingRestockSession = {
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
      slug,
      productId,
      quantity: 15,
      reason: "Stale restock",
      referenceId: null,
      expectedVersion: 1,
      createdAt: expiredTimestamp,
    };

    savePendingRestock(session);
    const loaded = loadPendingRestock(slug, productId);
    expect(loaded).toBeNull();
  });
});

