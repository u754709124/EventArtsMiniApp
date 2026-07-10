/// <reference lib="webworker" />
import SparkMD5 from "spark-md5";

self.onmessage = async (event: MessageEvent<{ file: File }>) => {
  const file = event.data.file;
  const chunkSize = 2 * 1024 * 1024;
  const chunks = Math.ceil(file.size / chunkSize);
  const spark = new SparkMD5.ArrayBuffer();
  try {
    for (let index = 0; index < chunks; index += 1) {
      const start = index * chunkSize;
      const buffer = await file.slice(start, Math.min(start + chunkSize, file.size)).arrayBuffer();
      spark.append(buffer);
      self.postMessage({ type: "progress", progress: Math.round(((index + 1) / chunks) * 100) });
    }
    self.postMessage({ type: "complete", md5: spark.end() });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "MD5 计算失败" });
  } finally {
    spark.destroy();
  }
};
