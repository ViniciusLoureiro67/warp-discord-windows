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
    if (!this.shouldConnect) throw new DiscordNotRunningError([{ index: 0, error: new Error('ENOENT') }]);
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

  on(event: string, listener: (...args: any[]) => void): this {
    if (event === 'closed') this.listeners.push(listener);
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
  return { ...structuredClone(DEFAULT_CONFIG), clientId: '123456789012345678', pollIntervalMs: 1, ...overrides };
}

interface Scenario {
  snapshots: WarpSnapshot[];
  createClient: (clientId: string) => PresenceClient;
  /** Called before each snapshot with its 1-based number. */
  beforeSnapshot?: (tick: number) => void;
  config?: Config;
}

/**
 * Feed the runner a fixed list of snapshots. The run is aborted when the last
 * one is handed out, so the outcome never depends on timers or CPU speed.
 * The fake clock jumps 70 s per call: past every throttle and backoff window.
 */
async function runScenario(scenario: Scenario): Promise<void> {
  const controller = new AbortController();
  let index = 0;
  let clock = 1_000_000;
  await runPresence({
    config: scenario.config ?? config(),
    logger: silentLogger,
    signal: controller.signal,
    createClient: scenario.createClient,
    now: () => (clock += 70_000),
    snapshot: () => {
      const tick = index + 1;
      scenario.beforeSnapshot?.(tick);
      if (index >= scenario.snapshots.length - 1) controller.abort();
      const current = scenario.snapshots[Math.min(index, scenario.snapshots.length - 1)]!;
      index += 1;
      return current;
    },
  });
}

test('runner sends the activity once, then only when it changes', async () => {
  const client = new FakeClient(true);
  await runScenario({
    snapshots: [snapshot(), snapshot(), snapshot({ focused: false }), snapshot({ focused: false })],
    createClient: () => client,
  });

  assert.equal(client.sent.length, 3);
  assert.equal(client.sent[0]?.details, 'In the terminal');
  assert.equal(client.sent[0]?.state, 'Focused');
  assert.equal(client.sent[1]?.state, 'In the background');
  assert.equal(client.sent[2], null, 'shutdown clears the presence');
});

test('runner clears the presence when Warp closes and restarts the timer when it reopens', async () => {
  const client = new FakeClient(true);
  await runScenario({
    snapshots: [snapshot(), snapshot({ running: false }), snapshot({ running: false }), snapshot()],
    createClient: () => client,
  });

  assert.equal(client.sent.length, 4);
  const [first, cleared, again, shutdown] = client.sent;
  assert.notEqual(first, null);
  assert.equal(cleared, null);
  assert.notEqual(again, null);
  assert.equal(shutdown, null);
  assert.ok(again!.timestamps!.start! > first!.timestamps!.start!, 'session start resets after Warp closes');
});

test('runner hides the presence in the background when configured', async () => {
  const client = new FakeClient(true);
  await runScenario({
    snapshots: [snapshot(), snapshot({ focused: false }), snapshot()],
    createClient: () => client,
    config: config({ showInBackground: false }),
  });

  assert.equal(client.sent.length, 4);
  assert.equal(client.sent[0]?.state, 'Focused');
  assert.equal(client.sent[1], null, 'hidden while in the background');
  assert.equal(client.sent[2]?.state, 'Focused');
  assert.equal(client.sent[3], null);
});

test('runner keeps polling while Discord is missing and connects once it appears', async () => {
  const offline = new FakeClient(false);
  const online = new FakeClient(true);
  let attempts = 0;
  await runScenario({
    snapshots: [snapshot(), snapshot(), snapshot(), snapshot()],
    createClient: () => (attempts++ === 0 ? offline : online),
  });

  assert.equal(attempts, 2);
  assert.equal(offline.sent.length, 0);
  assert.ok(online.sent.length >= 2);
  assert.equal(online.sent[0]?.details, 'In the terminal');
  assert.equal(online.sent.at(-1), null);
});

test('runner reconnects after Discord drops the pipe and re-sends the presence', async () => {
  const first = new FakeClient(true);
  const second = new FakeClient(true);
  let attempts = 0;
  await runScenario({
    snapshots: Array.from({ length: 6 }, () => snapshot()),
    createClient: () => (attempts++ === 0 ? first : second),
    beforeSnapshot: (tick) => {
      if (tick === 3) first.simulateDisconnect();
    },
  });

  assert.equal(attempts, 2);
  assert.equal(first.sent.length, 1, 'first connection sent the presence once');
  assert.ok(second.sent.length >= 2, 'new connection re-sends the presence and clears on shutdown');
  assert.equal(second.sent[0]?.details, 'In the terminal');
  assert.equal(second.sent.at(-1), null);
});

test('runner survives a failing snapshot and carries on', async () => {
  const client = new FakeClient(true);
  let calls = 0;
  const controller = new AbortController();
  await runPresence({
    config: config(),
    logger: silentLogger,
    signal: controller.signal,
    createClient: () => client,
    now: () => 1_000_000 + calls * 70_000,
    snapshot: () => {
      calls += 1;
      if (calls === 1) throw new Error('EnumWindows exploded');
      if (calls >= 3) controller.abort();
      return snapshot();
    },
  });

  assert.equal(calls, 3);
  assert.equal(client.sent[0]?.details, 'In the terminal');
  assert.equal(client.sent.at(-1), null);
});
