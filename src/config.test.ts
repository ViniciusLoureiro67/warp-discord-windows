import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  DEFAULT_CONFIG,
  getConfigValue,
  loadConfig,
  mergeConfig,
  overrideKeys,
  PRESETS,
  saveOverrides,
  withOverride,
  withoutOverride,
} from './config.js';

test('mergeConfig returns defaults for empty input', () => {
  assert.deepEqual(mergeConfig(undefined), DEFAULT_CONFIG);
  assert.deepEqual(mergeConfig({}), DEFAULT_CONFIG);
  assert.deepEqual(DEFAULT_CONFIG.text, PRESETS.generic);
});

test('mergeConfig applies known keys and warns about unknown or mistyped ones', () => {
  const warnings: string[] = [];
  const config = mergeConfig(
    { clientId: '123456789012345678', pollIntervalMs: 'fast', bogus: true, text: { idle: 'AFK', nope: 1 } },
    warnings,
  );
  assert.equal(config.clientId, '123456789012345678');
  assert.equal(config.pollIntervalMs, DEFAULT_CONFIG.pollIntervalMs);
  assert.equal(config.text.idle, 'AFK');
  assert.equal(config.text.focused, PRESETS.generic.focused);
  assert.ok(warnings.some((warning) => warning.includes('"pollIntervalMs"')));
  assert.ok(warnings.some((warning) => warning.includes('"bogus"')));
  assert.ok(warnings.some((warning) => warning.includes('text.nope')));
});

test('mergeConfig starts from the preset and lets text entries override it', () => {
  const warnings: string[] = [];
  const fun = mergeConfig({ preset: 'fun', text: { idle: 'Sleeping' } }, warnings);
  assert.equal(fun.preset, 'fun');
  assert.equal(fun.text.prompt, PRESETS.fun.prompt);
  assert.equal(fun.text.idle, 'Sleeping');
  assert.equal(warnings.length, 0);

  const detailed = mergeConfig({ preset: 'detailed' });
  assert.equal(detailed.text.prompt, 'Working in {folder}');

  const badWarnings: string[] = [];
  const bad = mergeConfig({ preset: 'loud' }, badWarnings);
  assert.equal(bad.preset, 'generic');
  assert.ok(badWarnings.some((warning) => warning.includes('"preset"')));
});

test('mergeConfig clamps the poll interval and rejects bad activity types', () => {
  const warnings: string[] = [];
  const config = mergeConfig({ pollIntervalMs: 10, activityType: 4 }, warnings);
  assert.equal(config.pollIntervalMs, 500);
  assert.equal(config.activityType, 0);
  assert.equal(warnings.length, 2);
});

test('mergeConfig validates buttons', () => {
  const warnings: string[] = [];
  const config = mergeConfig(
    {
      buttons: [
        { label: 'Repo', url: 'https://example.com' },
        { label: 'Bad', url: 'ftp://nope' },
        { label: '', url: 'https://example.com' },
        { label: 'Second', url: 'https://example.org' },
        { label: 'Third', url: 'https://example.net' },
      ],
    },
    warnings,
  );
  assert.deepEqual(config.buttons, [
    { label: 'Repo', url: 'https://example.com' },
    { label: 'Second', url: 'https://example.org' },
  ]);
  assert.equal(warnings.length, 3);
});

test('withOverride parses booleans, numbers, strings, JSON and dotted keys', () => {
  let overrides = withOverride({}, 'showInBackground', 'off');
  assert.deepEqual(overrides, { showInBackground: false });
  overrides = withOverride(overrides, 'idleAfterMinutes', '10');
  overrides = withOverride(overrides, 'text.focused', 'Hacking');
  overrides = withOverride(overrides, 'buttons', '[{"label":"Site","url":"https://example.com"}]');
  assert.deepEqual(overrides, {
    showInBackground: false,
    idleAfterMinutes: 10,
    text: { focused: 'Hacking' },
    buttons: [{ label: 'Site', url: 'https://example.com' }],
  });
  const config = mergeConfig(overrides);
  assert.equal(getConfigValue(config, 'text.focused'), 'Hacking');
  assert.equal(getConfigValue(config, 'idleAfterMinutes'), 10);
});

test('withOverride rejects unknown keys and invalid values', () => {
  assert.throws(() => withOverride({}, 'nope', '1'), /unknown option "nope"/);
  assert.throws(() => withOverride({}, 'text.nope', 'x'), /unknown option "text.nope"/);
  assert.throws(() => withOverride({}, 'showInBackground', 'maybe'), /expects true or false/);
  assert.throws(() => withOverride({}, 'pollIntervalMs', '100'), /at least 500/);
  assert.throws(() => withOverride({}, 'buttons', 'not json'), /expects JSON/);
  assert.throws(() => withOverride({}, 'preset', 'loud'), /"preset" must be one of/);
});

test('switching preset drops text entries that only repeated the old preset', () => {
  const pasted = { preset: 'generic', text: { ...PRESETS.generic, idle: 'Zzz' } };
  const switched = withOverride(pasted, 'preset', 'fun');
  assert.deepEqual(switched, { preset: 'fun', text: { idle: 'Zzz' } });
  const config = mergeConfig(switched);
  assert.equal(config.text.prompt, PRESETS.fun.prompt);
  assert.equal(config.text.idle, 'Zzz');
});

test('withoutOverride removes a key so the preset default applies again', () => {
  const overrides = { preset: 'fun', text: { idle: 'Zzz', focused: 'Go' }, idleAfterMinutes: 3 };
  assert.deepEqual(withoutOverride(overrides, 'text.idle'), { preset: 'fun', text: { focused: 'Go' }, idleAfterMinutes: 3 });
  assert.deepEqual(withoutOverride(withoutOverride(overrides, 'text.idle'), 'text.focused'), { preset: 'fun', idleAfterMinutes: 3 });
  assert.deepEqual(withoutOverride(overrides, 'idleAfterMinutes'), { preset: 'fun', text: { idle: 'Zzz', focused: 'Go' } });
  assert.throws(() => withoutOverride(overrides, 'nope'), /unknown option/);
  assert.deepEqual(overrideKeys(overrides), ['preset', 'text.idle', 'text.focused', 'idleAfterMinutes']);
});

test('loadConfig reads the file under APPDATA and honours WARP_DISCORD_CLIENT_ID', () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'wdw-config-'));
  try {
    const missing = loadConfig({ APPDATA: appData });
    assert.equal(missing.exists, false);
    assert.deepEqual(missing.config, DEFAULT_CONFIG);
    assert.deepEqual(missing.overrides, {});

    saveOverrides({ showElapsedTime: false, preset: 'fun' }, missing.path);
    const loaded = loadConfig({ APPDATA: appData, WARP_DISCORD_CLIENT_ID: ' 987654321098765432 ' });
    assert.equal(loaded.exists, true);
    assert.equal(loaded.config.showElapsedTime, false);
    assert.equal(loaded.config.text.idle, 'AFK');
    assert.equal(loaded.config.clientId, '987654321098765432');
    assert.deepEqual(loaded.overrides, { showElapsedTime: false, preset: 'fun' });
    assert.deepEqual(loaded.warnings, []);

    fs.writeFileSync(missing.path, '{ not json', 'utf8');
    const broken = loadConfig({ APPDATA: appData });
    assert.equal(broken.exists, true);
    assert.equal(broken.warnings.length, 1);
    assert.match(broken.warnings[0]!, /could not parse/);
  } finally {
    fs.rmSync(appData, { recursive: true, force: true });
  }
});
