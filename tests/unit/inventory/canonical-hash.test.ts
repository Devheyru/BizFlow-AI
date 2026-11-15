import { describe, it, expect } from "vitest";
import {
  formatCanonicalQuantity,
  buildCanonicalPayloadString,
  computeCanonicalPayloadHash,
  type CanonicalPayloadInput,
} from "@/lib/inventory/canonical-hash";

describe("T037: Canonical Hash Regression Tests (100% PostgreSQL Bit-for-Bit Compatibility)", () => {
  // ==========================================================================
  // 1. Immutable Regression Fixtures
  // ==========================================================================
  describe("Immutable Regression Fixtures", () => {
    it("Fixture 1 — Stocktake target count matches approved SHA-256 digest", () => {
      const input: CanonicalPayloadInput = {
        organizationId: "a0000000-0000-0000-0000-000000000001",
        productId: "b0000000-0000-0000-0000-000000000002",
        movementType: "adjustment",
        quantity: 45,
        quantitySemantics: "target_physical_count",
        reason: "Quarterly stocktake",
        referenceId: null,
      };

      const expectedPayload =
        '{"canonical_quantity":"45.0000","movement_type":"adjustment","organization_id":"a0000000-0000-0000-0000-000000000001","product_id":"b0000000-0000-0000-0000-000000000002","quantity_semantics":"target_physical_count","reason":"Quarterly stocktake","reference_id":null}';
      const expectedHash =
        "822dbc7818bb44882daff5f29396366a9d5f9eb571938eb36fd60270a5f108a6";

      expect(buildCanonicalPayloadString(input)).toBe(expectedPayload);
      expect(computeCanonicalPayloadHash(input)).toBe(expectedHash);
    });

    it("Fixture 2 — Adjustment delta matches approved SHA-256 digest", () => {
      const input: CanonicalPayloadInput = {
        organizationId: "a0000000-0000-0000-0000-000000000001",
        productId: "b0000000-0000-0000-0000-000000000002",
        movementType: "adjustment",
        quantity: 45,
        quantitySemantics: "quantity_delta",
        reason: "Quarterly stocktake",
        referenceId: null,
      };

      const expectedPayload =
        '{"canonical_quantity":"45.0000","movement_type":"adjustment","organization_id":"a0000000-0000-0000-0000-000000000001","product_id":"b0000000-0000-0000-0000-000000000002","quantity_semantics":"quantity_delta","reason":"Quarterly stocktake","reference_id":null}';
      const expectedHash =
        "7e2b11299620db0e9531afe7b999c1d1096b39b7f860d67be5efc531eed9f707";

      expect(buildCanonicalPayloadString(input)).toBe(expectedPayload);
      expect(computeCanonicalPayloadHash(input)).toBe(expectedHash);
    });

    it("Fixture 3 — Quotes and backslashes matches approved SHA-256 digest", () => {
      const input: CanonicalPayloadInput = {
        organizationId: "a0000000-0000-0000-0000-000000000001",
        productId: "b0000000-0000-0000-0000-000000000002",
        movementType: "damage",
        quantity: 12.5,
        quantitySemantics: "quantity_delta",
        reason: 'Broken "glass" & \\backslashes\\',
        referenceId: 'REF "A-12\\34"',
      };

      const expectedPayload =
        '{"canonical_quantity":"12.5000","movement_type":"damage","organization_id":"a0000000-0000-0000-0000-000000000001","product_id":"b0000000-0000-0000-0000-000000000002","quantity_semantics":"quantity_delta","reason":"Broken \\"glass\\" & \\\\backslashes\\\\","reference_id":"REF \\"A-12\\\\34\\""}';
      const expectedHash =
        "596a760972b11657cebb84a84a5b4541252b3f5c1d1d781a00c4686aeb7c0a3f";

      expect(buildCanonicalPayloadString(input)).toBe(expectedPayload);
      expect(computeCanonicalPayloadHash(input)).toBe(expectedHash);
    });
  });

  // ==========================================================================
  // 2. Strict Lexicographical Key Ordering
  // ==========================================================================
  describe("Strict Lexicographical Key Ordering & Structural Stability", () => {
    it("enforces key ordering: canonical_quantity, movement_type, organization_id, product_id, quantity_semantics, reason, reference_id", () => {
      const input: CanonicalPayloadInput = {
        reason: "Routine replenishment",
        quantitySemantics: "quantity_delta",
        productId: "11111111-1111-4111-8111-111111111111",
        quantity: 100,
        organizationId: "22222222-2222-4222-8222-222222222222",
        movementType: "restock",
        referenceId: "PO-100",
      };

      const payload = buildCanonicalPayloadString(input);
      const parsed = JSON.parse(payload);
      const keys = Object.keys(parsed);

      const expectedOrder = [
        "canonical_quantity",
        "movement_type",
        "organization_id",
        "product_id",
        "quantity_semantics",
        "reason",
        "reference_id",
      ];

      expect(keys).toEqual(expectedOrder);
    });

    it("generates identical canonical string regardless of TypeScript object property insertion order", () => {
      const orderA: CanonicalPayloadInput = {
        organizationId: "org-1",
        productId: "prod-1",
        movementType: "restock",
        quantity: 10,
        quantitySemantics: "quantity_delta",
        reason: "Test order A",
        referenceId: "REF-1",
      };

      const orderB: CanonicalPayloadInput = {
        referenceId: "REF-1",
        reason: "Test order A",
        quantitySemantics: "quantity_delta",
        quantity: 10,
        movementType: "restock",
        productId: "prod-1",
        organizationId: "org-1",
      };

      expect(buildCanonicalPayloadString(orderA)).toBe(buildCanonicalPayloadString(orderB));
      expect(computeCanonicalPayloadHash(orderA)).toBe(computeCanonicalPayloadHash(orderB));
    });
  });

  // ==========================================================================
  // 3. Four-Decimal Quantity Normalization
  // ==========================================================================
  describe("Four-Decimal Quantity Normalization", () => {
    it("formats integers with exactly 4 decimal places", () => {
      expect(formatCanonicalQuantity(0)).toBe("0.0000");
      expect(formatCanonicalQuantity(1)).toBe("1.0000");
      expect(formatCanonicalQuantity(5000)).toBe("5000.0000");
      expect(formatCanonicalQuantity(-42)).toBe("-42.0000");
    });

    it("normalizes negative zero (-0) to positive zero ('0.0000')", () => {
      expect(formatCanonicalQuantity(-0)).toBe("0.0000");
    });

    it("formats fractional numbers up to 4 decimal places without exponential notation", () => {
      expect(formatCanonicalQuantity(0.0001)).toBe("0.0001");
      expect(formatCanonicalQuantity(12.3)).toBe("12.3000");
      expect(formatCanonicalQuantity(12.3456)).toBe("12.3456");
      expect(formatCanonicalQuantity(-0.0001)).toBe("-0.0001");
      expect(formatCanonicalQuantity(-15.25)).toBe("-15.2500");
    });

    it("handles string numeric inputs gracefully", () => {
      expect(formatCanonicalQuantity("100")).toBe("100.0000");
      expect(formatCanonicalQuantity("55.5")).toBe("55.5000");
      expect(formatCanonicalQuantity("-12.3456")).toBe("-12.3456");
    });

    it("throws on invalid, non-finite, or NaN inputs", () => {
      expect(() => formatCanonicalQuantity(NaN)).toThrow();
      expect(() => formatCanonicalQuantity(Infinity)).toThrow();
      expect(() => formatCanonicalQuantity("not-a-number")).toThrow();
    });
  });

  // ==========================================================================
  // 4. Whitespace Trimming & Null Reference Handling
  // ==========================================================================
  describe("Reason Trimming & Null/Empty Reference Handling", () => {
    it("trims surrounding whitespace from reason", () => {
      const inputUntrimmed: CanonicalPayloadInput = {
        organizationId: "org-1",
        productId: "prod-1",
        movementType: "restock",
        quantity: 10,
        quantitySemantics: "quantity_delta",
        reason: "   Padded delivery reason   ",
        referenceId: null,
      };

      const inputTrimmed: CanonicalPayloadInput = {
        organizationId: "org-1",
        productId: "prod-1",
        movementType: "restock",
        quantity: 10,
        quantitySemantics: "quantity_delta",
        reason: "Padded delivery reason",
        referenceId: null,
      };

      expect(buildCanonicalPayloadString(inputUntrimmed)).toBe(
        buildCanonicalPayloadString(inputTrimmed)
      );
      expect(computeCanonicalPayloadHash(inputUntrimmed)).toBe(
        computeCanonicalPayloadHash(inputTrimmed)
      );
    });

    it("normalizes empty string referenceId or whitespace-only to null", () => {
      const withNull: CanonicalPayloadInput = {
        organizationId: "org-1",
        productId: "prod-1",
        movementType: "restock",
        quantity: 10,
        quantitySemantics: "quantity_delta",
        reason: "Test",
        referenceId: null,
      };

      const withEmpty: CanonicalPayloadInput = {
        ...withNull,
        referenceId: "",
      };

      const withWhitespace: CanonicalPayloadInput = {
        ...withNull,
        referenceId: "   ",
      };

      const withUndefined: CanonicalPayloadInput = {
        ...withNull,
        referenceId: undefined,
      };

      const hashNull = computeCanonicalPayloadHash(withNull);
      expect(computeCanonicalPayloadHash(withEmpty)).toBe(hashNull);
      expect(computeCanonicalPayloadHash(withWhitespace)).toBe(hashNull);
      expect(computeCanonicalPayloadHash(withUndefined)).toBe(hashNull);
    });
  });

  // ==========================================================================
  // 5. Determinism & Collision Resistance
  // ==========================================================================
  describe("Determinism and Collision Resistance", () => {
    const baseInput: CanonicalPayloadInput = {
      organizationId: "a0000000-0000-0000-0000-000000000001",
      productId: "b0000000-0000-0000-0000-000000000002",
      movementType: "restock",
      quantity: 50,
      quantitySemantics: "quantity_delta",
      reason: "Delivery batch #1",
      referenceId: "PO-100",
    };

    it("produces identical 64-character lowercase hex hash on repeated computation", () => {
      const hash1 = computeCanonicalPayloadHash(baseInput);
      const hash2 = computeCanonicalPayloadHash(baseInput);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });

    it("produces different hash when quantity changes", () => {
      const modified = { ...baseInput, quantity: 50.0001 };
      expect(computeCanonicalPayloadHash(modified)).not.toBe(
        computeCanonicalPayloadHash(baseInput)
      );
    });

    it("produces different hash when movementType changes", () => {
      const modified = { ...baseInput, movementType: "initial" };
      expect(computeCanonicalPayloadHash(modified)).not.toBe(
        computeCanonicalPayloadHash(baseInput)
      );
    });

    it("produces different hash when quantitySemantics changes", () => {
      const modified = {
        ...baseInput,
        movementType: "adjustment",
        quantitySemantics: "target_physical_count",
      };
      const originalAdj = {
        ...baseInput,
        movementType: "adjustment",
        quantitySemantics: "quantity_delta",
      };
      expect(computeCanonicalPayloadHash(modified)).not.toBe(
        computeCanonicalPayloadHash(originalAdj)
      );
    });

    it("produces different hash when productId changes", () => {
      const modified = {
        ...baseInput,
        productId: "c0000000-0000-0000-0000-000000000003",
      };
      expect(computeCanonicalPayloadHash(modified)).not.toBe(
        computeCanonicalPayloadHash(baseInput)
      );
    });

    it("produces different hash when organizationId changes", () => {
      const modified = {
        ...baseInput,
        organizationId: "d0000000-0000-0000-0000-000000000004",
      };
      expect(computeCanonicalPayloadHash(modified)).not.toBe(
        computeCanonicalPayloadHash(baseInput)
      );
    });
  });
});
