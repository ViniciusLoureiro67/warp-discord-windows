import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import net from 'node:net';

/**
 * Minimal Discord IPC (Rich Presence) client.
 *
 * Discord's desktop app listens on the named pipes `\\.\pipe\discord-ipc-0` .. `-9`.
 * Every message is a frame: `[opcode u32 LE][length u32 LE][JSON payload]`.
 * We handshake with our application id, then send SET_ACTIVITY commands.
 */

export const Opcode = {
  Handshake: 0,
  Frame: 1,
  Close: 2,
  Ping: 3,
  Pong: 4,
} as const;

export interface Frame {
  op: number;
  data: unknown;
}

export interface ActivityButton {
  label: string;
  url: string;
}

export interface ActivityTimestamps {
  /** Unix time in seconds. */
  start?: number;
  end?: number;
}

export interface ActivityAssets {
  large_image?: string;
  large_text?: string;
  small_image?: string;
  small_text?: string;
}

/** The subset of the SET_ACTIVITY payload that Discord accepts over IPC. */
export interface Activity {
  /** 0 = Playing, 2 = Listening, 3 = Watching, 5 = Competing. */
  type?: number;
  details?: string;
  state?: string;
  timestamps?: ActivityTimestamps;
  assets?: ActivityAssets;
  buttons?: ActivityButton[];
  instance?: boolean;
}

export interface DiscordUser {
  id: string;
  username: string;
  discriminator?: string;
  global_name?: string | null;
}

interface RpcMessage {
  cmd?: string;
  evt?: string;
  nonce?: string;
  data?: unknown;
}

/** Error reported by Discord itself (close frame or ERROR event). */
export class DiscordIpcError extends Error {
  readonly code: number | null;

  constructor(message: string, code: number | null = null) {
    super(message);
    this.name = 'DiscordIpcError';
    this.code = code;
  }
}

export interface PipeAttempt {
  index: number;
  error: Error;
}

/**
 * The pipe accepted the connection but Discord never sent READY.
 *
 * Discord delays new handshakes for roughly 30 seconds after the previous
 * Rich Presence session on that pipe closed, so this usually means "wait a
 * little longer", not "Discord is broken".
 */
export class HandshakeTimeoutError extends Error {
  readonly pipeIndex: number;

  constructor(pipeIndex: number, timeoutMs: number) {
    super(`handshake timed out after ${Math.round(timeoutMs / 1000)}s on pipe ${pipeIndex}`);
    this.name = 'HandshakeTimeoutError';
    this.pipeIndex = pipeIndex;
  }
}

/** No Discord IPC pipe completed the handshake: Discord is probably not running. */
export class DiscordNotRunningError extends Error {
  readonly attempts: PipeAttempt[];

  constructor(attempts: PipeAttempt[]) {
    super('Discord is not running (no IPC pipe answered)');
    this.name = 'DiscordNotRunningError';
    this.attempts = attempts;
  }

  /** True when some pipe accepted the connection but never completed the handshake. */
  get handshakeTimedOut(): boolean {
    return this.attempts.some((attempt) => attempt.error instanceof HandshakeTimeoutError);
  }

  /** One line per distinct failure, e.g. "pipe 0: handshake timed out; pipes 1-9: ENOENT". */
  describeAttempts(): string {
    const groups = new Map<string, number[]>();
    for (const attempt of this.attempts) {
      const code = (attempt.error as NodeJS.ErrnoException).code;
      const reason = code ?? attempt.error.message;
      groups.set(reason, [...(groups.get(reason) ?? []), attempt.index]);
    }
    return [...groups.entries()]
      .map(([reason, indexes]) => {
        const label =
          indexes.length === 1 ? `pipe ${indexes[0]}` : `pipes ${indexes[0]}-${indexes[indexes.length - 1]}`;
        return `${label}: ${reason}`;
      })
      .join('; ');
  }
}

export function pipePath(index: number): string {
  return `\\\\.\\pipe\\discord-ipc-${index}`;
}

