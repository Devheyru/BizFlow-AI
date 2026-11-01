import React from "react";
import type { Metadata } from "next";
import { requireWorkspaceAccess } from "@/lib/auth/guards";

interface DashboardPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: DashboardPageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: `Dashboard — ${slug} — BizFlow AI`,
  };
}

export default async function TenantDashboardPage({ params }: DashboardPageProps) {
  const { slug } = await params;
  const { currentOrg } = await requireWorkspaceAccess(slug);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="border-b border-gray-200 dark:border-gray-800 pb-5">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {currentOrg.name}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Store Workspace &bull; {currentOrg.businessType}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-5 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Your Role</span>
            <p className="mt-2 text-xl font-bold text-gray-900 dark:text-gray-100 capitalize">
              {currentOrg.role}
            </p>
          </div>

          <div className="p-5 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Currency & Country</span>
            <p className="mt-2 text-xl font-bold text-gray-900 dark:text-gray-100">
              {currentOrg.currency} &bull; {currentOrg.country}
            </p>
          </div>

          <div className="p-5 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Timezone</span>
            <p className="mt-2 text-xl font-bold text-gray-900 dark:text-gray-100 truncate">
              {currentOrg.timezone}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

