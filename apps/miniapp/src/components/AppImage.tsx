import { Image } from "@tarojs/components";
import { useState } from "react";

type Props = {
  src: string;
  fallback: string;
  className?: string;
  mode?: "aspectFill" | "aspectFit" | "widthFix";
};

export function AppImage({ src, fallback, className, mode = "aspectFill" }: Props) {
  const [current, setCurrent] = useState(src || fallback);
  return <Image className={className} mode={mode} src={current || fallback} onError={() => setCurrent(fallback)} />;
}
