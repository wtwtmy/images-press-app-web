import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  CheckCircle2,
  FileImage,
  Loader2,
  ShieldCheck,
  SlidersHorizontal,
  UploadCloud,
  XCircle
} from "lucide-react";
import {
  DEFAULT_TARGET_SIZE_BYTES,
  MAX_UPLOAD_BYTES,
  responseHeaders,
  type CompressionMode,
  type CompressionStats
} from "@pressapp/shared";

type UiState = "idle" | "ready" | "compressing" | "done" | "error";

const accept = "image/jpeg,image/png,image/webp,image/gif,image/tiff";

export function App() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [state, setState] = useState<UiState>("idle");
  const [stats, setStats] = useState<CompressionStats | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState("compressed-image");
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<CompressionMode>("lossless");

  const sizeLabel = useMemo(() => (file ? formatBytes(file.size) : "0 B"), [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
    };
  }, [downloadUrl, previewUrl]);

  function onFileChange(selectedFile: File | undefined) {
    clearDownload();
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setStats(null);
    setMessage("");

    if (!selectedFile) {
      setFile(null);
      setPreviewUrl(null);
      setState("idle");
      return;
    }

    if (selectedFile.size > MAX_UPLOAD_BYTES) {
      setFile(null);
      setPreviewUrl(null);
      setState("error");
      setMessage("单文件最大支持 25MB。");
      return;
    }

    setFile(selectedFile);
    setPreviewUrl(URL.createObjectURL(selectedFile));
    setState("ready");
  }

  async function compress() {
    if (!file) {
      return;
    }

    clearDownload();
    setStats(null);
    setMessage("");
    setState("compressing");

    const form = new FormData();
    form.append("file", file);
    form.append("mode", mode);

    try {
      const response = await fetch("/api/compress", {
        method: "POST",
        body: form
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const blob = await response.blob();
      const nextStats = readStats(response.headers);
      const nextDownloadUrl = URL.createObjectURL(blob);

      setStats(nextStats);
      setDownloadName(nextStats.outputFilename);
      setDownloadUrl(nextDownloadUrl);
      setMessage(
        nextStats.mode === "target-size" && nextStats.codec === "sharp-jpeg"
          ? "已压缩到 1MB 内；该模式会重编码图片。"
          : nextStats.status === "compressed"
            ? "压缩完成，像素校验已通过。"
            : "已安全跳过压缩，下载文件保持原图内容。"
      );
      setState("done");
    } catch (error) {
      setMessage(
        isNetworkError(error)
          ? "后端服务未连接或端口代理失败，请重新启动开发服务后再试。"
          : error instanceof Error
            ? error.message
            : "压缩失败。"
      );
      setState("error");
    }
  }

  function clearDownload() {
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
    }
    setDownloadUrl(null);
  }

  return (
    <main className="min-h-screen bg-[#f5f7fb] text-slate-950">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-1 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">JPG / PNG Lossless Compressor</p>
            <h1 className="text-3xl font-semibold tracking-normal text-slate-950">PressApp</h1>
          </div>
          <p className="max-w-xl text-sm leading-6 text-slate-600">
            优先处理 JPG/JPEG，无损转码压缩；PNG 使用无损优化。WebP、GIF、TIFF 会被识别并提示兼容状态。
          </p>
        </header>

        <section className="grid flex-1 gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="flex flex-col gap-4">
            <label
              className="flex min-h-[300px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-white p-8 text-center transition hover:border-slate-500 hover:bg-slate-50"
              htmlFor="image-upload"
            >
              <UploadCloud className="mb-4 size-12 text-slate-500" aria-hidden="true" />
              <span className="text-lg font-semibold text-slate-950">选择图片开始压缩</span>
              <span className="mt-2 text-sm text-slate-500">支持 JPG/JPEG 与 PNG 压缩，最大 25MB</span>
              <input
                id="image-upload"
                className="sr-only"
                type="file"
                accept={accept}
                onChange={(event) => onFileChange(event.target.files?.[0])}
              />
            </label>

            {previewUrl && (
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileImage className="size-5 shrink-0 text-slate-500" aria-hidden="true" />
                    <span className="truncate text-sm font-medium">{file?.name}</span>
                  </div>
                  <span className="text-sm text-slate-500">{sizeLabel}</span>
                </div>
                <div className="flex max-h-[360px] items-center justify-center bg-slate-100 p-4">
                  <img className="max-h-[320px] max-w-full object-contain" src={previewUrl} alt="待压缩图片预览" />
                </div>
              </div>
            )}
          </div>

          <aside className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">压缩结果</h2>
              <StatusBadge state={state} />
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <Metric label="原始大小" value={stats ? formatBytes(stats.originalSize) : sizeLabel} />
              <Metric label="输出大小" value={stats ? formatBytes(stats.compressedSize) : "待生成"} />
              <Metric label="节省比例" value={stats ? `${stats.savedPercent}%` : "待计算"} />
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
              <ModeButton
                active={mode === "lossless"}
                icon={ShieldCheck}
                label="无损"
                onClick={() => setMode("lossless")}
              />
              <ModeButton
                active={mode === "target-size"}
                icon={SlidersHorizontal}
                label="1MB"
                onClick={() => setMode("target-size")}
              />
            </div>

            <p className="text-sm text-slate-500">
              {mode === "lossless"
                ? "无损模式会保留逐像素一致。"
                : `1MB 模式会重编码 JPG，目标 ${formatBytes(DEFAULT_TARGET_SIZE_BYTES)} 以内。`}
            </p>

            {stats && (
              <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                <div className="flex justify-between gap-3">
                  <span>模式</span>
                  <strong>{stats.mode === "target-size" ? "target-size" : "lossless"}</strong>
                </div>
                <div className="flex justify-between gap-3">
                  <span>压缩器</span>
                  <strong>{stats.codec}</strong>
                </div>
                <div className="mt-2 flex justify-between gap-3">
                  <span>像素校验</span>
                  <strong>{stats.verification}</strong>
                </div>
                {stats.targetSize && (
                  <div className="mt-2 flex justify-between gap-3">
                    <span>目标大小</span>
                    <strong>{formatBytes(stats.targetSize)}</strong>
                  </div>
                )}
                {stats.quality && (
                  <div className="mt-2 flex justify-between gap-3">
                    <span>JPEG 质量</span>
                    <strong>{stats.quality}</strong>
                  </div>
                )}
                {stats.skipReason && (
                  <div className="mt-2 flex justify-between gap-3">
                    <span>跳过原因</span>
                    <strong>{stats.skipReason}</strong>
                  </div>
                )}
              </div>
            )}

            {message && (
              <p className={state === "error" ? "text-sm text-red-700" : "text-sm text-slate-600"}>{message}</p>
            )}

            <div className="mt-auto flex flex-col gap-3">
              <button
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                type="button"
                disabled={!file || state === "compressing"}
                onClick={compress}
              >
                {state === "compressing" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <UploadCloud className="size-4" aria-hidden="true" />
                )}
                压缩图片
              </button>

              <a
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-950 transition hover:border-slate-500 disabled:pointer-events-none disabled:opacity-40"
                href={downloadUrl ?? undefined}
                download={downloadName}
                aria-disabled={!downloadUrl}
              >
                <ArrowDownToLine className="size-4" aria-hidden="true" />
                下载结果
              </a>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function ModeButton({
  active,
  icon: Icon,
  label,
  onClick
}: {
  active: boolean;
  icon: typeof ShieldCheck;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition ${
        active ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-950"
      }`}
      type="button"
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon className="size-4" aria-hidden="true" />
      {label}
    </button>
  );
}

function StatusBadge({ state }: { state: UiState }) {
  const config =
    state === "error"
      ? { label: "错误", className: "bg-red-50 text-red-700", icon: XCircle }
      : state === "done"
        ? { label: "完成", className: "bg-emerald-50 text-emerald-700", icon: CheckCircle2 }
        : state === "compressing"
          ? { label: "处理中", className: "bg-amber-50 text-amber-700", icon: Loader2 }
          : { label: "待上传", className: "bg-slate-100 text-slate-600", icon: FileImage };

  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${config.className}`}>
      <Icon className={state === "compressing" ? "size-4 animate-spin" : "size-4"} aria-hidden="true" />
      {config.label}
    </span>
  );
}

