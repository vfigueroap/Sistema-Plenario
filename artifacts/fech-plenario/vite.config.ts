import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const rawPort = process.env.PORT ?? "5173";

const port = Number(rawPort);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";
const apiTarget = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3001";

export default defineConfig({
  base: basePath,
  // Vercel uses independent HTTP invocations, not the local Socket.IO server.
  // Keep this build choice public and explicit; never expose server secrets.
  ...(process.env.VERCEL === "1" ? {
    define: { "import.meta.env.VITE_REALTIME_TRANSPORT": JSON.stringify("polling") },
  } : {}),
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    proxy: {
      "/api": { target: apiTarget, ws: true },
    },
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
  },
});
