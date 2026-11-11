@echo off
setlocal enabledelayedexpansion
title Dashboard Hub - Recompile .hubupdate Package

echo =============================================================
echo   Dashboard Hub .hubupdate Compiler (Drag & Drop)
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

set SRC_FOLDER=%~1
if "%SRC_FOLDER%"=="" (
  set SRC_FOLDER=%~dp0
  echo Compiling from current project folder:
  echo !SRC_FOLDER!
) else (
  echo Compiling from dragged folder:
  echo !SRC_FOLDER!
)

echo.
set /p VER_INPUT="Enter version number (e.g. 1.10.3, or press Enter to read from source): "
set /p NOTES_INPUT="Enter release notes for this update (optional, press Enter to skip): "

echo.
echo Compiling package...
echo.

if not "%VER_INPUT%"=="" (
  if not "%NOTES_INPUT%"=="" (
    node "%~dp0tools\make-update.js" --src "!SRC_FOLDER!" --version "!VER_INPUT!" --notes "!NOTES_INPUT!"
  ) else (
    node "%~dp0tools\make-update.js" --src "!SRC_FOLDER!" --version "!VER_INPUT!"
  )
) else (
  if not "%NOTES_INPUT%"=="" (
    node "%~dp0tools\make-update.js" --src "!SRC_FOLDER!" --notes "!NOTES_INPUT!"
  ) else (
    node "%~dp0tools\make-update.js" --src "!SRC_FOLDER!"
  )
)

if %ERRORLEVEL% equ 0 (
  echo.
  echo Success! Opening update-files folder in Explorer...
  if exist "%~dp0update-files" (
    explorer "%~dp0update-files"
  )
) else (
  echo.
  echo An error occurred during compilation.
)

pause
