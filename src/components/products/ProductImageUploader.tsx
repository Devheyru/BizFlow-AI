"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  UploadCloud,
  Link as LinkIcon,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  Trash2,
  Loader2,
} from "lucide-react";
import {
  validateImageFile,
  ALLOWED_IMAGE_MIME_TYPES,
} from "@/lib/products/image-storage";
import { isValidExternalHttpsUrl } from "@/lib/validations/product";
import { getSignedProductImageUrlAction } from "@/actions/product-actions";

export interface ProductImageValue {
  file: File | null;
  url: string | null;
  source: "file" | "url" | "none";
}

export interface ProductImageUploaderProps {
  mode?: "registration" | "edit";
  slug: string;
  organizationId?: string;
  productId?: string;
  initialImageUrl?: string | null;
  disabled?: boolean;
  value?: ProductImageValue;
  onChange?: (val: ProductImageValue) => void;
  className?: string;
}

/**
 * Format bytes into human readable string (e.g. "1.2 MB")
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * ProductImageUploader Component (T031, US2, US3, FR-011, FR-042, BR-018)
 *
 * Production-ready image uploader with:
 * - Dual input modes: Local file upload and external HTTPS URL
 * - File validation: 5 MB limit, strict MIME type enforcement (JPEG, PNG, WebP, GIF)
 * - Registration mode: Stages files locally in memory without premature Storage upload
 * - Edit mode: Visualizes current signed image and manages replacement states
 * - Comprehensive accessibility and preview lifecycle cleanup
 */
