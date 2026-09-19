import koffi from 'koffi';

/**
 * Thin Win32 bindings through koffi (prebuilt FFI, no compiler needed).
 * Everything here is synchronous and cheap enough to call a few times per second.
 */

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const IMAGE_PATH_CAPACITY = 2048; // UTF-16 code units

const LASTINPUTINFO = koffi.struct('LASTINPUTINFO', {
  cbSize: 'uint32',
  dwTime: 'uint32',
});

const EnumWindowsProc = koffi.proto('int __stdcall EnumWindowsProc(void *hwnd, intptr lparam)');

const GetForegroundWindow = user32.func('void * __stdcall GetForegroundWindow()');
const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32 *pid)');
const GetWindowTextLengthW = user32.func('int __stdcall GetWindowTextLengthW(void *hwnd)');
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void *hwnd, void *buffer, int capacity)');
const IsWindowVisible = user32.func('int __stdcall IsWindowVisible(void *hwnd)');
const EnumWindows = user32.func('int __stdcall EnumWindows(EnumWindowsProc *callback, intptr lparam)');
const GetLastInputInfo = user32.func('int __stdcall GetLastInputInfo(_Inout_ LASTINPUTINFO *info)');

const GetTickCount = kernel32.func('uint32 __stdcall GetTickCount()');
const OpenProcess = kernel32.func('void * __stdcall OpenProcess(uint32 access, int inherit, uint32 pid)');
const CloseHandle = kernel32.func('int __stdcall CloseHandle(void *handle)');
const QueryFullProcessImageNameW = kernel32.func(
  'int __stdcall QueryFullProcessImageNameW(void *process, uint32 flags, void *buffer, _Inout_ uint32 *size)',
);

/** Opaque window handle as returned by koffi. */
export type WindowHandle = unknown;

export function getForegroundWindowHandle(): WindowHandle | null {
  return (GetForegroundWindow() as WindowHandle | null) ?? null;
}

export function windowAddress(hwnd: WindowHandle): string {
  return String(koffi.address(hwnd as Parameters<typeof koffi.address>[0]));
}

export function isWindowVisible(hwnd: WindowHandle): boolean {
  return (IsWindowVisible(hwnd) as number) !== 0;
}

export function getWindowPid(hwnd: WindowHandle): number {
  const pid = [0];
  GetWindowThreadProcessId(hwnd, pid);
  return pid[0] ?? 0;
}

export function getWindowTitle(hwnd: WindowHandle): string {
  const length = GetWindowTextLengthW(hwnd) as number;
  if (length <= 0) return '';
  const buffer = Buffer.alloc((length + 1) * 2);
  const copied = GetWindowTextW(hwnd, buffer, length + 1) as number;
  return copied > 0 ? buffer.toString('utf16le', 0, copied * 2) : '';
}

/** Full path of the executable behind `pid`, or null when access is denied. */
export function getProcessImagePath(pid: number): string | null {
  if (pid <= 0) return null;
  const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) as WindowHandle | null;
  if (!handle) return null;
  try {
    const buffer = Buffer.alloc(IMAGE_PATH_CAPACITY * 2);
    const size = [IMAGE_PATH_CAPACITY];
    const ok = QueryFullProcessImageNameW(handle, 0, buffer, size) as number;
    if (!ok) return null;
    return buffer.toString('utf16le', 0, (size[0] ?? 0) * 2);
  } finally {
    CloseHandle(handle);
  }
}

/** Visit every top-level window. Return `false` from the visitor to stop early. */
export function enumerateWindows(visitor: (hwnd: WindowHandle) => boolean | void): void {
  EnumWindows((hwnd: WindowHandle) => (visitor(hwnd) === false ? 0 : 1), 0);
}

/** Milliseconds since the last keyboard/mouse input, session-wide. */
export function getIdleMilliseconds(): number {
  const info = { cbSize: koffi.sizeof(LASTINPUTINFO), dwTime: 0 };
  const ok = GetLastInputInfo(info) as number;
  if (!ok) return 0;
  const now = GetTickCount() as number;
  return (now - info.dwTime) >>> 0;
}
