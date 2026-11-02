import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "@/components/settings/ProfileForm";
import { ChangePasswordForm } from "@/components/settings/ChangePasswordForm";
import type { UserProfile } from "@/types/auth";

export const metadata: Metadata = {
  title: "Profile & Settings | BizFlow AI",
  description: "Manage your personal account profile, contact details, and password security.",
};

export default async function ProfileSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/sign-in?next=/settings/profile");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, phone, created_at, updated_at")
    .eq("id", user.id)
    .single();

  const userProfile: UserProfile = {
    id: user.id,
    email: user.email || "",
    firstName: profile?.first_name || (user.user_metadata?.first_name as string) || "",
    lastName: profile?.last_name || (user.user_metadata?.last_name as string) || "",
    phone: profile?.phone || null,
    isEmailVerified: !!user.email_confirmed_at,
    createdAt: profile?.created_at || user.created_at,
    updatedAt: profile?.updated_at || user.updated_at || user.created_at,
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Navigation & Header */}
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 mb-4 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            Account Settings
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Manage your personal profile, contact information, and security preferences.
          </p>
        </div>

        {/* Profile Details Form */}
        <div className="space-y-6">
          <ProfileForm initialProfile={userProfile} />
          <ChangePasswordForm />
        </div>
      </div>
    </div>
  );
}

