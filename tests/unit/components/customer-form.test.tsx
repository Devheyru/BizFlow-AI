import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CustomerForm } from "@/components/customers/customer-form";
import * as customerActions from "@/actions/customer-actions";

vi.mock("@/actions/customer-actions", () => ({
  createCustomerAction: vi.fn(),
  updateCustomerAction: vi.fn(),
}));

describe("CustomerForm Component Unit Tests (T045, US2)", () => {
  const mockSlug = "test-store";
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <CustomerForm
        isOpen={false}
        onClose={mockOnClose}
        slug={mockSlug}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders create form with initial empty fields and correct labels", () => {
    render(
      <CustomerForm
        isOpen={true}
        onClose={mockOnClose}
        slug={mockSlug}
      />
    );

    expect(screen.getByText("New Customer Profile")).toBeDefined();
    expect(screen.getByLabelText(/Customer Name/i)).toBeDefined();
    expect(screen.getByLabelText(/Phone Number/i)).toBeDefined();
    expect(screen.getByLabelText(/Email Address/i)).toBeDefined();
    expect(screen.getByLabelText(/Internal Notes/i)).toBeDefined();
    expect(screen.getByRole("button", { name: "Create Customer" })).toBeDefined();
  });

  it("displays live email normalization preview when uppercase or untrimmed characters are entered", () => {
    render(
      <CustomerForm
        isOpen={true}
        onClose={mockOnClose}
        slug={mockSlug}
      />
    );

    const emailInput = screen.getByLabelText(/Email Address/i);
    fireEvent.change(emailInput, { target: { value: "JANE.DOE@EXAMPLE.COM " } });

    expect(screen.getByText(/Will be normalized to:/i)).toBeDefined();
    expect(screen.getByText("jane.doe@example.com")).toBeDefined();
  });

  it("validates invalid phone number before calling server action", async () => {
    render(
      <CustomerForm
        isOpen={true}
        onClose={mockOnClose}
        slug={mockSlug}
      />
    );

    const nameInput = screen.getByLabelText(/Customer Name/i);
    const phoneInput = screen.getByLabelText(/Phone Number/i);
    const submitButton = screen.getByRole("button", { name: "Create Customer" });

    fireEvent.change(nameInput, { target: { value: "Valid Name" } });
    fireEvent.change(phoneInput, { target: { value: "not-a-valid-phone" } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/Phone number must follow E\.164 format/i)).toBeDefined();
    });

    expect(customerActions.createCustomerAction).not.toHaveBeenCalled();
  });

  it("submits valid create form and triggers callbacks on success", async () => {
    vi.mocked(customerActions.createCustomerAction).mockResolvedValue({
      success: true,
      data: {
        id: "cust-1",
        organizationId: "org-1",
        name: "Jane Doe",
        phone: "+14155552671",
        email: "jane@example.com",
        notes: "Prefers morning deliveries",
        status: "active",
        createdAt: "2026-11-17T12:00:00Z",
        updatedAt: "2026-11-17T12:00:00Z",
      },
    });

    render(
      <CustomerForm
        isOpen={true}
        onClose={mockOnClose}
        slug={mockSlug}
        onSuccess={mockOnSuccess}
      />
    );

    fireEvent.change(screen.getByLabelText(/Customer Name/i), { target: { value: "Jane Doe" } });
    fireEvent.change(screen.getByLabelText(/Phone Number/i), { target: { value: "+14155552671" } });
    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: "jane@example.com" } });
    fireEvent.change(screen.getByLabelText(/Internal Notes/i), { target: { value: "Prefers morning deliveries" } });

    fireEvent.click(screen.getByRole("button", { name: "Create Customer" }));

    await waitFor(() => {
      expect(customerActions.createCustomerAction).toHaveBeenCalledWith(mockSlug, {
        name: "Jane Doe",
        phone: "+14155552671",
        email: "jane@example.com",
        notes: "Prefers morning deliveries",
      });
      expect(mockOnSuccess).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it("pre-populates fields in edit mode and submits updateCustomerAction", async () => {
    const existingCustomer = {
      id: "cust-123",
      organizationId: "org-1",
      name: "Acme Corp",
      phone: "+14155550000",
      email: "billing@acme.com",
      notes: "Existing notes",
      status: "active" as const,
      createdAt: "2026-11-01T10:00:00Z",
      updatedAt: "2026-11-01T10:00:00Z",
    };

    vi.mocked(customerActions.updateCustomerAction).mockResolvedValue({
      success: true,
      data: {
        ...existingCustomer,
        name: "Acme Corporation",
      },
    });

    render(
      <CustomerForm
        isOpen={true}
        onClose={mockOnClose}
        slug={mockSlug}
        customer={existingCustomer}
        onSuccess={mockOnSuccess}
      />
    );

    expect(screen.getByText("Edit Customer Profile")).toBeDefined();
    expect(screen.getByDisplayValue("Acme Corp")).toBeDefined();
    expect(screen.getByDisplayValue("+14155550000")).toBeDefined();
    expect(screen.getByDisplayValue("billing@acme.com")).toBeDefined();

    fireEvent.change(screen.getByLabelText(/Customer Name/i), { target: { value: "Acme Corporation" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(customerActions.updateCustomerAction).toHaveBeenCalledWith(mockSlug, "cust-123", {
        name: "Acme Corporation",
        phone: "+14155550000",
        email: "billing@acme.com",
        notes: "Existing notes",
      });
      expect(mockOnSuccess).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it("displays server error message when action fails", async () => {
    vi.mocked(customerActions.createCustomerAction).mockResolvedValue({
      success: false,
      error: {
        code: "CUSTOMER_PHONE_EXISTS",
        message: "A customer with this phone number already exists in your organization.",
      },
    });

    render(
      <CustomerForm
        isOpen={true}
        onClose={mockOnClose}
        slug={mockSlug}
      />
    );

    fireEvent.change(screen.getByLabelText(/Customer Name/i), { target: { value: "Duplicate Person" } });
    fireEvent.change(screen.getByLabelText(/Phone Number/i), { target: { value: "+14155552671" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Customer" }));

    await waitFor(() => {
      expect(screen.getByText(/A customer with this phone number already exists/i)).toBeDefined();
    });
  });
});
