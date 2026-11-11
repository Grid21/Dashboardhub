@echo off
setlocal enabledelayedexpansion
title Dashboard Hub - .hubupdate Decompiler

echo =============================================================
echo   Dashboard Hub .hubupdate Decompiler
echo =============================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo Error: Node.js was not found on your computer.
  echo Please install Node.js LTS from https://nodejs.org and try again.
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
node "%~dp0tools\unpack-update.js" "%TARGET_FILE%"

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
