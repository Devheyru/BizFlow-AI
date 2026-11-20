"use client";

import React, { useState, useMemo } from "react";
import {
  Search,
  ShoppingCart,
  Trash2,
  Package,
  ArrowRight,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CartItemRow, type CartItem } from "@/components/pos/cart-item-row";
import { CheckoutSummary } from "@/components/pos/checkout-summary";
import { PaymentModal, type TenderItem } from "@/components/pos/payment-modal";
import { CheckoutReceipt } from "@/components/pos/checkout-receipt";
import { CheckoutErrors } from "@/components/pos/checkout-errors";
import { CustomerPicker } from "@/components/customers/customer-picker";
import { usePosCheckout } from "@/components/pos/checkout-handler";
import { calculatePosTotals } from "@/lib/sales/financial-calc";
import type { CustomerRecord } from "@/types/customers";
import type { SaleResult } from "@/types/sales";

export interface PosProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  selling_price: number;
  unit_of_measure: string;
  category_id: string | null;
  stock_quantity: number;
  expected_version: number | null;
}

export interface PosCategory {
  id: string;
  name: string;
}

export interface PosTaxSettings {
  taxName: string;
  defaultTaxRate: number;
  isTaxInclusive: boolean;
}

export interface PosCartViewProps {
  slug: string;
  organizationName: string;
  currency: string;
  cashierName: string;
  products: PosProduct[];
  categories: PosCategory[];
  taxSettings: PosTaxSettings;
}

