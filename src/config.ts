import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_CLIENT_ID } from './constants.js';
import type { ActivityButton } from './discord/ipc.js';
import { getConfigPath, type Env } from './paths.js';

/**
 * Every line of text the card can show. The first line is picked by what
 * Warp's window title looks like (prompt, running command or named task),
 * the second by focus/idle state. Placeholders ({folder}, {path}, {program},
 * {command}, {title}) only fill in when a template contains them, so the
 * default presets never send anything from your screen.
 */
export interface PresenceText {
  /** First line while the shell waits at the prompt. Placeholders: {folder}, {path}, {title}. */
  prompt: string;
  /** First line while a command runs. Placeholders: {program}, {command}, {title}. */
  command: string;
  /** First line when a tool names the session (Claude Code and friends). Placeholder: {title}. */
  task: string;
  /** First line when the title is empty, still "Warp", or a template rendered empty. */
  fallback: string;
  /** Second line while Warp is the foreground window. */
  focused: string;
  /** Second line while Warp is open but another window has focus. */
  background: string;
  /** Second line after `idleAfterMinutes` without keyboard/mouse input. */
  idle: string;
}

export const PRESET_NAMES = ['generic', 'fun', 'detailed'] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

export const PRESETS: Record<PresetName, PresenceText> = {
  generic: {
    prompt: 'In the terminal',
    command: 'Running a command',
    task: 'Working on a task',
    fallback: 'In the terminal',
    focused: 'Focused',
    background: 'In the background',
    idle: 'Idle',
  },
  fun: {
    prompt: 'Staring at a blinking cursor',
    command: 'Waiting for a command to finish',
    task: 'Deep in the zone',
    fallback: 'Somewhere in a terminal',
    focused: 'Locked in',
    background: 'Multitasking',
    idle: 'AFK',
  },
  detailed: {
    prompt: 'Working in {folder}',
    command: 'Running {program}',
    task: 'Working on {title}',
    fallback: 'In the terminal',
    focused: 'Focused',
    background: 'In the background',
    idle: 'Idle',
  },
};

export interface Config {
  /** Discord application id. Empty means "not configured". */
  clientId: string;
  /** Which wording to start from. Individual `text` entries override it. */
  preset: PresetName;
  /** A fixed first line ("Terminal developer") that replaces prompt/command/task texts. Empty = off. */
  firstLine: string;
  /** How often the desktop is inspected, in milliseconds. */
  pollIntervalMs: number;
  /** Minutes without input before the presence switches to the idle text. 0 disables. */
  idleAfterMinutes: number;
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
  preset: 'generic',
  firstLine: '',
  pollIntervalMs: 2000,
  idleAfterMinutes: 5,
  showInBackground: true,
  showElapsedTime: true,
  activityType: 0,
  largeImageKey: 'warp',
  largeImageText: 'Warp Terminal',
  smallImageKey: 'windows',
  smallImageText: 'Windows',
  buttons: [],
  text: { ...PRESETS.generic },
};

export const ALLOWED_ACTIVITY_TYPES = [0, 2, 3, 5];
export const MIN_POLL_INTERVAL_MS = 500;
export const MAX_BUTTONS = 2;
export const MAX_BUTTON_LABEL_LENGTH = 32;

/** The raw JSON object stored on disk: only the keys the user changed. */
export type Overrides = Record<string, unknown>;

