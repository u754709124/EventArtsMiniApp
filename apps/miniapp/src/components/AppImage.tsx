import { Image } from "@tarojs/components";
import { useEffect, useState } from "react";

type Props = {
  src: string;
  fallback: string;
  className?: string;
  mode?: "aspectFill" | "aspectFit" | "widthFix";
  testid?: string;
};

export function AppImage({ src, fallback, className, mode = "aspectFill", testid }: Props) {
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
      onError={() => setCurrent(fallback)}
    />
  );
}
