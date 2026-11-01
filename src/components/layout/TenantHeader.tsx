import React from "react";
import { LogOut } from "lucide-react";
import { signOutAction } from "@/actions/auth-actions";
import { Button } from "@/components/ui/button";
import { OrganizationSwitcher } from "@/components/layout/OrganizationSwitcher";
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Left: Organization Switcher & Branding */}
        <div className="flex items-center gap-3">
          <OrganizationSwitcher
            currentOrganization={organization}
            currentRole={role}
            activeOrganizations={activeOrganizations}
          />
        </div>

        {/* Right: Authenticated User & Actions */}
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex flex-col text-right">
            <span className="text-xs text-gray-500 dark:text-gray-400">Signed in as</span>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate max-w-[180px]">
              {user.email}
            </span>
          </div>

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


