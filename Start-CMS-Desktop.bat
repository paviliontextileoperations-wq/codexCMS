@echo off
setlocal
cd /d "%~dp0"
echo Starting CMS Desktop...
echo.
npm run desktop:start
if errorlevel 1 (
  echo.
  echo CMS Desktop failed to start.
  pause
)
