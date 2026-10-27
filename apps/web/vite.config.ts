import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// In development the API is reached through the same origin under /api. The API serves everything
// under /api, so the proxy forwards paths unchanged. In production the API server also serves the
// built web app, which keeps everything same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: { "/api": { target: "http://localhost:3000", changeOrigin: false } },
  },
});
