@echo off
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%"
title VOID.GEN Full V3 Server

set "PY=C:\ComfyUI_windows_portable\python_embeded\python.exe"
if not exist "%PY%" set "PY="
if not defined PY where py >nul 2>&1 && set "PY=py"
if not defined PY where python >nul 2>&1 && set "PY=python"
if not defined PY (
  echo ERROR: Python not found. Install Python 3 or check ComfyUI path.
  pause
  exit /b 1
)

echo ================================================
echo  VOID.GEN Full V3
echo ================================================
echo  TXT -^> IMG + IMG -^> TXT + Gallery
echo  http://127.0.0.1:8080/sd-dashboard.full.html
echo  Dir: %ROOT%
echo  Python: %PY%
echo  Close this window to stop the server.
echo ================================================
echo.

start "" "http://127.0.0.1:8080/sd-dashboard.full.html"
"%PY%" -m http.server 8080 --bind 127.0.0.1 --directory "%ROOT%"
set "EC=%ERRORLEVEL%"
if not "%EC%"=="0" (
  echo.
  echo Server exited code=%EC%
  pause
)
endlocal
