import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_CONFIG, type Config } from './config.js';
import { buildActivity, clampField, normalizeTitle, presenceMode, type PresenceInput } from './presence.js';

const HOME = 'C:\\Users\\vini';

function input(overrides: Partial<PresenceInput> = {}): PresenceInput {
  return {
    running: true,
    focused: true,
    title: 'warp-discord-windows',
    idleMs: 0,
    sessionStart: 1_700_000_000_123,
    ...overrides,
  };
}

function config(overrides: Partial<Config> = {}): Config {
  return { ...structuredClone(DEFAULT_CONFIG), ...overrides };
}

test('normalizeTitle collapses whitespace and strips spinner glyphs', () => {
  assert.equal(normalizeTitle('◐  Discord Rich   Presence ', HOME), 'Discord Rich Presence');
  assert.equal(normalizeTitle('⠹ npm install', HOME), 'npm install');
  assert.equal(normalizeTitle('plain', HOME), 'plain');
});

test('normalizeTitle replaces the home directory with ~ in both slash styles', () => {
  assert.equal(normalizeTitle('C:\\Users\\vini\\projects\\app', HOME), '~\\projects\\app');
  assert.equal(normalizeTitle('c:/users/VINI/projects/app', HOME), '~/projects/app');
  assert.equal(normalizeTitle('nothing here', HOME), 'nothing here');
});

test('clampField enforces the 2..128 character window', () => {
  assert.equal(clampField('a', 'Fallback'), 'Fallback');
  assert.equal(clampField('   ', 'x'), 'Warp');
  assert.equal(clampField('ok', 'Fallback'), 'ok');
  const long = 'x'.repeat(200);
  const clamped = clampField(long, 'Fallback');
  assert.equal(Array.from(clamped).length, 128);
  assert.ok(clamped.endsWith('…'));
});

test('buildActivity clears the presence when Warp is closed', () => {
  assert.equal(buildActivity(input({ running: false }), config()), null);
  assert.equal(presenceMode(input({ running: false }), config()), 'closed');
});

test('buildActivity hides the presence in the background when configured', () => {
  const hidden = config({ showInBackground: false });
  assert.equal(buildActivity(input({ focused: false }), hidden), null);
  assert.notEqual(buildActivity(input({ focused: true }), hidden), null);
});

test('buildActivity fills details, state, assets and timestamps', () => {
  const activity = buildActivity(input(), config());
  assert.deepEqual(activity, {
    type: 0,
    details: 'warp-discord-windows',
    state: 'Focused',
    instance: false,
    assets: {
      large_image: 'warp',
      large_text: 'Warp Terminal',
      small_image: 'windows',
      small_text: 'Windows',
    },
    timestamps: { start: 1_700_000_000 },
  });
});

test('buildActivity switches state for background and idle', () => {
  assert.equal(buildActivity(input({ focused: false }), config())?.state, 'In the background');
  assert.equal(buildActivity(input({ idleMs: 5 * 60_000 }), config())?.state, 'Idle');
  assert.equal(buildActivity(input({ idleMs: 5 * 60_000 }), config({ idleAfterMinutes: 0 }))?.state, 'Focused');
});

test('buildActivity respects privacy and display toggles', () => {
  const activity = buildActivity(
    input({ title: 'C:\\Users\\vini\\secret' }),
    config({ showWindowTitle: false, showElapsedTime: false, largeImageKey: '' }),
  );
  assert.equal(activity?.details, 'In the terminal');
  assert.equal(activity?.timestamps, undefined);
  assert.equal(activity?.assets, undefined);
});

test('buildActivity falls back when the title is empty and passes valid buttons', () => {
  const activity = buildActivity(
    input({ title: '   ' }),
    config({ buttons: [{ label: 'Repo', url: 'https://example.com' }, { label: 'Nope', url: 'file:///x' }] }),
  );
  assert.equal(activity?.details, 'In the terminal');
  assert.deepEqual(activity?.buttons, [{ label: 'Repo', url: 'https://example.com' }]);
});
