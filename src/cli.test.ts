import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseArgs } from './cli.js';

test('parseArgs separates the command, positionals and flags', () => {
  const parsed = parseArgs(['config', 'set', 'text.idle', 'Away', 'from', 'keyboard', '--verbose']);
  assert.equal(parsed.command, 'config');
  assert.deepEqual(parsed.positional, ['set', 'text.idle', 'Away', 'from', 'keyboard']);
  assert.equal(parsed.flags.get('verbose'), true);
});

test('parseArgs reads flag values inline, separated and via short aliases', () => {
  assert.equal(parseArgs(['run', '--client-id=123']).flags.get('client-id'), '123');
  assert.equal(parseArgs(['run', '--client-id', '123']).flags.get('client-id'), '123');
  assert.equal(parseArgs(['logs', '-n', '10']).flags.get('lines'), '10');
  assert.equal(parseArgs(['-v']).flags.get('verbose'), true);
  assert.equal(parseArgs(['-h']).flags.get('help'), true);
  assert.equal(parseArgs([]).command, undefined);
});

test('parseArgs does not swallow the next flag as a value', () => {
  const parsed = parseArgs(['run', '--client-id', '--verbose']);
  assert.equal(parsed.flags.get('client-id'), true);
  assert.equal(parsed.flags.get('verbose'), true);
});
