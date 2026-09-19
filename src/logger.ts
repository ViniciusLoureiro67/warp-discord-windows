import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface LoggerOptions {
  /** Print to stdout/stderr. Default true. */
  console?: boolean;
  /** Also print debug lines. Default false. */
  verbose?: boolean;
  /** Append to this file as well (rotated when it grows past `maxFileBytes`). */
  file?: string | null;
  maxFileBytes?: number;
  colors?: boolean;
}

const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;

const ANSI = {
  reset: '[0m',
  dim: '[90m',
  yellow: '[33m',
  red: '[31m',
  cyan: '[36m',
} as const;

export function supportsColor(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

function clock(date: Date): string {
  return date.toTimeString().slice(0, 8);
}

/** Rename `file` to `file.1` when it grows past the limit so logs never balloon. */
function rotateIfNeeded(file: string, maxBytes: number): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const { size } = fs.statSync(file);
    if (size < maxBytes) return;
    fs.rmSync(`${file}.1`, { force: true });
    fs.renameSync(file, `${file}.1`);
  } catch {
    // Missing file or a locked one: nothing to rotate.
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const toConsole = options.console ?? true;
  const verbose = options.verbose ?? false;
  const file = options.file ?? null;
  const colors = options.colors ?? supportsColor();
  if (file) rotateIfNeeded(file, options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES);

  const paint = (text: string, code: string): string => (colors ? `${code}${text}${ANSI.reset}` : text);

  const write = (level: LogLevel, message: string): void => {
    if (level === 'debug' && !verbose) return;
    const now = new Date();
    if (toConsole) {
      const time = paint(clock(now), ANSI.dim);
      const body =
        level === 'error'
          ? paint(message, ANSI.red)
          : level === 'warn'
            ? paint(message, ANSI.yellow)
            : level === 'debug'
              ? paint(message, ANSI.dim)
              : message;
      (level === 'error' || level === 'warn' ? console.error : console.log)(`${time} ${body}`);
    }
    if (file) {
      try {
        fs.appendFileSync(file, `${now.toISOString()} [${level.toUpperCase()}] ${message}\n`, 'utf8');
      } catch {
        // Never let logging take the presence down.
      }
    }
  };

  return {
    debug: (message) => write('debug', message),
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
  };
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
