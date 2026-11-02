"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/validations/auth";
import { requestPasswordResetAction } from "@/actions/auth-actions";
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

export function ForgotPasswordForm() {
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
    },
  });

  const onSubmit = async (data: ForgotPasswordInput) => {
    setServerError(null);
    setSuccessMessage(null);
    setIsPending(true);

    try {
      const result = await requestPasswordResetAction(data);
      if (!result.success) {
        setServerError(result.error.message);
      } else {
        setSuccessMessage(result.data.message);
      }
    } catch {
      setServerError("An unexpected error occurred. Please try again.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>
          Enter your registered email address and we will send you a secure link to reset your password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {successMessage ? (
          <div className="space-y-4">
            <Alert variant="success">
              <AlertTitle>Check your inbox</AlertTitle>
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Did not receive the email? Check your spam folder or request a new link after a few minutes.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            {serverError && (
              <Alert variant="destructive">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1">
              <Label htmlFor="email" required>
                Email address
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="jane@retailshop.com"
                autoComplete="email"
                disabled={isPending}
                error={errors.email?.message}
                {...register("email")}
              />
              {errors.email && (
                <p className="text-xs text-red-500">{errors.email.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full" isLoading={isPending}>
              Send Reset Link
            </Button>
          </form>
        )}
      </CardContent>
      <CardFooter className="flex justify-center border-t border-gray-100 dark:border-gray-800 pt-4">
        <Link
          href="/sign-in"
          className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          Return to sign in
        </Link>
      </CardFooter>
    </Card>
  );
}

