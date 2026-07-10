import { Image } from "@tarojs/components";
import { useState } from "react";

type Props = {
  src: string;
  fallback: string;
  className?: string;
  mode?: "aspectFill" | "aspectFit" | "widthFix";
  testid?: string;
};

export function AppImage({ src, fallback, className, mode = "aspectFill", testid }: Props) {
  const [current, setCurrent] = useState(src || fallback);
  return (
    <Image
      className={className}
      data-current-src={current || fallback}
      data-testid={testid}
      mode={mode}
      src={current || fallback}
      onError={() => setCurrent(fallback)}
    />
  );
}
