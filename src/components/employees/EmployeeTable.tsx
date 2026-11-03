"use client";

import React, { useState } from "react";
import type { EmployeeListItem } from "@/actions/employee-actions";
import type { AppRole } from "@/types/auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { RoleSelectorDialog } from "@/components/employees/RoleSelectorDialog";
import { StatusChangeDialog } from "@/components/employees/StatusChangeDialog";
import { MoreHorizontal, Shield, UserX, UserCheck, AlertTriangle } from "lucide-react";

interface EmployeeTableProps {
  initialEmployees: EmployeeListItem[];
  callerRole: AppRole;
  callerMembershipId: string;
  slug: string;
  organizationId: string;
}

export function EmployeeTable({
  initialEmployees,
  callerRole,
  callerMembershipId,
  slug,
  organizationId,
}: EmployeeTableProps) {
  const [employees, setEmployees] = useState<EmployeeListItem[]>(initialEmployees);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Dialog states
  const [roleModalEmployee, setRoleModalEmployee] = useState<EmployeeListItem | null>(null);
  const [statusModalEmployee, setStatusModalEmployee] = useState<{
    employee: EmployeeListItem;
    action: "suspend" | "reactivate" | "remove";
  } | null>(null);

  const canManageRoles = callerRole === "owner" || callerRole === "admin";
  const canManageStatus = callerRole === "owner" || callerRole === "admin";

  // Filter employees
  const filteredEmployees = employees.filter((emp) => {
    const fullName = `${emp.firstName} ${emp.lastName}`.toLowerCase();
    const matchesSearch =
      fullName.includes(searchQuery.toLowerCase()) ||
      emp.email.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesRole = roleFilter === "all" || emp.role === roleFilter;
    const matchesStatus = statusFilter === "all" || emp.status === statusFilter;

    return matchesSearch && matchesRole && matchesStatus;
  });

  function handleRoleUpdated(updated: EmployeeListItem) {
    setEmployees((prev) =>
      prev.map((e) => (e.membershipId === updated.membershipId ? updated : e))
    );
  }

  function handleStatusUpdated(updated: EmployeeListItem | null) {
    if (!updated) {
      // Removed: filter out
      setEmployees((prev) =>
        prev.filter((e) => e.membershipId !== statusModalEmployee?.employee.membershipId)
      );
    } else {
      setEmployees((prev) =>
        prev.map((e) => (e.membershipId === updated.membershipId ? updated : e))
      );
    }
  }

  return (
    <div className="space-y-4">
      {/* Search and Filters Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex-1 max-w-sm">
          <input
            type="text"
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex gap-2 items-center">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Filter by role"
          >
            <option value="all">All Roles</option>
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="cashier">Cashier</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Filter by status"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
      </div>

      {/* Directory Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
        <table className="w-full text-left text-sm divide-y divide-gray-200 dark:divide-gray-800">
          <thead className="bg-gray-50 dark:bg-gray-950/50 text-gray-700 dark:text-gray-300 font-medium">
            <tr>
              <th scope="col" className="px-6 py-3.5">Employee</th>
              <th scope="col" className="px-6 py-3.5">Phone</th>
              <th scope="col" className="px-6 py-3.5">Role</th>
              <th scope="col" className="px-6 py-3.5">Status</th>
              <th scope="col" className="px-6 py-3.5">Joined</th>
              {(canManageRoles || canManageStatus) && (
                <th scope="col" className="px-6 py-3.5 text-right">Actions</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
            {filteredEmployees.length === 0 ? (
              <tr>
                <td
                  colSpan={canManageRoles || canManageStatus ? 6 : 5}
                  className="px-6 py-8 text-center text-gray-500 dark:text-gray-400"
                >
                  No employees match the current filters.
                </td>
              </tr>
            ) : (
              filteredEmployees.map((emp) => {
                const isSelf = emp.membershipId === callerMembershipId;
                const isTargetOwner = emp.role === "owner";
                const isActionDisabled = isSelf || (callerRole === "admin" && isTargetOwner);

                return (
                  <tr key={emp.membershipId} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/40">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {emp.firstName} {emp.lastName}
                        {isSelf && (
                          <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                            (You)
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{emp.email}</div>
                    </td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-400">
                      {emp.phone || <span className="text-gray-400 dark:text-gray-600">None</span>}
                    </td>
                    <td className="px-6 py-4">
                      <RoleBadge role={emp.role} />
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={emp.status} />
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-500 dark:text-gray-400">
                      {new Date(emp.joinedAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    {(canManageRoles || canManageStatus) && (
                      <td className="px-6 py-4 text-right">
                        {!isActionDisabled ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <span className="sr-only">Open menu</span>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="right">
                              {canManageRoles && (
                                <DropdownMenuItem onClick={() => setRoleModalEmployee(emp)}>
                                  <Shield className="h-4 w-4 mr-2" />
                                  <span>Change Role</span>
                                </DropdownMenuItem>
                              )}
                              {canManageStatus && (
                                <>
                                  {emp.status === "active" ? (
                                    <DropdownMenuItem
                                      onClick={() =>
                                        setStatusModalEmployee({ employee: emp, action: "suspend" })
                                      }
                                    >
                                      <AlertTriangle className="h-4 w-4 mr-2 text-amber-600" />
                                      <span>Suspend Access</span>
                                    </DropdownMenuItem>
                                  ) : (
                                    <DropdownMenuItem
                                      onClick={() =>
                                        setStatusModalEmployee({ employee: emp, action: "reactivate" })
                                      }
                                    >
                                      <UserCheck className="h-4 w-4 mr-2 text-emerald-600" />
                                      <span>Reactivate Access</span>
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setStatusModalEmployee({ employee: emp, action: "remove" })
                                    }
                                    className="text-rose-600 dark:text-rose-400"
                                  >
                                    <UserX className="h-4 w-4 mr-2" />
                                    <span>Remove Employee</span>
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <span className="text-xs text-gray-400 dark:text-gray-600 italic">
                            Protected
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Role Change Modal */}
      {roleModalEmployee && (
        <RoleSelectorDialog
          isOpen={!!roleModalEmployee}
          onClose={() => setRoleModalEmployee(null)}
          employee={roleModalEmployee}
          callerRole={callerRole}
          callerMembershipId={callerMembershipId}
          slug={slug}
          organizationId={organizationId}
          onRoleUpdated={handleRoleUpdated}
        />
      )}

      {/* Status Change Modal */}
      {statusModalEmployee && (
        <StatusChangeDialog
          isOpen={!!statusModalEmployee}
          onClose={() => setStatusModalEmployee(null)}
          employee={statusModalEmployee.employee}
          actionType={statusModalEmployee.action}
          callerRole={callerRole}
          callerMembershipId={callerMembershipId}
          slug={slug}
          organizationId={organizationId}
          onStatusUpdated={handleStatusUpdated}
        />
      )}
    </div>
  );
}

function RoleBadge({ role }: { role: AppRole }) {
  const styles: Record<AppRole, string> = {
    owner: "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-200 dark:border-purple-800",
    admin: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800",
    manager: "bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300 border-teal-200 dark:border-teal-800",
    cashier: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700",
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border capitalize ${styles[role]}`}
    >
      {role}
    </span>
  );
}

function StatusBadge({ status }: { status: "active" | "suspended" | "revoked" }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
        Active
      </span>
    );
  }

  if (status === "suspended") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
        Suspended
      </span>
    );
  }

  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
      Revoked
    </span>
  );
}