export function ProductImageUploader(props: ProductImageUploaderProps) {
  const {
    mode = "registration",
    slug,
    initialImageUrl,
    disabled = false,
    value,
    onChange,
    className = "",
  } = props;
  // Input method tab: "file" or "url"
  const [activeTab, setActiveTab] = useState<"file" | "url">("file");

  // Local state if uncontrolled
  const [localFile, setLocalFile] = useState<File | null>(value?.file || null);
  const [localUrl, setLocalUrl] = useState<string>(value?.url || "");
  const [localSource, setLocalSource] = useState<"file" | "url" | "none">(
    value?.source || (initialImageUrl ? (initialImageUrl.startsWith("https://") ? "url" : "file") : "none")
  );

  // Preview and status state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [signedInitialUrl, setSignedInitialUrl] = useState<string | null>(null);
  const [isLoadingSignedUrl, setIsLoadingSignedUrl] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync internal state with controlled value prop if provided
  useEffect(() => {
    if (value) {
      setLocalFile(value.file);
      setLocalUrl(value.url || "");
      setLocalSource(value.source);
      if (value.source === "none") {
        setSignedInitialUrl(null);
      }
    }
  }, [value]);

  // Resolve signed URL for initial image if in edit mode and image is a storage path
  useEffect(() => {
    let isMounted = true;

    if (initialImageUrl && !localFile && !localUrl && localSource !== "none") {
      if (initialImageUrl.startsWith("https://")) {
        setSignedInitialUrl(initialImageUrl);
      } else {
        setIsLoadingSignedUrl(true);
        getSignedProductImageUrlAction(slug, initialImageUrl)
          .then((res) => {
            if (isMounted) {
              if (res.success && res.data?.signedUrl) {
                setSignedInitialUrl(res.data.signedUrl);
              } else {
                setSignedInitialUrl(null);
              }
            }
          })
          .catch(() => {
            if (isMounted) setSignedInitialUrl(null);
          })
          .finally(() => {
            if (isMounted) setIsLoadingSignedUrl(false);
          });
      }
    } else if (localSource === "none") {
      setSignedInitialUrl(null);
    }

    return () => {
      isMounted = false;
    };
  }, [initialImageUrl, slug, localFile, localUrl, localSource]);

  // Object URL lifecycle management for local file previews
  useEffect(() => {
    if (localFile && typeof window !== "undefined" && typeof window.URL?.createObjectURL === "function") {
      const objectUrl = window.URL.createObjectURL(localFile);
      setPreviewUrl(objectUrl);

      return () => {
        if (typeof window.URL?.revokeObjectURL === "function") {
          window.URL.revokeObjectURL(objectUrl);
        }
      };
    } else {
      setPreviewUrl(null);
      return undefined;
    }
  }, [localFile]);

  // Notify parent of state changes
  const notifyChange = useCallback(
    (newVal: ProductImageValue) => {
      if (onChange) {
        onChange(newVal);
      }
    },
    [onChange]
  );

  // File selection handler
  const handleFileSelect = (file: File) => {
    setValidationError(null);

    const validation = validateImageFile(file);
    if (!validation.valid) {
      setValidationError(validation.error);
      return;
    }

    setLocalFile(file);
    setLocalUrl("");
    setLocalSource("file");

    notifyChange({
      file,
      url: null,
      source: "file",
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
    // Reset file input so re-selecting same file triggers change
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);

    if (disabled) return;

    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!disabled) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  // External URL handler
  const handleUrlChange = (newUrl: string) => {
    setLocalUrl(newUrl);
    setValidationError(null);

    const trimmed = newUrl.trim();
    if (!trimmed) {
      setLocalSource(initialImageUrl ? "file" : "none");
      notifyChange({
        file: null,
        url: null,
        source: "none",
      });
      return;
    }

    if (!isValidExternalHttpsUrl(trimmed)) {
      setValidationError("Please enter a valid external HTTPS URL (e.g. https://images.unsplash.com/photo.jpg)");
      setLocalSource("none");
      notifyChange({
        file: null,
        url: trimmed,
        source: "none",
      });
      return;
    }

    setLocalFile(null);
    setLocalSource("url");
    notifyChange({
      file: null,
      url: trimmed,
      source: "url",
    });
  };

  // Clear / remove current selection
  const handleRemove = () => {
    setLocalFile(null);
    setLocalUrl("");
    setLocalSource("none");
    setSignedInitialUrl(null);
    setValidationError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    notifyChange({
      file: null,
      url: null,
      source: "none",
    });
  };

  // Active display image
  const displayImage =
    previewUrl ||
    (localSource === "url" && localUrl && isValidExternalHttpsUrl(localUrl) ? localUrl : null) ||
    (localSource !== "none" ? signedInitialUrl : null);

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_IMAGE_MIME_TYPES.join(",")}
        onChange={handleInputChange}
        disabled={disabled}
        className="hidden"
        id="product-image-file-input"
        data-testid="product-image-file-input"
      />

      {/* Tabs: Upload File vs External URL */}
      {!displayImage && (
        <div className="flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab("file");
              setValidationError(null);
            }}
            disabled={disabled}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              activeTab === "file"
                ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold"
                : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            <UploadCloud className="h-3.5 w-3.5" />
            <span>Upload File</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("url");
              setValidationError(null);
            }}
            disabled={disabled}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              activeTab === "url"
                ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold"
                : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            <LinkIcon className="h-3.5 w-3.5" />
            <span>External HTTPS URL</span>
          </button>
        </div>
      )}

      {/* Validation Error Banner */}
      {validationError && (
        <div
          role="alert"
          className="p-3 text-xs rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-300 flex items-start gap-2"
        >
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{validationError}</span>
        </div>
      )}

      {/* Active Preview View (when an image is selected, staged, or loaded from initial) */}
      {displayImage ? (
        <div className="relative rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-4">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
            {/* Image Preview Box */}
            <div className="relative w-32 h-32 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shrink-0 flex items-center justify-center">
              {isLoadingSignedUrl ? (
                <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
              ) : (
                /* Using standard img for local blob and dynamic signed urls */
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={displayImage}
                  alt="Product preview"
                  className="w-full h-full object-cover"
                />
              )}
            </div>

            {/* Image Metadata & Controls */}
            <div className="flex-1 min-w-0 space-y-2 text-center sm:text-left">
              <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  <CheckCircle2 className="h-3 w-3" />
                  {localFile
                    ? mode === "registration"
                      ? "Staged for upload"
                      : "New image selected"
                    : localSource === "url"
                    ? "External URL"
                    : "Current image"}
                </span>

                {localFile && (
                  <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                    {formatFileSize(localFile.size)}
                  </span>
                )}
              </div>

              {localFile ? (
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                    {localFile.name}
                  </p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {mode === "registration"
                      ? "File will be uploaded automatically once the product is created."
                      : "File will replace the current image upon saving changes."}
                  </p>
                </div>
              ) : localSource === "url" ? (
                <p className="text-xs font-mono text-zinc-700 dark:text-zinc-300 break-all">
                  {localUrl}
                </p>
              ) : (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {initialImageUrl?.startsWith("https://")
                    ? "External HTTPS Image"
                    : "Stored in private product-images bucket"}
                </p>
              )}

              {/* Action Buttons: Replace or Remove */}
              <div className="flex items-center justify-center sm:justify-start gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
                  aria-label="Replace product image"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>Replace</span>
                </button>
                <button
                  type="button"
                  onClick={handleRemove}
                  disabled={disabled}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors disabled:opacity-50"
                  aria-label="Remove product image"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>Remove</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : activeTab === "file" ? (
        /* Drag & Drop File Upload Area */
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => {
            if (!disabled) fileInputRef.current?.click();
          }}
          className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
            isDragOver
              ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/20"
              : "border-zinc-300 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-600 bg-zinc-50/50 dark:bg-zinc-900/30"
          } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!disabled) fileInputRef.current?.click();
            }
          }}
          aria-label="Upload product image file"
        >
          <div className="flex flex-col items-center justify-center space-y-2">
            <div className="p-3 bg-zinc-100 dark:bg-zinc-800 rounded-full text-zinc-600 dark:text-zinc-400">
              <UploadCloud className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Click to browse or drag and drop image
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                JPEG, PNG, WebP, or GIF up to 5 MB
              </p>
            </div>
          </div>
        </div>
      ) : (
        /* External HTTPS URL Input */
        <div className="space-y-2">
          <div className="relative">
            <input
              type="url"
              placeholder="https://example.com/images/product.jpg"
              value={localUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              disabled={disabled}
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 disabled:opacity-50 font-mono text-xs"
              aria-label="External product image URL"
            />
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Must be an HTTPS URL pointing directly to an image resource.
          </p>
        </div>
      )}
    </div>
  );
}
