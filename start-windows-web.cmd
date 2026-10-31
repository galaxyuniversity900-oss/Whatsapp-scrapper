@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows-web.ps1"
if errorlevel 1 (
  echo.
  echo The web workspace could not be started. Review the error above.
  pause
)
endlocal
