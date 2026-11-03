"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { EmployeeTable } from "@/components/employees/EmployeeTable";
import { PendingInvitations } from "@/components/employees/PendingInvitations";
import { InviteEmployeeModal } from "@/components/employees/InviteEmployeeModal";
import type { EmployeeListItem } from "@/actions/employee-actions";
import type { AppRole } from "@/types/auth";
import { UserPlus, Users, Mail } from "lucide-react";

interface EmployeesDirectoryClientProps {
  initialEmployees: EmployeeListItem[];
  slug: string;
  organizationId: string;
  organizationName: string;
  callerRole: AppRole;
  callerMembershipId: string;
  canInvite: boolean;
  canReadInvitations: boolean;
}

export function EmployeesDirectoryClient({
  initialEmployees,
  slug,
  organizationId,
  organizationName,
  callerRole,
  callerMembershipId,
  canInvite,
  canReadInvitations,
}: EmployeesDirectoryClientProps) {
  const [activeTab, setActiveTab] = useState<"directory" | "invitations">("directory");
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteRefreshCount, setInviteRefreshCount] = useState(0);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            Workforce & Employees
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage employee access, roles, and pending invitations for {organizationName}.
          </p>
        </div>

        {canInvite && (
          <Button onClick={() => setIsInviteModalOpen(true)} className="gap-2">
            <UserPlus className="h-4 w-4" />
            <span>Invite Employee</span>
          </Button>
        )}
      </div>

      {/* Tabs */}
      {canReadInvitations && (
        <div className="flex border-b border-gray-200 dark:border-gray-800 gap-6">
          <button
            type="button"
            onClick={() => setActiveTab("directory")}
            className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2 ${
              activeTab === "directory"
                ? "border-blue-600 text-blue-600 dark:text-blue-400 font-semibold"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            <Users className="h-4 w-4" />
            <span>Active Directory</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("invitations")}
            className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2 ${
              activeTab === "invitations"
                ? "border-blue-600 text-blue-600 dark:text-blue-400 font-semibold"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            <Mail className="h-4 w-4" />
            <span>Pending Invitations</span>
          </button>
        </div>
      )}

      {/* Tab Panels */}
      {activeTab === "directory" ? (
        <EmployeeTable
          initialEmployees={initialEmployees}
          callerRole={callerRole}
          callerMembershipId={callerMembershipId}
          slug={slug}
          organizationId={organizationId}
        />
      ) : (
        <PendingInvitations
          slug={slug}
          callerRole={callerRole}
          refreshTrigger={inviteRefreshCount}
        />
      )}

      {/* Invite Modal */}
      {isInviteModalOpen && (
        <InviteEmployeeModal
          isOpen={isInviteModalOpen}
          onClose={() => setIsInviteModalOpen(false)}
          slug={slug}
          organizationId={organizationId}
          callerRole={callerRole}
          onInvitationCreated={() => {
            setInviteRefreshCount((prev) => prev + 1);
          }}
        />
      )}
    </div>
  );
}
