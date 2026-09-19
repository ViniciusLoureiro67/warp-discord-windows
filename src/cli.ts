import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { disableAutostart, enableAutostart, getCliScriptPath, isAutostartEnabled } from './autostart.js';
import {
  configKeys,
  errorMessage,
  getConfigValue,
  loadConfig,
  mergeConfig,
  overrideKeys,
  PRESET_NAMES,
  PRESETS,
  saveOverrides,
  withOverride,
  withoutOverride,
  type Config,
  type LoadedConfig,
  type Overrides,
  type PresetName,
} from './config.js';
import { APP_NAME, DISCORD_DEVELOPER_PORTAL, REPO_URL } from './constants.js';
import { startControlServer, type ControlStatus } from './control.js';
import { findRunningInstance, queryInstance, removePidFile, stopInstance, writePidFile } from './daemon.js';
import { DiscordIpcClient, DiscordNotRunningError, pipePath } from './discord/ipc.js';
import { createLogger, supportsColor } from './logger.js';
import { getAutostartScriptPath, getConfigPath, getLogPath } from './paths.js';
import { closePrompts, input, isInteractive, select } from './prompt.js';
import { createRunnerState, runPresence } from './runner.js';
import type { WarpSnapshot } from './win32/warp.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const color = supportsColor();
const paint = (text: string, code: string): string => (color ? `\u001b[${code}m${text}\u001b[0m` : text);
const bold = (text: string): string => paint(text, '1');
const dim = (text: string): string => paint(text, '90');
const green = (text: string): string => paint(text, '32');
const yellow = (text: string): string => paint(text, '33');
const red = (text: string): string => paint(text, '31');
const cyan = (text: string): string => paint(text, '36');
const OK = green('✓');
const BAD = red('✗');
const WARN = yellow('!');
const INFO = dim('·');
const ON = green('●');
const OFF = dim('○');

export interface ParsedArgs {
  command: string | undefined;
  positional: string[];
  flags: Map<string, string | true>;
}

const FLAGS_WITH_VALUE = new Set(['client-id', 'lines']);

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--') {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
      if (inline !== undefined) {
        flags.set(name, inline);
      } else if (FLAGS_WITH_VALUE.has(name) && argv[index + 1] !== undefined && !argv[index + 1]!.startsWith('-')) {
        flags.set(name, argv[index + 1]!);
        index += 1;
      } else {
        flags.set(name, true);
      }
      continue;
    }
    if (arg === '-v') {
      flags.set('verbose', true);
      continue;
    }
    if (arg === '-h') {
      flags.set('help', true);
      continue;
    }
    if (arg === '-n' && argv[index + 1] !== undefined) {
      flags.set('lines', argv[index + 1]!);
      index += 1;
      continue;
    }
    positional.push(arg);
  }
  const [command, ...rest] = positional;
  return { command, positional: rest, flags };
}

function printHelp(): void {
  console.log(`${bold(`${APP_NAME} v${version}`)}
Discord Rich Presence for the Warp terminal on Windows.

${bold('Usage:')} ${APP_NAME} [command] [options]

${bold('Commands:')}
  ${dim('(none)')}               Open the menu in a terminal, or show this help
  menu                 Turn it on or off, change the wording, check everything (also: setup)
  run                  Run in this window and show what happens
  start                Run in the background and return to the prompt
  stop                 Stop the background instance
  status               Show the instance, autostart, Discord and Warp state
  doctor               Check Discord, Warp, the application id and native bindings
  autostart on|off     Start automatically when you log in to Windows
  config               Show the config (also: get, set, reset, presets, path, open, init)
  logs                 Print the last lines of the log file

${bold('Options:')}
  --client-id <id>     Use this Discord application id for this run
  --background         Run silently, logging to the log file only
  --verbose, -v        Print debug lines (window titles, presence payloads)
  --lines <n>, -n <n>  How many log lines to print (logs command)
  --version            Print the version
  --help, -h           Show this help

${bold('Examples:')}
  ${APP_NAME}                                        ${dim('# the menu: easiest way to set it up')}
  ${APP_NAME} autostart on                           ${dim('# start now and with Windows')}
  ${APP_NAME} config set preset fun                  ${dim('# other wording, still generic')}
  ${APP_NAME} config set firstLine "Terminal developer"
  ${APP_NAME} config set text.idle "AFK"

${bold('Files:')}
  config  ${getConfigPath()}
  logs    ${getLogPath()}

${dim(REPO_URL)}`);
}

