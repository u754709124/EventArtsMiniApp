import { message } from "antd";
import type { MediaAssetDto, MediaFieldKey, MediaType } from "@event-arts/shared";
import { MediaLibraryModal, resolveAllowedMediaTypes } from "../media/MediaLibraryModal";
import { MediaUploadAction } from "../media/MediaUploadAction";

export type MediaPickerModalProps = {
  open: boolean;
  fieldKey?: MediaFieldKey;
  allowedTypes?: readonly MediaType[];
  onCancel: () => void;
  onSelect: (asset: MediaAssetDto) => void;
  testid?: string;
};

export function MediaPickerModal({
  open,
  fieldKey,
  allowedTypes: requestedTypes,
  onCancel,
  onSelect,
  testid = "media-picker-modal"
}: MediaPickerModalProps) {
  const allowedTypes = resolveAllowedMediaTypes(fieldKey, requestedTypes);

  function select(asset: MediaAssetDto) {
    if (!allowedTypes.includes(asset.mediaType)) {
      message.warning("所选资源类型不符合当前字段要求");
      return;
    }
    onSelect(asset);
  }

  return (
    <div data-testid={testid}>
      <MediaLibraryModal
        open={open}
        fieldKey={fieldKey}
        allowedTypes={allowedTypes}
        onCancel={onCancel}
        onSelect={select}
        headerAction={
          <MediaUploadAction
            fieldKey={fieldKey}
            allowedTypes={allowedTypes}
            onAsset={select}
            testid={`${testid}-upload`}
            label="上传并选择"
          />
        }
      />
    </div>
  );
}
