@echo off
echo.
echo  Void.gen Dashboard Server
echo  ─────────────────────────
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
  set IP=%%a
  goto :found
)
:found
set IP=%IP: =%
echo  Open on this PC:    http://localhost:3000
echo  Open on phone:      http://%IP%:3000
echo.
echo  Make sure your phone is on the same WiFi.
echo  Press Ctrl+C to stop the server.
echo.
"C:\ComfyUI_windows_portable\python_embeded\python.exe" -m http.server 3000 --bind 0.0.0.0 --directory "%~dp0"
pause