function fail(message: string, code = 1): never {
  console.error(`${red('error:')} ${message}`);
  process.exit(code);
}

function printMissingClientId(): void {
  console.error(`${BAD} No Discord application id configured.

  ${bold('One-time setup (takes two minutes):')}
  1. Open ${cyan(DISCORD_DEVELOPER_PORTAL)} and click ${bold('New Application')}.
  2. Name it ${bold('Warp')} (this is what Discord shows as "Playing Warp") and copy the ${bold('Application ID')}.
  3. In ${bold('Rich Presence > Art Assets')}, upload an image with the key ${bold('warp')} (and optionally ${bold('windows')}).
  4. Run: ${cyan(`${APP_NAME} config set clientId <Application ID>`)}

  You can also pass ${bold('--client-id <id>')} or set the ${bold('WARP_DISCORD_CLIENT_ID')} environment variable.`);
}

function loadConfigForCli(args: ParsedArgs): LoadedConfig {
  const loaded = loadConfig();
  const flagClientId = args.flags.get('client-id');
  if (typeof flagClientId === 'string' && flagClientId.trim().length > 0) {
    loaded.config.clientId = flagClientId.trim();
  }
  return loaded;
}

/** Load the config without env overrides, so `config set` never persists an env value. */
function loadStoredConfig(): LoadedConfig {
  return loadConfig({ ...process.env, WARP_DISCORD_CLIENT_ID: undefined });
}

function hasStoredClientId(overrides: Overrides): boolean {
  return typeof overrides.clientId === 'string' && overrides.clientId.trim().length > 0;
}

