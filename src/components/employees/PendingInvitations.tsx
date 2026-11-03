"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  getPendingInvitationsAction,
  resendInvitationAction,
  revokeInvitationAction,
  type PendingInvitationItem,
} from "@/actions/invitation-actions";
import type { AppRole } from "@/types/auth";
import { Send, XCircle, RefreshCw, AlertCircle, AlertTriangle, Loader2 } from "lucide-react";

interface PendingInvitationsProps {
  slug: string;
  callerRole: AppRole;
  refreshTrigger?: number;
}

export function PendingInvitations({
  slug,
  callerRole,
  refreshTrigger,
}: PendingInvitationsProps) {
  const [invitations, setInvitations] = useState<PendingInvitationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  const canManageInvitations = callerRole === "owner" || callerRole === "admin";

  const loadInvitations = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    const res = await getPendingInvitationsAction(slug);
    setLoading(false);

    if (!res.success) {
      setErrorMessage(res.error.message);
      return;
    }

    setInvitations(res.data);
  }, [slug]);

  useEffect(() => {
    loadInvitations();
  }, [loadInvitations, refreshTrigger]);

  async function handleResend(invitationId: string) {
    setActionLoadingId(invitationId);
    setErrorMessage(null);
    setWarningMessage(null);

    const res = await resendInvitationAction(slug, { invitationId });
    setActionLoadingId(null);

    if (!res.success) {
      setErrorMessage(res.error.message);
      return;
    }

    if (res.data.warning === "EMAIL_DELIVERY_FAILED") {
      setWarningMessage(
        "Invitation token refreshed, but email dispatch failed. You can retry sending."
      );
    }

    loadInvitations();
  }

  async function handleRevoke(invitationId: string) {
    if (!window.confirm("Are you sure you want to revoke this invitation?")) {
      return;
    }

    setActionLoadingId(invitationId);
    setErrorMessage(null);
    setWarningMessage(null);

    const res = await revokeInvitationAction(slug, { invitationId });
    setActionLoadingId(null);

    if (!res.success) {
      setErrorMessage(res.error.message);
      return;
    }

    setInvitations((prev) => prev.filter((i) => i.id !== invitationId));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-gray-500">
        <Loader2 className="h-5 w-5 mr-2 animate-spin text-blue-600" />
        Loading pending invitations...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-base font-medium text-gray-900 dark:text-gray-100">
            Pending Invitations
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Invitations awaiting recipient acceptance or registration.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={loadInvitations} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Refresh
        </Button>
      </div>

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

      {invitations.length === 0 ? (
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No pending invitations. All issued invitations have been accepted or processed.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
          <table className="w-full text-left text-sm divide-y divide-gray-200 dark:divide-gray-800">
            <thead className="bg-gray-50 dark:bg-gray-950/50 text-gray-700 dark:text-gray-300 font-medium">
              <tr>
                <th scope="col" className="px-6 py-3.5">Email</th>
                <th scope="col" className="px-6 py-3.5">Role</th>
                <th scope="col" className="px-6 py-3.5">Sent</th>
                <th scope="col" className="px-6 py-3.5">Expires</th>
                {canManageInvitations && (
                  <th scope="col" className="px-6 py-3.5 text-right">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
              {invitations.map((inv) => {
                const expiresDate = new Date(inv.expiresAt);
                const isExpired = expiresDate <= new Date();
                const isWorking = actionLoadingId === inv.id;

                return (
                  <tr key={inv.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/40">
                    <td className="px-6 py-4 font-medium text-gray-900 dark:text-gray-100">
                      {inv.email}
                    </td>
                    <td className="px-6 py-4 capitalize text-gray-600 dark:text-gray-400">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 dark:border-blue-800">
                        {inv.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-500 dark:text-gray-400">
                      {new Date(inv.createdAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td className="px-6 py-4 text-xs">
                      {isExpired ? (
                        <span className="text-rose-600 dark:text-rose-400 font-medium">Expired</span>
                      ) : (
                        <span className="text-gray-600 dark:text-gray-400">
                          {expiresDate.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                    </td>
                    {canManageInvitations && (
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isWorking}
                            onClick={() => handleResend(inv.id)}
                            title="Resend invitation email"
                          >
                            {isWorking ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Send className="h-3.5 w-3.5 mr-1" />
                            )}
                            Resend
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isWorking}
                            onClick={() => handleRevoke(inv.id)}
                            className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                            title="Revoke invitation"
                          >
                            <XCircle className="h-3.5 w-3.5 mr-1" />
                            Revoke
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
