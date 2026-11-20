"use client";

import React from "react";
import { Trash2, Plus, Minus, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isDiscreteUom } from "@/lib/inventory/formatters";

export interface CartItem {
  productId: string;
  name: string;
  sku: string;
  barcode?: string | null;
  unitPrice: number;
  quantity: number;
  lineDiscountAmount: number;
  unitOfMeasure?: string;
  stockQuantity: number;
  expectedVersion?: number | null;
}

export interface CartItemRowProps {
  item: CartItem;
  currency: string;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onUpdateLineDiscount: (productId: string, discount: number) => void;
  onRemove: (productId: string) => void;
  disabled?: boolean;
}

export function CartItemRow({
  item,
  currency,
  onUpdateQuantity,
  onUpdateLineDiscount,
  onRemove,
  disabled = false,
}: CartItemRowProps) {
  const isDiscrete = isDiscreteUom(item.unitOfMeasure);
  const lineGross = Math.round(item.quantity * item.unitPrice * 10000) / 10000;
  const lineNet = Math.max(0, Math.round((lineGross - item.lineDiscountAmount) * 10000) / 10000);
  const isOverStock = item.quantity > item.stockQuantity;

  const handleQuantityChange = (valStr: string) => {
    const parsed = parseFloat(valStr);
    if (isNaN(parsed) || parsed <= 0) return;
    const rounded = isDiscrete
      ? Math.floor(parsed)
      : Math.round(parsed * 10000) / 10000;
    if (rounded > 0) {
      onUpdateQuantity(item.productId, rounded);
    }
  };

  const handleStepQuantity = (delta: number) => {
    const nextQty = isDiscrete
      ? Math.max(1, item.quantity + delta)
      : Math.max(0.0001, Math.round((item.quantity + delta) * 10000) / 10000);
    onUpdateQuantity(item.productId, nextQty);
  };

  const handleDiscountChange = (valStr: string) => {
    const parsed = parseFloat(valStr);
    if (isNaN(parsed) || parsed < 0) {
      onUpdateLineDiscount(item.productId, 0);
      return;
    }
    // Cap at line gross total
    const clamped = Math.min(lineGross, Math.round(parsed * 10000) / 10000);
    onUpdateLineDiscount(item.productId, clamped);
  };

  return (
    <div
      data-testid={`cart-item-row-${item.productId}`}
      className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 border-b border-gray-100 hover:bg-gray-50/50 gap-3"
    >
      {/* Product Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900 truncate">{item.name}</span>
          {isOverStock && (
            <span
              title={`Requested quantity (${item.quantity}) exceeds on-hand stock (${item.stockQuantity})`}
              className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200"
            >
              <AlertTriangle className="w-3 h-3 text-amber-600" />
              Low Stock
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
          <span>SKU: {item.sku}</span>
          <span>•</span>
          <span>
            {currency} {item.unitPrice.toFixed(2)}
            {item.unitOfMeasure ? ` / ${item.unitOfMeasure}` : ""}
          </span>
          <span>•</span>
          <span className={item.stockQuantity <= 0 ? "text-red-600 font-medium" : "text-gray-500"}>
            Stock: {item.stockQuantity}
          </span>
        </div>
      </div>

      {/* Quantity Controls */}
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => handleStepQuantity(-1)}
          disabled={disabled || item.quantity <= (isDiscrete ? 1 : 0.0001)}
          aria-label="Decrease quantity"
        >
          <Minus className="w-3.5 h-3.5" />
        </Button>
        <Input
          type="number"
          step={isDiscrete ? "1" : "0.0001"}
          min={isDiscrete ? "1" : "0.0001"}
          value={item.quantity}
          onChange={(e) => handleQuantityChange(e.target.value)}
          disabled={disabled}
          className="h-8 w-16 text-center px-1 text-sm font-medium"
          aria-label="Item quantity"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => handleStepQuantity(1)}
          disabled={disabled}
          aria-label="Increase quantity"
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Line Discount Input */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-gray-400">Disc:</span>
        <Input
          type="number"
          step="0.01"
          min="0"
          max={lineGross}
          value={item.lineDiscountAmount || ""}
          placeholder="0.00"
          onChange={(e) => handleDiscountChange(e.target.value)}
          disabled={disabled}
          className="h-8 w-20 text-right px-2 text-sm"
          aria-label="Line discount amount"
        />
      </div>

      {/* Net Total & Remove */}
      <div className="flex items-center justify-end gap-3 min-w-[110px]">
        <div className="text-right">
          <div className="font-semibold text-gray-900 text-sm">
            {currency} {lineNet.toFixed(2)}
          </div>
          {item.lineDiscountAmount > 0 && (
            <div className="text-xs text-gray-400 line-through">
              {currency} {lineGross.toFixed(2)}
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onRemove(item.productId)}
          disabled={disabled}
          className="h-8 w-8 p-0 text-gray-400 hover:text-red-600 hover:bg-red-50"
          aria-label={`Remove ${item.name} from cart`}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
