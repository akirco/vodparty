/// <reference types="vite/client" />

/**
 * Build-time constants injected by `define` in vite.config.ts.
 *
 * Declared as bare identifiers (not `import.meta.env`) because Vite does not
 * expose non-`VITE_`-prefixed variables. Keep this in sync with the `define`
 * block in vite.config.ts.
 */
declare const __PUSHER_APP_ID__: string;
declare const __PUSHER_KEY__: string;
declare const __PUSHER_CLUSTER__: string;
declare const __PUSHER_AUTH_ENDPOINT__: string;

interface ImportMetaEnv {
  readonly VITE_PUSHER_KEY: string;
  readonly VITE_PUSHER_CLUSTER: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
