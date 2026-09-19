<h1 align="center">warp-discord-windows</h1>

<p align="center">
  Discord Rich Presence for the <a href="https://www.warp.dev">Warp</a> terminal on Windows.<br/>
  Show that you live in the terminal, without showing what you are doing there.
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
│  ┌────┐  In the terminal                 │  ← generic by default: never your folders or commands
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

- **Private by default.** The card says *In the terminal*, *Running a command* or *Working on a task*, plus whether you are focused and for how long. No folder names, no commands, no project names ever leave your machine unless you opt in.
- **Zero setup.** Install, pick *Turn it on* in the menu, done. No shell hooks, no profile edits, no admin rights, no terminal left open.
- **Presets and a fixed phrase.** Pick `generic`, `fun` or `detailed` wording with one command, or set a single line like *Terminal developer* and call it a day.
- **Focus aware.** *Focused* while Warp is the active window, *In the background* while you are elsewhere, cleared when Warp closes.
- **Idle detection.** A few minutes without keyboard or mouse input flips the status to *Idle* (configurable, or off).
- **Elapsed timer** counting from the moment Warp was opened.
- **Survives everything.** Discord not started yet? Restarted? Warp closed and reopened? The presence catches up on its own.
- **Autostart with Windows** through a hidden launcher in your Startup folder. Disable it just as easily.
- **Lightweight.** One Node.js process, about half a millisecond per poll, updates only sent when something changed.
- **Live config.** Change the wording while it runs; the instance picks it up in seconds. `stop` shuts it down gracefully over a local control pipe.
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

The second command opens a small menu:

```
  Presence   ○ off (not running)
  Startup    ○ not on startup
  Wording    preset "generic" (In the terminal · Focused)

? What do you want to do?
❯ Turn it on           Start now and every time you log in to Windows
  Turn it off          Stop it and remove it from Windows startup
  Change the wording   Pick a preset or write your own line
  Check everything     Discord, Warp and the application id
  Watch it live        Run in this window with logs, Ctrl+C to leave
  Quit
```

Pick **Turn it on** and you are done: it runs in the background now and again every time you log in to Windows, no terminal needed. Discord shows *Playing Warp* within about 30 seconds.

Prefer not to install anything? `npx warp-discord-windows` opens the same menu.

**Not a terminal person?** Download the repository, double-click `setup.cmd`. It installs what it needs, builds once and opens the menu.

**Prefer plain commands?** Everything in the menu is a command too: `warp-discord-windows autostart on` (start now and with Windows), `stop`, `status`, `config set preset fun`.

