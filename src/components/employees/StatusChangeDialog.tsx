"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  updateMemberStatusAction,
  removeMemberAction,
  type EmployeeListItem,
} from "@/actions/employee-actions";
import type { AppRole } from "@/types/auth";
import { AlertTriangle, UserX, UserCheck, AlertCircle, Loader2 } from "lucide-react";

interface StatusChangeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  employee: EmployeeListItem;
  actionType: "suspend" | "reactivate" | "remove";
  callerRole: AppRole;
  callerMembershipId: string;
  slug: string;
  organizationId: string;
  onStatusUpdated: (updated: EmployeeListItem | null) => void;
}

export function StatusChangeDialog({
  isOpen,
  onClose,
  employee,
  actionType,
  callerRole,
  callerMembershipId,
  slug,
  organizationId,
  onStatusUpdated,
}: StatusChangeDialogProps) {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const isSelf = callerMembershipId === employee.membershipId;
  const isTargetOwner = employee.role === "owner";
  const isAdminCaller = callerRole === "admin";
  const isBlocked = isSelf || (isAdminCaller && isTargetOwner);

  const dialogConfig = {
    suspend: {
      title: "Suspend Employee Access",
      icon: AlertTriangle,
      iconColor: "text-amber-600 dark:text-amber-400",
      description: `Suspending ${employee.firstName} ${employee.lastName} will immediately lock them out of all organization resources on their next request. Their historical records and activity will remain intact.`,
      confirmLabel: "Suspend Employee",
      confirmVariant: "default" as const,
    },
    reactivate: {
      title: "Reactivate Employee Access",
      icon: UserCheck,
      iconColor: "text-emerald-600 dark:text-emerald-400",
      description: `Reactivating ${employee.firstName} ${employee.lastName} will immediately restore their access to the organization with their current role (${employee.role}).`,
      confirmLabel: "Reactivate Employee",
      confirmVariant: "default" as const,
    },
    remove: {
      title: "Remove Employee from Organization",
      icon: UserX,
      iconColor: "text-rose-600 dark:text-rose-400",
      description: `Removing ${employee.firstName} ${employee.lastName} will permanently revoke their access to this organization. Removal is terminal and cannot be directly undone. Their global account and memberships in other organizations will remain unaffected.`,
      confirmLabel: "Remove Employee",
      confirmVariant: "destructive" as const,
    },
  }[actionType];

  const Icon = dialogConfig.icon;

  async function handleConfirm() {
    if (isBlocked) return;

    setLoading(true);
    setErrorMessage(null);

    if (actionType === "remove") {
      const res = await removeMemberAction(slug, {
        organizationId,
        membershipId: employee.membershipId,
      });

      setLoading(false);
      if (!res.success) {
        setErrorMessage(res.error.message);
        return;
      }
      onStatusUpdated(null); // Removed from directory
      onClose();
    } else {
      const newStatus = actionType === "suspend" ? "suspended" : "active";
      const res = await updateMemberStatusAction(slug, {
        organizationId,
        membershipId: employee.membershipId,
        status: newStatus,
      });

      setLoading(false);
      if (!res.success) {
        setErrorMessage(res.error.message);
        return;
      }
      onStatusUpdated({
        ...employee,
        status: res.data.status,
      });
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="status-dialog-title"
    >
      <div className="w-full max-w-md rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Icon className={`h-5 w-5 ${dialogConfig.iconColor}`} aria-hidden="true" />
          <h2 id="status-dialog-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {dialogConfig.title}
          </h2>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400">
          {dialogConfig.description}
        </p>

        {isTargetOwner && (
          <div className="flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-950/50 p-3 text-xs text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>
              This employee is an Owner. The action will be rejected if it would leave the organization without any active Owners.
            </span>
          </div>
        )}

        {isSelf && (
          <div className="flex items-center gap-2 rounded-md bg-rose-50 dark:bg-rose-950/50 p-3 text-xs text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>You cannot modify your own membership status.</span>
          </div>
        )}

        {isAdminCaller && isTargetOwner && (
          <div className="flex items-center gap-2 rounded-md bg-rose-50 dark:bg-rose-950/50 p-3 text-xs text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>Admins cannot modify or remove an Owner.</span>
          </div>
        )}

        {errorMessage && (
          <div className="flex items-center gap-2 rounded-md bg-rose-50 dark:bg-rose-950/50 p-3 text-xs text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={dialogConfig.confirmVariant}
            onClick={handleConfirm}
            disabled={isBlocked || loading}
          >
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {dialogConfig.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
