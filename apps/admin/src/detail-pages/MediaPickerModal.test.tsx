// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaAssetDto } from "@event-arts/shared";
import { MediaPickerModal } from "./MediaPickerModal";

const image = { id: 9, mediaType: "image", resourceName: "详情图" } as MediaAssetDto;

vi.mock("../media/MediaLibraryModal", () => ({
  resolveAllowedMediaTypes: (_fieldKey: string, allowedTypes?: readonly string[]) => allowedTypes ?? ["image", "video"],
  MediaLibraryModal: ({ onSelect, headerAction }: { onSelect: (asset: MediaAssetDto) => void; headerAction: ReactNode }) => (
    <div data-testid="mock-library">
      {headerAction}
      <button onClick={() => onSelect(image)}>选择已有图片</button>
    </div>
  )
}));

vi.mock("../media/MediaUploadAction", () => ({
  MediaUploadAction: ({ onAsset }: { onAsset: (asset: MediaAssetDto) => void }) => (
    <button onClick={() => onAsset(image)}>上传新图片</button>
  )
}));

afterEach(cleanup);

describe("MediaPickerModal", () => {
  it("shares the same selection callback between library and upload", () => {
    const onSelect = vi.fn();
    render(
      <MediaPickerModal
        open
        fieldKey="detail.banner"
        allowedTypes={["image"]}
        onCancel={vi.fn()}
        onSelect={onSelect}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "选择已有图片" }));
    fireEvent.click(screen.getByRole("button", { name: "上传新图片" }));
    expect(onSelect).toHaveBeenNthCalledWith(1, image);
    expect(onSelect).toHaveBeenNthCalledWith(2, image);
    expect(screen.getByTestId("media-picker-modal")).toBeTruthy();
  });
});
