import { mediaFieldRules, type MediaFieldKey, type MediaType } from "@event-arts/shared";
import SparkMD5 from "spark-md5";

export type MediaCandidate = {
  mimeType: string;
  size: number;
  mediaType: MediaType;
  width: number;
  height: number;
};

export type ClientUploadConfig = {
  image: { mimeTypes: readonly string[]; maxBytes: number };
  video: { mimeTypes: readonly string[]; maxBytes: number };
};

export type PreparedMediaFile = MediaCandidate & { file: File; md5: string };

export function validateMediaCandidate(
  candidate: MediaCandidate,
  config: ClientUploadConfig,
  fieldKey?: MediaFieldKey,
  allowedTypes?: readonly MediaType[]
) {
  const typeConfig = config[candidate.mediaType];
  if (!typeConfig.mimeTypes.includes(candidate.mimeType)) {
    return candidate.mediaType === "image" ? "仅支持 JPG、PNG、WebP 图片" : "仅支持 MP4 视频";
  }
  if (candidate.size > typeConfig.maxBytes) {
    return `文件大小不能超过 ${Math.floor(typeConfig.maxBytes / 1024 / 1024)}MB`;
  }
  if (!candidate.width || !candidate.height) return "无法读取资源尺寸";
  if (allowedTypes && !allowedTypes.includes(candidate.mediaType)) {
    const label = allowedTypes.map((type) => (type === "image" ? "图片" : "视频")).join("或");
    return `当前选择器仅支持${label}`;
  }
  if (!fieldKey) return null;
  const rule = mediaFieldRules[fieldKey];
  if (!rule.allowedTypes.includes(candidate.mediaType)) return `${rule.label}不支持该资源类型`;
  return null;
}

function loadImageDimensions(url: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("无法解析图片资源"));
    image.src = url;
  });
}

function loadVideoDimensions(url: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight });
    video.onerror = () => reject(new Error("无法解析视频资源"));
    video.src = url;
  });
}

export async function probeMediaFile(file: File): Promise<MediaCandidate> {
  const mediaType: MediaType = file.type.startsWith("video/") ? "video" : "image";
  const url = URL.createObjectURL(file);
  try {
    const dimensions = mediaType === "video" ? await loadVideoDimensions(url) : await loadImageDimensions(url);
    return { mimeType: file.type, size: file.size, mediaType, ...dimensions };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function calculateFileMd5(file: File, onProgress?: (progress: number) => void) {
  const workerThreshold = 2 * 1024 * 1024;
  if (file.size <= workerThreshold) {
    return file.arrayBuffer().then((buffer) => {
      const spark = new SparkMD5.ArrayBuffer();
      try {
        spark.append(buffer);
        onProgress?.(100);
        return spark.end();
      } finally {
        spark.destroy();
      }
    });
  }

  return new Promise<string>((resolve, reject) => {
    const worker = new Worker(new URL("./md5.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ type: string; progress?: number; md5?: string; message?: string }>) => {
      if (event.data.type === "progress") onProgress?.(event.data.progress ?? 0);
      if (event.data.type === "complete") {
        worker.terminate();
        resolve(event.data.md5 ?? "");
      }
      if (event.data.type === "error") {
        worker.terminate();
        reject(new Error(event.data.message ?? "MD5 计算失败"));
      }
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("MD5 计算失败"));
    };
    worker.postMessage({ file });
  });
}

export async function prepareMediaFile(
  file: File,
  config: ClientUploadConfig,
  fieldKey?: MediaFieldKey,
  onProgress?: (progress: number) => void,
  allowedTypes?: readonly MediaType[]
): Promise<PreparedMediaFile> {
  const candidate = await probeMediaFile(file);
  const problem = validateMediaCandidate(candidate, config, fieldKey, allowedTypes);
  if (problem) throw new Error(problem);
  const md5 = await calculateFileMd5(file, onProgress);
  return { ...candidate, file, md5 };
}
