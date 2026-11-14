@echo off
setlocal enabledelayedexpansion
title Dashboard Hub - .hubupdate Decompiler

echo =============================================================
echo   Dashboard Hub .hubupdate Decompiler
echo =============================================================
echo.

rem works whether this file sits next to the tools folder or inside it
set "TOOLS=%~dp0tools"
if not exist "%TOOLS%\unpack-update.js" set "TOOLS=%~dp0"
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

set TARGET_FILE=%~1

if "%TARGET_FILE%"=="" (
  echo Drag and drop any .hubupdate, .txt, or .json update file onto this
  echo batch file to automatically extract all its source code.
  echo.
  set /p TARGET_FILE="Or enter the path to the update file: "
)

if "%TARGET_FILE%"=="" (
  echo No file specified. Exiting.
  pause
  exit /b 0
)

echo Extracting update from: %TARGET_FILE%
echo.
node "%TOOLS%\unpack-update.js" "%TARGET_FILE%"

if %ERRORLEVEL% equ 0 (
  echo.
  echo Decompilation finished successfully!
  echo You can now open the decompiled folder, inspect or modify files,
  echo and recompile anytime using: RECOMPILE-UPDATE.bat
  echo.
) else (
  echo.
  echo An error occurred during decompilation.
)

pause
