# Contributing

Thanks for helping make Warp presence better on Windows. Issues, ideas and pull requests are all welcome.

## Development setup

```powershell
git clone https://github.com/ViniciusLoureiro67/warp-discord-windows.git
cd warp-discord-windows
npm install
npm run build
node bin/warp-discord-windows.js doctor
```

- `npm run dev` rebuilds on every change.
- `npm test` builds and runs the unit tests (`src/**/*.test.ts`, powered by `node:test`).
- `node bin/warp-discord-windows.js run --verbose` prints window titles and every presence payload sent to Discord.

Only Windows can run the Win32 bits, but the IPC client, presence builder, config and runner are plain Node.js and have tests that run anywhere.

## Project layout

| Path | What lives there |
| --- | --- |
| `src/discord/ipc.ts` | Discord IPC framing and client (named pipes, handshake, `SET_ACTIVITY`) |
| `src/win32/native.ts` | koffi bindings for `user32.dll` / `kernel32.dll` |
| `src/win32/warp.ts` | Turns raw windows into a `WarpSnapshot` (running, focused, title, idle) |
| `src/presence.ts` | Pure function from snapshot + config to the Discord activity |
| `src/runner.ts` | The loop: poll, diff, throttle, reconnect |
| `src/config.ts` | Defaults, validation, `config set` parsing |
| `src/cli.ts` | Commands and output |
| `src/autostart.ts`, `src/daemon.ts` | Startup folder launcher and pid file |

## Pull requests

1. Keep changes focused; one topic per PR.
2. Add or update tests for anything in `src/` that is not Win32-only.
3. Run `npm test` before pushing.
4. Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`...).
5. Update `CHANGELOG.md` under *Unreleased*.

## Reporting bugs

Please include the output of `warp-discord-windows doctor` and the last lines of `warp-discord-windows logs`. They contain no secrets: the Discord application id is public by design.
