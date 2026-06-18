import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiOrigin = process.env.TRANSLATE_API_ORIGIN ?? "http://localhost:3000";
const wsOrigin = apiOrigin.replace(/^http/, "ws");

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": apiOrigin,
      "/ws": {
        target: wsOrigin,
        ws: true,
      },
    },
  },
});
