/**
 * Customer Domain Types for Feature 005 (Customers & Sales)
 * Authoritative Source: specs/005-customers-sales/contracts/server-actions.md §1 & §5
 */

export type CustomerStatus = "active" | "archived";

export interface CustomerRecord {
  id: string;
  organizationId: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: CustomerStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerDetail extends CustomerRecord {
  purchaseCount: number | null;
  lastPurchaseAt: string | null;
  totalSpent: number | null;
  salesMetricsRestricted?: boolean;
}

export interface PaginatedCustomerResult {
  items: CustomerRecord[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CustomerSearchQuery {
  search?: string;
  status?: "all" | CustomerStatus;
  page?: number;
  pageSize?: number;
}
