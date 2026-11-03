"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { inviteEmployeeAction } from "@/actions/invitation-actions";
import { inviteEmployeeSchema } from "@/lib/validations/invitation";
import type { AppRole } from "@/types/auth";
import { UserPlus, AlertCircle, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

interface InviteEmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  slug: string;
  organizationId: string;
  callerRole: AppRole;
  onInvitationCreated?: () => void;
}

export function InviteEmployeeModal({
  isOpen,
  onClose,
  slug,
  organizationId,
  callerRole,
  onInvitationCreated,
}: InviteEmployeeModalProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("cashier");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const isAdminCaller = callerRole === "admin";

  const roleOptions: { value: AppRole; label: string; disabled?: boolean }[] = [
    { value: "owner", label: "Owner", disabled: isAdminCaller },
    { value: "admin", label: "Admin" },
    { value: "manager", label: "Manager" },
    { value: "cashier", label: "Cashier" },
  ];

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setWarningMessage(null);
    setSuccessMessage(null);

    // Validate email
    const validation = inviteEmployeeSchema.safeParse({
      organizationId,
      email,
      role,
    });

    if (!validation.success) {
      const issue = validation.error.errors[0]?.message || "Invalid invitation input.";
      setErrorMessage(issue);
      return;
    }

    setLoading(true);

    const res = await inviteEmployeeAction(slug, {
      organizationId,
      email: validation.data.email,
      role,
    });

    setLoading(false);

    if (!res.success) {
      setErrorMessage(res.error.message);
      return;
    }

    if (res.data.warning === "EMAIL_DELIVERY_FAILED") {
      setWarningMessage(
        "Invitation created, but the invitation email could not be delivered. You can resend the invitation from the Pending Invitations tab."
      );
    } else {
      setSuccessMessage(`Invitation successfully sent to ${res.data.email}.`);
    }

    onInvitationCreated?.();

    if (!res.data.warning) {
      setTimeout(() => {
        onClose();
        setEmail("");
        setRole("cashier");
        setSuccessMessage(null);
      }, 1500);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-modal-title"
    >
      <div className="w-full max-w-md rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <UserPlus className="h-5 w-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          <h2 id="invite-modal-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Invite Employee
          </h2>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400">
          Send an invitation email to join your organization. Invitations are valid for 7 days.
        </p>

        {errorMessage && (
          <div className="flex items-center gap-2 rounded-md bg-rose-50 dark:bg-rose-950/50 p-3 text-xs text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {warningMessage && (
          <div className="flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-950/50 p-3 text-xs text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{warningMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="flex items-center gap-2 rounded-md bg-emerald-50 dark:bg-emerald-950/50 p-3 text-xs text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        <form onSubmit={handleInvite} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Email Address
            </label>
            <input
              type="email"
              required
              placeholder="colleague@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Assign Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AppRole)}
              disabled={loading}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {roleOptions.map((opt) => (
                <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                  {opt.disabled ? " (Owner access restricted)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Send Invitation
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
