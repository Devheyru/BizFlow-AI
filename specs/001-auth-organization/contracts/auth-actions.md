# Interface Contracts: Authentication Server Actions (Corrected)

**Feature**: `001-auth-organization`  
**Revision Date**: 2026-10-30  
**Transport**: Next.js Server Actions (RPC over POST with Server-Sent Cookies)  

---

## 1. Common Types

```typescript
export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string; details?: Record<string, string[]> } };
```

---

## 2. Server Action: `signUpAction`

Registers a new user, initiates email verification, and provisions the user profile via database trigger `handle_new_user()`.

### Input Schema (Zod) - *Reconciled with FR-002 & Special Characters*
```typescript
import { z } from 'zod';

export const signUpSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address').toLowerCase(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[!@#$%^&*(),.?":{}|<>]/, 'Password must contain at least one special character or symbol'),
  firstName: z.string().trim().min(1, 'First name is required').max(50),
  lastName: z.string().trim().min(1, 'Last name is required').max(50),
  phone: z.string().trim().max(20).optional(),
  invitationToken: z.string().trim().optional(), // Preserved across signup if registering from invite
});

export type SignUpInput = z.infer<typeof signUpSchema>;
```

### Output Type
```typescript
export interface SignUpResult {
  userId: string;
  email: string;
  isEmailVerified: boolean;
  message: string;
  pendingInviteToken?: string;
}
```

### Response Behavior
- **Success (`200 OK`)**: Dispatches email confirmation with PKCE flow. If `invitationToken` is present, the email confirmation URL embeds `?next=/invitations/accept?token=${invitationToken}` to resume invitation acceptance upon confirmation.
- **Security Safeguard**: If the email is already registered, returns a generic success notice to prevent user enumeration attacks.

---

## 3. Server Action: `signInAction`

Validates credentials against Supabase Auth using secure password exchange.

### Input Schema (Zod)
```typescript
export const signInSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

export type SignInInput = z.infer<typeof signInSchema>;
```

### Output Type
```typescript
export interface SignInResult {
  userId: string;
  email: string;
  isEmailVerified: boolean;
  hasActiveOrganization: boolean;
  activeOrganizationId?: string;
  redirectUrl: string;
}
```

### Response Behavior & Routing Matrix
1. **Unverified Email**:
   - Detected via `user.email_confirmed_at === null`.
   - Returns `{ redirectUrl: "/verify-email", isEmailVerified: false }`.
2. **Verified Email, 0 Organizations**:
   - Returns `{ redirectUrl: "/onboarding/create-organization", hasActiveOrganization: false }`.
3. **Verified Email, >= 1 Organization**:
   - Resolves most recently active organization (or first active membership).
   - Sets `bizflow_active_org` cookie (as selector preference).
   - Returns `{ redirectUrl: "/[activeOrgSlug]/dashboard", hasActiveOrganization: true }`.
- **Error Codes**:
  - `INVALID_CREDENTIALS`: "Invalid email or password."
  - `ACCOUNT_LOCKED`: "Account suspended. Please contact support."

---

## 4. Server Action: `signOutAction`

Invalidates current session tokens and clears all cookies.

### Output
```typescript
export interface SignOutResult {
  redirectUrl: string; // Always "/sign-in"
}
```

---

## 5. Server Action: `requestPasswordResetAction`

Dispatches a password reset email using PKCE token exchange.

### Input Schema (Zod)
```typescript
export const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address').toLowerCase(),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
```

### Output
```typescript
export interface ForgotPasswordResult {
  message: string; // Generic notification preventing email enumeration
}
```

---

## 6. Server Action: `resetPasswordAction`

Updates password using authenticated recovery session and revokes previous sessions.

### Input Schema (Zod) - *Reconciled with FR-002 & Special Characters*
```typescript
export const resetPasswordSchema = z.object({
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Must contain at least one number')
    .regex(/[!@#$%^&*(),.?":{}|<>]/, 'Must contain at least one special character or symbol'),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
```

### Output
```typescript
export interface ResetPasswordResult {
  message: string;
  redirectUrl: string; // "/sign-in?reset=success"
}
```

### Session Revocation Guarantee
Supabase Auth automatically rotates refresh tokens upon password reset, terminating active sessions on all other devices.

---

## 7. Next.js Auth Callback Route (`/api/auth/callback/route.ts`)

Centralized exchange endpoint for PKCE confirmation and recovery codes.

### Security Guarantees
- Validates `code` via `supabase.auth.exchangeCodeForSession(code)`.
- **Strict Open Redirect Protection**:
  ```typescript
  function sanitizeRedirectUrl(target: string | null): string {
    if (!target) return '/';
    // Reject absolute URLs, scheme prefixes, protocol-relative paths, or CRLF injections
    if (target.startsWith('/') && !target.startsWith('//') && !target.includes(':') && !target.includes('\\')) {
      return target;
    }
    return '/';
  }
  ```