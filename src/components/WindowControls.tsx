import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { isTauri, isWindows } from '../utils';

/**
 * Window controls for the frameless Windows shell.
 *
 * `tauri.conf.json` sets `decorations: false`, which on macOS and Linux is
 * overridden back to `true` by `tauri.macos.conf.json` /
 * `tauri.linux.conf.json` so those platforms keep their native titlebar
 * buttons (macOS traffic lights, Linux WM decorations). Only Windows draws its
 * own, and this renders there exclusively.
 *
 * Renders nothing in the browser and nothing on macOS/Linux.
 */
export const WindowControls: React.FC = () => {
  const visible = isTauri() && isWindows();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!visible) return;
    getCurrentWindow()
      .isMaximized()
      .then(setMaximized)
      .catch(() => {});
  }, [visible]);

  const handleToggleMaximize = useCallback(async () => {
    try {
      await getCurrentWindow().toggleMaximize();
      setMaximized(await getCurrentWindow().isMaximized());
    } catch (e) {
      console.error('[WindowControls] toggleMaximize failed:', e);
    }
  }, []);

  if (!visible) return null;

  // Windows caption buttons are full header height so the hover target lines
  // up with the title bar, rather than floating in the middle of it.
  const buttonClass =
    'flex items-center justify-center w-11 h-full text-zinc-400 transition-colors';

  return (
    <div className="flex items-stretch h-full">
      <button
        type="button"
        onClick={() => getCurrentWindow().minimize().catch(console.error)}
        className={`${buttonClass} hover:bg-zinc-800 hover:text-white`}
        aria-label="Minimize window"
        title="Minimize"
      >
        <Minus className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={handleToggleMaximize}
        className={`${buttonClass} hover:bg-zinc-800 hover:text-white`}
        aria-label={maximized ? 'Restore window' : 'Maximize window'}
        title={maximized ? 'Restore' : 'Maximize'}
      >
        <Square className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => getCurrentWindow().close().catch(console.error)}
        className={`${buttonClass} hover:bg-red-600 hover:text-white`}
        aria-label="Close window"
        title="Close"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
