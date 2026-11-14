@echo off
setlocal enabledelayedexpansion
title Dashboard Hub - Recompile .hubupdate Package

echo =============================================================
echo   Dashboard Hub .hubupdate Compiler (Drag & Drop)
echo =============================================================
echo.

rem works whether this file sits next to the tools folder or inside it
set "TOOLS=%~dp0tools"
if not exist "%TOOLS%\make-update.js" set "TOOLS=%~dp0"
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

rem a trailing backslash would break the folder name when passed on
if "!SRC_FOLDER:~-1!"=="\" set "SRC_FOLDER=!SRC_FOLDER:~0,-1!"

echo.
echo Compiling package...
echo.

if not "%VER_INPUT%"=="" (
  if not "%NOTES_INPUT%"=="" (
    node "%TOOLS%\make-update.js" --src "!SRC_FOLDER!" --version "!VER_INPUT!" --notes "!NOTES_INPUT!"
  ) else (
    node "%TOOLS%\make-update.js" --src "!SRC_FOLDER!" --version "!VER_INPUT!"
  )
) else (
  if not "%NOTES_INPUT%"=="" (
    node "%TOOLS%\make-update.js" --src "!SRC_FOLDER!" --notes "!NOTES_INPUT!"
  ) else (
    node "%TOOLS%\make-update.js" --src "!SRC_FOLDER!"
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
