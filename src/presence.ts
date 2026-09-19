import os from 'node:os';

import type { Config } from './config.js';
import type { Activity, ActivityButton } from './discord/ipc.js';

/** Discord rejects `details`/`state` shorter than 2 or longer than 128 characters. */
export const MIN_FIELD_LENGTH = 2;
export const MAX_FIELD_LENGTH = 128;

export interface PresenceInput {
  running: boolean;
  focused: boolean;
  title: string | null;
  idleMs: number;
  /** Epoch milliseconds of when Warp was first seen in this session. */
  sessionStart: number | null;
}

/**
 * Progress spinners and status glyphs that CLIs (Claude Code, npm, cargo...)
 * prepend to the terminal title. They change every few hundred milliseconds,
 * so we drop them to keep the presence stable.
 */
const LEADING_DECORATION = /^[\s◐-◓⠀-⣿○-●◉•⏳⌛⚙✔✖⭐]+/u;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Trim, collapse whitespace, strip spinner glyphs and hide the home directory. */
export function normalizeTitle(raw: string, homeDir: string = os.homedir()): string {
  let title = raw.replace(/\s+/g, ' ').replace(LEADING_DECORATION, '').trim();
  const home = homeDir.trim().replace(/[\\/]+$/, '');
  if (home.length > 0) {
    for (const variant of new Set([home, home.replace(/\\/g, '/'), home.replace(/\//g, '\\')])) {
      title = title.replace(new RegExp(escapeRegExp(variant), 'gi'), '~');
    }
  }
  return title;
}

/** Keep a Discord text field inside its allowed length, falling back when too short. */
export function clampField(text: string, fallback: string): string {
  const chars = Array.from(text.trim());
  if (chars.length < MIN_FIELD_LENGTH) {
    const fallbackChars = Array.from(fallback.trim());
    return fallbackChars.length >= MIN_FIELD_LENGTH ? fallbackChars.slice(0, MAX_FIELD_LENGTH).join('') : 'Warp';
  }
  if (chars.length <= MAX_FIELD_LENGTH) return chars.join('');
  return `${chars.slice(0, MAX_FIELD_LENGTH - 1).join('')}…`;
}

export function sanitizeButtons(buttons: ActivityButton[]): ActivityButton[] {
  return buttons.filter((button) => button.label.trim().length > 0 && /^https?:\/\//i.test(button.url)).slice(0, 2);
}

export type PresenceMode = 'closed' | 'hidden' | 'focused' | 'background' | 'idle';

export function presenceMode(input: PresenceInput, config: Config): PresenceMode {
  if (!input.running) return 'closed';
  if (!input.focused && !config.showInBackground) return 'hidden';
  if (config.idleAfterMinutes > 0 && input.idleMs >= config.idleAfterMinutes * 60_000) return 'idle';
  return input.focused ? 'focused' : 'background';
}

/** Turn a desktop snapshot into the activity Discord should display, or `null` to clear it. */
export function buildActivity(input: PresenceInput, config: Config): Activity | null {
  const mode = presenceMode(input, config);
  if (mode === 'closed' || mode === 'hidden') return null;

  const state = mode === 'idle' ? config.text.idle : mode === 'focused' ? config.text.focused : config.text.background;
  const title = config.showWindowTitle && input.title ? normalizeTitle(input.title) : '';
  const details = title.length > 0 ? title : config.text.noTitle;

  const activity: Activity = {
    type: config.activityType,
    details: clampField(details, config.text.noTitle),
    state: clampField(state, 'Warp'),
    instance: false,
  };

  if (config.largeImageKey) {
    activity.assets = { large_image: config.largeImageKey };
    if (config.largeImageText) activity.assets.large_text = clampField(config.largeImageText, 'Warp');
    if (config.smallImageKey) {
      activity.assets.small_image = config.smallImageKey;
      if (config.smallImageText) activity.assets.small_text = clampField(config.smallImageText, 'Windows');
    }
  }

  if (config.showElapsedTime && input.sessionStart !== null) {
    activity.timestamps = { start: Math.floor(input.sessionStart / 1000) };
  }

  const buttons = sanitizeButtons(config.buttons);
  if (buttons.length > 0) activity.buttons = buttons;

  return activity;
}
