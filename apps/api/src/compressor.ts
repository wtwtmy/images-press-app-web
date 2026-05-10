import { execFile } from "node:child_process";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileTypeFromBuffer } from "file-type";
import jpegtranPath from "jpegtran-bin";
import oxipngPath from "oxipng-bin";
import sharp from "sharp";
import {
  DEFAULT_TARGET_SIZE_BYTES,
  type CompressionMode,
  formatSavedPercent,
  isSupportedMimeType,
  type CompressionStats,
  type SupportedMimeType
} from "@pressapp/shared";

const execFileAsync = promisify(execFile);
const toolTimeoutMs = 30_000;

type DetectResult =
  | { supported: true; mimeType: SupportedMimeType }
  | { supported: false; reason: "invalid_image" | "unsupported"; message: string };

type CompressInput = {
  buffer: Buffer;
  mimeType: SupportedMimeType;
  originalName: string;
  mode?: CompressionMode;
  targetSize?: number;
};

type CompressOutput = {
  buffer: Buffer;
  stats: CompressionStats;
};

export async function detectUploadFormat(
  buffer: Buffer,
  fallbackMimeType: string
): Promise<DetectResult> {
  const detected = await fileTypeFromBuffer(buffer);
  const mimeType = detected?.mime ?? fallbackMimeType;

  if (isSupportedMimeType(mimeType)) {
    return { supported: true, mimeType };
  }

  if (!mimeType.startsWith("image/")) {
    return {
      supported: false,
      reason: "invalid_image",
      message: "上传内容不是可识别的图片文件。"
    };
  }

  return {
    supported: false,
    reason: "unsupported",
    message: `当前首版仅实际压缩 JPG/JPEG 与 PNG，暂不压缩 ${mimeType}。`
  };
}

export async function compressImage(input: CompressInput): Promise<CompressOutput> {
  const mode = input.mode ?? "lossless";

  if (mode === "target-size") {
    return compressToTargetSize(input, input.targetSize ?? DEFAULT_TARGET_SIZE_BYTES);
  }

  return compressLosslessly(input);
}

async function compressLosslessly(input: CompressInput): Promise<CompressOutput> {
  const codec = input.mimeType === "image/jpeg" ? "jpegtran" : "oxipng";

  try {
    const candidate = await runLosslessTool(input.buffer, input.mimeType);
    const verified = await haveSamePixels(input.buffer, candidate);

    if (!verified) {
      return skipped(input, "pixel-verification-failed", "lossless");
    }

    if (candidate.byteLength >= input.buffer.byteLength) {
      return skipped(input, "no-size-savings", "lossless");
    }

    return {
      buffer: candidate,
      stats: {
        originalSize: input.buffer.byteLength,
        compressedSize: candidate.byteLength,
        savedPercent: formatSavedPercent(input.buffer.byteLength, candidate.byteLength),
        outputFilename: outputName(input.originalName, input.mimeType),
        codec,
        status: "compressed",
        verification: "passed",
        mode: "lossless"
      }
    };
  } catch (error) {
    console.warn("Compression skipped:", error);
    return skipped(input, "tool-failed", "lossless");
  }
}

async function compressToTargetSize(input: CompressInput, targetSize: number): Promise<CompressOutput> {
  try {
    const lossless = await compressLosslessly({ ...input, mode: "lossless" });

    if (lossless.buffer.byteLength <= targetSize) {
      return {
        buffer: lossless.buffer,
        stats: {
          ...lossless.stats,
          mode: "target-size",
          targetSize
        }
      };
    }
  } catch (error) {
    console.warn("Lossless pass before target-size compression failed:", error);
  }

  if (input.mimeType !== "image/jpeg") {
    return skipped(input, "target-size-lossy-jpeg-only", "target-size", targetSize);
  }

  const result = await findLargestJpegUnderTarget(input.buffer, targetSize);

  if (!result) {
    return skipped(input, "target-size-unreachable", "target-size", targetSize);
  }

  return {
    buffer: result.buffer,
    stats: {
      originalSize: input.buffer.byteLength,
      compressedSize: result.buffer.byteLength,
      savedPercent: formatSavedPercent(input.buffer.byteLength, result.buffer.byteLength),
      outputFilename: outputName(input.originalName, "image/jpeg", "target-size"),
      codec: "sharp-jpeg",
      status: "compressed",
      verification: "not-run",
      mode: "target-size",
      targetSize,
      quality: result.quality
    }
  };
}

