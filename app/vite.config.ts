import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { inspectAttr } from "kimi-plugin-inspect-react";
import path from "path";

const __dirname = import.meta.dirname;

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [
    // inspectAttr() injects data-inspect attributes in dev only; in production
    // builds it interferes with SPA mount on cold route loads (blank page).
    ...(command === "serve" ? [inspectAttr()] : []),
    react(),
  ],
  server: {
    port: 5173,
    /* S10 T1: proxy REST calls to the production backend (dev only). */
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
      "db": path.resolve(__dirname, "./db"),
    },
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
}));
