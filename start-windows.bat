@echo off
title Stickframe
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org ^(version 20 or newer^) and run this again. & pause & exit /b 1)
if not exist node_modules (
  echo Installing Stickframe for the first time. This takes a minute...
  call npm install --no-fund --no-audit || (pause & exit /b 1)
)
node server/index.js
pause
