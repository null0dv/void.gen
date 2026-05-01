@echo off
cd /d "%~dp0"
echo ================================================
echo  SD 生成面板 - 本地伺服器
echo ================================================
echo  啟動後請用 Chrome 或 Edge 開啟：
echo  http://localhost:8080/sd-dashboard.html
echo.
echo  安裝成 APP：網址列右側點「安裝」圖示
echo  關閉伺服器：此視窗按 Ctrl+C
echo ================================================
echo.
start "" "http://localhost:8080/sd-dashboard.html"
C:\ComfyUI_windows_portable\python_embeded\python.exe -m http.server 8080
pause
