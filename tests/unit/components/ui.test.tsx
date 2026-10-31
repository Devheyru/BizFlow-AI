import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  Button,
  Input,
  Label,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Alert,
  AlertTitle,
  AlertDescription,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui";

describe("T013: Foundational UI Component Primitives", () => {
  describe("Button Component", () => {
    it("renders button with children text", () => {
      render(<Button>Click Me</Button>);
      expect(screen.getByRole("button", { name: "Click Me" })).toBeInTheDocument();
    });

    it("handles click events", () => {
      const handleClick = vi.fn();
      render(<Button onClick={handleClick}>Submit</Button>);
      fireEvent.click(screen.getByRole("button", { name: "Submit" }));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it("disables button when disabled or isLoading is true", () => {
      const { rerender } = render(<Button disabled>Disabled Button</Button>);
      expect(screen.getByRole("button")).toBeDisabled();

      rerender(<Button isLoading>Loading Button</Button>);
      const btn = screen.getByRole("button");
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute("aria-busy", "true");
    });

    it("applies variant classes correctly", () => {
      const { rerender } = render(<Button variant="destructive">Delete</Button>);
      expect(screen.getByRole("button")).toHaveClass("bg-red-600");

      rerender(<Button variant="outline">Outline</Button>);
      expect(screen.getByRole("button")).toHaveClass("border-gray-300");
    });
  });

  describe("Input Component", () => {
    it("renders an input element with placeholder", () => {
      render(<Input placeholder="Enter your email" />);
      expect(screen.getByPlaceholderText("Enter your email")).toBeInTheDocument();
    });

    it("applies aria-invalid and error styling when error is true", () => {
      render(<Input placeholder="Email" error="Invalid email address" />);
      const input = screen.getByPlaceholderText("Email");
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input).toHaveClass("border-red-500");
    });
  });

  describe("Label Component", () => {
    it("renders label with text and htmlFor", () => {
      render(<Label htmlFor="test-input">Test Label</Label>);
      const label = screen.getByText("Test Label");
      expect(label).toBeInTheDocument();
      expect(label).toHaveAttribute("for", "test-input");
    });

    it("shows required asterisk when required is true", () => {
      render(<Label required>Required Field</Label>);
      expect(screen.getByText("*")).toBeInTheDocument();
    });
  });

  describe("Card Components", () => {
    it("renders complete card structure", () => {
      render(
        <Card>
          <CardHeader>
            <CardTitle>Organization Settings</CardTitle>
            <CardDescription>Manage your organization details</CardDescription>
          </CardHeader>
          <CardContent>Content Area</CardContent>
          <CardFooter>Footer Actions</CardFooter>
        </Card>
      );

      expect(screen.getByText("Organization Settings")).toBeInTheDocument();
      expect(screen.getByText("Manage your organization details")).toBeInTheDocument();
      expect(screen.getByText("Content Area")).toBeInTheDocument();
      expect(screen.getByText("Footer Actions")).toBeInTheDocument();
    });
  });

  describe("Alert Component", () => {
    it("renders alert with role='alert' and text", () => {
      render(
        <Alert variant="destructive">
          <AlertTitle>Authentication Error</AlertTitle>
          <AlertDescription>Invalid email or password</AlertDescription>
        </Alert>
      );

      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveClass("bg-red-50");
      expect(screen.getByText("Authentication Error")).toBeInTheDocument();
      expect(screen.getByText("Invalid email or password")).toBeInTheDocument();
    });
  });

  describe("DropdownMenu Component", () => {
    it("opens menu content when trigger is clicked and closes on item click", () => {
      const handleSelect = vi.fn();
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Organizations</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSelect}>Acme Corp</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );

      // Initially closed
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();

      // Click trigger to open
      fireEvent.click(screen.getByRole("button", { name: "Open Menu" }));
      expect(screen.getByRole("menu")).toBeInTheDocument();
      expect(screen.getByText("Organizations")).toBeInTheDocument();

      // Click menu item
      fireEvent.click(screen.getByRole("menuitem", { name: "Acme Corp" }));
      expect(handleSelect).toHaveBeenCalledTimes(1);

      // Menu should be closed
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("closes when Escape key is pressed", () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Option</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );

      fireEvent.click(screen.getByRole("button", { name: "Menu" }));
      expect(screen.getByRole("menu")).toBeInTheDocument();

      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });
});

