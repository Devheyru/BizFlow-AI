"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateProfileSchema, type UpdateProfileInput } from "@/lib/validations/auth";
import { updateProfileAction } from "@/actions/profile-actions";
import type { UserProfile } from "@/types/auth";
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

interface ProfileFormProps {
  initialProfile: UserProfile;
}

export function ProfileForm({ initialProfile }: ProfileFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      firstName: initialProfile.firstName,
      lastName: initialProfile.lastName,
      phone: initialProfile.phone || "",
    },
  });

  const onSubmit = async (data: UpdateProfileInput) => {
    setServerError(null);
    setSuccessMessage(null);
    setIsPending(true);

    try {
      const result = await updateProfileAction(data);
      if (!result.success) {
        setServerError(result.error.message);
      } else {
        setSuccessMessage("Your profile has been updated successfully.");
        reset({
          firstName: result.data.firstName,
          lastName: result.data.lastName,
          phone: result.data.phone || "",
        });
      }
    } catch {
      setServerError("An unexpected error occurred while saving your profile.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal Information</CardTitle>
        <CardDescription>
          Update your personal details. These details are visible to teammates across your retail organizations.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {successMessage && (
            <Alert variant="success">
              <AlertTitle>Profile Updated</AlertTitle>
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>
          )}

          {serverError && (
            <Alert variant="destructive">
              <AlertTitle>Update Failed</AlertTitle>
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1">
            <Label htmlFor="email">Email address</Label>
            <div className="flex items-center gap-2">
              <Input
                id="email"
                type="email"
                value={initialProfile.email}
                disabled
                className="bg-gray-50 dark:bg-gray-800/50 cursor-not-allowed"
              />
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                Verified
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Email addresses cannot be changed directly for security reasons.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="firstName" required>
                First name
              </Label>
              <Input
                id="firstName"
                type="text"
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
                type="text"
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
            <Label htmlFor="phone">Phone number</Label>
            <Input
              id="phone"
              type="tel"
              placeholder="+1 555 123 4567"
              disabled={isPending}
              error={errors.phone?.message}
              {...register("phone")}
            />
            {errors.phone && (
              <p className="text-xs text-red-500">{errors.phone.message}</p>
            )}
            <p className="text-xs text-gray-500">
              Optional. Must be between 7 and 20 characters if provided.
            </p>
          </div>

          <div className="pt-2 flex justify-end">
            <Button
              type="submit"
              disabled={!isDirty || isPending}
              isLoading={isPending}
            >
              Save Changes
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

