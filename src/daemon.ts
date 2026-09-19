import fs from 'node:fs';
import path from 'node:path';

import { getPidPath } from './paths.js';

/**
 * Single-instance management through a pid file in `%APPDATA%\warp-discord-windows`.
 * Windows has no SIGTERM handlers to speak of: `stop` simply terminates the
 * process, and Discord clears the presence as soon as the pipe closes.
 */

export function readPid(file: string = getPidPath()): number | null {
  try {
    const pid = Number.parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Pid of another live instance, or null. Stale pid files are ignored. */
export function findRunningInstance(file: string = getPidPath()): number | null {
  const pid = readPid(file);
  if (pid === null || pid === process.pid) return null;
  return isProcessAlive(pid) ? pid : null;
}

export function writePidFile(file: string = getPidPath()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${process.pid}\n`, 'utf8');
}

/** Remove the pid file, but only if it still belongs to this process. */
export function removePidFile(file: string = getPidPath()): void {
  if (readPid(file) === process.pid) fs.rmSync(file, { force: true });
}

/** Terminate the running instance (if any) and return its pid. */
export function stopRunningInstance(file: string = getPidPath()): number | null {
  const pid = findRunningInstance(file);
  if (pid === null) {
    fs.rmSync(file, { force: true });
    return null;
  }
  process.kill(pid);
  fs.rmSync(file, { force: true });
  return pid;
}
