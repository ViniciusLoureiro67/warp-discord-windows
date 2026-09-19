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
  saveConfig,
  withConfigValue,
  withDefaultValue,
} from './config.js';

test('mergeConfig returns defaults for empty input', () => {
  assert.deepEqual(mergeConfig(undefined), DEFAULT_CONFIG);
  assert.deepEqual(mergeConfig({}), DEFAULT_CONFIG);
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
  assert.equal(config.text.focused, DEFAULT_CONFIG.text.focused);
  assert.ok(warnings.some((warning) => warning.includes('"pollIntervalMs"')));
  assert.ok(warnings.some((warning) => warning.includes('"bogus"')));
  assert.ok(warnings.some((warning) => warning.includes('text.nope')));
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

test('withConfigValue parses booleans, numbers, strings and dotted keys', () => {
  let config = withConfigValue(DEFAULT_CONFIG, 'showWindowTitle', 'off');
  assert.equal(config.showWindowTitle, false);
  config = withConfigValue(config, 'idleAfterMinutes', '10');
  assert.equal(config.idleAfterMinutes, 10);
  config = withConfigValue(config, 'text.focused', 'Hacking');
  assert.equal(config.text.focused, 'Hacking');
  config = withConfigValue(config, 'buttons', '[{"label":"Site","url":"https://example.com"}]');
  assert.deepEqual(config.buttons, [{ label: 'Site', url: 'https://example.com' }]);
  assert.equal(getConfigValue(config, 'text.focused'), 'Hacking');
});

test('withConfigValue rejects unknown keys and invalid values', () => {
  assert.throws(() => withConfigValue(DEFAULT_CONFIG, 'nope', '1'), /unknown option "nope"/);
  assert.throws(() => withConfigValue(DEFAULT_CONFIG, 'showWindowTitle', 'maybe'), /expects true or false/);
  assert.throws(() => withConfigValue(DEFAULT_CONFIG, 'pollIntervalMs', '100'), /at least 500/);
  assert.throws(() => withConfigValue(DEFAULT_CONFIG, 'buttons', 'not json'), /expects JSON/);
});

test('withDefaultValue restores a single key', () => {
  const changed = withConfigValue(DEFAULT_CONFIG, 'text.idle', 'Zzz');
  assert.equal(withDefaultValue(changed, 'text.idle').text.idle, DEFAULT_CONFIG.text.idle);
});

test('loadConfig reads the file under APPDATA and honours WARP_DISCORD_CLIENT_ID', () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'wdw-config-'));
  try {
    const missing = loadConfig({ APPDATA: appData });
    assert.equal(missing.exists, false);
    assert.deepEqual(missing.config, DEFAULT_CONFIG);

    saveConfig({ ...DEFAULT_CONFIG, showElapsedTime: false }, missing.path);
    const loaded = loadConfig({ APPDATA: appData, WARP_DISCORD_CLIENT_ID: ' 987654321098765432 ' });
    assert.equal(loaded.exists, true);
    assert.equal(loaded.config.showElapsedTime, false);
    assert.equal(loaded.config.clientId, '987654321098765432');
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