function configSignature(file: string): string {
  try {
    const stats = fs.statSync(file);
    return `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return 'missing';
  }
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'less than a minute';
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value.length === 0 ? dim('(empty)') : value;
  return JSON.stringify(value);
}

async function runCommand(args: ParsedArgs): Promise<void> {
  const background = args.flags.has('background');
  const verbose = args.flags.has('verbose');
  const loaded = loadConfigForCli(args);
  const logger = createLogger({ console: !background, verbose, file: getLogPath() });
  for (const warning of loaded.warnings) logger.warn(`config: ${warning}`);

  if (!loaded.config.clientId) {
    if (background) {
      logger.error('No Discord application id configured. Run the CLI in a terminal for setup instructions.');
    } else {
      printMissingClientId();
    }
    process.exit(1);
  }

  const other = await findRunningInstance();
  if (other !== null) {
    logger.warn(`Another instance is already running (pid ${other}). Stop it with "${APP_NAME} stop".`);
    process.exit(background ? 0 : 1);
  }

  const controller = new AbortController();
  const state = createRunnerState(loaded.config);
  const startedAt = Date.now();
  const stop = (why: string): void => {
    if (controller.signal.aborted) return;
    logger.info(`Shutting down (${why})...`);
    controller.abort();
  };

  let server: Awaited<ReturnType<typeof startControlServer>>;
  try {
    server = await startControlServer({
      status: (): ControlStatus => ({
        pid: process.pid,
        version,
        startedAt,
        discordConnected: state.discordConnected,
        discordUser: state.discordUser,
        warpRunning: state.warpRunning,
        warpFocused: state.warpFocused,
        preset: state.config.preset,
        firstLine: state.config.firstLine,
        configPath: loaded.path,
      }),
      stop: () => stop('stop requested'),
    });
  } catch (error) {
    logger.warn(`Another instance seems to be running (control pipe busy: ${errorMessage(error)}).`);
    process.exit(background ? 0 : 1);
  }

  if (!background) {
    console.log(bold(`${APP_NAME} v${version}`));
    console.log(`${dim('config')}  ${loaded.path}${loaded.exists ? '' : dim(' (defaults, not created yet)')}`);
    console.log(`${dim('logs')}    ${getLogPath()}`);
    console.log(dim('Press Ctrl+C to stop.\n'));
  }

  writePidFile();
  process.on('SIGINT', () => stop('Ctrl+C'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGHUP', () => stop('terminal closed'));
  process.on('SIGBREAK', () => stop('Ctrl+Break'));

  let signature = configSignature(loaded.path);
  const reloadConfig = (): Config | null => {
    const next = configSignature(loaded.path);
    if (next === signature) return null;
    signature = next;
    const reloaded = loadConfigForCli(args);
    for (const warning of reloaded.warnings) logger.warn(`config: ${warning}`);
    if (!reloaded.config.clientId) {
      logger.warn('The config has no client id any more; keeping the previous one.');
      reloaded.config.clientId = state.config.clientId;
    }
    return reloaded.config;
  };

  try {
    await runPresence({ config: loaded.config, logger, signal: controller.signal, reloadConfig, state });
  } finally {
    removePidFile();
    server.close();
  }
}

/** Spawn a detached, windowless copy of this CLI running `run --background`. Returns its pid. */
function spawnBackground(clientId: string | null): number | undefined {
  const extra = clientId ? ['--client-id', clientId] : [];
  const child = spawn(process.execPath, [getCliScriptPath(), 'run', '--background', ...extra], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

async function waitForInstance(timeoutMs: number): Promise<ControlStatus | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await queryInstance();
    if (status) return status;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

/** Start in the background unless already running. Returns the pid, or null when nothing was started. */
async function ensureRunning(args: ParsedArgs, quiet = false): Promise<number | null> {
  const loaded = loadConfigForCli(args);
  if (!loaded.config.clientId) {
    printMissingClientId();
    return null;
  }
  const running = await findRunningInstance();
  if (running !== null) {
    if (!quiet) console.log(`${INFO} Already running in the background (pid ${running}).`);
    return running;
  }
  const flagged = args.flags.get('client-id');
  const pid = spawnBackground(typeof flagged === 'string' ? flagged : null);
  const status = await waitForInstance(4000);
  return status?.pid ?? pid ?? null;
}

async function startCommand(args: ParsedArgs): Promise<void> {
  const before = await findRunningInstance();
  const pid = await ensureRunning(args);
  if (pid === null || before !== null) return;
  console.log(`${OK} Started in the background (pid ${pid}).`);
  console.log(`${INFO} Follow along with "${APP_NAME} logs", stop with "${APP_NAME} stop".`);
}

async function stopCommand(): Promise<void> {
  const result = await stopInstance();
  if (result === null) {
    console.log(`${INFO} No background instance is running.`);
    return;
  }
  console.log(
    result.graceful
      ? `${OK} Stopped the background instance (pid ${result.pid}). Presence cleared.`
      : `${OK} Stopped the background instance (pid ${result.pid}, it had to be killed). Discord clears the presence right away.`,
  );
}

/** Which `\\.\pipe\discord-ipc-N` pipes exist right now. */
export function discordPipes(): number[] {
  try {
    const names = fs.readdirSync('\\\\.\\pipe\\');
    return names
      .map((name) => /^discord-ipc-(\d)$/.exec(name)?.[1])
      .filter((index): index is string => index !== undefined)
      .map(Number)
      .sort((a, b) => a - b);
  } catch {
    const found: number[] = [];
    for (let index = 0; index < 10; index += 1) {
      if (fs.existsSync(pipePath(index))) found.push(index);
    }
    return found;
  }
}

async function loadSnapshot(): Promise<{ snapshot: WarpSnapshot | null; error: string | null }> {
  try {
    const { takeSnapshot } = await import('./win32/warp.js');
    return { snapshot: takeSnapshot(), error: null };
  } catch (error) {
    return { snapshot: null, error: errorMessage(error) };
  }
}

function describeClientId(config: Config, loadedFromFile: boolean): string {
  if (!config.clientId) return `${BAD} not configured`;
  const source = process.env.WARP_DISCORD_CLIENT_ID?.trim()
    ? 'environment variable'
    : loadedFromFile
      ? 'config file'
      : 'built-in';
  return `${config.clientId} ${dim(`(${source})`)}`;
}

function describeWording(config: Config): string {
  if (config.firstLine) return `fixed line ${bold(`"${config.firstLine}"`)}`;
  return `preset ${bold(`"${config.preset}"`)} ${dim(`(${config.text.prompt} · ${config.text.focused})`)}`;
}

interface Summary {
  instance: ControlStatus | null;
  pid: number | null;
  autostart: boolean;
  config: LoadedConfig;
  stored: LoadedConfig;
}

async function summarize(args: ParsedArgs): Promise<Summary> {
  const instance = await queryInstance();
  const pid = instance?.pid ?? (await findRunningInstance());
  return { instance, pid, autostart: isAutostartEnabled(), config: loadConfigForCli(args), stored: loadStoredConfig() };
}

function presenceLine(summary: Summary): string {
  const { instance, pid } = summary;
  if (instance) {
    const discord = instance.discordConnected
      ? `Discord connected${instance.discordUser ? ` as @${instance.discordUser}` : ''}`
      : 'waiting for Discord';
    return `${ON} on ${dim(`(pid ${instance.pid}, up ${formatDuration(Date.now() - instance.startedAt)}, ${discord})`)}`;
  }
  if (pid !== null) return `${ON} on ${dim(`(pid ${pid}, older version without status reporting)`)}`;
  return `${OFF} off ${dim('(not running)')}`;
}

function printSummary(summary: Summary): void {
  console.log(`  ${'Presence'.padEnd(10)} ${presenceLine(summary)}`);
  console.log(`  ${'Startup'.padEnd(10)} ${summary.autostart ? `${ON} starts with Windows` : `${OFF} not on startup`}`);
  console.log(`  ${'Wording'.padEnd(10)} ${describeWording(summary.stored.config)}`);
}

async function statusCommand(args: ParsedArgs): Promise<void> {
  const summary = await summarize(args);
  const pipes = discordPipes();
  const { snapshot, error } = await loadSnapshot();

  const warpLine =
    snapshot === null
      ? `${BAD} could not inspect windows (${error})`
      : !snapshot.running
        ? `${INFO} not running`
        : snapshot.focused
          ? `${OK} focused`
          : `${OK} running in the background`;

  console.log(bold(`${APP_NAME} v${version}`));
  printSummary(summary);
  console.log(`  ${'Discord'.padEnd(10)} ${pipes.length > 0 ? `${OK} running (pipe ${pipes.join(', ')})` : `${BAD} not running`}`);
  console.log(`  ${'Warp'.padEnd(10)} ${warpLine}`);
  console.log(`  ${'Client id'.padEnd(10)} ${describeClientId(summary.config.config, hasStoredClientId(summary.stored.overrides))}`);
  console.log(`  ${'Config'.padEnd(10)} ${summary.config.path}${summary.config.exists ? '' : dim(' (defaults)')}`);
  for (const warning of summary.config.warnings) console.log(`  ${WARN} config: ${warning}`);
}

interface DoctorCheck {
  ok: boolean | null;
  label: string;
  detail?: string;
}

async function doctorCommand(args: ParsedArgs, exitOnProblems = true): Promise<void> {
  const checks: DoctorCheck[] = [];
  const loaded = loadConfigForCli(args);

  checks.push({ ok: process.platform === 'win32', label: 'Windows', detail: `${process.platform} ${process.arch}` });
  const [major] = process.versions.node.split('.').map(Number);
  checks.push({ ok: (major ?? 0) >= 18, label: 'Node.js 18 or newer', detail: `v${process.versions.node}` });

  const { snapshot, error } = await loadSnapshot();
  checks.push({
    ok: snapshot !== null,
    label: 'Native bindings (koffi + Win32)',
    detail: snapshot === null ? (error ?? undefined) : 'user32/kernel32 loaded',
  });

  const warpPaths = [
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Warp', 'warp.exe'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Warp', 'warp.exe'),
  ];
  const installed = warpPaths.find((candidate) => candidate && fs.existsSync(candidate));
  checks.push({
    ok: installed !== undefined || snapshot?.running === true,
    label: 'Warp installed',
    detail: installed ?? (snapshot?.running ? 'not in the usual folders, but a Warp window is open' : 'not found in the usual folders'),
  });
  if (snapshot) {
    checks.push({
      ok: null,
      label: 'Warp right now',
      detail: !snapshot.running ? 'not running' : snapshot.focused ? 'focused' : 'in the background',
    });
  }

  const pipes = discordPipes();
  checks.push({
    ok: pipes.length > 0,
    label: 'Discord desktop app running',
    detail: pipes.length > 0 ? `IPC pipe discord-ipc-${pipes.join(', discord-ipc-')}` : 'no discord-ipc-* pipe found; start Discord',
  });

  checks.push({
    ok: loaded.config.clientId.length > 0,
    label: 'Discord application id',
    detail: loaded.config.clientId || `missing; run "${APP_NAME} config set clientId <id>"`,
  });
  for (const warning of loaded.warnings) checks.push({ ok: false, label: 'Config', detail: warning });

  if (pipes.length > 0 && loaded.config.clientId) {
    console.log(dim('Checking the Discord handshake (takes up to 30 s right after another Rich Presence session closed)...'));
    const client = new DiscordIpcClient({ clientId: loaded.config.clientId, handshakeTimeoutMs: 45_000 });
    try {
      const started = Date.now();
      await client.connect();
      const waited = Math.round((Date.now() - started) / 1000);
      checks.push({
        ok: true,
        label: 'Discord handshake',
        detail:
          `logged in as @${client.user?.username ?? 'unknown'} via pipe ${client.pipeIndex ?? '?'}` +
          (waited >= 2 ? ` (Discord took ${waited} s to answer)` : ''),
      });
    } catch (handshakeError) {
      let detail = `${errorMessage(handshakeError)}; double-check the application id`;
      if (handshakeError instanceof DiscordNotRunningError) {
        detail = handshakeError.handshakeTimedOut
          ? 'Discord accepted the connection but did not answer within 45 s; restart Discord'
          : `no pipe answered (${handshakeError.describeAttempts()}); restart Discord`;
      }
      checks.push({ ok: false, label: 'Discord handshake', detail });
    } finally {
      client.destroy();
    }
  }

  const instance = await queryInstance();
  const pid = instance?.pid ?? (await findRunningInstance());
  checks.push({
    ok: null,
    label: 'Background instance',
    detail: pid === null ? 'not running' : `running (pid ${pid}${instance?.discordConnected ? ', Discord connected' : ''})`,
  });
  checks.push({ ok: null, label: 'Autostart', detail: isAutostartEnabled() ? `enabled (${getAutostartScriptPath()})` : 'disabled' });

  console.log(bold(`${APP_NAME} v${version} doctor\n`));
  for (const check of checks) {
    const mark = check.ok === null ? INFO : check.ok ? OK : BAD;
    console.log(`  ${mark} ${check.label}${check.detail ? dim(` — ${check.detail}`) : ''}`);
  }
  const failed = checks.filter((check) => check.ok === false).length;
  console.log(failed === 0 ? `\n${OK} Everything looks good.` : `\n${BAD} ${failed} problem(s) found.`);
  if (failed > 0 && exitOnProblems) process.exit(1);
}

async function turnOn(args: ParsedArgs): Promise<void> {
  const loaded = loadConfigForCli(args);
  if (!loaded.config.clientId) {
    printMissingClientId();
    return;
  }
  const result = enableAutostart();
  for (const warning of result.warnings) console.log(`${WARN} ${warning}`);
  const already = await findRunningInstance();
  const pid = await ensureRunning(args, true);
  if (already !== null) {
    console.log(`${OK} Already running (pid ${already}), and it will start with Windows from now on.`);
  } else if (pid !== null) {
    console.log(`${OK} Running now (pid ${pid}) and on every login.`);
  }
  console.log(`${INFO} Discord shows the presence within about 30 seconds. You can close this window.`);
}

async function turnOff(): Promise<void> {
  const stopped = await stopInstance();
  const removed = disableAutostart();
  if (stopped) console.log(`${OK} Stopped (pid ${stopped.pid}). Presence cleared.`);
  if (removed) console.log(`${OK} Removed from Windows startup.`);
  if (!stopped && !removed) console.log(`${INFO} It was not running and was not on startup. Nothing to do.`);
}

async function autostartCommand(args: ParsedArgs): Promise<void> {
  const [action = 'status'] = args.positional;
  switch (action) {
    case 'on':
    case 'enable':
      await turnOn(args);
      return;
    case 'off':
    case 'disable': {
      const removed = disableAutostart();
      console.log(removed ? `${OK} Autostart disabled.` : `${INFO} Autostart was not enabled.`);
      if ((await findRunningInstance()) !== null) {
        console.log(`${INFO} The current instance keeps running; stop it with "${APP_NAME} stop".`);
      }
      return;
    }
    case 'status':
      console.log(
        isAutostartEnabled() ? `${OK} Autostart is enabled (${getAutostartScriptPath()})` : `${INFO} Autostart is disabled.`,
      );
      return;
    default:
      fail(`unknown autostart action "${action}". Use on, off or status.`);
  }
}

function openInEditor(file: string): void {
  const child = spawn('cmd.exe', ['/c', 'start', '""', file], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

function presetHint(name: PresetName): string {
  const text = PRESETS[name];
  const sample = `${text.prompt} · ${text.command} · ${text.task}`;
  return name === 'detailed' ? `${sample} (names from your terminal)` : sample;
}

function printPresets(current: string): void {
  const notes: Record<string, string> = {
    generic: 'default, says nothing about what you are doing',
    fun: 'same idea, more personality',
    detailed: 'shows folder, program and task names from Warp\'s title',
  };
  for (const name of PRESET_NAMES) {
    const text = PRESETS[name];
    const marker = name === current ? ON : OFF;
    console.log(`${marker} ${bold(name)} ${dim(`(${notes[name]})`)}`);
    console.log(`    ${text.prompt} ${dim('·')} ${text.command} ${dim('·')} ${text.task}`);
    console.log(`    ${text.focused} ${dim('·')} ${text.background} ${dim('·')} ${text.idle}`);
  }
}

async function applyHint(): Promise<void> {
  const running = (await findRunningInstance()) !== null;
  console.log(running ? `${INFO} The running instance applies it within a few seconds.` : `${INFO} It will be used the next time it runs.`);
}

async function changeWording(): Promise<void> {
  const stored = loadStoredConfig();
  const current = stored.config.firstLine ? 'fixed' : stored.config.preset;
  const options = [
    ...PRESET_NAMES.map((name) => ({ label: name, hint: presetHint(name), value: name as string })),
    {
      label: 'A fixed line',
      hint: stored.config.firstLine ? `now "${stored.config.firstLine}"` : 'for example "Terminal developer"',
      value: 'fixed',
    },
    { label: 'Keep as is', value: 'keep' },
  ];
  const choice = await select(
    'How should the first line read?',
    options,
    Math.max(0, options.findIndex((option) => option.value === current)),
  );
  if (choice === 'keep') return;

  let next = stored.overrides;
  if (choice === 'fixed') {
    const line = await input('Your line', stored.config.firstLine || 'Terminal developer');
    next = withOverride(next, 'firstLine', line);
  } else {
    next = withoutOverride(next, 'firstLine');
    next = withOverride(next, 'preset', choice);
  }
  saveOverrides(next, stored.path);
  const effective = mergeConfig(next);
  console.log(`${OK} Saved. The card will read ${bold(`"${effective.firstLine || effective.text.prompt}"`)} / ${bold(`"${effective.text.focused}"`)}.`);
  await applyHint();
}

async function menuCommand(args: ParsedArgs): Promise<void> {
  try {
    for (;;) {
      console.log(`\n${bold(`${APP_NAME} v${version}`)} ${dim('— Discord Rich Presence for Warp')}`);
      printSummary(await summarize(args));
      console.log();
      const action = await select('What do you want to do?', [
        { label: 'Turn it on', hint: 'Start now and every time you log in to Windows', value: 'on' },
        { label: 'Turn it off', hint: 'Stop it and remove it from Windows startup', value: 'off' },
        { label: 'Change the wording', hint: 'Pick a preset or write your own line', value: 'wording' },
        { label: 'Check everything', hint: 'Discord, Warp and the application id', value: 'doctor' },
        { label: 'Watch it live', hint: 'Run in this window with logs, Ctrl+C to leave', value: 'run' },
        { label: 'Quit', value: 'quit' },
      ]);
      switch (action) {
        case 'on':
          await turnOn(args);
          break;
        case 'off':
          await turnOff();
          break;
        case 'wording':
          await changeWording();
          break;
        case 'doctor':
          await doctorCommand(args, false);
          break;
        case 'run':
          closePrompts();
          await runCommand(args);
          return;
        default:
          return;
      }
    }
  } catch (error) {
    if (errorMessage(error) !== 'end of input') throw error;
  } finally {
    closePrompts();
  }
}

async function configCommand(args: ParsedArgs): Promise<void> {
  const [action = 'show', key, ...valueParts] = args.positional;
  const stored = loadStoredConfig();
  const initial: Overrides = { preset: 'generic' };
  const save = (next: Overrides): void => saveOverrides(next, stored.path);

  switch (action) {
    case 'show': {
      const effective = loadConfigForCli(args);
      const changed = overrideKeys(stored.overrides);
      console.log(dim(`# ${effective.path}${effective.exists ? '' : ' (not created yet)'}`));
      console.log(dim(`# preset "${effective.config.preset}"${changed.length > 0 ? `, overrides: ${changed.join(', ')}` : ', no overrides'}`));
      console.log(JSON.stringify(effective.config, null, 2));
      for (const warning of effective.warnings) console.log(`${WARN} ${warning}`);
      return;
    }
    case 'presets':
      printPresets(stored.config.preset);
      return;
    case 'path':
      console.log(stored.path);
      return;
    case 'keys':
      console.log(configKeys().join('\n'));
      return;
    case 'get': {
      if (!key) fail(`usage: ${APP_NAME} config get <key>`);
      console.log(formatValue(getConfigValue(loadConfigForCli(args).config, key)));
      return;
    }
    case 'set': {
      const raw = valueParts.join(' ');
      if (!key || raw.length === 0) fail(`usage: ${APP_NAME} config set <key> <value>`);
      const next = withOverride(stored.overrides, key, raw);
      save(next);
      const effective = mergeConfig(next);
      console.log(`${OK} ${key} = ${formatValue(getConfigValue(effective, key))}`);
      if (key === 'preset') printPresets(effective.preset);
      await applyHint();
      return;
    }
    case 'reset': {
      if (key) {
        const next = withoutOverride(stored.overrides, key);
        save(next);
        console.log(`${OK} ${key} back to ${formatValue(getConfigValue(mergeConfig(next), key))}`);
      } else {
        const next: Overrides = hasStoredClientId(stored.overrides) ? { clientId: stored.overrides.clientId } : {};
        save(next);
        console.log(`${OK} Config reset to the generic preset${hasStoredClientId(next) ? ' (client id kept)' : ''}: ${stored.path}`);
      }
      await applyHint();
      return;
    }
    case 'init': {
      if (stored.exists) {
        console.log(`${INFO} Config already exists: ${stored.path}`);
      } else {
        save(initial);
        console.log(`${OK} Created ${stored.path}`);
        console.log(`${INFO} Add only the keys you want to change. "${APP_NAME} config show" prints the effective config.`);
      }
      return;
    }
    case 'open': {
      if (!stored.exists) save(initial);
      openInEditor(stored.path);
      console.log(`${OK} Opening ${stored.path}`);
      return;
    }
    default:
      fail(`unknown config action "${action}". Use show, get, set, reset, presets, path, keys, init or open.`);
  }
}

