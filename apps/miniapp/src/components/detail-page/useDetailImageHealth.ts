import Taro from "@tarojs/taro";
import { useEffect, useRef, useState } from "react";
import { checkDetailImageHealth, type DetailImageHealthChecker } from "./media-health";

async function checkImageWithTaro(url: string) {
  await Taro.getImageInfo({ src: url });
}

export function useDetailImageHealth(
  imageUrls: string[],
  checker: DetailImageHealthChecker = checkImageWithTaro
) {
  const [attempt, setAttempt] = useState(0);
  const [checking, setChecking] = useState(false);
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const requestSequence = useRef(0);
  const signature = imageUrls.join("\u0000");

  useEffect(() => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    if (!imageUrls.length) {
      setChecking(false);
      setFailedUrls([]);
      return;
    }
    setChecking(true);
    void checkDetailImageHealth(imageUrls, checker).then((failed) => {
      if (requestSequence.current !== sequence) return;
      setFailedUrls(failed);
      setChecking(false);
    });
    return () => {
      requestSequence.current += 1;
    };
  }, [attempt, checker, signature]);

  return {
    checking,
    failedUrls,
    richTextRetryKey: attempt,
    retry: () => setAttempt((value) => value + 1)
  };
}
