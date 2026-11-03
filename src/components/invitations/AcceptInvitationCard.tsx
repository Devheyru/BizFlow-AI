"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  acceptInvitationAction,
  declineInvitationAction,
} from "@/actions/invitation-actions";
import {
  Mail,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  UserCheck,
  Loader2,
  LogIn,
} from "lucide-react";

interface AcceptInvitationCardProps {
  token: string;
  currentUserEmail: string | null;
  isValidToken: boolean;
  isExpired: boolean;
  tokenStatus: string | null;
}

export function AcceptInvitationCard({
  token,
  currentUserEmail,
  isValidToken,
  isExpired,
  tokenStatus,
}: AcceptInvitationCardProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [emailMismatch, setEmailMismatch] = useState(false);
  const [isDeclined, setIsDeclined] = useState(false);

  // 1. Invalid link
  if (!isValidToken && !isExpired && !tokenStatus) {
    return (
      <div className="w-full max-w-md rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-md p-6 sm:p-8 text-center space-y-4">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400">
          <XCircle className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          Invalid Invitation Link
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          This invitation link is invalid or incomplete. Please check the URL or request a new invitation from your organization administrator.
        </p>
        <div className="pt-2">
          <Link href="/sign-in">
            <Button variant="outline" className="w-full">
              Go to Sign In
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // 2. Expired link
  if (isExpired || tokenStatus === "expired") {
    return (
      <div className="w-full max-w-md rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-md p-6 sm:p-8 text-center space-y-4">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400">
          <Clock className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          Invitation Expired
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Invitations expire automatically after 7 days for security. Please ask your organization administrator to resend the invitation.
        </p>
        <div className="pt-2">
          <Link href="/sign-in">
            <Button variant="outline" className="w-full">
              Go to Sign In
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // 3. Already accepted
  if (tokenStatus === "accepted") {
    return (
      <div className="w-full max-w-md rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-md p-6 sm:p-8 text-center space-y-4">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          Already Accepted
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          This invitation has already been accepted. You can access your workspace from the dashboard.
        </p>
        <div className="pt-2">
          <Link href="/sign-in">
            <Button className="w-full">Go to Workspace</Button>
          </Link>
        </div>
      </div>
    );
  }

  // 4. Declined or revoked
  if (tokenStatus === "declined" || tokenStatus === "revoked" || isDeclined) {
    return (
      <div className="w-full max-w-md rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-md p-6 sm:p-8 text-center space-y-4">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
          <XCircle className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          {isDeclined ? "Invitation Declined" : "Invitation Inactive"}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {isDeclined
            ? "You have declined this organization invitation."
            : "This invitation is no longer active."}
        </p>
        <div className="pt-2">
          <Link href="/sign-in">
            <Button variant="outline" className="w-full">
              Return to Sign In
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // 5. Unauthenticated user prompt
  if (!currentUserEmail) {
    const returnUrl = `/invitations/accept?token=${token}`;
    return (
      <div className="w-full max-w-md rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-md p-6 sm:p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
            <Mail className="h-6 w-6" aria-hidden="true" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            Join Organization
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            You have been invited to join an organization on BizFlow AI. Please sign in or register with your invited email address to accept.
          </p>
        </div>

        <div className="space-y-3">
          <Link href={`/sign-in?returnTo=${encodeURIComponent(returnUrl)}`} className="w-full block">
            <Button className="w-full gap-2">
              <LogIn className="h-4 w-4" />
              <span>Sign In with Invited Email</span>
            </Button>
          </Link>

          <Link href={`/sign-up?pendingInviteToken=${token}`} className="w-full block">
            <Button variant="outline" className="w-full gap-2">
              <UserCheck className="h-4 w-4" />
              <span>Create New Account</span>
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // 6. Authenticated decision prompt
  async function handleAccept() {
    setLoading(true);
    setErrorMessage(null);
    setEmailMismatch(false);

    const res = await acceptInvitationAction({ token });
    setLoading(false);

    if (!res.success) {
      if (res.error.code === "EMAIL_MISMATCH") {
        setEmailMismatch(true);
      } else {
        setErrorMessage(res.error.message);
      }
      return;
    }

    // Redirect to tenant workspace
    router.push(res.data.redirectUrl);
  }

  async function handleDecline() {
    if (!window.confirm("Are you sure you want to decline this invitation?")) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setEmailMismatch(false);

    const res = await declineInvitationAction({ token });
    setLoading(false);

    if (!res.success) {
      if (res.error.code === "EMAIL_MISMATCH") {
        setEmailMismatch(true);
      } else {
        setErrorMessage(res.error.message);
      }
      return;
    }

    setIsDeclined(true);
  }

  return (
    <div className="w-full max-w-md rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-md p-6 sm:p-8 space-y-6">
      <div className="text-center space-y-2">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
          <Mail className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          Accept Organization Invitation
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          You are currently signed in as{" "}
          <strong className="text-gray-900 dark:text-gray-100">{currentUserEmail}</strong>.
        </p>
      </div>

      {emailMismatch && (
        <div className="rounded-md bg-amber-50 dark:bg-amber-950/50 p-4 border border-amber-200 dark:border-amber-800 space-y-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-900 dark:text-amber-200 space-y-1">
              <p className="font-semibold">Account Mismatch</p>
              <p>
                The signed-in account does not match the invitation recipient email. For privacy and security, you must sign in with the specific email address that was invited.
              </p>
            </div>
          </div>
          <Link
            href={`/sign-in?returnTo=${encodeURIComponent(`/invitations/accept?token=${token}`)}`}
            className="block"
          >
            <Button variant="outline" size="sm" className="w-full text-xs">
              Switch Account
            </Button>
          </Link>
        </div>
      )}

      {errorMessage && (
        <div className="rounded-md bg-rose-50 dark:bg-rose-950/50 p-3 text-xs text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
          {errorMessage}
        </div>
      )}

      <div className="space-y-3 pt-2">
        <Button onClick={handleAccept} disabled={loading} className="w-full">
          {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Accept Invitation
        </Button>

        <Button
          variant="outline"
          onClick={handleDecline}
          disabled={loading}
          className="w-full text-gray-600 hover:text-gray-900 dark:text-gray-400"
        >
          Decline
        </Button>
      </div>
    </div>
  );
}