function logsCommand(args: ParsedArgs): void {
  const requested = args.flags.get('lines');
  const lines = typeof requested === 'string' ? Number.parseInt(requested, 10) : 50;
  if (!Number.isInteger(lines) || lines <= 0) fail('--lines expects a positive number');
  const file = getLogPath();
  if (!fs.existsSync(file)) {
    console.log(`${INFO} No log file yet (${file}).`);
    return;
  }
  const content = fs.readFileSync(file, 'utf8').trimEnd();
  const tail = content.length === 0 ? [] : content.split('\n').slice(-lines);
  console.log(dim(`# ${file}`));
  for (const line of tail) console.log(line);
}

export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.flags.has('version')) {
    console.log(version);
    return;
  }
  if (args.flags.has('help') || args.command === 'help') {
    printHelp();
    return;
  }
  if (process.platform !== 'win32') {
    fail(`${APP_NAME} only runs on Windows: it talks to Win32 and to Discord's named pipes.`);
  }

  try {
    switch (args.command ?? (isInteractive() ? 'menu' : 'help')) {
      case 'help':
        printHelp();
        break;
      case 'menu':
      case 'setup':
        await menuCommand(args);
        break;
      case 'run':
        await runCommand(args);
        break;
      case 'start':
        await startCommand(args);
        break;
      case 'stop':
        await stopCommand();
        break;
      case 'status':
        await statusCommand(args);
        break;
      case 'doctor':
        await doctorCommand(args);
        break;
      case 'autostart':
        await autostartCommand(args);
        break;
      case 'config':
        await configCommand(args);
        break;
      case 'logs':
        logsCommand(args);
        break;
      default:
        fail(`unknown command "${args.command}". Run "${APP_NAME} help" to see the commands.`);
    }
  } catch (error) {
    fail(errorMessage(error));
  }
}
