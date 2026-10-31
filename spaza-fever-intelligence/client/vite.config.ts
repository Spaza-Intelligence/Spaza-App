import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "@shared": path.resolve(__dirname, "../shared") } },
  server: { port: 5173, host: "0.0.0.0", proxy: { "/api": process.env.VITE_API_PROXY_TARGET || "http://localhost:3001" } },
  build: { outDir: path.resolve(__dirname, "../dist/client"), emptyOutDir: true },
});
