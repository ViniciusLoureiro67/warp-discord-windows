<h1 align="center">warp-discord-windows</h1>

<p align="center">
  Discord Rich Presence for the <a href="https://www.warp.dev">Warp</a> terminal on Windows.<br/>
  Let people see you're in the terminal: what you're working on, whether you're focused, and for how long.
</p>

<p align="center">
  <a href="https://github.com/ViniciusLoureiro67/warp-discord-windows/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ViniciusLoureiro67/warp-discord-windows/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://www.npmjs.com/package/warp-discord-windows"><img alt="npm" src="https://img.shields.io/npm/v/warp-discord-windows"></a>
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Windows" src="https://img.shields.io/badge/platform-Windows%2010%2F11-0078D4">
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D18-339933">
</p>

<!-- TODO(maintainer): add docs/screenshot.png of the Discord profile card and reference it here. -->

```
┌──────────────────────────────────────────┐
│  Playing Warp                            │
│  ┌────┐  warp-discord-windows            │  ← Warp's window title (your folder or command)
│  │ >_ │  Focused                         │  ← Focused · In the background · Idle
│  └────┘  00:42:17 elapsed                │  ← since Warp was opened
└──────────────────────────────────────────┘
```

## Why

VS Code, JetBrains and even Neovim have had Discord Rich Presence for years. Warp has no
integration at all, and the only community project ([NSTTivana/Discord-Rich-Presence-Warp-Terminal-macOS](https://github.com/NSTTivana/Discord-Rich-Presence-Warp-Terminal-macOS))
is macOS-only and needs a shell hook.

**warp-discord-windows** is the Windows answer, with nothing to add to your PowerShell profile:

- It reads Warp's window title straight from Win32 (`user32.dll`), so it works with any shell inside Warp: PowerShell, cmd, Git Bash, WSL.
- It talks to Discord over the local IPC pipe (`\\.\pipe\discord-ipc-0`) with a small hand-written client. No abandoned `discord-rpc` dependency.
- One command to try it, one command to start with Windows.

## Features

- **Zero setup.** Install, run, done. No shell hooks, no profile edits, no admin rights.
- **Focus aware.** Shows *Focused* while Warp is the active window, *In the background* while you are elsewhere, and clears itself when Warp closes.
- **Idle detection.** After a few minutes without keyboard or mouse input the status flips to *Idle* (configurable, or off).
- **Elapsed timer** counting from the moment Warp was opened.
- **Privacy first.** Only Warp's own window title is read. Your home directory is shown as `~`, and a single switch hides the title completely.
- **Survives everything.** Discord not started yet? Restarted? Warp closed and reopened? The presence catches up on its own with exponential backoff.
- **Autostart with Windows** through a hidden launcher in your Startup folder. Disable it just as easily.
- **Configurable** texts, images, activity type and up to two profile buttons, from a JSON file or the CLI.
- **Lightweight.** One Node.js process, about half a millisecond per poll, and updates are only sent when something actually changed.
- **`doctor`** tells you exactly what is wrong when something is.

## Requirements

- Windows 10 or 11 (x64)
- [Node.js](https://nodejs.org) 18 or newer
- The Discord **desktop** app (Rich Presence does not work with Discord in a browser)
- [Warp for Windows](https://www.warp.dev/windows-terminal)

## Quick start

```powershell
npm install -g warp-discord-windows
warp-discord-windows
```

That runs it in the foreground and prints what it is doing. Open Warp, look at your Discord profile, press `Ctrl+C` when you are done.

Prefer not to install anything? `npx warp-discord-windows` works too.

To have it running all the time:

```powershell
warp-discord-windows autostart on
```

This starts it in the background right away and again every time you log in to Windows.
`warp-discord-windows autostart off` reverts it.

> **Note**
> Rich Presence needs a Discord *application id*. The published package ships with one built in,
> so the commands above just work. If you cloned the repository instead, follow
> [Using your own Discord application](#using-your-own-discord-application) once.

## Commands

| Command | What it does |
| --- | --- |
| `warp-discord-windows` / `run` | Run in the foreground and show what happens. `--verbose` prints window titles and every payload sent to Discord. |
| `start` | Run in the background and return to the prompt. |
| `stop` | Stop the background instance. Discord clears the presence immediately. |
| `status` | One screen with the instance, autostart, Discord and Warp state. |
| `doctor` | Check Windows, Node, native bindings, Warp, Discord and the application id, including a real handshake. |
| `autostart on` / `off` / `status` | Manage the login launcher. |
| `config show` / `get <key>` / `set <key> <value>` / `reset [key]` / `path` / `open` / `keys` | Read and change the configuration. |
| `logs [-n 50]` | Print the last lines of the log file. |

Flags: `--client-id <id>` uses another Discord application for this run, `--background` runs silently (used by autostart), `--version`, `--help`.

## Configuration

The config file lives at `%APPDATA%\warp-discord-windows\config.json` and is created on the first `config set`.
Everything has a sensible default; only add the keys you want to change.

```json
{
  "clientId": "",
  "pollIntervalMs": 2000,
  "idleAfterMinutes": 5,
  "showWindowTitle": true,
  "showInBackground": true,
  "showElapsedTime": true,
  "activityType": 0,
  "largeImageKey": "warp",
  "largeImageText": "Warp Terminal",
  "smallImageKey": "windows",
  "smallImageText": "Windows",
  "buttons": [],
  "text": {
    "noTitle": "In the terminal",
    "focused": "Focused",
    "background": "In the background",
    "idle": "Idle"
  }
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `clientId` | built-in | Discord application id. `WARP_DISCORD_CLIENT_ID` and `--client-id` override it. |
| `pollIntervalMs` | `2000` | How often the desktop is inspected. Minimum `500`. |
| `idleAfterMinutes` | `5` | Minutes without input before the *Idle* text. `0` disables idle detection. |
| `showWindowTitle` | `true` | Show Warp's window title as the first line. `false` shows `text.noTitle` instead. |
| `showInBackground` | `true` | Keep the presence while Warp is open but not focused. `false` hides it until you come back. |
| `showElapsedTime` | `true` | Show the elapsed timer. |
| `activityType` | `0` | `0` Playing, `2` Listening to, `3` Watching, `5` Competing in. |
| `largeImageKey` / `largeImageText` | `warp` / `Warp Terminal` | Art asset key uploaded to the Discord application and its hover text. Empty key hides the image. |
| `smallImageKey` / `smallImageText` | `windows` / `Windows` | The small badge over the large image. |
| `buttons` | `[]` | Up to two `{ "label", "url" }` buttons. Discord shows them to *other* people, never to you. |
| `text.*` | see above | The texts used for each state. |

From the CLI:

```powershell
warp-discord-windows config set showWindowTitle false
warp-discord-windows config set text.focused "Deep in the terminal"
warp-discord-windows config set idleAfterMinutes 10
warp-discord-windows config set buttons '[{"label":"My GitHub","url":"https://github.com/you"}]'
warp-discord-windows config reset text.focused
```

Restart the background instance after changing the config: `warp-discord-windows stop` then `start`.

## What ends up on your profile

- **First line:** Warp's window title. With Warp's defaults that is your current directory or the running command; tools like Claude Code, `npm` or `cargo` set their own titles. Progress spinner glyphs are stripped and your home directory becomes `~`.
- **Second line:** `Focused`, `In the background` or `Idle`.
- **Timer:** since Warp was first seen in this session.
- **Images and buttons:** whatever the Discord application has and whatever you configured.

Only Warp windows are inspected. Titles of other windows (browser tabs, chats, documents) are never read, logged or sent anywhere.

## How it works

```
 every 2 s                                              Discord desktop app
┌─────────────┐  EnumWindows / GetForegroundWindow   ┌──────────────────────┐
│ user32.dll  │ ───────────────────────────────────▶ │ \\.\pipe\discord-ipc-0│
│ kernel32.dll│  QueryFullProcessImageName == warp.exe│  handshake {client_id}│
└─────────────┘  GetLastInputInfo (idle)             │  SET_ACTIVITY {...}   │
       │                                             └──────────────────────┘
       ▼
 WarpSnapshot { running, focused, title, idleMs }
       │
       ▼
 buildActivity(snapshot, config)  →  only sent when the payload changed
```

1. **Win32, through [koffi](https://koffi.dev).** koffi is a prebuilt FFI module, so there is nothing to compile on install. Every poll enumerates the visible top-level windows, keeps the ones whose process is `warp.exe`, and checks whether one of them is the foreground window.
2. **Discord IPC.** Discord's desktop app listens on `\\.\pipe\discord-ipc-0` through `-9`. Frames are `[opcode][length][JSON]`; after a handshake with the application id, `SET_ACTIVITY` commands update the presence. The client in [`src/discord/ipc.ts`](src/discord/ipc.ts) is about 300 lines and has no dependencies.
3. **The loop** in [`src/runner.ts`](src/runner.ts) diffs the payload, respects Discord's 15-second update window, reconnects with backoff, and clears the presence when Warp closes or the tool stops.

## Using your own Discord application

The published package ships with a shared application id (the same model VS Code presence extensions use).
You only need your own if you clone the repository, want a different name than "Warp", or your own artwork.

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**. The name is what Discord shows after "Playing", so call it **Warp**.
2. Copy the **Application ID** from *General Information*.
3. Under **Rich Presence → Art Assets**, upload an image with the key `warp` (the large icon) and optionally `windows` (the small badge). Assets can take a few minutes to propagate.
4. `warp-discord-windows config set clientId <Application ID>`, or set `WARP_DISCORD_CLIENT_ID`.
5. `warp-discord-windows doctor` should now report a successful handshake with your Discord user.

## Troubleshooting

**Nothing shows up in Discord.**
Run `warp-discord-windows doctor`. Then check Discord → *User Settings* → *Activity Privacy*: "Share your detected activities with others" must be on. Rich Presence also only works with the desktop app, not the browser.

**"Invalid Client ID (code 4000)".**
The application id is wrong or was deleted. Fix it with `config set clientId <id>`.

**"Playing Warp" appears but without images.**
The application has no art asset with the key in `largeImageKey` (default `warp`). Upload one or set the key to an existing asset.

**I do not see the buttons.**
Discord never shows your own buttons to you. Ask a friend, or open your profile from another account.

**Autostart stopped working after I updated Node.**
The launcher stores the full path to `node.exe`. Version managers (nvm, fnm, volta) change it; run `warp-discord-windows autostart on` again.

**Two Discord clients (Stable and Canary/PTB).**
All pipes from 0 to 9 are probed; the first that answers wins.

**Warp is running but `status` says it is not.**
Only visible top-level windows count. Run `warp-discord-windows doctor` and open an issue with its output if Warp is clearly open.

## Roadmap

- [ ] Optional shell hook for the current directory and git branch, independent of the window title
- [ ] Per-project titles and simple redaction rules (`hideTitlesMatching`)
- [ ] Hot-reload the config without restarting
- [ ] Single-file `.exe` release for people without Node.js
- [ ] System tray icon
- [ ] `winget` package

Ideas and pull requests are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

- [NSTTivana/Discord-Rich-Presence-Warp-Terminal-macOS](https://github.com/NSTTivana/Discord-Rich-Presence-Warp-Terminal-macOS) for proving the idea on macOS.
- [koffi](https://koffi.dev) for making Win32 calls from Node.js painless.
- [Discord's IPC documentation](https://discord.com/developers/docs/topics/rpc) and the many open-source RPC clients that documented the pipe protocol.

Warp is a trademark of Denver Technologies, Inc. Discord is a trademark of Discord Inc. This project is not affiliated with either.

## License

[MIT](LICENSE) © Vinicius Loureiro
