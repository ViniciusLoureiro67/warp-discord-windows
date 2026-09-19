import path from 'node:path';

import {
  enumerateWindows,
  getForegroundWindowHandle,
  getIdleMilliseconds,
  getProcessImagePath,
  getWindowPid,
  getWindowTitle,
  isWindowVisible,
  windowAddress,
} from './native.js';

export const WARP_EXECUTABLE = 'warp.exe';

export interface WarpWindow {
  pid: number;
  title: string;
  focused: boolean;
}

export interface WarpSnapshot {
  /** At least one visible Warp window exists. */
  running: boolean;
  /** The foreground window belongs to Warp. */
  focused: boolean;
  /** Title of the focused Warp window, or of any titled Warp window. */
  title: string | null;
  windows: WarpWindow[];
  /** Milliseconds since the last user input anywhere in the session. */
  idleMs: number;
}

export function isWarpImage(imagePath: string | null): boolean {
  return imagePath !== null && path.win32.basename(imagePath).toLowerCase() === WARP_EXECUTABLE;
}

/** Inspect the desktop once: which Warp windows exist, whether one is focused, and its title. */
export function takeSnapshot(): WarpSnapshot {
  const foreground = getForegroundWindowHandle();
  const foregroundAddress = foreground ? windowAddress(foreground) : null;
  const imageCache = new Map<number, string | null>();
  const imageOf = (pid: number): string | null => {
    if (!imageCache.has(pid)) imageCache.set(pid, getProcessImagePath(pid));
    return imageCache.get(pid) ?? null;
  };

  const windows: WarpWindow[] = [];
  enumerateWindows((hwnd) => {
    if (!isWindowVisible(hwnd)) return;
    const pid = getWindowPid(hwnd);
    if (!isWarpImage(imageOf(pid))) return;
    windows.push({
      pid,
      title: getWindowTitle(hwnd),
      focused: foregroundAddress !== null && windowAddress(hwnd) === foregroundAddress,
    });
  });

  const focusedWindow = windows.find((window) => window.focused);
  const titledWindow = windows.find((window) => window.title.length > 0);
  const title = focusedWindow?.title || titledWindow?.title || null;

  return {
    running: windows.length > 0,
    focused: focusedWindow !== undefined,
    title,
    windows,
    idleMs: getIdleMilliseconds(),
  };
}
