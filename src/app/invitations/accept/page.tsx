import React from "react";
import { createClient } from "@/lib/supabase/server";
import { validateInvitationTokenAction } from "@/actions/invitation-actions";
import { AcceptInvitationCard } from "@/components/invitations/AcceptInvitationCard";

interface InvitationAcceptancePageProps {
  searchParams: Promise<{ token?: string }>;
}

/**
 * Public Invitation Acceptance Route (T045, FR-016 to FR-023)
 *
 * Privacy Invariants:
 * - Pre-flight token validation is informational only and zero-disclosure.
 * - Hides all organization and role metadata until authenticated acceptance.
 * - Enforces generic EMAIL_MISMATCH message without disclosing addresses.
 */
export default async function InvitationAcceptancePage({
  searchParams,
}: InvitationAcceptancePageProps) {
  const { token } = await searchParams;

  let isValidToken = false;
  let isExpired = false;
  let tokenStatus: string | null = null;

  if (typeof token === "string" && token.length >= 32) {
    const valRes = await validateInvitationTokenAction({ token });
    if (valRes.success) {
      isValidToken = valRes.data.isValid;
      isExpired = valRes.data.isExpired;
      tokenStatus = valRes.data.status;
    }
  }

  // Check if a user is currently signed in
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen flex flex-col justify-center items-center bg-gray-50 dark:bg-gray-950 px-4 py-12">
      <div className="w-full max-w-md mb-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          BizFlow AI
        </h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Modern Multi-Tenant Retail Workspace
        </p>
      </div>

      <AcceptInvitationCard
        token={typeof token === "string" ? token : ""}
        currentUserEmail={user?.email || null}
        isValidToken={isValidToken}
        isExpired={isExpired}
        tokenStatus={tokenStatus}
      />
    </div>
  );
}
