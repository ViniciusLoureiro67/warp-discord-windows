import assert from 'node:assert/strict';
import { test } from 'node:test';

import { queryControl, startControlServer, type ControlStatus } from './control.js';

const status: ControlStatus = {
  pid: 4242,
  version: '0.0.0-test',
  startedAt: 1_700_000_000_000,
  discordConnected: true,
  discordUser: 'tester',
  warpRunning: true,
  warpFocused: false,
  preset: 'fun',
  firstLine: '',
  configPath: 'C:\\nowhere\\config.json',
};

const pipe = `\\\\.\\pipe\\warp-discord-windows-test-${process.pid}`;

test('control server answers status and stop requests over a named pipe', async () => {
  let stopped = 0;
  const server = await startControlServer({ status: () => status, stop: () => (stopped += 1) }, pipe);
  try {
    const reply = await queryControl('status', pipe);
    assert.deepEqual(reply, { ok: true, status });

    const stopReply = await queryControl('stop', pipe);
    assert.deepEqual(stopReply, { ok: true, pid: process.pid });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(stopped, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('queryControl resolves to null when nobody listens', async () => {
  assert.equal(await queryControl('status', `\\\\.\\pipe\\warp-discord-windows-nobody-${process.pid}`, 500), null);
});

test('a second server on the same pipe is refused', async () => {
  const server = await startControlServer({ status: () => status, stop: () => {} }, pipe);
  try {
    await assert.rejects(startControlServer({ status: () => status, stop: () => {} }, pipe), /EADDRINUSE/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
