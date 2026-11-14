import { describe, it, expect } from "vitest";
import { isRpcUnavailableError } from "@/lib/inventory/rpc-errors";

describe("isRpcUnavailableError", () => {
  it("returns true for PGRST202 (PostgREST schema cache function not found)", () => {
    expect(isRpcUnavailableError({ code: "PGRST202" })).toBe(true);
  });

  it("returns true for 42883 (PostgreSQL undefined_function)", () => {
    expect(isRpcUnavailableError({ code: "42883" })).toBe(true);
  });

  it("returns true when message indicates function not found in schema cache", () => {
    expect(
      isRpcUnavailableError({
        message: "Could not find the function public.get_products_with_movement_history in the schema cache",
      })
    ).toBe(true);
  });

  it("returns true when message indicates function does not exist", () => {
    expect(
      isRpcUnavailableError({
        message: "function get_products_with_movement_history does not exist",
      })
    ).toBe(true);
  });

  it("returns false for non-RPC errors (permissions, timeouts, inactive orgs)", () => {
    expect(isRpcUnavailableError({ code: "42501", message: "INSUFFICIENT_PERMISSIONS" })).toBe(false);
    expect(isRpcUnavailableError({ code: "P0001", message: "ORGANIZATION_INACTIVE" })).toBe(false);
    expect(isRpcUnavailableError({ code: "P0002", message: "MEMBERSHIP_INACTIVE" })).toBe(false);
    expect(isRpcUnavailableError({ code: "08001", message: "UNAUTHENTICATED" })).toBe(false);
    expect(isRpcUnavailableError({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false);
  });

  it("returns false for null, undefined, primitives, and empty objects", () => {
    expect(isRpcUnavailableError(null)).toBe(false);
    expect(isRpcUnavailableError(undefined)).toBe(false);
    expect(isRpcUnavailableError("some string")).toBe(false);
    expect(isRpcUnavailableError(12345)).toBe(false);
    expect(isRpcUnavailableError({})).toBe(false);
  });
});
