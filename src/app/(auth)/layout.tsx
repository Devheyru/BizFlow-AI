import React from "react";
import Link from "next/link";
import { Building2 } from "lucide-react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col justify-center bg-gray-50 dark:bg-gray-950 px-4 py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center mb-6">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 hover:opacity-90"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white shadow">
            <Building2 className="h-6 w-6" />
          </div>
          <span>BizFlow AI</span>
        </Link>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Smart Retail POS, Inventory & SaaS Platform
        </p>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {children}
      </div>

      <div className="mt-8 text-center text-xs text-gray-500 dark:text-gray-500">
        &copy; {new Date().getFullYear()} BizFlow AI. Encrypted with PostgreSQL Row-Level Security.
      </div>
    </div>
  );
}

