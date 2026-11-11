import { createHash } from "crypto";

export interface CanonicalPayloadInput {
  organizationId: string;
  productId: string;
  movementType: string;
  quantity: number | string;
  quantitySemantics: string;
  reason: string;
  referenceId?: string | null;
}

/**
 * Formats a numeric quantity into the canonical NUMERIC(14,4) string
 * matching PostgreSQL `to_char(p_quantity, 'FM9999999990.0000')`.
 * - Handles negative quantities cleanly (e.g. -5 -> "-5.0000")
 * - Avoids negative zero ("-0.0000" -> "0.0000")
 * - Strictly fixes 4 decimal places
 */
export function formatCanonicalQuantity(quantity: number | string): string {
  const num = typeof quantity === "string" ? parseFloat(quantity) : quantity;
  if (isNaN(num) || !isFinite(num)) {
    throw new Error(`Invalid numeric quantity for canonical payload: ${quantity}`);
  }
  // Eliminate -0
  if (Object.is(num, -0) || num === 0) {
    return "0.0000";
  }
  return num.toFixed(4);
}

/**
 * Builds the canonical JSON payload string matching PostgreSQL's exact
 * lexicographical serialization:
 * `{"canonical_quantity":"...","movement_type":"...","organization_id":"...","product_id":"...","quantity_semantics":"...","reason":...,"reference_id":...}`
 */
export function buildCanonicalPayloadString(input: CanonicalPayloadInput): string {
  const canonicalQuantity = formatCanonicalQuantity(input.quantity);
  const trimmedReason = input.reason.trim();
  const trimmedRefId = input.referenceId ? input.referenceId.trim() : null;

  const reasonJson = JSON.stringify(trimmedReason);
  const refIdJson = trimmedRefId && trimmedRefId !== "" ? JSON.stringify(trimmedRefId) : "null";

  return `{"canonical_quantity":"${canonicalQuantity}","movement_type":"${input.movementType}","organization_id":"${input.organizationId}","product_id":"${input.productId}","quantity_semantics":"${input.quantitySemantics}","reason":${reasonJson},"reference_id":${refIdJson}}`;
}

/**
 * Computes the deterministic SHA-256 hexadecimal hash of the canonical JSON payload.
 * Matches PostgreSQL `encode(sha256(convert_to(payload, 'UTF8')), 'hex')` byte-for-byte.
 */
export function computeCanonicalPayloadHash(input: CanonicalPayloadInput): string {
  const payloadString = buildCanonicalPayloadString(input);
  return createHash("sha256").update(payloadString, "utf8").digest("hex");
}