async function findLargestJpegUnderTarget(buffer: Buffer, targetSize: number) {
  const metadata = await sharp(buffer, { failOn: "none" }).metadata();
  const baseWidth = metadata.width ?? 0;
  const candidateWidths: Array<number | undefined> = [undefined];

  if (baseWidth > 0) {
    for (const scale of [0.9, 0.8, 0.7, 0.6, 0.5]) {
      candidateWidths.push(Math.max(1, Math.round(baseWidth * scale)));
    }
  }

  for (const width of candidateWidths) {
    const candidate = await findBestJpegQuality(buffer, targetSize, width);

    if (candidate) {
      return candidate;
    }
  }

  return null;
}

async function findBestJpegQuality(buffer: Buffer, targetSize: number, width?: number) {
  let low = 20;
  let high = 92;
  let best: { buffer: Buffer; quality: number } | null = null;

  while (low <= high) {
    const quality = Math.floor((low + high) / 2);
    const candidate = await encodeTargetJpeg(buffer, quality, width);

    if (candidate.byteLength <= targetSize) {
      best = { buffer: candidate, quality };
      low = quality + 1;
    } else {
      high = quality - 1;
    }
  }

  return best;
}

function encodeTargetJpeg(buffer: Buffer, quality: number, width?: number) {
  let pipeline = sharp(buffer, { failOn: "none" }).rotate();

  if (width) {
    pipeline = pipeline.resize({ width, withoutEnlargement: true });
  }

  return pipeline
    .jpeg({
      quality,
      mozjpeg: true,
      progressive: true
    })
    .toBuffer();
}

async function runLosslessTool(buffer: Buffer, mimeType: SupportedMimeType): Promise<Buffer> {
  const ext = mimeType === "image/jpeg" ? ".jpg" : ".png";
  const tempDir = await mkdtemp(path.join(tmpdir(), "press-app-"));
  const inputPath = path.join(tempDir, `input${ext}`);
  const outputPath = path.join(tempDir, `output${ext}`);

  try {
    await writeFile(inputPath, buffer);

    if (mimeType === "image/jpeg") {
      await runJpegtran(inputPath, outputPath, false);

      const stripped = await readFile(outputPath);

      if (await haveSamePixels(buffer, stripped)) {
        return stripped;
      }

      await runJpegtran(inputPath, outputPath, true);
    } else {
      await execFileAsync(
        oxipngPath,
        ["--opt", "4", "--strip", "safe", "--out", outputPath, inputPath],
        { timeout: toolTimeoutMs }
      );
    }

    return await readFile(outputPath);
  } finally {
    await removeFileIfExists(inputPath);
    await removeFileIfExists(outputPath);
    await removeFileIfExists(path.join(tempDir, "input.png.tmp"));
    await removeDirectoryIfEmpty(tempDir);
  }
}

function runJpegtran(inputPath: string, outputPath: string, preserveMetadata: boolean) {
  return execFileAsync(
    jpegtranPath,
    [
      "-copy",
      preserveMetadata ? "all" : "none",
      "-optimize",
      "-progressive",
      "-outfile",
      outputPath,
      inputPath
    ],
    { timeout: toolTimeoutMs }
  );
}

async function haveSamePixels(original: Buffer, compressed: Buffer): Promise<boolean> {
  const [left, right] = await Promise.all([decodePixels(original), decodePixels(compressed)]);

  return (
    left.info.width === right.info.width &&
    left.info.height === right.info.height &&
    left.info.channels === right.info.channels &&
    left.data.equals(right.data)
  );
}

async function decodePixels(buffer: Buffer) {
  return sharp(buffer, { failOn: "none" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

function skipped(
  input: CompressInput,
  reason: string,
  mode: CompressionMode,
  targetSize?: number
): CompressOutput {
  return {
    buffer: input.buffer,
    stats: {
      originalSize: input.buffer.byteLength,
      compressedSize: input.buffer.byteLength,
      savedPercent: 0,
      outputFilename: outputName(input.originalName, input.mimeType),
      codec: "none",
      status: "skipped",
      verification: "not-run",
      mode,
      targetSize,
      skipReason: reason
    }
  };
}

function outputName(
  originalName: string,
  mimeType: SupportedMimeType,
  mode: CompressionMode = "lossless"
) {
  const parsed = path.parse(originalName || "image");
  const ext = mimeType === "image/jpeg" ? ".jpg" : ".png";
  const baseName = parsed.name || "image";
  const suffix = mode === "target-size" ? ".target-1mb" : ".compressed";

  return `${baseName}${suffix}${ext}`;
}

async function removeFileIfExists(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

async function removeDirectoryIfEmpty(directoryPath: string) {
  try {
    await rmdir(directoryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
