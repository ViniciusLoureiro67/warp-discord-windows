# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-09-19

First release.

### Added

- Discord Rich Presence for Warp on Windows: shows the Warp window title, whether Warp is focused, in the background or idle, and an elapsed timer.
- Hand-written Discord IPC client over named pipes (handshake, `SET_ACTIVITY`, ping/pong, reconnect with backoff).
- Win32 window inspection through [koffi](https://koffi.dev) (foreground window, window titles, process image path, idle time).
- Interactive menu (`warp-discord-windows` with no arguments, or `menu`): turn it on/off, change the wording, check everything. `setup.cmd` opens it with a double click for people who downloaded the repository.
- CLI: `run`, `start`, `stop`, `status`, `doctor`, `autostart on|off`, `config`, `logs`.
- Control pipe between the CLI and the running instance: `stop` shuts it down gracefully (presence cleared), `status` and the menu show uptime and the connected Discord user.
- Config changes are applied live by the running instance; no restart needed.
- Autostart at login through a hidden launcher in the Startup folder (no administrator rights needed).
- Private by default: the card only says *In the terminal*, *Running a command* or *Working on a task* plus focus state and timer. Warp's window title decides which text is used but never reaches Discord unless a template asks for it.
- Presets `generic` (default), `fun` and `detailed` (opt-in folder, program and task names), a `firstLine` option for one fixed phrase, and per-text overrides with `{folder}`, `{path}`, `{program}`, `{command}` and `{title}` placeholders.
- JSON config in `%APPDATA%\warp-discord-windows\config.json` that stores only what you changed; `config show`, `presets`, `set`, `reset`, `open`.
- Home directory is replaced by `~` and CLI spinner glyphs are stripped from titles before they are interpreted.
- Built-in Discord application ("Warp"), so nothing needs to be created in the Developer Portal.
- Patient handshake: Discord only answers a new Rich Presence handshake about 30 s after the previous session closed, so the client waits and says why instead of reporting Discord as not running.

[Unreleased]: https://github.com/ViniciusLoureiro67/warp-discord-windows/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ViniciusLoureiro67/warp-discord-windows/releases/tag/v0.1.0
