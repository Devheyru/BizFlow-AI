import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { CheckoutErrors } from "@/components/pos/checkout-errors";

describe("CheckoutErrors Component (T057, US1)", () => {
  it("renders actionable guidance for INSUFFICIENT_STOCK", () => {
    render(
      <CheckoutErrors
        error={{
          code: "INSUFFICIENT_STOCK",
          message: "Requested stock not available.",
        }}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByText("Insufficient Inventory Stock")).toBeDefined();
    expect(
      screen.getByText(/adjust quantities or remove out-of-stock items/i)
    ).toBeDefined();
  });

  it("renders actionable guidance for PAYMENT_INCOMPLETE", () => {
    render(
      <CheckoutErrors
        error={{
          code: "PAYMENT_INCOMPLETE",
          message: "Total tenders less than payable total.",
        }}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByText("Incomplete Payment")).toBeDefined();
    expect(
      screen.getByText(/add additional tenders to complete the balance/i)
    ).toBeDefined();
  });

  it("renders validation details when available", () => {
    render(
      <CheckoutErrors
        error={{
          code: "VALIDATION_ERROR",
          message: "Validation failed.",
          details: {
            items: ["Cart must contain at least one item."],
          },
        }}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByText(/Cart must contain at least one item/)).toBeDefined();
  });

  it("invokes onDismiss when close button is clicked", () => {
    const onDismiss = vi.fn();
    render(
      <CheckoutErrors
        error={{
          code: "GENERIC_ERROR",
          message: "An unexpected error occurred.",
        }}
        onDismiss={onDismiss}
      />
    );

    const dismissBtn = screen.getByRole("button", { name: /dismiss error/i });
    fireEvent.click(dismissBtn);
    expect(onDismiss).toHaveBeenCalled();
  });
});
