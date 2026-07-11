import { Image } from "@tarojs/components";
import { useEffect, useState } from "react";

type Props = {
  src: string;
  fallback: string;
  className?: string;
  mode?: "aspectFill" | "aspectFit" | "widthFix";
  testid?: string;
  onError?: (source: string) => void;
  onLoad?: (source: string) => void;
};

export function AppImage({
  src,
  fallback,
  className,
  mode = "aspectFill",
  testid,
  onError,
  onLoad
}: Props) {
  const [current, setCurrent] = useState(src || fallback);
  useEffect(() => setCurrent(src || fallback), [fallback, src]);
  return (
    <Image
      className={className}
      data-current-src={current || fallback}
      data-testid={testid}
      mode={mode}
      src={current || fallback}
      aria-label="详情图片"
      onLoad={() => {
        if (current === src) onLoad?.(src);
      }}
      onError={() => {
        onError?.(src);
        setCurrent(fallback);
      }}
    />
  );
}
