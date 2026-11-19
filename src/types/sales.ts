/**
 * Sales, Payments, Returns, and Refunds Domain Types for Feature 005
 * Authoritative Source: specs/005-customers-sales/contracts/server-actions.md §2 & §5, database-rpcs.md §11
 */

export type SaleStatus = "completed" | "voided" | "partially_returned" | "returned";
export type PaymentStatus = "paid" | "partially_refunded" | "refunded";
export type PaymentMethod = "cash" | "card" | "bank_transfer" | "other";
export type RefundStatus = "completed" | "pending" | "failed";

export interface SaleResult {
  success: boolean;
  isReplay: boolean;
  saleId: string;
  saleNumber: string;
  status: SaleStatus;
  paymentStatus: PaymentStatus;
  subtotal: number;
  orderDiscountAmount: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;
  itemsCount: number;
  createdAt: string;
  createdBy: string;
}

export interface SaleListItem {
  id: string;
  saleNumber: string;
  status: SaleStatus;
  paymentStatus: PaymentStatus;
  customerId: string | null;
  customerName: string | null;
  itemsCount: number;
  subtotal: number;
  orderDiscountAmount: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;
  cashierId: string;
  cashierName?: string | null;
  createdAt: string;
}

export interface SaleItemRecord {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  /**
   * Protected unit cost snapshot: strictly NULL unless caller holds BOTH
   * 'inventory:read_valuation' AND 'products:read_cost'.
   */
  unitCost: number | null;
  lineDiscountAmount: number;
  allocatedOrderDisc: number;
  taxableAmount: number;
  allocatedTaxAmount: number;
  totalPrice: number;
  movementId: string | null;
}

export interface PaymentRecord {
  id: string;
  paymentMethod: PaymentMethod;
  amount: number;
  amountTendered: number | null;
  changeDue: number | null;
  referenceNo: string | null;
  createdAt: string;
}

export interface ReturnItemRecord {
  id: string;
  saleItemId: string;
  productId: string;
  productName?: string;
  sku?: string;
  quantity: number;
  refundAmount: number;
  restockToInventory: boolean;
  movementId: string | null;
}

export interface ReturnRecord {
  id: string;
  returnNumber: string;
  saleId: string;
  refundMethod: PaymentMethod;
  reason: string;
  totalRefundAmount: number;
  createdAt: string;
  createdBy: string;
  items?: ReturnItemRecord[];
}

export interface RefundRecord {
  id: string;
  obligationRefundId: string;
  replacesRefundId: string | null;
  paymentId: string | null;
  saleReturnId: string | null;
  refundMethod: PaymentMethod;
  amount: number;
  status: RefundStatus;
  referenceNo: string | null;
  externalReference: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaleDetailHeader {
  id: string;
  organizationId: string;
  saleNumber: string;
  customerId: string | null;
  status: SaleStatus;
  paymentStatus: PaymentStatus;
  subtotal: number;
  orderDiscountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;
  isTaxInclusive: boolean;
  taxRate: number;
  taxName: string;
  notes: string | null;
  createdAt: string;
  createdBy: string;
}

export interface SaleDetailCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

export interface SaleDetail {
  sale: SaleDetailHeader;
  customer: SaleDetailCustomer | null;
  items: SaleItemRecord[];
  payments: PaymentRecord[];
  returns: ReturnRecord[];
  refunds: RefundRecord[];
}

export interface VoidResult {
  success: boolean;
  isReplay: boolean;
  saleId: string;
  saleNumber: string;
  status: SaleStatus;
  refundsCount: number;
  refundIds: string[];
  voidedAt: string;
}

export interface ReturnResult {
  success: boolean;
  isReplay: boolean;
  returnId: string;
  returnNumber: string;
  saleId: string;
  refundId: string;
  refundStatus: RefundStatus;
  totalRefundAmount: number;
  saleStatus: SaleStatus;
  paymentStatus: PaymentStatus;
}

export interface RefundConfirmation {
  success: boolean;
  isReplay: boolean;
  refundId: string;
  status: RefundStatus;
  externalReference: string;
  confirmedAt: string;
}

export interface RefundFailureResult {
  success: boolean;
  refundId: string;
  status: RefundStatus;
  failureReason: string;
  failedAt: string;
}

export interface ReplacementRefundResult {
  success: boolean;
  isReplay: boolean;
  replacementRefundId: string;
  obligationRefundId: string;
  failedRefundId: string;
  status: RefundStatus;
  refundMethod: PaymentMethod;
  amount: number;
  createdAt: string;
}

export interface PaginatedSalesList {
  items: SaleListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ReturnHistory {
  id: string;
  returnNumber: string;
  saleId: string;
  refundMethod: PaymentMethod;
  reason: string;
  totalRefundAmount: number;
  createdAt: string;
  createdBy: string;
  items: ReturnItemRecord[];
  refunds: RefundRecord[];
}

export interface TaxSettings {
  organizationId: string;
  taxName: string;
  defaultTaxRate: number;
  isTaxInclusive: boolean;
  updatedAt: string;
  updatedBy: string;
}

export interface SalesListQuery {
  search?: string;
  status?: "all" | SaleStatus;
  customerId?: string | null;
  cashierId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  page?: number;
  pageSize?: number;
  sortBy?: "created_at" | "sale_number" | "total_amount";
  sortOrder?: "asc" | "desc";
}
