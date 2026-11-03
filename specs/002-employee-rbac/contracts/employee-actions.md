# Server Action Contracts: Employee Management

**Feature Branch**: `002-employee-rbac`  
**File Target**: `src/actions/employee-actions.ts`  
**Pattern**: Next.js Server Actions returning `Promise<ActionResult<T>>`  

---

## 1. `getEmployeesAction`

Retrieves the employee directory for the active organization.

### Input
```typescript
export interface GetEmployeesInput {
  organizationId: string;
}
```

### Authorization Gate
- Resolves tenant context via `resolveTenantContext(slug)`.
- Verifies caller holds `employees:read` permission (`hasPermission(context, 'employees:read')`).

### Output
```typescript
export interface EmployeeListItem {
  membershipId: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  role: "owner" | "admin" | "manager" | "cashier";
  status: "active" | "suspended" | "revoked";
  joinedAt: string;
}

export type GetEmployeesResult = EmployeeListItem[];
```

---

## 2. `updateMemberRoleAction`

Updates an employee's assigned system role.

### Validation Schema
```typescript
export const updateMemberRoleSchema = z.object({
  organizationId: z.string().uuid("Invalid organization ID"),
  membershipId: z.string().uuid("Invalid membership ID"),
  newRole: z.enum(["owner", "admin", "manager", "cashier"]),
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
```

### Authorization & Invariants
- Caller must possess `employees:update_role`.
- Caller cannot change their own role.
- If caller is `admin`, rejects promotion to `owner` or demotion of an `owner`.
- Target membership must NOT be in `revoked` status. Revoked memberships are terminal in Feature 002; attempts to modify role reject with error `P0025` ("Cannot modify a revoked membership").
- Invokes stored procedure `update_organization_member_role`.

### Output
```typescript
export interface UpdateMemberRoleResult {
  membershipId: string;
  previousRole: string;
  newRole: string;
  updatedAt: string;
}
```

---

## 3. `updateMemberStatusAction`

Suspends or reactivates an employee membership.

### Validation Schema
```typescript
export const updateMemberStatusSchema = z.object({
  organizationId: z.string().uuid("Invalid organization ID"),
  membershipId: z.string().uuid("Invalid membership ID"),
  status: z.enum(["active", "suspended"]),
});

export type UpdateMemberStatusInput = z.infer<typeof updateMemberStatusSchema>;
```

### Permitted Status Transitions
- `active` $\rightarrow$ `suspended` (Suspension)
- `suspended` $\rightarrow$ `active` (Reactivation)
- *Note*: Transitions to `revoked` are handled via `removeMemberAction`. Revoked status is strictly terminal; attempting to reactivate or modify a revoked membership is rejected with error `P0025`.

### Authorization & Invariants
- Caller must possess `employees:suspend`.
- Caller cannot suspend or reactivate themselves.
- Last active Owner cannot be suspended (enforced by `check_owner_invariant` database trigger with error `P0002`).
- Target membership must NOT be in `revoked` status (error `P0025`).
- Invokes stored procedure `update_organization_member_status`.

### Output
```typescript
export interface UpdateMemberStatusResult {
  membershipId: string;
  previousStatus: "active" | "suspended";
  newStatus: "active" | "suspended";
  updatedAt: string;
}
```

---

## 4. `removeMemberAction`

Removes an employee from an organization (soft revocation).

### Validation Schema
```typescript
export const removeMemberSchema = z.object({
  organizationId: z.string().uuid("Invalid organization ID"),
  membershipId: z.string().uuid("Invalid membership ID"),
});

export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;
```

### Permitted Status Transitions
- `active` $\rightarrow$ `revoked`
- `suspended` $\rightarrow$ `revoked`
- *Terminal Status*: If target membership is already `status = 'revoked'`, the operation is rejected with error `P0025` ("Cannot modify a revoked membership").

### Authorization & Invariants
- Caller must possess `employees:remove`.
- Caller cannot remove themselves if they are the last active Owner (`P0002`).
- Invokes stored procedure `update_organization_member_status(p_org_id, p_membership_id, 'revoked')`.
- Does NOT delete the database row (soft-revocation only) and does NOT revoke the user's global session.
- Revoked member immediately fails tenant-context authorization on subsequent requests (HTTP 404).

### Output
```typescript
export interface RemoveMemberResult {
  membershipId: string;
  status: "revoked";
  revokedAt: string;
}
```

