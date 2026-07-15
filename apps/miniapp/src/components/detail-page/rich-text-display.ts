import { enhanceDetailRichTextForPresentation } from "@event-arts/shared/detail-page-presentation";

export function enhanceDetailRichTextForDisplay(html: string) {
  return enhanceDetailRichTextForPresentation(html, { headingFontSize: "30rpx" });
}
