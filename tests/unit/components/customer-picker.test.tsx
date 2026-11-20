import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CustomerPicker } from "@/components/customers/customer-picker";
import * as customerActions from "@/actions/customer-actions";

vi.mock("@/actions/customer-actions", () => ({
  searchCustomersAction: vi.fn(),
  createCustomerAction: vi.fn(),
  updateCustomerAction: vi.fn(),
}));

describe("CustomerPicker Component Unit Tests (T047, US2)", () => {
  const mockSlug = "test-store";
  const mockOnSelectCustomer = vi.fn();

  const mockCustomer = {
    id: "c-1",
    organizationId: "org-1",
    name: "Alice Johnson",
    phone: "+14155551234",
    email: "alice@example.com",
    notes: null,
    status: "active" as const,
    createdAt: "2026-11-17T12:00:00Z",
    updatedAt: "2026-11-17T12:00:00Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders search input when selectedCustomer is null", () => {
    render(
      <CustomerPicker
        slug={mockSlug}
        selectedCustomer={null}
        onSelectCustomer={mockOnSelectCustomer}
      />
    );

    expect(
      screen.getByPlaceholderText(/Search customer \(name, phone, email\)\.\.\./i)
    ).toBeDefined();
  });

  it("shows selected customer badge and clear button when customer is selected", () => {
    render(
      <CustomerPicker
        slug={mockSlug}
        selectedCustomer={mockCustomer}
        onSelectCustomer={mockOnSelectCustomer}
      />
    );

    expect(screen.getByText("Alice Johnson")).toBeDefined();
    expect(screen.getByText("+14155551234")).toBeDefined();

    const clearButton = screen.getByRole("button", { name: /Remove customer/i });
    expect(clearButton).toBeDefined();

    fireEvent.click(clearButton);
    expect(mockOnSelectCustomer).toHaveBeenCalledWith(null);
  });

  it("searches customers with debounce and selects item from dropdown", async () => {
    vi.mocked(customerActions.searchCustomersAction).mockResolvedValue({
      success: true,
      data: {
        items: [mockCustomer],
        totalCount: 1,
        page: 1,
        pageSize: 5,
        totalPages: 1,
      },
    });

    render(
      <CustomerPicker
        slug={mockSlug}
        selectedCustomer={null}
        onSelectCustomer={mockOnSelectCustomer}
      />
    );

    const input = screen.getByPlaceholderText(/Search customer/i);
    fireEvent.change(input, { target: { value: "Alice" } });

    await waitFor(
      () => {
        expect(customerActions.searchCustomersAction).toHaveBeenCalledWith(mockSlug, {
          search: "Alice",
          status: "active",
          pageSize: 5,
        });
        expect(screen.getByText("Alice Johnson")).toBeDefined();
      },
      { timeout: 1000 }
    );

    const optionButton = screen.getByText("Alice Johnson");
    fireEvent.click(optionButton);

    expect(mockOnSelectCustomer).toHaveBeenCalledWith(mockCustomer);
  });

  it("shows create customer button and opens modal when clicked", async () => {
    render(
      <CustomerPicker
        slug={mockSlug}
        selectedCustomer={null}
        onSelectCustomer={mockOnSelectCustomer}
        canCreateCustomer={true}
      />
    );

    const input = screen.getByPlaceholderText(/Search customer/i);
    fireEvent.focus(input);

    const createButton = screen.getByText(/Create New Customer Profile/i);
    expect(createButton).toBeDefined();

    fireEvent.click(createButton);

    expect(screen.getByText("New Customer Profile")).toBeDefined();
  });
});
