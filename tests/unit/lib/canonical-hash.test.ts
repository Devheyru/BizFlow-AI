import { describe, it, expect } from "vitest";
import {
  formatCanonicalQuantity,
  buildCanonicalPayloadString,
  computeCanonicalPayloadHash,
} from "@/lib/inventory/canonical-hash";

describe("T015: Canonical Inventory Payload Hashing", () => {
  const orgId = "11111111-1111-4111-8111-111111111111";
  const prodId = "22222222-2222-4222-8222-222222222222";

  describe("Regression Fixtures (PostgreSQL 100% Bit-for-Bit Compatibility)", () => {
    it("Fixture 1: Matches approved SHA-256 for stocktake target count", () => {
      const input = {
        organizationId: "a0000000-0000-0000-0000-000000000001",
        productId: "b0000000-0000-0000-0000-000000000002",
        movementType: "adjustment",
        quantity: 45,
        quantitySemantics: "target_physical_count",
        reason: "Quarterly stocktake",
        referenceId: null,
      };

      const payloadString = buildCanonicalPayloadString(input);
      const expectedString =
        '{"canonical_quantity":"45.0000","movement_type":"adjustment","organization_id":"a0000000-0000-0000-0000-000000000001","product_id":"b0000000-0000-0000-0000-000000000002","quantity_semantics":"target_physical_count","reason":"Quarterly stocktake","reference_id":null}';

      expect(payloadString).toBe(expectedString);

      const hash = computeCanonicalPayloadHash(input);
      const expectedHash = "822dbc7818bb44882daff5f29396366a9d5f9eb571938eb36fd60270a5f108a6";
      expect(hash).toBe(expectedHash);
    });

    it("Fixture 2: Matches approved SHA-256 for adjustment ordinary delta with null referenceId", () => {
      const input = {
        organizationId: "a0000000-0000-0000-0000-000000000001",
        productId: "b0000000-0000-0000-0000-000000000002",
        movementType: "adjustment",
        quantity: 45,
        quantitySemantics: "quantity_delta",
        reason: "Quarterly stocktake",
        referenceId: null,
      };

      const payloadString = buildCanonicalPayloadString(input);
      const expectedString =
        '{"canonical_quantity":"45.0000","movement_type":"adjustment","organization_id":"a0000000-0000-0000-0000-000000000001","product_id":"b0000000-0000-0000-0000-000000000002","quantity_semantics":"quantity_delta","reason":"Quarterly stocktake","reference_id":null}';

      expect(payloadString).toBe(expectedString);

      const hash = computeCanonicalPayloadHash(input);
      const expectedHash = "7e2b11299620db0e9531afe7b999c1d1096b39b7f860d67be5efc531eed9f707";
      expect(hash).toBe(expectedHash);
    });

    it("Fixture 3: Matches approved SHA-256 for string escaping with quotes & backslashes", () => {
      const input = {
        organizationId: "a0000000-0000-0000-0000-000000000001",
        productId: "b0000000-0000-0000-0000-000000000002",
        movementType: "damage",
        quantity: 12.5,
        quantitySemantics: "quantity_delta",
        reason: 'Broken "glass" & \\backslashes\\',
        referenceId: 'REF "A-12\\34"',
      };

      const payloadString = buildCanonicalPayloadString(input);
      const expectedString =
        '{"canonical_quantity":"12.5000","movement_type":"damage","organization_id":"a0000000-0000-0000-0000-000000000001","product_id":"b0000000-0000-0000-0000-000000000002","quantity_semantics":"quantity_delta","reason":"Broken \\"glass\\" & \\\\backslashes\\\\","reference_id":"REF \\"A-12\\\\34\\""}';

      expect(payloadString).toBe(expectedString);

      const hash = computeCanonicalPayloadHash(input);
      const expectedHash = "596a760972b11657cebb84a84a5b4541252b3f5c1d1d781a00c4686aeb7c0a3f";
      expect(hash).toBe(expectedHash);
    });
  });

  describe("Numeric Formatting & Precision", () => {
    it("formats whole integers with 4 trailing zeros", () => {
      expect(formatCanonicalQuantity(0)).toBe("0.0000");
      expect(formatCanonicalQuantity(100)).toBe("100.0000");
      expect(formatCanonicalQuantity(-42)).toBe("-42.0000");
    });

    it("normalizes negative zero to positive zero string", () => {
      expect(formatCanonicalQuantity(-0)).toBe("0.0000");
    });

    it("formats fractional numbers up to 4 decimal places", () => {
      expect(formatCanonicalQuantity(12.3)).toBe("12.3000");
      expect(formatCanonicalQuantity(12.3456)).toBe("12.3456");
      expect(formatCanonicalQuantity(-0.0001)).toBe("-0.0001");
    });

    it("handles string quantity inputs properly", () => {
      expect(formatCanonicalQuantity("55.5")).toBe("55.5000");
      expect(formatCanonicalQuantity("-15.25")).toBe("-15.2500");
    });

    it("throws on NaN or Infinite values", () => {
      expect(() => formatCanonicalQuantity(NaN)).toThrow();
      expect(() => formatCanonicalQuantity(Infinity)).toThrow();
      expect(() => formatCanonicalQuantity("invalid")).toThrow();
    });
  });

  describe("Trimming & Null Handling", () => {
    it("trims whitespace from reason and referenceId", () => {
      const input = {
        organizationId: orgId,
        productId: prodId,
        movementType: "restock",
        quantity: 10,
        quantitySemantics: "quantity_delta",
        reason: "  Supplier delivery  ",
        referenceId: "  REF-99  ",
      };

      const payloadString = buildCanonicalPayloadString(input);
      expect(payloadString).toContain('"reason":"Supplier delivery"');
      expect(payloadString).toContain('"reference_id":"REF-99"');
    });

    it("converts empty string referenceId to literal null", () => {
      const input = {
        organizationId: orgId,
        productId: prodId,
        movementType: "restock",
        quantity: 10,
        quantitySemantics: "quantity_delta",
        reason: "Restock",
        referenceId: "   ",
      };

      const payloadString = buildCanonicalPayloadString(input);
      expect(payloadString).toContain('"reference_id":null');
    });
  });

  describe("Deterministic Output", () => {
    it("produces identical hashes across repeated calls with identical inputs", () => {
      const input = {
        organizationId: orgId,
        productId: prodId,
        movementType: "restock",
        quantity: 15.5,
        quantitySemantics: "quantity_delta",
        reason: "Consistent delivery",
        referenceId: "PO-777",
      };

      const hash1 = computeCanonicalPayloadHash(input);
      const hash2 = computeCanonicalPayloadHash(input);
      expect(hash1).toBe(hash2);
    });

    it("produces different hashes for even subtle differences", () => {
      const base = {
        organizationId: orgId,
        productId: prodId,
        movementType: "restock",
        quantity: 10,
        quantitySemantics: "quantity_delta",
        reason: "Delivery",
      };

      const diffQty = { ...base, quantity: 10.0001 };
      const diffReason = { ...base, reason: "Delivery." };
      const diffType = { ...base, movementType: "initial" };

      const baseHash = computeCanonicalPayloadHash(base);
      expect(computeCanonicalPayloadHash(diffQty)).not.toBe(baseHash);
      expect(computeCanonicalPayloadHash(diffReason)).not.toBe(baseHash);
      expect(computeCanonicalPayloadHash(diffType)).not.toBe(baseHash);
    });
  });
});
