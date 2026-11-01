import React from "react";
import type { Metadata } from "next";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { CreateOrganizationForm } from "@/components/organization/CreateOrganizationForm";
import { Building2 } from "lucide-react";

export const metadata: Metadata = {
  title: "Set Up Your Store — BizFlow AI",
  description: "Create your organization workspace to manage inventory, products, and point of sale.",
};

export default async function CreateOrganizationPage() {
  // Enforce authentication and email verification server-side
  await requireVerifiedUser();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center mb-6">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md mb-3">
          <Building2 className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          Welcome to BizFlow AI
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Every retail store operates inside an isolated, secure organization workspace.
        </p>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-2xl px-4 sm:px-0">
        <CreateOrganizationForm />
      </div>
    </div>
  );
}

