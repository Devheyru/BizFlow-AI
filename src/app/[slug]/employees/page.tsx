import React from "react";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { getEmployeesAction } from "@/actions/employee-actions";
import { EmployeesDirectoryClient } from "@/components/employees/EmployeesDirectoryClient";

interface EmployeesPageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Employee Directory Workspace Page (T040, FR-001, FR-002, FR-004)
 *
 * Server-rendered directory page with strict authoritative authorization guards:
 * - Requires active membership and 'employees:read' permission.
 * - Cashiers and unauthorized visitors are served HTTP 404 (via notFound()),
 *   preventing tenant discovery or directory enumeration.
 */
export default async function EmployeesPage({ params }: EmployeesPageProps) {
  const { slug } = await params;
  const context = await getTenantContext(slug);

  // Authoritative permission check (FR-002, FR-003, Principle IV)
  // Cashiers receive 404 Not Found to prevent directory discovery
  if (!hasPermission(context, "employees:read")) {
    notFound();
  }

  const result = await getEmployeesAction(slug);
  const initialEmployees = result.success ? result.data : [];

  const canInvite = hasPermission(context, "employees:invite");
  const canReadInvitations = hasPermission(context, "employees:invitations_read");

  return (
    <EmployeesDirectoryClient
      initialEmployees={initialEmployees}
      slug={slug}
      organizationId={context.organization.id}
      organizationName={context.organization.name}
      callerRole={context.role}
      callerMembershipId={context.membership.id}
      canInvite={canInvite}
      canReadInvitations={canReadInvitations}
    />
  );
}
