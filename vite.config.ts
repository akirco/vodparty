import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

import { defineConfig, loadEnv } from 'vite';

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), tailwindcss()],
    clearScreen: false,
    build: {
      // Realistic budget for the largest chunk (hls.js) instead of the 5000
      // that was hiding the single 1MB entry bundle.
      chunkSizeWarningLimit: 400,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            // hls.js is only needed once a video starts playing.
            if (/node_modules[\\/]hls\.js[\\/]/.test(id)) return 'vendor-hls';
            // Watch-party realtime, loaded with the player route.
            if (
              /node_modules[\\/](pusher-js|socket\.io-client|engine\.io-client|socket\.io-parser|socket\.io)[\\/]/.test(
                id,
              )
            )
              return 'vendor-realtime';
            // Shared framework code referenced by every route.
            if (
              /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(
                id,
              )
            )
              return 'vendor-react';
            return undefined;
          },
        },
      },
    },
    // Points at ./src (the app source) rather than the repo root, so an
    // `@/...` import cannot accidentally resolve to a config file.
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    // Injected as bare identifiers rather than `import.meta.env.*`.
    //
    // Vite only exposes `VITE_`-prefixed vars on `import.meta.env`, so reading
    // `import.meta.env.PUSHER_KEY` in application code was always undefined
    // unless it was declared here -- and two of the four were not declared, so
    // `PUSHER_APP_ID` / `PUSHER_AUTH_ENDPOINT` silently resolved to undefined.
    define: {
      __PUSHER_APP_ID__: JSON.stringify(env.PUSHER_APP_ID || ''),
      __PUSHER_KEY__: JSON.stringify(env.PUSHER_KEY || ''),
      __PUSHER_CLUSTER__: JSON.stringify(env.PUSHER_CLUSTER || 'ap1'),
      __PUSHER_AUTH_ENDPOINT__: JSON.stringify(
        env.PUSHER_AUTH_ENDPOINT || '/.netlify/functions/pusher-auth',
      ),
    },
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: 'ws',
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        ignored: ['**/src-tauri/**'],
      },
    },
  };
});
