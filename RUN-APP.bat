@echo off
setlocal
title Dashboard Hub - Run
cd /d "%~dp0"

echo =============================================================
echo   Dashboard Hub - run from source
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

if not exist "node_modules\electron" (
  echo First run: downloading what Dashboard Hub needs. This takes a few
  echo minutes and needs an internet connection. It only happens once.
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo The download did not finish. Check your internet connection and
    echo double-click RUN-APP.bat to try again.
    pause
    exit /b 1
  )
)

echo Starting Dashboard Hub...
call npm start
if errorlevel 1 (
  echo.
  echo Dashboard Hub stopped with an error. The message above says why.
  pause
  exit /b 1
)
endlocal
