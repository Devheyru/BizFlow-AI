import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TaxSettingsForm } from "@/components/settings/tax-settings-form";
import * as taxActions from "@/actions/tax-settings-actions";

vi.mock("@/actions/tax-settings-actions", () => ({
  updateTaxSettingsAction: vi.fn(),
}));

describe("TaxSettingsForm Component (T059, US5, US8)", () => {
  const initialSettings = {
    organizationId: "org-1",
    taxName: "Standard VAT",
    defaultTaxRate: 15.0,
    isTaxInclusive: true,
    updatedAt: "2026-11-21T00:00:00Z",
    updatedBy: "user-1",
  };

  it("renders with initial persisted tax configuration for authorized user", () => {
    render(
      <TaxSettingsForm
        slug="test-store"
        initialSettings={initialSettings}
        canManageTax={true}
      />
    );

    const nameInput = screen.getByLabelText(/Tax Display Name/i) as HTMLInputElement;
    const rateInput = screen.getByLabelText(/Default Tax Rate/i) as HTMLInputElement;

    expect(nameInput.value).toBe("Standard VAT");
    expect(rateInput.value).toBe("15");
    expect(screen.getByText(/Tax-Inclusive \(Built-in\)/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /Save Changes/i })).toBeDefined();
  });

  it("disables inputs and displays read-only warning when user lacks canManageTax", () => {
    render(
      <TaxSettingsForm
        slug="test-store"
        initialSettings={initialSettings}
        canManageTax={false}
      />
    );

    expect(screen.getByText(/Read-Only Mode/i)).toBeDefined();
    expect(screen.getByLabelText(/Tax Display Name/i)).toBeDisabled();
    expect(screen.getByLabelText(/Default Tax Rate/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /Save Changes/i })).toBeDisabled();
  });

  it("submits updated tax settings through updateTaxSettingsAction", async () => {
    const mockUpdate = vi.spyOn(taxActions, "updateTaxSettingsAction").mockResolvedValue({
      success: true,
      data: {
        organizationId: "org-1",
        taxName: "General Sales Tax",
        defaultTaxRate: 8.5,
        isTaxInclusive: false,
        updatedAt: "2026-11-21T01:00:00Z",
        updatedBy: "user-1",
      },
    });

    render(
      <TaxSettingsForm
        slug="test-store"
        initialSettings={initialSettings}
        canManageTax={true}
      />
    );

    const nameInput = screen.getByLabelText(/Tax Display Name/i);
    const rateInput = screen.getByLabelText(/Default Tax Rate/i);
    const exclusiveRadio = screen.getByText(/Tax-Exclusive \(Added\)/i);

    fireEvent.change(nameInput, { target: { value: "General Sales Tax" } });
    fireEvent.change(rateInput, { target: { value: "8.5" } });
    fireEvent.click(exclusiveRadio);

    const submitBtn = screen.getByRole("button", { name: /Save Changes/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith("test-store", {
        taxName: "General Sales Tax",
        defaultTaxRate: 8.5,
        isTaxInclusive: false,
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/Tax settings successfully saved/i)).toBeDefined();
    });
  });

  it("displays validation error when submitting an invalid rate", async () => {
    render(
      <TaxSettingsForm
        slug="test-store"
        initialSettings={initialSettings}
        canManageTax={true}
      />
    );

    const rateInput = screen.getByLabelText(/Default Tax Rate/i);
    fireEvent.change(rateInput, { target: { value: "150" } }); // Exceeds 100%

    const submitBtn = screen.getByRole("button", { name: /Save Changes/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getAllByText(/Tax rate cannot exceed 100%/i).length).toBeGreaterThan(0);
    });
  });
});
