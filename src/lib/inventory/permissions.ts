import type { TenantContext } from "@/types/auth";
import { hasPermission } from "@/lib/auth/permissions";

export const INVENTORY_PERMISSIONS = [
  "inventory:read",
  "inventory:receive",
  "inventory:adjust",
  "inventory:history",
  "inventory:read_valuation",
] as const;

export type InventoryPermission = (typeof INVENTORY_PERMISSIONS)[number];

/**
 * Evaluates whether the caller holds the given inventory permission.
 * Validates active membership, active organization, dynamic Owner rights,
 * and tenant permissions array.
 */
export function hasInventoryPermission(
  context: TenantContext | null | undefined,
  permission: string
): boolean {
  if (!context) {
    return false;
  }

  // Active membership and organization invariance
  if (context.membership?.status !== "active" || !context.organization?.is_active) {
    return false;
  }

  // Owner automatic access across all catalog permissions
  if (context.role === "owner") {
    return true;
  }

  // Dynamic permission evaluation from database context
  if (Array.isArray(context.permissions)) {
    return (context.permissions as string[]).includes(permission);
  }

  return false;
}

/**
 * Dual-Authorization Guard for Confidential Valuation Data (T017, Principle II & IV).
 *
 * Exposing unit cost, total valuation, or movement cost records strictly requires
 * that the calling user possesses BOTH:
 * 1. `inventory:read_valuation`
 * 2. `products:read_cost`
 *
 * Holding either permission alone MUST NOT grant access to valuation metrics.
 */
export function canViewValuation(
  context: TenantContext | null | undefined
): boolean {
  if (!context) {
    return false;
  }

  const hasValuation = hasInventoryPermission(context, "inventory:read_valuation");
  const hasCost =
    hasPermission(context, "products:read_cost") ||
    hasInventoryPermission(context, "products:read_cost");

  return hasValuation && hasCost;
}

