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
 * Progress spinners, status glyphs and emoji that CLIs (Claude Code, npm,
 * cargo...) prepend to the terminal title. They change every few hundred
 * milliseconds, so we drop them to keep the presence stable. A title that
 * carried one is treated as a "task" name rather than a command.
 */
const LEADING_DECORATION =
  /^(?:[\s·•─-◿☀-➿⠀-⣿⭐⏳⌛‍️]|\p{Extended_Pictographic})+/u;

/** Tools whose first argument usually says what they are doing: "npm run", "git commit", "cargo build". */
const LAUNCHERS = new Set([
  'npm', 'npx', 'pnpm', 'yarn', 'bun', 'bunx', 'deno', 'node', 'python', 'python3', 'py', 'pip', 'pip3', 'uv',
  'poetry', 'cargo', 'rustup', 'go', 'dotnet', 'git', 'gh', 'docker', 'podman', 'kubectl', 'helm', 'terraform',
  'php', 'composer', 'artisan', 'ruby', 'gem', 'bundle', 'rails', 'make', 'cmake', 'gradle', 'mvn', 'az', 'aws',
  'gcloud', 'flutter', 'dart', 'conda', 'brew', 'winget', 'choco', 'scoop', 'wsl', 'sudo', 'code', 'cursor',
]);

/** Single-word commands we recognise, so a bare folder name is not mistaken for one. */
const KNOWN_PROGRAMS = new Set([
  ...LAUNCHERS,
  'claude', 'codex', 'gemini', 'aider', 'copilot', 'ollama', 'vim', 'nvim', 'vi', 'nano', 'emacs', 'micro', 'hx',
  'htop', 'btop', 'top', 'less', 'more', 'man', 'ssh', 'mosh', 'tmux', 'screen', 'lazygit', 'lazydocker', 'tig',
  'ranger', 'yazi', 'fzf', 'rg', 'fd', 'bat', 'eza', 'exa', 'ls', 'dir', 'tree', 'ping', 'tracert', 'tail', 'watch',
  'curl', 'wget', 'sqlite3', 'psql', 'mysql', 'redis-cli', 'mongosh', 'jupyter', 'irb', 'ipython', 'bash', 'zsh',
  'fish', 'nu', 'pwsh', 'powershell', 'cmd', 'tsc', 'vite', 'next', 'nest', 'jest', 'vitest', 'playwright', 'cypress',
  'serve', 'ngrok', 'tailscale', 'k9s', 'minikube', 'vagrant', 'ansible', 'nvm', 'fnm', 'volta', 'cd', 'clear',
]);

export type TitleKind = 'directory' | 'command' | 'task' | 'none';

export interface TitleInfo {
  kind: TitleKind;
  /** Cleaned title: whitespace collapsed, decoration stripped, home directory as `~`. */
  title: string;
  /** Last segment of a directory title; otherwise the title itself. */
  folder: string;
  /** The program behind a command ("node warp-discord-windows", "npm run", "git commit"); otherwise the title. */
  program: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceHome(title: string, homeDir: string): string {
  const home = homeDir.trim().replace(/[\\/]+$/, '');
  if (home.length === 0) return title;
  let result = title;
  for (const variant of new Set([home, home.replace(/\\/g, '/'), home.replace(/\//g, '\\')])) {
    result = result.replace(new RegExp(escapeRegExp(variant), 'gi'), '~');
  }
  return result;
}

/** Trim, collapse whitespace, strip spinner glyphs and hide the home directory. */
export function normalizeTitle(raw: string, homeDir: string = os.homedir()): string {
  return replaceHome(raw.replace(/\s+/g, ' ').replace(LEADING_DECORATION, '').trim(), homeDir);
}

function looksLikePath(title: string): boolean {
  if (/^(?:~|[a-z]:)(?:[\\/]|$)/i.test(title) || /^[\\/]/.test(title)) return true;
  return !title.includes(' ') && /[\\/]/.test(title);
}

function lastSegment(path: string): string {
  const segments = path.replace(/[\\/]+$/, '').split(/[\\/]+/).filter((segment) => segment.length > 0);
  return segments.length > 0 ? segments[segments.length - 1]! : path;
}

function stripQuotes(token: string): string {
  return token.replace(/^["']+|["']+$/g, '');
}

/** Split a command line on whitespace, keeping quoted segments (paths with spaces) together. */
function tokenize(commandLine: string): string[] {
  return commandLine.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
}

function programName(token: string): string {
  const base = lastSegment(stripQuotes(token));
  return base.replace(/\.(?:exe|cmd|bat|ps1|sh|js|mjs|cjs|ts|py|rb|php)$/i, '');
}

function programOf(tokens: string[]): string {
  const first = programName(tokens[0] ?? '');
  const second = tokens[1] !== undefined ? stripQuotes(tokens[1]) : '';
  if (LAUNCHERS.has(first.toLowerCase()) && second.length > 0 && !second.startsWith('-')) {
    return `${first} ${/[\\/.]/.test(second) ? programName(second) : second}`;
  }
  return first;
}

/** Work out what a Warp window title is: a directory, a running command or a named task. */
export function classifyTitle(raw: string, homeDir: string = os.homedir()): TitleInfo {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  const stripped = collapsed.replace(LEADING_DECORATION, '').trim();
  const decorated = stripped.length !== collapsed.length;
  const title = replaceHome(stripped, homeDir);

  // Warp shows plain "Warp" for a second while the shell starts: nothing to say yet.
  if (title.length === 0 || title.toLowerCase() === 'warp') return { kind: 'none', title: '', folder: '', program: '' };
  if (looksLikePath(title)) return { kind: 'directory', title, folder: lastSegment(title), program: title };
  if (decorated) return { kind: 'task', title, folder: title, program: title };

  const tokens = tokenize(title);
  if (tokens.length === 1 && !KNOWN_PROGRAMS.has(stripQuotes(tokens[0]!).toLowerCase())) {
    return { kind: 'directory', title, folder: title, program: title };
  }
  return { kind: 'command', title, folder: title, program: programOf(tokens) };
}

/** Replace `{placeholders}` and tidy the whitespace. Unknown placeholders become empty. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{(\w+)\}/g, (_match, key: string) => vars[key] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first line of the card, built from the window title and the configured templates. */
export function describeTitle(raw: string | null, config: Config, homeDir: string = os.homedir()): string {
  if (!config.showWindowTitle || raw === null) return config.text.noTitle;
  const info = classifyTitle(raw, homeDir);
  const template =
    info.kind === 'directory'
      ? config.text.directory
      : info.kind === 'command'
        ? config.text.command
        : info.kind === 'task'
          ? config.text.task
          : '';
  const rendered = renderTemplate(template, {
    title: info.title,
    folder: info.folder,
    program: info.program,
    command: info.title,
    path: info.title,
  });
  return rendered.length > 0 ? rendered : config.text.noTitle;
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
  const details = describeTitle(input.title, config);

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
