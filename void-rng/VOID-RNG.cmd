@echo off
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%"
title VOID.RNG V3 Server

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
echo  VOID.RNG V3
echo ================================================
echo  http://127.0.0.1:8787/
echo  Dir: %ROOT%
echo  Python: %PY%
echo  Close this window to stop the server.
echo ================================================
echo.

"%PY%" grok-proxy.py
set "EC=%ERRORLEVEL%"
if not "%EC%"=="0" (
  echo.
  echo Server exited code=%EC%
  pause
)
endlocal
