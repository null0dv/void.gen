@echo off
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%"
echo ================================================
echo  VOID.GEN Full V3 - 本地伺服器
echo ================================================
echo  啟動後請用 Chrome 或 Edge 開啟：
echo  http://localhost:8080/sd-dashboard.full.html?v=28
echo  目錄: %ROOT%
echo.
echo  安裝成 APP：網址列右側點「安裝」圖示
echo  關閉伺服器：此視窗按 Ctrl+C
echo ================================================
echo.
start "" "http://localhost:8080/sd-dashboard.full.html?v=28"
C:\ComfyUI_windows_portable\python_embeded\python.exe -m http.server 8080 --directory "%ROOT%"
pause
