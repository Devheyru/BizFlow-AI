import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CreateOrganizationForm } from "@/components/organization/CreateOrganizationForm";

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
  }),
}));

// Mock organization server action
vi.mock("@/actions/organization-actions", () => ({
  createOrganizationAction: vi.fn().mockImplementation(async (input) => {
    if (input.name === "Fail Trigger") {
      return {
        success: false,
        error: {
          code: "P0001",
          message: "Email verification required before creating an organization",
        },
      };
    }
    return {
      success: true,
      data: {
        id: "org-12345",
        name: input.name,
        slug: "super-store",
        businessType: input.businessType,
        country: input.country,
        currency: input.currency,
        timezone: input.timezone,
        role: "owner",
        isActive: true,
        isIdempotentReplay: false,
        redirectUrl: "/super-store/dashboard",
      },
    };
  }),
}));

describe("T031: CreateOrganizationForm Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all required onboarding fields and default values", () => {
    render(<CreateOrganizationForm />);

    expect(screen.getByLabelText(/business \/ store name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/business category \/ type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/country/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/currency/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/timezone/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create workspace/i })).toBeInTheDocument();
  });

  it("renders optional contact and tax fields", () => {
    render(<CreateOrganizationForm />);

    expect(screen.getByLabelText(/tax \/ vat id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/phone number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/store contact email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/physical address/i)).toBeInTheDocument();
  });

  it("displays inline validation errors when submitting an empty store name", async () => {
    render(<CreateOrganizationForm />);

    const submitBtn = screen.getByRole("button", { name: /create workspace/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/organization name must be at least 2 characters/i)).toBeInTheDocument();
    });
  });

  it("submits valid form data and redirects to tenant dashboard", async () => {
    render(<CreateOrganizationForm />);

    fireEvent.change(screen.getByLabelText(/business \/ store name/i), {
      target: { value: "Apex Retailers" },
    });

    const submitBtn = screen.getByRole("button", { name: /create workspace/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/super-store/dashboard");
    });
  });

  it("displays server error message when action fails", async () => {
    render(<CreateOrganizationForm />);

    fireEvent.change(screen.getByLabelText(/business \/ store name/i), {
      target: { value: "Fail Trigger" },
    });

    const submitBtn = screen.getByRole("button", { name: /create workspace/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/email verification required before creating an organization/i)).toBeInTheDocument();
    });
  });
});

