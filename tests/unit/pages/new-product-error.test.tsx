import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import NewProductError from "@/app/[slug]/products/new/error";
import { useParams } from "next/navigation";

vi.mock("next/navigation", () => ({
  useParams: vi.fn(),
}));

const EXPECTED_SAFE_MESSAGE =
  "An unexpected error occurred while loading the product registration form. Please try again.";

describe("Security Remediation: NewProductError Fail-Safe Information Disclosure Tests", () => {
  const mockReset = vi.fn();
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(useParams).mockReturnValue({ slug: "acme-corp" });
  });

  const hostileCases = [
    {
      description: "Bearer authentication token",
      message: "Authentication failure: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID1",
    },
    {
      description: "Production API Secret Key",
      message: "Payment provider error with Invalid API Key: sk_live_example_9918273645",
    },
    {
      description: "Database authentication failure credential leak",
      message: 'FATAL: password authentication failed for user "postgres_superadmin"',
    },
    {
      description: "Internal infrastructure endpoint URL",
      message: "Failed request to https://internal.example.local:8443/vault/secrets/v1",
    },
    {
      description: "Raw PostgreSQL table schema identifier",
      message: 'error: relation "private_table" does not exist at character 14',
    },
    {
      description: "Arbitrary unvetted runtime crash text",
      message: "Uncaught MemoryException: segmentation fault at memory address 0xDEADBEEF42",
    },
  ];

  hostileCases.forEach(({ description, message }) => {
    it(`unconditionally renders fixed safe message and suppresses ${description}`, () => {
      const error = Object.assign(new Error(message), {
        stack: `Error: ${message}\n    at queryPrivateDatabase (/app/src/db.ts:42:11)\n    at Object.handler (/app/src/page.tsx:99:5)`,
      });

      const { container } = render(<NewProductError error={error} reset={mockReset} />);

      // 1. The fixed safe message MUST be rendered
      expect(screen.getByText(EXPECTED_SAFE_MESSAGE)).toBeDefined();

      // 2. The raw error message MUST be absent from the rendered DOM
      expect(screen.queryByText(new RegExp(message.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")))).toBeNull();
      expect(container.textContent).not.toContain(message);

      // 3. No stack trace fragments may reach the rendered DOM
      expect(container.textContent).not.toContain("queryPrivateDatabase");
      expect(container.textContent).not.toContain("/app/src/db.ts");

      // 4. No raw error message or stack trace sent to console.error diagnostics
      consoleErrorSpy.mock.calls.forEach((call) => {
        const loggedArgsString = JSON.stringify(call);
        expect(loggedArgsString).not.toContain(message);
        expect(loggedArgsString).not.toContain("queryPrivateDatabase");
      });
    });
  });

  it("renders non-sensitive error digest when available without leaking raw error text", () => {
    const error = Object.assign(new Error("Sensitive internal error"), {
      digest: "next-digest-98765",
    });

    const { container } = render(<NewProductError error={error} reset={mockReset} />);

    // Renders digest
    expect(screen.getByText("Error Digest: next-digest-98765")).toBeDefined();
    // Does not render raw message
    expect(container.textContent).not.toContain("Sensitive internal error");

    // Logs only the non-sensitive digest
    expect(consoleErrorSpy).toHaveBeenCalledWith("[NEW_PRODUCT_ROUTE_ERROR]", {
      digest: "next-digest-98765",
    });
  });

  it("logs non-sensitive marker without digest when digest is missing", () => {
    const error = new Error("Sensitive error without digest");

    render(<NewProductError error={error} reset={mockReset} />);

    expect(consoleErrorSpy).toHaveBeenCalledWith("[NEW_PRODUCT_ROUTE_ERROR]");
  });

  it("invokes reset() when 'Try Again' button is clicked", () => {
    const error = new Error("Any error");

    render(<NewProductError error={error} reset={mockReset} />);

    const retryBtn = screen.getByRole("button", { name: /try again/i });
    fireEvent.click(retryBtn);

    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it("resolves catalog back link to the active tenant slug", () => {
    const error = new Error("Any error");

    render(<NewProductError error={error} reset={mockReset} />);

    const links = screen.getAllByRole("link");
    const hrefs = links.map((l) => l.getAttribute("href"));

    expect(hrefs).toContain("/acme-corp/products");
  });

  it("handles empty or missing tenant slug safely without rendering invalid paths", () => {
    vi.mocked(useParams).mockReturnValue({});

    const error = new Error("Any error");

    render(<NewProductError error={error} reset={mockReset} />);

    const links = screen.getAllByRole("link");
    const hrefs = links.map((l) => l.getAttribute("href"));

    expect(hrefs).toContain("//products");
  });
});
