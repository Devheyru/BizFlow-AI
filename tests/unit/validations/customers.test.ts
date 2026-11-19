import { describe, it, expect } from "vitest";
import {
  createCustomerSchema,
  updateCustomerSchema,
  customerSearchSchema,
  E164_PHONE_REGEX,
} from "@/lib/validations/customers";

describe("T035: Customer Validation Schemas", () => {
  it("exports E164_PHONE_REGEX that matches valid phone formats", () => {
    expect(E164_PHONE_REGEX.test("+15551234567")).toBe(true);
    expect(E164_PHONE_REGEX.test("invalid")).toBe(false);
  });

  describe("createCustomerSchema", () => {
    it("validates a customer with complete valid fields", () => {
      const input = {
        name: "Alice Johnson",
        phone: "+15551234567",
        email: "Alice.Johnson@example.com",
        notes: "Loyal wholesale customer",
      };
      const result = createCustomerSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Alice Johnson");
        expect(result.data.phone).toBe("+15551234567");
        expect(result.data.email).toBe("alice.johnson@example.com"); // normalized lowercase
        expect(result.data.notes).toBe("Loyal wholesale customer");
      }
    });

    it("accepts minimal customer with only required name", () => {
      const result = createCustomerSchema.safeParse({ name: "Bob Smith" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Bob Smith");
        expect(result.data.phone).toBeUndefined();
        expect(result.data.email).toBeUndefined();
        expect(result.data.notes).toBeUndefined();
      }
    });

    it("accepts null for optional fields", () => {
      const result = createCustomerSchema.safeParse({
        name: "Carol White",
        phone: null,
        email: null,
        notes: null,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.phone).toBeNull();
        expect(result.data.email).toBeNull();
        expect(result.data.notes).toBeNull();
      }
    });

    it("trims whitespace from all string inputs", () => {
      const result = createCustomerSchema.safeParse({
        name: "   Dave Brown   ",
        phone: "   +442071838750   ",
        email: "   DAVE@EXAMPLE.COM   ",
        notes: "   Frequent buyer   ",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Dave Brown");
        expect(result.data.phone).toBe("+442071838750");
        expect(result.data.email).toBe("dave@example.com");
        expect(result.data.notes).toBe("Frequent buyer");
      }
    });

    describe("Phone Validation (E.164)", () => {
      it("accepts valid E.164 formats from various countries", () => {
        const validPhones = [
          "+15551234567",     // US
          "+442071838750",    // UK
          "+4930123456",      // Germany
          "+81312345678",     // Japan
          "+251911234567",    // Ethiopia
          "+61298765432",     // Australia
        ];
        for (const phone of validPhones) {
          const res = createCustomerSchema.safeParse({ name: "Valid Phone", phone });
          expect(res.success, `Phone ${phone} should be valid`).toBe(true);
        }
      });

      it("rejects non-E.164 phone formats", () => {
        const invalidPhones = [
          "555-1234",          // No country code, has dashes
          "(555) 123-4567",    // Formatted US
          "15551234567",       // Missing '+'
          "+0123456789",       // Country code starts with 0
          "+1",                // Too short (< 7 digits)
          "+1234567890123456", // Too long (> 15 digits)
          "not-a-phone",       // Text
          "+1555 123 4567",    // Internal spaces
        ];
        for (const phone of invalidPhones) {
          const res = createCustomerSchema.safeParse({ name: "Invalid Phone", phone });
          expect(res.success, `Phone ${phone} should be rejected`).toBe(false);
        }
      });
    });

    describe("Name Validation", () => {
      it("rejects empty name", () => {
        const res = createCustomerSchema.safeParse({ name: "" });
        expect(res.success).toBe(false);
      });

      it("rejects whitespace-only name", () => {
        const res = createCustomerSchema.safeParse({ name: "    " });
        expect(res.success).toBe(false);
      });

      it("accepts 1 character name (minimum boundary)", () => {
        const res = createCustomerSchema.safeParse({ name: "X" });
        expect(res.success).toBe(true);
      });

      it("accepts 255 character name (maximum boundary)", () => {
        const res = createCustomerSchema.safeParse({ name: "A".repeat(255) });
        expect(res.success).toBe(true);
      });

      it("rejects 256 character name (exceeds boundary)", () => {
        const res = createCustomerSchema.safeParse({ name: "A".repeat(256) });
        expect(res.success).toBe(false);
      });
    });

    describe("Email Validation", () => {
      it("rejects invalid email formats", () => {
        const invalidEmails = ["notanemail", "user@", "@domain.com", "user@.com"];
        for (const email of invalidEmails) {
          const res = createCustomerSchema.safeParse({ name: "Test", email });
          expect(res.success).toBe(false);
        }
      });
    });

    describe("Notes Validation", () => {
      it("accepts 1000 character notes", () => {
        const res = createCustomerSchema.safeParse({ name: "Test", notes: "N".repeat(1000) });
        expect(res.success).toBe(true);
      });

      it("rejects 1001 character notes", () => {
        const res = createCustomerSchema.safeParse({ name: "Test", notes: "N".repeat(1001) });
        expect(res.success).toBe(false);
      });
    });
  });

  describe("updateCustomerSchema", () => {
    it("accepts partial updates (e.g. only notes)", () => {
      const res = updateCustomerSchema.safeParse({ notes: "Updated delivery instructions" });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.notes).toBe("Updated delivery instructions");
        expect(res.data.name).toBeUndefined();
      }
    });

    it("accepts partial update of name", () => {
      const res = updateCustomerSchema.safeParse({ name: "Jane Doe" });
      expect(res.success).toBe(true);
    });

    it("rejects empty name if provided in update", () => {
      const res = updateCustomerSchema.safeParse({ name: "   " });
      expect(res.success).toBe(false);
    });

    it("allows clearing phone and email via null", () => {
      const res = updateCustomerSchema.safeParse({ phone: null, email: null });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.phone).toBeNull();
        expect(res.data.email).toBeNull();
      }
    });
  });

  describe("customerSearchSchema", () => {
    it("applies default values for pagination and status", () => {
      const res = customerSearchSchema.safeParse({});
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.status).toBe("active");
        expect(res.data.page).toBe(1);
        expect(res.data.pageSize).toBe(20);
      }
    });

    it("coerces numeric string pagination parameters", () => {
      const res = customerSearchSchema.safeParse({
        page: "3",
        pageSize: "50",
        search: "Acme",
        status: "all",
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.page).toBe(3);
        expect(res.data.pageSize).toBe(50);
        expect(res.data.search).toBe("Acme");
        expect(res.data.status).toBe("all");
      }
    });

    it("rejects negative or zero page", () => {
      expect(customerSearchSchema.safeParse({ page: 0 }).success).toBe(false);
      expect(customerSearchSchema.safeParse({ page: -1 }).success).toBe(false);
    });

    it("bounds pageSize between 1 and 100", () => {
      expect(customerSearchSchema.safeParse({ pageSize: 0 }).success).toBe(false);
      expect(customerSearchSchema.safeParse({ pageSize: 1 }).success).toBe(true);
      expect(customerSearchSchema.safeParse({ pageSize: 100 }).success).toBe(true);
      expect(customerSearchSchema.safeParse({ pageSize: 101 }).success).toBe(false);
    });
  });
});
