@echo off
rem Dashboard Hub - makes sure Node.js is available (Windows).
rem The other .bat files start this with:   call "%~dp0ENSURE-NODE.bat" || exit /b 1
rem
rem  - Node.js already installed (version 22 or newer) -> nothing is downloaded, it just carries on.
rem  - Not installed, or too old -> offers to download the official Node.js LTS (a plain zip, no installer)
rem    and unpack it into your own folder.
rem Returns 0 when node and npm work, 1 when they do not.

rem a copy downloaded earlier by this file is not on the normal PATH, so look there first
if "%HUB_NODE_DIR%"=="" set "HUB_NODE_DIR=%LocalAppData%\dashboard-hub-node"
if exist "%HUB_NODE_DIR%\node.exe" set "PATH=%HUB_NODE_DIR%;%PATH%"

if "%NODE_MIN_MAJOR%"=="" set "NODE_MIN_MAJOR=22"
set "HUBNODE_MAJOR="

call :check
if "%HUBNODE_OK%"=="1" (
  echo Node.js %HUBNODE_VER% is already installed - skipping the Node.js install.
  echo.
  exit /b 0
)

if defined HUBNODE_VER (
  echo Node.js %HUBNODE_VER% is installed, but Dashboard Hub needs version %NODE_MIN_MAJOR% or newer.
) else (
  echo Node.js is not installed on this computer.
)
echo.
echo Dashboard Hub can download the official Node.js ^(LTS^) from nodejs.org for you.
echo It only unpacks it into your own folder ^(%HUB_NODE_DIR%^).
echo There is no installer, no administrator permission is needed, and nothing
echo else on your computer is changed.
echo.
if not "%HUB_NODE_YES%"=="1" (
  choice /c YN /n /m "Download Node.js now? [Y/N] "
  if errorlevel 2 (
    echo.
    echo Okay. Install Node.js %NODE_MIN_MAJOR% or newer from https://nodejs.org and run this again.
    exit /b 1
  )
)

set "PS1=%~dp0ENSURE-NODE.ps1"
if not exist "%PS1%" set "PS1=%~dp0..\ENSURE-NODE.ps1"
if not exist "%PS1%" (
  echo The file ENSURE-NODE.ps1 is missing from this folder.
  echo Install Node.js %NODE_MIN_MAJOR% or newer from https://nodejs.org and run this again.
  exit /b 1
)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
if errorlevel 1 exit /b 1

if exist "%HUB_NODE_DIR%\node.exe" set "PATH=%HUB_NODE_DIR%;%PATH%"
call :check
if not "%HUBNODE_OK%"=="1" (
  echo.
  echo Node.js was unpacked but does not run on this computer.
  echo Install Node.js from https://nodejs.org instead and run this again.
  exit /b 1
)
echo.
echo Node.js %HUBNODE_VER% is ready. Dashboard Hub's files will find it by themselves.
echo.
exit /b 0

:check
set "HUBNODE_OK=0"
set "HUBNODE_VER="
set "HUBNODE_MAJOR="
where node >nul 2>nul
if errorlevel 1 exit /b 0
where npm >nul 2>nul
if errorlevel 1 exit /b 0
for /f "delims=" %%v in ('node -p "process.versions.node" 2^>nul') do set "HUBNODE_VER=%%v"
for /f "delims=" %%m in ('node -p "parseInt(process.versions.node)" 2^>nul') do set "HUBNODE_MAJOR=%%m"
if not defined HUBNODE_MAJOR exit /b 0
if %HUBNODE_MAJOR% GEQ %NODE_MIN_MAJOR% set "HUBNODE_OK=1"
exit /b 0