export function encodeFrame(op: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt32LE(op, 0);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

/** Incremental frame decoder: feed it raw socket chunks, get back complete frames. */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Frame[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const frames: Frame[] = [];
    while (this.buffer.length >= 8) {
      const op = this.buffer.readUInt32LE(0);
      const length = this.buffer.readUInt32LE(4);
      if (this.buffer.length < 8 + length) break;
      const json = this.buffer.subarray(8, 8 + length).toString('utf8');
      this.buffer = this.buffer.subarray(8 + length);
      frames.push({ op, data: json.length > 0 ? JSON.parse(json) : null });
    }
    return frames;
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Discord answers a new handshake only ~30 s after the previous session on the
 * pipe closed. Waiting costs nothing when Discord is not running (the pipe does
 * not exist, so connecting fails instantly), hence the generous default.
 */
export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 60_000;

export interface DiscordIpcClientOptions {
  clientId: string;
  /** Pipe indexes to try, in order. Defaults to 0..9. */
  pipeIndexes?: number[];
  /** Handshake timeout per pipe in milliseconds. Default 60000. */
  handshakeTimeoutMs?: number;
  /** Timeout for each command in milliseconds. Default 10000. */
  requestTimeoutMs?: number;
}

export interface DiscordIpcClientEvents {
  /** The pipe accepted the connection; READY may still take a while. */
  pipeConnected: [index: number];
  ready: [data: unknown];
  closed: [reason: string, wasReady: boolean];
  rpcError: [data: unknown];
  socketError: [error: Error];
}

/**
 * One connection to Discord. Create a new instance for every (re)connection attempt.
 */
export class DiscordIpcClient extends EventEmitter<DiscordIpcClientEvents> {
  readonly clientId: string;
  user: DiscordUser | null = null;
  pipeIndex: number | null = null;

  private readonly pipeIndexes: number[];
  private readonly handshakeTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private socket: net.Socket | null = null;
  private decoder = new FrameDecoder();
  private readonly pending = new Map<string, PendingRequest>();
  private ready = false;
  private closed = false;
  private closeReason: string | null = null;
  private closeCode: number | null = null;

  constructor(options: DiscordIpcClientOptions) {
    super();
    this.clientId = options.clientId;
    this.pipeIndexes = options.pipeIndexes ?? Array.from({ length: 10 }, (_, index) => index);
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  }

  get connected(): boolean {
    return this.ready && !this.closed;
  }

  /** Try every pipe until one completes the handshake. */
  async connect(): Promise<void> {
    const attempts: PipeAttempt[] = [];
    for (const index of this.pipeIndexes) {
      try {
        await this.connectToPipe(index);
        return;
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        // Discord answered but rejected us (e.g. invalid client id): other pipes won't help.
        if (failure instanceof DiscordIpcError && failure.code !== null) throw failure;
        attempts.push({ index, error: failure });
      }
    }
    throw new DiscordNotRunningError(attempts);
  }

  private connectToPipe(index: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.resetState();
      const socket = net.createConnection({ path: pipePath(index) });
      let settled = false;

      const onReady = (): void => finish();
      const onClosed = (reason: string): void => finish(new DiscordIpcError(reason, this.closeCode));
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.off('ready', onReady);
        this.off('closed', onClosed);
        if (error) {
          socket.destroy();
          reject(error);
        } else {
          resolve();
        }
      };
      const timer = setTimeout(
        () => finish(new HandshakeTimeoutError(index, this.handshakeTimeoutMs)),
        this.handshakeTimeoutMs,
      );

      this.once('ready', onReady);
      this.once('closed', onClosed);

      socket.once('error', (error: Error) => finish(error));
      socket.once('connect', () => {
        this.socket = socket;
        this.pipeIndex = index;
        this.emit('pipeConnected', index);
        socket.on('data', (chunk: Buffer) => {
          if (socket !== this.socket) return;
          try {
            this.handleData(chunk);
          } catch (error) {
            this.closeReason = `protocol error: ${error instanceof Error ? error.message : String(error)}`;
            socket.destroy();
          }
        });
        socket.on('close', () => {
          if (socket === this.socket) this.finishClose();
        });
        socket.on('error', (error: Error) => this.emit('socketError', error));
        socket.write(encodeFrame(Opcode.Handshake, { v: 1, client_id: this.clientId }));
      });
    });
  }

  private resetState(): void {
    this.socket = null;
    this.decoder = new FrameDecoder();
    this.ready = false;
    this.closed = false;
    this.closeReason = null;
    this.closeCode = null;
    this.user = null;
    this.pipeIndex = null;
  }

  private handleData(chunk: Buffer): void {
    for (const frame of this.decoder.push(chunk)) this.handleFrame(frame);
  }

  private handleFrame(frame: Frame): void {
    switch (frame.op) {
      case Opcode.Ping:
        this.writeFrame(Opcode.Pong, frame.data);
        return;
      case Opcode.Close: {
        const data = frame.data as { code?: number; message?: string } | null;
        this.closeCode = typeof data?.code === 'number' ? data.code : null;
        this.closeReason = data?.message
          ? `${data.message} (code ${this.closeCode ?? '?'})`
          : 'connection closed by Discord';
        this.socket?.destroy();
        return;
      }
      case Opcode.Frame: {
        const message = frame.data as RpcMessage | null;
        if (!message) return;
        if (message.evt === 'READY') {
          const data = message.data as { user?: DiscordUser } | undefined;
          this.user = data?.user ?? null;
          this.ready = true;
          this.emit('ready', message.data);
          return;
        }
        if (message.nonce && this.pending.has(message.nonce)) {
          const request = this.pending.get(message.nonce)!;
          this.pending.delete(message.nonce);
          clearTimeout(request.timer);
          if (message.evt === 'ERROR') {
            const data = message.data as { code?: number; message?: string } | undefined;
            request.reject(new DiscordIpcError(data?.message ?? 'unknown RPC error', data?.code ?? null));
          } else {
            request.resolve(message.data);
          }
          return;
        }
        if (message.evt === 'ERROR') this.emit('rpcError', message.data);
        return;
      }
      default:
        return;
    }
  }

  private finishClose(): void {
    if (this.closed) return;
    this.closed = true;
    const wasReady = this.ready;
    this.ready = false;
    const reason = this.closeReason ?? 'connection closed';
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(reason));
    }
    this.pending.clear();
    this.emit('closed', reason, wasReady);
  }

  private writeFrame(op: number, payload: unknown): void {
    if (!this.socket || this.socket.destroyed) return;
    this.socket.write(encodeFrame(op, payload));
  }

  /** Send a command and wait for Discord's reply. */
  request<T = unknown>(cmd: string, args: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('not connected to Discord'));
        return;
      }
      const nonce = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new Error(`${cmd} timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);
      this.pending.set(nonce, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.writeFrame(Opcode.Frame, { cmd, args, nonce });
    });
  }

  /** Set (or clear, with `null`) the Rich Presence shown on the user's profile. */
  setActivity(activity: Activity | null): Promise<unknown> {
    return this.request('SET_ACTIVITY', { pid: process.pid, activity: activity ?? undefined });
  }

  clearActivity(): Promise<unknown> {
    return this.setActivity(null);
  }

  /** Close the connection. Discord clears our presence as soon as the pipe closes. */
  destroy(): void {
    this.closeReason ??= 'closed by client';
    if (this.socket && !this.socket.destroyed) {
      this.socket.destroy();
    } else {
      this.finishClose();
    }
  }
}
