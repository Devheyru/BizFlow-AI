# Interface Contracts: Organization Server Actions (Hardened Architecture)

**Feature**: `001-auth-organization`  
**Revision Date**: 2026-10-30 (Pass 4)  
**Transport**: Next.js Server Actions (RPC over POST with Server-Sent Cookies)  

---

## 1. Common Types

```typescript
export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string; details?: Record<string, string[]> } };
```

---

## 2. Server Action: `createOrganizationAction`

Atomically provisions a new organization tenant and assigns the authenticated, email-verified user as `owner`. Enforces idempotency bound to the authenticated creator.

### Input Schema (Zod) - *Strict ISO & Creator-Bound Idempotency*
```typescript
import { z } from 'zod';

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, 'Organization name must be at least 2 characters').max(100),
  businessType: z.string().trim().min(2, 'Business type is required').max(50),
  country: z
    .string()
    .trim()
    .length(2, 'Country must be a 2-letter uppercase ISO 3166-1 alpha-2 code')
    .regex(/^[A-Z]{2}$/, 'Country code must be exactly two uppercase letters')
    .toUpperCase(),
  currency: z
    .string()
    .trim()
    .length(3, 'Currency must be a 3-letter uppercase ISO 4217 code')
    .regex(/^[A-Z]{3}$/, 'Currency code must be exactly three uppercase letters')
    .toUpperCase(),
  timezone: z.string().trim().min(1, 'Timezone is required'),
  clientMutationId: z.string().uuid('Invalid client mutation identifier').optional(),
  taxId: z.string().trim().max(50).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email('Invalid business contact email').optional().or(z.literal('')),
  address: z.string().trim().max(255).optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
```

### Output Type
```typescript
export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  businessType: string;
  country: string;
  currency: string;
  timezone: string;
  role: 'owner' | 'admin' | 'manager' | 'cashier';
  isActive: boolean;
  isIdempotentReplay: boolean;
  redirectUrl: string;
}
```

---

## 3. Server Action: `switchOrganizationAction`

Switches the active store selector preference in the user's session cookie after validating active membership.

### Input Schema (Zod)
```typescript
export const switchOrganizationSchema = z.object({
  organizationId: z.string().uuid('Invalid organization identifier'),
});

export type SwitchOrganizationInput = z.infer<typeof switchOrganizationSchema>;
```

---

## 4. Server Action: `inviteMemberAction`

Creates a pending invitation with a SHA-256 hashed token. Only Owners and Admins may invite; Owner role cannot be assigned.

### Input Schema (Zod)
```typescript
export const inviteMemberSchema = z.object({
  organizationId: z.string().uuid('Invalid organization ID'),
  email: z.string().trim().email('Valid email is required').toLowerCase(),
  role: z.enum(['admin', 'manager', 'cashier'], {
    errorMap: () => ({ message: 'Invited role must be Admin, Manager, or Cashier' }),
  }),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
```

### Output Type
```typescript
export interface InvitationSummary {
  invitationId: string;
  email: string;
  role: 'admin' | 'manager' | 'cashier';
  expiresAt: string;
  message: string;
}
```

---

## 5. Server Action: `acceptInvitationAction`

Validates and claims an invitation atomically via `accept_organization_invitation()`.

### Input Schema (Zod)
```typescript
export const acceptInvitationSchema = z.object({
  token: z.string().trim().min(32, 'Invalid invitation token format'),
});

export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
```

### Output Type
```typescript
export interface AcceptInvitationResult {
  organizationId: string;
  name: string;
  slug: string;
  role: string;
  redirectUrl: string;
}
```

### Error Code Mapping
- `ALREADY_ACCEPTED`: "This invitation has already been accepted."
- `INVITATION_REVOKED`: "This invitation was revoked by management."
- `INVITATION_DECLINED`: "This invitation was previously declined."
- `ALREADY_EXPIRED` / `INVITATION_EXPIRED`: "This invitation has expired." (Status committed).
- `EMAIL_MISMATCH`: "This invitation was sent to a different email address."
- `ALREADY_ACTIVE_MEMBER`: "You are already an active member of this organization. Role was not modified."
- `ACCOUNT_SUSPENDED`: "Your membership in this organization is suspended. Please contact the store owner."
- `ORGANIZATION_CLOSED`: "This organization is no longer active."

---

