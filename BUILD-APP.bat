@echo off
setlocal
title Dashboard Hub - Build
cd /d "%~dp0"

echo =============================================================
echo   Dashboard Hub - build the Windows program
echo =============================================================
echo.

set "ENSURE=%~dp0ENSURE-NODE.bat"
if not exist "%ENSURE%" set "ENSURE=%~dp0..\ENSURE-NODE.bat"
call "%ENSURE%"
if errorlevel 1 (
  echo.
  echo Node.js is needed to continue. Install Node.js 22 or newer from
  echo https://nodejs.org ^(the LTS button^) and run this again.
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
echo Step 2 of 2: building the installer. This can take a few minutes.
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
echo   Done! Your program is in the "Dashboard Hub" folder, next to
echo   this file:
echo.
echo   Dashboard-Hub-Setup.exe      installs it (with an uninstaller)
echo   Run without installing\      the program itself, no install needed
echo =============================================================
if exist "Dashboard Hub\Dashboard-Hub-Setup.exe" explorer "Dashboard Hub"
pause
endlocal
