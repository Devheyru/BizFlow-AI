"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { updateMemberRoleAction, type EmployeeListItem } from "@/actions/employee-actions";
import type { AppRole } from "@/types/auth";
import { Shield, AlertCircle, Loader2 } from "lucide-react";

interface RoleSelectorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  employee: EmployeeListItem;
  callerRole: AppRole;
  callerMembershipId: string;
  slug: string;
  organizationId: string;
  onRoleUpdated: (updated: EmployeeListItem) => void;
}

export function RoleSelectorDialog({
  isOpen,
  onClose,
  employee,
  callerRole,
  callerMembershipId,
  slug,
  organizationId,
  onRoleUpdated,
}: RoleSelectorDialogProps) {
  const [selectedRole, setSelectedRole] = useState<AppRole>(employee.role);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const isSelf = callerMembershipId === employee.membershipId;
  const isTargetOwner = employee.role === "owner";
  const isAdminCaller = callerRole === "admin";
  const canModify = !isSelf && !(isAdminCaller && isTargetOwner);

  const availableRoles: { value: AppRole; label: string; description: string; disabled?: boolean }[] = [
    {
      value: "owner",
      label: "Owner",
      description: "Full control over organization, billing, and workforce administration.",
      disabled: isAdminCaller, // Admin cannot assign Owner role
    },
    {
      value: "admin",
      label: "Admin",
      description: "Can manage workforce, invitations, and organizational settings.",
    },
    {
      value: "manager",
      label: "Manager",
      description: "Can view employee directory and access store operational tools.",
    },
    {
      value: "cashier",
      label: "Cashier",
      description: "Standard point-of-sale operational access. No directory access.",
    },
  ];

  async function handleRoleChange() {
    if (!canModify || selectedRole === employee.role) return;

    setLoading(true);
    setErrorMessage(null);

    const res = await updateMemberRoleAction(slug, {
      organizationId,
      membershipId: employee.membershipId,
      newRole: selectedRole,
    });

    setLoading(false);

    if (!res.success) {
      setErrorMessage(res.error.message);
      return;
    }

    onRoleUpdated({
      ...employee,
      role: res.data.role,
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="role-dialog-title"
    >
      <div className="w-full max-w-md rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          <h2 id="role-dialog-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Change Employee Role
          </h2>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400">
          Updating role for{" "}
          <strong className="text-gray-900 dark:text-gray-100">
            {employee.firstName} {employee.lastName}
          </strong>{" "}
          ({employee.email}).
        </p>

        {isSelf && (
          <div className="flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-950/50 p-3 text-xs text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>You cannot change your own organizational role.</span>
          </div>
        )}

        {isAdminCaller && isTargetOwner && (
          <div className="flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-950/50 p-3 text-xs text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>Admins cannot modify the role of an Owner.</span>
          </div>
        )}

        {errorMessage && (
          <div className="flex items-center gap-2 rounded-md bg-rose-50 dark:bg-rose-950/50 p-3 text-xs text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="space-y-2 pt-2">
          {availableRoles.map((r) => (
            <label
              key={r.value}
              className={`flex items-start gap-3 p-3 rounded-lg border transition-all cursor-pointer ${
                selectedRole === r.value
                  ? "border-blue-600 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-950/30"
                  : "border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
              } ${r.disabled || !canModify ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <input
                type="radio"
                name="role"
                value={r.value}
                checked={selectedRole === r.value}
                disabled={r.disabled || !canModify}
                onChange={() => setSelectedRole(r.value)}
                className="mt-1 text-blue-600 focus:ring-blue-500"
              />
              <div className="text-left">
                <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                  {r.label}
                  {r.disabled && " (Admin restricted)"}
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {r.description}
                </span>
              </div>
            </label>
          ))}
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleRoleChange}
            disabled={!canModify || selectedRole === employee.role || loading}
          >
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Role
          </Button>
        </div>
      </div>
    </div>
  );
}
