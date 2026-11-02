import React, { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { validateRecoveryAuthorization } from "@/lib/auth/recovery";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Reset Password | BizFlow AI",
  description: "Set a new secure password for your BizFlow AI account.",
};

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  let isAuthorized = false;
  if (user && session) {
    const authCheck = await validateRecoveryAuthorization(supabase, user.id, session);
    isAuthorized = authCheck.success;
  }

  if (!isAuthorized) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invalid or Expired Link</CardTitle>
          <CardDescription>
            This password reset link is invalid or has expired.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTitle>Unable to Reset Password</AlertTitle>
            <AlertDescription>
              For your security, password reset links can only be used once and expire shortly after being requested.
            </AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Link href="/forgot-password" className="w-full">
            <Button className="w-full">Request New Reset Link</Button>
          </Link>
          <Link
            href="/sign-in"
            className="text-center text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            Return to sign in
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="h-64 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
