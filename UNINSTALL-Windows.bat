@echo off
setlocal EnableDelayedExpansion
rem Removes Dashboard Hub from a Windows computer.
rem Double-click this file. It asks before every step.
rem
rem Your data = panels, notes, SSH servers, network map and installed updates.
rem It is stored in:  %APPDATA%\Dashboard Hub
rem Make a backup first if you might want it again (in the app: Backup > Export).

title Dashboard Hub uninstaller
echo Dashboard Hub uninstaller
echo -------------------------
echo.

rem 1. is it running?
set RUNNING=0
tasklist /FI "IMAGENAME eq Dashboard Hub.exe" 2>nul | find /I "Dashboard Hub.exe" >nul
if not errorlevel 1 set RUNNING=1
tasklist /FI "IMAGENAME eq Dashboard-Hub.exe" 2>nul | find /I "Dashboard-Hub.exe" >nul
if not errorlevel 1 set RUNNING=1
if "%RUNNING%"=="1" (
  echo Dashboard Hub is still running.
  set /p CLOSEIT=Close it now? [y/N] 
  if /I "!CLOSEIT!"=="y" (
    taskkill /IM "Dashboard Hub.exe" /F >nul 2>nul
    taskkill /IM "Dashboard-Hub.exe" /F >nul 2>nul
    timeout /t 2 /nobreak >nul
  ) else (
    echo Please close Dashboard Hub and run this again. Nothing was removed.
    pause
    exit /b 1
  )
)

set REMOVED=0

rem 2. the program file(s)
echo Looking for the program...
set FOUND=0
for %%D in ("%~dp0" "%~dp0dist\" "%USERPROFILE%\Desktop\" "%USERPROFILE%\Downloads\" "%USERPROFILE%\Documents\") do (
  for %%F in ("%%~D\Dashboard Hub*.exe" "%%~D\Dashboard-Hub*.exe") do (
    if exist "%%~F" (
      set FOUND=1
      echo   found: %%~F
      set /p DELF=Delete this file? [y/N] 
      if /I "!DELF!"=="y" (
        del /F /Q "%%~F" >nul 2>nul
        if not exist "%%~F" (echo   removed.& set /a REMOVED+=1) else (echo   could not delete it. Is it still open?)
      )
    )
  )
)
if "%FOUND%"=="0" (
  echo   No Dashboard Hub .exe was found in the usual places.
  echo   If you keep it somewhere else, delete that file yourself.
)

rem 3. leftover temporary folders from the portable program (safe to remove)
echo.
set /p DELTMP=Also clean up leftover temporary files? [y/N] 
if /I "!DELTMP!"=="y" (
  for /d %%T in ("%LOCALAPPDATA%\Temp\*") do (
    if exist "%%~T\Dashboard Hub.exe" (
      rmdir /s /q "%%~T" >nul 2>nul
      if not exist "%%~T" (echo   removed: %%~T& set /a REMOVED+=1)
    )
  )
)

rem 4. your data
echo.
set DATAFOUND=0
if exist "%APPDATA%\Dashboard Hub" set DATAFOUND=1
if exist "%APPDATA%\dashboard-hub" set DATAFOUND=1
if "%DATAFOUND%"=="1" (
  echo Your data ^(panels, encrypted notes, SSH servers, network map, installed updates^) is stored in:
  if exist "%APPDATA%\Dashboard Hub" echo   %APPDATA%\Dashboard Hub
  if exist "%APPDATA%\dashboard-hub" echo   %APPDATA%\dashboard-hub
  echo Removing it cannot be undone. In the app, Backup ^> Export makes a copy you can import later.
  set /p DELDATA=Type DELETE ^(capital letters^) to remove your data, or just press Enter to keep it: 
  if "!DELDATA!"=="DELETE" (
    rmdir /s /q "%APPDATA%\Dashboard Hub" >nul 2>nul
    rmdir /s /q "%APPDATA%\dashboard-hub" >nul 2>nul
    set LEFT=0
    if exist "%APPDATA%\Dashboard Hub" set LEFT=1
    if exist "%APPDATA%\dashboard-hub" set LEFT=1
    if "!LEFT!"=="0" (
      echo   removed your data folder.
      set /a REMOVED+=1
    ) else (
      echo   could not remove it. Is Dashboard Hub still open?
    )
  ) else (
    echo Keeping your data.
  )
) else (
  echo No saved data was found.
)

echo.
echo Done. !REMOVED! item^(s^) removed.
pause
endlocal