export interface LoadedConfig {
  /** Effective configuration: preset + overrides + environment. */
  config: Config;
  /** What the file actually contains. */
  overrides: Overrides;
  path: string;
  /** Whether a config file exists on disk. */
  exists: boolean;
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPresetName(value: unknown): value is PresetName {
  return typeof value === 'string' && (PRESET_NAMES as readonly string[]).includes(value);
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

function readText(value: unknown, base: PresenceText, warnings: string[]): PresenceText {
  const text = { ...base };
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

/** Resolve the effective config from a parsed JSON value: preset first, then every override, then validation. */
export function mergeConfig(raw: unknown, warnings: string[] = []): Config {
  const config = structuredClone(DEFAULT_CONFIG);
  if (raw === undefined || raw === null) return config;
  if (!isRecord(raw)) {
    warnings.push('config must be a JSON object; using defaults');
    return config;
  }

  if (raw.preset !== undefined) {
    if (isPresetName(raw.preset)) {
      config.preset = raw.preset;
    } else {
      warnings.push(`"preset" must be one of ${PRESET_NAMES.join(', ')}; using "generic"`);
    }
  }
  config.text = { ...PRESETS[config.preset] };

  const target = config as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'preset') continue;
    if (!(key in DEFAULT_CONFIG)) {
      warnings.push(`unknown option "${key}" ignored`);
      continue;
    }
    if (key === 'buttons') {
      config.buttons = readButtons(value, warnings);
      continue;
    }
    if (key === 'text') {
      config.text = readText(value, config.text, warnings);
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
  return { config, overrides: isRecord(raw) ? raw : {}, path: file, exists, warnings };
}

export function saveOverrides(overrides: Overrides, file: string = getConfigPath()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(overrides, null, 2)}\n`, 'utf8');
}

export function configKeys(): string[] {
  const keys = Object.keys(DEFAULT_CONFIG).filter((key) => key !== 'text');
  return [...keys, ...Object.keys(DEFAULT_CONFIG.text).map((key) => `text.${key}`)];
}

function unknownKey(key: string): Error {
  return new Error(`unknown option "${key}". Known options: ${configKeys().join(', ')}`);
}

export function getConfigValue(config: Config, key: string): unknown {
  const [head, ...rest] = key.split('.');
  if (head === 'text' && rest.length === 1 && rest[0]! in config.text) {
    return config.text[rest[0] as keyof PresenceText];
  }
  if (rest.length === 0 && head !== undefined && head in DEFAULT_CONFIG) {
    return (config as unknown as Record<string, unknown>)[head];
  }
  throw unknownKey(key);
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

/** Turn a CLI string into the typed value for `key`. */
function parseValue(key: string, rawValue: string): unknown {
  const [head, ...rest] = key.split('.');
  if (head === 'text') {
    if (rest.length === 1 && rest[0]! in DEFAULT_CONFIG.text) return rawValue;
    throw unknownKey(key);
  }
  if (head === undefined || rest.length > 0 || !(head in DEFAULT_CONFIG)) throw unknownKey(key);
  if (head === 'buttons') return parseButtons(rawValue);
  switch (typeof (DEFAULT_CONFIG as unknown as Record<string, unknown>)[head]) {
    case 'boolean':
      return parseBoolean(rawValue, key);
    case 'number':
      return parseNumber(rawValue, key);
    default:
      return rawValue.trim();
  }
}

/** Return a copy of the stored overrides with `key` set from a CLI string, validated. */
export function withOverride(overrides: Overrides, key: string, rawValue: string): Overrides {
  const next: Overrides = structuredClone(overrides);
  const value = parseValue(key, rawValue);
  const [head, sub] = key.split('.');

  if (head === 'text') {
    next.text = { ...(isRecord(next.text) ? next.text : {}), [sub!]: value };
  } else if (head === 'preset') {
    // Texts that merely repeated the old preset's wording must not shadow the new preset.
    const previous = isPresetName(next.preset) ? next.preset : 'generic';
    if (isRecord(next.text)) {
      const text = { ...next.text };
      for (const [textKey, textValue] of Object.entries(text)) {
        if (PRESETS[previous][textKey as keyof PresenceText] === textValue) delete text[textKey];
      }
      if (Object.keys(text).length === 0) delete next.text;
      else next.text = text;
    }
    next.preset = value;
  } else {
    next[head!] = value;
  }

  const warnings: string[] = [];
  mergeConfig(next, warnings);
  if (warnings.length > 0) throw new Error(warnings.join('; '));
  return next;
}

/** Return a copy of the stored overrides without `key`, so the preset default applies again. */
export function withoutOverride(overrides: Overrides, key: string): Overrides {
  if (!configKeys().includes(key)) throw unknownKey(key);
  const next: Overrides = structuredClone(overrides);
  const [head, sub] = key.split('.');
  if (head === 'text') {
    if (isRecord(next.text)) {
      const text = { ...next.text };
      delete text[sub!];
      if (Object.keys(text).length === 0) delete next.text;
      else next.text = text;
    }
  } else {
    delete next[head!];
  }
  return next;
}

/** Dotted names of every key present in the overrides, for display. */
export function overrideKeys(overrides: Overrides): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'text' && isRecord(value)) keys.push(...Object.keys(value).map((textKey) => `text.${textKey}`));
    else keys.push(key);
  }
  return keys;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
