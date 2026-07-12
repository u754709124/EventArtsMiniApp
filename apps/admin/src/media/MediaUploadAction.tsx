import { useRef, useState } from "react";
import { Button, Form, Input, Modal, Progress, Select, message } from "antd";
import { type MediaAssetDto, type MediaFieldKey, type MediaType, type MediaUploadConfigDto } from "@event-arts/shared";
import { request } from "../api";
import { useRepeatClickGuard } from "../utils/repeat-click-guard";
import { prepareMediaFile, validateMediaCandidate, type PreparedMediaFile } from "./media-file";
import { resolveAllowedMediaTypes } from "./MediaLibraryModal";

let configPromise: Promise<MediaUploadConfigDto> | null = null;
function loadConfig() {
  configPromise ??= request<MediaUploadConfigDto>("/api/admin/media-assets/upload-config").catch((error) => {
    configPromise = null;
    throw error;
  });
  return configPromise;
}

export function mediaAcceptForTypes(allowedTypes: readonly MediaType[]) {
  const accept: string[] = [];
  if (allowedTypes.includes("image")) accept.push("image/jpeg", "image/png", "image/webp");
  if (allowedTypes.includes("video")) accept.push("video/mp4");
  return accept.join(",");
}

export function MediaUploadAction({
  fieldKey,
  allowedTypes: requestedTypes,
  onAsset,
  testid = "media-action-upload",
  label = "从本地上传"
}: {
  fieldKey?: MediaFieldKey;
  allowedTypes?: readonly MediaType[];
  onAsset: (asset: MediaAssetDto) => void;
  testid?: string;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<PreparedMediaFile | null>(null);
  const [resourceName, setResourceName] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const allowedTypes = resolveAllowedMediaTypes(fieldKey, requestedTypes);
  const clickGuard = useRepeatClickGuard();

  async function choose(file: File) {
    if (busy) return;
    setBusy(true);
    setProgress(0);
    try {
      const config = await loadConfig();
      const prepared = await prepareMediaFile(file, config, fieldKey, setProgress, allowedTypes);
      const duplicate = await request<{ asset: MediaAssetDto | null }>("/api/admin/media-assets/lookup", {
        method: "POST",
        body: JSON.stringify({ md5: prepared.md5, size: prepared.size })
      });
      if (duplicate.asset) {
        const problem = validateMediaCandidate(
          {
            mimeType: duplicate.asset.mimeType,
            size: duplicate.asset.size,
            mediaType: duplicate.asset.mediaType,
            width: duplicate.asset.width ?? 0,
            height: duplicate.asset.height ?? 0
          },
          config,
          fieldKey,
          allowedTypes
        );
        if (problem) throw new Error(problem);
        message.info("已存在相同资源，已直接复用");
        onAsset(duplicate.asset);
        return;
      }
      setDraft(prepared);
      setResourceName(file.name);
      setTags([]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "文件处理失败");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function upload() {
    if (busy || !draft || !resourceName.trim()) return;
    setBusy(true);
    try {
      const availability = await request<{ available: boolean }>("/api/admin/media-assets/check-name", {
        method: "POST",
        body: JSON.stringify({ resourceName })
      });
      if (!availability.available) throw new Error("资源名称已存在，请更换");
      const form = new FormData();
      form.append("resourceName", resourceName);
      form.append("md5", draft.md5);
      form.append("tags", JSON.stringify(tags));
      if (fieldKey) form.append("fieldKey", fieldKey);
      form.append("file", draft.file);
      const result = await request<{ asset: MediaAssetDto; reused: boolean }>("/api/admin/media-assets/upload", {
        method: "POST",
        body: form
      });
      message.success(result.reused ? "已复用已有资源" : "上传成功");
      setDraft(null);
      onAsset(result.asset);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }

  const accept = mediaAcceptForTypes(allowedTypes);
  const missingResourceName = Boolean(draft) && !resourceName.trim();

  return (
    <>
      <input
        ref={inputRef}
        data-testid={`${testid}-input`}
        type="file"
        hidden
        accept={accept}
        onChange={(event) => event.target.files?.[0] && clickGuard(`${testid}:choose`, () => choose(event.target.files![0]))}
      />
      <Button data-testid={testid} loading={busy} disabled={busy} onClick={() => clickGuard(`${testid}:open`, () => inputRef.current?.click())}>{label}</Button>
      {busy && progress > 0 && progress < 100 && <Progress percent={progress} size="small" />}
      <Modal
        title="上传资源"
        open={Boolean(draft)}
        okText="上传"
        cancelText="取消"
        okButtonProps={{ "data-testid": `${testid}-confirm`, disabled: missingResourceName }}
        confirmLoading={busy}
        onOk={() => clickGuard(`${testid}:upload`, upload)}
        onCancel={() => setDraft(null)}
      >
        <Form layout="vertical">
          <Form.Item label="资源名" required validateStatus={missingResourceName ? "error" : undefined} help={missingResourceName ? "请输入资源名称" : undefined}>
            <Input data-testid="media-resource-name" value={resourceName} onChange={(event) => setResourceName(event.target.value)} />
          </Form.Item>
          <Form.Item label="标签">
            <Select data-testid="media-resource-tags" mode="tags" value={tags} onChange={setTags} tokenSeparators={[",", "，"]} />
          </Form.Item>
          {draft && <p>实际尺寸：{draft.width}×{draft.height}，MD5：{draft.md5}</p>}
        </Form>
      </Modal>
    </>
  );
}
