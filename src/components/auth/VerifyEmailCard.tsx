"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Mail, CheckCircle2, ArrowLeft } from "lucide-react";
import { resendVerificationAction } from "@/actions/auth-actions";
import {
  Button,
  Input,
  Label,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Alert,
  AlertTitle,
  AlertDescription,
} from "@/components/ui";

export function VerifyEmailCard() {
  const searchParams = useSearchParams();
  const initialEmail = searchParams.get("email") || "";

  const [email, setEmail] = useState(initialEmail);
  const [isPending, setIsPending] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsPending(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const result = await resendVerificationAction({ email });
      if (result.success) {
        setSuccessMessage(result.data.message);
      } else {
        setErrorMessage(result.error.message);
      }
    } catch {
      setErrorMessage("Failed to resend verification email. Please try again.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
          <Mail className="h-6 w-6" />
        </div>
        <CardTitle>Verify your email</CardTitle>
        <CardDescription>
          In accordance with security requirements, you must verify your email address before accessing or creating retail workspaces.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {successMessage ? (
          <Alert variant="success">
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Email Sent</AlertTitle>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        ) : (
          <Alert variant="default">
            <AlertTitle>Action Required</AlertTitle>
            <AlertDescription>
              We sent a verification link to your email address. Please click the link to confirm your account and continue.
            </AlertDescription>
          </Alert>
        )}

        {errorMessage && (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleResend} className="space-y-3 pt-2">
          <div className="space-y-1">
            <Label htmlFor="resend-email">Didn&apos;t receive the email? Enter your address to resend:</Label>
            <Input
              id="resend-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@retailstore.com"
              disabled={isPending}
              required
            />
          </div>

          <Button type="submit" variant="outline" className="w-full" isLoading={isPending}>
            Resend Verification Email
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex justify-center border-t border-gray-100 dark:border-gray-800 pt-4 text-xs">
        <Link
          href="/sign-in"
          className="inline-flex items-center gap-1 font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Return to Sign In
        </Link>
      </CardFooter>
    </Card>
  );
}

