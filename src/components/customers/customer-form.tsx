"use client";

import React, { useState, useEffect } from "react";
import { X, UserPlus, UserCheck, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createCustomerSchema,
  updateCustomerSchema,
} from "@/lib/validations/customers";
import {
  createCustomerAction,
  updateCustomerAction,
} from "@/actions/customer-actions";
import type { CustomerRecord, CustomerDetail } from "@/types/customers";

export interface CustomerFormProps {
  isOpen: boolean;
  onClose: () => void;
  slug: string;
  customer?: CustomerRecord | CustomerDetail | null;
  onSuccess?: (customer: CustomerRecord) => void;
}

export function CustomerForm({
  isOpen,
  onClose,
  slug,
  customer,
  onSuccess,
}: CustomerFormProps) {
  const isEdit = Boolean(customer?.id);

  // Form input state
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string[];
    phone?: string[];
    email?: string[];
    notes?: string[];
  }>({});

  // Reset or populate form when modal opens or customer prop changes
  useEffect(() => {
    if (isOpen) {
      if (customer) {
        setName(customer.name || "");
        setPhone(customer.phone || "");
        setEmail(customer.email || "");
        setNotes(customer.notes || "");
      } else {
        setName("");
        setPhone("");
        setEmail("");
        setNotes("");
      }
      setFormError(null);
      setFieldErrors({});
    }
  }, [isOpen, customer]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isLoading) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  if (!isOpen) return null;

  // Real-time email normalization preview
  const normalizedEmail = email ? email.trim().toLowerCase() : "";
  const showNormalizationNotice =
    Boolean(email) &&
    (email !== normalizedEmail || email.trim() !== email);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setFormError(null);
    setFieldErrors({});

    const rawPayload = {
      name: name.trim(),
      phone: phone.trim() ? phone.trim() : null,
      email: email.trim() ? email.trim() : null,
      notes: notes.trim() ? notes.trim() : null,
    };

    // Client-side schema validation
    if (isEdit) {
      const parsed = updateCustomerSchema.safeParse(rawPayload);
      if (!parsed.success) {
        setFieldErrors(parsed.error.flatten().fieldErrors);
        return;
      }
    } else {
      const parsed = createCustomerSchema.safeParse(rawPayload);
      if (!parsed.success) {
        setFieldErrors(parsed.error.flatten().fieldErrors);
        return;
      }
    }

    setIsLoading(true);

    try {
      if (isEdit && customer) {
        const res = await updateCustomerAction(slug, customer.id, rawPayload);
        if (!res.success) {
          if (res.error.details) {
            setFieldErrors(res.error.details as typeof fieldErrors);
          }
          setFormError(res.error.message || "Failed to update customer.");
          setIsLoading(false);
          return;
        }

        onSuccess?.(res.data);
        onClose();
      } else {
        const res = await createCustomerAction(slug, rawPayload);
        if (!res.success) {
          if (res.error.details) {
            setFieldErrors(res.error.details as typeof fieldErrors);
          }
          setFormError(res.error.message || "Failed to create customer.");
          setIsLoading(false);
          return;
        }

        onSuccess?.(res.data);
        onClose();
      }
    } catch {
      setFormError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="customer-form-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        className="relative w-full max-w-lg bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-gray-200 dark:border-zinc-800 flex flex-col max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded-lg">
              {isEdit ? <UserCheck className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
            </div>
            <div>
              <h2
                id="customer-form-title"
                className="text-lg font-semibold text-gray-900 dark:text-gray-100"
              >
                {isEdit ? "Edit Customer Profile" : "New Customer Profile"}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {isEdit
                  ? "Update customer contact details and notes"
                  : "Register a customer to track purchases and sales history"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-y-auto p-6 gap-4">
          {formError && (
            <div
              role="alert"
              className="flex items-center gap-2 p-3 text-sm text-red-700 bg-red-50 dark:bg-red-950/50 dark:text-red-400 border border-red-200 dark:border-red-900 rounded-lg"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {/* Name Field */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="customer-name" className="text-sm font-medium">
              Customer Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="customer-name"
              type="text"
              required
              disabled={isLoading}
              placeholder="e.g. Acme Corp or Jane Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={fieldErrors.name ? "border-red-500 focus-visible:ring-red-500" : ""}
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? "customer-name-error" : undefined}
            />
            {fieldErrors.name && (
              <p id="customer-name-error" role="alert" className="text-xs text-red-500">
                {fieldErrors.name[0]}
              </p>
            )}
          </div>

          {/* Phone Field */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="customer-phone" className="text-sm font-medium">
              Phone Number
            </Label>
            <Input
              id="customer-phone"
              type="tel"
              disabled={isLoading}
              placeholder="+1234567890 (E.164 format)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={fieldErrors.phone ? "border-red-500 focus-visible:ring-red-500" : ""}
              aria-invalid={Boolean(fieldErrors.phone)}
              aria-describedby={fieldErrors.phone ? "customer-phone-error" : "customer-phone-hint"}
            />
            <p id="customer-phone-hint" className="text-xs text-gray-500 dark:text-gray-400">
              International E.164 format including country code (e.g. +14155552671)
            </p>
            {fieldErrors.phone && (
              <p id="customer-phone-error" role="alert" className="text-xs text-red-500">
                {fieldErrors.phone[0]}
              </p>
            )}
          </div>

          {/* Email Field */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="customer-email" className="text-sm font-medium">
              Email Address
            </Label>
            <Input
              id="customer-email"
              type="email"
              disabled={isLoading}
              placeholder="jane.doe@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={fieldErrors.email ? "border-red-500 focus-visible:ring-red-500" : ""}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? "customer-email-error" : undefined}
            />
            {showNormalizationNotice && (
              <p className="text-xs text-blue-600 dark:text-blue-400">
                Will be normalized to: <span className="font-mono">{normalizedEmail}</span>
              </p>
            )}
            {fieldErrors.email && (
              <p id="customer-email-error" role="alert" className="text-xs text-red-500">
                {fieldErrors.email[0]}
              </p>
            )}
          </div>

          {/* Notes Field */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="customer-notes" className="text-sm font-medium">
                Internal Notes
              </Label>
              <span className="text-xs text-gray-400">
                {notes.length} / 1000
              </span>
            </div>
            <textarea
              id="customer-notes"
              rows={3}
              maxLength={1000}
              disabled={isLoading}
              placeholder="Optional notes, preferences, or tax exempt reference..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={`w-full rounded-md border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 ${
                fieldErrors.notes ? "border-red-500" : ""
              }`}
              aria-invalid={Boolean(fieldErrors.notes)}
              aria-describedby={fieldErrors.notes ? "customer-notes-error" : undefined}
            />
            {fieldErrors.notes && (
              <p id="customer-notes-error" role="alert" className="text-xs text-red-500">
                {fieldErrors.notes[0]}
              </p>
            )}
          </div>

          {/* Footer Controls */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-zinc-800 mt-2">
            <Button
              type="button"
              variant="outline"
              disabled={isLoading}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !name.trim()}
              isLoading={isLoading}
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? "Save Changes" : "Create Customer"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
