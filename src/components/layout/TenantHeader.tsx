import React from "react";
import Link from "next/link";
import { LogOut, Settings } from "lucide-react";
import { signOutAction } from "@/actions/auth-actions";
import { Button } from "@/components/ui/button";
import { OrganizationSwitcher } from "@/components/layout/OrganizationSwitcher";
import { TenantNav } from "@/components/layout/tenant-nav";
import type { Organization, AppRole, OrganizationSummary } from "@/types/auth";
import type { User } from "@supabase/supabase-js";

interface TenantHeaderProps {
  organization: Organization;
  role: AppRole;
  user: User;
  activeOrganizations?: OrganizationSummary[];
}

export function TenantHeader({
  organization,
  role,
  user,
  activeOrganizations = [],
}: TenantHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Left: Organization Switcher & Navigation */}
        <div className="flex items-center gap-6">
          <OrganizationSwitcher
            currentOrganization={organization}
            currentRole={role}
            activeOrganizations={activeOrganizations}
          />
          <TenantNav slug={organization.slug} role={role} />
        </div>

        {/* Right: Authenticated User & Actions */}
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex flex-col text-right">
            <span className="text-xs text-gray-500 dark:text-gray-400">Signed in as</span>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate max-w-[180px]">
              {user.email}
            </span>
          </div>

          <Link
            href="/settings/profile"
            className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Account Settings"
            aria-label="Account Settings"
          >
            <Settings className="h-4 w-4" />
          </Link>

          <form
            action={async () => {
              "use server";
              await signOutAction();
            }}
          >
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="gap-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
              aria-label="Sign out of account"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Sign Out</span>
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
