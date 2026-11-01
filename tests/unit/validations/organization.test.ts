import { describe, it, expect } from "vitest";
import {
  createOrganizationSchema,
  type CreateOrganizationInput,
} from "@/lib/validations/organization";

describe("T026: createOrganizationSchema Unit Tests", () => {
  const validPayload: CreateOrganizationInput = {
    name: "Acme Retail Store",
    businessType: "Convenience Store",
    country: "US",
    currency: "USD",
    timezone: "America/New_York",
  };

  it("validates a standard compliant organization creation payload", () => {
    const result = createOrganizationSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Acme Retail Store");
      expect(result.data.country).toBe("US");
      expect(result.data.currency).toBe("USD");
      expect(result.data.timezone).toBe("America/New_York");
    }
  });

  it("accepts optional fields (taxId, phone, email, address, clientMutationId)", () => {
    const fullPayload = {
      ...validPayload,
      taxId: "TAX-998877",
      phone: "+15551234567",
      email: "contact@acmeretail.com",
      address: "123 Market Street, Suite 400",
      clientMutationId: "a0000000-0000-0000-0000-000000000001",
    };

    const result = createOrganizationSchema.safeParse(fullPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.taxId).toBe("TAX-998877");
      expect(result.data.phone).toBe("+15551234567");
      expect(result.data.email).toBe("contact@acmeretail.com");
      expect(result.data.clientMutationId).toBe("a0000000-0000-0000-0000-000000000001");
    }
  });

  it("transforms lowercase country and currency codes to uppercase", () => {
    const payload = {
      ...validPayload,
      country: "us",
      currency: "usd",
    };

    const result = createOrganizationSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.country).toBe("US");
      expect(result.data.currency).toBe("USD");
    }
  });

  it("trims whitespace from string fields", () => {
    const payload = {
      ...validPayload,
      name: "   Supermarket Deluxe   ",
      businessType: "  Grocery  ",
      timezone: "  UTC  ",
    };

    const result = createOrganizationSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Supermarket Deluxe");
      expect(result.data.businessType).toBe("Grocery");
      expect(result.data.timezone).toBe("UTC");
    }
  });

  describe("Name validation", () => {
    it("rejects empty or whitespace-only name", () => {
      const result = createOrganizationSchema.safeParse({
        ...validPayload,
        name: "   ",
      });
      expect(result.success).toBe(false);
    });

    it("rejects names shorter than 2 characters", () => {
      const result = createOrganizationSchema.safeParse({
        ...validPayload,
        name: "A",
      });
      expect(result.success).toBe(false);
    });

    it("rejects names longer than 100 characters", () => {
      const result = createOrganizationSchema.safeParse({
        ...validPayload,
        name: "A".repeat(101),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Country code (ISO 3166-1 alpha-2) validation", () => {
    it("rejects 1-letter country codes", () => {
      const result = createOrganizationSchema.safeParse({
        ...validPayload,
        country: "U",
      });
      expect(result.success).toBe(false);
    });

    it("rejects 3-letter country codes", () => {
      const result = createOrganizationSchema.safeParse({
        ...validPayload,
        country: "USA",
      });
      expect(result.success).toBe(false);
    });

    it("rejects numeric or special character country codes", () => {
      const result1 = createOrganizationSchema.safeParse({
        ...validPayload,
        country: "12",
      });
      expect(result1.success).toBe(false);

      const result2 = createOrganizationSchema.safeParse({
        ...validPayload,
        country: "U$",
      });
      expect(result2.success).toBe(false);
    });
  });

  describe("Currency code (ISO 4217) validation", () => {
    it("rejects 2-letter currency codes", () => {
      const result = createOrganizationSchema.safeParse({
        ...validPayload,
        currency: "US",
      });
      expect(result.success).toBe(false);
    });

    it("rejects 4-letter currency codes", () => {
      const result = createOrganizationSchema.safeParse({
        ...validPayload,
        currency: "USDD",
      });
      expect(result.success).toBe(false);
    });

    it("rejects numeric or special character currency codes", () => {
      const result1 = createOrganizationSchema.safeParse({
        ...validPayload,
        currency: "123",
      });
      expect(result1.success).toBe(false);

      const result2 = createOrganizationSchema.safeParse({
        ...validPayload,
        currency: "US$",
      });
      expect(result2.success).toBe(false);
    });
  });

  describe("clientMutationId validation", () => {
    it("rejects non-UUID mutation identifiers", () => {
      const result = createOrganizationSchema.safeParse({
        ...validPayload,
        clientMutationId: "not-a-valid-uuid",
      });
      expect(result.success).toBe(false);
    });

    it("allows omitting clientMutationId or setting undefined", () => {
      const payload = { ...validPayload };
      delete (payload as { clientMutationId?: string }).clientMutationId;
      const result = createOrganizationSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });

  describe("Optional email validation", () => {
    it("allows empty string for email", () => {
      const result = createOrganizationSchema.safeParse({
        ...validPayload,
        email: "",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid email formats", () => {
      const result = createOrganizationSchema.safeParse({
        ...validPayload,
        email: "not-an-email",
      });
      expect(result.success).toBe(false);
    });
  });
});

