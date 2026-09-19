import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_CLIENT_ID } from './constants.js';
import type { ActivityButton } from './discord/ipc.js';
import { getConfigPath, type Env } from './paths.js';

export interface PresenceText {
  /** Top line while the shell sits at the prompt; placeholders: {folder}, {path}, {title}. */
  directory: string;
  /** Top line while a command runs; placeholders: {program}, {command}, {title}. */
  command: string;
  /** Top line for tools that name the session (Claude Code and friends); placeholder: {title}. */
  task: string;
  /** Top line when the window title is hidden, empty or not understood. */
  noTitle: string;
  /** Bottom line while Warp is the foreground window. */
  focused: string;
  /** Bottom line while Warp is open but another window has focus. */
  background: string;
  /** Bottom line after `idleAfterMinutes` without keyboard/mouse input. */
  idle: string;
}

export interface Config {
  /** Discord application id. Empty means "not configured". */
  clientId: string;
  /** How often the desktop is inspected, in milliseconds. */
  pollIntervalMs: number;
  /** Minutes without input before the presence switches to the idle text. 0 disables. */
  idleAfterMinutes: number;
  /** Show the Warp window title (usually your current directory or command). */
  showWindowTitle: boolean;
  /** Keep the presence while Warp is open but not focused. */
  showInBackground: boolean;
  /** Show the "elapsed" timer counting from when Warp was first seen. */
  showElapsedTime: boolean;
  /** 0 = Playing, 2 = Listening, 3 = Watching, 5 = Competing. */
  activityType: number;
  /** Rich Presence art asset keys uploaded to the Discord application. */
  largeImageKey: string;
  largeImageText: string;
  smallImageKey: string;
  smallImageText: string;
  /** Up to two buttons shown to other people on your profile. */
  buttons: ActivityButton[];
  text: PresenceText;
}

export const DEFAULT_CONFIG: Config = {
  clientId: DEFAULT_CLIENT_ID,
  pollIntervalMs: 2000,
  idleAfterMinutes: 5,
  showWindowTitle: true,
  showInBackground: true,
  showElapsedTime: true,
  activityType: 0,
  largeImageKey: 'warp',
  largeImageText: 'Warp Terminal',
  smallImageKey: 'windows',
  smallImageText: 'Windows',
  buttons: [],
  text: {
    directory: 'Working in {folder}',
    command: 'Running {program}',
    task: 'Working on {title}',
    noTitle: 'In the terminal',
    focused: 'Focused',
    background: 'In the background',
    idle: 'Idle',
  },
};

export const ALLOWED_ACTIVITY_TYPES = [0, 2, 3, 5];
export const MIN_POLL_INTERVAL_MS = 500;
export const MAX_BUTTONS = 2;
export const MAX_BUTTON_LABEL_LENGTH = 32;

export interface LoadedConfig {
  config: Config;
  path: string;
  /** Whether a config file exists on disk (otherwise defaults are in effect). */
  exists: boolean;
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function readButtons(value: unknown, warnings: string[]): ActivityButton[] {
  if (!Array.isArray(value)) {
    warnings.push('"buttons" must be an array of { label, url }; ignored');
    return [];
  }
  const buttons: ActivityButton[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.label !== 'string' || typeof entry.url !== 'string') {
      warnings.push('"buttons" entries must look like { "label": "...", "url": "https://..." }; entry ignored');
      continue;
    }
    const label = entry.label.trim();
    const url = entry.url.trim();
    if (label.length === 0 || label.length > MAX_BUTTON_LABEL_LENGTH) {
      warnings.push(`button label "${label}" must be 1-${MAX_BUTTON_LABEL_LENGTH} characters; entry ignored`);
      continue;
    }
    if (!isValidUrl(url)) {
      warnings.push(`button url "${url}" must start with http:// or https://; entry ignored`);
      continue;
    }
    buttons.push({ label, url });
  }
  if (buttons.length > MAX_BUTTONS) {
    warnings.push(`Discord shows at most ${MAX_BUTTONS} buttons; extra entries ignored`);
    return buttons.slice(0, MAX_BUTTONS);
  }
  return buttons;
}

function readText(value: unknown, warnings: string[]): PresenceText {
  const text = { ...DEFAULT_CONFIG.text };
  if (!isRecord(value)) {
    warnings.push('"text" must be an object; ignored');
    return text;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!(key in text)) {
      warnings.push(`unknown option "text.${key}" ignored`);
      continue;
    }
    if (typeof entry !== 'string') {
      warnings.push(`"text.${key}" must be a string; ignored`);
      continue;
    }
    text[key as keyof PresenceText] = entry;
  }
  return text;
}

