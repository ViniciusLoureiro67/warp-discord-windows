import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_CONFIG, type Config } from './config.js';
import {
  buildActivity,
  clampField,
  classifyTitle,
  describeTitle,
  normalizeTitle,
  presenceMode,
  renderTemplate,
  type PresenceInput,
} from './presence.js';

const HOME = 'C:\\Users\\vini';

function input(overrides: Partial<PresenceInput> = {}): PresenceInput {
  return {
    running: true,
    focused: true,
    title: '~\\projects\\warp-discord-windows',
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
  assert.equal(normalizeTitle('✳ Discord Rich Presence para Warp Windows', HOME), 'Discord Rich Presence para Warp Windows');
  assert.equal(normalizeTitle('⠹ npm install', HOME), 'npm install');
  assert.equal(normalizeTitle('🚀 deploying', HOME), 'deploying');
  assert.equal(normalizeTitle('plain', HOME), 'plain');
});

test('normalizeTitle replaces the home directory with ~ in both slash styles', () => {
  assert.equal(normalizeTitle('C:\\Users\\vini\\projects\\app', HOME), '~\\projects\\app');
  assert.equal(normalizeTitle('c:/users/VINI/projects/app', HOME), '~/projects/app');
  assert.equal(normalizeTitle('nothing here', HOME), 'nothing here');
});

test('classifyTitle recognises directories', () => {
  assert.deepEqual(classifyTitle('~\\documents\\diversos\\warp-discord-windows', HOME), {
    kind: 'directory',
    title: '~\\documents\\diversos\\warp-discord-windows',
    folder: 'warp-discord-windows',
    program: '~\\documents\\diversos\\warp-discord-windows',
  });
  assert.equal(classifyTitle('C:\\Users\\vini\\My Projects\\app', HOME).folder, 'app');
  assert.equal(classifyTitle('/home/vini/src', HOME).folder, 'src');
  assert.equal(classifyTitle('src/app', HOME).kind, 'directory');
  assert.equal(classifyTitle('~', HOME).folder, '~');
  // A bare folder name is a directory unless it is a program we know.
  assert.equal(classifyTitle('my-project', HOME).kind, 'directory');
  assert.equal(classifyTitle('claude', HOME).kind, 'command');
});

test('classifyTitle recognises commands and extracts the program', () => {
  assert.equal(classifyTitle('node bin/warp-discord-windows.js run --verbose', HOME).program, 'node warp-discord-windows');
  assert.equal(classifyTitle('npm run dev', HOME).program, 'npm run');
  assert.equal(classifyTitle('git commit -m "wip"', HOME).program, 'git commit');
  assert.equal(classifyTitle('cargo build --release', HOME).program, 'cargo build');
  assert.equal(classifyTitle('npm --version', HOME).program, 'npm');
  assert.equal(classifyTitle('"C:\\Program Files\\nodejs\\node.exe" server.js', HOME).program, 'node server');
  assert.equal(classifyTitle('python3 -m http.server', HOME).program, 'python3');
  assert.equal(classifyTitle('ls', HOME).program, 'ls');
  // Full commands can carry secrets; only the program name is extracted.
  assert.equal(classifyTitle('curl -H "Authorization: Bearer abc123"', HOME).program, 'curl');
});

test('classifyTitle treats decorated titles as tasks and ignores the startup title', () => {
  const task = classifyTitle('✳ Discord Rich Presence para Warp Windows', HOME);
  assert.equal(task.kind, 'task');
  assert.equal(task.title, 'Discord Rich Presence para Warp Windows');
  assert.equal(classifyTitle('◑ Fix the login bug', HOME).kind, 'task');
  assert.equal(classifyTitle('Warp', HOME).kind, 'none');
  assert.equal(classifyTitle('   ', HOME).kind, 'none');
});

test('renderTemplate fills placeholders and drops unknown ones', () => {
  assert.equal(renderTemplate('Working in {folder}', { folder: 'app' }), 'Working in app');
  assert.equal(renderTemplate('{nope} {program}', { program: 'git' }), 'git');
  assert.equal(renderTemplate('Terminal developer', {}), 'Terminal developer');
});

test('describeTitle applies the template for each kind of title', () => {
  const cfg = config();
  assert.equal(describeTitle('~\\projects\\warp-discord-windows', cfg, HOME), 'Working in warp-discord-windows');
  assert.equal(describeTitle('node bin/warp-discord-windows.js run', cfg, HOME), 'Running node warp-discord-windows');
  assert.equal(describeTitle('✳ Discord Rich Presence para Warp Windows', cfg, HOME), 'Working on Discord Rich Presence para Warp Windows');
  assert.equal(describeTitle('Warp', cfg, HOME), 'In the terminal');
  assert.equal(describeTitle(null, cfg, HOME), 'In the terminal');
  assert.equal(describeTitle('~\\x', config({ showWindowTitle: false }), HOME), 'In the terminal');
});

test('describeTitle supports fixed text and custom placeholders', () => {
  const fixed = config({ text: { ...DEFAULT_CONFIG.text, directory: 'Terminal developer', command: 'Terminal developer' } });
  assert.equal(describeTitle('~\\projects\\app', fixed, HOME), 'Terminal developer');
  assert.equal(describeTitle('npm test', fixed, HOME), 'Terminal developer');
  const verbose = config({ text: { ...DEFAULT_CONFIG.text, command: '$ {command}', directory: '📁 {path}' } });
  assert.equal(describeTitle('npm test', verbose, HOME), '$ npm test');
  assert.equal(describeTitle('C:\\Users\\vini\\app', verbose, HOME), '📁 ~\\app');
  const empty = config({ text: { ...DEFAULT_CONFIG.text, directory: '' } });
  assert.equal(describeTitle('~\\app', empty, HOME), 'In the terminal');
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
    details: 'Working in warp-discord-windows',
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
