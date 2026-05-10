import cors from "cors";
import express from "express";
import multer from "multer";
import {
  compatibleMimeTypes,
  DEFAULT_TARGET_SIZE_BYTES,
  MAX_UPLOAD_BYTES,
  responseHeaders,
  supportedMimeTypes,
  type CompressionMode,
  type CompressionStats,
  type UnsupportedFormatResponse
} from "@pressapp/shared";
import { compressImage, detectUploadFormat } from "./compressor.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES
  }
});

export function createApp() {
  const app = express();

  app.use(cors({ exposedHeaders: Object.values(responseHeaders) }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/compress", upload.single("file"), async (req, res) => {
    const file = req.file;

    if (!file) {
      return sendUnsupported(res, 400, {
        error: "missing_file",
        message: "请上传字段名为 file 的图片文件。",
        supported: supportedMimeTypes,
        compatible: compatibleMimeTypes
      });
    }

    const detected = await detectUploadFormat(file.buffer, file.mimetype);

    if (!detected.supported) {
      return sendUnsupported(res, 415, {
        error: detected.reason === "invalid_image" ? "invalid_image" : "unsupported_format",
        message: detected.message,
        supported: supportedMimeTypes,
        compatible: compatibleMimeTypes
      });
    }

    const result = await compressImage({
      buffer: file.buffer,
      mimeType: detected.mimeType,
      originalName: file.originalname,
      mode: readCompressionMode(req.body.mode),
      targetSize: DEFAULT_TARGET_SIZE_BYTES
    });

    applyStatsHeaders(res, result.stats);
    res.contentType(detected.mimeType);
    return res.send(result.buffer);
  });

  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (!error) {
        return next();
      }

      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        return sendUnsupported(res, 413, {
          error: "file_too_large",
          message: "单文件最大支持 25MB。",
          supported: supportedMimeTypes,
          compatible: compatibleMimeTypes
        });
      }

      console.error(error);
      return res.status(500).json({
        error: "internal_error",
        message: "压缩服务暂时不可用，请稍后重试。"
      });
    }
  );

  return app;
}

function applyStatsHeaders(res: express.Response, stats: CompressionStats) {
  res.setHeader(responseHeaders.originalSize, String(stats.originalSize));
  res.setHeader(responseHeaders.compressedSize, String(stats.compressedSize));
  res.setHeader(responseHeaders.savedPercent, String(stats.savedPercent));
  res.setHeader(responseHeaders.outputFilename, stats.outputFilename);
  res.setHeader(responseHeaders.codec, stats.codec);
  res.setHeader(responseHeaders.status, stats.status);
  res.setHeader(responseHeaders.verification, stats.verification);
  res.setHeader(responseHeaders.mode, stats.mode);

  if (stats.targetSize) {
    res.setHeader(responseHeaders.targetSize, String(stats.targetSize));
  }

  if (stats.quality) {
    res.setHeader(responseHeaders.quality, String(stats.quality));
  }

  if (stats.skipReason) {
    res.setHeader(responseHeaders.skipReason, stats.skipReason);
  }
}

function readCompressionMode(value: unknown): CompressionMode {
  return value === "target-size" ? "target-size" : "lossless";
}

function sendUnsupported(
  res: express.Response,
  status: number,
  payload: UnsupportedFormatResponse
) {
  return res.status(status).json(payload);
}
