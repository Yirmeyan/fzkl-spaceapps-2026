import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function page(name: string): string {
  return fileURLToPath(new URL(name, import.meta.url));
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Local and Cloudflare Pages both use "/". Override with VITE_BASE if needed.
  base: process.env.VITE_BASE ?? "/",
  build: {
    rollupOptions: {
      // Two pages: the explorer, and the sky map beside it.
      input: { main: page("index.html"), sky: page("sky.html") },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
  },
});
