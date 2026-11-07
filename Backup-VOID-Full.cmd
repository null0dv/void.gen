@echo off
setlocal
cd /d "%~dp0"
"%~dp0..\ComfyUI_windows_portable\python_embeded\python.exe" -X utf8 "%~dp0backup_void_full.py" %*