function readStats(headers: Headers): CompressionStats {
  return {
    originalSize: Number(headers.get(responseHeaders.originalSize) ?? 0),
    compressedSize: Number(headers.get(responseHeaders.compressedSize) ?? 0),
    savedPercent: Number(headers.get(responseHeaders.savedPercent) ?? 0),
    outputFilename: headers.get(responseHeaders.outputFilename) ?? "compressed-image",
    codec: (headers.get(responseHeaders.codec) as CompressionStats["codec"] | null) ?? "none",
    status: (headers.get(responseHeaders.status) as CompressionStats["status"] | null) ?? "skipped",
    verification:
      (headers.get(responseHeaders.verification) as CompressionStats["verification"] | null) ?? "not-run",
    mode: (headers.get(responseHeaders.mode) as CompressionStats["mode"] | null) ?? "lossless",
    targetSize: Number(headers.get(responseHeaders.targetSize) ?? 0) || undefined,
    quality: Number(headers.get(responseHeaders.quality) ?? 0) || undefined,
    skipReason: headers.get(responseHeaders.skipReason) ?? undefined
  };
}

async function readErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { message?: string };
    return payload.message ?? "压缩失败。";
  } catch {
    return "压缩失败。";
  }
}

function isNetworkError(error: unknown) {
  return error instanceof TypeError || (error instanceof Error && error.message === "Failed to fetch");
}

function formatBytes(bytes: number) {
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;

  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}
