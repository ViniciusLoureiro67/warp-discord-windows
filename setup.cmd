@echo off
setlocal
rem Double-click helper for people who cloned or downloaded the repository.
rem Installs dependencies, builds once, then opens the interactive menu.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required. Download it from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

if not exist dist\cli.js (
  echo Building...
  call npm run build
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

node bin\warp-discord-windows.js menu
echo.
pause
