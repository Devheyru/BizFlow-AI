import React from "react";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { TenantHeader } from "@/components/layout/TenantHeader";

interface TenantLayoutProps {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

/**
 * Tenant Workspace Layout (T038, Feature 003 T027).
 *
 * Resolves tenant context on the server via `getTenantContext()` before rendering
 * workspace content. Rejects unauthorized access with HTTP 404 (via notFound()),
 * preventing tenant existence disclosure.
 *
 * Evaluates authoritative `products:read` permission on the server and passes
 * `canViewProducts` to TenantHeader for navigation gating.
 */
export default async function TenantLayout({ children, params }: TenantLayoutProps) {
  const { slug } = await params;
  const context = await getTenantContext(slug);
  const canViewProducts = hasPermission(context, "products:read");

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <TenantHeader
        organization={context.organization}
        role={context.role}
        user={context.user}
        activeOrganizations={context.activeOrganizations}
        canViewProducts={canViewProducts}
      />
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}

