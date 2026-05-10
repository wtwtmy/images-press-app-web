import request from "supertest";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { DEFAULT_TARGET_SIZE_BYTES, responseHeaders } from "@pressapp/shared";
import { createApp } from "../src/app.js";

const app = createApp();

describe("POST /api/compress", () => {
  it("rejects missing file uploads", async () => {
    const response = await request(app).post("/api/compress").expect(400);

    expect(response.body.error).toBe("missing_file");
  });

  it("rejects unsupported image formats with a compatibility message", async () => {
    const gif = Buffer.from("R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");

    const response = await request(app)
      .post("/api/compress")
      .attach("file", gif, { filename: "pixel.gif", contentType: "image/gif" })
      .expect(415);

    expect(response.body.error).toBe("unsupported_format");
    expect(response.body.supported).toContain("image/jpeg");
    expect(response.body.compatible).toContain("image/gif");
  });

  it("compresses or safely skips a JPEG while preserving download headers", async () => {
    const jpeg = await sharp({
      create: {
        width: 48,
        height: 48,
        channels: 3,
        background: { r: 230, g: 80, b: 40 }
      }
    })
      .jpeg({ quality: 92 })
      .toBuffer();

    const response = await request(app)
      .post("/api/compress")
      .attach("file", jpeg, { filename: "sample.jpg", contentType: "image/jpeg" })
      .expect(200);

    expect(response.headers[responseHeaders.originalSize.toLowerCase()]).toBe(String(jpeg.byteLength));
    expect(response.headers[responseHeaders.outputFilename.toLowerCase()]).toBe("sample.compressed.jpg");
    expect(["compressed", "skipped"]).toContain(response.headers[responseHeaders.status.toLowerCase()]);
    expect(response.body.length).toBeGreaterThan(0);
  });

  it("can explicitly use target-size mode for a JPEG", async () => {
    const width = 1600;
    const height = 1200;
    const pixels = Buffer.alloc(width * height * 3);

    for (let index = 0; index < pixels.length; index += 1) {
      pixels[index] = (index * 17) % 251;
    }

    const jpeg = await sharp(pixels, {
      raw: {
        width,
        height,
        channels: 3
      }
    })
      .jpeg({ quality: 95 })
      .toBuffer();

    const response = await request(app)
      .post("/api/compress")
      .field("mode", "target-size")
      .attach("file", jpeg, { filename: "large.jpg", contentType: "image/jpeg" })
      .expect(200);

    expect(response.headers[responseHeaders.mode.toLowerCase()]).toBe("target-size");
    expect(Number(response.headers[responseHeaders.compressedSize.toLowerCase()])).toBeLessThanOrEqual(
      DEFAULT_TARGET_SIZE_BYTES
    );
    expect(response.body.length).toBeLessThanOrEqual(DEFAULT_TARGET_SIZE_BYTES);
  });

  it("compresses or safely skips a PNG while preserving download headers", async () => {
    const png = await sharp({
      create: {
        width: 48,
        height: 48,
        channels: 4,
        background: { r: 24, g: 116, b: 205, alpha: 1 }
      }
    })
      .png()
      .toBuffer();

    const response = await request(app)
      .post("/api/compress")
      .attach("file", png, { filename: "sample.png", contentType: "image/png" })
      .expect(200);

    expect(response.headers[responseHeaders.outputFilename.toLowerCase()]).toBe("sample.compressed.png");
    expect(["compressed", "skipped"]).toContain(response.headers[responseHeaders.status.toLowerCase()]);
    expect(response.body.length).toBeGreaterThan(0);
  });
});