> **Note**
> Rich Presence needs a Discord *application id*. One is built in (the "Warp" application this
> project maintains), so the commands above just work. Want your own name or artwork? See
> [Using your own Discord application](#using-your-own-discord-application).

## Commands

| Command | What it does |
| --- | --- |
| `warp-discord-windows` / `menu` | The menu: turn it on or off, change the wording, check everything. (Outside a terminal, the bare command prints the help.) |
| `run` | Run in the foreground and show what happens. `--verbose` prints window titles and every payload sent to Discord. |
| `start` | Run in the background and return to the prompt. |
| `stop` | Stop the background instance gracefully. The presence is cleared right away. |
| `status` | One screen with the instance, autostart, Discord and Warp state. |
| `doctor` | Check Windows, Node, native bindings, Warp, Discord and the application id, including a real handshake. |
| `autostart on` / `off` / `status` | Manage the login launcher. |
| `config show` / `presets` / `get <key>` / `set <key> <value>` / `reset [key]` / `path` / `open` / `keys` / `init` | Read and change the configuration. Changes apply to the running instance within seconds, no restart. |
| `logs [-n 50]` | Print the last lines of the log file. |

Flags: `--client-id <id>` uses another Discord application for this run, `--background` runs silently (used by autostart), `--version`, `--help`.

## Choosing what the card says

The first line depends on what Warp is doing (waiting at the prompt, running a command, or a tool such as Claude Code naming the session). The second line is your focus state. What each situation *says* comes from a preset:

| Preset | Prompt | Command | Task | Focused / Background / Idle |
| --- | --- | --- | --- | --- |
| `generic` (default) | In the terminal | Running a command | Working on a task | Focused / In the background / Idle |
| `fun` | Staring at a blinking cursor | Waiting for a command to finish | Deep in the zone | Locked in / Multitasking / AFK |
| `detailed` | Working in *warp-discord-windows* | Running *npm run* | Working on *Fix the login bug* | Focused / In the background / Idle |

```powershell
warp-discord-windows config presets            # see them side by side
warp-discord-windows config set preset fun
```

`generic` and `fun` reveal nothing about your work. `detailed` is an explicit opt-in: it includes the folder name, the program name (`git commit`, `npm run`, `node server`, never the full command line) or the task name from Warp's title.

**Just one fixed phrase?**

```powershell
warp-discord-windows config set firstLine "Terminal developer"
```

That replaces the first line everywhere. `config reset firstLine` turns it back off.

**Custom wording.** Every text is a template you can override individually, on top of any preset:

```powershell
warp-discord-windows config set text.prompt "Plotting the next command"
warp-discord-windows config set text.idle "AFK, probably coffee"
warp-discord-windows config reset text.prompt        # back to the preset's wording
```

Templates may contain placeholders. They are filled from Warp's window title, so use them only if you are fine with that information on your profile:

| Placeholder | Value |
| --- | --- |
| `{folder}` | Last segment of the current directory (`warp-discord-windows`) |
| `{path}` | The whole directory with your home as `~` (`~\projects\warp-discord-windows`) |
| `{program}` | The program, plus its subcommand for `npm`, `git`, `cargo`, `docker`... (`git commit`) |
| `{command}` | The full command line. Careful: commands can contain tokens and passwords. |
| `{title}` | The cleaned window title, whatever it is |

Every change is picked up by the running instance within a couple of seconds; nothing to restart.

## Configuration

The config file lives at `%APPDATA%\warp-discord-windows\config.json` and only holds what you changed. Everything else comes from the preset and the defaults; `warp-discord-windows config show` prints the effective result.

```json
{
  "preset": "fun",
  "idleAfterMinutes": 10,
  "text": {
    "idle": "AFK, probably coffee"
  }
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `clientId` | built-in | Discord application id. `WARP_DISCORD_CLIENT_ID` and `--client-id` override it. |
| `preset` | `generic` | `generic`, `fun` or `detailed`. Decides every text you did not override. |
| `firstLine` | `""` | A fixed first line that replaces the prompt/command/task texts. Empty means off. |
| `pollIntervalMs` | `2000` | How often the desktop is inspected. Minimum `500`. |
| `idleAfterMinutes` | `5` | Minutes without input before the idle text. `0` disables idle detection. |
| `showInBackground` | `true` | Keep the presence while Warp is open but not focused. `false` hides it until you come back. |
| `showElapsedTime` | `true` | Show the elapsed timer. |
| `activityType` | `0` | `0` Playing, `2` Listening to, `3` Watching, `5` Competing in. |
| `largeImageKey` / `largeImageText` | `warp` / `Warp Terminal` | Art asset key uploaded to the Discord application and its hover text. Empty key hides the image. |
| `smallImageKey` / `smallImageText` | `windows` / `Windows` | The small badge over the large image. |
| `buttons` | `[]` | Up to two `{ "label", "url" }` buttons. Discord shows them to *other* people, never to you. |
| `text.prompt` / `text.command` / `text.task` | from preset | First line while waiting at the prompt / running a command / in a named task. |
| `text.fallback` | from preset | First line when the title is empty or not understood. |
| `text.focused` / `text.background` / `text.idle` | from preset | Second line for each state. |

## What is read, and what is sent

Only Warp windows are inspected: their titles decide which text to show, that is all. Titles of other windows (browser tabs, chats, documents) are never read, logged or sent anywhere. With the default presets the payload that reaches Discord is exactly the preset text, the focus state and the timer.

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
2. **Discord IPC.** Discord's desktop app listens on `\\.\pipe\discord-ipc-0` through `-9`. Frames are `[opcode][length][JSON]`; after a handshake with the application id, `SET_ACTIVITY` commands update the presence. The client in [`src/discord/ipc.ts`](src/discord/ipc.ts) is about 300 lines and has no dependencies. One quirk worth knowing: Discord delays a new handshake for about 30 seconds after the previous session on the pipe closed, so the client waits patiently instead of assuming Discord is gone.
3. **The loop** in [`src/runner.ts`](src/runner.ts) diffs the payload, respects Discord's 15-second update window, reconnects with backoff, and clears the presence when Warp closes or the tool stops.

## Using your own Discord application

A shared application id is built in (the same model VS Code presence extensions use), so this is optional.
Create your own only if you want a different name than "Warp" or your own artwork.

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**. The name is what Discord shows after "Playing", so call it **Warp**.
2. Copy the **Application ID** from *General Information*.
3. Under **Rich Presence → Art Assets**, upload an image with the key `warp` (the large icon) and optionally `windows` (the small badge). Assets can take a few minutes to propagate.
4. `warp-discord-windows config set clientId <Application ID>`, or set `WARP_DISCORD_CLIENT_ID`.
5. `warp-discord-windows doctor` should now report a successful handshake with your Discord user.

## Troubleshooting

**Nothing shows up in Discord.**
Run `warp-discord-windows doctor`. Then check Discord → *User Settings* → *Activity Privacy*: "Share your detected activities with others" must be on. Rich Presence also only works with the desktop app, not the browser.

**"Connected to Discord" only shows up half a minute after `doctor`, `stop`/`start` or a restart.**
Discord answers a new Rich Presence handshake only about 30 seconds after the previous session on that pipe closed. The pipe accepts instantly, the `READY` reply is what waits. Nothing is wrong; the log says so while it waits, and the presence appears as soon as Discord answers.

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
