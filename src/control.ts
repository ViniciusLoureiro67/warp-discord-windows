import net from 'node:net';

/**
 * A tiny control channel between the CLI and a running instance, over a named
 * pipe. It lets `stop` end the instance gracefully (presence cleared, pid file
 * removed) instead of killing it, and lets `status` and the menu ask what the
 * instance is doing.
 *
 * Protocol: the client writes one JSON line, the server answers with one JSON
 * line and closes.
 */
export const CONTROL_PIPE = '\\\\.\\pipe\\warp-discord-windows-control';

export interface ControlStatus {
  pid: number;
  version: string;
  /** Epoch milliseconds. */
  startedAt: number;
  discordConnected: boolean;
  discordUser: string | null;
  warpRunning: boolean;
  warpFocused: boolean;
  preset: string;
  firstLine: string;
  configPath: string;
}

export interface ControlHandlers {
  status: () => ControlStatus;
  stop: () => void;
}

export type ControlReply =
  | { ok: true; status: ControlStatus }
  | { ok: true; pid: number }
  | { ok: false; error: string };

export function startControlServer(handlers: ControlHandlers, pipe: string = CONTROL_PIPE): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('error', () => {});
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        const newline = buffer.indexOf('\n');
        if (newline === -1) return;
        const line = buffer.slice(0, newline);
        buffer = '';
        let request: { cmd?: string } | null = null;
        try {
          request = JSON.parse(line) as { cmd?: string };
        } catch {
          socket.end(`${JSON.stringify({ ok: false, error: 'bad request' })}\n`);
          return;
        }
        if (request?.cmd === 'status') {
          socket.end(`${JSON.stringify({ ok: true, status: handlers.status() })}\n`);
        } else if (request?.cmd === 'stop') {
          socket.end(`${JSON.stringify({ ok: true, pid: process.pid })}\n`, () => handlers.stop());
        } else {
          socket.end(`${JSON.stringify({ ok: false, error: `unknown command "${request?.cmd ?? ''}"` })}\n`);
        }
      });
    });
    server.once('error', reject);
    server.listen(pipe, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

/** Ask the running instance something. Resolves to null when nothing answers. */
export function queryControl(cmd: 'status' | 'stop', pipe: string = CONTROL_PIPE, timeoutMs = 2000): Promise<ControlReply | null> {
  return new Promise((resolve) => {
    let settled = false;
    let buffer = '';
    const socket = net.createConnection({ path: pipe });
    const finish = (reply: ControlReply | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(reply);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.setEncoding('utf8');
    socket.on('error', () => finish(null));
    socket.on('connect', () => socket.write(`${JSON.stringify({ cmd })}\n`));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
    });
    socket.on('close', () => {
      const line = buffer.split('\n')[0] ?? '';
      try {
        finish(line.length > 0 ? (JSON.parse(line) as ControlReply) : null);
      } catch {
        finish(null);
      }
    });
  });
}
