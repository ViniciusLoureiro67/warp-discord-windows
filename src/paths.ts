import os from 'node:os';
import path from 'node:path';

import { APP_NAME } from './constants.js';

export type Env = Record<string, string | undefined>;

/** `%APPDATA%`, with a sane fallback when the variable is missing. */
export function getRoamingAppData(env: Env = process.env): string {
  const appData = env.APPDATA;
  return appData && appData.length > 0 ? appData : path.join(os.homedir(), 'AppData', 'Roaming');
}

/** Where config, logs and the pid file live: `%APPDATA%\warp-discord-windows`. */
export function getDataDir(env: Env = process.env): string {
  return path.join(getRoamingAppData(env), APP_NAME);
}

export function getConfigPath(env: Env = process.env): string {
  return path.join(getDataDir(env), 'config.json');
}

export function getLogPath(env: Env = process.env): string {
  return path.join(getDataDir(env), `${APP_NAME}.log`);
}

export function getPidPath(env: Env = process.env): string {
  return path.join(getDataDir(env), `${APP_NAME}.pid`);
}

/** The per-user Startup folder Windows runs at login. */
export function getStartupDir(env: Env = process.env): string {
  return path.join(getRoamingAppData(env), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

export function getAutostartScriptPath(env: Env = process.env): string {
  return path.join(getStartupDir(env), `${APP_NAME}.vbs`);
}
