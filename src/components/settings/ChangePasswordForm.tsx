"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { changePasswordSchema, type ChangePasswordInput } from "@/lib/validations/auth";
import { changePasswordAction } from "@/actions/profile-actions";
import {
  Button,
  Input,
  Label,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Alert,
  AlertTitle,
  AlertDescription,
} from "@/components/ui";

export function ChangePasswordForm() {
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (data: ChangePasswordInput) => {
    setServerError(null);
    setSuccessMessage(null);
    setWarningMessage(null);
    setIsPending(true);

    try {
      const result = await changePasswordAction(data);
      if (!result.success) {
        setServerError(result.error.message);
      } else {
        setSuccessMessage(result.data.message);
        if (result.data.warning) {
          setWarningMessage(result.data.warning);
        }
        reset();
      }
    } catch {
      setServerError("An unexpected error occurred while updating your password.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change Password</CardTitle>
        <CardDescription>
          Ensure your account uses a strong, unique password to prevent unauthorized access.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {successMessage && (
            <Alert variant="success">
              <AlertTitle>Password Changed</AlertTitle>
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>
          )}

          {warningMessage && (
            <Alert variant="warning">
              <AlertTitle>Session Notice</AlertTitle>
              <AlertDescription>{warningMessage}</AlertDescription>
            </Alert>
          )}

          {serverError && (
            <Alert variant="destructive">
              <AlertTitle>Password Change Failed</AlertTitle>
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1">
            <Label htmlFor="currentPassword" required>
              Current Password
            </Label>
            <Input
              id="currentPassword"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              disabled={isPending}
              error={errors.currentPassword?.message}
              {...register("currentPassword")}
            />
            {errors.currentPassword && (
              <p className="text-xs text-red-500">{errors.currentPassword.message}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          </div>

          <div className="rounded-md bg-gray-50 dark:bg-gray-800/50 p-3 text-xs text-gray-600 dark:text-gray-400">
            <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">
              Complexity requirements:
            </p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>At least 8 characters</li>
              <li>At least one uppercase and one lowercase letter</li>
              <li>At least one number</li>
              <li>At least one symbol (!@#$%^&amp;*(),.?&quot;:{}|&lt;&gt;)</li>
              <li>Must be different from your current password</li>
            </ul>
          </div>

          <div className="pt-2 flex justify-end">
            <Button type="submit" isLoading={isPending}>
              Update Password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

