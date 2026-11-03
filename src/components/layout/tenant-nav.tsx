"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users } from "lucide-react";
import type { AppRole } from "@/types/auth";

interface TenantNavProps {
  slug: string;
  role: AppRole;
}

/**
 * Tenant Navigation Bar (T045, FR-001)
 * Displays navigation links for the active tenant workspace.
 * Gated by role: employees tab is shown only for Owner, Admin, and Manager.
 */
export function TenantNav({ slug, role }: TenantNavProps) {
  const pathname = usePathname();
  const canViewEmployees = role === "owner" || role === "admin" || role === "manager";

  const navItems = [
    {
      name: "Dashboard",
      href: `/${slug}/dashboard`,
      icon: LayoutDashboard,
      active: pathname === `/${slug}/dashboard`,
    },
    ...(canViewEmployees
      ? [
          {
            name: "Employees",
            href: `/${slug}/employees`,
            icon: Users,
            active: pathname.startsWith(`/${slug}/employees`),
          },
        ]
      : []),
  ];

  return (
    <nav className="flex items-center gap-1 sm:gap-2" aria-label="Tenant Navigation">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              item.active
                ? "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 font-semibold"
                : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span>{item.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}
