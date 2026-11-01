import type { User } from "@supabase/supabase-js";
import type { Database, Tables, Enums } from "./database";

// ============================================================================
// Core Database Entity Aliases
// ============================================================================
export type Profile = Tables<"profiles">;
export type ProfileInsert = Database["public"]["Tables"]["profiles"]["Insert"];
export type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

export type Organization = Tables<"organizations">;
export type OrganizationInsert = Database["public"]["Tables"]["organizations"]["Insert"];
export type OrganizationUpdate = Database["public"]["Tables"]["organizations"]["Update"];

export type OrganizationMembership = Tables<"organization_memberships">;
export type OrganizationMembershipInsert = Database["public"]["Tables"]["organization_memberships"]["Insert"];
export type OrganizationMembershipUpdate = Database["public"]["Tables"]["organization_memberships"]["Update"];

export type OrganizationAuditEvent = Tables<"organization_audit_events">;
export type OrganizationAuditEventInsert = Database["public"]["Tables"]["organization_audit_events"]["Insert"];

export type AppRole = Enums<"app_role">;
export type MembershipStatus = Enums<"membership_status">;

// ============================================================================
// Server Action Result Pattern
// ============================================================================
export interface ActionError {
  code: string;
  message: string;
  details?: Record<string, string[]>;
}

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: ActionError };

// ============================================================================
// Authentication & Session Domain Models
// ============================================================================
export interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  isEmailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  businessType: string;
  country: string;
  currency: string;
  timezone: string;
  isActive: boolean;
  role: AppRole;
  membershipStatus?: MembershipStatus;
  isIdempotentReplay?: boolean;
  redirectUrl?: string;
}

export interface AuthenticatedUserSession {
  userId: string;
  email: string;
  isEmailVerified: boolean;
  profile: Profile | null;
  activeOrganization: OrganizationSummary | null;
  userOrganizations: OrganizationSummary[];
}

export interface TenantContext {
  user: User;
  organization: Organization;
  membership: OrganizationMembership;
  role: AppRole;
  activeOrganizations: OrganizationSummary[];
}

// ============================================================================
// Server Action Return Types
// ============================================================================
export interface SignUpResult {
  userId: string;
  email: string;
  isEmailVerified: boolean;
  message: string;
  pendingInviteToken?: string;
}

export interface SignInResult {
  userId: string;
  email: string;
  isEmailVerified: boolean;
  hasActiveOrganization: boolean;
  activeOrganizationId?: string;
  activeOrgSlug?: string;
  redirectUrl: string;
}

export interface SignOutResult {
  success: boolean;
}

export interface PasswordResetResult {
  message: string;
}

export interface CreateOrganizationResult {
  organization: Organization;
  membership: OrganizationMembership;
  redirectUrl: string;
}

export interface SwitchOrganizationResult {
  organizationId: string;
  slug: string;
  redirectUrl: string;
}
