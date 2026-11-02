"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/validations/auth";
import { resetPasswordAction } from "@/actions/auth-actions";
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

export function ResetPasswordForm() {
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      newPassword: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (data: ResetPasswordInput) => {
    setServerError(null);
    setIsPending(true);

    try {
      const result = await resetPasswordAction(data);
      if (!result.success) {
        setServerError(result.error.message);
        setIsPending(false);
      } else {
        window.location.href = result.data.redirectUrl;
      }
    } catch {
      setServerError("An unexpected error occurred. Please try again.");
      setIsPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create new password</CardTitle>
        <CardDescription>
          Enter your new password below. It must be at least 8 characters and include uppercase, lowercase, numbers, and symbols.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {serverError && (
            <Alert variant="destructive">
              <AlertTitle>Reset Failed</AlertTitle>
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1">
            <Label htmlFor="newPassword" required>
              New Password
            </Label>
            <Input
              id="newPassword"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              disabled={isPending}
              error={errors.newPassword?.message}
              {...register("newPassword")}
            />
            {errors.newPassword && (
              <p className="text-xs text-red-500">{errors.newPassword.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="confirmPassword" required>
              Confirm New Password
            </Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              disabled={isPending}
              error={errors.confirmPassword?.message}
              {...register("confirmPassword")}
            />
            {errors.confirmPassword && (
              <p className="text-xs text-red-500">{errors.confirmPassword.message}</p>
            )}
          </div>

          <div className="rounded-md bg-gray-50 dark:bg-gray-800/50 p-3 text-xs text-gray-600 dark:text-gray-400">
            <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">
              Password requirements:
            </p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>Minimum 8 characters</li>
              <li>At least one uppercase letter (A-Z)</li>
              <li>At least one lowercase letter (a-z)</li>
              <li>At least one number (0-9)</li>
              <li>At least one symbol (!@#$%^&amp;*(),.?&quot;:{}|&lt;&gt;)</li>
            </ul>
          </div>

          <Button type="submit" className="w-full" isLoading={isPending}>
            Update Password
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex justify-center border-t border-gray-100 dark:border-gray-800 pt-4">
        <Link
          href="/sign-in"
          className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          Cancel and return to sign in
        </Link>
      </CardFooter>
    </Card>
  );
}

