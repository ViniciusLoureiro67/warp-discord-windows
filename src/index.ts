/**
 * Public API. The CLI is the main entry point, but every building block is
 * exported so you can embed the presence in your own tooling.
 */
export {
  DEFAULT_CONFIG,
  loadConfig,
  mergeConfig,
  PRESET_NAMES,
  PRESETS,
  saveOverrides,
  withOverride,
  withoutOverride,
  type Config,
  type Overrides,
  type PresenceText,
  type PresetName,
} from './config.js';
export { APP_NAME, DEFAULT_CLIENT_ID, REPO_URL } from './constants.js';
export {
  DiscordIpcClient,
  DiscordIpcError,
  DiscordNotRunningError,
  encodeFrame,
  FrameDecoder,
  Opcode,
  pipePath,
  type Activity,
  type ActivityButton,
} from './discord/ipc.js';
export { CONTROL_PIPE, queryControl, startControlServer, type ControlStatus } from './control.js';
export { findRunningInstance, queryInstance, stopInstance } from './daemon.js';
export { createLogger, silentLogger, type Logger } from './logger.js';
export {
  buildActivity,
  classifyTitle,
  describeTitle,
  normalizeTitle,
  presenceMode,
  renderTemplate,
  type PresenceInput,
  type PresenceMode,
  type TitleInfo,
  type TitleKind,
} from './presence.js';
export { createRunnerState, runPresence, type PresenceClient, type RunnerOptions, type RunnerState } from './runner.js';
export type { WarpSnapshot, WarpWindow } from './win32/warp.js';
