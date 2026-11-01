import React from "react";
import Link from "next/link";
import { Store, LogOut, Shield } from "lucide-react";
import { signOutAction } from "@/actions/auth-actions";
import { Button } from "@/components/ui/button";
import type { Organization, AppRole, OrganizationSummary } from "@/types/auth";
import type { User } from "@supabase/supabase-js";

interface TenantHeaderProps {
  organization: Organization;
  role: AppRole;
  user: User;
  activeOrganizations?: OrganizationSummary[];
}

const ROLE_BADGE_STYLES: Record<AppRole, { label: string; className: string }> = {
  owner: {
    label: "Owner",
    className: "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-200 dark:border-purple-800",
  },
  admin: {
    label: "Admin",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  },
  manager: {
    label: "Manager",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
  },
  cashier: {
    label: "Cashier",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  },
};

export function TenantHeader({ organization, role, user }: TenantHeaderProps) {
  const badge = ROLE_BADGE_STYLES[role] || {
    label: role,
    className: "bg-gray-100 text-gray-800 border-gray-200",
  };

  return (
    <header className="sticky top-0 z-30 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Left: Organization Branding */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
            <Store className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <Link
                href={`/${organization.slug}/dashboard`}
                className="font-bold text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-base sm:text-lg"
              >
                {organization.name}
              </Link>
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${badge.className}`}
                aria-label={`Your role: ${badge.label}`}
              >
                <Shield className="h-3 w-3" aria-hidden="true" />
                <span>{badge.label}</span>
              </span>
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {organization.business_type} â€¢ {organization.country}
            </span>
          </div>
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

