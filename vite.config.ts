import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  
  return {
    plugins: [react(), tailwindcss()],
    build: {
      chunkSizeWarningLimit: 5000,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
    define: {
      "import.meta.env.PUSHER_KEY": JSON.stringify(env.PUSHER_KEY || ""),
      "import.meta.env.PUSHER_CLUSTER": JSON.stringify(env.PUSHER_CLUSTER || "ap1"),
    },
    server: {
      hmr: process.env.DISABLE_HMR !== "true",
    },
  };
});