export function PosCartView({
  slug,
  organizationName,
  currency,
  cashierName,
  products,
  categories,
  taxSettings,
}: PosCartViewProps) {
  // Cart state
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRecord | null>(null);
  const [orderDiscountAmount, setOrderDiscountAmount] = useState<number>(0);
  const [saleNotes, setSaleNotes] = useState<string>("");

  // Product search & category filters
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  // Modal UI state
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [confirmedPayments, setConfirmedPayments] = useState<TenderItem[]>([]);
  const [completedSale, setCompletedSale] = useState<SaleResult | null>(null);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);

  // Pos Checkout Handler Hook
  const {
    isSubmitting,
    checkoutError,
    clearError,
    submitCheckout,
  } = usePosCheckout({
    slug,
    onSuccess: (result) => {
      setCompletedSale(result);
      setIsPaymentModalOpen(false);
      setIsReceiptOpen(true);
    },
  });

  // Filter products by search query (name, SKU, barcode) and category
  const filteredProducts = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return products.filter((p) => {
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q));

      const matchesCategory =
        selectedCategory === "all" || p.category_id === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [products, searchQuery, selectedCategory]);

  // Cart financial calculations matching PostgreSQL public.execute_sale precision
  const cartFinancials = useMemo(() => {
    const res = calculatePosTotals({
      items: cartItems.map((it) => ({
        productId: it.productId,
        unitPrice: it.unitPrice,
        quantity: it.quantity,
        lineDiscountAmount: it.lineDiscountAmount,
      })),
      orderDiscountAmount,
      taxRate: taxSettings.defaultTaxRate,
      isTaxInclusive: taxSettings.isTaxInclusive,
      currency,
    });

    return {
      subtotal: res.subtotal,
      totalLineDiscounts: res.totalLineDiscounts,
      netSubtotal: res.netSubtotal,
      effectiveOrderDiscount: res.effectiveOrderDiscount,
      taxAmount: res.totalTax,
      totalPayable: res.totalPayable,
    };
  }, [cartItems, orderDiscountAmount, taxSettings, currency]);

  // Cart operations
  const handleAddToCart = (product: PosProduct) => {
    clearError();
    setCartItems((prev) => {
      const existingIdx = prev.findIndex((it) => it.productId === product.id);
      if (existingIdx >= 0) {
        // Increment quantity of existing line
        const updated = [...prev];
        const current = updated[existingIdx];
        if (current) {
          updated[existingIdx] = {
            ...current,
            quantity: current.quantity + 1,
          };
        }
        return updated;
      }

      // Add new cart item
      const newItem: CartItem = {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        unitPrice: product.selling_price,
        quantity: 1,
        lineDiscountAmount: 0,
        unitOfMeasure: product.unit_of_measure,
        stockQuantity: product.stock_quantity,
        expectedVersion: product.expected_version,
      };
      return [...prev, newItem];
    });
  };

  const handleUpdateQuantity = (productId: string, quantity: number) => {
    clearError();
    setCartItems((prev) =>
      prev.map((it) => (it.productId === productId ? { ...it, quantity } : it))
    );
  };

  const handleUpdateLineDiscount = (productId: string, discount: number) => {
    clearError();
    setCartItems((prev) =>
      prev.map((it) =>
        it.productId === productId ? { ...it, lineDiscountAmount: discount } : it
      )
    );
  };

  const handleRemoveFromCart = (productId: string) => {
    clearError();
    setCartItems((prev) => prev.filter((it) => it.productId !== productId));
  };

  const handleClearCart = () => {
    clearError();
    setCartItems([]);
    setOrderDiscountAmount(0);
    setSaleNotes("");
    setSelectedCustomer(null);
  };

  // Payment confirmation & checkout execution
  const handleConfirmPayments = async (tenders: TenderItem[]) => {
    setConfirmedPayments(tenders);

    await submitCheckout({
      customerId: selectedCustomer?.id ?? null,
      items: cartItems.map((it) => ({
        productId: it.productId,
        quantity: it.quantity,
        lineDiscountAmount: it.lineDiscountAmount,
        expectedVersion: it.expectedVersion,
      })),
      payments: tenders.map((t) => ({
        paymentMethod: t.paymentMethod,
        amount: t.amount,
        amountTendered: t.amountTendered,
        changeDue: t.changeDue,
        referenceNo: t.referenceNo,
      })),
      orderDiscountAmount: cartFinancials.effectiveOrderDiscount,
      notes: saleNotes || null,
    });
  };

  const handleNewSale = () => {
    setIsReceiptOpen(false);
    setCompletedSale(null);
    setConfirmedPayments([]);
    handleClearCart();
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-7xl mx-auto p-4 gap-4 overflow-hidden">
      {/* Top Bar: Register Header & Customer Picker */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-gray-200/80 shadow-sm shrink-0">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <span>POS Register</span>
            <span className="text-xs bg-emerald-100 text-emerald-800 font-medium px-2 py-0.5 rounded-full">
              Live
            </span>
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Cashier: <span className="font-medium text-gray-700">{cashierName}</span> • Store:{" "}
            <span className="font-medium text-gray-700">{organizationName}</span>
          </p>
        </div>

        {/* Customer Picker from Phase 3 */}
        <div className="w-full md:w-80">
          <CustomerPicker
            slug={slug}
            selectedCustomer={selectedCustomer}
            onSelectCustomer={(c) => {
              clearError();
              setSelectedCustomer(c);
            }}
            disabled={isSubmitting}
          />
        </div>
      </div>

      {/* Main Register Grid: Left Catalog, Right Cart */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0 overflow-hidden">
        {/* Left Column: Product Search & Catalog (7 cols) */}
        <div className="lg:col-span-7 flex flex-col bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden min-h-0">
          {/* Catalog Search & Category Filter Bar */}
          <div className="p-3.5 border-b border-gray-100 flex flex-col sm:flex-row items-center gap-2 bg-gray-50/50 shrink-0">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products by name, SKU, barcode..."
                className="pl-9 h-9 text-sm bg-white"
                aria-label="Product search"
              />
            </div>

            {categories.length > 0 && (
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="h-9 px-3 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/20 shrink-0"
                aria-label="Category filter"
              >
                <option value="all">All Categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Product Cards Grid */}
          <div className="flex-1 p-3.5 overflow-y-auto min-h-0">
            {filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8 text-gray-400">
                <Package className="w-10 h-10 mb-2 stroke-1 text-gray-300" />
                <p className="text-sm font-medium text-gray-600">No sellable products found</p>
                <p className="text-xs text-gray-400 mt-1">
                  Try adjusting your search query or category filter
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {filteredProducts.map((p) => {
                  const isOutOfStock = p.stock_quantity <= 0;
                  const inCartQty =
                    cartItems.find((it) => it.productId === p.id)?.quantity || 0;

                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleAddToCart(p)}
                      className={`text-left p-3 rounded-xl border transition-all flex flex-col justify-between relative group ${
                        inCartQty > 0
                          ? "border-primary/50 bg-primary/5 shadow-xs"
                          : "border-gray-200/90 bg-white hover:border-gray-300 hover:shadow-xs"
                      }`}
                    >
                      {inCartQty > 0 && (
                        <span className="absolute top-2 right-2 bg-primary text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                          {inCartQty} in cart
                        </span>
                      )}

                      <div>
                        <div className="font-semibold text-gray-900 text-sm line-clamp-2 leading-tight">
                          {p.name}
                        </div>
                        <div className="text-[11px] text-gray-400 mt-0.5">
                          SKU: {p.sku}
                        </div>
                      </div>

                      <div className="mt-3 flex items-baseline justify-between pt-2 border-t border-gray-100">
                        <span className="font-bold text-gray-900 text-sm">
                          {currency} {p.selling_price.toFixed(2)}
                        </span>
                        <span
                          className={`text-[10px] font-medium ${
                            isOutOfStock
                              ? "text-red-500"
                              : p.stock_quantity <= 5
                              ? "text-amber-600"
                              : "text-gray-400"
                          }`}
                        >
                          {isOutOfStock ? "Out of stock" : `${p.stock_quantity} in stock`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Cart & Checkout (5 cols) */}
        <div className="lg:col-span-5 flex flex-col bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden min-h-0">
          {/* Cart Header */}
          <div className="p-3.5 border-b border-gray-100 flex items-center justify-between bg-gray-50/50 shrink-0">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-gray-700" />
              <h2 className="font-bold text-gray-900 text-sm">
                Active Cart ({cartItems.length} {cartItems.length === 1 ? "item" : "items"})
              </h2>
            </div>

            {cartItems.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearCart}
                disabled={isSubmitting}
                className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50 h-7 px-2"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" />
                Clear
              </Button>
            )}
          </div>

          {/* Cart Error Banner */}
          {checkoutError && (
            <div className="p-3 shrink-0">
              <CheckoutErrors error={checkoutError} onDismiss={clearError} />
            </div>
          )}

          {/* Cart Items List */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100 min-h-0">
            {cartItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8 text-gray-400">
                <ShoppingCart className="w-12 h-12 mb-2 stroke-1 text-gray-200" />
                <p className="text-sm font-medium text-gray-600">Cart is empty</p>
                <p className="text-xs text-gray-400 mt-1">
                  Click on products from the catalog to add items
                </p>
              </div>
            ) : (
              cartItems.map((item) => (
                <CartItemRow
                  key={item.productId}
                  item={item}
                  currency={currency}
                  onUpdateQuantity={handleUpdateQuantity}
                  onUpdateLineDiscount={handleUpdateLineDiscount}
                  onRemove={handleRemoveFromCart}
                  disabled={isSubmitting}
                />
              ))
            )}
          </div>

          {/* Cart Footer: Summary & Checkout Button */}
          <div className="p-4 border-t border-gray-100 bg-gray-50/50 shrink-0 space-y-3">
            <CheckoutSummary
              currency={currency}
              subtotal={cartFinancials.subtotal}
              totalLineDiscounts={cartFinancials.totalLineDiscounts}
              orderDiscountAmount={orderDiscountAmount}
              onUpdateOrderDiscount={(disc) => {
                clearError();
                setOrderDiscountAmount(disc);
              }}
              taxName={taxSettings.taxName}
              taxRate={taxSettings.defaultTaxRate}
              isTaxInclusive={taxSettings.isTaxInclusive}
              taxAmount={cartFinancials.taxAmount}
              totalPayable={cartFinancials.totalPayable}
              disabled={isSubmitting || cartItems.length === 0}
            />

            <Button
              type="button"
              onClick={() => {
                clearError();
                setIsPaymentModalOpen(true);
              }}
              disabled={cartItems.length === 0 || isSubmitting}
              className="w-full h-12 text-base font-bold bg-primary text-white hover:bg-primary/95 shadow-md flex items-center justify-center gap-2 rounded-xl"
            >
              <span>Proceed to Payment</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Payment Modal */}
      <PaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        currency={currency}
        totalPayable={cartFinancials.totalPayable}
        onConfirmPayments={handleConfirmPayments}
        isSubmitting={isSubmitting}
      />

      {/* Receipt Modal */}
      <CheckoutReceipt
        isOpen={isReceiptOpen}
        onClose={() => setIsReceiptOpen(false)}
        saleResult={completedSale}
        items={cartItems}
        payments={confirmedPayments}
        customer={selectedCustomer}
        organizationName={organizationName}
        onNewSale={handleNewSale}
      />
    </div>
  );
}
