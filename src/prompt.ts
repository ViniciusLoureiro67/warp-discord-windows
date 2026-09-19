import readline from 'node:readline';

/**
 * Minimal interactive prompts with no dependencies: an arrow-key selector and
 * a text input. When stdin is not a terminal (pipes, CI) they degrade to
 * numbered choices read line by line, so the menu stays scriptable.
 */

export interface SelectOption<T> {
  label: string;
  hint?: string;
  value: T;
}

const CSI = '[';
const colorful = (): boolean => Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (text: string, code: string): string => (colorful() ? `${CSI}${code}m${text}${CSI}0m` : text);
const bold = (text: string): string => paint(text, '1');
const dim = (text: string): string => paint(text, '90');
const cyan = (text: string): string => paint(text, '36');
const green = (text: string): string => paint(text, '32');

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

let sharedReader: readline.Interface | null = null;

function lineReader(): readline.Interface {
  sharedReader ??= readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  return sharedReader;
}

/** Release stdin so the process can exit. Call once when the interactive session ends. */
export function closePrompts(): void {
  sharedReader?.close();
  sharedReader = null;
  if (process.stdin.isTTY) process.stdin.pause();
}

async function ask(question: string): Promise<string> {
  if (isInteractive()) {
    const reader = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    try {
      return await new Promise<string>((resolve) => reader.question(question, resolve));
    } finally {
      reader.close();
    }
  }
  return new Promise<string>((resolve, reject) => {
    const reader = lineReader();
    const onClose = (): void => reject(new Error('end of input'));
    reader.once('close', onClose);
    reader.question(question, (answer) => {
      reader.off('close', onClose);
      resolve(answer);
    });
  });
}

/** Free-text input with a default shown in parentheses. */
export async function input(question: string, defaultValue = ''): Promise<string> {
  const suffix = defaultValue ? ` ${dim(`(${defaultValue})`)}` : '';
  const answer = (await ask(`${cyan('?')} ${bold(question)}${suffix} `)).trim();
  return answer.length > 0 ? answer : defaultValue;
}

function fit(text: string, width: number): string {
  const chars = Array.from(text);
  return chars.length <= width ? text : `${chars.slice(0, Math.max(0, width - 1)).join('')}…`;
}

function renderOption<T>(option: SelectOption<T>, active: boolean, labelWidth: number): string {
  const columns = process.stdout.columns ?? 100;
  const marker = active ? cyan('❯') : ' ';
  const label = option.label.padEnd(labelWidth);
  const hint = option.hint ? fit(option.hint, Math.max(10, columns - labelWidth - 6)) : '';
  return `${marker} ${active ? bold(label) : label}${hint ? `  ${dim(hint)}` : ''}`;
}

async function selectWithArrows<T>(question: string, options: SelectOption<T>[], initial: number): Promise<T> {
  const stdin = process.stdin;
  const labelWidth = Math.max(...options.map((option) => Array.from(option.label).length));
  let index = initial;
  const lineCount = options.length + 1;

  const draw = (first: boolean): void => {
    const lines = [`${cyan('?')} ${bold(question)}`, ...options.map((option, i) => renderOption(option, i === index, labelWidth))];
    if (!first) process.stdout.write(`${CSI}${lineCount}A`);
    process.stdout.write(`${lines.map((line) => `${CSI}2K${line}`).join('\n')}\n`);
  };

  return new Promise<T>((resolve) => {
    const finish = (chosen: number | null): void => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write(`${CSI}${lineCount}A${CSI}J`);
      if (chosen === null) {
        process.stdout.write('\n');
        process.exit(130);
      }
      process.stdout.write(`${green('✓')} ${question} ${dim(options[chosen]!.label)}\n`);
      resolve(options[chosen]!.value);
    };
    const onData = (data: Buffer): void => {
      const key = data.toString('utf8');
      if (key === '') return finish(null); // Ctrl+C
      if (key === '\r' || key === '\n') return finish(index);
      if (key === `${CSI}A` || key === 'OA' || key === 'k') index = (index - 1 + options.length) % options.length;
      else if (key === `${CSI}B` || key === 'OB' || key === 'j') index = (index + 1) % options.length;
      else if (/^[1-9]$/.test(key) && Number(key) <= options.length) index = Number(key) - 1;
      else return;
      draw(false);
    };
    draw(true);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function selectByNumber<T>(question: string, options: SelectOption<T>[], initial: number): Promise<T> {
  const labelWidth = Math.max(...options.map((option) => Array.from(option.label).length));
  console.log(`${cyan('?')} ${bold(question)}`);
  options.forEach((option, i) => {
    console.log(`  ${i + 1}) ${option.label.padEnd(labelWidth)}${option.hint ? `  ${dim(option.hint)}` : ''}`);
  });
  const answer = (await ask(`  Choose [1-${options.length}] (${initial + 1}): `)).trim();
  const number = answer.length === 0 ? initial + 1 : Number.parseInt(answer, 10);
  const chosen = Number.isInteger(number) && number >= 1 && number <= options.length ? number - 1 : initial;
  return options[chosen]!.value;
}

/** Arrow-key selection in a terminal, numbered selection otherwise. */
export function select<T>(question: string, options: SelectOption<T>[], initial = 0): Promise<T> {
  if (options.length === 0) throw new Error('select needs at least one option');
  const start = Math.min(Math.max(initial, 0), options.length - 1);
  return isInteractive() ? selectWithArrows(question, options, start) : selectByNumber(question, options, start);
}
