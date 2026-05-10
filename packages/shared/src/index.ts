export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const DEFAULT_TARGET_SIZE_BYTES = 1024 * 1024;

export const supportedMimeTypes = ["image/jpeg", "image/png"] as const;
export type SupportedMimeType = (typeof supportedMimeTypes)[number];

export const compatibleMimeTypes = [
  "image/webp",
  "image/gif",
  "image/tiff"
] as const;

export const responseHeaders = {
  originalSize: "X-Original-Size",
  compressedSize: "X-Compressed-Size",
  savedPercent: "X-Saved-Percent",
  outputFilename: "X-Output-Filename",
  codec: "X-Codec",
  status: "X-Status",
  verification: "X-Verification",
  mode: "X-Compression-Mode",
  targetSize: "X-Target-Size",
  quality: "X-Quality",
  skipReason: "X-Skip-Reason"
} as const;

export type CompressionMode = "lossless" | "target-size";
export type CompressionStatus = "compressed" | "skipped";
export type VerificationStatus = "passed" | "not-run" | "failed";

export type CompressionStats = {
  originalSize: number;
  compressedSize: number;
  savedPercent: number;
  outputFilename: string;
  codec: "jpegtran" | "oxipng" | "sharp-jpeg" | "none";
  status: CompressionStatus;
  verification: VerificationStatus;
  mode: CompressionMode;
  targetSize?: number;
  quality?: number;
  skipReason?: string;
};

export type UnsupportedFormatResponse = {
  error: "unsupported_format" | "missing_file" | "file_too_large" | "invalid_image";
  message: string;
  supported: readonly SupportedMimeType[];
  compatible: readonly string[];
};

export function isSupportedMimeType(value: string): value is SupportedMimeType {
  return supportedMimeTypes.includes(value as SupportedMimeType);
}

export function formatSavedPercent(originalSize: number, compressedSize: number): number {
  if (originalSize <= 0 || compressedSize >= originalSize) {
    return 0;
  }

  return Number((((originalSize - compressedSize) / originalSize) * 100).toFixed(2));
}
