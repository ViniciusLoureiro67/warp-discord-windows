import assert from 'node:assert/strict';
import { test } from 'node:test';

import { encodeFrame, FrameDecoder, Opcode, pipePath } from './ipc.js';

test('encodeFrame writes little-endian opcode and payload length', () => {
  const frame = encodeFrame(Opcode.Handshake, { v: 1, client_id: '123' });
  const body = Buffer.from(JSON.stringify({ v: 1, client_id: '123' }), 'utf8');
  assert.equal(frame.readUInt32LE(0), 0);
  assert.equal(frame.readUInt32LE(4), body.length);
  assert.deepEqual(frame.subarray(8), body);
});

test('FrameDecoder decodes a single complete frame', () => {
  const decoder = new FrameDecoder();
  const frames = decoder.push(encodeFrame(Opcode.Frame, { cmd: 'SET_ACTIVITY' }));
  assert.deepEqual(frames, [{ op: 1, data: { cmd: 'SET_ACTIVITY' } }]);
});

test('FrameDecoder buffers fragmented frames', () => {
  const decoder = new FrameDecoder();
  const frame = encodeFrame(Opcode.Frame, { evt: 'READY', data: { user: { username: 'vini' } } });
  assert.deepEqual(decoder.push(frame.subarray(0, 3)), []);
  assert.deepEqual(decoder.push(frame.subarray(3, 12)), []);
  const frames = decoder.push(frame.subarray(12));
  assert.equal(frames.length, 1);
  assert.equal(frames[0]?.op, Opcode.Frame);
  assert.deepEqual(frames[0]?.data, { evt: 'READY', data: { user: { username: 'vini' } } });
});

test('FrameDecoder splits multiple frames arriving in one chunk', () => {
  const decoder = new FrameDecoder();
  const chunk = Buffer.concat([
    encodeFrame(Opcode.Ping, { n: 1 }),
    encodeFrame(Opcode.Close, { code: 4000, message: 'Invalid Client ID' }),
  ]);
  const frames = decoder.push(chunk);
  assert.deepEqual(frames, [
    { op: Opcode.Ping, data: { n: 1 } },
    { op: Opcode.Close, data: { code: 4000, message: 'Invalid Client ID' } },
  ]);
});

test('FrameDecoder treats an empty payload as null', () => {
  const decoder = new FrameDecoder();
  const header = Buffer.alloc(8);
  header.writeUInt32LE(Opcode.Pong, 0);
  header.writeUInt32LE(0, 4);
  assert.deepEqual(decoder.push(header), [{ op: Opcode.Pong, data: null }]);
});

test('pipePath builds the Windows named pipe path', () => {
  assert.equal(pipePath(0), '\\\\.\\pipe\\discord-ipc-0');
  assert.equal(pipePath(9), '\\\\.\\pipe\\discord-ipc-9');
});
