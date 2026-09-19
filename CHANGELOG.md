# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Discord Rich Presence for Warp on Windows: shows the Warp window title, whether Warp is focused, in the background or idle, and an elapsed timer.
- Hand-written Discord IPC client over named pipes (handshake, `SET_ACTIVITY`, ping/pong, reconnect with backoff).
- Win32 window inspection through [koffi](https://koffi.dev) (foreground window, window titles, process image path, idle time).
- CLI: `run`, `start`, `stop`, `status`, `doctor`, `autostart on|off`, `config`, `logs`.
- Autostart at login through a hidden launcher in the Startup folder (no administrator rights needed).
- JSON config in `%APPDATA%\warp-discord-windows\config.json` with privacy toggles (`showWindowTitle`, `showInBackground`) and custom texts, images and buttons.
- Home directory is replaced by `~` and CLI spinner glyphs are stripped from titles before they reach Discord.
