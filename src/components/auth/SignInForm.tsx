"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signInSchema, type SignInInput } from "@/lib/validations/auth";
import { signInAction } from "@/actions/auth-actions";
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

export function SignInForm() {
  const searchParams = useSearchParams();
  const callbackError = searchParams.get("error");
  const resetSuccess = searchParams.get("reset") === "success";

  const [serverError, setServerError] = useState<string | null>(
    callbackError === "auth_callback_failed"
      ? "Authentication confirmation link was invalid or expired. Please sign in or request a new link."
      : null
  );
  const [isPending, setIsPending] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (data: SignInInput) => {
    setServerError(null);
    setIsPending(true);

    try {
      const result = await signInAction(data);
      if (!result.success) {
        setServerError(result.error.message);
        setIsPending(false);
      } else {
        // Full navigation ensures cookie updates take effect across Server Components
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
        <CardTitle>Sign in to your account</CardTitle>
        <CardDescription>
          Enter your credentials to access your retail workspace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {resetSuccess && (
            <Alert variant="success">
              <AlertTitle>Password Updated</AlertTitle>
              <AlertDescription>
                Your password has been successfully updated. Please sign in with your new credentials.
              </AlertDescription>
            </Alert>
          )}

          {serverError && (
            <Alert variant="destructive">
              <AlertTitle>Authentication Error</AlertTitle>
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

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="password" required>
                Password
              </Label>
              <Link
                href="/forgot-password"
                className="text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              disabled={isPending}
              error={errors.password?.message}
              {...register("password")}
            />
            {errors.password && (
              <p className="text-xs text-red-500">{errors.password.message}</p>
            )}
          </div>

          <Button type="submit" className="w-full" isLoading={isPending}>
            Sign In
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex justify-center border-t border-gray-100 dark:border-gray-800 pt-4 text-xs text-gray-500">
        Don&apos;t have an account?&nbsp;
        <Link href="/sign-up" className="font-semibold text-blue-600 hover:underline">
          Create Account
        </Link>
      </CardFooter>
    </Card>
  );
}

