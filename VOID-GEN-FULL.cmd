@echo off
set "ROOT=%~dp0"
cd /d "%ROOT%"
echo ================================================
echo  VOID.GEN Full V3
echo ================================================
echo  TXT -^> IMG + IMG -^> TXT + Gallery
echo  http://127.0.0.1:8080/sd-dashboard.full.html
echo  目錄: %ROOT%
echo ================================================
echo.
start "" "http://127.0.0.1:8080/sd-dashboard.full.html"
C:\ComfyUI_windows_portable\python_embeded\python.exe -m http.server 8080 --bind 127.0.0.1 --directory "%ROOT%"
pause