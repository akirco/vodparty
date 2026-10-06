import { useCallback, useRef } from 'react';

export const isTauri = () => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

/**
 * Whether the app is running in the Windows shell.
 *
 * Only Windows draws custom window controls: macOS and Linux get their native
 * titlebar buttons (see tauri.macos.conf.json / tauri.linux.conf.json), so the
 * in-app ones would be redundant there.
 *
 * Detected from the user agent rather than @tauri-apps/plugin-os: the webview
 * UA reliably distinguishes the three shells (WebView2 -> "Windows NT",
 * WKWebView -> "Macintosh", WebKitGTK -> "X11; Linux"), and it avoids pulling
 * in a whole plugin for one boolean.
 */
export const isWindows = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return /Windows/i.test(navigator.userAgent);
};

export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export function useSpotlight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const handleMouseMove = useCallback((e: React.MouseEvent<T>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    ref.current.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    ref.current.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
  }, []);
  return { ref, handleMouseMove };
}

export function appendUrlParam(baseUrl: string, param: string): string {
  return baseUrl.includes('?') ? `${baseUrl}&${param}` : `${baseUrl}?${param}`;
}