/** Merge a parsed JSON value on top of the defaults, validating every option. */
export function mergeConfig(raw: unknown, warnings: string[] = []): Config {
  const config = structuredClone(DEFAULT_CONFIG);
  if (raw === undefined || raw === null) return config;
  if (!isRecord(raw)) {
    warnings.push('config must be a JSON object; using defaults');
    return config;
  }

  const target = config as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in DEFAULT_CONFIG)) {
      warnings.push(`unknown option "${key}" ignored`);
      continue;
    }
    if (key === 'buttons') {
      config.buttons = readButtons(value, warnings);
      continue;
    }
    if (key === 'text') {
      config.text = readText(value, warnings);
      continue;
    }
    const expected = typeof (DEFAULT_CONFIG as unknown as Record<string, unknown>)[key];
    if (typeof value !== expected) {
      warnings.push(`"${key}" must be a ${expected}; ignored`);
      continue;
    }
    target[key] = value;
  }

  config.clientId = config.clientId.trim();
  if (config.clientId.length > 0 && !/^\d{15,25}$/.test(config.clientId)) {
    warnings.push(`"clientId" does not look like a Discord application id (expected 15-25 digits): "${config.clientId}"`);
  }
  if (!Number.isFinite(config.pollIntervalMs) || config.pollIntervalMs < MIN_POLL_INTERVAL_MS) {
    warnings.push(`"pollIntervalMs" must be at least ${MIN_POLL_INTERVAL_MS}; using ${MIN_POLL_INTERVAL_MS}`);
    config.pollIntervalMs = MIN_POLL_INTERVAL_MS;
  }
  if (!Number.isFinite(config.idleAfterMinutes) || config.idleAfterMinutes < 0) {
    warnings.push('"idleAfterMinutes" must be 0 or more; using default');
    config.idleAfterMinutes = DEFAULT_CONFIG.idleAfterMinutes;
  }
  if (!ALLOWED_ACTIVITY_TYPES.includes(config.activityType)) {
    warnings.push(`"activityType" must be one of ${ALLOWED_ACTIVITY_TYPES.join(', ')}; using 0`);
    config.activityType = 0;
  }
  return config;
}

/** Read `%APPDATA%\warp-discord-windows\config.json` (if any) and apply env overrides. */
export function loadConfig(env: Env = process.env): LoadedConfig {
  const file = getConfigPath(env);
  const warnings: string[] = [];
  let raw: unknown;
  let exists = false;

  try {
    const text = fs.readFileSync(file, 'utf8');
    exists = true;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      warnings.push(`could not parse ${file} (${errorMessage(error)}); using defaults`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      warnings.push(`could not read ${file} (${errorMessage(error)}); using defaults`);
    }
  }

  const config = mergeConfig(raw, warnings);
  const envClientId = env.WARP_DISCORD_CLIENT_ID?.trim();
  if (envClientId) config.clientId = envClientId;
  return { config, path: file, exists, warnings };
}

export function saveConfig(config: Config, file: string = getConfigPath()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function configKeys(): string[] {
  const keys = Object.keys(DEFAULT_CONFIG).filter((key) => key !== 'text');
  return [...keys, ...Object.keys(DEFAULT_CONFIG.text).map((key) => `text.${key}`)];
}

export function getConfigValue(config: Config, key: string): unknown {
  const [head, ...rest] = key.split('.');
  if (head === 'text' && rest.length === 1 && rest[0]! in config.text) {
    return config.text[rest[0] as keyof PresenceText];
  }
  if (rest.length === 0 && head !== undefined && head in DEFAULT_CONFIG) {
    return (config as unknown as Record<string, unknown>)[head];
  }
  throw new Error(`unknown option "${key}". Known options: ${configKeys().join(', ')}`);
}

function parseBoolean(raw: string, key: string): boolean {
  const value = raw.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off'].includes(value)) return false;
  throw new Error(`"${key}" expects true or false, got "${raw}"`);
}

function parseNumber(raw: string, key: string): number {
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) throw new Error(`"${key}" expects a number, got "${raw}"`);
  return value;
}

function parseButtons(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('"buttons" expects JSON, e.g. [{"label":"My site","url":"https://example.com"}]');
  }
}

/** Return a copy of `config` with `key` (dotted paths allowed) set from a CLI string. */
export function withConfigValue(config: Config, key: string, rawValue: string): Config {
  const next = structuredClone(config);
  const [head, ...rest] = key.split('.');

  if (head === 'text' && rest.length === 1 && rest[0]! in DEFAULT_CONFIG.text) {
    next.text[rest[0] as keyof PresenceText] = rawValue;
    return next;
  }
  if (head === undefined || rest.length > 0 || !(head in DEFAULT_CONFIG)) {
    throw new Error(`unknown option "${key}". Known options: ${configKeys().join(', ')}`);
  }

  const target = next as unknown as Record<string, unknown>;
  if (head === 'buttons') {
    target.buttons = parseButtons(rawValue);
  } else {
    switch (typeof (DEFAULT_CONFIG as unknown as Record<string, unknown>)[head]) {
      case 'boolean':
        target[head] = parseBoolean(rawValue, key);
        break;
      case 'number':
        target[head] = parseNumber(rawValue, key);
        break;
      default:
        target[head] = rawValue;
    }
  }

  const warnings: string[] = [];
  const validated = mergeConfig(next, warnings);
  if (warnings.length > 0) throw new Error(warnings.join('; '));
  return validated;
}

/** Return a copy of `config` with `key` restored to its default value. */
export function withDefaultValue(config: Config, key: string): Config {
  const defaultValue = getConfigValue(DEFAULT_CONFIG, key);
  const raw = typeof defaultValue === 'string' ? defaultValue : JSON.stringify(defaultValue);
  return withConfigValue(config, key, raw);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
