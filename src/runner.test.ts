import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_CONFIG, type Config } from './config.js';
import { DiscordNotRunningError, type Activity } from './discord/ipc.js';
import { silentLogger } from './logger.js';
import { runPresence, type PresenceClient } from './runner.js';
import type { WarpSnapshot } from './win32/warp.js';

class FakeClient implements PresenceClient {
  connected = false;
  user = { username: 'tester' };
  pipeIndex = 0;
  readonly sent: Array<Activity | null> = [];
  private readonly listeners: Array<(reason: string, wasReady: boolean) => void> = [];

  constructor(private readonly shouldConnect: boolean) {}

  async connect(): Promise<void> {
    if (!this.shouldConnect) throw new DiscordNotRunningError(new Error('ENOENT'));
    this.connected = true;
  }

  async setActivity(activity: Activity | null): Promise<unknown> {
    this.sent.push(activity);
    return activity;
  }

  clearActivity(): Promise<unknown> {
    return this.setActivity(null);
  }

  destroy(): void {
    this.connected = false;
  }

  on(_event: 'closed', listener: (reason: string, wasReady: boolean) => void): this {
    this.listeners.push(listener);
    return this;
  }

  simulateDisconnect(): void {
    this.connected = false;
    for (const listener of this.listeners) listener('pipe closed', true);
  }
}

function snapshot(overrides: Partial<WarpSnapshot> = {}): WarpSnapshot {
  return { running: true, focused: true, title: 'my-project', windows: [], idleMs: 0, ...overrides };
}

function config(overrides: Partial<Config> = {}): Config {
  return { ...structuredClone(DEFAULT_CONFIG), clientId: '123456789012345678', pollIntervalMs: 5, ...overrides };
}

async function runFor(ticks: number, options: Parameters<typeof runPresence>[0]): Promise<void> {
  const controller = new AbortController();
  const run = runPresence({ ...options, signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, ticks * options.config.pollIntervalMs + 20));
  controller.abort();
  await run;
}

test('runner sends the activity once, then only when it changes', async () => {
  const client = new FakeClient(true);
  const snapshots = [snapshot(), snapshot(), snapshot({ focused: false }), snapshot({ focused: false })];
  let index = 0;
  let clock = 1_000_000;

  await runFor(6, {
    config: config(),
    logger: silentLogger,
    signal: new AbortController().signal,
    snapshot: () => snapshots[Math.min(index++, snapshots.length - 1)]!,
    createClient: () => client,
    now: () => (clock += 20_000),
  });

  assert.equal(client.sent[0]?.details, 'my-project');
  assert.equal(client.sent[0]?.state, 'Focused');
  assert.equal(client.sent[1]?.state, 'In the background');
  // Shutdown clears the presence.
  assert.equal(client.sent.at(-1), null);
  assert.equal(client.sent.length, 3);
});

test('runner clears the presence immediately when Warp closes and restarts the timer', async () => {
  const client = new FakeClient(true);
  const snapshots = [snapshot(), snapshot({ running: false }), snapshot({ running: false }), snapshot()];
  let index = 0;
  let clock = 5_000_000;

  await runFor(6, {
    config: config(),
    logger: silentLogger,
    signal: new AbortController().signal,
    snapshot: () => snapshots[Math.min(index++, snapshots.length - 1)]!,
    createClient: () => client,
    now: () => (clock += 20_000),
  });

  const [first, cleared, again] = client.sent;
  assert.notEqual(first, null);
  assert.equal(cleared, null);
  assert.notEqual(again, null);
  assert.ok(again!.timestamps!.start! > first!.timestamps!.start!, 'session start resets after Warp closes');
});

test('runner keeps polling while Discord is missing and connects once it appears', async () => {
  const offline = new FakeClient(false);
  const online = new FakeClient(true);
  let attempts = 0;
  let clock = 0;

  await runFor(8, {
    config: config(),
    logger: silentLogger,
    signal: new AbortController().signal,
    snapshot: () => snapshot(),
    createClient: () => (attempts++ === 0 ? offline : online),
    now: () => (clock += 70_000),
  });

  assert.equal(attempts, 2);
  assert.ok(online.sent.length >= 1);
  assert.equal(online.sent[0]?.details, 'my-project');
});

test('runner reconnects after Discord drops the pipe', async () => {
  const first = new FakeClient(true);
  const second = new FakeClient(true);
  let attempts = 0;
  let clock = 0;
  let ticks = 0;

  await runFor(10, {
    config: config(),
    logger: silentLogger,
    signal: new AbortController().signal,
    snapshot: () => {
      if (++ticks === 3) first.simulateDisconnect();
      return snapshot();
    },
    createClient: () => (attempts++ === 0 ? first : second),
    now: () => (clock += 70_000),
  });

  assert.equal(attempts, 2);
  assert.ok(first.sent.length >= 1);
  assert.ok(second.sent.length >= 1, 'presence is re-sent on the new connection');
});
