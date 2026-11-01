import { describe, it, expect } from "vitest";
import {
  switchOrganizationSchema,
  type SwitchOrganizationInput,
} from "@/lib/validations/organization";

describe("T041: switchOrganizationSchema Unit Tests", () => {
  const validUuid = "a0000000-0000-0000-0000-000000000001";
  const validSlug = "acme-retail-ny";

  it("accepts a valid organizationId (UUID)", () => {
    const input: SwitchOrganizationInput = {
      organizationId: validUuid,
    };
    const result = switchOrganizationSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.organizationId).toBe(validUuid);
    }
  });

  it("accepts a valid slug", () => {
    const input: SwitchOrganizationInput = {
      slug: validSlug,
    };
    const result = switchOrganizationSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slug).toBe(validSlug);
    }
  });

  it("accepts both organizationId and slug simultaneously", () => {
    const input: SwitchOrganizationInput = {
      organizationId: validUuid,
      slug: validSlug,
    };
    const result = switchOrganizationSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.organizationId).toBe(validUuid);
      expect(result.data.slug).toBe(validSlug);
    }
  });

  it("trims whitespace from slug", () => {
    const input = {
      slug: "   acme-retail-ny   ",
    };
    const result = switchOrganizationSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slug).toBe("acme-retail-ny");
    }
  });

  it("rejects an empty object with neither organizationId nor slug", () => {
    const result = switchOrganizationSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.errors.map((e) => e.message);
      expect(messages).toContain("Either organizationId or slug must be provided");
    }
  });

  it("rejects an invalid UUID for organizationId", () => {
    const result = switchOrganizationSchema.safeParse({
      organizationId: "not-a-valid-uuid",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.errors.map((e) => e.message);
      expect(messages).toContain("Invalid organization identifier");
    }
  });

  it("rejects a slug that is too short (< 2 characters)", () => {
    const result = switchOrganizationSchema.safeParse({
      slug: "a",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.errors.map((e) => e.message);
      expect(messages).toContain("Slug must be at least 2 characters");
    }
  });

  it("rejects a slug that is too long (> 100 characters)", () => {
    const result = switchOrganizationSchema.safeParse({
      slug: "a".repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it("rejects null or undefined inputs", () => {
    expect(switchOrganizationSchema.safeParse(null).success).toBe(false);
    expect(switchOrganizationSchema.safeParse(undefined).success).toBe(false);
  });
});