## 6. Server Action: `transferOwnershipAction`

Transfers organization ownership using promote-before-demote ordering under an exclusive organization lock.

### Input Schema (Zod)
```typescript
export const transferOwnershipSchema = z.object({
  organizationId: z.string().uuid('Invalid organization ID'),
  newOwnerUserId: z.string().uuid('Invalid user ID'),
});

export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;
```

### Authorization
- Caller must be authenticated with a verified email.
- Organization must be active (`is_active = true`).
- Caller must be the active Owner.
- Same-user no-op only returned AFTER full authorization verification.
- Records `ownership.transferred` audit event.

---

## 7. Server Action: `updateMemberRoleAction`

Updates a member's role via `public.update_member_role()`. Direct client UPDATE on memberships is blocked by RLS.

### Input Schema (Zod)
```typescript
export const updateMemberRoleSchema = z.object({
  organizationId: z.string().uuid('Invalid organization ID'),
  targetUserId: z.string().uuid('Invalid user ID'),
  newRole: z.enum(['admin', 'manager', 'cashier'], {
    errorMap: () => ({ message: 'Role must be Admin, Manager, or Cashier' }), // Cannot assign Owner
  }),
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
```

---

## 8. Server Action: `updateMemberStatusAction`

Suspends or revokes a member's access via `public.update_member_status()`.

### Input Schema (Zod)
```typescript
export const updateMemberStatusSchema = z.object({
  organizationId: z.string().uuid('Invalid organization ID'),
  targetUserId: z.string().uuid('Invalid user ID'),
  newStatus: z.enum(['active', 'suspended', 'revoked']),
});

export type UpdateMemberStatusInput = z.infer<typeof updateMemberStatusSchema>;
```

---

## 9. Server Action: `removeMemberAction`

Permanently removes a member from the organization via `public.remove_member()`. Only Owners can execute.

### Input Schema (Zod)
```typescript
export const removeMemberSchema = z.object({
  organizationId: z.string().uuid('Invalid organization ID'),
  targetUserId: z.string().uuid('Invalid user ID'),
});

export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;
```

### Authorization
- Caller must be authenticated with a verified email.
- Organization must be active (`is_active = true`).
- Caller must be the active Owner.
- Target must NOT be an Owner (ownership changes require `transferOwnershipAction`).
- Records `member.removed` audit event.

---

## 10. Server Action: `closeOrganizationAction`

Soft-closes an organization via `public.close_organization()`. Only the verified Owner can execute.

### Input Schema (Zod)
```typescript
export const closeOrganizationSchema = z.object({
  organizationId: z.string().uuid('Invalid organization ID'),
  confirmationName: z.string().trim().min(1, 'Please confirm by typing the store name'),
});

export type CloseOrganizationInput = z.infer<typeof closeOrganizationSchema>;
```

### Execution Flow & Audit Guarantees
- Calls `public.close_organization(organizationId, confirmationName)`.
- Validates authentication, email verification, and organization active status.
- Database locks the organization row.
- Sets `is_active = false`, `closed_at = now()`, `closed_by = auth.uid()`.
- Revokes all pending invitations atomically.
- Records `organization.closed` audit event with confirmation name and timestamp.
- Clears `bizflow_active_org` cookie.


---

## 11. Server Action: `revokeInvitationAction`

Revokes a pending invitation via `public.revoke_invitation()`. Only Owners and Admins can execute. Direct client `UPDATE` on invitations is denied by RLS.

### Input Schema (Zod)
```typescript
export const revokeInvitationSchema = z.object({
  invitationId: z.string().uuid('Invalid invitation ID'),
});

export type RevokeInvitationInput = z.infer<typeof revokeInvitationSchema>;
```

### Output Type
```typescript
export interface RevokeInvitationResult {
  invitationId: string;
  organizationId: string;
  email: string;
  status: 'revoked';
}
```

### Authorization
- Caller must be authenticated with a verified email.
- Caller must be an active Owner or Admin of the invitation's organization.
- Organization must be active (`is_active = true`).
- Invitation must be in `pending` status.

### Error Codes
- `P0003`: Authentication required.
- `P0001`: Email verification required.
- `P0015`: Organization not found or inactive.
- `P0004`: Insufficient permissions (not Owner/Admin).
- `P0016`: Invitation is not in a revocable state.
- `P0013`: Invitation not found.
