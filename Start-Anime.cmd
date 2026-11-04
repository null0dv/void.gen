@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Anime.ps1" %*
if errorlevel 1 pause
