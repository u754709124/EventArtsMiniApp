import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  test: {
    testTimeout: 15000
  },
  build: {
    manifest: true,
    chunkSizeWarningLimit: 500,
    rolldownOptions: {
      output: {
        codeSplitting: {
          maxSize: 420 * 1024,
          groups: [
            {
              name: "framework",
              test: /node_modules[\\/](react|react-dom|react-router-dom)[\\/]/,
              entriesAware: true,
              priority: 40
            },
            {
              name: "antd",
              test: /node_modules[\\/](@ant-design|antd|rc-|@rc-component)[\\/]/,
              entriesAware: true,
              entriesAwareMergeThreshold: 8 * 1024,
              maxSize: 420 * 1024,
              priority: 30
            },
            {
              name: "editor",
              test: /node_modules[\\/](@tiptap|prosemirror-)[\\/]/,
              entriesAware: true,
              maxSize: 420 * 1024,
              priority: 35
            },
            {
              name: "shared-vendor",
              test: /node_modules[\\/]/,
              entriesAware: true,
              entriesAwareMergeThreshold: 8 * 1024,
              maxSize: 420 * 1024,
              priority: 10
            }
          ]
        }
      }
    }
  },
  resolve: {
    alias: {
      "@event-arts/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url))
    }
  },
  server: {
    port: 5173,
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: process.env.VITE_API_BASE_URL || "http://127.0.0.1:3001",
        changeOrigin: true
      }
    }
  }
});
