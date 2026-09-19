import { errorMessage, type Config } from './config.js';
import { APP_NAME } from './constants.js';
import { DiscordIpcClient, DiscordIpcError, DiscordNotRunningError, type Activity } from './discord/ipc.js';
import type { Logger } from './logger.js';
import { buildActivity, presenceMode, type PresenceMode } from './presence.js';
import type { WarpSnapshot } from './win32/warp.js';

export interface PresenceClient {
  readonly connected: boolean;
  readonly user: { username: string } | null;
  readonly pipeIndex: number | null;
  connect(): Promise<void>;
  setActivity(activity: Activity | null): Promise<unknown>;
  clearActivity(): Promise<unknown>;
  destroy(): void;
  on(event: 'closed', listener: (reason: string, wasReady: boolean) => void): unknown;
  on(event: 'pipeConnected', listener: (index: number) => void): unknown;
}

/** How long a pending handshake stays silent before we explain the wait. */
const HANDSHAKE_HINT_DELAY_MS = 2_000;

export interface RunnerOptions {
  config: Config;
  logger: Logger;
  signal: AbortSignal;
  /** Injected in tests. Defaults to the Win32-backed snapshot. */
  snapshot?: () => WarpSnapshot;
  /** Injected in tests. Defaults to a real Discord IPC client. */
  createClient?: (clientId: string) => PresenceClient;
  now?: () => number;
}

export const INITIAL_BACKOFF_MS = 5_000;
export const MAX_BACKOFF_MS = 60_000;
/** Discord throttles presence updates to one every 15 seconds; no point sending faster. */
export const MIN_UPDATE_INTERVAL_MS = 15_000;

const MODE_LABELS: Record<PresenceMode, string> = {
  closed: 'Warp is not running. Presence cleared.',
  hidden: 'Warp is in the background. Presence hidden (showInBackground is off).',
  focused: 'Warp is focused. Presence on.',
  background: 'Warp is in the background.',
  idle: 'No input for a while. Presence set to idle.',
};

/**
 * The main loop: inspect the desktop, build the activity, keep Discord in sync.
 * Survives Discord (re)starts and never throws for transient failures.
 */
export async function runPresence(options: RunnerOptions): Promise<void> {
  const { config, logger, signal } = options;
  const now = options.now ?? Date.now;
  const takeSnapshot = options.snapshot ?? (await import('./win32/warp.js')).takeSnapshot;
  const createClient: (clientId: string) => PresenceClient =
    options.createClient ?? ((clientId) => new DiscordIpcClient({ clientId }));

  let client: PresenceClient | null = null;
  let sessionStart: number | null = null;
  let lastSentPayload: string | null = null;
  let lastSentAt = 0;
  let nextConnectAttempt = 0;
  let backoffMs = INITIAL_BACKOFF_MS;
  let waitingAnnounced = false;
  let lastMode: PresenceMode | null = null;
  let lastTitle: string | null = null;

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const done = (): void => {
        signal.removeEventListener('abort', done);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal.addEventListener('abort', done, { once: true });
    });

  const connectOnce = async (): Promise<PresenceClient | null> => {
    const candidate = createClient(config.clientId);
    let handshakeHint: NodeJS.Timeout | null = null;
    candidate.on('pipeConnected', (index) => {
      handshakeHint = setTimeout(() => {
        logger.info(
          `Discord accepted the connection on pipe ${index} and is taking its time with the handshake. ` +
            'It answers about 30 s after the previous Rich Presence session closed; hang on.',
        );
      }, HANDSHAKE_HINT_DELAY_MS);
    });
    try {
      await candidate.connect();
    } catch (error) {
      candidate.destroy();
      if (error instanceof DiscordIpcError) {
        logger.error(
          `Discord rejected the connection: ${error.message}. ` +
            `Check the client id with "${APP_NAME} doctor". Retrying in ${MAX_BACKOFF_MS / 1000}s.`,
        );
        nextConnectAttempt = now() + MAX_BACKOFF_MS;
      } else if (error instanceof DiscordNotRunningError) {
        if (error.handshakeTimedOut) {
          logger.warn(
            `Discord accepted the connection but never completed the handshake (${error.describeAttempts()}). ` +
              `Retrying in ${backoffMs / 1000}s.`,
          );
        } else if (!waitingAnnounced) {
          logger.info('Discord is not running. Waiting for it...');
          waitingAnnounced = true;
        }
        logger.debug(`Connection attempts: ${error.describeAttempts()}`);
        nextConnectAttempt = now() + backoffMs;
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      } else {
        logger.warn(`Could not connect to Discord: ${errorMessage(error)}. Retrying in ${backoffMs / 1000}s.`);
        nextConnectAttempt = now() + backoffMs;
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      }
      return null;
    } finally {
      if (handshakeHint) clearTimeout(handshakeHint);
    }

    const who = candidate.user ? `@${candidate.user.username}` : 'an unknown user';
    logger.info(`Connected to Discord as ${who} (pipe ${candidate.pipeIndex ?? '?'}).`);
    candidate.on('closed', (reason) => {
      if (signal.aborted) return;
      logger.warn(`Disconnected from Discord: ${reason}. Reconnecting...`);
      lastSentPayload = null;
      nextConnectAttempt = now() + INITIAL_BACKOFF_MS;
    });
    backoffMs = INITIAL_BACKOFF_MS;
    waitingAnnounced = false;
    lastSentPayload = null;
    lastSentAt = 0;
    return candidate;
  };

  logger.info(`Watching for Warp every ${config.pollIntervalMs}ms.`);

  while (!signal.aborted) {
    const tick = now();
    let activity: Activity | null = null;
    let snapshotOk = false;

    try {
      const snapshot = takeSnapshot();
      snapshotOk = true;
      if (snapshot.running && sessionStart === null) sessionStart = tick;
      if (!snapshot.running) sessionStart = null;

      const presenceInput = {
        running: snapshot.running,
        focused: snapshot.focused,
        title: snapshot.title,
        idleMs: snapshot.idleMs,
        sessionStart,
      };
      activity = buildActivity(presenceInput, config);

      const mode = presenceMode(presenceInput, config);
      if (mode !== lastMode) {
        logger.info(MODE_LABELS[mode]);
        lastMode = mode;
      }
      if (snapshot.title !== lastTitle) {
        if (snapshot.title !== null) logger.debug(`Warp window title: "${snapshot.title}"`);
        lastTitle = snapshot.title;
      }
    } catch (error) {
      logger.error(`Could not inspect windows: ${errorMessage(error)}`);
    }

    if ((client === null || !client.connected) && tick >= nextConnectAttempt) {
      client = await connectOnce();
    }

    if (snapshotOk && client?.connected) {
      const payload = JSON.stringify(activity);
      const changed = payload !== lastSentPayload;
      const clearing = activity === null || lastSentPayload === null;
      const throttled = !clearing && tick - lastSentAt < MIN_UPDATE_INTERVAL_MS;
      if (changed && !throttled) {
        try {
          await client.setActivity(activity);
          lastSentPayload = payload;
          lastSentAt = tick;
          logger.debug(activity ? `Presence updated: ${payload}` : 'Presence cleared.');
        } catch (error) {
          logger.error(`Could not update presence: ${errorMessage(error)}`);
        }
      }
    }

    await sleep(config.pollIntervalMs);
  }

  if (client?.connected) {
    try {
      await client.clearActivity();
    } catch {
      // Discord clears it anyway when the pipe closes.
    }
  }
  client?.destroy();
  logger.info('Stopped. Presence cleared.');
}
