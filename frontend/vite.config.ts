import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development (`main.py --dev`), the API runs on a fixed port and Vite proxies
// /api to it, so the UI is served with hot reload. `npm run build` writes dist/,
// which the desktop app serves itself.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8766" },
  },
  // one large script is fine: it is loaded from the same computer
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
