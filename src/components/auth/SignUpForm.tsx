"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, X, MailCheck } from "lucide-react";
import { signUpSchema, type SignUpInput } from "@/lib/validations/auth";
import { signUpAction } from "@/actions/auth-actions";
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

export function SignUpForm({ invitationToken }: { invitationToken?: string }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      email: "",
      password: "",
      firstName: "",
      lastName: "",
      phone: "",
      invitationToken: invitationToken || "",
    },
  });

  const passwordValue = watch("password") || "";

  // Password criteria indicators
  const criteria = [
    { label: "At least 8 characters", met: passwordValue.length >= 8 },
    { label: "Uppercase letter (A-Z)", met: /[A-Z]/.test(passwordValue) },
    { label: "Lowercase letter (a-z)", met: /[a-z]/.test(passwordValue) },
    { label: "At least one number (0-9)", met: /[0-9]/.test(passwordValue) },
    {
      label: "Special character or symbol",
      met: /[!@#$%^&*(),.?":{}|<>]/.test(passwordValue),
    },
  ];

  const onSubmit = async (data: SignUpInput) => {
    setServerError(null);
    setSuccessMessage(null);
    setIsPending(true);

    try {
      const result = await signUpAction(data);
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

  if (successMessage) {
    return (
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
            <MailCheck className="h-6 w-6" />
          </div>
          <CardTitle>Check your email</CardTitle>
          <CardDescription>
            We have sent a verification link to your registered email address.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="default">
            <AlertTitle>Verification Pending</AlertTitle>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter className="flex justify-center">
          <Link href="/sign-in" className="text-sm font-medium text-blue-600 hover:underline">
            Proceed to Sign In &rarr;
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>
          Get started with your retail organization workspace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {serverError && (
            <Alert variant="destructive">
              <AlertTitle>Registration Error</AlertTitle>
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="firstName" required>
                First name
              </Label>
              <Input
                id="firstName"
                placeholder="Jane"
                autoComplete="given-name"
                disabled={isPending}
                error={errors.firstName?.message}
                {...register("firstName")}
              />
              {errors.firstName && (
                <p className="text-xs text-red-500">{errors.firstName.message}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="lastName" required>
                Last name
              </Label>
              <Input
                id="lastName"
                placeholder="Doe"
                autoComplete="family-name"
                disabled={isPending}
                error={errors.lastName?.message}
                {...register("lastName")}
              />
              {errors.lastName && (
                <p className="text-xs text-red-500">{errors.lastName.message}</p>
              )}
            </div>
          </div>

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
            <Label htmlFor="password" required>
              Password
            </Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              disabled={isPending}
              error={errors.password?.message}
              {...register("password")}
            />
            {errors.password && (
              <p className="text-xs text-red-500">{errors.password.message}</p>
            )}

            {/* Visual Password Strength Checklist */}
            <div className="mt-2 rounded-md bg-gray-50 p-2 text-xs dark:bg-gray-800/60">
              <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">
                Password must include:
              </p>
              <ul className="space-y-1">
                {criteria.map((item, index) => (
                  <li
                    key={index}
                    className={`flex items-center gap-1.5 ${
                      item.met
                        ? "text-emerald-600 dark:text-emerald-400 font-medium"
                        : "text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    {item.met ? (
                      <Check className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <X className="h-3.5 w-3.5 shrink-0 opacity-40" />
                    )}
                    <span>{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="phone">Phone number (optional)</Label>
            <Input
              id="phone"
              type="tel"
              placeholder="+1 555-0123"
              autoComplete="tel"
              disabled={isPending}
              error={errors.phone?.message}
              {...register("phone")}
            />
            {errors.phone && (
              <p className="text-xs text-red-500">{errors.phone.message}</p>
            )}
          </div>

          <Button type="submit" className="w-full" isLoading={isPending}>
            Create Account
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex justify-center border-t border-gray-100 dark:border-gray-800 pt-4 text-xs text-gray-500">
        Already have an account?&nbsp;
        <Link href="/sign-in" className="font-semibold text-blue-600 hover:underline">
          Sign In
        </Link>
      </CardFooter>
    </Card>
  );
}

