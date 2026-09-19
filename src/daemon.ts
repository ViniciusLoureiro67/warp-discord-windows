import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { queryControl, type ControlStatus } from './control.js';
import { getPidPath } from './paths.js';

/**
 * Instance management. A running instance answers on the control pipe; the
 * pid file is only a fallback for instances that stopped answering.
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

export function writePidFile(file: string = getPidPath()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${process.pid}\n`, 'utf8');
}

/** Remove the pid file, but only if it still belongs to this process. */
export function removePidFile(file: string = getPidPath()): void {
  if (readPid(file) === process.pid) fs.rmSync(file, { force: true });
}

/**
 * Whether `pid` runs the same executable as us (node.exe). Guards the fallback
 * kill against pid reuse. Returns true when it cannot be determined.
 */
export function runsSameExecutable(pid: number): boolean {
  try {
    const output = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    const match = /^"([^"]+)"/m.exec(output);
    if (!match) return false;
    return match[1]!.toLowerCase() === path.basename(process.execPath).toLowerCase();
  } catch {
    return true;
  }
}

/** Status of the running instance, or null when none answers. */
export async function queryInstance(): Promise<ControlStatus | null> {
  const reply = await queryControl('status');
  return reply && reply.ok && 'status' in reply ? reply.status : null;
}

/** Pid of a live instance: the one answering on the control pipe, else a live pid file. */
export async function findRunningInstance(file: string = getPidPath()): Promise<number | null> {
  const status = await queryInstance();
  if (status) return status.pid;
  const pid = readPid(file);
  if (pid === null || pid === process.pid) return null;
  return isProcessAlive(pid) && runsSameExecutable(pid) ? pid : null;
}

export interface StopResult {
  pid: number;
  /** True when the instance shut itself down (presence cleared), false when it had to be killed. */
  graceful: boolean;
}

function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const check = (): void => {
      if (!isProcessAlive(pid)) return resolve(true);
      if (Date.now() - started > timeoutMs) return resolve(false);
      setTimeout(check, 100);
    };
    check();
  });
}

/** Stop the running instance, gracefully when it answers, by force otherwise. */
export async function stopInstance(file: string = getPidPath()): Promise<StopResult | null> {
  const reply = await queryControl('stop');
  if (reply && reply.ok && 'pid' in reply) {
    const exited = await waitForExit(reply.pid, 5000);
    if (!exited && isProcessAlive(reply.pid)) process.kill(reply.pid);
    fs.rmSync(file, { force: true });
    return { pid: reply.pid, graceful: exited };
  }

  const pid = readPid(file);
  if (pid === null) return null;
  if (!isProcessAlive(pid) || !runsSameExecutable(pid)) {
    fs.rmSync(file, { force: true });
    return null;
  }
  process.kill(pid);
  fs.rmSync(file, { force: true });
  return { pid, graceful: false };
}
