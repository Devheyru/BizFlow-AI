import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { SignInForm } from "@/components/auth/SignInForm";
import { VerifyEmailCard } from "@/components/auth/VerifyEmailCard";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  useSearchParams: () => ({
    get: (key: string) => (key === "email" ? "test@example.com" : null),
  }),
}));

// Mock server actions
vi.mock("@/actions/auth-actions", () => ({
  signUpAction: vi.fn().mockResolvedValue({
    success: true,
    data: {
      userId: "test-user-id",
      email: "jane@example.com",
      isEmailVerified: false,
      message: "Please check your email to verify your account.",
    },
  }),
  signInAction: vi.fn().mockResolvedValue({
    success: true,
    data: {
      userId: "test-user-id",
      email: "jane@example.com",
      isEmailVerified: true,
      hasActiveOrganization: false,
      redirectUrl: "/onboarding/create-organization",
    },
  }),
  resendVerificationAction: vi.fn().mockResolvedValue({
    success: true,
    data: {
      message: "Verification email sent.",
    },
  }),
}));

describe("T022–T024: Authentication Form Components", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("SignUpForm (T022)", () => {
    it("renders all registration fields", () => {
      render(<SignUpForm />);
      expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument();
    });

    it("displays validation error when submitting empty form", async () => {
      render(<SignUpForm />);
      fireEvent.click(screen.getByRole("button", { name: /create account/i }));

      await waitFor(() => {
        expect(screen.getByText(/first name is required/i)).toBeInTheDocument();
        expect(screen.getByText(/last name is required/i)).toBeInTheDocument();
        expect(screen.getByText(/email address is required/i)).toBeInTheDocument();
      });
    });

    it("renders success card upon successful registration", async () => {
      render(<SignUpForm />);

      fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "Jane" } });
      fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: "Doe" } });
      fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "jane@example.com" } });
      fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "P@ssword123" } });

      fireEvent.click(screen.getByRole("button", { name: /create account/i }));

      await waitFor(() => {
        expect(screen.getByRole("heading", { name: /check your email/i })).toBeInTheDocument();
        expect(screen.getByText(/verification pending/i)).toBeInTheDocument();
      });
    });
  });

  describe("SignInForm (T023)", () => {
    it("renders sign-in form with email and password fields", () => {
      render(<SignInForm />);
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
      expect(screen.getByText(/forgot password\?/i)).toBeInTheDocument();
    });

    it("shows error when submitting empty credentials", async () => {
      render(<SignInForm />);
      fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

      await waitFor(() => {
        expect(screen.getByText(/email address is required/i)).toBeInTheDocument();
        expect(screen.getByText(/password is required/i)).toBeInTheDocument();
      });
    });
  });

  describe("VerifyEmailCard (T024)", () => {
    it("pre-fills email from searchParams and allows resending", async () => {
      render(<VerifyEmailCard />);
      expect(screen.getByRole("heading", { name: /verify your email/i })).toBeInTheDocument();
      expect(screen.getByDisplayValue("test@example.com")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /resend verification email/i }));

      await waitFor(() => {
        expect(screen.getByRole("heading", { name: /^email sent$/i })).toBeInTheDocument();
        expect(screen.getByText(/verification email sent\./i)).toBeInTheDocument();
      });
    });
  });
});

