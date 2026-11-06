@echo off
setlocal
title Dashboard Hub - Build
cd /d "%~dp0"

echo =============================================================
echo   Dashboard Hub - build the Windows program (Dashboard-Hub.exe)
echo =============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed on this computer.
  echo.
  echo 1. Go to https://nodejs.org and download the "LTS" version (version 24 or newer).
  echo 2. Install it with the default choices.
  echo 3. Close this window and double-click BUILD-APP.bat again.
  echo.
  pause
  exit /b 1
)

echo Step 1 of 2: getting the building tools. This takes a few minutes the
echo first time and needs an internet connection.
echo.
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo The download did not finish. Check your internet connection and
  echo double-click BUILD-APP.bat to try again.
  pause
  exit /b 1
)

echo.
echo Step 2 of 2: building Dashboard-Hub.exe. This can take a few minutes.
echo.
call npm run dist
if errorlevel 1 (
  echo.
  echo The build did not finish. The message above says why.
  pause
  exit /b 1
)

echo.
echo =============================================================
echo   Done! Your program is in the "dist" folder:
echo   dist\Dashboard-Hub.exe
echo =============================================================
if exist "dist\Dashboard-Hub.exe" explorer "dist"
pause
endlocal
