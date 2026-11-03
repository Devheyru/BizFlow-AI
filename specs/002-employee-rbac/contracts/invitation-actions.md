# Server Action Contracts: Employee Invitations

**Feature Branch**: `002-employee-rbac`  
**File Target**: `src/actions/invitation-actions.ts`  
**Pattern**: Next.js Server Actions returning `Promise<ActionResult<T>>`  

---

## 1. `inviteEmployeeAction`

Sends an email invitation to join the organization.

### Validation Schema
```typescript
export const inviteEmployeeSchema = z.object({
  organizationId: z.string().uuid("Invalid organization ID"),
  email: z.string().trim().email("Please enter a valid email address").toLowerCase(),
  role: z.enum(["admin", "manager", "cashier", "owner"]),
});

export type InviteEmployeeInput = z.infer<typeof inviteEmployeeSchema>;
```

### Server Flow & Invariants
1. Resolves tenant context and asserts caller holds `employees:invite` permission.
2. If caller is `admin`, rejects `role === 'owner'`.
3. Generates 32 random bytes via `crypto.randomBytes(32)` as a 64-char hex string (`rawToken`).
4. Computes SHA-256 hash: `tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')`.
5. Computes `expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)`. Stored procedure `create_organization_invitation` strictly enforces a maximum lifetime of exactly 7 days at the database RPC boundary (`now() < p_expires_at AND p_expires_at <= now() + INTERVAL '7 days'`), rejecting exceeding or past values with `P0009`.
6. Invokes stored procedure `create_organization_invitation`.
7. **External Email Dispatch**: Calls email service with `appUrl + '/invitations/accept?token=' + rawToken`.
   - If email dispatch succeeds: returns `{ success: true, data: { invitationId, email, role, expiresAt } }`.
   - If email dispatch fails: returns `{ success: true, data: { invitationId, email, role, expiresAt, warning: "EMAIL_FAILED" } }`.

---

## 2. `acceptInvitationAction`

Accepts an invitation using the authenticated user's session.

### Validation Schema
```typescript
export const acceptInvitationSchema = z.object({
  token: z.string().min(32, "Invalid invitation token"),
});

export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
```

### Server Flow & Invariants
1. Authenticates session via `supabase.auth.getUser()`.
2. Computes `tokenHash = crypto.createHash('sha256').update(input.token).digest('hex')`.
3. Invokes stored procedure `accept_organization_invitation(tokenHash)`.
4. Stored procedure enforces atomic transition, row lock (`FOR UPDATE`), email match check, and transaction-safe lazy expiration.
5. If procedure returns `{ success: false, code: "INVITATION_EXPIRED" }`: returns user-friendly error.
6. If procedure returns `{ success: false, code: "EMAIL_MISMATCH" }`: returns generic error `{ success: false, code: "EMAIL_MISMATCH", message: "The authenticated account does not match the invitation recipient." }` without exposing expected or actual email addresses to preserve recipient privacy.
7. If success: sets active organization cookie `bizflow_active_org` and returns redirect URL `/{slug}/dashboard`.

---

## 3. `declineInvitationAction`

Declines an invitation.

### Validation Schema
```typescript
export const declineInvitationSchema = z.object({
  token: z.string().min(32, "Invalid invitation token"),
});

export type DeclineInvitationInput = z.infer<typeof declineInvitationSchema>;
```

### Server Flow
1. Authenticates session via `supabase.auth.getUser()`.
2. Computes `tokenHash = crypto.createHash('sha256').update(input.token).digest('hex')`.
3. Invokes stored procedure `decline_organization_invitation(tokenHash)`.
4. If procedure returns `{ success: false, code: "EMAIL_MISMATCH" }`: returns generic error `{ success: false, code: "EMAIL_MISMATCH", message: "The authenticated account does not match the invitation recipient." }` without disclosing either email address.
5. If success: returns `{ success: true }`.

---

## 4. `resendInvitationAction`

Generates a fresh token and dispatches a new invitation email.

### Validation Schema
```typescript
export const resendInvitationSchema = z.object({
  invitationId: z.string().uuid("Invalid invitation ID"),
});

export type ResendInvitationInput = z.infer<typeof resendInvitationSchema>;
```

### Server Flow
1. Asserts caller holds `employees:invite`.
2. Generates fresh 256-bit token and SHA-256 hash, and computes `newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)`.
3. Invokes stored procedure `resend_organization_invitation(id, newHash, newExpiry)`. The stored procedure strictly enforces a maximum lifetime of exactly 7 days at the database RPC boundary (`now() < p_new_expires_at AND p_new_expires_at <= now() + INTERVAL '7 days'`), rejecting exceeding or past values with `P0009`.
4. Dispatches email outside transaction.

---

## 5. `revokeInvitationAction`

Revokes an unaccepted invitation.

### Validation Schema
```typescript
export const revokeInvitationSchema = z.object({
  invitationId: z.string().uuid("Invalid invitation ID"),
});

export type RevokeInvitationInput = z.infer<typeof revokeInvitationSchema>;
```

### Server Flow
1. Asserts caller holds `employees:invitations_revoke`.
2. Invokes stored procedure `revoke_organization_invitation(invitationId)`.
3. Returns `{ success: true }`.

---

## 6. `validateInvitationTokenAction`

Pre-flight token validation before rendering acceptance screens.

### Validation Schema
```typescript
export const validateInvitationTokenSchema = z.object({
  token: z.string().min(32, "Invalid token format"),
});

export type ValidateInvitationTokenInput = z.infer<typeof validateInvitationTokenSchema>;
```

### Server Flow & Privacy Invariants
1. Computes SHA-256 hash: `crypto.createHash('sha256').update(input.token).digest('hex')`.
2. Invokes database stored procedure `validate_invitation_token(tokenHash)`.
3. The stored procedure evaluates token validity, status, and expiration.
4. **Strict Zero-Disclosure**: Does NOT disclose organization name, organization ID, invited email, or assigned role to unauthenticated visitors, preventing token fishing or tenant metadata enumeration.
5. **Informational Only**: Pre-flight validation is strictly advisory for UI routing; authoritative validation occurs atomically under row locks in `accept_organization_invitation`.
6. Returns structured status:
```typescript
export interface ValidateInvitationTokenResult {
  isValid: boolean;
  isExpired: boolean;
  status: "pending" | "accepted" | "declined" | "revoked" | "expired" | null;
}
```

