import { Image } from "@tarojs/components";
import { useEffect, useState } from "react";

type Props = {
  src: string;
  fallback?: string;
  className?: string;
  mode?: "scaleToFill" | "aspectFill" | "aspectFit" | "widthFix";
  testid?: string;
  onError?: (source: string) => void;
  onLoad?: (source: string) => void;
};

export function AppImage({
  src,
  fallback,
  className,
  mode = "scaleToFill",
  testid,
  onError,
  onLoad
}: Props) {
  const [current, setCurrent] = useState(src || fallback || "");
  useEffect(() => setCurrent(src || fallback || ""), [fallback, src]);

  if (!current) return null;

  return (
    <Image
      className={className}
      data-current-src={current}
      data-testid={testid}
      mode={mode}
      src={current}
      aria-label="详情图片"
      onLoad={() => {
        if (current === src) onLoad?.(src);
      }}
      onError={() => {
        onError?.(src);
        setCurrent(current !== fallback ? fallback || "" : "");
      }}
    />
  );
}
